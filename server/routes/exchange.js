'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const err = require('../util/errors');
const imageStore = require('../services/imageStore');
const csv = require('../services/csv');
const colSvc = require('../services/collections');

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = function exchangeRouter(ctx) {
  const { db, dataDir } = ctx;
  const r = express.Router();
  const csvUpload = imageStore.makeUploader(dataDir, 25 * 1024 * 1024).single('file');

  // GET /api/export/csv?collectionId=
  r.get('/export/csv', h((req, res) => {
    const collectionId = Number(req.query.collectionId);
    const col = db.prepare('SELECT name FROM collections WHERE id = ?').get(collectionId);
    if (!col) throw err.badRequest('valid collectionId is required', 'VALIDATION');
    const csvText = csv.exportCollection(db, collectionId);
    const safe = col.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safe || 'collection'}.csv"`);
    res.send(csvText);
  }));

  // GET /api/export/json — full-fidelity dump of all tables
  r.get('/export/json', h((req, res) => {
    const tables = ['collections', 'field_defs', 'log_types', 'items', 'logs', 'photos', 'provenance', 'valuations', 'attachments', 'tags', 'item_tags', 'settings'];
    const dump = { app: 'collectory', version: ctx.version, exportedAt: new Date().toISOString(), tables: {} };
    for (const t of tables) {
      // Don't leak secrets in a portability export
      if (t === 'settings') {
        dump.tables[t] = db.prepare("SELECT key, value FROM settings WHERE key NOT IN ('cookie_secret', 'lan_pin_hash')").all();
      } else {
        dump.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
      }
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="collectory-export.json"');
    res.send(JSON.stringify(dump, null, 2));
  }));

  // POST /api/import/csv/preview — multipart 'file'
  r.post('/import/csv/preview', csvUpload, h((req, res) => {
    if (!req.file) throw err.badRequest("missing 'file' part", 'VALIDATION');
    const text = fs.readFileSync(req.file.path, 'utf8');
    const { headers, rows } = csv.parseCsv(text);
    if (!headers.length) {
      imageStore.safeUnlink(req.file.path);
      throw err.badRequest('CSV has no header row', 'VALIDATION');
    }
    // Cache parsed upload keyed by token in <dataDir>/tmp; reuse the uploaded file name as token.
    const token = imageStore.uuid();
    const cachePath = path.join(imageStore.dirs(dataDir).tmp, `import-${token}.json`);
    fs.writeFileSync(cachePath, JSON.stringify({ headers, rows }));
    imageStore.safeUnlink(req.file.path);

    // Suggested mapping is per-collection if collectionId provided; else core-only.
    const collectionId = Number(req.query.collectionId) || null;
    const fieldDefs = collectionId ? db.prepare('SELECT key, label FROM field_defs WHERE collection_id = ?').all(collectionId) : [];
    const suggestedMapping = csv.suggestMapping(headers, fieldDefs);

    res.json({ token, headers, sampleRows: rows.slice(0, 5), suggestedMapping });
  }));

  // POST /api/import/csv/commit — {token, collectionId, mapping}
  r.post('/import/csv/commit', h((req, res) => {
    const { token, collectionId, mapping } = req.body || {};
    if (!token) throw err.badRequest('token is required', 'VALIDATION');
    const cid = Number(collectionId);
    if (!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(cid)) throw err.badRequest('valid collectionId is required', 'VALIDATION');
    const cachePath = path.join(imageStore.dirs(dataDir).tmp, `import-${token}.json`);
    if (!fs.existsSync(cachePath)) throw err.badRequest('import token expired or invalid — re-upload', 'TOKEN_INVALID');
    const { headers, rows } = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

    const ensureFieldDef = (collectionIdArg, headerName, type) => {
      // Create a field def from the header name; return the key used.
      const key = headerName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || `field_${imageStore.uuid().slice(0, 6)}`;
      const existing = db.prepare('SELECT key FROM field_defs WHERE collection_id = ? AND key = ?').get(collectionIdArg, key);
      if (existing) return existing.key;
      const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS s FROM field_defs WHERE collection_id = ?').get(collectionIdArg).s;
      colSvc.insertFields(db, collectionIdArg, [{ key, label: headerName, type, sortOrder: maxSort + 1 }]);
      return key;
    };

    const result = db.transaction(() => csv.commitImport(db, cid, headers, rows, mapping || {}, ensureFieldDef))();
    imageStore.safeUnlink(cachePath);
    res.json(result);
  }));

  return r;
};
