# The Collectory

**Your collections. Your machine. Nobody else's business.**

The Collectory is a local-first collection manager for  any custom collection you define. Everything lives in a SQLite database and an image library on
your own Mac. **No servers, no cloud, no accounts, no telemetry.** Your records never leave your
machine unless you export them.

## What it does


- **Provenance & value** — ownership history chains, valuation history with sources, current vs.
  paid tracking, receipts/certificates attached to items.
- **Insurance report** — printable PDF-ready inventory with photos, serials (maskable), values,
  and totals, structured the way insurers ask for it.
- **CSV round-trip** — column-mapped bulk import (bring your spreadsheet in minutes) and full
  export, with a stable id column so export → edit in Excel → re-import updates instead of
  duplicating. Plus one-file full backup (database + all images) and automatic daily local backups.
- **iPad, without the cloud** — flip on LAN access in Settings, scan the QR code on your iPad, and
  Add to Home Screen. Optional PIN protects LAN access. Nothing ever touches the internet.


## Install (macOS)

1. Download the latest `Collectory-*.dmg` from [Releases](../../releases) (arm64 for Apple
   Silicon, x64 for Intel).
2. Open the DMG and drag **The Collectory** to Applications.
3. First launch — because the app isn't notarized yet, macOS blocks apps downloaded from outside
   the App Store. On Apple Silicon it usually says **"The Collectory" is damaged and can't be
   opened.** It is *not* damaged — that's just Gatekeeper. Drag the app into **Applications**, then
   open **Terminal** (Applications → Utilities), run the line below, and open the app normally:
   ```
   xattr -cr "/Applications/The Collectory.app"
   ```
   (Some Intel Macs instead offer **System Settings → Privacy & Security → Open Anyway**.)
   Needed once per version — and not at all once the app is notarized.

Your data lives in `~/Library/Application Support/Collectory/` (database, images, attachments,
automatic backups; the folder keeps its original name). Copy that folder — or use
**Settings → Backup Now** — and you have everything.

## iPad setup

1. On the Mac: **Settings → iPad & LAN Access** → enable, optionally set a PIN.
2. On the iPad (same Wi-Fi): scan the QR code or type the shown address into Safari.
3. Share → **Add to Home Screen**. On iPadOS 26+ it opens as a full-screen app.

## For developers

```bash
npm install                 # root deps (Express, better-sqlite3, Electron…)
npm --prefix client install # frontend deps
npm run dev                 # headless server (:7117) + Vite dev client (:5173)
npm run dev:app             # Electron shell against the dev servers (run rebuild:electron first)
npm test                    # backend test suite (node:test + supertest)
npm run dist                # build client + package the DMG (output in release/)
```

- Architecture, full data model, and API contract: `docs/specs/DESIGN.md`.
- `server/` — Express + better-sqlite3 (CommonJS). `client/` — React + TypeScript + Vite PWA.
  `electron/` — desktop shell that runs the same server in-process.
- Native-module note: `npm install` keeps better-sqlite3 on your system-Node ABI (tests/dev);
  `npm run rebuild:electron` / `npm run rebuild:node` switch between Electron and Node ABIs.
  Local native builds need Node ≥20 and a Python with `setuptools`.
- Releases: push a `v*` tag; GitHub Actions builds arm64 + x64 DMGs and attaches them to a draft
  release.

## Data philosophy

Plain SQLite you can open with any tool, images as ordinary files, free CSV/JSON export forever,
and an open documented schema. If this app disappeared tomorrow, your records would still be
yours, readable, and portable — that's the point.

## License

MIT
