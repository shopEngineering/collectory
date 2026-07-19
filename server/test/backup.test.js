'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const request = require('supertest');
const { freshApp, cleanup } = require('./helpers');
const backupSvc = require('../services/backup');

test('backup endpoint returns a zip containing db, meta.json, and images', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'Coins', templateKey: 'coins' })).body;
  const item = (await request(app).post('/api/items').send({ collectionId: col.id, name: 'Morgan Dollar' })).body;
  // add a photo so images/ is populated
  await request(app)
    .post(`/api/items/${item.id}/photos`)
    .attach('photo', Buffer.from('fake-jpeg-bytes'), 'coin.jpg');

  const res = await request(app).get('/api/backup').buffer().parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.strictEqual(res.status, 200);
  const zipPath = path.join(os.tmpdir(), `test-backup-${Date.now()}.zip`);
  fs.writeFileSync(zipPath, res.body);
  const zip = new AdmZip(zipPath);
  const names = zip.getEntries().map((e) => e.entryName);
  assert.ok(names.includes('collectory.db'), 'db snapshot present');
  assert.ok(names.includes('meta.json'), 'meta.json present');
  assert.ok(names.some((n) => n.startsWith('images/orig/')), 'original image present');
  assert.ok(names.some((n) => n.startsWith('images/thumb/')), 'thumbnail present');
  const meta = JSON.parse(zip.readAsText('meta.json'));
  assert.strictEqual(meta.app, 'collectory');
  assert.ok(meta.version);
  assert.ok(meta.exportedAt);
  fs.unlinkSync(zipPath);
});

test('restore validates meta.json, writes safety zip, and hot-swaps data', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  // Original data set A
  const col = (await request(app).post('/api/collections').send({ name: 'Stamps', templateKey: 'stamps' })).body;
  await request(app).post('/api/items').send({ collectionId: col.id, name: 'Inverted Jenny' });

  // Make a backup of state A
  const bakPath = path.join(dataDir, 'state-a.zip');
  await backupSvc.createBackupZip(ctx.db, dataDir, ctx.version, bakPath);

  // Mutate to state B (add another item)
  await request(app).post('/api/items').send({ collectionId: col.id, name: 'Penny Black' });
  let listB = await request(app).get(`/api/collections/${col.id}/items`);
  assert.strictEqual(listB.body.total, 2, 'state B has 2 items');

  // Restore state A
  const restore = await request(app).post('/api/restore').attach('file', bakPath);
  assert.strictEqual(restore.status, 200, JSON.stringify(restore.body));
  assert.strictEqual(restore.body.ok, true);
  assert.ok(restore.body.safetyBackup, 'safety backup name returned');

  // After restore, only state A's single item is present (via the hot-swapped connection)
  const listA = await request(app).get(`/api/collections/${col.id}/items`);
  assert.strictEqual(listA.body.total, 1, 'restored to state A (1 item)');

  // A safety zip must exist in backups/
  const backupsDir = path.join(dataDir, 'backups');
  const safety = fs.readdirSync(backupsDir).filter((f) => f.startsWith('pre-restore-'));
  assert.ok(safety.length >= 1, 'safety zip written before restore');
});

test('restore rejects a zip without collectory meta', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const badZip = new AdmZip();
  badZip.addFile('random.txt', Buffer.from('not a backup'));
  const badPath = path.join(dataDir, 'bad.zip');
  badZip.writeZip(badPath);
  const res = await request(app).post('/api/restore').attach('file', badPath);
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error.message, /invalid backup/i);
});
