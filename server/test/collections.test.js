'use strict';
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { freshApp, cleanup } = require('./helpers');

test('template instantiation: firearms collection gets NFA fields + range_session + note', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);

  const create = await request(app).post('/api/collections').send({ name: 'My Guns', templateKey: 'firearms' });
  assert.strictEqual(create.status, 201);
  const id = create.body.id;
  assert.strictEqual(create.body.templateKey, 'firearms');

  const full = await request(app).get(`/api/collections/${id}`);
  assert.strictEqual(full.status, 200);
  const fieldKeys = full.body.fields.map((f) => f.key);
  // NFA section fields present
  for (const k of ['nfa_item', 'nfa_type', 'form_type', 'stamp_status', 'stamp_submitted', 'stamp_approved', 'stamp_number', 'trust_name']) {
    assert.ok(fieldKeys.includes(k), `field ${k} present`);
  }
  // range_session log type + its ammo_ref field
  const ltKeys = full.body.logTypes.map((l) => l.key);
  assert.ok(ltKeys.includes('range_session'), 'range_session log type present');
  assert.ok(ltKeys.includes('note'), 'note log type present');
  const range = full.body.logTypes.find((l) => l.key === 'range_session');
  const ammoField = range.fields.find((f) => f.key === 'ammo_item_id');
  assert.ok(ammoField && ammoField.type === 'ammo_ref', 'ammo_item_id is ammo_ref type');
});

test('every collection gets a note log type even without a template', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const create = await request(app).post('/api/collections').send({ name: 'Custom' });
  assert.strictEqual(create.status, 201);
  const full = await request(app).get(`/api/collections/${create.body.id}`);
  const ltKeys = full.body.logTypes.map((l) => l.key);
  assert.ok(ltKeys.includes('note'), 'note log type always present');
});

test('collection list aggregates itemCount and valueCents', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'Coins', templateKey: 'coins' })).body;
  await request(app).post('/api/items').send({ collectionId: col.id, name: 'A', currentValueCents: 5000 });
  await request(app).post('/api/items').send({ collectionId: col.id, name: 'B', acquiredPriceCents: 2500 });
  // sold item excluded from totals
  await request(app).post('/api/items').send({ collectionId: col.id, name: 'C', currentValueCents: 9999, status: 'sold' });

  const list = await request(app).get('/api/collections');
  const c = list.body.find((x) => x.id === col.id);
  assert.strictEqual(c.itemCount, 3, 'counts all non-deleted items');
  assert.strictEqual(c.valueCents, 7500, 'value uses currentValue else acquiredPrice, excludes sold');
});

test('DELETE collection 409 unless empty or force', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'X' })).body;
  await request(app).post('/api/items').send({ collectionId: col.id, name: 'thing' });
  const blocked = await request(app).delete(`/api/collections/${col.id}`);
  assert.strictEqual(blocked.status, 409);
  const forced = await request(app).delete(`/api/collections/${col.id}?force=true`);
  assert.strictEqual(forced.status, 200);
});

test('PUT fields is non-destructive to item field values', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'K', templateKey: 'knives' })).body;
  const item = (await request(app).post('/api/items').send({ collectionId: col.id, name: 'Blade', fields: { steel: 'S30V' } })).body;
  // Replace field defs (removing 'steel')
  await request(app).put(`/api/collections/${col.id}/fields`).send({ fields: [{ key: 'brand', label: 'Brand', type: 'text' }] });
  const after = (await request(app).get(`/api/items/${item.id}`)).body;
  assert.strictEqual(after.fields.steel, 'S30V', 'removed field value retained in item fields_json');
});

// C2 (server half): force-delete is a PERMANENT delete — it must remove the items'
// photo + attachment FILES from disk, not leave them orphaned.
test('C2: collection force-delete unlinks item photo + attachment files from disk', async (t) => {
  const fs = require('fs');
  const path = require('path');
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'Doomed' })).body;
  const item = (await request(app).post('/api/items').send({ collectionId: col.id, name: 'HasFiles' })).body;

  // Attach a photo (writes images/orig + images/thumb) and an attachment.
  const photo = (await request(app).post(`/api/items/${item.id}/photos`).attach('photo', Buffer.from('jpeg-bytes'), 'p.jpg')).body;
  const att = (await request(app).post(`/api/items/${item.id}/attachments`).attach('file', Buffer.from('pdf-bytes'), 'receipt.pdf')).body;

  const origDir = path.join(dataDir, 'images', 'orig');
  const thumbDir = path.join(dataDir, 'images', 'thumb');
  const attDir = path.join(dataDir, 'attachments');
  assert.strictEqual(fs.readdirSync(origDir).length, 1, 'one original on disk before delete');
  assert.strictEqual(fs.readdirSync(thumbDir).length, 1, 'one thumb on disk before delete');
  assert.strictEqual(fs.readdirSync(attDir).length, 1, 'one attachment on disk before delete');
  void photo; void att;

  const forced = await request(app).delete(`/api/collections/${col.id}?force=true`);
  assert.strictEqual(forced.status, 200);

  assert.strictEqual(fs.readdirSync(origDir).length, 0, 'original file removed from disk');
  assert.strictEqual(fs.readdirSync(thumbDir).length, 0, 'thumb file removed from disk');
  assert.strictEqual(fs.readdirSync(attDir).length, 0, 'attachment file removed from disk');
});
