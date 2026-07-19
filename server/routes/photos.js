'use strict';
const express = require('express');
const m = require('../util/mappers');
const err = require('../util/errors');
const imageStore = require('../services/imageStore');
const itemSvc = require('../services/items');

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = function photosRouter(ctx) {
  const { db, dataDir } = ctx;
  const r = express.Router();

  const photoUpload = imageStore
    .makeUploader(dataDir, imageStore.PHOTO_LIMIT)
    .fields([{ name: 'photo', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]);
  const fileUpload = imageStore.makeUploader(dataDir, imageStore.ATTACH_LIMIT).single('file');

  function storePhoto(ownerCol, ownerId, req) {
    const files = req.files || {};
    const photoFile = files.photo && files.photo[0];
    const thumbFile = files.thumb && files.thumb[0];
    if (!photoFile) throw err.badRequest("missing 'photo' file part", 'VALIDATION');
    const filename = imageStore.storeOriginal(dataDir, photoFile.path, photoFile.originalname);
    imageStore.storeThumb(dataDir, filename, thumbFile ? thumbFile.path : null);
    const now = new Date().toISOString();
    const maxSort = db
      .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS s FROM photos WHERE ${ownerCol} = ?`)
      .get(ownerId).s;
    const info = db
      .prepare(
        `INSERT INTO photos (${ownerCol}, filename, original_name, width, height, size_bytes, caption, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ownerId,
        filename,
        photoFile.originalname || null,
        req.body.width != null ? Number(req.body.width) : null,
        req.body.height != null ? Number(req.body.height) : null,
        photoFile.size || null,
        req.body.caption || '',
        maxSort + 1,
        now
      );
    return db.prepare('SELECT * FROM photos WHERE id = ?').get(info.lastInsertRowid);
  }

  // POST /api/items/:id/photos
  r.post('/items/:id/photos', photoUpload, h((req, res) => {
    const itemId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId)) throw err.notFound('item not found');
    const photo = db.transaction(() => {
      const p = storePhoto('item_id', itemId, req);
      // First photo becomes cover if none set
      const item = db.prepare('SELECT cover_photo_id FROM items WHERE id = ?').get(itemId);
      if (!item.cover_photo_id) db.prepare('UPDATE items SET cover_photo_id = ? WHERE id = ?').run(p.id, itemId);
      itemSvc.syncFts(db, itemId);
      return p;
    })();
    res.status(201).json(m.photoToApi(photo));
  }));

  // POST /api/logs/:id/photos
  r.post('/logs/:id/photos', photoUpload, h((req, res) => {
    const logId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM logs WHERE id = ?').get(logId)) throw err.notFound('log not found');
    const photo = db.transaction(() => storePhoto('log_id', logId, req))();
    res.status(201).json(m.photoToApi(photo));
  }));

  // PATCH /api/photos/:id — caption, sortOrder
  r.patch('/photos/:id', h((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
    if (!row) throw err.notFound('photo not found');
    const b = req.body || {};
    const set = {};
    if (b.caption !== undefined) set.caption = String(b.caption || '');
    if (b.sortOrder !== undefined) set.sort_order = Number(b.sortOrder);
    if (Object.keys(set).length) {
      const assign = Object.keys(set).map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE photos SET ${assign} WHERE id = @id`).run({ ...set, id });
    }
    res.json(m.photoToApi(db.prepare('SELECT * FROM photos WHERE id = ?').get(id)));
  }));

  // POST /api/items/:id/cover — {photoId}
  r.post('/items/:id/cover', h((req, res) => {
    const itemId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId)) throw err.notFound('item not found');
    const photoId = Number(req.body && req.body.photoId);
    const photo = db.prepare('SELECT id FROM photos WHERE id = ? AND item_id = ?').get(photoId, itemId);
    if (!photo) throw err.badRequest('photoId must reference a photo on this item', 'VALIDATION');
    db.prepare('UPDATE items SET cover_photo_id = ?, updated_at = ? WHERE id = ?').run(photoId, new Date().toISOString(), itemId);
    res.json({ ok: true, coverPhotoId: photoId });
  }));

  // DELETE /api/photos/:id — remove files; reassign cover if needed
  r.delete('/photos/:id', h((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
    if (!row) throw err.notFound('photo not found');
    db.transaction(() => {
      db.prepare('DELETE FROM photos WHERE id = ?').run(id);
      if (row.item_id) {
        const item = db.prepare('SELECT cover_photo_id FROM items WHERE id = ?').get(row.item_id);
        if (item && item.cover_photo_id === id) {
          const next = db.prepare('SELECT id FROM photos WHERE item_id = ? ORDER BY sort_order, id LIMIT 1').get(row.item_id);
          db.prepare('UPDATE items SET cover_photo_id = ? WHERE id = ?').run(next ? next.id : null, row.item_id);
        }
      }
    })();
    imageStore.removePhotoFiles(dataDir, row.filename);
    res.json({ ok: true });
  }));

  // POST /api/items/:id/attachments — part 'file'
  r.post('/items/:id/attachments', fileUpload, h((req, res) => {
    const itemId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId)) throw err.notFound('item not found');
    if (!req.file) throw err.badRequest("missing 'file' part", 'VALIDATION');
    const filename = imageStore.storeAttachment(dataDir, req.file.path, req.file.originalname);
    const info = db
      .prepare(
        `INSERT INTO attachments (item_id, filename, original_name, mime, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(itemId, filename, req.file.originalname, req.file.mimetype || null, req.file.size || null, new Date().toISOString());
    res.status(201).json(m.attachmentToApi(db.prepare('SELECT * FROM attachments WHERE id = ?').get(info.lastInsertRowid)));
  }));

  // GET /api/items/:id/attachments
  r.get('/items/:id/attachments', h((req, res) => {
    const itemId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId)) throw err.notFound('item not found');
    const rows = db.prepare('SELECT * FROM attachments WHERE item_id = ? ORDER BY id').all(itemId);
    res.json({ attachments: rows.map(m.attachmentToApi) });
  }));

  // DELETE /api/attachments/:id
  r.delete('/attachments/:id', h((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
    if (!row) throw err.notFound('attachment not found');
    db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    imageStore.removeAttachmentFile(dataDir, row.filename);
    res.json({ ok: true });
  }));

  return r;
};
