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

// C3 + A2/A4: export→reimport must preserve multiselect ARRAY and checkbox BOOLEAN
// types (not corrupt them into strings), and an explicitly-emptied cell must clear.
test('C3/A2/A4: CSV round-trip preserves multiselect arrays and checkbox booleans, and empties clear', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'Gear' })).body;
  // Define a multiselect + checkbox field on the collection.
  await request(app).put(`/api/collections/${col.id}/fields`).send({
    fields: [
      { key: 'traits', label: 'Traits', type: 'multiselect', options: ['premium', 'rare', 'used'] },
      { key: 'verified', label: 'Verified', type: 'checkbox' },
    ],
  });
  const item = (await request(app)
    .post('/api/items')
    .send({ collectionId: col.id, name: 'Widget', fields: { traits: ['premium', 'rare'], verified: true } })).body;
  assert.deepStrictEqual(item.fields.traits, ['premium', 'rare'], 'stored as array');
  assert.strictEqual(item.fields.verified, true, 'stored as boolean');

  // export -> multiselect joined "premium; rare", checkbox stringified "true"
  const csvText = (await request(app).get(`/api/export/csv?collectionId=${col.id}`)).text;
  assert.match(csvText, /premium; rare/, 'multiselect exported joined');

  // reimport the same CSV -> types must be restored, not stored as strings
  const preview = await request(app).post(`/api/import/csv/preview?collectionId=${col.id}`).attach('file', Buffer.from(csvText), 'gear.csv');
  const commit = await request(app).post('/api/import/csv/commit').send({ token: preview.body.token, collectionId: col.id, mapping: preview.body.suggestedMapping });
  assert.strictEqual(commit.body.imported, 1);
  assert.strictEqual(commit.body.errors.length, 0);

  const after = (await request(app).get(`/api/items/${item.id}`)).body;
  assert.deepStrictEqual(after.fields.traits, ['premium', 'rare'], 'multiselect round-tripped back to an ARRAY');
  assert.strictEqual(after.fields.verified, true, 'checkbox round-tripped back to a BOOLEAN');

  // A4: emptying the multiselect cell and re-importing by id must CLEAR the field.
  const rows = 'id,name,field:traits,field:verified\n' + `${item.id},Widget,,true\n`;
  const p2 = await request(app).post(`/api/import/csv/preview?collectionId=${col.id}`).attach('file', Buffer.from(rows), 'clear.csv');
  await request(app).post('/api/import/csv/commit').send({ token: p2.body.token, collectionId: col.id, mapping: p2.body.suggestedMapping });
  const cleared = (await request(app).get(`/api/items/${item.id}`)).body;
  assert.strictEqual(cleared.fields.traits, undefined, 'explicitly-empty mapped cell cleared the multiselect field');
});

// H10: importing an export into the WRONG collection must error the row (its id
// belongs to another collection), not silently insert a duplicate.
test('H10: importing a row whose id belongs to a different collection errors instead of duplicating', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const colA = (await request(app).post('/api/collections').send({ name: 'A' })).body;
  const colB = (await request(app).post('/api/collections').send({ name: 'B' })).body;
  const itemA = (await request(app).post('/api/items').send({ collectionId: colA.id, name: 'Belongs to A' })).body;

  // Export A, then try to commit it into B.
  const csvText = (await request(app).get(`/api/export/csv?collectionId=${colA.id}`)).text;
  const preview = await request(app).post(`/api/import/csv/preview?collectionId=${colB.id}`).attach('file', Buffer.from(csvText), 'a.csv');
  const commit = await request(app).post('/api/import/csv/commit').send({ token: preview.body.token, collectionId: colB.id, mapping: preview.body.suggestedMapping });

  assert.strictEqual(commit.body.imported, 0, 'no insert into the wrong collection');
  assert.strictEqual(commit.body.errors.length, 1, 'the cross-collection row is errored');
  assert.match(commit.body.errors[0].message, /another collection/i);
  // B stays empty; A unchanged (still 1 item).
  assert.strictEqual((await request(app).get(`/api/collections/${colB.id}/items`)).body.total, 0, 'B not populated');
  assert.strictEqual((await request(app).get(`/api/collections/${colA.id}/items`)).body.total, 1, 'A unchanged');
  void itemA;
});

test('myArmsCache-style import: empty column does not clobber name; nameless rows and comma quantities import', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);

  // Firearms export style: "Name" populated, "Item #" empty. The empty Item #
  // must not be suggested as core:name, and must not overwrite the real Name.
  const guns = (await request(app).post('/api/collections').send({ name: 'Firearms', templateKey: 'firearms' })).body;
  const gunCsv = 'Name,Item #,Manufacturer,Serial #\r\n"Lemon Squeezer",,Smith & Wesson,179968\r\n';
  const gp = await request(app).post(`/api/import/csv/preview?collectionId=${guns.id}`).attach('file', Buffer.from(gunCsv), 'guns.csv');
  assert.strictEqual(gp.body.suggestedMapping['Name'], 'core:name');
  assert.notStrictEqual(gp.body.suggestedMapping['Item #'], 'core:name', 'Item # must not also claim name');
  const gc = await request(app).post('/api/import/csv/commit').send({ token: gp.body.token, collectionId: guns.id, mapping: gp.body.suggestedMapping });
  assert.strictEqual(gc.body.imported, 1);
  assert.strictEqual(gc.body.skipped, 0);
  const gItems = (await request(app).get(`/api/collections/${guns.id}/items`)).body.items;
  assert.strictEqual(gItems[0].name, 'Lemon Squeezer', 'real name kept, not clobbered by empty Item #');

  // Ammo export style: no Name value; quantity has a thousands comma.
  const ammo = (await request(app).post('/api/collections').send({ name: 'Ammo', templateKey: 'ammunition' })).body;
  const ammoCsv = 'Caliber,Manufacturer,Name,Rounds Purchased\r\n.22 LR,Federal,,"1,625"\r\n';
  const ap = await request(app).post(`/api/import/csv/preview?collectionId=${ammo.id}`).attach('file', Buffer.from(ammoCsv), 'ammo.csv');
  const ac = await request(app).post('/api/import/csv/commit').send({ token: ap.body.token, collectionId: ammo.id, mapping: ap.body.suggestedMapping });
  assert.strictEqual(ac.body.imported, 1, 'nameless ammo row still imports');
  assert.strictEqual(ac.body.errors.length, 0, 'thousands-comma quantity does not error');
  const aItems = (await request(app).get(`/api/collections/${ammo.id}/items`)).body.items;
  assert.match(aItems[0].name, /Federal|\.22 LR/, 'name derived from manufacturer/caliber');
  assert.strictEqual(aItems[0].quantity, 1625, 'thousands comma parsed to 1625');
});
