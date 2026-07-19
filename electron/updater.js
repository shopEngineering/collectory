'use strict';

// Lightweight update checker. Queries the public GitHub Releases API, compares
// the latest tag to the running version, and offers a one-click download of the
// DMG matching this Mac's architecture. This is a notify-and-download flow, not
// a silent background install: fully-silent auto-update on macOS additionally
// requires an Apple Developer ID signature (the ad-hoc signature we ship is
// rejected by the OS updater). No third-party dependency.

const https = require('https');
const { app, dialog, shell } = require('electron');

const REPO = 'shopEngineering/collectory';

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: 'api.github.com',
        path: `/repos/${REPO}/releases/latest`,
        headers: {
          'User-Agent': 'The-Collectory-Updater',
          Accept: 'application/vnd.github+json',
        },
        timeout: 10000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GitHub API responded ${res.statusCode}`));
          return;
        }
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Could not parse release data'));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

// True if `latest` is a newer semver than `current` ("v1.2.3" or "1.2.3").
function isNewer(current, latest) {
  const parse = (v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(current);
  const b = parse(latest);
  for (let i = 0; i < 3; i += 1) {
    if ((b[i] || 0) > (a[i] || 0)) return true;
    if ((b[i] || 0) < (a[i] || 0)) return false;
  }
  return false;
}

// Direct download URL for the .dmg matching this Mac's architecture, or the
// release page if no matching asset is found.
function assetForArch(release) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const dmg = (release.assets || []).find((a) => a.name.endsWith('.dmg') && a.name.includes(arch));
  return dmg ? dmg.browser_download_url : release.html_url;
}

async function checkForUpdates({ silent = false } = {}) {
  try {
    const release = await fetchLatestRelease();
    const latest = release.tag_name || release.name || '';
    if (isNewer(app.getVersion(), latest)) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        buttons: ['Download', 'Release Notes', 'Later'],
        defaultId: 0,
        cancelId: 2,
        title: 'Update Available',
        message: `The Collectory ${latest} is available.`,
        detail:
          `You have ${app.getVersion()}. Download the update, then drag it into ` +
          `Applications to replace this version — your data is left untouched.`,
      });
      if (response === 0) shell.openExternal(assetForArch(release));
      else if (response === 1) shell.openExternal(release.html_url);
    } else if (!silent) {
      await dialog.showMessageBox({
        type: 'info',
        buttons: ['OK'],
        title: 'Up to Date',
        message: `You're on the latest version (${app.getVersion()}).`,
      });
    }
  } catch (err) {
    console.error('[updater] check failed:', err.message);
    if (!silent) {
      await dialog.showMessageBox({
        type: 'warning',
        buttons: ['OK'],
        title: 'Update Check Failed',
        message: 'Could not check for updates right now.',
        detail: err.message,
      });
    }
  }
}

module.exports = { checkForUpdates };
