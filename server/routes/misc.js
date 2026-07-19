'use strict';
const express = require('express');
const err = require('../util/errors');
const itemSvc = require('../services/items');
const statsSvc = require('../services/stats');
const refSvc = require('../services/references');

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = function miscRouter(ctx) {
  const { db } = ctx;
  const r = express.Router();

  // GET /api/health
  r.get('/health', (req, res) => res.json({ ok: true, version: ctx.version }));

  // GET /api/search?q= — global FTS with snippet, limit 50
  r.get('/search', h((req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ results: [] });
    const ftsQ = itemSvc.ftsQuery(q);
    let rows;
    if (ftsQ) {
      rows = db
        .prepare(
          `SELECT i.*, snippet(items_fts, -1, '[', ']', '…', 12) AS snip
           FROM items_fts
           JOIN items i ON i.id = items_fts.rowid
           WHERE items_fts MATCH ? AND i.deleted_at IS NULL
           ORDER BY rank LIMIT 50`
        )
        .all(ftsQ);
    } else {
      rows = db
        .prepare(
          `SELECT i.*, i.name AS snip FROM items i
           WHERE i.deleted_at IS NULL AND (i.name LIKE ? OR i.notes LIKE ?)
           ORDER BY i.updated_at DESC LIMIT 50`
        )
        .all(`%${q}%`, `%${q}%`);
    }
    const results = rows.map((row) => {
      const col = db.prepare('SELECT name FROM collections WHERE id = ?').get(row.collection_id);
      return {
        item: itemSvc.buildSummary(db, row),
        collectionName: col ? col.name : '',
        snippet: row.snip || '',
      };
    });
    res.json({ results });
  }));

  // GET /api/stats
  r.get('/stats', h((req, res) => res.json(statsSvc.dashboard(db))));

  // GET /api/item-choices?template=&q=&excludeItemId= — generalized picker source (§5.2)
  r.get('/item-choices', h((req, res) => {
    res.json(
      refSvc.itemChoices(db, {
        template: req.query.template,
        q: req.query.q,
        excludeItemId: req.query.excludeItemId,
      })
    );
  }));

  // GET /api/ammo-choices — alias of item-choices filtered to ammunition.
  // Keeps the legacy shape ({id,name,quantity,caliber?}) plus the richer fields.
  r.get('/ammo-choices', h((req, res) => {
    const choices = refSvc.itemChoices(db, { template: 'ammunition', q: req.query.q });
    res.json(
      choices.map((c) => {
        const out = { ...c };
        if (c.hint != null) out.caliber = c.hint; // backcompat key
        return out;
      })
    );
  }));

  return r;
};
