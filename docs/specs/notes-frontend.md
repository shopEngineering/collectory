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

## Verify

```
npm --prefix client install
npm --prefix client run build   # tsc -b (strict) + vite build → client/dist
```
