# Collectory — Design Specification

**Date:** 2026-07-18 · **Status:** Approved for implementation (single-shot autonomous build)
**This document is the coordination contract.** Implementation agents build against it. If an agent
must deviate, it records the deviation in its final report so the orchestrator can reconcile.

## 1. Product

Collectory is a universal collection-tracking application for a private collector managing multiple
collections — firearms, ammunition, knives, coins, stamps, and anything else — replacing spreadsheets
and MyArmsCache. Local-first: all data in SQLite + a local image library on the user's Mac. No cloud,
no accounts, no telemetry.

**Delivery targets (one codebase):**
1. **Mac app** — Electron shell, distributed as a DMG from GitHub Releases, dock icon, native menu.
2. **Web/iPad** — the same embedded web server optionally listens on the LAN; iPad Safari installs it
   as a home-screen PWA. Optional PIN protects LAN access.

**Non-goals (v1):** cloud sync, multi-user accounts, mobile-native apps, marketplace/price-API
integrations, barcode scanning.

## 2. Architecture

```
collectory/
├── package.json            root: electron + server deps, scripts, electron-builder config target
├── electron/               SHELL AGENT owns
│   ├── main.js             starts server in-process, creates BrowserWindow, menu, single-instance
│   └── preload.js          minimal contextBridge (menu → navigate events)
├── server/                 BACKEND AGENT owns
│   ├── index.js            entry: createApp(dataDir) + listen; headless mode: `node server/index.js`
│   ├── db/                 connection, migrations runner, migrations/*.sql
│   ├── routes/             express routers per resource
│   ├── services/           imageStore, backup, csv, stats, templates
│   └── templates/          built-in collection templates (JSON, authored by orchestrator)
├── client/                 FRONTEND AGENT owns
│   ├── package.json        vite/react deps (dev-only; not packaged)
│   ├── vite.config.ts      dev proxy → :7117, build → client/dist
│   ├── public/             manifest.webmanifest, icons, apple-touch-icon
│   └── src/
├── build/                  icon.png (1024×1024) — SHELL AGENT
├── .github/workflows/release.yml   — SHELL AGENT
└── docs/specs/             this spec + project docs
```

- **Runtime layout:** Electron main process `require`s `server/index.js` and runs Express in-process
  on port **7117** (configurable via settings). The window loads `http://127.0.0.1:7117`. Express
  serves the built client (`client/dist`), the REST API under `/api`, and images under `/images`.
- **Headless mode:** `npm run server` runs the identical server without Electron (dev, or Mac-mini-style
  always-on use). Same data directory.
- **Module systems:** `electron/` and `server/` are **CommonJS** (battle-tested with Electron +
  better-sqlite3). `client/` is TypeScript + ESM via Vite, fully independent.
- **Data directory:** `~/Library/Application Support/Collectory` (Electron `app.getPath('userData')`;
  headless server computes the same path; override with env `COLLECTORY_DATA_DIR`). Contains:
  `collectory.db`, `images/orig/`, `images/thumb/`, `attachments/`, `backups/`.
- **Only native module:** better-sqlite3 (rebuilt for Electron via `electron-builder install-app-deps`).
  **No sharp** — thumbnails are generated client-side with canvas (works on iPad camera uploads too).

## 3. Data model (SQLite DDL — authoritative)

Conventions: snake_case in DB, camelCase in API JSON. Money = integer cents. Dates = ISO-8601 strings
(`YYYY-MM-DD` for date fields, full ISO for timestamps). WAL mode, `foreign_keys=ON`.
Migrations in `server/db/migrations/NNN_name.sql`, applied in order, tracked in `_migrations`.

```sql
CREATE TABLE collections (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'box',          -- icon key from client icon set
  color TEXT NOT NULL DEFAULT '#6b7280',     -- accent hex
  description TEXT NOT NULL DEFAULT '',
  template_key TEXT,                          -- 'firearms' | 'ammunition' | ... | NULL (custom)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE field_defs (        -- dynamic per-collection item fields
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  key TEXT NOT NULL,             -- stable snake_case identifier; values keyed by this
  label TEXT NOT NULL,
  type TEXT NOT NULL,            -- text|textarea|number|currency|date|year|select|multiselect|checkbox|url|rating
  options_json TEXT,             -- JSON array for select/multiselect
  unit TEXT,                     -- display suffix for number ("in", "gr", "g", "mm", "rds")
  required INTEGER NOT NULL DEFAULT 0,
  show_in_table INTEGER NOT NULL DEFAULT 0,
  show_on_card INTEGER NOT NULL DEFAULT 0,
  section TEXT NOT NULL DEFAULT 'Details',   -- form/detail grouping: Identity, Specifications, ...
  placeholder TEXT, help TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(collection_id, key)
);

CREATE TABLE log_types (         -- per-collection activity log types
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  key TEXT NOT NULL,             -- e.g. range_session, cleaning, modification, grading, usage, note
  label TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'note',
  color TEXT NOT NULL DEFAULT '#6b7280',
  fields_json TEXT NOT NULL DEFAULT '[]',    -- FieldDef[] (same shape as field_defs, minus table/card flags)
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(collection_id, key)
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'owned',      -- owned|wishlist|loaned|sold|traded|gifted
  quantity REAL NOT NULL DEFAULT 1,          -- REAL: ammo counts, stamp lots
  min_quantity REAL,                          -- low-stock alert threshold (ammo); NULL = no alert
  acquired_date TEXT, acquired_price_cents INTEGER, acquired_from TEXT,
  current_value_cents INTEGER, value_updated_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '{}',    -- { fieldKey: value } dynamic values
  cover_photo_id INTEGER,                    -- FK to photos.id (no constraint; nulled by app on delete)
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted_at TEXT                            -- soft delete (Trash)
);
CREATE INDEX idx_items_collection ON items(collection_id, deleted_at);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY,
  item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  log_id INTEGER REFERENCES logs(id) ON DELETE CASCADE,   -- exactly one of item_id/log_id set
  filename TEXT NOT NULL,        -- uuid.ext in images/orig/ ; thumb is uuid.jpg in images/thumb/
  original_name TEXT, width INTEGER, height INTEGER, size_bytes INTEGER,
  caption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE logs (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  log_type_key TEXT NOT NULL,    -- matches log_types.key for the item's collection ('note' always valid)
  date TEXT NOT NULL,            -- YYYY-MM-DD
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',      -- structured values per log type fields
  linked_log_id INTEGER,         -- e.g. auto-created ammo 'usage' log ↔ its range_session source
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_logs_item ON logs(item_id, date);

CREATE TABLE provenance (        -- ownership/history chain
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  owner_name TEXT NOT NULL,
  from_date TEXT, to_date TEXT,  -- free precision: '1968', '1968-05', full date, or NULL
  how_acquired TEXT NOT NULL DEFAULT '',     -- purchase, inheritance, gift, trade...
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE valuations (        -- value history
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  date TEXT NOT NULL, value_cents INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'estimate',   -- purchase|appraisal|market|estimate|sale
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE attachments (       -- receipts, certificates, PDFs
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,        -- uuid.ext in attachments/
  original_name TEXT NOT NULL, mime TEXT, size_bytes INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL DEFAULT '#6b7280');
CREATE TABLE item_tags (item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                        PRIMARY KEY (item_id, tag_id));

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
-- keys: lan_enabled('0'|'1'), lan_pin_hash, currency('USD'), port('7117'), theme('system')

CREATE VIRTUAL TABLE items_fts USING fts5(name, notes, field_text, content='');
-- field_text = flattened dynamic values. Backend keeps FTS in sync on item create/update/delete
-- (rebuild row on write; rowid = items.id).
```

**Semantics:**
- Statuses `sold|traded|gifted` are "former" — excluded from value totals and default views, still
  browsable via filter. `wishlist` excluded from value totals. `loaned` counts as owned.
- Deleting a photo that is an item's cover → server picks the next photo (or NULL) as cover.
- Item **computed stats** (returned on item detail, derived from logs — never stored):
  `roundsFired` = Σ `data.roundsFired` over logs of type `range_session`;
  `lastCleaned` = max date of `cleaning` logs; `roundsSinceCleaned` = rounds from range logs dated
  after lastCleaned; `lastActivity` = max log date. Omit fields with no relevant logs.
- **Ammo & quantity linkage (headline feature), unified rules — all in one transaction:**
  1. On items in ammunition-template collections, logs carry quantity effects: `data.rounds_used`
     (number > 0) decrements the item's `quantity` (floor 0); `data.rounds_added` increments it.
     Deleting such a log reverses its effect; editing applies the delta.
  2. When a log is created with `data.ammo_item_id` (item id in an ammunition collection) and numeric
     `data.rounds_fired > 0` (e.g. a firearms `range_session`), the server auto-creates a `usage` log
     on that ammo item (same date, `data: {rounds_used: <rounds_fired>, source_item_id}`,
     `linked_log_id` pointing back; the source log's `linked_log_id` set to the new log id) — rule 1
     then handles the quantity math. Deleting the source log deletes the linked usage log (reversing
     quantity); editing `rounds_fired`/`ammo_item_id` updates or re-creates the linked log.
  Computed stat `roundsFired` = Σ `data.rounds_fired` over `range_session` logs (data keys are
  snake_case, matching template field keys; computed stat names in API responses are camelCase).

## 4. REST API contract (authoritative)

All routes under `/api`, JSON. Errors: HTTP status + `{"error": {"message": "...", "code": "..."} }`.
IDs are integers. Unknown fields in requests are ignored. `PATCH` = partial update.

### Collections & schema
| Method/Path | Purpose |
|---|---|
| `GET /api/collections` | list (with `itemCount`, `valueCents` aggregates), ordered by sort_order |
| `POST /api/collections` | `{name, icon?, color?, description?, templateKey?}` — copies template fields/logTypes when templateKey given; always ensures a `note` log type exists |
| `GET /api/collections/:id` | full: collection + `fields: FieldDef[]` + `logTypes: LogTypeDef[]` |
| `PATCH /api/collections/:id` | name/icon/color/description/sort_order |
| `DELETE /api/collections/:id` | 409 unless empty or `?force=true` (force soft-deletes its items) |
| `PUT /api/collections/:id/fields` | `{fields: FieldDef[]}` full replacement; values for removed keys are retained in items' fields_json (non-destructive) |
| `PUT /api/collections/:id/logtypes` | `{logTypes: LogTypeDef[]}` full replacement (key `note` cannot be removed) |
| `GET /api/templates` | built-in templates: `[{key, name, icon, color, description, fields, logTypes}]` |

`FieldDef` (API camelCase): `{key, label, type, options?, unit?, required?, showInTable?, showOnCard?, section?, placeholder?, help?}`
`LogTypeDef`: `{key, label, icon?, color?, fields?: FieldDef[]}`

### Items
| `GET /api/collections/:id/items` | query: `q` (per-collection FTS/LIKE), `status` (csv; default excludes former+wishlist? NO — default `owned,loaned,wishlist`), `tag`, `sort` (`name|acquiredDate|acquiredPrice|currentValue|createdAt|updatedAt|quantity`), `dir` (`asc|desc`), `field.<key>=<value>` exact-match filters for select/checkbox fields, `limit` (default 500), `offset`. → `{items: ItemSummary[], total}` |
| `POST /api/items` | `{collectionId, name, ...core, fields?, tags?: string[]}` → full Item |
| `GET /api/items/:id` | full Item: core + `fields` + `photos[]` + `tags[]` + `computedStats` + `collection: {id,name,icon,color,templateKey}` |
| `PATCH /api/items/:id` | any core field, `fields` (merged per-key; explicit `null` clears a key), `tags` (full replacement array of names — creates unknown tags) |
| `POST /api/items/:id/duplicate` | copy item (no photos/logs), name + " (copy)" → new Item |
| `DELETE /api/items/:id` | soft delete; `?permanent=true` hard-deletes (files removed) |
| `GET /api/trash` | soft-deleted items across collections |
| `POST /api/items/:id/restore` | undelete |

`ItemSummary` = `{id, collectionId, name, status, quantity, acquiredDate, acquiredPriceCents, currentValueCents, thumbUrl, cardFields: {key: value}, tags: [{id,name,color}], updatedAt}` (`cardFields` = values of field_defs with showOnCard/showInTable).

### Photos & attachments (multipart/form-data)
| `POST /api/items/:id/photos` / `POST /api/logs/:id/photos` | parts: `photo` (original), `thumb` (optional client-resized JPEG ≤400px long edge; server falls back to copying original), `caption?`, `width?`, `height?` → Photo `{id, url, thumbUrl, caption, width, height, sortOrder}` |
| `PATCH /api/photos/:id` | caption, sortOrder |
| `POST /api/items/:id/cover` | `{photoId}` |
| `DELETE /api/photos/:id` | removes files |
| `POST /api/items/:id/attachments` | part `file` → `{id, url, originalName, mime, sizeBytes}` |
| `DELETE /api/attachments/:id` | |
Static: `GET /images/orig/<f>`, `GET /images/thumb/<f>`, `GET /attachments/<f>` (content-disposition with original name).

### Logs, provenance, valuations
| `GET /api/items/:id/logs` | newest-first, each with `photos[]` |
| `POST /api/items/:id/logs` | `{logTypeKey, date, title?, notes?, data?}` (ammo linkage per §3) |
| `PATCH /api/logs/:id` / `DELETE /api/logs/:id` | (ammo linkage delta/restore per §3) |
| `GET/POST /api/items/:id/provenance`, `PATCH/DELETE /api/provenance/:id` | |
| `GET/POST /api/items/:id/valuations`, `DELETE /api/valuations/:id` | POST also updates item `current_value_cents` when the new entry is the latest by date |

### Cross-cutting
| `GET /api/search?q=` | global FTS → `{results: [{item: ItemSummary, collectionName, snippet}]}` (limit 50) |
| `GET /api/stats` | `{totals: {items, valueCents, collections}, byCollection: [{id, name, icon, color, count, valueCents}], recentItems: ItemSummary[] (8), recentLogs: [{id, itemId, itemName, collectionId, logTypeKey, logTypeLabel, date, title}] (10), acquisitionTimeline: [{month: 'YYYY-MM', valueCents, count}] (cumulative), alerts: [{type: 'low_stock', itemId, name, quantity, minQuantity}]}` |
| `GET /api/ammo-choices` | items in ammunition-template collections: `[{id, name, quantity, caliber?}]` (for range-log ammo picker; caliber = fields.caliber if present) |
| `GET /api/export/csv?collectionId=` | CSV: core columns + one column per field_def + tags; filename header |
| `GET /api/export/json` | full-fidelity dump of all tables (portability) |
| `POST /api/import/csv/preview` | multipart `file` → `{token, headers, sampleRows (5), suggestedMapping: {header: target}}` (target: `core:<name>` \| `field:<key>` \| `new:<type>` \| `skip`; suggestion by fuzzy header match) |
| `POST /api/import/csv/commit` | `{token, collectionId, mapping}` → `{imported, skipped, errors: [...]}`; `new:<type>` creates field_defs from the header name |
| `GET /api/backup` | zip download: db snapshot (`.backup()` API), images/, attachments/, meta.json `{app, version, exportedAt}` |
| `POST /api/restore` | multipart zip; validates meta.json; saves safety zip of current data to backups/ first; hot-swaps db connection; → `{ok: true}` |
| `GET /api/settings` | `{lanEnabled, lanPinSet (bool), currency, theme, port, dataDir, version, lanUrls: ["http://192.168.x.x:7117", ...], qrDataUrl}` (qr for first lanUrl; `qrcode` npm pkg) |
| `PATCH /api/settings` | `{lanEnabled?, lanPin? (string; '' clears), currency?, theme?}` |
| `POST /api/auth/pin` | `{pin}` → sets signed httpOnly cookie (30 days) |
| `GET /api/health` | `{ok: true, version}` |

**LAN security model:** server always binds `0.0.0.0`. Middleware: requests from loopback are always
allowed. Non-loopback: rejected 403 when `lan_enabled='0'`; when enabled and a PIN hash is set,
require valid cookie else 401 `{code:'PIN_REQUIRED'}` (client shows PIN screen). Static client assets
are always served (so the PIN screen can load); `/api/*` (except health/auth) and `/images`,
`/attachments` are gated.

## 5. Built-in templates

Authored by the orchestrator in `server/templates/*.json` after domain research:
`firearms.json`, `ammunition.json`, `accessories.json`, `parts.json`, `knives.json`, `coins.json`,
`stamps.json`, plus `generic.json` (minimal starter). Accessories & Parts (v1.0.3) carry
`item_refs`/`item_ref` fields with `refTemplate: 'firearms'` so they link to the guns they fit or
are installed on (surfaced via `/api/items/:id/related`, per §5.2). Magazines are NOT a template —
they are child records of firearms (§5.2). Format: `{key, name, icon, color, description, fields: FieldDef[], logTypes: LogTypeDef[]}`.
Backend loads/validates these at startup and serves via `GET /api/templates`. Highlights:
firearms gets `range_session` (roundsFired, ammoItemId picker via `type:'ammo_ref'`… **no** — spec
decision: `ammoItemId` is a special-cased field rendered by the client for `range_session` logs in
firearms collections; its FieldDef type is `ammo_ref`, client renders picker from `/api/ammo-choices`,
server treats value as number), `cleaning`, `modification`, `appraisal`; ammunition gets `usage`,
`restock`; coins/stamps get `grading_submission`, `storage_change`. Every collection always has `note`.

### 5.1 Research addenda (binding)

- **Server module interface (electron ↔ server):** `server/index.js` exports
  `{ createApp, start }`. `start({dataDir, port}) → Promise<{app, server, port}>` runs migrations,
  loads templates, listens on `0.0.0.0`. When run directly (`require.main === module`) it starts with
  defaults (`COLLECTORY_DATA_DIR` env or the platform app-data path, port from settings or 7117).
  Electron calls `start({dataDir: app.getPath('userData')})`.
- **Firearms template additions (market gap — no competitor does this natively):** an **NFA section**:
  `nfa_item` (checkbox), `nfa_type` (select: Suppressor, SBR, SBS, Machine Gun, AOW, DD),
  `form_type` (select: Form 1, Form 4), `stamp_status` (select: Not Started, Submitted, Pending,
  Approved), `stamp_submitted` (date), `stamp_approved` (date), `stamp_number` (text),
  `trust_name` (text). Also `round_count_offset` handled as: computed roundsFired is authoritative
  from logs; no manual counter (top competitor complaint is drifting round counts).
- **Stamps template additions:** `format` (select: Single, Plate Block, PNC Strip of 3, PNC Strip of 5,
  Full Sheet, First Day Cover, Souvenir Sheet, Booklet Pane), `plate_number`, `postmark` (text),
  plus alt-catalog cross-refs (`scott_number`, `alt_catalog_number`).
- **Positioning (README + About + empty states):** lead with "Local-first. No servers, no cloud, no
  accounts, no telemetry. Your records never leave your machine unless you export them." This is the
  audience's #1 trust criterion, not a technical footnote.
- **Root `package.json` is orchestrator-owned.** Implementation agents must NOT edit it; if a dep or
  script is missing, they note it in their final report.
- **CSV round-trip (research: the single most important import mechanism):** exports include an `id`
  column; import mapping target `core:id` — rows whose mapped id matches an existing item in the
  collection UPDATE that item instead of creating a duplicate. Export→edit-in-Excel→re-import is
  lossless for data fields (photos travel only via full backup, by convention).
- **Automatic backups:** on server start, if the newest auto-backup is >24h old, write a full backup
  zip to `<dataDir>/backups/auto/collectory-auto-YYYYMMDD-HHmmss.zip`, keep newest 10. Manual
  `GET /api/backup` unchanged. (Data durability is a top competitor complaint.)
- **Collection icon keys** (frontend implements as inline SVG set, server/templates just reference):
  `firearm, ammo, knife, coin, stamp, box, watch, camera, book, card, gem, guitar, medal, bottle,
  archive, star`. Log-type icon keys: `target, brush, wrench, badge, arrow-up, arrow-down, archive,
  note, droplet, edge`.
- **Insurance report structure (research-validated):** cover page (owner name line — free-text
  setting `report_owner`, generation date, item count, grand total value), body grouped by
  collection with per-group subtotals, item rows as thumbnail table (photo, name, serial/key
  identity fields, condition, acquired date/price, current value), grand total repeated at end.

### 5.2 v1.1 addendum — magazines & item references (binding, as built)

- **Field types += `item_ref` (single) and `item_refs` (multi):** FieldDef gains optional
  `refTemplate` (a template key, or absent = any item; DB column `field_defs.ref_template`,
  migration 002). Stored values: item id (number) / array of ids. `ammo_ref` remains as sugar for
  `item_ref` + `refTemplate: 'ammunition'` (backcompat).
- **`GET /api/item-choices?template=&q=&excludeItemId=`** generalizes `/api/ammo-choices` (which
  stays as an alias, adding a legacy `caliber` mirror of `hint`): →
  `[{id, name, collectionId, collectionName, quantity, thumbUrl, hint}]` (`hint` = caliber field
  when present). Excludes trashed + former-status items.
- **`GET /api/items/:id/related`** → `{references: [{fieldKey, fieldLabel, items: Choice[]}],
  referencedBy: [{fieldKey, fieldLabel, templateKey, items: Choice[]}]}`. `referencedBy` scans
  `item_ref`/`item_refs`/`ammo_ref` field defs across collections and matches values containing the
  id (json_each; fine at personal-collection scale). Synthetic groups on ammo items:
  `magazines` ("In magazines of" — firearms owning a magazine child that holds or is loaded with
  this ammo) and `used_with` (guns whose `range_session` logs reference this ammo item).
- **Magazines are CHILD RECORDS of a firearm item — NOT a collection template** (user decision
  2026-07-19, supersedes the original magazines-template design; no `magazines.json`, not offered
  in the New-Collection picker). Table `magazines` (migration 003, `ON DELETE CASCADE` from the
  parent item): name, manufacturer, capacity (rds), caliber, quantity (count of identical mags),
  `holds_ammo_json` (ammo item ids the magazine accepts), loaded, `loaded_with` (ammo item id),
  loaded_rounds, notes, sort_order. Endpoints: `GET/POST /api/items/:id/magazines`,
  `PATCH/DELETE /api/magazines/:id` (API camelCase: `holdsAmmoIds`, `loadedWithId`, …).
- **Firearms template +=** section "Ammunition": `associated_ammo` (item_refs→ammunition,
  "Ammunition for this firearm", pinned first in the range-log ammo picker).
- **Loaded-state semantics (deliberate):** loading a magazine does NOT decrement the ammo lot —
  lot quantity means rounds owned wherever stored; only firing (range-session linkage, §3) deducts.
  Prevents double-counting. Stated in the magazine form's `loaded_with` help text.
- **Client:** FieldInput renders item_ref/item_refs pickers (search-as-you-type over item-choices,
  chips with remove for multi); spec sheet renders ref values as linked item chips; item detail
  gains a "Related" card (right column, hidden when empty): references + referencedBy groups;
  firearm detail gains a **"Magazines" tab** (templateKey `firearms` only): list/create/edit/delete
  child magazines with holds/loaded ammo links + a "Log issue" action that drops a note log on the
  gun; range-log ammo picker sorts the gun's `associated_ammo` first with an "associated" marker.
  Icon set += `magazine`.
- Existing collections are NOT auto-migrated (no real users pre-v1.1); new fields arrive via
  templates on new collections or manually via the field editor.

## 6. Frontend (client/) — routes & components

React 18 + TypeScript + Vite + react-router-dom (BrowserRouter; server falls back to index.html) +
@tanstack/react-query. **No UI framework** — hand-rolled design system (CSS custom properties,
light/dark via `prefers-color-scheme` + manual override). Design bar: professional, dense-but-calm,
photo-forward; must feel like a crafted native tool, not a bootstrap admin panel.

Routes:
- `/` Dashboard — stat cards (total items, total value, collections), per-collection tiles,
  acquisition timeline chart (hand-rolled SVG), recent items strip, recent activity feed, low-stock alerts.
- `/c/:collectionId` Browse — grid (photo cards) / table (showInTable columns) toggle, search box,
  status & field & tag filters, sort menu, batch select → batch status/tag/delete. Empty states.
- `/c/:collectionId/new` + `/items/:itemId/edit` — DynamicForm from FieldDefs grouped by section,
  core fields (name, status, qty, acquisition, value) always present, photo uploader (drag-drop +
  camera on iPad, client-side canvas thumbnail), tag picker.
- `/items/:itemId` Detail — photo gallery + lightbox, spec sheet grouped by section, computed stats
  chips (rounds fired, last cleaned…), tabs: **Activity** (log timeline w/ per-type icons, structured
  data, photos incl. target photos, add-log inline form), **Provenance** (ownership chain editor),
  **Value** (valuation history + sparkline, add entry), **Files** (attachments). Duplicate/Delete menu.
- `/c/:collectionId/settings` — collection meta + Field editor (add/edit/reorder/delete fields,
  type-specific option editors, drag reorder) + Log-type editor. Non-destructive warnings.
- `/search?q=` global results grouped by collection. Also **⌘K command palette** (jump to item/collection/action).
- `/settings` — appearance, currency, LAN access panel (toggle, PIN set, URLs + QR code for iPad,
  "Add to Home Screen" instructions), data dir info, Backup now / Restore, CSV/JSON export, app version.
- `/import` — CSV wizard: upload → column mapping table (suggested mapping, per-column target
  dropdowns incl. "create new field") → commit → results.
- `/report` — printable insurance report (`?collectionId=` or all): cover summary (owner line, date,
  totals), per-item rows w/ photo, key fields, serial, acquired price/date, current value; print CSS
  (`@page`, page-break rules). "Print / Save PDF" button → `window.print()`.
- `/trash` — restore / permanently delete.

PWA (research-validated): `manifest.webmanifest` (name, short_name, `display: standalone`, start_url
`/`, theme/background colors, icons 192/512 incl. maskable) + **`<link rel="apple-touch-icon">`
(180×180 opaque PNG) is authoritative on iOS** + meta tags: `apple-mobile-web-app-capable`,
`apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style: black-translucent`,
`theme-color`, viewport with `viewport-fit=cover` (and use `env(safe-area-inset-*)` padding).
**No service worker in v1** (iOS 26 launches any Add-to-Home-Screen site standalone by default; a SW
adds stale-cache failure modes without benefit here; plain HTTP on LAN is acceptable — on older
iPadOS it simply opens with Safari chrome, fully functional). Touch rules: inputs `font-size ≥16px`
(kills iOS zoom-on-focus), touch targets ≥44px, hover-only affordances gated behind
`@media (any-hover: hover)`, persistent in-app back navigation (standalone mode has no back button).
Fully responsive: sidebar → sheet/hamburger under 900px.

## 7. Electron shell & packaging

- `main.js`: single-instance lock; start server in-process (`createApp` from server), then
  BrowserWindow 1360×860 (min 980×640), `titleBarStyle: 'hiddenInset'` with a draggable client
  region, loads `http://127.0.0.1:<port>`; external links → `shell.openExternal`; macOS menu
  (About, Settings ⌘,, Backup, Import CSV, Insurance Report, standard Edit/View/Window) — menu
  navigation via `webContents.send('navigate', path)` + preload `contextBridge` (`window.collectory.onNavigate`).
  Client detects Electron via `window.collectory` and adds a titlebar drag strip.
- Dev: `ELECTRON_START_URL=http://localhost:5173` (Vite dev server proxies `/api`, `/images` → 7117).
- `electron-builder` (config in root package.json or electron-builder.yml): appId `com.collectory.app`,
  productName `Collectory`, mac target `dmg` + `zip`, category `public.app-category.productivity`,
  icon `build/icon.png` (1024², builder generates .icns), `asarUnpack: ['**/*.node']`, files:
  electron/, server/, client/dist/, package.json. `npmRebuild: true`.
- **Signing (research-critical):** truly-unsigned arm64 builds show "app is damaged" on Sequoia+
  with NO recovery path, and right-click→Open is dead since macOS 15. Therefore **ad-hoc sign**:
  mac config `identity: "-"`, `hardenedRuntime: false`; CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false`.
  First-open path to document: launch → blocked dialog → System Settings → Privacy & Security →
  "Open Anyway" (+ admin password), or `xattr -cr /Applications/Collectory.app`. One-time per version.
- `.github/workflows/release.yml`: on tag `v*` → matrix macos-14 (arm64) + macos-13 (x64) →
  setup-node 22 + npm cache, `npm ci`, `npm --prefix client ci`, client build,
  `npx electron-builder --mac --publish always` with `GH_TOKEN: secrets.GITHUB_TOKEN`,
  `permissions: contents: write`. (Do NOT use archived samuelmeuli/action-electron-builder.)
- **Dual-ABI note:** plain `npm install` keeps better-sqlite3 on the system-Node ABI (v12 ships
  prebuilds) so `npm test` / `npm run dev` / headless server work; `npm run rebuild:electron`
  (electron-builder install-app-deps) switches node_modules to the Electron ABI for `dev:app`;
  `npm run rebuild:node` (npm rebuild better-sqlite3) switches back. `dist` handles its own rebuild
  via electron-builder `npmRebuild`.
- Root scripts: `dev` (concurrently: server nodemon + vite), `dev:app` (electron pointing at vite),
  `build` (vite build), `server` (headless), `test` (node --test server/test/),
  `rebuild:electron` / `rebuild:node` (ABI switch), `dist` (build + electron-builder --mac).

## 8. Error handling & data safety

- Server: central error middleware → `{error:{message}}`, 400 validation / 404 / 409 / 500; all
  multi-write operations in better-sqlite3 transactions; uploads size-capped (50 MB photo, 100 MB zip
  restore w/ streaming to temp file); filenames always server-generated UUIDs (originals kept as metadata).
- SQLite: WAL; backup endpoint uses the online backup API (consistent snapshot).
- Restore: never destructive without the automatic safety zip first.
- Client: React Query retries off for mutations, toast on error, optimistic UI only for trivial
  toggles; unsaved-form navigation guard.

## 9. Testing & verification

- Backend: `node:test` + supertest against `createApp(tmpDataDir)` — covering: migrations bootstrap,
  template instantiation, item CRUD + dynamic fields + FTS search, ammo-linkage create/edit/delete
  round-trip, CSV export/import round-trip, backup zip contents, LAN gate middleware, valuations →
  current value sync. Target: the behaviors above, not coverage numbers.
- Frontend: type-checked build (`tsc && vite build`) as the gate; UI verified by orchestrator via
  browser automation (screenshots of dashboard, browse, item detail, add-item, settings, report).
- Integration: orchestrator boots the real server + built client, exercises core flows, then builds
  the DMG and verifies it mounts/launches.

## 10. Key decisions (log)

| Decision | Why | Rejected |
|---|---|---|
| Electron + embedded Express | one codebase → DMG + LAN PWA; Node server natural in main proc; mature packaging | Tauri (Rust sidecar complexity, slower single-shot); pure PWA (no DMG, no local FS trust) |
| Hybrid schema: core columns + `fields_json` + field_defs | universal stats/sorting on core; full flexibility per collection; simpler than EAV; FTS5 covers search | EAV table (join sprawl); per-collection tables (migration hell) |
| Client-side thumbnails (canvas) | kills the sharp native dep; works from iPad camera | sharp (Electron rebuild risk); no thumbs (slow grids) |
| CJS for electron+server, TS/ESM client | max compatibility with better-sqlite3/Electron; Vite isolates client | full-TS monorepo build (single-shot risk) |
| LAN off by default + optional PIN + loopback always trusted | guns+values data; safe default, one toggle + QR to enable iPad | always-on LAN (unsafe); full auth system (overkill v1) |
| Money as integer cents; single currency setting | correctness | floats (rounding), multi-currency (YAGNI) |
| Soft-delete Trash | collectors fear data loss | hard delete only |
| Port 7117 fixed default, settable | memorable, uncommon | random port (breaks PWA bookmark) |

## 11. Post-v1.0 spec deltas (through v1.0.7 — supersede the above where they conflict)

- **Ammo quantity is stored SIGNED**, clamped to 0 only at display (ItemSummary, full item, low-stock
  alert, ammo/item-choices). Log-sourced deltas reverse exactly; sorting uses the signed value.
- **Ammo linkage guard:** the auto-usage-log (rule 2) fires only when the host item is NOT in an
  ammunition collection and `ammo_item_id !== hostItemId` (no double-decrement, no self-reference).
- **Magazines are NOT a top-level template.** They are child records of a firearm:
  `GET/POST /api/items/:id/magazines`, `PATCH/DELETE /api/magazines/:id`; surfaced on the firearm's
  detail page. `item_ref`/`item_refs` field types (+ `ammo_ref` sugar) with `refTemplate`;
  `GET /api/item-choices`, `GET /api/items/:id/related`. Built-in Accessories & Parts templates.
- **DELETE /api/collections/:id?force=true is a PERMANENT delete** (collection + items + cascaded
  logs/photos/attachments) and unlinks the photo/attachment FILES from disk. It does NOT move items
  to Trash (deleting a whole collection is deliberate; per-item delete still uses Trash). The UI
  confirms with the item count + "cannot be undone."
- **CSV import is type-aware:** cells coerce to the target field's type (multiselect/item_refs →
  array, checkbox → boolean, number/currency/year/rating → number, item_ref → id); an explicitly
  empty mapped cell CLEARS the field on update; a `core:id` belonging to a different collection errors
  the row (no cross-collection duplicate). Import preview is called with `collectionId` so suggestions
  match the collection's fields. No CSV formula-injection prefixing (would break the round-trip).
- **Table sort:** `sort` accepts core keys, `status`, or `field:<key>` (dynamic field via
  `json_extract`, numeric types cast to REAL; the key is a bound param).
- **Security:** `trust proxy` is OFF; the LAN gate reads `req.socket.remoteAddress` (handles
  `::1`/`::ffff:127.0.0.1`). All responses carry a Content-Security-Policy (self + inline for the
  app's own theme/styles; `connect-src 'self'` blocks exfiltration), `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. Attachments serve as downloads; svg/html/xml
  uploads are rejected. Malformed numeric input → 400; DB constraint violations → 409/400.
- **Restore is crash-safe:** validate (db + `meta.json` with app id + `version`) BEFORE destroying;
  auto-rollback from the pre-restore safety zip on any mid-swap failure.
- **Packaging:** the DMG is code-signed separately from the app (else Gatekeeper blocks the download);
  build signs both, notarizes, staples. `electron-builder.config.js` (JS) drives conditional
  notarization; the release workflow skips unless ALL 5 signing+notarization secrets are set.
  Migrations through `004_photos_indexes.sql`. adm-zip ≥ 0.6.0.
