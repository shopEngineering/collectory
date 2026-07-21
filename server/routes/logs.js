'use strict';
const express = require('express');
const m = require('../util/mappers');
const err = require('../util/errors');
const ammo = require('../services/ammo');
const itemSvc = require('../services/items');

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = function logsRouter(ctx) {
  const { db } = ctx;
  const r = express.Router();

  function logPhotos(itemLogId) {
    return db.prepare('SELECT * FROM photos WHERE log_id = ? ORDER BY sort_order, id').all(itemLogId).map(m.photoToApi);
  }

  function loadLog(id) {
    const row = db.prepare('SELECT * FROM logs WHERE id = ?').get(id);
    return row ? m.logToApi(row, logPhotos(id)) : null;
  }

  // GET /api/items/:id/logs — newest first, each with photos[]
  r.get('/items/:id/logs', h((req, res) => {
    const itemId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId)) throw err.notFound('item not found');
    const rows = db.prepare('SELECT * FROM logs WHERE item_id = ? ORDER BY date DESC, id DESC').all(itemId);
    res.json({ logs: rows.map((row) => m.logToApi(row, logPhotos(row.id))) });
  }));

  // POST /api/items/:id/logs — ammo linkage per §3
  r.post('/items/:id/logs', h((req, res) => {
    const itemId = Number(req.params.id);
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
    if (!item) throw err.notFound('item not found');
    const b = req.body || {};
    if (!b.logTypeKey || typeof b.logTypeKey !== 'string') throw err.badRequest('logTypeKey is required', 'VALIDATION');
    if (!b.date || typeof b.date !== 'string') throw err.badRequest('date is required', 'VALIDATION');
    const data = b.data && typeof b.data === 'object' ? b.data : {};

    const id = db.transaction(() => {
      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO logs (item_id, log_type_key, date, title, notes, data_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(itemId, b.logTypeKey, b.date, b.title || '', b.notes || '', JSON.stringify(data), now, now);
      const logId = info.lastInsertRowid;
      const source = db.prepare('SELECT * FROM logs WHERE id = ?').get(logId);

      // Rule 1: quantity effect if this log lives on an ammo item
      ammo.applyQtyEffect(db, itemId, data);

      // Rule 2: auto-create linked usage log on the referenced ammo item.
      // Suppressed when the host is an ammo item or self-referencing (double-count guard).
      const link = ammo.shouldLink(db, data, itemId);
      if (link) ammo.createLinkedUsage(db, source, link);

      return logId;
    })();
    res.status(201).json(loadLog(id));
  }));

  // PATCH /api/logs/:id — apply quantity delta / re-link per §3
  r.patch('/logs/:id', h((req, res) => {
    const id = Number(req.params.id);
    const before = db.prepare('SELECT * FROM logs WHERE id = ?').get(id);
    if (!before) throw err.notFound('log not found');
    const b = req.body || {};

    db.transaction(() => {
      const oldData = m.parseJson(before.data_json, {});
      const newData = b.data !== undefined && b.data && typeof b.data === 'object' ? b.data : oldData;

      // Reverse the old rule-1 effect, then apply the new (net delta approach).
      if (b.data !== undefined) {
        ammo.reverseQtyEffect(db, before.item_id, oldData);
      }

      const now = new Date().toISOString();
      const set = {};
      if (b.date !== undefined) set.date = String(b.date);
      if (b.title !== undefined) set.title = String(b.title || '');
      if (b.notes !== undefined) set.notes = String(b.notes || '');
      if (b.logTypeKey !== undefined) set.log_type_key = String(b.logTypeKey);
      if (b.data !== undefined) set.data_json = JSON.stringify(newData);
      set.updated_at = now;
      const assign = Object.keys(set).map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE logs SET ${assign} WHERE id = @id`).run({ ...set, id });

      if (b.data !== undefined) {
        ammo.applyQtyEffect(db, before.item_id, newData);
      }

      // Re-evaluate rule-2 linkage after the edit.
      reconcileLink(db, id, before, newData, b.data !== undefined);
    })();
    res.json(loadLog(id));
  }));

  // DELETE /api/logs/:id — reverse quantity, delete linked usage per §3
  r.delete('/logs/:id', h((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM logs WHERE id = ?').get(id);
    if (!row) throw err.notFound('log not found');
    db.transaction(() => {
      const data = m.parseJson(row.data_json, {});
      // Delete a linked usage log first (reverses its own quantity effect)
      if (row.linked_log_id) {
        const linked = db.prepare('SELECT * FROM logs WHERE id = ?').get(row.linked_log_id);
        // Only cascade to a genuine usage log we auto-created (source_item_id present)
        if (linked && m.parseJson(linked.data_json, {}).source_item_id != null) {
          ammo.deleteLinkedUsage(db, linked.id);
        }
      }
      // Reverse this log's own rule-1 effect
      ammo.reverseQtyEffect(db, row.item_id, data);
      db.prepare('DELETE FROM logs WHERE id = ?').run(id);
    })();
    res.json({ ok: true });
  }));

  // -------- Provenance --------
  r.get('/items/:id/provenance', h((req, res) => {
    const itemId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId)) throw err.notFound('item not found');
    const rows = db.prepare('SELECT * FROM provenance WHERE item_id = ? ORDER BY sort_order, id').all(itemId);
    res.json({ provenance: rows.map(m.provenanceToApi) });
  }));

  r.post('/items/:id/provenance', h((req, res) => {
    const itemId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId)) throw err.notFound('item not found');
    const b = req.body || {};
    if (!b.ownerName) throw err.badRequest('ownerName is required', 'VALIDATION');
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS s FROM provenance WHERE item_id = ?').get(itemId).s;
    const info = db
      .prepare(
        `INSERT INTO provenance (item_id, owner_name, from_date, to_date, how_acquired, notes, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(itemId, b.ownerName, b.fromDate || null, b.toDate || null, b.howAcquired || '', b.notes || '', b.sortOrder != null ? Number(b.sortOrder) : maxSort + 1);
    res.status(201).json(m.provenanceToApi(db.prepare('SELECT * FROM provenance WHERE id = ?').get(info.lastInsertRowid)));
  }));

  r.patch('/provenance/:id', h((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM provenance WHERE id = ?').get(id);
    if (!row) throw err.notFound('provenance not found');
    const b = req.body || {};
    const map = { ownerName: 'owner_name', fromDate: 'from_date', toDate: 'to_date', howAcquired: 'how_acquired', notes: 'notes', sortOrder: 'sort_order' };
    const set = {};
    for (const [apiKey, col] of Object.entries(map)) if (b[apiKey] !== undefined) set[col] = col === 'sort_order' ? Number(b[apiKey]) : b[apiKey];
    if (Object.keys(set).length) {
      const assign = Object.keys(set).map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE provenance SET ${assign} WHERE id = @id`).run({ ...set, id });
    }
    res.json(m.provenanceToApi(db.prepare('SELECT * FROM provenance WHERE id = ?').get(id)));
  }));

  r.delete('/provenance/:id', h((req, res) => {
    const info = db.prepare('DELETE FROM provenance WHERE id = ?').run(Number(req.params.id));
    if (!info.changes) throw err.notFound('provenance not found');
    res.json({ ok: true });
  }));

  // -------- Valuations --------
  r.get('/items/:id/valuations', h((req, res) => {
    const itemId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId)) throw err.notFound('item not found');
    const rows = db.prepare('SELECT * FROM valuations WHERE item_id = ? ORDER BY date DESC, id DESC').all(itemId);
    res.json({ valuations: rows.map(m.valuationToApi) });
  }));

  r.post('/items/:id/valuations', h((req, res) => {
    const itemId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId)) throw err.notFound('item not found');
    const b = req.body || {};
    if (!b.date) throw err.badRequest('date is required', 'VALIDATION');
    if (b.valueCents == null || !Number.isFinite(Number(b.valueCents))) throw err.badRequest('valueCents is required', 'VALIDATION');
    const valueCents = Math.round(Number(b.valueCents));

    const id = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO valuations (item_id, date, value_cents, source, notes) VALUES (?, ?, ?, ?, ?)')
        .run(itemId, b.date, valueCents, b.source || 'estimate', b.notes || '');
      // Sync item.current_value_cents if this is now the latest by date.
      const latest = db.prepare('SELECT date, value_cents FROM valuations WHERE item_id = ? ORDER BY date DESC, id DESC LIMIT 1').get(itemId);
      if (latest && latest.date <= b.date) {
        db.prepare('UPDATE items SET current_value_cents = ?, value_updated_at = ?, updated_at = ? WHERE id = ?')
          .run(valueCents, b.date, new Date().toISOString(), itemId);
      }
      return info.lastInsertRowid;
    })();
    res.status(201).json(m.valuationToApi(db.prepare('SELECT * FROM valuations WHERE id = ?').get(id)));
  }));

  r.delete('/valuations/:id', h((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM valuations WHERE id = ?').get(id);
    if (!row) throw err.notFound('valuation not found');
    db.transaction(() => {
      db.prepare('DELETE FROM valuations WHERE id = ?').run(id);
      // Re-sync current value to the remaining latest valuation (if any).
      const latest = db.prepare('SELECT value_cents, date FROM valuations WHERE item_id = ? ORDER BY date DESC, id DESC LIMIT 1').get(row.item_id);
      if (latest) {
        db.prepare('UPDATE items SET current_value_cents = ?, value_updated_at = ? WHERE id = ?').run(latest.value_cents, latest.date, row.item_id);
      }
    })();
    res.json({ ok: true });
  }));

  return r;
};

// After editing a source log, reconcile its rule-2 linked usage log.
function reconcileLink(db, sourceId, before, newData, dataChanged) {
  const source = db.prepare('SELECT * FROM logs WHERE id = ?').get(sourceId);
  const link = ammo.shouldLink(db, newData, before.item_id);
  const existingUsageId = before.linked_log_id;
  const existingUsage = existingUsageId ? db.prepare('SELECT * FROM logs WHERE id = ?').get(existingUsageId) : null;
  const existingIsUsage = existingUsage && m.parseJson(existingUsage.data_json, {}).source_item_id != null;

  if (!link) {
    // No longer should be linked -> remove any existing auto usage log
    if (existingIsUsage) {
      ammo.deleteLinkedUsage(db, existingUsage.id);
      db.prepare('UPDATE logs SET linked_log_id = NULL WHERE id = ?').run(sourceId);
    }
    return;
  }

  if (existingIsUsage) {
    // Update existing usage log: reverse old effect, retarget/adjust, apply new.
    const oldUsageData = m.parseJson(existingUsage.data_json, {});
    ammo.reverseQtyEffect(db, existingUsage.item_id, oldUsageData);
    if (existingUsage.item_id !== link.ammoItemId) {
      // ammo item changed: move the usage log to the new item
      db.prepare('DELETE FROM logs WHERE id = ?').run(existingUsage.id);
      ammo.createLinkedUsage(db, source, link);
    } else {
      const newUsageData = { rounds_used: link.roundsFired, source_item_id: source.item_id };
      db.prepare('UPDATE logs SET data_json = ?, date = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(newUsageData), source.date, new Date().toISOString(), existingUsage.id);
      ammo.applyQtyEffect(db, existingUsage.item_id, newUsageData);
    }
  } else {
    // No existing usage log -> create one
    ammo.createLinkedUsage(db, source, link);
  }
}
