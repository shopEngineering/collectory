'use strict';
// Item references (DESIGN §5.2): item_ref / item_refs / ammo_ref fields, the
// item-choices picker source, and the /items/:id/related graph (both directions
// plus the synthetic range-log `used_with` group).
const m = require('../util/mappers');
const itemSvc = require('./items');

// Statuses excluded from choices/related (former ownership, per §3).
const FORMER_STATUSES = ['sold', 'traded', 'gifted'];

// The ref-bearing field types whose values are item ids.
const REF_TYPES = new Set(['item_ref', 'item_refs', 'ammo_ref']);

// Build a Choice for one item row (must have i.* columns available).
function choiceFor(db, row) {
  const col = db.prepare('SELECT name FROM collections WHERE id = ?').get(row.collection_id);
  const fields = m.parseJson(row.fields_json, {});
  const choice = {
    id: row.id,
    name: row.name,
    collectionId: row.collection_id,
    collectionName: col ? col.name : '',
    quantity: row.quantity,
    thumbUrl: itemSvc.coverThumbUrl(db, row),
    hint: fields.caliber != null ? String(fields.caliber) : null,
  };
  return choice;
}

// GET /api/item-choices?template=&q=&excludeItemId=
// Items eligible to be referenced: not trashed, not former-status.
function itemChoices(db, { template, q, excludeItemId } = {}) {
  const where = ['i.deleted_at IS NULL', `i.status NOT IN (${FORMER_STATUSES.map(() => '?').join(',')})`];
  const params = [...FORMER_STATUSES];
  if (template) {
    where.push('c.template_key = ?');
    params.push(String(template));
  }
  if (excludeItemId != null && Number.isInteger(Number(excludeItemId))) {
    where.push('i.id != ?');
    params.push(Number(excludeItemId));
  }
  if (q && String(q).trim()) {
    where.push('(i.name LIKE ? OR i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?))');
    const ftsQ = itemSvc.ftsQuery(q);
    params.push(`%${String(q).trim()}%`, ftsQ || String(q).trim());
  }
  const rows = db
    .prepare(
      `SELECT i.id, i.name, i.collection_id, i.quantity, i.fields_json, i.cover_photo_id
       FROM items i JOIN collections c ON c.id = i.collection_id
       WHERE ${where.join(' AND ')}
       ORDER BY i.name LIMIT 200`
    )
    .all(...params);
  return rows.map((row) => choiceFor(db, row));
}

// Resolve a list of item ids to Choice objects, preserving order, dropping
// missing/trashed/former items.
function choicesForIds(db, ids) {
  const out = [];
  for (const id of ids) {
    const row = db
      .prepare(
        `SELECT i.id, i.name, i.collection_id, i.quantity, i.fields_json, i.cover_photo_id, i.status, i.deleted_at
         FROM items i WHERE i.id = ?`
      )
      .get(id);
    if (!row || row.deleted_at || FORMER_STATUSES.includes(row.status)) continue;
    out.push(choiceFor(db, row));
  }
  return out;
}

// Coerce a stored ref value to an array of numeric ids.
function idsFromValue(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
}

// GET /api/items/:id/related — outgoing references + who references this item.
function related(db, itemId) {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) return null;
  const fields = m.parseJson(item.fields_json, {});

  // ---- references: this item's own ref fields ----
  const refFieldDefs = db
    .prepare(
      `SELECT key, label, type, ref_template FROM field_defs
       WHERE collection_id = ? AND type IN ('item_ref', 'item_refs', 'ammo_ref')
       ORDER BY sort_order, id`
    )
    .all(item.collection_id);
  const references = [];
  for (const fd of refFieldDefs) {
    const ids = idsFromValue(fields[fd.key]);
    if (!ids.length) continue;
    const items = choicesForIds(db, ids);
    if (items.length) references.push({ fieldKey: fd.key, fieldLabel: fd.label, items });
  }

  // ---- referencedBy: other items whose ref fields contain this id ----
  const referencedBy = [];
  const allRefDefs = db
    .prepare(
      `SELECT fd.collection_id, fd.key, fd.label, fd.type, c.template_key
       FROM field_defs fd JOIN collections c ON c.id = fd.collection_id
       WHERE fd.type IN ('item_ref', 'item_refs', 'ammo_ref')`
    )
    .all();
  for (const fd of allRefDefs) {
    // Match items in this collection whose fields_json for this key contains our id.
    // Single refs store a scalar; multi store an array — json_each handles both
    // when the value is an array, and a scalar equality handles single/ammo_ref.
    const rows = db
      .prepare(
        `SELECT i.id, i.name, i.collection_id, i.quantity, i.fields_json, i.cover_photo_id
         FROM items i
         WHERE i.collection_id = ? AND i.deleted_at IS NULL
           AND i.status NOT IN (${FORMER_STATUSES.map(() => '?').join(',')})
           AND (
             json_extract(i.fields_json, '$.' || ?) = ?
             OR EXISTS (
               SELECT 1 FROM json_each(i.fields_json, '$.' || ?)
               WHERE CAST(json_each.value AS INTEGER) = ?
             )
           )`
      )
      .all(fd.collection_id, ...FORMER_STATUSES, fd.key, itemId, fd.key, itemId);
    if (!rows.length) continue;
    referencedBy.push({
      fieldKey: fd.key,
      fieldLabel: fd.label,
      templateKey: fd.template_key,
      items: rows.map((row) => choiceFor(db, row)),
    });
  }

  // ---- synthetic magazines group: firearms with a magazine that holds or is
  // loaded with this (ammo) item (magazines are child records of firearms) ----
  const magRows = db
    .prepare(
      `SELECT DISTINCT i.id, i.name, i.collection_id, i.quantity, i.fields_json, i.cover_photo_id
       FROM magazines mg JOIN items i ON i.id = mg.item_id
       WHERE i.deleted_at IS NULL
         AND i.status NOT IN (${FORMER_STATUSES.map(() => '?').join(',')})
         AND (
           mg.loaded_with = ?
           OR EXISTS (SELECT 1 FROM json_each(mg.holds_ammo_json) WHERE CAST(json_each.value AS INTEGER) = ?)
         )
       ORDER BY i.name`
    )
    .all(...FORMER_STATUSES, itemId, itemId);
  if (magRows.length) {
    referencedBy.push({
      fieldKey: 'magazines',
      fieldLabel: 'In magazines of',
      templateKey: 'firearms',
      items: magRows.map((row) => choiceFor(db, row)),
    });
  }

  // ---- synthetic used_with: guns whose range logs used this (ammo) item ----
  const usedWithRows = db
    .prepare(
      `SELECT DISTINCT i.id, i.name, i.collection_id, i.quantity, i.fields_json, i.cover_photo_id
       FROM logs l JOIN items i ON i.id = l.item_id
       WHERE l.log_type_key = 'range_session'
         AND i.deleted_at IS NULL
         AND i.status NOT IN (${FORMER_STATUSES.map(() => '?').join(',')})
         AND CAST(json_extract(l.data_json, '$.ammo_item_id') AS INTEGER) = ?
       ORDER BY i.name`
    )
    .all(...FORMER_STATUSES, itemId);
  if (usedWithRows.length) {
    referencedBy.push({
      fieldKey: 'used_with',
      fieldLabel: 'Used with',
      templateKey: 'firearms',
      items: usedWithRows.map((row) => choiceFor(db, row)),
    });
  }

  return { references, referencedBy };
}

module.exports = { itemChoices, related, choicesForIds, REF_TYPES, FORMER_STATUSES };
