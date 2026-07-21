'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// File storage for photos and attachments. Filenames are always server-generated
// UUIDs; original names are kept only as metadata. Uploads land in <dataDir>/tmp
// (multer) then are moved into images/orig, images/thumb, or attachments.

const PHOTO_LIMIT = 50 * 1024 * 1024; // 50 MB (DESIGN.md §8)
const ATTACH_LIMIT = 50 * 1024 * 1024;
const ZIP_LIMIT = 100 * 1024 * 1024; // 100 MB restore zip

function dirs(dataDir) {
  return {
    orig: path.join(dataDir, 'images', 'orig'),
    thumb: path.join(dataDir, 'images', 'thumb'),
    attachments: path.join(dataDir, 'attachments'),
    tmp: path.join(dataDir, 'tmp'),
    backups: path.join(dataDir, 'backups'),
    autoBackups: path.join(dataDir, 'backups', 'auto'),
  };
}

function ensureDirs(dataDir) {
  const d = dirs(dataDir);
  for (const p of Object.values(d)) fs.mkdirSync(p, { recursive: true });
  return d;
}

function uuid() {
  return crypto.randomUUID();
}

function extOf(name, fallback) {
  const e = path.extname(name || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
  return e || fallback || '';
}

// Reject file types that can execute script when served (SVG/HTML/XML). Even with
// nosniff + download disposition on the serving side, we refuse these at intake so
// a planted active-content file never lands in the library (H6, defense in depth).
const DANGEROUS_MIME = /(^text\/html$|^application\/xhtml\+xml$|svg|xml|^text\/xml$)/i;
const DANGEROUS_EXT = /\.(svg|svgz|html?|xhtml|xml)$/i;
function isDangerousUpload(originalName, mime) {
  if (mime && DANGEROUS_MIME.test(String(mime))) return true;
  if (originalName && DANGEROUS_EXT.test(String(originalName))) return true;
  return false;
}

// multer instances writing to <dataDir>/tmp
function makeUploader(dataDir, limitBytes) {
  const d = ensureDirs(dataDir);
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, d.tmp),
    filename: (req, file, cb) => cb(null, `${uuid()}${extOf(file.originalname)}`),
  });
  return multer({ storage, limits: { fileSize: limitBytes } });
}

// Move a temp upload into images/orig, returning the stored filename (uuid.ext).
function storeOriginal(dataDir, tempPath, originalName) {
  const d = ensureDirs(dataDir);
  const ext = extOf(originalName, '.jpg');
  const filename = `${uuid()}${ext}`;
  fs.renameSync(tempPath, path.join(d.orig, filename));
  return filename;
}

// Store a thumbnail. If a client thumb temp file is given, move it; else copy the
// original. Thumb filename is always <sameUuidBase>.jpg.
function storeThumb(dataDir, origFilename, thumbTempPath) {
  const d = ensureDirs(dataDir);
  const base = origFilename.replace(/\.[^.]+$/, '');
  const thumbName = `${base}.jpg`;
  const dest = path.join(d.thumb, thumbName);
  if (thumbTempPath && fs.existsSync(thumbTempPath)) {
    fs.renameSync(thumbTempPath, dest);
  } else {
    fs.copyFileSync(path.join(d.orig, origFilename), dest);
  }
  return thumbName;
}

function storeAttachment(dataDir, tempPath, originalName) {
  const d = ensureDirs(dataDir);
  const ext = extOf(originalName, '');
  const filename = `${uuid()}${ext}`;
  fs.renameSync(tempPath, path.join(d.attachments, filename));
  return filename;
}

function removePhotoFiles(dataDir, filename) {
  const d = dirs(dataDir);
  const base = filename.replace(/\.[^.]+$/, '');
  safeUnlink(path.join(d.orig, filename));
  safeUnlink(path.join(d.thumb, `${base}.jpg`));
}

function removeAttachmentFile(dataDir, filename) {
  safeUnlink(path.join(dirs(dataDir).attachments, filename));
}

function safeUnlink(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    /* already gone */
  }
}

module.exports = {
  PHOTO_LIMIT,
  ATTACH_LIMIT,
  ZIP_LIMIT,
  dirs,
  ensureDirs,
  uuid,
  extOf,
  isDangerousUpload,
  makeUploader,
  storeOriginal,
  storeThumb,
  storeAttachment,
  removePhotoFiles,
  removeAttachmentFile,
  safeUnlink,
};
