'use strict';
const express = require('express');
const m = require('../util/mappers');
const err = require('../util/errors');
const colSvc = require('../services/collections');

// asyncH wraps handlers so thrown errors reach the central error middleware.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = function collectionsRouter(ctx) {
  const { db } = ctx;
  const r = express.Router();

  // GET /api/collections — list with aggregates
  r.get('/collections', h((req, res) => {
    const rows = db.prepare('SELECT * FROM collections ORDER BY sort_order, id').all();
    const out = rows.map((row) => {
      const agg = db
        .prepare(
          `SELECT COUNT(*) AS c,
                  COALESCE(SUM(CASE WHEN status IN ('sold','traded','gifted','wishlist') THEN 0
                                    ELSE COALESCE(current_value_cents, acquired_price_cents, 0) END), 0) AS v
           FROM items WHERE collection_id = ? AND deleted_at IS NULL`
        )
        .get(row.id);
      return { ...m.collectionToApi(row), itemCount: agg.c, valueCents: agg.v };
    });
    res.json(out);
  }));

  // POST /api/collections
  r.post('/collections', h((req, res) => {
    const body = req.body || {};
    if (!body.name || typeof body.name !== 'string') throw err.badRequest('name is required', 'VALIDATION');
    if (body.templateKey && !ctx.templates.byKey.has(body.templateKey)) {
      throw err.badRequest(`unknown templateKey: ${body.templateKey}`, 'VALIDATION');
    }
    const id = db.transaction(() => colSvc.createCollection(db, ctx.templates.byKey, body))();
    res.status(201).json(fullCollection(db, id));
  }));

  // GET /api/collections/:id — full
  r.get('/collections/:id', h((req, res) => {
    const full = fullCollection(db, Number(req.params.id));
    if (!full) throw err.notFound('collection not found');
    res.json(full);
  }));

  // PATCH /api/collections/:id
  r.patch('/collections/:id', h((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
    if (!row) throw err.notFound('collection not found');
    const b = req.body || {};
    const fields = {};
    if (b.name != null) fields.name = String(b.name);
    if (b.icon != null) fields.icon = String(b.icon);
    if (b.color != null) fields.color = String(b.color);
    if (b.description != null) fields.description = String(b.description);
    if (b.sortOrder != null) fields.sort_order = Number(b.sortOrder);
    if (Object.keys(fields).length) {
      fields.updated_at = new Date().toISOString();
      const set = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE collections SET ${set} WHERE id = @id`).run({ ...fields, id });
    }
    res.json(fullCollection(db, id));
  }));

  // DELETE /api/collections/:id — 409 unless empty or ?force=true
  r.delete('/collections/:id', h((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT id FROM collections WHERE id = ?').get(id);
    if (!row) throw err.notFound('collection not found');
    const count = db.prepare('SELECT COUNT(*) AS c FROM items WHERE collection_id = ? AND deleted_at IS NULL').get(id).c;
    const force = req.query.force === 'true';
    if (count > 0 && !force) {
      throw err.conflict(`collection has ${count} items; pass ?force=true to soft-delete them`, 'NOT_EMPTY');
    }
    db.transaction(() => {
      if (count > 0) {
        const now = new Date().toISOString();
        const items = db.prepare('SELECT id FROM items WHERE collection_id = ? AND deleted_at IS NULL').all(id);
        for (const it of items) {
          db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(now, it.id);
          require('../services/items').removeFts(db, it.id);
        }
      }
      db.prepare('DELETE FROM collections WHERE id = ?').run(id);
    })();
    res.json({ ok: true });
  }));

  // PUT /api/collections/:id/fields — full replacement, non-destructive to item data
  r.put('/collections/:id/fields', h((req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(id)) throw err.notFound('collection not found');
    const fields = (req.body && req.body.fields) || [];
    if (!Array.isArray(fields)) throw err.badRequest('fields must be an array', 'VALIDATION');
    validateFieldKeys(fields);
    db.transaction(() => {
      db.prepare('DELETE FROM field_defs WHERE collection_id = ?').run(id);
      colSvc.insertFields(db, id, fields);
      db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    })();
    res.json(fullCollection(db, id));
  }));

  // PUT /api/collections/:id/logtypes — full replacement, 'note' cannot be removed
  r.put('/collections/:id/logtypes', h((req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(id)) throw err.notFound('collection not found');
    const logTypes = (req.body && req.body.logTypes) || [];
    if (!Array.isArray(logTypes)) throw err.badRequest('logTypes must be an array', 'VALIDATION');
    validateFieldKeys(logTypes);
    db.transaction(() => {
      db.prepare('DELETE FROM log_types WHERE collection_id = ?').run(id);
      colSvc.insertLogTypes(db, id, logTypes);
      colSvc.ensureNoteLogType(db, id); // note can never be removed
      db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    })();
    res.json(fullCollection(db, id));
  }));

  // GET /api/templates
  r.get('/templates', h((req, res) => {
    res.json(
      ctx.templates.list.map((t) => ({
        key: t.key,
        name: t.name,
        icon: t.icon,
        color: t.color,
        description: t.description,
        fields: t.fields,
        logTypes: t.logTypes,
      }))
    );
  }));

  return r;
};

function validateFieldKeys(arr) {
  const seen = new Set();
  for (const f of arr) {
    if (!f || typeof f.key !== 'string' || !f.key.trim()) throw err.badRequest('each field/logType needs a key', 'VALIDATION');
    if (seen.has(f.key)) throw err.badRequest(`duplicate key: ${f.key}`, 'VALIDATION');
    seen.add(f.key);
  }
}

function fullCollection(db, id) {
  const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  if (!row) return null;
  const fields = db
    .prepare('SELECT * FROM field_defs WHERE collection_id = ? ORDER BY sort_order, id')
    .all(id)
    .map(m.fieldDefToApi);
  const logTypes = db
    .prepare('SELECT * FROM log_types WHERE collection_id = ? ORDER BY sort_order, id')
    .all(id)
    .map(m.logTypeToApi);
  return { ...m.collectionToApi(row), fields, logTypes };
}

module.exports.fullCollection = fullCollection;
