# 02 — What Has Been Built (v1.0.0, 2026-07-19)

Built in a single orchestrated multi-agent session (3 research + 3 implementation agents + fable
orchestrator). Everything below is implemented and verified.

## Backend — `server/` (Express + better-sqlite3, CJS)
- Entry `server/index.js` exports `{ createApp, start }` (DESIGN §5.1). Migrations in
  `server/db/migrations/001_init.sql`, runner in `server/db/`.
- Routes: `collections, items, logs, photos, misc, exchange (csv/backup), system (settings/auth)`.
  Full REST contract of DESIGN §4. Sub-resource lists return wrapped envelopes
  (`{logs}`, `{provenance}`, `{valuations}`, `{attachments}`, `{items}` for trash).
- Services: templates (loads/validates `server/templates/*.json`), items (FTS sync, computed
  stats), ammo (unified quantity-linkage rules, DESIGN §3), imageStore, csv (papaparse,
  preview-token flow, id round-trip), backup (adm-zip + SQLite online backup, auto-rotation
  keep-10), stats, settings (incl. `reportOwner`, lanUrls, QR data URL).
- LAN gate middleware: loopback always allowed; non-loopback 403 when disabled / PIN-cookie 401
  (`PIN_REQUIRED`) when set. Signed cookie, light rate limit.
- **Tests: 34 passing** (`npm test`, node:test + supertest) covering migrations, templates, CRUD +
  dynamic fields, FTS, full ammo-linkage round-trip, CSV round-trip, backup/restore, LAN gate,
  valuation sync, computed stats, cover reassignment.

## Frontend — `client/` (React 18 + TS strict + Vite, no UI framework)
All DESIGN §6 routes complete: Dashboard, Browse (grid/table + density slider + URL-state
filters + batch ops), dynamic Item form (12 field input types incl. `ammo_ref`, Save & Add
Another, deferred photo upload with canvas thumbnails), Item detail (ambient banner, computed-stat
chips, gallery/lightbox, Activity timeline w/ structured data + linked-item name resolution +
photos, Provenance, Value sparkline, Files), Collection settings (field/log-type editors with DnD
reorder), New-collection template picker, global search + ⌘K palette, Settings (theme, LAN+QR+PIN,
backup/restore, exports), CSV import wizard, printable Insurance Report (serial masking), Trash,
PIN screen, Electron drag-strip + menu navigation bridge. Fonts bundled via @fontsource
(offline-safe). Build: ~366 kB JS / 48 kB CSS, `tsc` strict clean.

## Desktop & packaging
- `electron/main.js` (single-instance, in-process server, graceful server-failure page, native
  menu → SPA navigation), `electron/preload.js` (minimal bridge).
- Icon: forest-green squircle + brass "C" specimen-case monogram (`build/icon-source.html` →
  1024 PNG → derived 512/192/180/64 in `client/public/`).
- electron-builder in root `package.json`: DMG+zip, ad-hoc signed (`identity: "-"`),
  `asarUnpack` for the native module. `.github/workflows/release.yml`: tag `v*` → arm64+x64 DMGs
  attached to a draft GitHub Release.

## Verification performed (2026-07-19)
Independent test-suite run (34/34) · live API smoke (templates→collection→items→range session:
ammo 500→350, roundsFired 150, stats, FTS) · full browser walkthrough of the production build with
screenshots in `docs/screenshots/` (dashboard w/ live low-stock alert, browse, item detail incl.
target photo on range log, insurance report, 390px mobile) · zero console errors · DMG build (see
00-PROJECT-INDEX for status).

## Integration fixes applied by orchestrator (post-agent)
1. Five hooks unwrapped backend envelopes (`hooks.ts`) — contract didn't pin list envelopes.
2. Timeline now resolves `ammo_ref`/`source_item_id` to linked item names (`ItemDetailPage.tsx`).
3. Root `test` script glob for Node ≥25 compatibility.

## How to reproduce anything
Dev: `npm run dev` (server :7117 + Vite :5173, data in `.data-dev/`). Tests: `npm test`.
DMG: `npm run dist` → `release/`. Demo-data seed script preserved in the session scratchpad
(`seed.js`) if ever needed again.
