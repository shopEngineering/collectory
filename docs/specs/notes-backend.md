# Backend implementation notes (Collectory `server/`)

Built against DESIGN.md §2–§5.1, §8, §9. CommonJS, Express + better-sqlite3 v12, node:test + supertest.
All 34 backend tests pass.

## File layout (`server/`)

```
server/
├── index.js                 createApp(dataDir) + start({dataDir,port}); SPA fallback; error mw; static
├── db/
│   ├── index.js             openDatabase() — WAL, FK on, migration runner (tracks _migrations)
│   └── migrations/001_init.sql   §3 DDL, tables in dependency order
├── middleware/lanGate.js    LAN gate (loopback allow, static allow, 403/401 gating) — unit-testable
├── util/
│   ├── errors.js            HttpError + badRequest/notFound/conflict/forbidden/unauthorized
│   └── mappers.js           snake_case DB ↔ camelCase API for every entity
├── services/
│   ├── templates.js         load+validate server/templates/*.json at startup (skip invalid)
│   ├── collections.js       createCollection() from template; ensureNoteLogType()
│   ├── items.js             FTS sync, tags, photos, cover, computedStats, buildSummary/buildFull
│   ├── ammo.js              ammo & quantity linkage (rules 1+2, reversal)
│   ├── imageStore.js        multer uploaders + move to orig/thumb/attachments (uuid names)
│   ├── stats.js             dashboard aggregates (/api/stats)
│   ├── csv.js               export + import preview/commit, fuzzy mapping, id round-trip
│   ├── backup.js            adm-zip backup (.backup() snapshot), auto-rotation, restore apply
│   └── settings.js          settings kv, cookie secret, PIN hash, lanUrls
├── routes/
│   ├── collections.js  items.js  logs.js  photos.js  misc.js  exchange.js  system.js
└── test/                    *.test.js (node:test + supertest, fresh tmp dataDir per file)
```

## Endpoints implemented (all of §4)

- Collections/schema: `GET/POST /collections`, `GET/PATCH/DELETE /collections/:id`,
  `PUT /collections/:id/fields`, `PUT /collections/:id/logtypes`, `GET /templates`.
- Items: `GET /collections/:id/items` (q, status, tag, sort, dir, `field.<key>=`, limit, offset),
  `POST /items`, `GET/PATCH /items/:id`, `POST /items/:id/duplicate`, `DELETE /items/:id`
  (`?permanent=true`), `GET /trash`, `POST /items/:id/restore`.
- Photos/attachments: `POST /items/:id/photos`, `POST /logs/:id/photos`, `PATCH /photos/:id`,
  `POST /items/:id/cover`, `DELETE /photos/:id`, `POST/GET /items/:id/attachments`,
  `DELETE /attachments/:id`. Static: `/images/orig`, `/images/thumb`, `/attachments/:f`.
- Logs/provenance/valuations: `GET/POST /items/:id/logs`, `PATCH/DELETE /logs/:id`,
  `GET/POST /items/:id/provenance`, `PATCH/DELETE /provenance/:id`,
  `GET/POST /items/:id/valuations`, `DELETE /valuations/:id`.
- Cross-cutting: `GET /search`, `GET /stats`, `GET /ammo-choices`, `GET /export/csv`,
  `GET /export/json`, `POST /import/csv/preview`, `POST /import/csv/commit`, `GET /backup`,
  `POST /restore`, `GET/PATCH /settings`, `POST /auth/pin`, `GET /health`.

## How ammo linkage works (`services/ammo.js` + `routes/logs.js`)

All inside one transaction per log write.
- **Rule 1 (quantity effect):** a log on an item in an `ammunition`-template collection whose `data`
  has `rounds_used` (decrement, floor 0) or `rounds_added` (increment) adjusts that item's `quantity`.
  Net effect = `rounds_added − rounds_used`. Create applies it; delete reverses; edit reverses old
  then applies new.
- **Rule 2 (auto usage link):** a log (e.g. firearms `range_session`) with numeric `data.rounds_fired > 0`
  and `data.ammo_item_id` pointing to a real ammo item auto-creates a `usage` log on that ammo item
  (`data: {rounds_used: rounds_fired, source_item_id}`, `linked_log_id` back to source; source's
  `linked_log_id` → the new usage log). Rule 1 then does the quantity math on the ammo item.
- **Edit reconciliation:** changing `rounds_fired`/`ammo_item_id` updates the linked usage log (reverses
  old effect, retargets to a different ammo item by delete+recreate, or updates in place); removing the
  linkage deletes the auto usage log. **Delete of source** deletes its linked usage log (only if that
  log is a genuine auto-created usage log, detected via `data.source_item_id`) and reverses quantity.

## Contract deviations / decisions the orchestrator must know

1. **FTS5 table option added (schema deviation from the literal §3 DDL).** §3 wrote
   `content=''`. A contentless FTS5 table does **not** allow `DELETE FROM … WHERE rowid=?`, which the
   spec's "rebuild row on write" requires. Changed the DDL to
   `content='', contentless_delete=1` (SQLite ≥3.43; better-sqlite3 v12 bundles 3.53). This is the
   only change to the DDL and it is functionally required. No API impact.

2. **`npm test` script fails on Node ≥25 (root package.json — orchestrator-owned).** The root script
   is `node --test server/test/`. Node 25 removed bare-directory test auto-discovery, so it errors with
   `Cannot find module '…/server/test'`. On the CI/DMG target (setup-node 22, per §7) it works fine.
   **Recommend the orchestrator change the root `test` script to**
   `node --test "server/test/**/*.test.js"` (works on Node 18–25). I could not edit root
   package.json. Verified: all 34 tests pass via `node --test "server/test/*.test.js"`.

3. **DB hot-swap uses a Proxy.** `ctx.db` is a `Proxy` that always forwards to the current underlying
   handle (`ctx._db`), so routers that captured `ctx.db` at construction still target the live
   connection after a restore reopens it. Restore closes → replaces files → reopens → re-runs
   migrations. Frontend impact: none.

4. **Value totals convention (implements §3/§4 "current else acquired").** All value aggregates
   (collection `valueCents`, `/stats` totals, insurance report basis) use
   `COALESCE(current_value_cents, acquired_price_cents, 0)` and exclude `sold|traded|gifted|wishlist`.
   `loaned` counts as owned. So an item with an acquisition price but no valuation still contributes.

5. **CSV money columns are dollars, not cents.** Export writes `acquired_price` / `current_value` as
   decimal dollars (e.g. `155.00`); import parses them back to cents. Field columns are prefixed
   `field:<key>`; a `tags` column is `;`-joined. `id` column round-trips: on commit, a row whose
   `core:id` matches an existing item in the target collection **updates** it (fields merged), else
   inserts. `new:<type>` mapping creates a field def from the header name (slugified key) then imports
   into it.

6. **CSV import preview mapping targets.** `suggestedMapping` values are one of
   `core:<name>` | `core:tags` | `field:<key>` | `new:<type>` | `skip`. `core:<name>` uses the API
   camelCase core names: `id,name,status,quantity,minQuantity,acquiredDate,acquiredPrice,acquiredFrom,currentValue,notes`.
   Pass `?collectionId=` to `/import/csv/preview` to get field-level suggestions (else core-only).
   Preview caches the parsed upload in `<dataDir>/tmp/import-<token>.json`; commit consumes+deletes it.

7. **`ammo_ref` fields** are stored as plain numbers server-side (the referenced item id). The client
   renders the picker from `GET /api/ammo-choices` (`[{id,name,quantity,caliber?}]`). The server does
   not validate that an `ammo_item_id` in arbitrary log data is an ammo item for *storage*, but rule 2
   only fires the linkage when it **is** a real ammunition-collection item.

8. **`/export/json`** omits `settings` secrets (`cookie_secret`, `lan_pin_hash`) for portability.

9. **Photo response shape:** `POST …/photos` → `{id, url, thumbUrl, filename, originalName, caption,
   width, height, sizeBytes, sortOrder, createdAt}`. `thumbUrl` is always `/images/thumb/<uuid>.jpg`.
   First photo on an item auto-becomes cover; deleting the cover reassigns to the next photo (or null).
   Client may send an optional `thumb` multipart part (client-canvas JPEG); absent → server copies the
   original as the thumb.

10. **List `ItemSummary.cardFields`** = values of field_defs with `showOnCard` OR `showInTable`
    (union), keyed by field key. `thumbUrl` from cover photo (or first photo) thumb, else `null`.

11. **Settings response** includes `reportOwner` (free-text for the insurance report cover, §5.1) in
    addition to the §4 fields. `PATCH /settings` accepts `reportOwner`. `lanUrls` enumerates
    non-internal IPv4; `qrDataUrl` is a data-URL QR for the first LAN url (null if none).

12. **PIN cookie** is `collectory_pin` (signed, httpOnly, 30 days, sameSite lax), secret stored in
    `settings.cookie_secret` (per-install, auto-generated). `POST /auth/pin` is rate-limited to 10
    attempts/minute/IP (in-memory).

## Root package.json needs

- Only issue: the `test` script (item #2 above). All required deps are already present
  (express, better-sqlite3, multer, adm-zip, papaparse, qrcode, cookie-parser; supertest dev). No new
  deps needed. `npm install` fetched better-sqlite3 v12 prebuilds for system Node; `npm run rebuild:node`
  available if an ABI error appears.

## Integration notes for the frontend agent

- Base URL `/api`. Errors: `{error:{message,code}}` with HTTP status. Money always integer cents in
  JSON; format client-side using the `currency` setting.
- `createApp(dataDir)` is synchronous (migrations run before it returns) — the Electron shell should
  call `start({dataDir})` (returns a Promise resolving `{app, server, port}`); auto-backup runs async
  after listen.
- SPA fallback: any non-`/api` GET serves `client/dist/index.html` if it exists; if `client/dist` is
  absent (not built yet) a minimal "client not built" page is returned. It picks up `client/dist`
  lazily once present (checked per request) — no server restart needed after the client builds.
- `field.<key>=<value>` list filters do exact JSON match — good for select/checkbox fields.
- Global `⌘K`/search: `GET /api/search?q=` returns `{results:[{item, collectionName, snippet}]}` (≤50),
  snippet wraps matches in `[...]`.
