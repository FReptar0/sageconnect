---
phase: 04-codebase-migration
plan: 01
subsystem: infra
tags: [dotenv, config-loader, env-vars, migration, centralized-config]

# Dependency graph
requires:
  - phase: 03-config-loader-foundation
    provides: centralized config loader (src/config.js) with fail-fast validation
provides:
  - DB_USER/DB_PASSWORD rename eliminating OS USER env var collision
  - 11 core modules migrated from dotenv to centralized config loader
  - zero dotenv references in src/utils/, src/services/, entry points, routes
affects: [04-codebase-migration, 05-regression-verification]

# Tech tracking
tech-stack:
  added: []
  patterns: [centralized-config-access, config-section-properties, tenant-array-mapping]

key-files:
  created: []
  modified:
    - src/config.js
    - tests/config.test.js
    - .env.example
    - src/utils/SQLServerConnection.js
    - src/utils/EmailSender.js
    - src/utils/GetProviders.js
    - src/utils/GetTypesCFDI.js
    - src/utils/LogGenerator.js
    - src/utils/TimezoneHelper.js
    - src/services/LogDashboardService.js
    - src/services/PortalOC_StatusService.js
    - src/background.js
    - src/index.js
    - src/routes/routes.js

key-decisions:
  - "Renamed USER to DB_USER and PASSWORD to DB_PASSWORD to avoid OS USER env var collision"
  - "All 11 modules use require('../config') pattern -- no dependency injection"
  - "EmailSender loads mailing config internally via config loader; routes.js no longer needs dotenv"
  - "Tenant arrays built via config.portal.tenants.map() replacing manual split+push pattern"

patterns-established:
  - "Config access: config.section.property (e.g., config.database.user, config.portal.url)"
  - "Tenant iteration: config.portal.tenants.map(t => t.id) replaces TENANT_ID.split(',')"
  - "Typed values: config.mailing.port is already number, config.mailing.ssl is already boolean"

requirements-completed: [CONF-03, UNIF-02]

# Metrics
duration: 3min
completed: 2026-03-23
---

# Phase 4 Plan 01: Core Module Migration Summary

**DB_USER/DB_PASSWORD rename plus migration of 11 utility/service/entry-point modules from scattered dotenv.config() calls to centralized config loader**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-23T04:09:19Z
- **Completed:** 2026-03-23T04:12:55Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments
- Renamed USER/PASSWORD to DB_USER/DB_PASSWORD in config.js, .env, .env.example, and all 27 tests pass
- Migrated 11 source modules from dotenv.config() and process.env access to centralized config loader
- Eliminated all dotenv references from src/utils/, src/services/, src/background.js, src/index.js, src/routes/
- Replaced manual .split(',').push(...) tenant array pattern with config.portal.tenants.map() in 4 files

## Task Commits

Each task was committed atomically:

1. **Task 1: Rename USER/PASSWORD to DB_USER/DB_PASSWORD** - `dea7958` (feat)
2. **Task 2: Migrate utilities, services, entry points, and routes to config loader** - `b215a79` (feat)

## Files Created/Modified
- `src/config.js` - Updated REQUIRED map and config object to use DB_USER/DB_PASSWORD
- `tests/config.test.js` - Updated all env var references to DB_USER/DB_PASSWORD
- `.env.example` - Renamed vars with inline comment explaining the rename
- `src/utils/SQLServerConnection.js` - Uses config.database for db credentials
- `src/utils/EmailSender.js` - Uses config.mailing for SMTP settings (typed values)
- `src/utils/GetProviders.js` - Uses config.portal for URL and tenant arrays
- `src/utils/GetTypesCFDI.js` - Uses config.portal for URL and tenant arrays
- `src/utils/LogGenerator.js` - Uses config.paths.logs for log directory
- `src/utils/TimezoneHelper.js` - Uses config.app.timezone
- `src/services/LogDashboardService.js` - Uses config.paths.logs for log directory
- `src/services/PortalOC_StatusService.js` - Uses config.portal for tenant arrays
- `src/background.js` - Uses config.portal/app for tenants and import route
- `src/index.js` - Uses config.app.autoTerminate
- `src/routes/routes.js` - Removed dotenv import (EmailSender loads own config)

## Decisions Made
- Renamed USER to DB_USER and PASSWORD to DB_PASSWORD to avoid OS USER env var collision per CONTEXT.md decision
- All modules use require('../config') direct import pattern (Node.js module cache ensures single execution)
- EmailSender loads its own config via require, so routes.js no longer needs dotenv at all
- Tenant arrays built via config.portal.tenants.map() for cleaner, more maintainable code

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- 11 core modules migrated -- remaining controllers and scripts need migration in Plan 04-02
- Config loader DB_USER/DB_PASSWORD rename is live -- production .env files must be updated accordingly
- Zero dotenv references remain in utils, services, entry points, and routes

## Self-Check: PASSED

- [x] All 14 modified files exist
- [x] Commit dea7958 (Task 1 - DB_USER rename) exists
- [x] Commit b215a79 (Task 2 - 11 module migration) exists
- [x] 04-01-SUMMARY.md exists
- [x] Zero dotenv references in target files (utils, services, entry points, routes)
- [x] DB_USER present in src/config.js
- [x] 27/27 config tests pass

---
*Phase: 04-codebase-migration*
*Completed: 2026-03-23*
