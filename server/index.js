'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cookieParser = require('cookie-parser');

const { openDatabase } = require('./db');
const { loadTemplates } = require('./services/templates');
const settingsSvc = require('./services/settings');
const imageStore = require('./services/imageStore');
const backupSvc = require('./services/backup');
const { makeLanGate } = require('./middleware/lanGate');
const { HttpError } = require('./util/errors');

const collectionsRouter = require('./routes/collections');
const itemsRouter = require('./routes/items');
const logsRouter = require('./routes/logs');
const magazinesRouter = require('./routes/magazines');
const photosRouter = require('./routes/photos');
const miscRouter = require('./routes/misc');
const exchangeRouter = require('./routes/exchange');
const systemRouter = require('./routes/system');

const DEFAULT_PORT = 7117;
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');

// Platform data directory (matches Electron app.getPath('userData') on macOS).
function defaultDataDir() {
  if (process.env.COLLECTORY_DATA_DIR) return path.resolve(process.env.COLLECTORY_DATA_DIR);
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Collectory');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Collectory');
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'Collectory');
}

function readVersion() {
  try {
    return require('../package.json').version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Build the Express app against a data directory. Runs migrations, loads
// templates, wires routes. Synchronous (returns app) — safe for tests.
function createApp(dataDir) {
  dataDir = dataDir || defaultDataDir();
  imageStore.ensureDirs(dataDir);
  const dbPath = path.join(dataDir, 'collectory.db');
  const version = readVersion();

  // ctx carries a mutable db handle so the restore route can hot-swap it.
  // `db` is a stable Proxy that always forwards to the CURRENT underlying handle
  // (`_db`), so code that captured `ctx.db` once still targets the live connection
  // after a restore reopens it.
  const ctx = {
    dataDir,
    version,
    port: DEFAULT_PORT,
    _db: openDatabase(dbPath),
    templates: loadTemplates(console),
    closeDb() {
      try {
        this._db.close();
      } catch {
        /* ignore */
      }
    },
    reopenDb() {
      this._db = openDatabase(dbPath);
    },
  };
  ctx.db = new Proxy(
    {},
    {
      get(_t, prop) {
        const target = ctx._db;
        const val = target[prop];
        return typeof val === 'function' ? val.bind(target) : val;
      },
    }
  );

  const app = express();
  app.set('trust proxy', true);
  app.locals.ctx = ctx;

  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser(settingsSvc.cookieSecret(ctx.db)));

  // LAN gate (loopback always allowed; static assets always served)
  app.use(makeLanGate(ctx));

  // Static media (gated for non-loopback by the middleware above)
  app.use('/images/orig', express.static(path.join(dataDir, 'images', 'orig')));
  app.use('/images/thumb', express.static(path.join(dataDir, 'images', 'thumb')));

  // Attachments: set Content-Disposition to the stored original name (§4), then
  // fall through to static file serving.
  app.get('/attachments/:filename', (req, res, next) => {
    const row = ctx.db.prepare('SELECT original_name, mime FROM attachments WHERE filename = ?').get(req.params.filename);
    if (row) {
      const safe = String(row.original_name || req.params.filename).replace(/[\r\n"]/g, '_');
      res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
      if (row.mime) res.type(row.mime);
    }
    next();
  });
  app.use('/attachments', express.static(path.join(dataDir, 'attachments')));

  // API routers (all mounted under /api)
  const api = express.Router();
  api.use(miscRouter(ctx)); // health, search, stats, ammo-choices
  api.use(collectionsRouter(ctx));
  api.use(itemsRouter(ctx));
  api.use(logsRouter(ctx));
  api.use(magazinesRouter(ctx));
  api.use(photosRouter(ctx));
  api.use(exchangeRouter(ctx));
  api.use(systemRouter(ctx));
  app.use('/api', api);

  // Unknown /api route -> 404 JSON
  app.use('/api', (req, res) => {
    res.status(404).json({ error: { message: 'not found', code: 'NOT_FOUND' } });
  });

  // SPA: serve client/dist statically; fall back to index.html for non-/api GET.
  // client/dist may not exist yet (built by another agent) — handle gracefully
  // and pick it up lazily once present.
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res, next) => {
    if (req.method !== 'GET') return next();
    const indexPath = path.join(CLIENT_DIST, 'index.html');
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    res
      .status(200)
      .type('html')
      .send(
        `<!doctype html><meta charset="utf-8"><title>The Collectory</title>
         <div style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#333">
           <h1>The Collectory</h1>
           <p>The server is running, but the client has not been built yet.</p>
           <p>Run <code>npm run build</code> to build the web client, then reload.</p>
           <p>The API is live at <code>/api/health</code>.</p>
         </div>`
      );
  });

  // Central error middleware
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: { message: error.message, code: error.code } });
    }
    // multer errors
    if (error && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: { message: 'file too large', code: 'FILE_TOO_LARGE' } });
    }
    if (error && error.type === 'entity.too.large') {
      return res.status(413).json({ error: { message: 'request body too large', code: 'BODY_TOO_LARGE' } });
    }
    // eslint-disable-next-line no-console
    console.error('[error]', error);
    res.status(500).json({ error: { message: 'internal server error', code: 'INTERNAL' } });
  });

  app._collectoryCtx = ctx; // exposed for tests / restore
  return app;
}

// start({dataDir, port}) -> Promise<{app, server, port}>. Listens on 0.0.0.0.
function start(opts = {}) {
  return new Promise((resolve, reject) => {
    const dataDir = opts.dataDir || defaultDataDir();
    const app = createApp(dataDir);
    const ctx = app._collectoryCtx;
    const port = opts.port || Number(settingsSvc.get(ctx.db, 'port')) || DEFAULT_PORT;
    ctx.port = port;
    const server = app.listen(port, '0.0.0.0', () => {
      // Auto-backup rotation runs async after listen so startup isn't blocked.
      backupSvc.maybeAutoBackup(ctx.db, dataDir, ctx.version).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[auto-backup] failed:', e.message);
      });
      resolve({ app, server, port });
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  start()
    .then(({ port, app }) => {
      // eslint-disable-next-line no-console
      console.log(`Collectory server listening on http://127.0.0.1:${port} (data: ${app._collectoryCtx.dataDir})`);
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error('Failed to start server:', e);
      process.exit(1);
    });
}

module.exports = { createApp, start, defaultDataDir };
