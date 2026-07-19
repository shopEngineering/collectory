'use strict';
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { freshApp, cleanup } = require('./helpers');

async function setup(app) {
  const guns = (await request(app).post('/api/collections').send({ name: 'Guns', templateKey: 'firearms' })).body;
  const ammo = (await request(app).post('/api/collections').send({ name: 'Ammo', templateKey: 'ammunition' })).body;
  const gun = (await request(app).post('/api/items').send({ collectionId: guns.id, name: 'Glock 19' })).body;
  const ammoItem = (await request(app).post('/api/items').send({ collectionId: ammo.id, name: '9mm 124gr', quantity: 500, fields: { caliber: '9mm Luger' } })).body;
  return { guns, ammo, gun, ammoItem };
}

test('magazines: child CRUD on a firearm item', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const { gun, ammoItem } = await setup(app);

  // create
  const created = await request(app).post(`/api/items/${gun.id}/magazines`).send({
    name: 'Factory 15rd',
    manufacturer: 'Glock',
    capacity: 15,
    caliber: '9mm Luger',
    quantity: 3,
    holdsAmmoIds: [ammoItem.id],
    loaded: true,
    loadedWithId: ammoItem.id,
    loadedRounds: 15,
    notes: 'carry mags',
  });
  assert.strictEqual(created.status, 201);
  const mag = created.body;
  assert.strictEqual(mag.itemId, gun.id);
  assert.strictEqual(mag.name, 'Factory 15rd');
  assert.strictEqual(mag.capacity, 15);
  assert.strictEqual(mag.quantity, 3);
  assert.deepStrictEqual(mag.holdsAmmoIds, [ammoItem.id]);
  assert.strictEqual(mag.loaded, true);
  assert.strictEqual(mag.loadedWithId, ammoItem.id);
  assert.strictEqual(mag.loadedRounds, 15);

  // name required
  const bad = await request(app).post(`/api/items/${gun.id}/magazines`).send({ capacity: 10 });
  assert.strictEqual(bad.status, 400);

  // list
  const list = (await request(app).get(`/api/items/${gun.id}/magazines`)).body;
  assert.strictEqual(list.magazines.length, 1);
  assert.strictEqual(list.magazines[0].id, mag.id);

  // patch: unload it, change capacity
  const patched = (await request(app).patch(`/api/magazines/${mag.id}`).send({ loaded: false, loadedWithId: null, loadedRounds: null, capacity: 17 })).body;
  assert.strictEqual(patched.loaded, false);
  assert.strictEqual(patched.loadedWithId, null);
  assert.strictEqual(patched.capacity, 17);
  assert.deepStrictEqual(patched.holdsAmmoIds, [ammoItem.id], 'holdsAmmoIds untouched by partial patch');

  // delete
  const del = await request(app).delete(`/api/magazines/${mag.id}`);
  assert.strictEqual(del.status, 200);
  const after = (await request(app).get(`/api/items/${gun.id}/magazines`)).body;
  assert.strictEqual(after.magazines.length, 0);
});

test('magazines: loading does NOT change the ammo lot quantity (deliberate)', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const { gun, ammoItem } = await setup(app);

  await request(app).post(`/api/items/${gun.id}/magazines`).send({
    name: 'Mag', loaded: true, loadedWithId: ammoItem.id, loadedRounds: 15,
  });
  const ammoAfter = (await request(app).get(`/api/items/${ammoItem.id}`)).body;
  assert.strictEqual(ammoAfter.quantity, 500, 'loading a magazine leaves lot quantity untouched');
});

test('magazines: ammo related shows "In magazines of" the parent firearm (holds + loaded_with)', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const { gun, ammoItem, ammo } = await setup(app);
  const otherAmmo = (await request(app).post('/api/items').send({ collectionId: ammo.id, name: '9mm 147gr', fields: { caliber: '9mm Luger' } })).body;

  // holdsAmmoIds -> ammoItem; loadedWithId -> otherAmmo
  await request(app).post(`/api/items/${gun.id}/magazines`).send({
    name: 'Factory 15rd', holdsAmmoIds: [ammoItem.id], loaded: true, loadedWithId: otherAmmo.id, loadedRounds: 15,
  });

  for (const target of [ammoItem, otherAmmo]) {
    const rel = (await request(app).get(`/api/items/${target.id}/related`)).body;
    const group = rel.referencedBy.find((g) => g.fieldKey === 'magazines');
    assert.ok(group, `${target.name}: has magazines group`);
    assert.strictEqual(group.fieldLabel, 'In magazines of');
    assert.strictEqual(group.templateKey, 'firearms');
    assert.ok(group.items.some((it) => it.id === gun.id), `${target.name}: parent gun listed`);
  }

  // deleting the parent firearm cascades its magazines
  await request(app).delete(`/api/items/${gun.id}?permanent=true`);
  const relAfter = (await request(app).get(`/api/items/${ammoItem.id}/related`)).body;
  assert.ok(!relAfter.referencedBy.some((g) => g.fieldKey === 'magazines'), 'magazines group gone after parent delete');
});
