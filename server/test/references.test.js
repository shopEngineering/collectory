'use strict';
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { freshApp, cleanup } = require('./helpers');

async function firearmsCollection(app, name = 'Guns') {
  return (await request(app).post('/api/collections').send({ name, templateKey: 'firearms' })).body;
}
async function ammoCollection(app, name = 'Ammo') {
  return (await request(app).post('/api/collections').send({ name, templateKey: 'ammunition' })).body;
}

test('templates: firearms exposes associated_ammo (item_refs -> ammunition); refTemplate persists; no magazines collection template', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);

  const templates = (await request(app).get('/api/templates')).body;
  assert.ok(!templates.some((tpl) => tpl.key === 'magazines'), 'magazines is NOT a collection template (child records of firearms instead)');

  const firearms = templates.find((tpl) => tpl.key === 'firearms');
  assert.ok(firearms, 'firearms template present');
  const ammoField = firearms.fields.find((f) => f.key === 'associated_ammo');
  assert.ok(ammoField, 'associated_ammo field present');
  assert.strictEqual(ammoField.type, 'item_refs');
  assert.strictEqual(ammoField.refTemplate, 'ammunition');

  // ref_template DB column round-trips through GET /api/collections/:id
  const col = await firearmsCollection(app);
  const full = (await request(app).get(`/api/collections/${col.id}`)).body;
  const persisted = full.fields.find((f) => f.key === 'associated_ammo');
  assert.ok(persisted, 'associated_ammo persisted on collection');
  assert.strictEqual(persisted.refTemplate, 'ammunition', 'refTemplate persisted through ref_template column');
});

test('item-choices: filters by template and q, shapes each choice, excludes former/deleted', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const guns = await firearmsCollection(app);
  const ammo = await ammoCollection(app);

  const ammo1 = (await request(app).post('/api/items').send({ collectionId: ammo.id, name: '.357 Magnum', fields: { caliber: '.357 Magnum' } })).body;
  const ammo2 = (await request(app).post('/api/items').send({ collectionId: ammo.id, name: '9mm FMJ', fields: { caliber: '9mm Luger' } })).body;
  const gun = (await request(app).post('/api/items').send({ collectionId: guns.id, name: 'Model 686' })).body;

  const ammoChoices = (await request(app).get('/api/item-choices?template=ammunition')).body;
  assert.strictEqual(ammoChoices.length, 2, 'exactly the 2 ammo items');
  const ids = ammoChoices.map((c) => c.id).sort();
  assert.deepStrictEqual(ids, [ammo1.id, ammo2.id].sort());
  for (const c of ammoChoices) {
    assert.deepStrictEqual(
      Object.keys(c).sort(),
      ['collectionId', 'collectionName', 'hint', 'id', 'name', 'quantity', 'thumbUrl'].sort(),
      'choice shape'
    );
    assert.strictEqual(c.collectionId, ammo.id);
    assert.strictEqual(c.collectionName, 'Ammo');
    assert.strictEqual(c.thumbUrl, null, 'no photos -> null thumbUrl');
  }
  const c1 = ammoChoices.find((c) => c.id === ammo1.id);
  assert.strictEqual(c1.hint, '.357 Magnum', 'hint equals caliber field');
  const c2 = ammoChoices.find((c) => c.id === ammo2.id);
  assert.strictEqual(c2.hint, '9mm Luger');

  // q filters by name substring
  const filtered = (await request(app).get('/api/item-choices?template=ammunition&q=357')).body;
  assert.strictEqual(filtered.length, 1, 'q narrows to one match');
  assert.strictEqual(filtered[0].id, ammo1.id);

  // excludeItemId
  const excluded = (await request(app).get(`/api/item-choices?template=firearms&excludeItemId=${gun.id}`)).body;
  assert.ok(!excluded.some((c) => c.id === gun.id), 'excluded item not present');
  assert.strictEqual(excluded.length, 0, 'no other firearms remain');

  // sold status excluded
  const soldAmmo = (await request(app).post('/api/items').send({ collectionId: ammo.id, name: 'Sold Lot', status: 'sold', fields: { caliber: '.22 LR' } })).body;
  const afterSold = (await request(app).get('/api/item-choices?template=ammunition')).body;
  assert.ok(!afterSold.some((c) => c.id === soldAmmo.id), 'sold item excluded from choices');

  // soft-deleted excluded
  await request(app).delete(`/api/items/${ammo1.id}`);
  const afterDelete = (await request(app).get('/api/item-choices?template=ammunition')).body;
  assert.ok(!afterDelete.some((c) => c.id === ammo1.id), 'soft-deleted item excluded from choices');
});

test('items/:id/related: outgoing references, referencedBy, and used_with', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const guns = await firearmsCollection(app);
  const ammo = await ammoCollection(app);

  const gun = (await request(app).post('/api/items').send({ collectionId: guns.id, name: 'AR-15' })).body;
  const ammoItem = (await request(app).post('/api/items').send({ collectionId: ammo.id, name: '5.56 M193', fields: { caliber: '5.56 NATO' } })).body;

  // patch the gun with associated_ammo -> both directions
  await request(app).patch(`/api/items/${gun.id}`).send({ fields: { associated_ammo: [ammoItem.id] } });

  // outgoing: gun's references includes the ammo under associated_ammo
  const gunRelated = (await request(app).get(`/api/items/${gun.id}/related`)).body;
  assert.deepStrictEqual(Object.keys(gunRelated).sort(), ['referencedBy', 'references'].sort());
  const ammoGroup = gunRelated.references.find((g) => g.fieldKey === 'associated_ammo');
  assert.ok(ammoGroup, 'references has associated_ammo group');
  assert.ok(ammoGroup.items.some((it) => it.id === ammoItem.id), 'ammo item listed under associated_ammo');

  // incoming: the ammo's referencedBy includes the gun via associated_ammo
  const ammoRelated1 = (await request(app).get(`/api/items/${ammoItem.id}/related`)).body;
  const byGroup = ammoRelated1.referencedBy.find((g) => g.fieldKey === 'associated_ammo');
  assert.ok(byGroup, 'ammo referencedBy has associated_ammo group');
  assert.strictEqual(byGroup.templateKey, 'firearms');
  assert.strictEqual(byGroup.fieldLabel, 'Ammunition for this firearm');
  assert.ok(byGroup.items.some((it) => it.id === gun.id), 'gun listed as referencing the ammo');

  // used_with: a range_session log on the gun referencing the ammo item
  const log = await request(app)
    .post(`/api/items/${gun.id}/logs`)
    .send({ logTypeKey: 'range_session', date: '2026-01-01', data: { rounds_fired: 20, ammo_item_id: ammoItem.id } });
  assert.strictEqual(log.status, 201);

  const ammoRelated2 = (await request(app).get(`/api/items/${ammoItem.id}/related`)).body;
  const usedWith = ammoRelated2.referencedBy.find((g) => g.fieldKey === 'used_with');
  assert.ok(usedWith, 'ammo item has synthetic used_with group');
  assert.ok(usedWith.items.some((it) => it.id === gun.id), 'gun listed under used_with');
});

test('ammo-choices is an alias of item-choices with backcompat caliber key', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const ammo = await ammoCollection(app);
  const ammoItem = (await request(app).post('/api/items').send({ collectionId: ammo.id, name: '5.56 M193', fields: { caliber: '5.56 NATO' } })).body;

  const choices = (await request(app).get('/api/ammo-choices')).body;
  assert.ok(Array.isArray(choices));
  const c = choices.find((x) => x.id === ammoItem.id);
  assert.ok(c, 'ammo item present');
  assert.strictEqual(c.caliber, '5.56 NATO', 'backcompat caliber key equals caliber field');
  assert.strictEqual(c.hint, '5.56 NATO', 'hint also present');
});
