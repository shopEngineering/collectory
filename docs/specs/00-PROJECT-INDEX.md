# The Collectory — Project Index

**Status: v1.0.7, public, signed + notarized (2026-07-21).** Display name **The Collectory**; repo
`shopEngineering/collectory` (PUBLIC); download page at https://shopengineering.github.io/collectory/.
Every download opens with a clean double-click (Developer ID + Apple notarization). A full four-part
security/architecture review has been completed and its findings implemented (see below).

## What this is
Universal local-first collection tracker (firearms, ammo, magazines, accessories, parts, knives,
coins, stamps, custom) for a private collector. Mac DMG (Electron) + LAN-served iPad PWA, SQLite +
local image library. No servers, no cloud, no telemetry — the audience's #1 trust criterion.

## Read in this order to resume
1. `docs/specs/HANDOFF.md` — if present, the canonical resume-here (kept by /compact-resume).
2. `DESIGN.md` — canonical spec: architecture, DDL, REST contract, decisions (§10), plus §5.1/§5.2
   addenda. Note the post-review spec deltas listed in §11 (added below).
3. `02-what-has-been-built.md` — implemented reality + release history + verification log.
4. `03-roadmap-and-remaining-work.md` — remaining work + the deferred review backlog.
5. `notes-backend.md` / `notes-frontend.md` / `notes-shell.md` — per-area build notes.
6. `docs/research/` — competitive + domain/UX research digests.

## Release history (all signed + notarized after v1.0.2)
- 1.0.0–1.0.2 — initial build; renamed to "The Collectory"; Developer ID signing + notarization set up.
- 1.0.3 — public repo, in-app update checks, GitHub Pages download page, Accessories & Parts templates.
- 1.0.4 — CSV import fixes (no dropped rows; nameless ammo gets derived names; comma quantities).
- 1.0.5 — CSV importer auto-maps columns to the target collection's fields.
- 1.0.6 — sortable table columns (incl. custom fields) + clickable-row cursor. (Folded into 1.0.7.)
- **1.0.7 — security + data-integrity hardening from the full review** (below). Current release.

## The review (2026-07-21)
Four independent expert passes — security, backend correctness, frontend quality, data/packaging.
Consolidated report artifact + four detail files were produced. Core rated well-built by all four;
4 critical + 10 high findings. Implemented in 1.0.7 (57 backend tests, 15 new; client build clean;
`npm audit` clean). See `03-roadmap-and-remaining-work.md` for the fixed list, deferred backlog, and
the report pointer.

## Decisions log (this session's non-obvious calls)
- **Magazines are child records of firearms, not a top-level collection** (user-directed).
- **Force-deleting a non-empty collection is a permanent delete** (with photo/attachment file
  cleanup), NOT a move-to-Trash — deleting a whole collection is deliberate; per-item delete still
  uses Trash. (Review C2.)
- **Ammo quantity is stored signed, clamped to 0 only at display** — so round-count deltas reverse
  exactly (Review C1).
- **LAN gate reads the real socket address, `trust proxy` off** — X-Forwarded-For can't spoof
  loopback (Review C4).
- **CSP allows the app's own inline theme/styles but blocks all external resources + exfiltration**
  (`connect-src 'self'`) — the meaningful protection for a no-telemetry app; a strict script-src
  would break the inline pre-paint theme.
- **CSV formula-injection guard deliberately skipped** — prefixing cells would corrupt the lossless
  import/export round-trip; single-user own-data risk is low.
- **DMG must be code-signed separately** from the app (electron-builder leaves it unsigned) or
  Gatekeeper blocks the download on mount — build flow signs both, then notarizes+staples.
- **Rolled straight from 1.0.6 to 1.0.7** rather than publish 1.0.6 and immediately supersede it.

## Cloud automation status (pending user action)
CI is wired to build/sign/notarize in the cloud on a `v*` tag once the 5 signing secrets are set
(`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). The
remaining manual step is exporting the Developer ID `.p12` (Keychain Access) into `CSC_LINK`. Until
then, releases are built + notarized LOCALLY (Developer ID in the login keychain, notarytool profile
`collectory-notary`). Local notarization is fragile — the keychain notary credential has vanished
once mid-session (re-run `xcrun notarytool store-credentials "collectory-notary"`); cloud automation
ends this.

## TODOs (user-facing)
- [ ] Finish the cloud-automation cert export → 5 GitHub secrets → future releases are one tag push.
- [ ] Import uncle's real myArmsCache maintenance + range export files (range logs map to a firearm's
      Activity timeline, not to items — needs a tailored path).
- [ ] Real-iPad LAN/PWA acceptance test.
- [ ] Deferred review backlog: keyboard-a11y sweep, list virtualization (500+ items), multer 2.x,
      PIN KDF hardening, `--ink-4` contrast (file access-restricted in the build env), restore
      cookie-secret continuity. See 03-roadmap.
