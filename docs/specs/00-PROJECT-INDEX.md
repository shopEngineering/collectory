# Collectory — Project Index

**Status: v1.0.0 built, tested, and verified (2026-07-19).** Single-shot orchestrated build
complete: 3 research agents + 3 implementation agents (backend / frontend / shell) + fable
orchestrator. Remaining user action: push to GitHub + tag to publish the first release.

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
- [x] GitHub repo (shopEngineering/collectory), pushed, tagged v1.0.0 — CI builds arm64+x64 DMGs
      into a draft release; publish the draft when satisfied.
- [ ] Import uncle's real myArmsCache/spreadsheet data via /import.
- [ ] Real-iPad LAN/PWA acceptance test.
- [ ] Decide on notarization ($99/yr) if distribution widens.
- Session note (resolved): mid-build "mystery" messages to subagents turned out to be the user
  steering an agent directly (magazines redesign → option #2, confirmed); one earlier ops-agent
  "injected reminder" report was a benign misread of normal harness notices. No integrity issue.
