---
phase: 04-codebase-migration
plan: 02
subsystem: infra
tags: [dotenv, config-loader, env-vars, migration, controllers, multi-tenant]

# Dependency graph
requires:
  - phase: 04-codebase-migration
    plan: 01
    provides: centralized config loader pattern and 11 core modules migrated
provides:
  - 9 controller files migrated from dotenv to centralized config loader
  - Zero dotenv references in src/controller/
  - Multi-tenant arrays via config.portal.tenants.map() in all controllers
  - Default address via config.app.defaultAddress in PortalOC_Creator and PortalOC_ContentUpdater
affects: [04-codebase-migration, 05-regression-verification]

# Tech tracking
tech-stack:
  added: []
  patterns: [config-portal-tenants-map, config-app-defaultAddress, config-paths-downloads]

key-files:
  created: []
  modified:
    - src/controller/CFDI_Downloader.js
    - src/controller/PortalOC_Canceller.js
    - src/controller/PortalOC_Closer.js
    - src/controller/PortalOC_ContentUpdater.js
    - src/controller/PortalOC_Creator.js
    - src/controller/PortalOC_LifecycleManager.js
    - src/controller/PortalPaymentController.js
    - src/controller/PortalOC_StatusUpdater.js
    - src/controller/Providers_Downloader.js

key-decisions:
  - "PortalOC_ContentUpdater and PortalOC_LifecycleManager preserve addressConfig object shape for PortalOCPayloadBuilder compatibility"
  - "Providers_Downloader uses config.paths.downloads instead of separate .env.path file"
  - "PortalOC_StatusUpdater switched from dotenv+process.env pattern to direct config import"

patterns-established:
  - "Controller config access: const config = require('../config') at file top"
  - "Tenant arrays: config.portal.tenants.map(t => t.id|key|secret|database|externalId)"
  - "Default address: config.app.defaultAddress.city|country|identifier|municipality|state|street|zip"
  - "Address skip list: config.app.addressIdentifiersSkip (already trimmed array)"

requirements-completed: [CONF-03]

# Metrics
duration: 3min
completed: 2026-03-23
---

# Phase 4 Plan 02: Controller Migration Summary

**All 9 controller files migrated from scattered dotenv.config() calls to centralized config loader with multi-tenant array mapping and default address properties**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-23T04:15:59Z
- **Completed:** 2026-03-23T04:18:57Z
- **Tasks:** 1
- **Files modified:** 9

## Accomplishments
- Migrated all 9 controller files from dotenv to centralized config loader
- Eliminated all dotenv.config() calls, .parsed destructuring, and process.env references from src/controller/
- Replaced manual .split(',').push(...) tenant array pattern with config.portal.tenants.map() in all controllers
- Replaced 8 DEFAULT_ADDRESS_X constants with config.app.defaultAddress properties in PortalOC_Creator
- Replaced ADDRESS_IDENTIFIERS_SKIP manual split/trim with pre-processed config.app.addressIdentifiersSkip array

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate controllers and Providers_Downloader to config loader** - `c9af23c` (feat)

## Files Created/Modified
- `src/controller/CFDI_Downloader.js` - Uses config.portal for URL/tenants, config.paths.downloads for download path
- `src/controller/PortalOC_Canceller.js` - Uses config.portal for tenants and URL
- `src/controller/PortalOC_Closer.js` - Uses config.portal for tenants and URL
- `src/controller/PortalOC_ContentUpdater.js` - Uses config.portal for tenants, config.app.defaultAddress for address config
- `src/controller/PortalOC_Creator.js` - Uses config.portal for tenants, config.app.defaultAddress for SQL defaults, config.app.addressIdentifiersSkip for location filter
- `src/controller/PortalOC_LifecycleManager.js` - Uses config.portal for tenants, config.app.defaultAddress for address config
- `src/controller/PortalPaymentController.js` - Uses config.portal for tenants and URL
- `src/controller/PortalOC_StatusUpdater.js` - Uses config.portal for tenants and URL (was dotenv+process.env pattern)
- `src/controller/Providers_Downloader.js` - Uses config.app for RFC/company/regimen/arg, config.paths.downloads for output path

## Decisions Made
- PortalOC_ContentUpdater and PortalOC_LifecycleManager preserve the addressConfig object shape (with original key names) to maintain compatibility with PortalOCPayloadBuilder service that expects those keys
- Providers_Downloader uses config.paths.downloads (same as CFDI_Downloader) since both reference the same PATH env var
- PortalOC_StatusUpdater was unique in using dotenv.config() then accessing process.env directly -- migrated to config import like all other controllers

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 9 controllers migrated -- remaining scripts in src/scripts/ need migration in Plan 04-03
- Zero dotenv references in src/controller/, src/utils/, src/services/, entry points, and routes
- Only src/scripts/ directory remains with dotenv references for Plan 04-03

## Self-Check: PASSED

- [x] All 9 modified controller files exist
- [x] Commit c9af23c (Task 1 - controller migration) exists
- [x] 04-02-SUMMARY.md exists
- [x] Zero dotenv references in src/controller/
- [x] 9/9 controllers have require('../config')

---
*Phase: 04-codebase-migration*
*Completed: 2026-03-23*
