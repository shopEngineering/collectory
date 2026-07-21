'use strict';
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { freshApp, cleanup } = require('./helpers');
const { makeLanGate, isLoopback, isGatedPath } = require('../middleware/lanGate');
const settingsSvc = require('../services/settings');

// --- LAN gate unit tests (mocked req, per DESIGN.md §4) ---

function mockReq(ip, pathName, signedCookies) {
  return { ip, path: pathName, socket: { remoteAddress: ip }, signedCookies: signedCookies || {} };
}
function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

test('isLoopback / isGatedPath helpers', () => {
  assert.ok(isLoopback('127.0.0.1'));
  assert.ok(isLoopback('::1'));
  assert.ok(isLoopback('::ffff:127.0.0.1'));
  assert.ok(!isLoopback('192.168.1.50'));
  assert.ok(isGatedPath('/api/items/1'));
  assert.ok(isGatedPath('/images/orig/x.jpg'));
  assert.ok(isGatedPath('/attachments/x.pdf'));
  assert.ok(!isGatedPath('/api/health'));
  assert.ok(!isGatedPath('/api/auth/pin'));
  assert.ok(!isGatedPath('/assets/app.js')); // static client asset
});

test('LAN gate: loopback always allowed even when disabled', (t) => {
  const { dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const gate = makeLanGate(ctx);
  let nexted = false;
  gate(mockReq('127.0.0.1', '/api/items/1'), mockRes(), () => (nexted = true));
  assert.ok(nexted, 'loopback passes through');
});

test('LAN gate: non-loopback rejected 403 when disabled', (t) => {
  const { dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const gate = makeLanGate(ctx);
  const res = mockRes();
  let nexted = false;
  gate(mockReq('192.168.1.20', '/api/items/1'), res, () => (nexted = true));
  assert.ok(!nexted);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.error.code, 'LAN_DISABLED');
});

test('LAN gate: enabled without PIN allows non-loopback API', (t) => {
  const { dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  settingsSvc.set(ctx.db, 'lan_enabled', '1');
  const gate = makeLanGate(ctx);
  let nexted = false;
  gate(mockReq('192.168.1.20', '/api/items/1'), mockRes(), () => (nexted = true));
  assert.ok(nexted, 'enabled + no PIN passes');
});

test('LAN gate: enabled with PIN requires cookie -> 401 PIN_REQUIRED', (t) => {
  const { dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  settingsSvc.set(ctx.db, 'lan_enabled', '1');
  settingsSvc.set(ctx.db, 'lan_pin_hash', settingsSvc.hashPin('1234'));
  const gate = makeLanGate(ctx);

  // no cookie -> 401
  const res = mockRes();
  gate(mockReq('192.168.1.20', '/api/items/1'), res, () => {});
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.error.code, 'PIN_REQUIRED');

  // valid cookie -> passes
  let nexted = false;
  gate(mockReq('192.168.1.20', '/api/items/1', { collectory_pin: '1' }), mockRes(), () => (nexted = true));
  assert.ok(nexted, 'valid signed cookie passes');

  // static assets always served even with PIN set
  let staticNexted = false;
  gate(mockReq('192.168.1.20', '/assets/app.js'), mockRes(), () => (staticNexted = true));
  assert.ok(staticNexted, 'static asset served so PIN screen can load');
});

// C4: a spoofed X-Forwarded-For must NOT make a LAN peer look like loopback and
// bypass the gate. The gate reads the real socket peer, never req.ip / XFF.
test('C4: spoofed X-Forwarded-For does not bypass the gate (uses real socket peer)', (t) => {
  const { dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const gate = makeLanGate(ctx); // LAN disabled by default

  // Simulate Express having trusted a forged XFF (req.ip = 127.0.0.1) while the
  // real socket peer is a LAN address. The gate must reject, not pass.
  const spoofed = {
    ip: '127.0.0.1', // attacker-forged, must be ignored
    path: '/api/export/json',
    socket: { remoteAddress: '192.168.1.66' }, // the real peer
    signedCookies: {},
  };
  const res = mockRes();
  let nexted = false;
  gate(spoofed, res, () => (nexted = true));
  assert.ok(!nexted, 'forged loopback did not pass the gate');
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.error.code, 'LAN_DISABLED');
});

// --- Settings + auth integration ---

test('settings GET/PATCH and PIN auth flow', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);

  const s0 = await request(app).get('/api/settings');
  assert.strictEqual(s0.status, 200);
  assert.strictEqual(s0.body.lanEnabled, false);
  assert.strictEqual(s0.body.lanPinSet, false);
  assert.strictEqual(s0.body.currency, 'USD');
  assert.ok('version' in s0.body);
  assert.ok(Array.isArray(s0.body.lanUrls));

  await request(app).patch('/api/settings').send({ lanEnabled: true, lanPin: '4321', currency: 'EUR' });
  const s1 = await request(app).get('/api/settings');
  assert.strictEqual(s1.body.lanEnabled, true);
  assert.strictEqual(s1.body.lanPinSet, true);
  assert.strictEqual(s1.body.currency, 'EUR');

  // wrong pin
  const bad = await request(app).post('/api/auth/pin').send({ pin: '0000' });
  assert.strictEqual(bad.status, 401);
  // right pin -> cookie
  const good = await request(app).post('/api/auth/pin').send({ pin: '4321' });
  assert.strictEqual(good.status, 200);
  assert.ok(good.headers['set-cookie'], 'sets a cookie');

  // clear pin
  await request(app).patch('/api/settings').send({ lanPin: '' });
  const s2 = await request(app).get('/api/settings');
  assert.strictEqual(s2.body.lanPinSet, false);
});

test('stats endpoint returns dashboard shape', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const col = (await request(app).post('/api/collections').send({ name: 'Guns', templateKey: 'firearms' })).body;
  await request(app).post('/api/items').send({ collectionId: col.id, name: 'A', acquiredDate: '2026-01-15', currentValueCents: 100000 });
  const stats = await request(app).get('/api/stats');
  assert.strictEqual(stats.status, 200);
  assert.ok('totals' in stats.body && 'byCollection' in stats.body && 'recentItems' in stats.body);
  assert.ok('acquisitionTimeline' in stats.body && 'alerts' in stats.body && 'recentLogs' in stats.body);
  assert.strictEqual(stats.body.totals.items, 1);
  assert.strictEqual(stats.body.totals.valueCents, 100000);
});
