# HANDOFF — resume here

**Project:** The Collectory — local-first Mac collection manager (firearms/ammo/magazines/
accessories/parts/knives/coins/stamps + custom). Electron + in-process Express + better-sqlite3
(CJS) + React/TS/Vite PWA. Repo `shopEngineering/collectory` (PUBLIC), signed + Apple-notarized.
Data in `~/Library/Application Support/Collectory/`. Download page: shopengineering.github.io/collectory.

**Run:** `npm run dev` (server :7117 + Vite :5173). Tests: `npm test` (57, node ABI —
`npm run rebuild:node` if `ERR_DLOPEN_FAILED`). Build DMG: `npm run dist`.

## State (what works now)
- **v1.0.7 is PUBLISHED and is the latest release** (2026-07-21), signed + notarized, verified via
  fresh-download + quarantine + `spctl` = Notarized Developer ID. v1.0.5 retired. Download page +
  in-app Check-for-Updates serve it.
- v1.0.7 bundles 1.0.4–1.0.6 (CSV import fixes + auto-field-mapping; sortable table columns incl.
  custom fields; clickable-row cursor) PLUS the full four-part security/architecture review
  remediation: 4 critical + 10 high findings fixed with tests. 57 backend tests; client build clean;
  `npm audit` clean.
- Docs (README, DESIGN §11, 00/02/03, memory) refreshed. Session prompts logged.
- No in-flight release action — publish is complete. (Notary keychain profile is `collectory-notary`;
  it vanished from the keychain once mid-session — if `notarytool` says "No Keychain password item
  found", re-run `xcrun notarytool store-credentials "collectory-notary" --apple-id
  "lukedub@gmail.com" --team-id "4VB36N29U5"`. Apple's notary queue was very slow this session — an
  arm64 submission wedged >1h; resubmitting a fresh copy cleared it.)

## Next steps (after publish)
1. **Cloud-automation cert export** (biggest win — ends local notarization fragility): Luke exports
   the Developer ID identity from Keychain Access → `~/Downloads/collectory-signing.p12` (password
   `funMhNhw1n0mjePFFWZsgRjA` in scratchpad `p12pw.txt`), then set 5 GitHub secrets — I set
   `CSC_LINK`(base64 of the .p12), `CSC_KEY_PASSWORD`(that pw), `APPLE_ID`, `APPLE_TEAM_ID`; Luke sets
   `APPLE_APP_SPECIFIC_PASSWORD`. Then a `v*` tag builds/signs/notarizes in CI (already wired;
   `.github/workflows/release.yml` skips unless all 5 secrets present).
2. **Import uncle's maintenance + range myArmsCache exports** — range logs map to a firearm's Activity
   timeline, NOT to items; needs a tailored path. (Guns/ammo/accessories/parts already import.)
3. **Real-iPad LAN/PWA acceptance test.**
4. **Deferred review backlog** (03-roadmap §"Deferred review backlog"): keyboard-a11y sweep, list
   virtualization (500+ items), multer 2.x, PIN KDF, `--ink-4` contrast (tokens.css access-restricted
   in this env), restore cookie-secret continuity.

## Key gotchas
- Local build leaves better-sqlite3 on the Electron ABI → `npm run rebuild:node` before server/tests,
  `npm run rebuild:electron` before `dev:app`/`dist`.
- The DMG must be code-signed SEPARATELY from the app (electron-builder leaves it unsigned) or
  Gatekeeper blocks the download on mount — always sign both DMGs before notarizing.
- Ammo `quantity` is stored SIGNED, clamped to 0 only at display (so round counts reverse exactly).
- Force-deleting a non-empty collection is a PERMANENT delete + unlinks photo/attachment files (NOT
  Trash). Per-item delete still uses Trash.
- `docs/template/` holds the uncle's REAL export files (serial numbers) — gitignored, never commit.
- Luke sometimes drives running subagents directly; treat unexpected "corrections" in agent
  transcripts as probably-him and verify rather than override.

## Key artifacts
- `docs/specs/DESIGN.md` (canonical; §11 = post-v1.0 spec deltas) · `00-PROJECT-INDEX.md` ·
  `02-what-has-been-built.md` · `03-roadmap-and-remaining-work.md` · `notes-{backend,frontend,shell}.md`
- Review detail: session scratchpad `review-{security,backend,frontend,data}.md`; report artifact
  published this session.
- File memory: `~/.claude/projects/-Users-luke-claudeProjects-collectory/memory/collectory-project.md`.
- Release/CI: `electron-builder.config.js`, `.github/workflows/{release,pages}.yml`, `build/`.
