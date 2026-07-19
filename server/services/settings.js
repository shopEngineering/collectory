'use strict';
const os = require('os');
const crypto = require('crypto');

// Settings live in the `settings` key/value table. Defaults are applied on read.
const DEFAULTS = {
  lan_enabled: '0',
  currency: 'USD',
  port: '7117',
  theme: 'system',
  report_owner: '',
};

function get(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row && row.value != null) return row.value;
  return DEFAULTS[key] != null ? DEFAULTS[key] : null;
}

function set(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value == null ? null : String(value));
}

function del(db, key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

// Per-install secret used to sign the PIN cookie. Generated + stored on first use.
function cookieSecret(db) {
  let s = get(db, 'cookie_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    set(db, 'cookie_secret', s);
  }
  return s;
}

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

// Enumerate non-internal IPv4 addresses -> LAN URLs.
function lanUrls(port) {
  const urls = [];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${port}`);
    }
  }
  return urls;
}

module.exports = { DEFAULTS, get, set, del, cookieSecret, hashPin, lanUrls };
