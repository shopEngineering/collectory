# 01 — Vision & Architecture

## Problem
A private collector (the user's uncle) manages firearms, ammunition, knives, coins, and stamps
across spreadsheets plus myArmsCache (iOS). Nothing unifies them; nothing is Mac-native; the
market's unsolved tension is sync-without-cloud, and for this audience cloud storage of serials is
a hard red line (see `docs/research/competitive-landscape.md`).

## Goal
One local-first app: expert-depth per-category templates over a universal engine (custom fields,
activity logs, provenance, valuations, photos, documents), delivered as a Mac DMG and an
iPad-installable LAN PWA from the same codebase, with data durability (auto-backups, CSV/JSON
round-trip, open SQLite) as a headline feature.

## Architecture (authoritative detail: `DESIGN.md`)
- **One Express server** (CommonJS, better-sqlite3, port 7117) serves the REST API, the built React
  client, and the image library. It runs in-process inside Electron for the desktop app, or
  headless (`npm run server`).
- **Client**: React 18 + TS + Vite PWA, hand-rolled "Private Archive" design system (dark-first,
  Fraunces/Archivo, brass accent), fully dynamic rendering from per-collection field/log-type defs.
- **Data**: SQLite (WAL) at `~/Library/Application Support/Collectory/` + `images/orig|thumb` +
  `attachments/` + rotating `backups/auto/`. Hybrid schema: universal core columns + per-collection
  `field_defs` + `fields_json` values + FTS5 search.
- **Electron shell**: window + native menu only; ad-hoc signed DMG via electron-builder; GitHub
  Actions release workflow on `v*` tags (arm64 + x64).
- **iPad**: LAN toggle (off by default) + optional PIN; loopback always trusted; QR onboarding;
  iOS 26 standalone PWA over plain HTTP (validated).

## Evidence
Three research agents (competitive landscape, domain schemas, UX/packaging) — digests in
`docs/research/`. Key architecture-shaping findings: LAN-sync gap, bulk-import gap, NFA-tracking
gap, computed-not-stored round counts, ad-hoc signing requirement on Sequoia+, iOS 26 PWA behavior.
