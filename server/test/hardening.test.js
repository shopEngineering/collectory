'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const request = require('supertest');
const { freshApp, cleanup } = require('./helpers');
const backupSvc = require('../services/backup');

// --- H6: upload rejection of active-content types + hardened serving headers ---

test('H6: photo upload rejects SVG (active content)', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'C' })).body;
  const item = (await request(app).post('/api/items').send({ collectionId: col.id, name: 'I' })).body;

  const res = await request(app)
    .post(`/api/items/${item.id}/photos`)
    .attach('photo', Buffer.from('<svg onload="alert(1)"></svg>'), { filename: 'x.svg', contentType: 'image/svg+xml' });
  assert.strictEqual(res.status, 400, JSON.stringify(res.body));
  assert.strictEqual(res.body.error.code, 'BAD_UPLOAD');
  // Nothing should have landed on disk.
  assert.strictEqual(fs.readdirSync(path.join(dataDir, 'images', 'orig')).length, 0, 'no original stored');
});

test('H6: attachment upload rejects HTML (and svg by extension)', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'C' })).body;
  const item = (await request(app).post('/api/items').send({ collectionId: col.id, name: 'I' })).body;

  const html = await request(app)
    .post(`/api/items/${item.id}/attachments`)
    .attach('file', Buffer.from('<script>fetch("/api/export/json")</script>'), { filename: 'evil.html', contentType: 'text/html' });
  assert.strictEqual(html.status, 400, JSON.stringify(html.body));
  assert.strictEqual(html.body.error.code, 'BAD_UPLOAD');

  // Rejected by extension even if the mime is lied about.
  const svg = await request(app)
    .post(`/api/items/${item.id}/attachments`)
    .attach('file', Buffer.from('<svg/>'), { filename: 'sneaky.svg', contentType: 'application/octet-stream' });
  assert.strictEqual(svg.status, 400);
  assert.strictEqual(fs.readdirSync(path.join(dataDir, 'attachments')).length, 0, 'no attachment stored');
});

test('H6: attachments serve as download with nosniff (not inline)', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'C' })).body;
  const item = (await request(app).post('/api/items').send({ collectionId: col.id, name: 'I' })).body;
  const att = (await request(app).post(`/api/items/${item.id}/attachments`).attach('file', Buffer.from('%PDF-1.4'), 'receipt.pdf')).body;

  const res = await request(app).get(att.url);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['content-disposition'], /^attachment/, 'forced download, not inline');
  assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
});

// --- H2: restore is crash-safe. A validated-but-doomed swap must roll back from
// the safety zip and leave live data intact; a bogus/incomplete zip is rejected
// before any destruction. ---

test('H2: restoring a bogus zip (missing meta.version) is rejected and live data is intact', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'Live' })).body;
  await request(app).post('/api/items').send({ collectionId: col.id, name: 'Keep me' });

  // A zip that has meta.json + collectory.db but NO version field — must fail validation.
  const bad = new AdmZip();
  bad.addFile('meta.json', Buffer.from(JSON.stringify({ app: 'collectory' }))); // no version
  bad.addFile('collectory.db', Buffer.from('not a real db'));
  const badPath = path.join(dataDir, 'noversion.zip');
  bad.writeZip(badPath);

  const res = await request(app).post('/api/restore').attach('file', badPath);
  assert.strictEqual(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error.message, /invalid backup|meta\.version/i);

  // Live data untouched — nothing was destroyed.
  const list = await request(app).get(`/api/collections/${col.id}/items`);
  assert.strictEqual(list.body.total, 1, 'live data intact after rejected restore');
});

test('H2: a failure DURING the swap auto-restores from the safety zip (live data survives)', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'Live' })).body;
  await request(app).post('/api/items').send({ collectionId: col.id, name: 'A' });
  await request(app).post('/api/items').send({ collectionId: col.id, name: 'B' });

  // A perfectly valid backup of a DIFFERENT state (single item), used as the restore source.
  const srcPath = path.join(dataDir, 'valid-src.zip');
  await backupSvc.createBackupZip(ctx.db, dataDir, ctx.version, srcPath);

  // Force applyRestore to throw AFTER it has begun destroying the live media dirs,
  // simulating a mid-swap crash. The route must roll back from the safety zip.
  const real = backupSvc.applyRestore;
  let calls = 0;
  backupSvc.applyRestore = (zip, dir) => {
    calls++;
    if (calls === 1) {
      // Emulate a partial destructive step then a crash.
      real(zip, dir); // actually apply (destroys+writes)
      throw new Error('simulated mid-swap failure');
    }
    return real(zip, dir); // rollback pass applies the safety zip cleanly
  };
  t.after(() => { backupSvc.applyRestore = real; });

  const res = await request(app).post('/api/restore').attach('file', srcPath);
  assert.strictEqual(res.status, 400, JSON.stringify(res.body));
  assert.strictEqual(res.body.error.code, 'RESTORE_FAILED');
  assert.ok(calls >= 2, 'rollback pass ran');

  // Live data must still be the 2-item state (rolled back from the safety zip).
  const list = await request(app).get(`/api/collections/${col.id}/items`);
  assert.strictEqual(list.body.total, 2, 'live data rolled back to pre-restore state');
});

// --- Medium: malformed numeric input -> 400 (not a 500 from a NaN bind) ---

test('malformed numeric input (quantity: "abc") returns 400 VALIDATION, not 500', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'C' })).body;

  const bad = await request(app).post('/api/items').send({ collectionId: col.id, name: 'X', quantity: 'abc' });
  assert.strictEqual(bad.status, 400, JSON.stringify(bad.body));
  assert.strictEqual(bad.body.error.code, 'VALIDATION');

  const item = (await request(app).post('/api/items').send({ collectionId: col.id, name: 'Y' })).body;
  const badPatch = await request(app).patch(`/api/items/${item.id}`).send({ quantity: 'nope' });
  assert.strictEqual(badPatch.status, 400);
  assert.strictEqual(badPatch.body.error.code, 'VALIDATION');
});

// --- Medium: SQLite constraint violation -> 409/400, not 500 ---

test('SQLite constraint errors are classified: UNIQUE/PK -> 409, others -> 400 (via a REAL error object)', (t) => {
  const errors = require('../util/errors');
  const { dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);

  // Produce a REAL better-sqlite3 SqliteError by tripping tags.name UNIQUE directly.
  ctx.db.prepare("INSERT INTO tags (name, color) VALUES ('dupe', '#000')").run();
  let uniqueErr;
  try {
    ctx.db.prepare("INSERT INTO tags (name, color) VALUES ('dupe', '#111')").run();
  } catch (e) {
    uniqueErr = e;
  }
  assert.ok(uniqueErr && String(uniqueErr.code).startsWith('SQLITE_CONSTRAINT'), 'got a real SqliteError');
  const mappedUnique = errors.fromSqlite(uniqueErr);
  assert.ok(mappedUnique, 'UNIQUE error is mapped');
  assert.strictEqual(mappedUnique.status, 409);
  assert.strictEqual(mappedUnique.code, 'CONFLICT');

  // A NOT NULL / FK violation maps to 400 CONSTRAINT.
  let fkErr;
  try {
    // item_tags.tag_id references tags(id); a nonexistent tag_id trips the FK.
    ctx.db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (999999, 888888)').run();
  } catch (e) {
    fkErr = e;
  }
  assert.ok(fkErr && String(fkErr.code).startsWith('SQLITE_CONSTRAINT'), 'got a real FK SqliteError');
  const mappedFk = errors.fromSqlite(fkErr);
  assert.strictEqual(mappedFk.status, 400);
  assert.strictEqual(mappedFk.code, 'CONSTRAINT');

  // Non-constraint errors are not mapped (fall through to 500).
  assert.strictEqual(errors.fromSqlite(new Error('boom')), null);
});
