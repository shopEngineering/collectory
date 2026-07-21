'use strict';
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { freshApp, cleanup } = require('./helpers');

async function setup(app) {
  const guns = (await request(app).post('/api/collections').send({ name: 'Guns', templateKey: 'firearms' })).body;
  const ammoCol = (await request(app).post('/api/collections').send({ name: 'Ammo', templateKey: 'ammunition' })).body;
  const rifle = (await request(app).post('/api/items').send({ collectionId: guns.id, name: 'AR-15' })).body;
  const ammo = (await request(app).post('/api/items').send({ collectionId: ammoCol.id, name: '5.56 M193', quantity: 1000, minQuantity: 200, fields: { caliber: '5.56 NATO' } })).body;
  return { guns, ammoCol, rifle, ammo };
}

function qty(app, id) {
  return request(app).get(`/api/items/${id}`).then((r) => r.body.quantity);
}

test('ammo linkage full round-trip: create range_session with ammo → quantity drops, usage log created', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const { rifle, ammo } = await setup(app);

  const log = await request(app)
    .post(`/api/items/${rifle.id}/logs`)
    .send({ logTypeKey: 'range_session', date: '2026-05-01', data: { rounds_fired: 150, ammo_item_id: ammo.id } });
  assert.strictEqual(log.status, 201);
  assert.ok(log.body.linkedLogId, 'source log linked to usage log');

  // ammo quantity dropped by 150
  assert.strictEqual(await qty(app, ammo.id), 850, 'ammo quantity decremented by rounds fired');

  // a usage log exists on the ammo item
  const ammoLogs = (await request(app).get(`/api/items/${ammo.id}/logs`)).body.logs;
  const usage = ammoLogs.find((l) => l.logTypeKey === 'usage');
  assert.ok(usage, 'usage log auto-created on ammo item');
  assert.strictEqual(usage.data.rounds_used, 150);
  assert.strictEqual(usage.data.source_item_id, rifle.id);
  assert.strictEqual(usage.linkedLogId, log.body.id, 'usage links back to source');

  // computed stat roundsFired reflects the range session
  const rifleFull = (await request(app).get(`/api/items/${rifle.id}`)).body;
  assert.strictEqual(rifleFull.computedStats.roundsFired, 150);
});

test('editing rounds_fired applies the delta to ammo quantity', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const { rifle, ammo } = await setup(app);

  const log = (await request(app).post(`/api/items/${rifle.id}/logs`).send({ logTypeKey: 'range_session', date: '2026-05-01', data: { rounds_fired: 100, ammo_item_id: ammo.id } })).body;
  assert.strictEqual(await qty(app, ammo.id), 900);

  // edit up to 250 -> ammo should drop by an additional 150 (from 900 to 750)
  await request(app).patch(`/api/logs/${log.id}`).send({ data: { rounds_fired: 250, ammo_item_id: ammo.id } });
  assert.strictEqual(await qty(app, ammo.id), 750, 'delta applied on edit');

  // edit down to 50 -> ammo restored (from 750 to 950)
  await request(app).patch(`/api/logs/${log.id}`).send({ data: { rounds_fired: 50, ammo_item_id: ammo.id } });
  assert.strictEqual(await qty(app, ammo.id), 950, 'reverse delta applied on downward edit');
});

test('deleting the source range_session restores ammo quantity and removes usage log', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const { rifle, ammo } = await setup(app);
  const log = (await request(app).post(`/api/items/${rifle.id}/logs`).send({ logTypeKey: 'range_session', date: '2026-05-01', data: { rounds_fired: 300, ammo_item_id: ammo.id } })).body;
  assert.strictEqual(await qty(app, ammo.id), 700);

  await request(app).delete(`/api/logs/${log.id}`);
  assert.strictEqual(await qty(app, ammo.id), 1000, 'quantity fully restored on delete');
  const ammoLogs = (await request(app).get(`/api/items/${ammo.id}/logs`)).body.logs;
  assert.strictEqual(ammoLogs.filter((l) => l.logTypeKey === 'usage').length, 0, 'usage log removed');
});

test('re-linking to a different ammo item on edit moves the usage', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const { ammoCol, rifle, ammo } = await setup(app);
  const ammo2 = (await request(app).post('/api/items').send({ collectionId: ammoCol.id, name: '5.56 XM855', quantity: 500 })).body;

  const log = (await request(app).post(`/api/items/${rifle.id}/logs`).send({ logTypeKey: 'range_session', date: '2026-05-01', data: { rounds_fired: 100, ammo_item_id: ammo.id } })).body;
  assert.strictEqual(await qty(app, ammo.id), 900);

  // re-target to ammo2
  await request(app).patch(`/api/logs/${log.id}`).send({ data: { rounds_fired: 100, ammo_item_id: ammo2.id } });
  assert.strictEqual(await qty(app, ammo.id), 1000, 'original ammo restored');
  assert.strictEqual(await qty(app, ammo2.id), 400, 'new ammo decremented');
});

test('restock (rounds_added) increments ammo quantity; delete reverses', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const { ammo } = await setup(app);
  const log = (await request(app).post(`/api/items/${ammo.id}/logs`).send({ logTypeKey: 'restock', date: '2026-05-01', data: { rounds_added: 500 } })).body;
  assert.strictEqual(await qty(app, ammo.id), 1500, 'restock increments quantity');
  await request(app).delete(`/api/logs/${log.id}`);
  assert.strictEqual(await qty(app, ammo.id), 1000, 'delete reverses restock');
});

test('quantity floors at 0 when firing more than available', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const { rifle, ammo } = await setup(app);
  await request(app).post(`/api/items/${rifle.id}/logs`).send({ logTypeKey: 'range_session', date: '2026-05-01', data: { rounds_fired: 5000, ammo_item_id: ammo.id } });
  assert.strictEqual(await qty(app, ammo.id), 0, 'quantity floored at 0');
});

// C1: floor-0 is a DISPLAY clamp; the stored value stays signed so a fire-below-0
// reverses EXACTLY back to the original (no phantom rounds).
test('C1: firing more than owned then deleting the log restores the exact original quantity (no phantom rounds)', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const { ammoCol, rifle } = await setup(app);
  // owned = 100
  const ammo = (await request(app).post('/api/items').send({ collectionId: ammoCol.id, name: '9mm', quantity: 100 })).body;

  // fire 300 -> displayed quantity floors to 0
  const log = (await request(app).post(`/api/items/${rifle.id}/logs`).send({ logTypeKey: 'range_session', date: '2026-05-01', data: { rounds_fired: 300, ammo_item_id: ammo.id } })).body;
  assert.strictEqual(await qty(app, ammo.id), 0, 'displayed on-hand floors to 0 after over-firing');

  // delete the log -> EXACT original 100 restored (bug used to yield 300)
  await request(app).delete(`/api/logs/${log.id}`);
  assert.strictEqual(await qty(app, ammo.id), 100, 'exact original restored on delete — no phantom +200');
});

test('C1: editing rounds_fired DOWN after over-firing yields the exact expected quantity', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const { ammoCol, rifle } = await setup(app);
  const ammo = (await request(app).post('/api/items').send({ collectionId: ammoCol.id, name: '9mm', quantity: 100 })).body;

  const log = (await request(app).post(`/api/items/${rifle.id}/logs`).send({ logTypeKey: 'range_session', date: '2026-05-01', data: { rounds_fired: 300, ammo_item_id: ammo.id } })).body;
  assert.strictEqual(await qty(app, ammo.id), 0, 'floored to 0 after firing 300 of 100');

  // edit down to 50 -> on hand should be exactly 100 - 50 = 50 (bug used to yield 250)
  await request(app).patch(`/api/logs/${log.id}`).send({ data: { rounds_fired: 50, ammo_item_id: ammo.id } });
  assert.strictEqual(await qty(app, ammo.id), 50, 'edit-down after over-fire yields exact 50');
});

// H1: a single log carrying BOTH a rule-1 quantity effect (rounds_used) AND
// ammo_item_id+rounds_fired must NOT double-decrement.
test('H1: log on an ammo item with rounds_used + ammo_item_id does not double-decrement (no auto-usage link)', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const { ammoCol } = await setup(app);
  const ammoA = (await request(app).post('/api/items').send({ collectionId: ammoCol.id, name: 'A', quantity: 1000 })).body;

  // Host item IS ammo; rounds_used=100 (rule 1) AND ammo_item_id points at another ammo item.
  const ammoB = (await request(app).post('/api/items').send({ collectionId: ammoCol.id, name: 'B', quantity: 1000 })).body;
  const log = await request(app)
    .post(`/api/items/${ammoA.id}/logs`)
    .send({ logTypeKey: 'usage', date: '2026-05-01', data: { rounds_used: 100, rounds_fired: 100, ammo_item_id: ammoB.id } });
  assert.strictEqual(log.status, 201);
  // Rule 1 decrements the host (A) by 100. Rule 2 must be suppressed (host is ammo),
  // so B is untouched and no usage log is auto-created.
  assert.strictEqual(await qty(app, ammoA.id), 900, 'host ammo decremented once by rule 1');
  assert.strictEqual(await qty(app, ammoB.id), 1000, 'referenced ammo untouched — rule 2 suppressed on ammo host');
  assert.ok(!log.body.linkedLogId, 'no linked usage log created for an ammo-hosted log');
});

test('H1: self-referencing ammo_item_id (log on the same item) does not double-hit', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const { ammoCol } = await setup(app);
  const ammo = (await request(app).post('/api/items').send({ collectionId: ammoCol.id, name: 'Self', quantity: 1000 })).body;

  // A log on the ammo item that references ITSELF with rounds_fired must not decrement twice.
  const log = await request(app)
    .post(`/api/items/${ammo.id}/logs`)
    .send({ logTypeKey: 'usage', date: '2026-05-01', data: { rounds_used: 100, rounds_fired: 100, ammo_item_id: ammo.id } });
  assert.strictEqual(log.status, 201);
  assert.strictEqual(await qty(app, ammo.id), 900, 'self-reference decremented once (rule 1 only), not twice');
  assert.ok(!log.body.linkedLogId, 'no self-linked usage log');
});

test('ammo-choices lists ammo items with caliber', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const { ammo } = await setup(app);
  const choices = (await request(app).get('/api/ammo-choices')).body;
  assert.ok(Array.isArray(choices));
  const c = choices.find((x) => x.id === ammo.id);
  assert.ok(c, 'ammo item present');
  assert.strictEqual(c.caliber, '5.56 NATO');
});
