'use strict';
const settingsSvc = require('../services/settings');

// Requests exempt from the gate regardless of origin (so the PIN screen can load).
const OPEN_API_PATHS = new Set(['/api/health', '/api/auth/pin']);

function isLoopback(ip) {
  if (!ip) return true; // no address -> treat as local (in-process/test)
  // Normalize IPv6-mapped IPv4 (::ffff:127.0.0.1)
  const addr = ip.replace(/^::ffff:/, '');
  return addr === '127.0.0.1' || addr === '::1' || addr === 'localhost' || addr.startsWith('127.');
}

// Which requests are gated? /api/* (except open paths), /images, /attachments.
// Static client assets (everything else) are always served.
function isGatedPath(pathName) {
  if (OPEN_API_PATHS.has(pathName)) return false;
  return pathName.startsWith('/api/') || pathName.startsWith('/images') || pathName.startsWith('/attachments');
}

// Build the LAN gate middleware. `ctx` provides db (mutable) for settings/cookie checks.
function makeLanGate(ctx) {
  return function lanGate(req, res, next) {
    const remote = req.ip || (req.socket && req.socket.remoteAddress);
    if (isLoopback(remote)) return next(); // loopback always allowed
    if (!isGatedPath(req.path)) return next(); // static assets always served

    const db = ctx.db;
    const enabled = settingsSvc.get(db, 'lan_enabled') === '1';
    if (!enabled) {
      return res.status(403).json({ error: { message: 'LAN access is disabled', code: 'LAN_DISABLED' } });
    }
    const pinHash = settingsSvc.get(db, 'lan_pin_hash');
    if (pinHash) {
      const cookieOk = req.signedCookies && req.signedCookies.collectory_pin === '1';
      if (!cookieOk) {
        return res.status(401).json({ error: { message: 'PIN required', code: 'PIN_REQUIRED' } });
      }
    }
    return next();
  };
}

module.exports = { makeLanGate, isLoopback, isGatedPath, OPEN_API_PATHS };
