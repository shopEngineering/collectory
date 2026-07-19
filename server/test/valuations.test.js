'use strict';
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { freshApp, cleanup } = require('./helpers');

test('valuation POST syncs item current_value_cents when newest by date', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'Coins', templateKey: 'coins' })).body;
  const item = (await request(app).post('/api/items').send({ collectionId: col.id, name: 'Double Eagle', currentValueCents: 200000 })).body;

  // Add a newer valuation -> updates current value
  await request(app).post(`/api/items/${item.id}/valuations`).send({ date: '2026-06-01', valueCents: 250000, source: 'appraisal' });
  let full = (await request(app).get(`/api/items/${item.id}`)).body;
  assert.strictEqual(full.currentValueCents, 250000, 'newest valuation synced to current value');
  assert.strictEqual(full.valueUpdatedAt, '2026-06-01');

  // Add an OLDER valuation -> does NOT overwrite current value
  await request(app).post(`/api/items/${item.id}/valuations`).send({ date: '2025-01-01', valueCents: 100000, source: 'purchase' });
  full = (await request(app).get(`/api/items/${item.id}`)).body;
  assert.strictEqual(full.currentValueCents, 250000, 'older valuation does not overwrite newer current value');

  // Add an even newer valuation -> updates
  await request(app).post(`/api/items/${item.id}/valuations`).send({ date: '2026-07-01', valueCents: 300000, source: 'market' });
  full = (await request(app).get(`/api/items/${item.id}`)).body;
  assert.strictEqual(full.currentValueCents, 300000);

  // list is newest-first
  const list = (await request(app).get(`/api/items/${item.id}/valuations`)).body.valuations;
  assert.strictEqual(list.length, 3);
  assert.strictEqual(list[0].date, '2026-07-01');

  // delete newest -> current value falls back to the remaining latest
  await request(app).delete(`/api/valuations/${list[0].id}`);
  full = (await request(app).get(`/api/items/${item.id}`)).body;
  assert.strictEqual(full.currentValueCents, 250000, 're-synced to remaining latest after delete');
});

test('provenance CRUD', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'Guns', templateKey: 'firearms' })).body;
  const item = (await request(app).post('/api/items').send({ collectionId: col.id, name: 'Luger' })).body;
  const p = (await request(app).post(`/api/items/${item.id}/provenance`).send({ ownerName: 'Original Owner', fromDate: '1943', howAcquired: 'capture' })).body;
  assert.ok(p.id);
  assert.strictEqual(p.ownerName, 'Original Owner');
  await request(app).patch(`/api/provenance/${p.id}`).send({ toDate: '1945' });
  const list = (await request(app).get(`/api/items/${item.id}/provenance`)).body.provenance;
  assert.strictEqual(list[0].toDate, '1945');
  await request(app).delete(`/api/provenance/${p.id}`);
  const list2 = (await request(app).get(`/api/items/${item.id}/provenance`)).body.provenance;
  assert.strictEqual(list2.length, 0);
});

test('computed stats: lastCleaned and roundsSinceCleaned', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'Guns', templateKey: 'firearms' })).body;
  const rifle = (await request(app).post('/api/items').send({ collectionId: col.id, name: 'Rifle' })).body;
  await request(app).post(`/api/items/${rifle.id}/logs`).send({ logTypeKey: 'range_session', date: '2026-01-01', data: { rounds_fired: 100 } });
  await request(app).post(`/api/items/${rifle.id}/logs`).send({ logTypeKey: 'cleaning', date: '2026-02-01' });
  await request(app).post(`/api/items/${rifle.id}/logs`).send({ logTypeKey: 'range_session', date: '2026-03-01', data: { rounds_fired: 50 } });
  const full = (await request(app).get(`/api/items/${rifle.id}`)).body;
  assert.strictEqual(full.computedStats.roundsFired, 150);
  assert.strictEqual(full.computedStats.lastCleaned, '2026-02-01');
  assert.strictEqual(full.computedStats.roundsSinceCleaned, 50, 'only rounds after last cleaning');
  assert.strictEqual(full.computedStats.lastActivity, '2026-03-01');
});

test('photo cover reassignment on delete', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'Coins', templateKey: 'coins' })).body;
  const item = (await request(app).post('/api/items').send({ collectionId: col.id, name: 'Coin' })).body;
  const p1 = (await request(app).post(`/api/items/${item.id}/photos`).attach('photo', Buffer.from('a'), 'a.jpg')).body;
  const p2 = (await request(app).post(`/api/items/${item.id}/photos`).attach('photo', Buffer.from('b'), 'b.jpg')).body;
  // first photo is cover
  let full = (await request(app).get(`/api/items/${item.id}`)).body;
  assert.strictEqual(full.coverPhotoId, p1.id);
  // delete cover -> next becomes cover
  await request(app).delete(`/api/photos/${p1.id}`);
  full = (await request(app).get(`/api/items/${item.id}`)).body;
  assert.strictEqual(full.coverPhotoId, p2.id, 'cover reassigned to remaining photo');
});
