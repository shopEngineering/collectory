'use strict';
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { freshApp, cleanup } = require('./helpers');

test('migrations bootstrap: schema created, migration recorded, health ok', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);

  // _migrations records the init migration
  const migs = ctx.db.prepare('SELECT name FROM _migrations').all().map((r) => r.name);
  assert.ok(migs.includes('001_init.sql'), 'init migration recorded');

  // H5: photos(item_id) / photos(log_id) indices exist (migration 004)
  const indexes = new Set(
    ctx.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name)
  );
  assert.ok(indexes.has('idx_photos_item'), 'idx_photos_item present');
  assert.ok(indexes.has('idx_photos_log'), 'idx_photos_log present');

  // All core tables exist
  const tables = new Set(
    ctx.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  );
  for (const t2 of ['collections', 'field_defs', 'log_types', 'items', 'logs', 'photos', 'provenance', 'valuations', 'attachments', 'tags', 'item_tags', 'settings']) {
    assert.ok(tables.has(t2), `table ${t2} exists`);
  }
  // FTS virtual table exists
  assert.ok(tables.has('items_fts'), 'items_fts exists');

  // WAL + foreign keys pragmas
  assert.strictEqual(ctx.db.pragma('journal_mode', { simple: true }), 'wal');
  assert.strictEqual(ctx.db.pragma('foreign_keys', { simple: true }), 1);

  const res = await request(app).get('/api/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
});

test('migrations are idempotent across reopen', async (t) => {
  const { app, dataDir, ctx } = freshApp();
  cleanup(t, dataDir, ctx);
  const before = ctx.db.prepare('SELECT COUNT(*) AS c FROM _migrations').get().c;
  ctx.closeDb();
  ctx.reopenDb(); // re-runs migration runner; should not error or double-apply
  const after = ctx.db.prepare('SELECT COUNT(*) AS c FROM _migrations').get().c;
  assert.ok(before >= 1, 'at least one migration applied');
  assert.strictEqual(after, before, 'reopen does not double-apply migrations');
});
