# 03 — Roadmap & Remaining Work

**As of v1.0.7 (2026-07-21):** shipped, public, signed + notarized; a full four-part code/security
review has been completed and its criticals+highs fixed. The near-term list below is largely done
(struck where complete); the live remaining work is the **cloud-automation cert export**, the
**myArmsCache maintenance/range import**, a **real-iPad test**, and the **deferred review backlog**.

## Deferred review backlog (from the 2026-07-21 review — not yet done, prioritized)
Full report: artifact + `scratchpad/review-{security,backend,frontend,data}.md` (session-local).
1. **Keyboard-accessibility sweep** — menus mouse-only; table rows / grid cards / sort headers not
   keyboard-operable; modals/palette/lightbox/edit-pane lack focus traps; rating "radiogroup"
   children aren't radios. Goal: full keyboard operability + focus management. Medium-large effort.
2. **List virtualization** — grid/table re-render fully on each keystroke/inline-edit at 500+ items.
   Goal: virtualize + memoize rows. Only needed once a collection gets large.
3. **multer 2.x** — 1.x is EOL (no active CVE). Breaking API change; upgrade carefully.
4. **PIN KDF hardening** — unsalted SHA-256; add a per-install salt + iterations (handle migration of
   existing PINs).
5. **`--ink-4` text contrast** fails 4.5:1 in both themes — bump it. NOTE: `client/src/styles/
   tokens.css` is access-restricted in the current build environment; needs a session with access.
6. **Restore cookie-secret continuity** — after restore, cookieParser still uses the boot-time secret,
   invalidating PIN cookies until restart. Low.
7. **JSON export includes trashed items** while CSV excludes them — decide/align (arguably correct for
   a full-fidelity backup dump).

## Near term (high value, low risk)
1. ~~**First GitHub release**~~ — DONE. Repo public, releases signed + notarized, download page live.
2. **Migration import of the uncle's real data** — run his myArmsCache CSV export and spreadsheets
   through `/import`; tune `suggestedMapping` fuzzy rules against his real headers. Acceptance:
   full inventory imported with photos re-attached, zero manual re-typing of data fields.
3. **Auto-update** — electron-updater against GitHub Releases (needs notarization to be smooth;
   see 5). Until then: in-app "new version available" check against the Releases API (read-only).
4. **Saved views** — persist named filter/sort/column sets per collection (research: Notion/Plex
   smart-collection pattern is the single most-loved power-user feature).
5. **Notarization** — $99/yr Apple Developer; removes the Open-Anyway friction entirely.

## Medium term
6. **Set/series completion tracking** (coins first): checklist axis (e.g. Morgan date+mintmark
   run) separate from ownership; % complete on dashboard. PCGS Registry engagement pattern.
7. **Numista autofill** (coins): free API v3; country/denom/year → specs, mintage, KM#, images.
   Strictly identification, never valuation (research: AI/auto valuation destroys trust).
8. **Estate/executor bundle** — one click: full backup + printable heir-readable report (incl.
   NFA transfer notes) to a chosen folder. Research says heir-friendliness keeps collectors on
   Excel; nobody ships this.
9. **Document expiry reminders** — optional expiry date on attachments (permits, insurance
   riders); dashboard alert like low-stock.
10. **ATF bound-book-style export** — acquisition/disposition columns in the report generator
    (NM Collector precedent; personal record-keeping).

## Long term / ideas parking lot
- On-device OCR scan-assist (receipts/serials → fields) — local only, no cloud AI.
- PCGS cert-number autofill (public API, quota'd).
- Reload recipes + component inventories (powder/primer/brass) with cost-per-round.
- Album-space completion for stamps (published-album axis, Scott National).
- Barcode/UPC quick-add for ammo restock.
- Biometric/password app lock on the Mac app (LAN PIN already exists).
- Knife pattern-run completion grid; Case tang-stamp dating assistant (rule-encodable).
- Multi-currency; localization.

## Known limitations (accepted for v1)
- LAN PWA is plain HTTP: on pre-iOS-26 iPads the home-screen icon opens with Safari chrome
  (functional; standalone requires iOS 26 or a self-signed-cert flow we deliberately skipped).
- No service worker → no offline iPad use (Mac must be awake and on the LAN).
- Restore replaces the whole dataset (by design, with automatic safety zip).
- Local dev on Node 25 + Python 3.14 needs `setuptools` for any from-source native build
  (prebuilds normally avoid this entirely).
