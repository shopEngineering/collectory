'use strict';
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { freshApp, cleanup } = require('./helpers');

async function firearmsCollection(app) {
  return (await request(app).post('/api/collections').send({ name: 'Guns', templateKey: 'firearms' })).body;
}

test('item CRUD + dynamic fields merge/clear', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = await firearmsCollection(app);

  const created = await request(app)
    .post('/api/items')
    .send({ collectionId: col.id, name: 'Colt 1911', fields: { manufacturer: 'Colt', caliber: '.45 ACP' }, tags: ['pistol', 'carry'] });
  assert.strictEqual(created.status, 201);
  const id = created.body.id;
  assert.strictEqual(created.body.fields.manufacturer, 'Colt');
  assert.deepStrictEqual(created.body.tags.map((t2) => t2.name).sort(), ['carry', 'pistol']);
  assert.ok(created.body.collection && created.body.collection.templateKey === 'firearms');

  // PATCH merges a new key, keeps existing, clears one with null
  const patched = await request(app)
    .patch(`/api/items/${id}`)
    .send({ fields: { model: 'M1911A1', caliber: null }, notes: 'range gun', tags: ['pistol'] });
  assert.strictEqual(patched.status, 200);
  assert.strictEqual(patched.body.fields.manufacturer, 'Colt', 'existing field kept');
  assert.strictEqual(patched.body.fields.model, 'M1911A1', 'new field merged');
  assert.strictEqual(patched.body.fields.caliber, undefined, 'null cleared the key');
  assert.strictEqual(patched.body.notes, 'range gun');
  assert.deepStrictEqual(patched.body.tags.map((t2) => t2.name), ['pistol'], 'tags fully replaced');

  // duplicate
  const dup = await request(app).post(`/api/items/${id}/duplicate`);
  assert.strictEqual(dup.status, 201);
  assert.ok(dup.body.name.endsWith('(copy)'));
  assert.strictEqual(dup.body.fields.manufacturer, 'Colt');

  // soft delete + trash + restore
  await request(app).delete(`/api/items/${id}`);
  const trash = await request(app).get('/api/trash');
  assert.ok(trash.body.items.some((it) => it.id === id), 'in trash');
  const restore = await request(app).post(`/api/items/${id}/restore`);
  assert.strictEqual(restore.status, 200);
  const back = await request(app).get(`/api/items/${id}`);
  assert.strictEqual(back.body.deletedAt, null);
});

test('FTS search finds item by dynamic field value; global search returns snippet', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = await firearmsCollection(app);
  await request(app).post('/api/items').send({ collectionId: col.id, name: 'Rifle', fields: { manufacturer: 'Winchester', serial_number: 'ZX9910' } });

  // per-collection search by field value
  const inCol = await request(app).get(`/api/collections/${col.id}/items?q=Winchester`);
  assert.strictEqual(inCol.body.total, 1, 'found by field value in collection search');

  // by serial number (field value)
  const bySerial = await request(app).get(`/api/collections/${col.id}/items?q=ZX9910`);
  assert.strictEqual(bySerial.body.total, 1, 'found by serial field');

  // global search
  const global = await request(app).get('/api/search?q=Winchester');
  assert.strictEqual(global.body.results.length, 1);
  assert.ok('snippet' in global.body.results[0]);
  assert.ok(global.body.results[0].collectionName);
});

test('FTS search does not crash on special characters', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = await firearmsCollection(app);
  await request(app).post('/api/items').send({ collectionId: col.id, name: '.45 ACP "match"' });
  for (const q of ['"', '.45', 'ACP AND OR', ')(*', '   ']) {
    const res = await request(app).get(`/api/search?q=${encodeURIComponent(q)}`);
    assert.strictEqual(res.status, 200, `query ${JSON.stringify(q)} did not crash`);
  }
  const col2 = await request(app).get(`/api/collections/${col.id}/items?q=${encodeURIComponent('"quote')}`);
  assert.strictEqual(col2.status, 200);
});

test('status filter default excludes former statuses', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = await firearmsCollection(app);
  await request(app).post('/api/items').send({ collectionId: col.id, name: 'Owned' });
  await request(app).post('/api/items').send({ collectionId: col.id, name: 'Sold', status: 'sold' });
  const def = await request(app).get(`/api/collections/${col.id}/items`);
  assert.strictEqual(def.body.total, 1, 'default view excludes sold');
  const all = await request(app).get(`/api/collections/${col.id}/items?status=owned,sold`);
  assert.strictEqual(all.body.total, 2);
});
