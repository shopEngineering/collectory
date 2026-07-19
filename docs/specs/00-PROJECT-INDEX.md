# Collectory — Project Index

**Status: v1.0.3 released, repo public (2026-07-19).** Display name is **The Collectory**; repo
`shopEngineering/collectory` (PUBLIC). Live: releases with arm64+x64 DMGs, a GitHub Pages download
page at **https://shopengineering.github.io/collectory/**, and in-app update checks.

Same-day feature timeline after the initial single-shot build (all shipped in v1.0.3):
inline table editing + edit pane · UX round (prominent Edit, one-tap photos, clickable rows) ·
magazines as child records of firearms · display rename to "The Collectory" (data folder stays
`Collectory`) · **Accessories & Parts templates** (item-ref linked to firearms) · **in-app updates**
(Check for Updates + launch check; one-click DMG download — silent auto-install still needs an Apple
Developer ID) · **public repo + GitHub Pages landing page** (`web/index.html`, deployed by
`.github/workflows/pages.yml`; DMG names are version-independent so `/releases/latest/download/`
links never drift).

## What this is
Universal local-first collection tracker (firearms, ammo, knives, coins, stamps, custom) for a
private collector. Mac DMG (Electron) + LAN-served iPad PWA, SQLite + local image library.
No servers, no cloud, no telemetry — the audience's #1 trust criterion.

## Read in this order to resume
1. `docs/specs/DESIGN.md` — canonical spec: architecture, DDL, REST contract, decisions (§10).
2. `docs/specs/02-what-has-been-built.md` — implemented reality + verification log + fixes.
3. `docs/specs/03-roadmap-and-remaining-work.md` — everything future, ordered.
4. `docs/specs/notes-backend.md` / `notes-frontend.md` / `notes-shell.md` — per-agent build notes.
5. `docs/research/` — competitive landscape + domain/UX research digests.

## Key artifacts
- `server/` (Express+SQLite backend, 34 tests) · `client/` (React/TS PWA) · `electron/` + `build/`
  (shell + icon) · `server/templates/*.json` (6 expert templates) · `.github/workflows/release.yml`
- Screenshots: `docs/screenshots/` (dashboard, browse, item detail, report, mobile).
- Demo/verification data dir (scratch, disposable): session scratchpad `demo-data/`.

## Decision log
DESIGN.md §10 table (stack, schema hybrid, thumbnails, signing, LAN model, money-as-cents, soft
delete, port) + §5.1 research addenda (envelope conventions, CSV id round-trip, auto-backups,
no service worker, ad-hoc signing). Post-build decisions: sub-resource list envelopes stay wrapped
(frontend unwraps at the hooks seam); timeline resolves item references by name.

## Scope notes
- In: everything in DESIGN §1 targets. Out (v1, deliberate): cloud anything, native mobile,
  price-API/AI valuation (trust-destroyer per research), notarization (until audience grows).
- Alternate scope considered and rejected: Tauri (Rust sidecar complexity), pure PWA (no DMG),
  EAV schema (join sprawl) — rationale in DESIGN §10.

## TODOs (user-facing)
- [x] Public repo, v1.0.3 released (arm64+x64 DMGs), GitHub Pages download page live, in-app updates.
- [ ] Import uncle's real myArmsCache data: he exports CSV (Support → Export Data) per category;
      import via /import wizard. Guns/Ammo/Accessories/Parts map to collections; Range Reports are
      logs (not items) so need a tailored path; photos don't travel in CSV. Tune firearms template +
      mapping to his exact headers from a sample export.
- [ ] Real-iPad LAN/PWA acceptance test.
- [ ] Apple Developer ID ($99/yr) → removes first-open "Open Anyway" AND enables fully-silent
      background auto-update (electron-updater); until then updates are notify + one-click download.
- Dedicated Accessories/Parts icons (currently reuse `camera`/`box`); user can change per-collection.
