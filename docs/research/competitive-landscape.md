# Competitive Landscape (research digest, 2026-07-18)

Full agent reports summarized; key facts only.

## The market in one paragraph
The real incumbent is **Excel** — firearm forums call a local spreadsheet "the safest and standard
way" (no backdoors, heir-readable, no vendor-death risk). Vertical apps (myArmsCache, Gun Vault,
Gun Log SPC, NM Collector) are deep on guns but siloed; generic apps (Sortly, HomeBox, Memento,
MyStuff2) are flexible but shallow (no grading scales, no catalog numbers, no round counts, ad-hoc
fields instead of reusable per-category schemas); specialists (Numista, PCGS Registry, Colnect,
EzStamp/StampManage) have catalog data but are cloud-bound, Windows-bound, or web-only. Vendor
death is a rational fear: Gun Log +P pulled, MyGunDB activation servers dead, HomeBox author quit.

## myArmsCache (the app being replaced)
iOS-only, local-first, no account, 4.7★. Killer loop: **Range Report** (guns/ammo/mags used,
malfunctions, target photos) → auto-decrements ammo inventory → increments per-gun round counts →
drives cleaning-interval alerts. Fixed categories (Firearms/Ammo/Magazines/Accessories/Parts).
No NFA fields, no document vault, no cross-device anything (top gripe), dated UI, moved from $4.99
one-time to subscription with backlash including reported data wipes.

## What users praise across the market
local-only + zero account · the range-session auto-deduct loop · scan/lookup-to-populate ·
true per-category field schemas · item relations (ammo↔gun) · set-completion gamification (PCGS
Registry) · insurance-ready PDF with photos+serials · document vault with expiry reminders ·
always-available CSV export · one-time/free pricing · photo galleries that don't crop long items.

## Top complaints / gaps (Collectory's openings)
1. **Sync-vs-privacy unsolved**: local apps have no sync; synced apps require cloud. Nobody does
   LAN-only multi-device. (→ our Mac + LAN PWA model is the direct answer.)
2. **No bulk import anywhere** — blocks migration off spreadsheets. (→ column-mapped CSV import.)
3. **NFA/tax-stamp tracking: zero apps** (trust, form type, status, submit/approve dates).
4. Data loss = trust death (auto-backups, durable export).
5. Category rigidity vs shallow genericism (→ templates + editable schemas is the middle path).
6. Round-count bugs/drift (→ counts computed from logs, never a stored counter).
7. Subscription resentment (→ free, open format, "your data outlives us").

## Privacy positioning (not optional for this audience)
2026 CA CCW leak (AG published permit-holder PII) and the Feb 2026 ATF 4473-digitization
controversy (~1.1B records searchable by serial) make serials PII and cloud a red line. Lead all
messaging with: no servers, no cloud, no accounts, no telemetry.

## Differentiators no competitor does well (shipped or planned)
1. LAN-only Mac↔iPad, no third-party server (v1 ✓)
2. Column-mapped bulk CSV import + lossless round-trip via id column (v1 ✓)
3. NFA pack in firearms template (v1 ✓)
4. Universal consumable/maintenance engine (range→ammo linkage generalized; v1 partial ✓)
5. Estate/executor bundle; on-device OCR scan-assist; PCGS cert autofill; Numista API autofill;
   set-completion tracking (future ideas — see 03-roadmap)
