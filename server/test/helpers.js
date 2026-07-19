'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const { createApp } = require('../index');

// Create a fresh app with an isolated tmp data dir. Returns { app, dataDir, ctx }.
function freshApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectory-test-'));
  const app = createApp(dataDir);
  return { app, dataDir, ctx: app._collectoryCtx };
}

function cleanup(t, dataDir, ctx) {
  t.after(() => {
    try {
      ctx.closeDb();
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
}

module.exports = { freshApp, cleanup };
