# 02 — What Has Been Built (v1.0.0 + same-day v1.1 features, 2026-07-19)

## Release history & verification (through v1.0.7, 2026-07-21)
- **1.0.2** — display rename to "The Collectory" (data folder pinned to `Collectory` via
  `app.setPath`); **Developer ID signing + Apple notarization** established. Build flow: electron
  signs the app; DMGs are signed separately, then `notarytool submit --keychain-profile
  collectory-notary` + `stapler staple` (electron-builder leaves the DMG unsigned → Gatekeeper
  blocks on mount otherwise). Verified via fresh-download + quarantine + `spctl` → Notarized
  Developer ID.
- **1.0.3** — repo made public; `electron/updater.js` + "Check for Updates" (queries public Releases
  API, one-click DMG download); Accessories & Parts built-in templates (item_ref → firearms); GitHub
  Pages download page (`web/index.html` via `.github/workflows/pages.yml`); version-independent DMG
  names for stable `/releases/latest/download/` links.
- **1.0.4** — CSV import for real myArmsCache exports: dedup single-value core targets (empty "Item #"
  no longer clobbers Name), derive a name for nameless ammo rows (manufacturer + caliber), parse
  thousands-comma quantities. Verified against real files: 3/3 guns, 138/138 ammo.
- **1.0.5** — import preview now receives the chosen `collectionId`, so columns auto-map to that
  collection's fields (20/26 firearms columns map automatically) instead of defaulting to "skip".
- **1.0.6** — table view: every column header sortable (core, status, and dynamic fields via
  `json_extract`, numeric fields numerically, key bound as a param); clickable-row pointer cursor.
- **1.0.7 — full review remediation** (below).

## v1.0.7 — security & data-integrity review fixes
Four independent review passes (security · backend · frontend · data/packaging) → 4 critical + 10
high findings, all fixed with regression tests. **57 backend tests (15 new), client build clean,
`npm audit` clean.** Criticals: ammo round-count reversibility (signed storage, display-clamp);
collection force-delete now a coherent permanent delete + photo/attachment file cleanup; CSV
round-trip preserves multiselect/checkbox/number types + empties clear; LAN gate reads the socket
peer (no X-Forwarded-For spoof). Highs: no ammo double-decrement (self-ref/host-type guard);
crash-safe restore (validate-before-destroy + auto-rollback from safety zip + `meta.version` gate);
adm-zip → 0.6.0 (CVE); CI requires ALL signing+notarization secrets; photos indices (no N+1);
attachments served as downloads + `nosniff`, svg/html uploads rejected; iPad-landscape inputs stay
≥16px; field editor preserves show-in-table/on-card/refTemplate + supports ref fields + validates;
unsaved-work guarded on in-app navigation; malformed numbers → 400, DB constraints → 409/400. Plus a
Content-Security-Policy. Deferred (documented in 03-roadmap): keyboard-a11y sweep, list
virtualization, multer 2.x, PIN KDF, `--ink-4` contrast, restore cookie-secret continuity.

## Post-v1.0 same-day additions (all verified, in the v1.0.0 tag)
- **Spreadsheet-style inline editing** in table view (double-click; Enter/blur/Tab/Esc; all simple
  field types + core columns) and a **slide-over edit pane** (`?edit=<id>`, full dynamic form).
- **UX round:** prominent Edit button on item detail; photo adds everywhere (inline on new logs
  with iPad camera capture, per-log camera button, always-visible gallery add tile); clickable-row
  affordances in table view (hover tint, link-styled name, chevron).
- **Magazines & item references (DESIGN §5.2):** `item_ref`/`item_refs` field types with
  refTemplate, `/api/item-choices`, `/api/items/:id/related` (both directions + used_with),
  Magazines built-in template (loaded state deliberately does NOT deduct ammo lots — firing does),
  firearms `associated_ammo` pinned first in the range-log picker, Related card on item detail.
  38 backend tests green.
- **CI lessons encoded in release.yml:** Node 22 (better-sqlite3 v12 has no Node 20 prebuilds) +
  setuptools; single macos-14 runner cross-building arm64+x64 (macos-13 Intel runners are retired
  and queue forever).
- **Display rename → "The Collectory" (v1.0.2):** all user-facing strings; data folder pinned to
  `Collectory` via `app.setPath` (no orphaning); bundle id / backup format id unchanged.
- **v1.0.3 — public + updates + growth:** repo made public; `electron/updater.js` +
  "Check for Updates…" menu item + silent launch check (notify + one-click DMG download via the
  public Releases API; matches this Mac's arch); **Accessories & Parts** built-in templates
  (`item_refs`/`item_ref` → firearms, so a gun's Related panel shows what fits/installs on it);
  version-independent DMG artifact names (`Collectory-arm64.dmg`) so `/releases/latest/download/`
  links are stable; GitHub Pages download page (`web/index.html` via `.github/workflows/pages.yml`,
  live at shopengineering.github.io/collectory). Backend suite 41/41 throughout.

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
