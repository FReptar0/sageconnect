---
phase: 10-servy-cutover-retirement
plan: 01
subsystem: infra
tags: [process-lifecycle, legacy-removal, always-on, cleanup]

# Dependency graph
requires:
  - phase: 08-scheduler-real-time
    provides: CronScheduler for always-on background cycle
  - phase: 06-infra-foundation
    provides: AutoShutdownService refactored with callback pattern
provides:
  - Simplified always-on entry point (index.js ~14 lines)
  - Clean codebase with zero legacy lifecycle artifacts
  - Dashboard without shutdown UI or routes
  - Config without autoTerminate property
affects: [10-servy-cutover-retirement]

# Tech tracking
tech-stack:
  added: []
  patterns: [always-on-only entry point, no dual-mode code]

key-files:
  created: []
  modified:
    - src/index.js
    - src/config.js
    - src/server.js
    - src/background.js
    - src/routes/dashboard-routes.js
    - public/logs.html
    - package.json
    - .env.example
    - scripts/obfuscate.js
    - scripts/migrate-env.js

key-decisions:
  - "index.js reduced from 39 lines to 14 lines: startServer + initScheduler only"
  - "config.js keeps process.exit(1) in validate() for fail-fast on missing env vars"
  - "obfuscate.js COPY_FILES updated: removed RunSageconnect.bat, added scripts/install-service.ps1"

patterns-established:
  - "Always-on only: no mode switching, no arg parsing, no conditional startup"

requirements-completed: [DEPLOY-02, DEPLOY-03]

# Metrics
duration: 8min
completed: 2026-03-24
---

# Phase 10 Plan 01: Legacy Lifecycle Removal Summary

**Removed all legacy process lifecycle artifacts (AutoShutdownService, AUTO_TERMINATE, --web-only mode, RunSageconnect.bat, shutdown routes/UI) and simplified index.js to always-on only**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-24T18:43:23Z
- **Completed:** 2026-03-24T18:51:20Z
- **Tasks:** 2
- **Files modified:** 25 (12 source + 13 test)

## Accomplishments
- Deleted AutoShutdownService.js and RunSageconnect.bat from codebase
- Simplified index.js from 39 lines (dual-mode with arg parsing, autoTerminate branching) to 14 lines (startServer + initScheduler)
- Removed all shutdown routes, shutdown UI elements, and auto-shutdown monitoring from dashboard
- Updated 13 test files: removed AutoShutdownService mocks, autoTerminate config mocks, and rewrote process-exit compliance tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove legacy files and clean all source code references** - `f862181` (feat)
2. **Task 2: Update all test files for legacy removal** - `a5121bf` (fix)

## Files Created/Modified

**Deleted:**
- `src/services/AutoShutdownService.js` - Legacy auto-shutdown service
- `RunSageconnect.bat` - Legacy Windows Task Scheduler launcher

**Modified (source):**
- `src/index.js` - Simplified to always-on entry point (startServer + initScheduler)
- `src/config.js` - Removed autoTerminate property
- `src/server.js` - Removed AutoShutdownService import, webOnlyMode parameter
- `src/background.js` - Removed autoTerminate log blocks
- `src/routes/dashboard-routes.js` - Removed AutoShutdownService import, shutdown routes
- `public/logs.html` - Removed shutdown button, shutdown monitoring functions
- `package.json` - Removed web-only and dev:web-only scripts
- `.env.example` - Removed AUTO_TERMINATE variable
- `scripts/obfuscate.js` - Removed RunSageconnect.bat from COPY_FILES, removed web-only from dist scripts, added install-service.ps1
- `scripts/migrate-env.js` - Removed AUTO_TERMINATE from appKeys array

**Modified (tests):**
- `tests/no-process-exit.test.js` - Rewrote tests 5-7 for always-on compliance
- `tests/config.test.js` - Removed 2 autoTerminate tests
- `tests/regression-verification.test.js` - Removed autoTerminate from mock and assertions
- `tests/api/schedule-routes.test.js` - Removed AutoShutdownService mock and autoTerminate
- `tests/api/operations-routes.test.js` - Removed AutoShutdownService mock and autoTerminate
- `tests/api/payment-routes.test.js` - Removed AutoShutdownService mock and autoTerminate
- `tests/api/po-routes.test.js` - Removed autoTerminate from config mock
- `tests/services/cron-scheduler.test.js` - Removed autoTerminate from config mock
- `tests/EmailSender.test.js` - Removed autoTerminate from config mock
- `tests/PaymentReconciliation.test.js` - Removed autoTerminate from config mock
- `tests/TimezoneHelper.test.js` - Removed autoTerminate from config mock
- `tests/GetPaymentCFDI.test.js` - Removed autoTerminate from config mock
- `tests/envelope-contract.test.js` - Removed autoTerminate from config mock

## Decisions Made
- index.js reduced from 39 lines to 14: only startServer(3030) and initScheduler() remain
- config.js keeps process.exit(1) in validate() for fail-fast on missing env vars (per prior user decision)
- obfuscate.js updated COPY_FILES: removed RunSageconnect.bat, added scripts/install-service.ps1 for Servy integration readiness

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing test failures (out of scope, not caused by this plan):
- tests/TransformTime.test.js: 2 tests fail on input validation (throws expected but not thrown)
- tests/PaymentReconciliation.test.js: BTCH-01 missing result detection test fails
- Occasional parallel execution timeouts in API route tests (pass reliably in isolation)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Codebase is now purely always-on: no dual-mode code, no self-termination
- Ready for Plan 02: Servy Windows Service integration (install-service.ps1)
- server.js gracefulShutdown handler preserved for SIGTERM/SIGINT from Servy

---
*Phase: 10-servy-cutover-retirement*
*Completed: 2026-03-24*
