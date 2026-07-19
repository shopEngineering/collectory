'use strict';
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { freshApp, cleanup } = require('./helpers');

test('CSV export → reimport round-trip preserves data and updates by id', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'Knives', templateKey: 'knives' })).body;
  const item = (await request(app)
    .post('/api/items')
    .send({
      collectionId: col.id,
      name: 'Bench Bugout',
      acquiredPriceCents: 15500,
      currentValueCents: 18000,
      quantity: 1,
      fields: { maker: 'Benchmade', blade_steel: 'S30V' },
      tags: ['edc'],
    })).body;

  // export
  const exp = await request(app).get(`/api/export/csv?collectionId=${col.id}`);
  assert.strictEqual(exp.status, 200);
  assert.match(exp.headers['content-disposition'], /\.csv/);
  const csvText = exp.text;
  assert.match(csvText, /Bench Bugout/);
  assert.match(csvText, /Benchmade/);
  assert.match(csvText, /field:maker/);
  assert.match(csvText, /,155\.00,/); // acquired_price in dollars

  // preview (re-upload the same CSV as a buffer)
  const preview = await request(app)
    .post(`/api/import/csv/preview?collectionId=${col.id}`)
    .attach('file', Buffer.from(csvText), 'export.csv');
  assert.strictEqual(preview.status, 200);
  assert.ok(preview.body.token);
  assert.ok(preview.body.headers.includes('id'));
  // id should be suggested as core:id, name as core:name, field:maker -> field:maker
  assert.strictEqual(preview.body.suggestedMapping.id, 'core:id');
  assert.strictEqual(preview.body.suggestedMapping.name, 'core:name');
  assert.strictEqual(preview.body.suggestedMapping['field:maker'], 'field:maker');

  // commit -> should UPDATE the existing item (id round-trip), not create a duplicate
  const commit = await request(app)
    .post('/api/import/csv/commit')
    .send({ token: preview.body.token, collectionId: col.id, mapping: preview.body.suggestedMapping });
  assert.strictEqual(commit.status, 200);
  assert.strictEqual(commit.body.imported, 1);
  assert.strictEqual(commit.body.errors.length, 0);

  // still only one item, data preserved
  const list = await request(app).get(`/api/collections/${col.id}/items`);
  assert.strictEqual(list.body.total, 1, 'id round-trip updated rather than duplicated');
  const full = (await request(app).get(`/api/items/${item.id}`)).body;
  assert.strictEqual(full.name, 'Bench Bugout');
  assert.strictEqual(full.acquiredPriceCents, 15500, 'price round-tripped through dollars');
  assert.strictEqual(full.currentValueCents, 18000);
  assert.strictEqual(full.fields.maker, 'Benchmade');
  assert.strictEqual(full.fields.blade_steel, 'S30V');
});

test('CSV import new:<type> creates a field def and value', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'Custom' })).body;
  const csvText = 'name,Special Note\nWidget,hello world\n';
  const preview = await request(app).post(`/api/import/csv/preview?collectionId=${col.id}`).attach('file', Buffer.from(csvText), 'x.csv');
  const mapping = { name: 'core:name', 'Special Note': 'new:text' };
  const commit = await request(app).post('/api/import/csv/commit').send({ token: preview.body.token, collectionId: col.id, mapping });
  assert.strictEqual(commit.body.imported, 1);
  const full = (await request(app).get(`/api/collections/${col.id}`)).body;
  const created = full.fields.find((f) => f.label === 'Special Note');
  assert.ok(created, 'new field def created');
  const list = await request(app).get(`/api/collections/${col.id}/items`);
  const item = (await request(app).get(`/api/items/${list.body.items[0].id}`)).body;
  assert.strictEqual(item.fields[created.key], 'hello world');
});
