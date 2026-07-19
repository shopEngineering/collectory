# Shell & Packaging — Build Notes

Agent: **Desktop Shell**. Scope owned: `electron/`, `build/`, `.github/workflows/`, app-icon
image files in `client/public/`. Built against `docs/specs/DESIGN.md` §2, §5.1, §7.

## What was built

### `electron/main.js` (CommonJS)
- **Single-instance lock** (`app.requestSingleInstanceLock()`); `second-instance` focuses/restores the
  existing window.
- **Data dir** = `app.getPath('userData')` (`~/Library/Application Support/Collectory`), passed to the
  server as `start({ dataDir })`.
- **Server bootstrap is fault-tolerant** (server does not exist yet): `require(path.join(__dirname,
  '..', 'server', 'index.js'))` and `await server.start({ dataDir })` are wrapped in try/catch. On a
  missing module OR a rejected `start()`, it logs the error and loads a **self-contained `data:` URL
  error page** (dark, branded, shows the stack + data dir) so a window always opens. The server's
  returned `port` (default 7117) is used for the loaded URL when start succeeds.
- **Dev override:** `ELECTRON_START_URL` (e.g. Vite `http://localhost:5173`) takes precedence for the
  loaded URL; the server is still started in-process if available (Vite proxies `/api`, `/images`).
- **BrowserWindow:** 1360×860, min 980×640, `titleBarStyle: 'hiddenInset'`, `backgroundColor:
  '#141414'`, `show: false` → shown on `ready-to-show`. `contextIsolation: true`, `nodeIntegration:
  false`, `sandbox: false` (needed so preload can `require('electron')`).
- **External links:** `setWindowOpenHandler` sends any `http(s)` `target=_blank`/`window.open` to
  `shell.openExternal` and denies the in-app window; a `will-navigate` guard does the same for plain
  `<a href>` navigations to non-local origins.
- **macOS application menu:**
  - **Collectory** — About, Settings… (`⌘,` → `navigate('/settings')`), Services, Hide/Quit.
  - **File** — Import CSV… (`/import`), Backup Now (`/settings?backup=1`), Insurance Report… (`/report`).
  - **Edit / View / Window** — standard roles.
  - Menu → SPA navigation via `win.webContents.send('navigate', path)`.
- **Lifecycle:** `window-all-closed` quits only on non-mac; on mac the app stays alive (server runs
  in-process) and `activate` recreates the window.
- **IPC:** `ipcMain.handle('collectory:getVersion')` → `app.getVersion()` for the preload version fallback.

### `electron/preload.js` (CommonJS)
`contextBridge.exposeInMainWorld('collectory', …)` — minimal surface only:
- `platform` (`process.platform`, `'darwin'` on the Mac build),
- `version` (`process.env.npm_package_version` when present) + `getVersion()` async IPC fallback,
- `onNavigate(cb)` — subscribes to the `'navigate'` channel, returns an unsubscribe function.

Nothing else is exposed (no Node, no ipcRenderer surface beyond the wired channel).

### `.github/workflows/release.yml`
- Trigger: `push` tags `v*`. `permissions: contents: write`.
- Matrix: **macos-14 (arm64)** + **macos-13 (x64)**, `fail-fast: false`.
- Steps: checkout → setup-node 20 (npm cache) → `npm ci` → `npm --prefix client ci` → `npm run build`
  (client Vite build) → `npx electron-builder --mac --publish always` with `env.GH_TOKEN =
  secrets.GITHUB_TOKEN`. Artifact naming left to electron-builder. No untrusted input used in `run:`
  steps (only the token via env), so it is injection-safe.

### `build/entitlements.mac.plist`
**Not created.** Not required — the build is unsigned/not hardened-runtime, and the electron-builder
config in root `package.json` does not reference entitlements. First-open is handled by the README
instructions below.

## App icon — how it was made

Art direction: squircle macOS-style icon, deep forest-green background w/ vertical gradient + fine
brass inner border; centered brass/antique-gold monogram "C" as a **thick ring with a right-side gap**
enclosing a **2×2 grid of four brass dots** (specimen display case). Flat/premium, no bevel/gloss.

Pipeline (Playwright MCP, since `file:` is blocked and `qlmanage` was the documented fallback):
1. Authored **`build/icon-source.html`** — 1024×1024 inline SVG. Squircle drawn as a
   continuous-curvature rounded-rect path (box 104..920, ~10% padding per the macOS icon grid);
   vertical forest-green gradient (`#274d36 → #20402c → #173021`); subtle top sheen; fine brass inner
   border (`#c9a961` @ 0.26 opacity); brass gradient (`#e0c584 → #c9a961 → #a8863f`); C ring r=210,
   stroke 84, round caps, gap centered on the right (±40°); four dots r=30 on a 96px pitch centered on
   canvas center.
2. Served `build/` over `http://127.0.0.1:8791` (python http.server) and navigated Playwright there.
3. Rendered with `element.screenshot({ omitBackground: true })` at a 1024×1024 viewport →
   **`build/icon.png`** = 1024×1024 **RGBA with transparent corners** (required so electron-builder's
   `.icns` generation doesn't fill the corners white). Verified corner pixel `(0,0,0,0)`, center
   `(32,65,45,255)`, `sips` reports 1024×1024, hasAlpha yes.
4. Authored **`build/icon-fullbleed.html`** — same motif on a **full-bleed** green square (no squircle,
   no transparency), motif scaled ~1.18× → **`build/icon-fullbleed.png`**. This is the source for the
   iOS home-screen icon (iOS masks corners itself, so full-bleed avoids white corners and the crop).
5. Derived icons via `sips`:
   - `client/public/icon-512.png` (512, transparent) — from `icon.png`
   - `client/public/icon-192.png` (192, transparent, PWA maskable) — from `icon.png`
   - `client/public/favicon.png` (64, transparent) — from `icon.png`
   - `client/public/apple-touch-icon.png` (180, **non-transparent full-bleed**) — from `icon-fullbleed.png`
6. Verified each at small size by eye (Read tool) — C, gap, and dots stay legible at 64–192px.

Source HTML files (`icon-source.html`, `icon-fullbleed.html`) are kept in `build/` so the icon can be
re-rendered/tweaked later. `icon-fullbleed.png` is a build artifact retained as the apple-touch source.

## Deviations from DESIGN.md

- **None material.** Preload `platform` is `process.platform` (resolves to `'darwin'` on the packaged
  Mac app, per §7) rather than a hardcoded literal — keeps it correct if ever run elsewhere.
- The `will-navigate` external-link guard was added in addition to `setWindowOpenHandler` (§7 mentions
  external links generally) — belt-and-suspenders, not a deviation.
- `sandbox: false` in `webPreferences` — required for a `require('electron')` preload with
  contextIsolation; standard for this pattern.

## Environment issues worked around during `npm install`

The install has **no code deviations** but required environment workarounds (root `package.json`
unchanged):
- **Node 25.1.0** is the only Node on this machine (project engines want `>=20`; no nvm/fnm/volta/n
  present). Install and Electron run succeeded on Node 25 anyway. CI pins Node 20, which is correct.
- **`better-sqlite3` native build failed** initially: system Python is **3.14**, which removed
  `distutils`, and node-gyp 9.4.1 imports `distutils.version`. Fixed by creating a throwaway venv with
  `setuptools` (which vendors `distutils`) and pointing node-gyp at it via
  `PYTHON=<venv>/bin/python npm install`. After that, `electron-builder install-app-deps` rebuilt
  `better_sqlite3.node` for Electron 33.4.11 arm64 cleanly. (This is a machine-setup issue, not a
  package.json issue — CI on macos-13/14 with setup-node 20 will have a working toolchain.)
- npm 11 printed an `allow-scripts` **pending** warning for `better-sqlite3` and `electron`
  postinstall scripts; the scripts nonetheless ran (native module + Electron dist are present and
  functional). Not blocking.

## Root `package.json` changes needed

**None.** The existing root `package.json` already contains everything the shell needs:
- `main: electron/main.js` ✓
- deps: `electron`, `electron-builder`, `better-sqlite3` (+ server deps) ✓
- scripts: `dev`, `dev:app` (uses `ELECTRON_START_URL`), `server`, `build`, `dist`, `release`,
  `postinstall: electron-builder install-app-deps` ✓
- electron-builder `build` block: appId `com.collectory.app`, productName `Collectory`, mac
  `dmg`+`zip`, `icon: build/icon.png`, `asarUnpack: ['**/*.node']`, `npmRebuild: true`, `files`
  includes `electron/**`, `server/**`, `client/dist/**`, `package.json`, github publish provider ✓

One reconciliation note for the orchestrator: the electron-builder `directories.output` is `release`,
but the root `dev` script and DESIGN don't mention it — the `.github` workflow relies on
electron-builder defaults for artifact naming, so this is fine. No action required.

## Release process summary

1. Bump `version` in root `package.json`, commit.
2. Tag and push: `git tag v1.0.0 && git push origin v1.0.0`.
3. `release.yml` fires on the `v*` tag → macos-14 (arm64) + macos-13 (x64) → builds the client, runs
   `electron-builder --mac --publish always`, uploads the DMG + ZIP (+ `latest-mac.yml`) to a **GitHub
   Release** for that tag using the automatic `GITHUB_TOKEN`.
4. The Release contains a DMG per arch. Users download and drag Collectory to Applications.

### Unsigned-app first-open (for the README — client/orchestrator owns README copy)

The build is **unsigned and un-notarized**, so Gatekeeper blocks the first launch. Document one of:

- **Right-click → Open:** right-click (or Control-click) `Collectory.app` in Applications → **Open** →
  confirm **Open** in the dialog. Only needed once.
- **Or via Terminal:** `xattr -cr /Applications/Collectory.app` then launch normally.

(These belong in the top-level `README.md`, which is orchestrator/client-owned — flagging the exact
copy here so it can be dropped in.)

## Verification performed

- `npm install` completed: 562 packages, `better_sqlite3.node` rebuilt for Electron 33.4.11 arm64,
  `node_modules/electron/dist/Electron.app` present, `electron --version` = v33.4.11.
- `node --check` passes on `electron/main.js` and `electron/preload.js`.
- **`npx electron .` (server absent):** app launched, `require` threw `MODULE_NOT_FOUND` for
  `server/index.js`, the try/catch logged `[collectory] embedded server failed to start`, the renderer
  loaded the branded `data:` error page, and the process stayed alive with a window open (no crash).
  Killed cleanly afterward. (The Electron CSP dev-warning in the log is expected for a `data:` URL page
  and does not appear once packaged.)
- All icons verified with `sips` (dimensions/alpha) and by eye at multiple sizes.
