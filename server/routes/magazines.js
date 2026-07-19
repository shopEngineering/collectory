'use strict';
// Magazines: child records of a firearm item (v1.1 revised design).
// A magazine can hold certain ammunition (holdsAmmoIds) and may be loaded with
// one (loadedWithId + loadedRounds). Loaded state has NO quantity effect on the
// ammo lot — lot quantity means rounds owned wherever stored; only firing
// (range-session linkage, §3) deducts. Deliberate, prevents double-counting.
const express = require('express');
const m = require('../util/mappers');
const err = require('../util/errors');

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Coerce an incoming holdsAmmoIds value to a clean array of positive ints.
function cleanIds(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = function magazinesRouter(ctx) {
  const { db } = ctx;
  const r = express.Router();

  const load = (id) => {
    const row = db.prepare('SELECT * FROM magazines WHERE id = ?').get(id);
    return row ? m.magazineToApi(row) : null;
  };

  // GET /api/items/:id/magazines
  r.get('/items/:id/magazines', h((req, res) => {
    const itemId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId)) throw err.notFound('item not found');
    const rows = db.prepare('SELECT * FROM magazines WHERE item_id = ? ORDER BY sort_order, id').all(itemId);
    res.json({ magazines: rows.map(m.magazineToApi) });
  }));

  // POST /api/items/:id/magazines
  r.post('/items/:id/magazines', h((req, res) => {
    const itemId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId)) throw err.notFound('item not found');
    const b = req.body || {};
    if (!b.name || typeof b.name !== 'string') throw err.badRequest('name is required', 'VALIDATION');
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS s FROM magazines WHERE item_id = ?').get(itemId).s;
    const info = db
      .prepare(
        `INSERT INTO magazines
         (item_id, name, manufacturer, capacity, caliber, quantity, holds_ammo_json, loaded, loaded_with, loaded_rounds, notes, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        itemId,
        b.name.trim(),
        b.manufacturer || '',
        numOrNull(b.capacity),
        b.caliber || '',
        b.quantity != null && Number.isFinite(Number(b.quantity)) ? Number(b.quantity) : 1,
        JSON.stringify(cleanIds(b.holdsAmmoIds)),
        b.loaded ? 1 : 0,
        numOrNull(b.loadedWithId),
        numOrNull(b.loadedRounds),
        b.notes || '',
        b.sortOrder != null ? Number(b.sortOrder) : maxSort + 1
      );
    res.status(201).json(load(info.lastInsertRowid));
  }));

  // PATCH /api/magazines/:id
  r.patch('/magazines/:id', h((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM magazines WHERE id = ?').get(id);
    if (!row) throw err.notFound('magazine not found');
    const b = req.body || {};
    const set = {};
    if (b.name !== undefined) {
      if (!b.name || typeof b.name !== 'string') throw err.badRequest('name cannot be empty', 'VALIDATION');
      set.name = b.name.trim();
    }
    if (b.manufacturer !== undefined) set.manufacturer = String(b.manufacturer || '');
    if (b.capacity !== undefined) set.capacity = numOrNull(b.capacity);
    if (b.caliber !== undefined) set.caliber = String(b.caliber || '');
    if (b.quantity !== undefined) set.quantity = Number.isFinite(Number(b.quantity)) ? Number(b.quantity) : row.quantity;
    if (b.holdsAmmoIds !== undefined) set.holds_ammo_json = JSON.stringify(cleanIds(b.holdsAmmoIds));
    if (b.loaded !== undefined) set.loaded = b.loaded ? 1 : 0;
    if (b.loadedWithId !== undefined) set.loaded_with = numOrNull(b.loadedWithId);
    if (b.loadedRounds !== undefined) set.loaded_rounds = numOrNull(b.loadedRounds);
    if (b.notes !== undefined) set.notes = String(b.notes || '');
    if (b.sortOrder !== undefined) set.sort_order = Number(b.sortOrder);
    if (Object.keys(set).length) {
      const assign = Object.keys(set).map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE magazines SET ${assign} WHERE id = @id`).run({ ...set, id });
    }
    res.json(load(id));
  }));

  // DELETE /api/magazines/:id
  r.delete('/magazines/:id', h((req, res) => {
    const info = db.prepare('DELETE FROM magazines WHERE id = ?').run(Number(req.params.id));
    if (!info.changes) throw err.notFound('magazine not found');
    res.json({ ok: true });
  }));

  return r;
};
