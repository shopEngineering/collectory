'use strict';
const m = require('../util/mappers');

// ---------------------------------------------------------------------------
// FTS5 sync (external-content style, manual). rowid = items.id.
// field_text = flattened dynamic values + tag names.
// ---------------------------------------------------------------------------

function flattenFieldText(db, itemId, fieldsObj) {
  const parts = [];
  for (const [k, v] of Object.entries(fieldsObj || {})) {
    if (v == null) continue;
    if (Array.isArray(v)) parts.push(v.join(' '));
    else if (typeof v === 'object') parts.push(JSON.stringify(v));
    else parts.push(String(v));
  }
  const tagNames = db
    .prepare('SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ?')
    .all(itemId)
    .map((r) => r.name);
  parts.push(...tagNames);
  return parts.join(' ');
}

// Rebuild the FTS row for one item (delete + insert). Safe to call after any write.
function syncFts(db, itemId) {
  const row = db.prepare('SELECT id, name, notes, fields_json, deleted_at FROM items WHERE id = ?').get(itemId);
  db.prepare('DELETE FROM items_fts WHERE rowid = ?').run(itemId);
  if (!row || row.deleted_at) return; // soft-deleted items are not searchable
  const fields = m.parseJson(row.fields_json, {});
  const fieldText = flattenFieldText(db, itemId, fields);
  db.prepare('INSERT INTO items_fts (rowid, name, notes, field_text) VALUES (?, ?, ?, ?)').run(
    itemId,
    row.name || '',
    row.notes || '',
    fieldText
  );
}

function removeFts(db, itemId) {
  db.prepare('DELETE FROM items_fts WHERE rowid = ?').run(itemId);
}

// Sanitize an FTS query so special characters never crash the parser.
// We wrap each whitespace-delimited token in double quotes (escaping embedded
// quotes) and append * for prefix matching. Empty -> null (caller uses LIKE).
function ftsQuery(q) {
  if (!q) return null;
  const tokens = String(q)
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, '').trim())
    .filter(Boolean);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

function ensureTag(db, name) {
  const clean = String(name).trim();
  if (!clean) return null;
  let row = db.prepare('SELECT id FROM tags WHERE name = ?').get(clean);
  if (!row) {
    const info = db.prepare("INSERT INTO tags (name, color) VALUES (?, '#6b7280')").run(clean);
    return info.lastInsertRowid;
  }
  return row.id;
}

function setItemTags(db, itemId, names) {
  db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(itemId);
  const seen = new Set();
  for (const name of names || []) {
    const tagId = ensureTag(db, name);
    if (tagId && !seen.has(tagId)) {
      db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)').run(itemId, tagId);
      seen.add(tagId);
    }
  }
}

function getItemTags(db, itemId) {
  return db
    .prepare(
      'SELECT t.id, t.name, t.color FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name'
    )
    .all(itemId)
    .map(m.tagToApi);
}

// ---------------------------------------------------------------------------
// Photos / cover
// ---------------------------------------------------------------------------

function getItemPhotos(db, itemId) {
  return db
    .prepare('SELECT * FROM photos WHERE item_id = ? ORDER BY sort_order, id')
    .all(itemId)
    .map(m.photoToApi);
}

function coverThumbUrl(db, item) {
  let cover = null;
  if (item.cover_photo_id) {
    cover = db.prepare('SELECT * FROM photos WHERE id = ? AND item_id = ?').get(item.cover_photo_id, item.id);
  }
  if (!cover) {
    cover = db.prepare('SELECT * FROM photos WHERE item_id = ? ORDER BY sort_order, id LIMIT 1').get(item.id);
  }
  return cover ? `/images/thumb/${m.thumbName(cover.filename)}` : null;
}

// ---------------------------------------------------------------------------
// Computed stats (derived from logs, never stored)
// ---------------------------------------------------------------------------

function computeStats(db, itemId) {
  const logs = db
    .prepare('SELECT log_type_key, date, data_json FROM logs WHERE item_id = ? ORDER BY date')
    .all(itemId)
    .map((r) => ({ type: r.log_type_key, date: r.date, data: m.parseJson(r.data_json, {}) }));

  const stats = {};

  const rangeLogs = logs.filter((l) => l.type === 'range_session');
  const roundsFired = rangeLogs.reduce((s, l) => s + num(l.data.rounds_fired), 0);
  if (rangeLogs.length) stats.roundsFired = roundsFired;

  const cleaningLogs = logs.filter((l) => l.type === 'cleaning');
  if (cleaningLogs.length) {
    const lastCleaned = cleaningLogs.reduce((max, l) => (l.date > max ? l.date : max), cleaningLogs[0].date);
    stats.lastCleaned = lastCleaned;
    const since = rangeLogs
      .filter((l) => l.date > lastCleaned)
      .reduce((s, l) => s + num(l.data.rounds_fired), 0);
    stats.roundsSinceCleaned = since;
  }

  if (logs.length) {
    stats.lastActivity = logs.reduce((max, l) => (l.date > max ? l.date : max), logs[0].date);
  }
  return stats;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Item assembly
// ---------------------------------------------------------------------------

function buildSummary(db, row) {
  const cardFieldDefs = db
    .prepare(
      'SELECT key FROM field_defs WHERE collection_id = ? AND (show_on_card = 1 OR show_in_table = 1) ORDER BY sort_order, id'
    )
    .all(row.collection_id);
  const fields = m.parseJson(row.fields_json, {});
  const cardFields = {};
  for (const fd of cardFieldDefs) {
    if (fields[fd.key] !== undefined) cardFields[fd.key] = fields[fd.key];
  }
  return {
    id: row.id,
    collectionId: row.collection_id,
    name: row.name,
    status: row.status,
    quantity: row.quantity,
    acquiredDate: row.acquired_date,
    acquiredPriceCents: row.acquired_price_cents,
    currentValueCents: row.current_value_cents,
    thumbUrl: coverThumbUrl(db, row),
    cardFields,
    tags: getItemTags(db, row.id),
    updatedAt: row.updated_at,
  };
}

function buildFull(db, row) {
  const collection = db.prepare('SELECT id, name, icon, color, template_key FROM collections WHERE id = ?').get(row.collection_id);
  return {
    ...m.itemCoreToApi(row),
    photos: getItemPhotos(db, row.id),
    tags: getItemTags(db, row.id),
    computedStats: computeStats(db, row.id),
    collection: collection
      ? { id: collection.id, name: collection.name, icon: collection.icon, color: collection.color, templateKey: collection.template_key }
      : null,
  };
}

module.exports = {
  flattenFieldText,
  syncFts,
  removeFts,
  ftsQuery,
  ensureTag,
  setItemTags,
  getItemTags,
  getItemPhotos,
  coverThumbUrl,
  computeStats,
  buildSummary,
  buildFull,
  num,
};
