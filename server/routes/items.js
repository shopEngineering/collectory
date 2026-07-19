'use strict';
const express = require('express');
const m = require('../util/mappers');
const err = require('../util/errors');
const itemSvc = require('../services/items');
const refSvc = require('../services/references');
const imageStore = require('../services/imageStore');

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const CORE_PATCHABLE = {
  name: 'name',
  status: 'status',
  quantity: 'quantity',
  minQuantity: 'min_quantity',
  acquiredDate: 'acquired_date',
  acquiredPriceCents: 'acquired_price_cents',
  acquiredFrom: 'acquired_from',
  currentValueCents: 'current_value_cents',
  notes: 'notes',
};

const SORT_MAP = {
  name: 'name',
  acquiredDate: 'acquired_date',
  acquiredPrice: 'acquired_price_cents',
  currentValue: 'current_value_cents',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  quantity: 'quantity',
};

module.exports = function itemsRouter(ctx) {
  const { db } = ctx;
  const r = express.Router();

  // GET /api/collections/:id/items — filtered list
  r.get('/collections/:id/items', h((req, res) => {
    const collectionId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(collectionId)) throw err.notFound('collection not found');

    const q = (req.query.q || '').trim();
    const statuses = (req.query.status ? String(req.query.status) : 'owned,loaned,wishlist')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const sort = SORT_MAP[req.query.sort] || 'updated_at';
    const dir = String(req.query.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 5000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const where = ['i.collection_id = ?', 'i.deleted_at IS NULL'];
    const params = [collectionId];

    if (statuses.length) {
      where.push(`i.status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    }

    // FTS-scoped search within the collection; falls back to LIKE on special chars.
    if (q) {
      const ftsQ = itemSvc.ftsQuery(q);
      if (ftsQ) {
        where.push('i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)');
        params.push(ftsQ);
      } else {
        where.push('(i.name LIKE ? OR i.notes LIKE ?)');
        params.push(`%${q}%`, `%${q}%`);
      }
    }

    // tag filter (by name)
    if (req.query.tag) {
      where.push('i.id IN (SELECT it.item_id FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE t.name = ?)');
      params.push(String(req.query.tag));
    }

    // field.<key>=<value> exact filters on fields_json
    for (const [k, v] of Object.entries(req.query)) {
      if (!k.startsWith('field.')) continue;
      const key = k.slice('field.'.length);
      where.push(`json_extract(i.fields_json, '$.' || ?) = ?`);
      params.push(key, v);
    }

    const whereSql = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS c FROM items i WHERE ${whereSql}`).get(...params).c;
    const rows = db
      .prepare(`SELECT i.* FROM items i WHERE ${whereSql} ORDER BY i.${sort} ${dir}, i.id ${dir} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    res.json({ items: rows.map((row) => itemSvc.buildSummary(db, row)), total });
  }));

  // POST /api/items
  r.post('/items', h((req, res) => {
    const b = req.body || {};
    const collectionId = Number(b.collectionId);
    if (!collectionId || !db.prepare('SELECT 1 FROM collections WHERE id = ?').get(collectionId)) {
      throw err.badRequest('valid collectionId is required', 'VALIDATION');
    }
    if (!b.name || typeof b.name !== 'string') throw err.badRequest('name is required', 'VALIDATION');

    const id = db.transaction(() => {
      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO items
           (collection_id, name, status, quantity, min_quantity, acquired_date, acquired_price_cents, acquired_from,
            current_value_cents, value_updated_at, notes, fields_json, created_at, updated_at)
           VALUES (@collection_id, @name, @status, @quantity, @min_quantity, @acquired_date, @acquired_price_cents,
                   @acquired_from, @current_value_cents, @value_updated_at, @notes, @fields_json, @created_at, @updated_at)`
        )
        .run({
          collection_id: collectionId,
          name: b.name,
          status: b.status || 'owned',
          quantity: b.quantity != null ? Number(b.quantity) : 1,
          min_quantity: b.minQuantity != null ? Number(b.minQuantity) : null,
          acquired_date: b.acquiredDate || null,
          acquired_price_cents: b.acquiredPriceCents != null ? Math.round(Number(b.acquiredPriceCents)) : null,
          acquired_from: b.acquiredFrom || null,
          current_value_cents: b.currentValueCents != null ? Math.round(Number(b.currentValueCents)) : null,
          value_updated_at: b.currentValueCents != null ? now : null,
          notes: b.notes || '',
          fields_json: JSON.stringify(cleanFields(b.fields)),
          created_at: now,
          updated_at: now,
        });
      const newId = info.lastInsertRowid;
      if (Array.isArray(b.tags)) itemSvc.setItemTags(db, newId, b.tags);
      itemSvc.syncFts(db, newId);
      return newId;
    })();
    res.status(201).json(fullItem(db, id));
  }));

  // GET /api/items/:id
  r.get('/items/:id', h((req, res) => {
    const item = fullItem(db, Number(req.params.id));
    if (!item) throw err.notFound('item not found');
    res.json(item);
  }));

  // GET /api/items/:id/related — outgoing refs + referencedBy + used_with (§5.2)
  r.get('/items/:id/related', h((req, res) => {
    const out = refSvc.related(db, Number(req.params.id));
    if (!out) throw err.notFound('item not found');
    res.json(out);
  }));

  // PATCH /api/items/:id
  r.patch('/items/:id', h((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!row) throw err.notFound('item not found');
    const b = req.body || {};

    db.transaction(() => {
      const now = new Date().toISOString();
      const set = {};
      for (const [apiKey, col] of Object.entries(CORE_PATCHABLE)) {
        if (b[apiKey] === undefined) continue;
        let val = b[apiKey];
        if (col.endsWith('_cents') && val != null) val = Math.round(Number(val));
        else if ((col === 'quantity' || col === 'min_quantity') && val != null) val = Number(val);
        set[col] = val;
      }
      // currentValueCents change stamps value_updated_at
      if (b.currentValueCents !== undefined) set.value_updated_at = b.currentValueCents == null ? null : now;

      // fields: merge per key; explicit null clears a key
      if (b.fields !== undefined) {
        const current = m.parseJson(row.fields_json, {});
        for (const [k, v] of Object.entries(b.fields || {})) {
          if (v === null) delete current[k];
          else current[k] = v;
        }
        set.fields_json = JSON.stringify(current);
      }

      if (Object.keys(set).length) {
        set.updated_at = now;
        const assign = Object.keys(set).map((k) => `${k} = @${k}`).join(', ');
        db.prepare(`UPDATE items SET ${assign} WHERE id = @id`).run({ ...set, id });
      }
      if (b.tags !== undefined && Array.isArray(b.tags)) itemSvc.setItemTags(db, id, b.tags);
      itemSvc.syncFts(db, id);
    })();
    res.json(fullItem(db, id));
  }));

  // POST /api/items/:id/duplicate — copies core+fields+tags, no photos/logs
  r.post('/items/:id/duplicate', h((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!row) throw err.notFound('item not found');
    const newId = db.transaction(() => {
      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO items
           (collection_id, name, status, quantity, min_quantity, acquired_date, acquired_price_cents, acquired_from,
            current_value_cents, value_updated_at, notes, fields_json, created_at, updated_at)
           SELECT collection_id, name || ' (copy)', status, quantity, min_quantity, acquired_date, acquired_price_cents,
                  acquired_from, current_value_cents, value_updated_at, notes, fields_json, ?, ?
           FROM items WHERE id = ?`
        )
        .run(now, now, id);
      const nid = info.lastInsertRowid;
      const tags = itemSvc.getItemTags(db, id).map((t) => t.name);
      if (tags.length) itemSvc.setItemTags(db, nid, tags);
      itemSvc.syncFts(db, nid);
      return nid;
    })();
    res.status(201).json(fullItem(db, newId));
  }));

  // DELETE /api/items/:id — soft delete; ?permanent=true hard-deletes (files removed)
  r.delete('/items/:id', h((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!row) throw err.notFound('item not found');
    const permanent = req.query.permanent === 'true';
    if (permanent) {
      // gather files to remove before cascade delete
      const photos = db.prepare('SELECT filename FROM photos WHERE item_id = ?').all(id);
      const attachments = db.prepare('SELECT filename FROM attachments WHERE item_id = ?').all(id);
      db.transaction(() => {
        itemSvc.removeFts(db, id);
        db.prepare('DELETE FROM items WHERE id = ?').run(id); // cascades logs/photos/etc
      })();
      for (const p of photos) imageStore.removePhotoFiles(ctx.dataDir, p.filename);
      for (const a of attachments) imageStore.removeAttachmentFile(ctx.dataDir, a.filename);
    } else {
      db.transaction(() => {
        db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), id);
        itemSvc.removeFts(db, id);
      })();
    }
    res.json({ ok: true });
  }));

  // GET /api/trash
  r.get('/trash', h((req, res) => {
    const rows = db.prepare('SELECT * FROM items WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all();
    res.json({ items: rows.map((row) => ({ ...itemSvc.buildSummary(db, row), deletedAt: row.deleted_at })) });
  }));

  // POST /api/items/:id/restore
  r.post('/items/:id/restore', h((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!row) throw err.notFound('item not found');
    db.transaction(() => {
      db.prepare('UPDATE items SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
      itemSvc.syncFts(db, id);
    })();
    res.json(fullItem(db, id));
  }));

  return r;
};

function cleanFields(fields) {
  if (!fields || typeof fields !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function fullItem(db, id) {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!row) return null;
  return itemSvc.buildFull(db, row);
}

module.exports.fullItem = fullItem;
