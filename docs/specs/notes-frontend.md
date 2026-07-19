# Frontend implementation notes (client/)

**Status:** complete — `npm --prefix client run build` (tsc strict `-b` + vite build) passes with zero
errors. Visual smoke pass done against a mock server (dashboard, browse, item detail, item form,
report, mobile 390px, both themes).

## Stack & layout

React 18 + TypeScript strict + Vite 5 + react-router-dom v6 (BrowserRouter) + @tanstack/react-query v5.
Fonts bundled locally: `@fontsource-variable/fraunces`, `@fontsource-variable/archivo` (no CDN; fully
offline). No UI framework; hand-rolled design system in plain CSS. Dev proxy: `/api`, `/images`,
`/attachments` → `http://127.0.0.1:7117`. Build outDir `client/dist`.

```
client/
├── index.html                 §5.1 meta set: manifest, apple-touch-icon, apple-mobile-web-app-*,
│                              theme-color (per scheme), viewport-fit=cover, pre-paint theme script
├── public/manifest.webmanifest  name/short_name, standalone, icons 192/512 (+maskable), start_url /
├── vite.config.ts             proxy + outDir dist
├── tsconfig(.app/.node).json  strict, noUnusedLocals/Parameters
└── src/
    ├── main.tsx               providers: QueryClient (mutations retry off), Theme, Toast, Router
    ├── App.tsx                routes, ⌘K palette wiring, PIN gate, Electron onNavigate bridge
    ├── vite-env.d.ts          vite/client types + window.collectory bridge type
    ├── api/
    │   ├── types.ts           full §4 contract types (camelCase, cents, FieldDef/LogTypeDef…)
    │   ├── client.ts          fetch wrapper; error normalization {error:{message,code}};
    │   │                      401 PIN_REQUIRED → CustomEvent; XHR upload w/ progress; downloadUrl()
    │   └── hooks.ts           react-query hooks per resource + invalidation graph (qk factory)
    ├── lib/
    │   ├── format.ts          Intl money (settings currency), dates (free-precision), qty, sizes
    │   ├── hooks.ts           useDebouncedValue, usePersistentState, useMediaQuery, useIsElectron,
    │   │                      useBeforeUnload, useHotkey('mod+k')
    │   ├── image.ts           canvas thumbnail ≤400px JPEG (createImageBitmap w/ <img> fallback)
    │   └── theme.tsx          system|light|dark, localStorage 'collectory:theme', data-theme on <html>
    ├── styles/                tokens / base / components / layout / features / print (see below)
    ├── components/
    │   ├── Icon.tsx           ONE inline-SVG set (1.5px stroke, 24 grid): all §5.1 collection keys,
    │   │                      all log-type keys, ~50 UI icons; COLLECTION_ICON_KEYS export
    │   ├── Layout.tsx         sidebar (collections nav w/ color dots+counts) + topbar (⌘K search);
    │   │                      <900px overlay sheet; Electron 38px drag strip (-webkit-app-region)
    │   ├── CommandPalette.tsx ⌘K portal: actions + collections + item FTS, arrow-key nav, kbd hints
    │   ├── NewCollectionModal.tsx  template rich-cards (icon/name/desc/field-count) + Start Blank →
    │   │                      name/icon-picker/color-swatches step
    │   ├── PinScreen.tsx      full-screen numeric keypad, POST /api/auth/pin, shake on error
    │   ├── FieldInput.tsx     Field/FieldInput: renderer for every FieldDef.type incl. currency
    │   │                      (dollars UI ↔ cents value), number+unit suffix, multiselect pills,
    │   │                      rating dots, ammo_ref → AmmoPicker
    │   ├── AmmoPicker.tsx     /api/ammo-choices select: name · caliber (qty rds)
    │   ├── TagPicker.tsx      token input (enter/comma adds, backspace pops)
    │   ├── Lightbox.tsx       keyboard nav (←/→/esc), captions, counter
    │   ├── Toast.tsx          custom toast stack (error/success/info), used for all mutation errors
    │   ├── ui.tsx             Portal, Modal, ConfirmDialog, Menu (portal-positioned), Spinner,
    │   │                      LoadingBlock, ErrorBlock, Switch, Kbd, SectionLabel
    │   └── bits.tsx           StatusBadge, CollectionDot, TagChip, PhotoFill (blur-fill + contain),
    │                          ValueFigure, EmptyState (+ trust line), EmptyIllustration
    └── pages/
        ├── DashboardPage.tsx      stats cards, tiles, SVG acquisition chart, recents, feed, alerts
        ├── BrowsePage.tsx         grid/table, URL-mirrored filters, batch mode, density slider
        ├── ItemFormPage.tsx       core + DynamicForm by section, NFA disclosure, Save & add another,
        │                          photo uploader (thumb part + progress), tags, dirty guard
        ├── ItemDetailPage.tsx     ambient banner, stat chips, gallery+lightbox, spec sheet,
        │                          tabs: Activity/Provenance/Value/Files, kebab actions
        ├── CollectionSettingsPage.tsx  meta, field editor (DnD reorder, modal, options editor),
        │                          log-type editor ('note' undeletable), danger zone
        ├── SearchPage.tsx         /search?q= grouped by collection
        ├── SettingsPage.tsx       appearance/currency/report-owner/LAN(QR,PIN)/data(backup,restore,
        │                          exports)/about
        ├── ImportPage.tsx         pick → preview/mapping (per-header targets incl core:id, new:<type>)
        │                          → commit → results
        ├── ReportPage.tsx         §5.1 insurance report, serial mask (●●…last2), window.print()
        ├── TrashPage.tsx          restore / delete-forever (double confirm)
        └── NotFoundPage.tsx
```

## Design tokens ("The Private Archive")

- **Themes:** dark-first `#131512` bg (green-tinted charcoal, never pure black), surfaces `#1c201b→#272d24`;
  light "paper" `#f3f0e8` with green-black ink. `data-theme` on `<html>`, pre-paint script in
  index.html avoids flash; `system` follows `prefers-color-scheme` live.
- **Accent:** brass `#c8a55e` (dark) / `#8a6d34` (light) — primary buttons, money figures, focus rings.
  Per-collection accent (API `color`) used structurally: 3px card spines (`--card-accent`), sidebar
  dots, spec-section rules (`--sec-accent`), tile spines (`--tile-accent`), log-node color (`--tl-color`).
- **Type:** Fraunces (variable) for page titles/item names/money numerals (`.serif`, tabular-nums via
  `.tnum`); Archivo for UI; `ui-monospace` stack for serials (`.spec-val-mono`); `.eyebrow` =
  11px/600/0.08em uppercase section labels.
- **Texture:** body::before film-grain overlay (inline SVG feTurbulence data-URI, 2.5–3% opacity,
  blend overlay); hairline low-alpha borders; sparse soft shadows.
- **Photos:** `PhotoFill` = blurred cover-fill backdrop + `object-fit: contain` hero — long items never
  crop. Detail banner = blurred darkened cover behind header.
- **Motion:** 130–220ms ease-out; grid stagger (animationDelay × index, cap 12); 2px hover lift;
  `prefers-reduced-motion` kills all animation globally.
- **Touch/PWA:** inputs 16px under 900px (no iOS zoom), ≥44px targets, hover affordances behind
  `@media (any-hover:hover)` with long-press/kebab fallbacks, `env(safe-area-inset-*)` padding,
  persistent back-links. No service worker (per spec).

## Contract assumptions / deviations (for orchestrator reconciliation)

1. **`GET /api/items/:id/attachments`** — assumed to exist (used by Files tab). §4 only lists
   POST/DELETE explicitly; if the server nests attachments in the Item payload instead, swap
   `useAttachments` to read `item.attachments`.
2. **`reportOwner` in settings** — read from `GET /api/settings` and written via
   `PATCH /api/settings {reportOwner}` (spec §5.1 names the setting `report_owner`; camelCase assumed).
3. **Restore multipart field** — `POST /api/restore` sent with part name `file` (spec says "multipart
   zip" without naming the field). Import preview also uses `file` (spec-named).
4. **Batch operations** — batch status/tag PATCH `/items/:id` directly in a loop (rules-of-hooks), then
   invalidate once. Batch tag-add computes union from the loaded ItemSummary.tags (full-replacement
   `tags` array semantics per §4).
5. **Serial masking (report)** — masks cardFields whose key matches `/serial/i` (all but last 2 chars →
   `●`); report only has ItemSummary/cardFields, no FieldDefs, so key-name matching is the heuristic.
6. **Report scope** — includes statuses `owned,loaned` only (insurance semantics per §3); value =
   `currentValueCents ?? acquiredPriceCents`; fetches per-collection via `useQueries`, limit 1000.
7. **Ammo-ish detection** — `collection.templateKey === 'ammunition'` gates min-quantity input and
   "N rds" quantity display.
8. **Create-mode photos** — queued locally, uploaded sequentially after POST /api/items succeeds
   (no item id exists before save). Edit mode uploads immediately. Thumb generation failure falls back
   to uploading without the `thumb` part (server copies original per §4).
9. **NFA disclosure (generic)** — any section whose fields are all empty AND whose first field is an
   unchecked checkbox collapses behind a disclosure; no template-specific keys.
10. **Photo reorder** — up/down arrows PATCHing sortOrder (not full drag-drop) in the uploader;
    field-editor reorder in collection settings IS drag-and-drop (HTML5 DnD).
11. **Delete collection 409** — the hook surface doesn't expose status codes cleanly, so any failure of
    the plain DELETE offers the force-delete confirm (the force path errors independently if genuine).
12. **`theme` also PATCHed** to settings for server-side persistence, but the client's own
    localStorage value is authoritative for rendering.

## Known gaps / nice-to-haves (non-blocking)

- Photo captions edit on blur; no inline crop/rotate.
- Table view column sorting maps only Name/Value/Qty + `acquired_date`/`acquired_price` field keys to
  server sorts; other field columns are display-only.
- Command palette "Backup Now" routes to Settings rather than triggering the download directly.
- No optimistic updates beyond react-query defaults (per §8 only trivial toggles would qualify).
- Icons in `client/public` (favicon.png, icon-192/512, apple-touch-icon.png) are referenced but owned
  by the shell/asset agent — not generated here.

## 2026-07-19 follow-up: inline table editing + edit pane

Two Browse-page editing features, all inside `client/` (no server changes; relies on
`PATCH /api/items/:id` partial core + `{fields:{key:value}}` merge already supported).

### Feature 1 — spreadsheet-style inline editing (table view)
- **New `components/InlineCellEditor.tsx`** — control per cell type (text/textarea→
  single-line text, number, currency $→cents, date, year, select, checkbox, url, rating).
  Enter/blur commits, Esc reverts, Tab commits + advances to the next editable cell in the
  row (Shift+Tab = previous). A `settled` ref guards the blur-after-commit double-fire.
  Per-cell pending spinner via `.cell-editor[data-pending]`. `parseValue` normalizes
  checkbox→boolean, rating/number/year→number, currency→cents. Editors are 16px
  (13px ≥900px) with a brass focus ring.
- **`pages/BrowsePage.tsx` `TableView`** — name, status (select of the six statuses),
  quantity, value, and every `showInTable` dynamic field of an editable type become a
  double-click editor. **multiselect** and **ammo_ref** are display-only inline (use the
  pane). Tags/thumbnail columns unchanged.
- **Single vs double click:** a 220ms deferred-nav timer on the row `onClick` lets a
  double-click cancel navigation and open the editor; row nav is suppressed while any cell
  in that row is editing; select-mode and the actions/checkbox columns `stopPropagation`.
  `renderEditableTd` is a plain render helper (not a nested component) so the open editor
  keeps stable `<td>` identity and never remounts.
- **Commit:** `commitCell` PATCHes via `api.patch` (row id is dynamic, so not the per-id
  `useUpdateItem` hook — mirrors `BatchBar`), core keys top-level and dynamic under `fields`.
  Success invalidates `['items']`, `['item',id]`, `['stats']`, `['collections']`; error
  toasts + re-invalidates `['items']` to revert to server truth.
- **Affordance:** editable cells show a brass-ghost hover tint + inset ring behind
  `@media (any-hover:hover)`; on touch the row/card pencils stay visible.

### Feature 2 — slide-over edit pane (grid + table)
- **Extracted `components/ItemForm.tsx`** — the form body of ItemFormPage moved into a
  reusable component: `{collection, item, variant:'page'|'pane', onSaved, onCancel,
  registerRequestClose?}`. Core section + dynamic sections (NFA-style collapse) +
  PhotoUploader (create-mode deferred queue preserved; edit-mode immediate upload) + tag
  picker + unsaved-changes ConfirmDialog. `registerRequestClose` routes a host's scrim/Esc
  close through the same guard as Cancel.
- **`pages/ItemFormPage.tsx`** is now a thin route wrapper (loaders + back-link + title)
  rendering `<ItemForm variant="page">`. Zero behavior change for `/new` and `/edit`.
- **New `components/EditPane.tsx`** — right slide-over drawer (Portal + `.pane-scrim`),
  600px / full-height, `pane-in` slide ≤220ms, full-screen sheet under 900px, body-scroll
  locked. Loads item + collection by id → `<ItemForm variant="pane">` (edit-only). Esc /
  scrim / Cancel close via the form guard. Save → PATCH (shared form's `useUpdateItem`,
  which already invalidates list + item), close, toast "Saved".
- **Browse wiring:** pencil on table-row hover (`.row-edit`) and card hover (`.card-edit`,
  always visible on touch). Opening sets `?edit=<itemId>` (via `patchParams`, same URL-state
  convention as filters) so back-button + deep links work; closing removes it. The pane is a
  portal overlay, so the list's filters/sort/scroll behind it are untouched.

### Files touched
- Added: `client/src/components/ItemForm.tsx`, `EditPane.tsx`, `InlineCellEditor.tsx`.
- Modified: `client/src/pages/BrowsePage.tsx`, `client/src/pages/ItemFormPage.tsx`,
  `client/src/styles/features.css`.

### Interaction decisions
- Single click = row nav (deferred 220ms), double click = edit — standard spreadsheet
  resolution; the delay applies only to table-view row navigation.
- multiselect / ammo_ref fall back to the pane (don't fit a single-cell surface).
- Edit pane is edit-only; creation stays on `/new` so the deferred-photo flow is untouched.
- Revert-on-error via `['items']` re-invalidation (react-query refetch) rather than
  optimistic rollback — consistent with §8.

## 2026-07-19 follow-up 2: prominent Edit, easy photo adding, clickable rows

Three UX refinements, client-only.

### Prominent Edit (item detail)
- Banner header now shows a visible secondary **Edit** button (pencil + label,
  `.btn`) left of the kebab; navigates to `/items/:id/edit`. "Edit" removed from
  the kebab, which keeps Duplicate / Print / Move to trash.

### Easy photo adding
- **New `lib/photoUpload.ts`** — shared `uploadPhotoFile(path, file, caption?)`:
  canvas thumbnail (`makeThumbnail`) + multipart POST (`photo`/`thumb`/`width`/
  `height`/`caption` parts); server copies the original if the thumb part fails.
- **Inline add-log form (Activity tab)**: a dashed photo-attach row
  (`.log-photo-add`) with an "Add photos" button (camera icon, `capture=
  "environment"` for iPad, multiple) and drag-drop. Files queue locally with
  object-URL thumbnails + per-photo remove; on submit the log is created first,
  then each queued file POSTs to `/api/logs/:id/photos`, then `['logs', itemId]`
  re-invalidates so the timeline shows them. Submit button shows "Attaching
  photos…" while uploading; queue clears on success only.
- **Every timeline log entry**: a small camera button in its header (next to the
  date/kebab — works for photo-less logs too) → file picker → uploads to that
  log, invalidates the logs query. Spinner replaces the icon while uploading.
- **Item gallery**: always-visible dashed "Add photo" tile (`.gallery-add`,
  camera icon, capture attr, multiple) at the end of the thumbnail strip —
  uploads straight to `/api/items/:id/photos` (no edit mode) and invalidates
  `['item', id]` + `['items']` so cover/gallery/list refresh. The gallery strip
  now renders even for zero-photo items (just the tile); tile is `no-print`.

### Clickable table rows
- Row hover (`table.data.editable`, `@media (any-hover:hover)`): surface tint +
  `var(--shadow)` lift + a 3px inset brass bar — echoes the card hover/accent.
- Name cell (`.cell-name`): medium weight + ink always; brass underline on row
  hover (suppressed while that cell is inline-editing).
- Trailing chevron-right (`.row-go`) inside the Actions cell after the pencil:
  slides in on row hover; always visible at 0.4 opacity on coarse pointers.
  `col-actions` widened 44→64px. The Actions td no longer swallows clicks —
  only the pencil stops propagation, so chevron/gap clicks navigate the row.
  Double-click-to-edit and select mode verified unchanged.

### Files touched
- Added: `client/src/lib/photoUpload.ts`.
- Modified: `client/src/pages/ItemDetailPage.tsx`, `client/src/pages/BrowsePage.tsx`,
  `client/src/styles/features.css`.

Verified against the live demo (Playwright): Edit button + gallery tile + log
attach row + per-log camera render; a real upload to a log's photos endpoint
round-tripped and appeared in the timeline (then removed); row hover shows
underline/brass bar/pencil+chevron; double-click inline editing still opens.

## Verify

```
npm --prefix client install
npm --prefix client run build   # tsc -b (strict) + vite build → client/dist
```

## 2026-07-19: v1.1 magazines & item references (revised mid-build)

Design pivot mid-build (user decision): magazines are child records of a firearm item, not a
collection — see DESIGN §5.2 (as built).

- **`api/types.ts`** — FieldType += `item_ref`/`item_refs`; FieldDef += `refTemplate?`;
  `FieldValue` now includes `number[]` (item_refs id arrays); new `ItemChoice`, `RelatedGroup`,
  `RelatedResponse`, `Magazine`, `MagazineInput`.
- **`api/hooks.ts`** — `useItemChoices(refTemplate, q)` (keepPreviousData), `useRelated(itemId)`,
  `useMagazines/useCreateMagazine/useUpdateMagazine/useDeleteMagazine` (invalidate
  `['magazines',id]` + `['related']`); item create/update + log mutations also invalidate
  `['item-choices']` + `['related']`.
- **New `components/ItemRefPicker.tsx`** — `ItemRefPicker` (single: chosen chip with clear, else
  search dropdown) and `ItemRefsPicker` (chips with remove + search dropdown). Debounced (180ms)
  search over `/api/item-choices`; dropdown rows show thumb/name/collection · hint · qty; Enter
  picks first match; outside-click closes. CSS: `.ref-chip/.ref-search/.ref-menu/.ref-option` in
  features.css.
- **`FieldInput.tsx`** — renders `item_ref`/`item_refs` via the pickers (item_refs is full-width);
  `ammo_ref` → AmmoPicker with optional `associatedIds` threaded through `Field`.
- **`AmmoPicker.tsx`** — sorts the gun's `associated_ammo` ids first with "★ … — associated"
  option marker (native select).
- **`ItemDetailPage.tsx`** — spec sheet renders ref values as `ItemNameRef` links; right column
  gains `RelatedCard` (skipped when both directions empty; groups of linked `.ref-chip-link`
  chips); **Magazines tab** (firearms template only): `MagazinesTab`/`MagazineRow`/`MagazineForm` —
  list with ×qty + Loaded badge + "Holds:"/"Loaded with" ammo links, create/edit/delete, kebab
  "Log issue" creates a titled note log on the gun. Form uses ItemRefsPicker (holds) + AmmoPicker
  (loaded_with, help: loading never deducts).
- **`Icon.tsx`** — `magazine` icon (box-mag silhouette: curved body, feed lips, witness holes,
  floorplate); added to `COLLECTION_ICON_KEYS`.
- Build: `tsc -b` strict + vite clean. Verified live on :7117 (Colt Python Magazines tab + ammo
  Related card showing associated_ammo / In magazines of / used_with).
