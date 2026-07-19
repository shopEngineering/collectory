'use strict';

// Minimal, locked-down bridge. The renderer (the SPA) sees exactly one object,
// window.collectory, and nothing else from Node/Electron.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('collectory', {
  // Platform is fixed for the packaged Mac app; kept as a field so the client
  // can branch (e.g. add the titlebar drag strip) without touching process.
  platform: process.platform,

  // App version. process.env is populated by Electron for the packaged app;
  // fall back to an async IPC round-trip when the env var is absent (dev).
  version: process.env.npm_package_version || null,
  getVersion: () => ipcRenderer.invoke('collectory:getVersion'),

  // Menu → SPA navigation. The main process sends ('navigate', path); the
  // client subscribes here. Returns an unsubscribe function.
  onNavigate(cb) {
    if (typeof cb !== 'function') return () => {};
    const listener = (_event, pathname) => cb(pathname);
    ipcRenderer.on('navigate', listener);
    return () => ipcRenderer.removeListener('navigate', listener);
  },
});
