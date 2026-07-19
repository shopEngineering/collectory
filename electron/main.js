'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const { checkForUpdates } = require('./updater');

// Keep the data directory named "Collectory" regardless of the display name
// ("The Collectory" productName). This decouples the on-disk store from the
// brand: it stays in sync with the headless server (server/index.js) and a
// rename never orphans an existing user's data. Must run before userData is
// first used (single-instance lock, bootstrap).
app.setPath('userData', path.join(app.getPath('appData'), 'Collectory'));

// ---------------------------------------------------------------------------
// Single-instance lock. If another instance is already running, focus it and
// bail out of this process immediately.
// ---------------------------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  main();
}

/** @type {BrowserWindow | null} */
let win = null;
/** The URL the window should load once the server is up (or the error page). */
let loadTarget = null;

function main() {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(bootstrap);

  // On macOS the server runs in-process, so keep the app alive when all windows
  // are closed and recreate the window on dock activate. On other platforms,
  // quit fully.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

/**
 * Start the embedded server (if it exists) then create the window. The server
 * does not exist during early development — treat a missing module or a
 * rejected start() as a soft failure: log an inline error page but still open a
 * window so the shell is always usable.
 */
async function bootstrap() {
  const dataDir = app.getPath('userData');
  const devUrl = process.env.ELECTRON_START_URL;

  let serverError = null;
  let port = 7117;

  try {
    // Resolve the server relative to the app root, not the electron/ folder.
    const serverPath = path.join(__dirname, '..', 'server', 'index.js');
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const server = require(serverPath);
    if (!server || typeof server.start !== 'function') {
      throw new Error('server/index.js does not export start()');
    }
    const result = await server.start({ dataDir });
    if (result && result.port) port = result.port;
  } catch (err) {
    serverError = err;
    console.error('[collectory] embedded server failed to start:', err);
  }

  if (devUrl) {
    // Dev override: load Vite regardless of server state (server, if it
    // started, still backs /api and /images via the Vite proxy).
    loadTarget = devUrl;
  } else if (serverError) {
    loadTarget = errorPageUrl(serverError, dataDir);
  } else {
    loadTarget = `http://127.0.0.1:${port}`;
  }

  buildMenu();
  createWindow();

  // Quietly check for a newer release a few seconds after launch (production only).
  if (!devUrl && !serverError) {
    setTimeout(() => checkForUpdates({ silent: true }), 4000);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#141414',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    win = null;
  });

  // Route external http(s) links (target=_blank / window.open) to the default
  // browser instead of opening app windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  // Catch in-page navigations to external origins (e.g. plain <a href>).
  win.webContents.on('will-navigate', (event, url) => {
    const target = loadTarget || '';
    const isLocal =
      url.startsWith('http://127.0.0.1') ||
      url.startsWith('http://localhost') ||
      url.startsWith('data:') ||
      (target && url.startsWith(target));
    if (!isLocal && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (loadTarget) win.loadURL(loadTarget);
}

/** Send a navigation instruction to the SPA. */
function navigate(pathname) {
  if (win && win.webContents) win.webContents.send('navigate', pathname);
}

/**
 * Build the macOS application menu. Custom items navigate the SPA via the
 * 'navigate' IPC channel; standard roles cover Edit/View/Window.
 */
function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: 'The Collectory',
            submenu: [
              { role: 'about', label: 'About The Collectory' },
              { label: 'Check for Updates…', click: () => checkForUpdates({ silent: false }) },
              { type: 'separator' },
              {
                label: 'Settings…',
                accelerator: 'Cmd+,',
                click: () => navigate('/settings'),
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide', label: 'Hide The Collectory' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit', label: 'Quit The Collectory' },
            ],
          },
        ]
      : []),
    // File
    {
      label: 'File',
      submenu: [
        { label: 'Import CSV…', click: () => navigate('/import') },
        { label: 'Backup Now', click: () => navigate('/settings?backup=1') },
        { label: 'Insurance Report…', click: () => navigate('/report') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    // Edit (standard)
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
            ]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
      ],
    },
    // View (standard)
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    // Window (standard)
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' },
            ]
          : [{ role: 'close' }]),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Build a self-contained data: URL error page shown when the embedded server
 * cannot start. No external resources so it renders even fully offline.
 */
function errorPageUrl(err, dataDir) {
  const message = (err && (err.stack || err.message || String(err))) || 'Unknown error';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>The Collectory — Startup Error</title>
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; margin: 0; }
  body {
    background: #141414;
    color: #e8e6e1;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center;
    -webkit-app-region: drag;
    padding: 48px;
  }
  .card {
    -webkit-app-region: no-drag;
    max-width: 640px; width: 100%;
    background: #1b1b1b; border: 1px solid #2c2c2c; border-radius: 14px;
    padding: 32px 36px;
    box-shadow: 0 12px 48px rgba(0,0,0,.4);
  }
  h1 { font-size: 20px; margin: 0 0 6px; color: #fff; font-weight: 600; }
  .sub { color: #9a978f; margin: 0 0 22px; font-size: 13px; }
  .badge {
    display: inline-block; margin-bottom: 18px; padding: 3px 10px;
    border-radius: 999px; background: #3a2a12; color: #c9a961;
    font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  }
  pre {
    margin: 0; padding: 16px; border-radius: 10px;
    background: #101010; border: 1px solid #262626; color: #d68d7a;
    font: 12px/1.5 "SF Mono", ui-monospace, Menlo, monospace;
    white-space: pre-wrap; word-break: break-word; overflow: auto; max-height: 220px;
  }
  .dir { margin-top: 18px; font-size: 12px; color: #7d7a72; }
  .dir code { color: #a8a49b; }
</style>
</head>
<body>
  <div class="card">
    <span class="badge">The Collectory</span>
    <h1>The app couldn't start its data engine</h1>
    <p class="sub">The embedded server failed to launch. Your data is untouched. The details below help diagnose the issue.</p>
    <pre>${escapeHtml(message)}</pre>
    <p class="dir">Data directory: <code>${escapeHtml(dataDir)}</code></p>
  </div>
</body>
</html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// IPC: renderer can request the app version (preload exposes it lazily).
ipcMain.handle('collectory:getVersion', () => app.getVersion());
