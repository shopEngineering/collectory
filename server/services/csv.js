'use strict';
const Papa = require('papaparse');
const m = require('../util/mappers');
const itemSvc = require('./items');

// Core columns present in every CSV export (in this order).
const CORE_COLUMNS = [
  { header: 'id', key: 'id' },
  { header: 'name', key: 'name' },
  { header: 'status', key: 'status' },
  { header: 'quantity', key: 'quantity' },
  { header: 'min_quantity', key: 'min_quantity' },
  { header: 'acquired_date', key: 'acquired_date' },
  { header: 'acquired_price', key: 'acquired_price' }, // dollars in CSV, cents in DB
  { header: 'acquired_from', key: 'acquired_from' },
  { header: 'current_value', key: 'current_value' }, // dollars in CSV
  { header: 'notes', key: 'notes' },
];

const CORE_NAMES_FOR_MAPPING = ['id', 'name', 'status', 'quantity', 'minQuantity', 'acquiredDate', 'acquiredPrice', 'acquiredFrom', 'currentValue', 'notes'];

function centsToDollars(cents) {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}
function dollarsToCents(str) {
  if (str == null || String(str).trim() === '') return null;
  const n = Number(String(str).replace(/[$,]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

// Build CSV string for a collection: core columns + one per field_def + tags.
function exportCollection(db, collectionId) {
  const fieldDefs = db.prepare('SELECT * FROM field_defs WHERE collection_id = ? ORDER BY sort_order, id').all(collectionId);
  const items = db.prepare('SELECT * FROM items WHERE collection_id = ? AND deleted_at IS NULL ORDER BY id').all(collectionId);

  const headers = [
    ...CORE_COLUMNS.map((c) => c.header),
    ...fieldDefs.map((f) => `field:${f.key}`),
    'tags',
  ];

  const rows = items.map((it) => {
    const fields = m.parseJson(it.fields_json, {});
    const row = {
      id: it.id,
      name: it.name,
      status: it.status,
      quantity: it.quantity,
      min_quantity: it.min_quantity != null ? it.min_quantity : '',
      acquired_date: it.acquired_date || '',
      acquired_price: centsToDollars(it.acquired_price_cents),
      acquired_from: it.acquired_from || '',
      current_value: centsToDollars(it.current_value_cents),
      notes: it.notes || '',
    };
    for (const f of fieldDefs) {
      const v = fields[f.key];
      row[`field:${f.key}`] = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
    }
    row.tags = itemSvc.getItemTags(db, it.id).map((t) => t.name).join('; ');
    return row;
  });

  return Papa.unparse({ fields: headers, data: rows.map((r) => headers.map((hh) => r[hh])) });
}

// Parse an uploaded CSV file into headers + rows.
function parseCsv(text) {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields || [];
  return { headers, rows: parsed.data };
}

// Levenshtein-ish fuzzy: normalize and compare header to targets.
function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Suggest a mapping target for each header vs core names + this collection's field labels/keys.
function suggestMapping(headers, fieldDefs) {
  const coreTargets = CORE_NAMES_FOR_MAPPING.map((n) => ({ target: `core:${n}`, norms: [norm(n)] }));
  // core alias helpers
  const coreAliases = {
    'core:acquiredPrice': ['acquiredprice', 'price', 'cost', 'purchaseprice', 'paid'],
    'core:currentValue': ['currentvalue', 'value', 'worth', 'estimatedvalue'],
    'core:acquiredDate': ['acquireddate', 'date', 'purchasedate', 'dateacquired'],
    'core:acquiredFrom': ['acquiredfrom', 'source', 'dealer', 'seller', 'vendor'],
    'core:minQuantity': ['minquantity', 'minqty', 'lowstock', 'reorder'],
    'core:quantity': ['quantity', 'qty', 'count', 'rounds'],
    'core:name': ['name', 'title', 'description', 'item'],
  };
  for (const t of coreTargets) {
    if (coreAliases[t.target]) t.norms.push(...coreAliases[t.target].map(norm));
  }
  const fieldTargets = fieldDefs.map((f) => ({ target: `field:${f.key}`, norms: [norm(f.key), norm(f.label)] }));
  const all = [...coreTargets, ...fieldTargets];

  const mapping = {};
  for (const header of headers) {
    const hn = norm(header);
    // Explicit "field:key" headers from our own export map directly.
    if (String(header).startsWith('field:')) {
      mapping[header] = `field:${String(header).slice('field:'.length)}`;
      continue;
    }
    if (hn === 'tags') {
      mapping[header] = 'skip'; // tags handled separately below via header name
    }
    let best = 'skip';
    let bestScore = 0;
    for (const cand of all) {
      for (const nrm of cand.norms) {
        if (!nrm) continue;
        let score = 0;
        if (hn === nrm) score = 100;
        else if (hn.includes(nrm) || nrm.includes(hn)) score = 60;
        if (score > bestScore) {
          bestScore = score;
          best = cand.target;
        }
      }
    }
    // Map a "tags" header to a synthetic tags target
    if (hn === 'tags') best = 'core:tags';
    mapping[header] = bestScore > 0 || best === 'core:tags' ? best : 'skip';
  }
  return mapping;
}

// Commit an import. mapping: {header: 'core:<name>'|'field:<key>'|'new:<type>'|'skip'|'core:tags'}
// Rows whose mapped core:id matches an existing item UPDATE it; else INSERT.
function commitImport(db, collectionId, headers, rows, mapping, ensureFieldDef) {
  const result = { imported: 0, skipped: 0, errors: [] };
  const now = new Date().toISOString();

  // Pre-create any new: field defs, then treat them as field: targets.
  const effectiveMapping = { ...mapping };
  for (const [header, target] of Object.entries(mapping)) {
    if (typeof target === 'string' && target.startsWith('new:')) {
      const type = target.slice('new:'.length) || 'text';
      const key = ensureFieldDef(collectionId, header, type);
      effectiveMapping[header] = `field:${key}`;
    }
  }

  rows.forEach((raw, idx) => {
    try {
      const core = {};
      const fields = {};
      let tags = null;
      let providedId = null;

      for (const [header, target] of Object.entries(effectiveMapping)) {
        if (!target || target === 'skip') continue;
        const value = raw[header];
        if (target === 'core:id') {
          providedId = value != null && String(value).trim() !== '' ? parseInt(value, 10) : null;
        } else if (target === 'core:tags') {
          tags = String(value || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
        } else if (target.startsWith('core:')) {
          core[target.slice('core:'.length)] = value;
        } else if (target.startsWith('field:')) {
          const key = target.slice('field:'.length);
          if (value != null && String(value).trim() !== '') fields[key] = value;
        }
      }

      if ((core.name == null || String(core.name).trim() === '') && providedId == null) {
        result.skipped++;
        return;
      }

      const coreCols = mapCoreForDb(core, now);

      if (providedId != null && !Number.isNaN(providedId)) {
        const existing = db.prepare('SELECT * FROM items WHERE id = ? AND collection_id = ?').get(providedId, collectionId);
        if (existing) {
          // UPDATE: merge fields into existing
          const merged = { ...m.parseJson(existing.fields_json, {}), ...fields };
          const set = { ...coreCols, fields_json: JSON.stringify(merged), updated_at: now };
          // Don't overwrite name with blank
          if (set.name == null || String(set.name).trim() === '') delete set.name;
          const assign = Object.keys(set).map((k) => `${k} = @${k}`).join(', ');
          db.prepare(`UPDATE items SET ${assign} WHERE id = @id`).run({ ...set, id: providedId });
          if (tags) itemSvc.setItemTags(db, providedId, tags);
          itemSvc.syncFts(db, providedId);
          result.imported++;
          return;
        }
        // id given but not found -> insert as new (ignore id, autonumber)
      }

      // INSERT new
      const info = db
        .prepare(
          `INSERT INTO items (collection_id, name, status, quantity, min_quantity, acquired_date, acquired_price_cents,
                              acquired_from, current_value_cents, value_updated_at, notes, fields_json, created_at, updated_at)
           VALUES (@collection_id, @name, @status, @quantity, @min_quantity, @acquired_date, @acquired_price_cents,
                   @acquired_from, @current_value_cents, @value_updated_at, @notes, @fields_json, @created_at, @updated_at)`
        )
        .run({
          collection_id: collectionId,
          name: coreCols.name != null ? coreCols.name : 'Unnamed',
          status: coreCols.status || 'owned',
          quantity: coreCols.quantity != null ? coreCols.quantity : 1,
          min_quantity: coreCols.min_quantity != null ? coreCols.min_quantity : null,
          acquired_date: coreCols.acquired_date || null,
          acquired_price_cents: coreCols.acquired_price_cents != null ? coreCols.acquired_price_cents : null,
          acquired_from: coreCols.acquired_from || null,
          current_value_cents: coreCols.current_value_cents != null ? coreCols.current_value_cents : null,
          value_updated_at: coreCols.current_value_cents != null ? now : null,
          notes: coreCols.notes || '',
          fields_json: JSON.stringify(fields),
          created_at: now,
          updated_at: now,
        });
      const newId = info.lastInsertRowid;
      if (tags) itemSvc.setItemTags(db, newId, tags);
      itemSvc.syncFts(db, newId);
      result.imported++;
    } catch (e) {
      result.errors.push({ row: idx + 1, message: e.message });
    }
  });

  return result;
}

// Map CSV core values into DB column names/types.
function mapCoreForDb(core, now) {
  const out = {};
  if (core.name !== undefined) out.name = core.name != null ? String(core.name) : null;
  if (core.status !== undefined && core.status) out.status = String(core.status);
  if (core.quantity !== undefined && core.quantity !== '') out.quantity = Number(core.quantity);
  if (core.minQuantity !== undefined) out.min_quantity = core.minQuantity === '' ? null : Number(core.minQuantity);
  if (core.acquiredDate !== undefined) out.acquired_date = core.acquiredDate || null;
  if (core.acquiredPrice !== undefined) out.acquired_price_cents = dollarsToCents(core.acquiredPrice);
  if (core.acquiredFrom !== undefined) out.acquired_from = core.acquiredFrom || null;
  if (core.currentValue !== undefined) out.current_value_cents = dollarsToCents(core.currentValue);
  if (core.notes !== undefined) out.notes = core.notes || '';
  return out;
}

module.exports = { CORE_COLUMNS, exportCollection, parseCsv, suggestMapping, commitImport, dollarsToCents, centsToDollars };
