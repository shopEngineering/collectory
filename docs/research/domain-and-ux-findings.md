# Domain schemas + UX/packaging findings (research digest, 2026-07-18)

## Domain field schemas
The authoritative per-category field research is largely **encoded in `server/templates/*.json`**
(firearms incl. NRA condition + NFA block; ammunition incl. headstamp/corrosive/lot; knives incl.
NKCA grades, steels, grinds, locks, Case dating hint; coins incl. full Sheldon scale, cert
services, CAC, designations, pedigree; stamps incl. Scott/alt catalogs, perf/watermark, gum/hinge
states, formats incl. plate blocks/PNC, expertizing bodies). Additional reference points not (yet)
encoded:
- Grading is always {system, value} in spirit — templates pick the dominant system per category.
- Free lookup APIs: **Numista v3** (coins; free key; types/issues/prices) > PCGS public API
  (cert lookups, quota) > Colnect CAPI (stamps; gated). Nothing for firearms/ammo/knives — seed
  lists/autocomplete are the ceiling. AI grading/valuation is a trust-destroyer (CoinSnap: 40%
  grading accuracy, valuations varying $0.57→$1,538 on rescans) — never do it.
- Firearms extras worth a future pass: factory-letter workflow, C&R rolling 50-year computation,
  Blue Book % grading overlay. Ammo: reload recipes + component inventories, MIL-STD-1168 lots.
  Stamps: album-space completion as a separate axis from ownership. Coins: set-completion by
  date+mintmark, population reports.

## UX patterns adopted (from CLZ/Plex/Notion/Airtable/HomeBox/Sortly research)
- Sidebar = collections; view toggles (grid w/ density slider ↔ table) persisted; filter/sort/search
  state mirrored to URL params.
- Click-to-filter facets; saved-view concept deferred.
- "Save & Add Another" + ⌘K palette + visible keyboard hints; entry speed is the #1 perceived-quality
  lever; bulk import is the migration on-ramp.
- Photo-forward cards with object-fit contain over blurred fill (never crop rifles/knives);
  dark-by-default (Plex convention), never pure black (Notion greys).
- Dashboards: total value + counts + recent activity from item #1; skeletons over spinners.
- Batch-select that includes select-all (Plex's lack thereof is a running complaint).

## iPad PWA (validated 2026)
- iOS 26: Add-to-Home-Screen opens standalone by default for any site — plain HTTP on LAN is fine
  (older iPadOS: opens with Safari chrome; fully functional). No service worker needed on iOS; we
  ship none (stale-cache risk without benefit).
- `apple-touch-icon` (180 opaque) is authoritative; meta tags per DESIGN §5.1; viewport-fit=cover
  + safe-area insets; inputs ≥16px (kills zoom-on-focus); targets ≥44px; hover gated by
  `@media (any-hover)`; storage for installed apps is exempt from 7-day ITP eviction; camera via
  `<input capture>` (permission re-prompts each launch — known WebKit bug).

## Electron/DMG distribution (validated 2026)
- **Sequoia+ killed right-click→Open**; truly-unsigned arm64 apps show "damaged" with no recovery.
  Ad-hoc sign (identity "-") → users get System Settings → "Open Anyway" path; `xattr -cr` also
  works. Notarization ($99/yr) only if audience grows.
- better-sqlite3 v12 ships Electron prebuilds (ABI 121–136). Dual-ABI dance documented in DESIGN §7
  (rebuild:node / rebuild:electron). electron-builder `npmRebuild` handles packaging.
- GH Actions: matrix macos-14 (arm64) + macos-13 (x64), `electron-builder --mac --publish always`,
  `permissions: contents: write`; do NOT use archived samuelmeuli action. electron-builder creates
  a draft release on tag push — review, then publish.

## Data safety conventions
- One archive = DB + images (CLZ's images-excluded backups are a famous trap). SQLite online
  backup API, never raw-copy a WAL db. Auto-timestamped rotating backups; restore takes a safety
  backup first. CSV: id column round-trip (HomeBox ImportRef pattern); photos travel only in full
  backups. Insurance report: cover page (owner, date, counts, totals) + grouped thumbnail tables +
  serial masking option (fields per III/NAIC worksheets).
