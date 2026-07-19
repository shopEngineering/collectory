'use strict';
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const imageStore = require('./imageStore');

// Create a backup zip at destZipPath containing: a consistent db snapshot (via
// better-sqlite3 .backup()), images/, attachments/, and meta.json.
// Returns a Promise (the .backup() API is async).
async function createBackupZip(db, dataDir, version, destZipPath) {
  const d = imageStore.ensureDirs(dataDir);
  const snapPath = path.join(d.tmp, `snapshot-${imageStore.uuid()}.db`);
  await db.backup(snapPath); // consistent online snapshot

  const zip = new AdmZip();
  zip.addLocalFile(snapPath, '', 'collectory.db');
  addDirIfExists(zip, path.join(dataDir, 'images', 'orig'), 'images/orig');
  addDirIfExists(zip, path.join(dataDir, 'images', 'thumb'), 'images/thumb');
  addDirIfExists(zip, path.join(dataDir, 'attachments'), 'attachments');
  const meta = { app: 'collectory', version, exportedAt: new Date().toISOString() };
  zip.addFile('meta.json', Buffer.from(JSON.stringify(meta, null, 2)));

  zip.writeZip(destZipPath);
  imageStore.safeUnlink(snapPath);
  return destZipPath;
}

function addDirIfExists(zip, dirPath, zipFolder) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath);
  for (const name of entries) {
    const full = path.join(dirPath, name);
    if (fs.statSync(full).isFile()) zip.addLocalFile(full, zipFolder);
  }
}

// Auto-backup rotation: if newest auto-backup is >24h old (or none), write one and
// keep the newest 10. Called async after listen.
async function maybeAutoBackup(db, dataDir, version) {
  const d = imageStore.ensureDirs(dataDir);
  const autoDir = d.autoBackups;
  const files = fs
    .readdirSync(autoDir)
    .filter((f) => f.startsWith('collectory-auto-') && f.endsWith('.zip'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(autoDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const newest = files[0];
  const dayMs = 24 * 60 * 60 * 1000;
  if (newest && Date.now() - newest.mtime < dayMs) return null;

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/(\d{8})(\d{6})/, '$1-$2');
  const dest = path.join(autoDir, `collectory-auto-${stamp}.zip`);
  await createBackupZip(db, dataDir, version, dest);

  // rotate: keep newest 10
  const after = fs
    .readdirSync(autoDir)
    .filter((f) => f.startsWith('collectory-auto-') && f.endsWith('.zip'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(autoDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const extra of after.slice(10)) imageStore.safeUnlink(path.join(autoDir, extra.f));
  return dest;
}

// Validate a restore zip's meta.json (must be a collectory backup with a db).
function validateRestoreZip(zipPath) {
  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch (e) {
    return { ok: false, message: `not a valid zip: ${e.message}` };
  }
  const entries = zip.getEntries();
  const names = new Set(entries.map((e) => e.entryName));
  if (!names.has('meta.json')) return { ok: false, message: 'missing meta.json — not a Collectory backup' };
  if (!names.has('collectory.db')) return { ok: false, message: 'missing collectory.db in backup' };
  let meta;
  try {
    meta = JSON.parse(zip.readAsText('meta.json'));
  } catch {
    return { ok: false, message: 'meta.json is not valid JSON' };
  }
  if (meta.app !== 'collectory') return { ok: false, message: 'meta.app is not "collectory"' };
  return { ok: true, zip, meta };
}

// Extract a validated restore zip into dataDir, replacing db + images + attachments.
// Caller must have already closed the live db connection.
function applyRestore(zip, dataDir) {
  imageStore.ensureDirs(dataDir);
  // Clear existing media dirs (db is replaced wholesale).
  clearDir(path.join(dataDir, 'images', 'orig'));
  clearDir(path.join(dataDir, 'images', 'thumb'));
  clearDir(path.join(dataDir, 'attachments'));
  // Remove WAL/SHM sidecars so the restored db is authoritative.
  imageStore.safeUnlink(path.join(dataDir, 'collectory.db-wal'));
  imageStore.safeUnlink(path.join(dataDir, 'collectory.db-shm'));

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    if (name === 'meta.json') continue;
    let dest;
    if (name === 'collectory.db') dest = path.join(dataDir, 'collectory.db');
    else if (name.startsWith('images/orig/')) dest = path.join(dataDir, 'images', 'orig', path.basename(name));
    else if (name.startsWith('images/thumb/')) dest = path.join(dataDir, 'images', 'thumb', path.basename(name));
    else if (name.startsWith('attachments/')) dest = path.join(dataDir, 'attachments', path.basename(name));
    else continue;
    fs.writeFileSync(dest, entry.getData());
  }
}

function clearDir(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const name of fs.readdirSync(dirPath)) {
    const full = path.join(dirPath, name);
    if (fs.statSync(full).isFile()) imageStore.safeUnlink(full);
  }
}

module.exports = { createBackupZip, maybeAutoBackup, validateRestoreZip, applyRestore };
