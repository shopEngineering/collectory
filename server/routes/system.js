'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const err = require('../util/errors');
const settingsSvc = require('../services/settings');
const backupSvc = require('../services/backup');
const imageStore = require('../services/imageStore');

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// simple in-memory PIN rate limiter
const pinAttempts = new Map(); // ip -> {count, ts}
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const rec = pinAttempts.get(ip);
  if (!rec || now - rec.ts > windowMs) {
    pinAttempts.set(ip, { count: 1, ts: now });
    return false;
  }
  rec.count++;
  return rec.count > 10;
}

module.exports = function systemRouter(ctx) {
  const r = express.Router();
  const qrcode = require('qrcode');
  const zipUpload = imageStore.makeUploader(ctx.dataDir, imageStore.ZIP_LIMIT).single('file');

  // GET /api/settings
  r.get('/settings', h(async (req, res) => {
    const db = ctx.db;
    const port = Number(settingsSvc.get(db, 'port')) || ctx.port || 7117;
    const urls = settingsSvc.lanUrls(port);
    let qrDataUrl = null;
    if (urls.length) {
      try {
        qrDataUrl = await qrcode.toDataURL(urls[0], { margin: 1, width: 240 });
      } catch {
        qrDataUrl = null;
      }
    }
    res.json({
      lanEnabled: settingsSvc.get(db, 'lan_enabled') === '1',
      lanPinSet: !!settingsSvc.get(db, 'lan_pin_hash'),
      currency: settingsSvc.get(db, 'currency'),
      theme: settingsSvc.get(db, 'theme'),
      port,
      dataDir: ctx.dataDir,
      version: ctx.version,
      reportOwner: settingsSvc.get(db, 'report_owner') || '',
      lanUrls: urls,
      qrDataUrl,
    });
  }));

  // PATCH /api/settings
  r.patch('/settings', h((req, res) => {
    const db = ctx.db;
    const b = req.body || {};
    if (b.lanEnabled !== undefined) settingsSvc.set(db, 'lan_enabled', b.lanEnabled ? '1' : '0');
    if (b.currency !== undefined) settingsSvc.set(db, 'currency', String(b.currency));
    if (b.theme !== undefined) settingsSvc.set(db, 'theme', String(b.theme));
    if (b.reportOwner !== undefined) settingsSvc.set(db, 'report_owner', String(b.reportOwner));
    if (b.lanPin !== undefined) {
      if (b.lanPin === '' || b.lanPin === null) settingsSvc.del(db, 'lan_pin_hash');
      else settingsSvc.set(db, 'lan_pin_hash', settingsSvc.hashPin(b.lanPin));
    }
    res.json({ ok: true });
  }));

  // POST /api/auth/pin — {pin} -> signed httpOnly cookie (30 days)
  r.post('/auth/pin', h((req, res) => {
    const db = ctx.db;
    const ip = req.ip || 'unknown';
    if (rateLimited(ip)) throw err.badRequest('too many attempts; wait a minute', 'RATE_LIMITED');
    const pin = req.body && req.body.pin;
    const hash = settingsSvc.get(db, 'lan_pin_hash');
    if (!hash) throw err.badRequest('no PIN is set', 'NO_PIN');
    if (!pin || settingsSvc.hashPin(pin) !== hash) throw err.unauthorized('incorrect PIN', 'BAD_PIN');
    res.cookie('collectory_pin', '1', {
      httpOnly: true,
      signed: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });
    res.json({ ok: true });
  }));

  // GET /api/backup — zip download
  r.get('/backup', h(async (req, res) => {
    const d = imageStore.ensureDirs(ctx.dataDir);
    const tmpZip = path.join(d.tmp, `manual-backup-${imageStore.uuid()}.zip`);
    await backupSvc.createBackupZip(ctx.db, ctx.dataDir, ctx.version, tmpZip);
    const stamp = new Date().toISOString().slice(0, 10);
    res.download(tmpZip, `collectory-backup-${stamp}.zip`, (e) => {
      imageStore.safeUnlink(tmpZip);
    });
  }));

  // POST /api/restore — multipart zip; safety zip first; hot-swap db
  r.post('/restore', zipUpload, h(async (req, res) => {
    if (!req.file) throw err.badRequest("missing 'file' part", 'VALIDATION');
    const zipPath = req.file.path;
    const check = backupSvc.validateRestoreZip(zipPath);
    if (!check.ok) {
      imageStore.safeUnlink(zipPath);
      throw err.badRequest(`invalid backup: ${check.message}`, 'BAD_BACKUP');
    }

    const d = imageStore.ensureDirs(ctx.dataDir);
    // 1. Safety zip of current data BEFORE any destructive change (the archive was
    //    already validated above, so we don't start destroying until we're sure it's good).
    const safetyPath = path.join(d.backups, `pre-restore-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}.zip`);
    await backupSvc.createBackupZip(ctx.db, ctx.dataDir, ctx.version, safetyPath);

    // 2. Close live connection, replace files, reopen + re-run migrations. If ANY
    //    step fails mid-swap, auto-restore from the safety zip so live data survives.
    ctx.closeDb();
    try {
      backupSvc.applyRestore(check.zip, ctx.dataDir);
      ctx.reopenDb();
    } catch (e) {
      // Roll back: re-apply the pre-restore safety zip, then reopen.
      try {
        const safety = backupSvc.validateRestoreZip(safetyPath);
        if (safety.ok) backupSvc.applyRestore(safety.zip, ctx.dataDir);
      } catch {
        /* best effort — reopen below regardless so the process keeps serving */
      }
      try {
        ctx.reopenDb();
      } catch {
        /* leave closed; a subsequent request/restart recovers */
      }
      imageStore.safeUnlink(zipPath);
      throw err.badRequest(
        `restore failed and live data was rolled back from the safety backup: ${e.message}`,
        'RESTORE_FAILED'
      );
    }

    imageStore.safeUnlink(zipPath);
    res.json({ ok: true, safetyBackup: path.basename(safetyPath) });
  }));

  return r;
};
