---
phase: 06-infrastructure-foundation
plan: 02
subsystem: infra
tags: [process-exit, always-on, result-envelope, static-analysis, require-main-guard]

# Dependency graph
requires:
  - phase: 06-01
    provides: "ResultEnvelope helper (successResult/errorResult) for envelope returns"
provides:
  - "PortalOC_StatusUpdater.js exports updatePOStatus() returning envelope"
  - "All always-on code paths are process.exit-free"
  - "Static analysis test (no-process-exit.test.js) prevents future regressions"
  - "All 13 scripts in src/scripts/ have require.main === module guards"
affects: [06-03, 06-04, 07-api-security, 08-scheduler-sse]

# Tech tracking
tech-stack:
  added: []
  patterns: [require-main-guard, autoTerminate-guard, shutdown-callback]

key-files:
  created:
    - tests/no-process-exit.test.js
  modified:
    - src/controller/PortalOC_StatusUpdater.js
    - src/background.js
    - src/index.js
    - src/routes/routes.js
    - src/services/AutoShutdownService.js
    - src/scripts/get-payment-cfdis.js
    - src/scripts/payment-uuid-diagnostic.js
    - src/scripts/payment-uuid-repair.js
    - src/scripts/portal-payments-generator.js
    - src/scripts/test-order-lifecycle.js
    - src/scripts/upload-authorized-pos.js

key-decisions:
  - "PortalOC_StatusUpdater refactored to return ResultEnvelope (never process.exit) with require.main CLI guard for backward compatibility"
  - "background.js returns control to index.js instead of calling process.exit -- index.js owns server lifecycle"
  - "routes.js shutdown endpoint returns 403 in always-on mode with Servy guidance message"
  - "AutoShutdownService uses setShutdownHandler callback instead of process.exit -- minimal fix before Phase 10 removal"
  - "Static analysis test uses brace-depth heuristic to allow process.exit inside function bodies that are only called from require.main guards"

patterns-established:
  - "require.main === module guard: all scripts export functions for API use and guard CLI execution"
  - "autoTerminate guard: process.exit only reachable when config.app.autoTerminate=true (legacy mode)"
  - "Shutdown callback: services use registered handlers instead of direct process.exit"

requirements-completed: [INFRA-02]

# Metrics
duration: 13min
completed: 2026-03-23
---

# Phase 6 Plan 2: Remove process.exit from Always-On Code Paths Summary

**Eliminated all process.exit() from always-on code paths, refactored PortalOC_StatusUpdater to exportable envelope module, and added static analysis test proving compliance across 30+ source files**

## Performance

- **Duration:** 13 min
- **Started:** 2026-03-23T20:25:41Z
- **Completed:** 2026-03-23T20:38:58Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Refactored PortalOC_StatusUpdater from auto-executing CLI script to importable module returning ResultEnvelope
- Removed all process.exit from background.js (2 calls), AutoShutdownService.js (1 call), and guarded routes.js shutdown route
- Added require.main === module guards to 6 scripts that were auto-executing on require (get-payment-cfdis, payment-uuid-diagnostic, payment-uuid-repair, portal-payments-generator, test-order-lifecycle, upload-authorized-pos)
- Created 8-test static analysis suite that scans all src/ files and proves process.exit compliance
- All existing regression tests (25/25) continue to pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor PortalOC_StatusUpdater + remove process.exit from infrastructure files** - `c9267ef` (feat)
2. **Task 2: Static analysis test for process.exit compliance (TDD)** - `16d8ffc` (test: RED), `96da4e9` (feat: GREEN)

_Note: Task 2 was TDD -- RED commit has failing test, GREEN commit has implementation making it pass_

## Files Created/Modified
- `src/controller/PortalOC_StatusUpdater.js` - Full refactor: exports updatePOStatus() returning envelope, require.main CLI guard
- `src/background.js` - Removed 2 process.exit calls, returns control to index.js for lifecycle
- `src/index.js` - Added clarifying comments (process.exit already inside autoTerminate guards)
- `src/routes/routes.js` - Shutdown route returns 403 in always-on mode, process.exit guarded
- `src/services/AutoShutdownService.js` - setShutdownHandler callback replaces process.exit
- `src/scripts/get-payment-cfdis.js` - Added require.main guard, moved IIFE into guard block
- `src/scripts/payment-uuid-diagnostic.js` - Added require.main guard, wrapped main() call
- `src/scripts/payment-uuid-repair.js` - Added require.main guard, wrapped main() call
- `src/scripts/portal-payments-generator.js` - Added require.main guard, wrapped execution
- `src/scripts/test-order-lifecycle.js` - Added require.main guard, wrapped main() call
- `src/scripts/upload-authorized-pos.js` - Added require.main guard, wrapped testQuery() call
- `tests/no-process-exit.test.js` - 8 static analysis tests for process.exit compliance

## Decisions Made
- PortalOC_StatusUpdater returns ResultEnvelope (successResult/errorResult) instead of process.exit, preserving CLI compatibility via require.main guard
- background.js delegates process lifecycle to index.js rather than calling process.exit directly -- cleaner separation of concerns
- routes.js shutdown endpoint returns HTTP 403 with Servy guidance in always-on mode rather than silently ignoring the request
- AutoShutdownService uses minimal setShutdownHandler callback pattern since full removal is sequenced for Phase 10 (DEPLOY-02)
- Static analysis test uses brace-depth tracking to correctly handle process.exit inside function bodies defined before the require.main guard

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added require.main guards to 6 scripts lacking them**
- **Found during:** Task 2 (TDD GREEN phase)
- **Issue:** 6 scripts in src/scripts/ had no require.main guard and auto-executed on require, violating always-on safety
- **Fix:** Added require.main === module guards and moved auto-execution code into the guard block for all 6 scripts
- **Files modified:** get-payment-cfdis.js, payment-uuid-diagnostic.js, payment-uuid-repair.js, portal-payments-generator.js, test-order-lifecycle.js, upload-authorized-pos.js
- **Verification:** Static analysis test (test 3) confirms all 13 scripts have guards
- **Committed in:** 96da4e9 (Task 2 GREEN commit)

**2. [Rule 2 - Missing Critical] Updated static analysis test to handle function-scoped process.exit**
- **Found during:** Task 2 (TDD GREEN phase)
- **Issue:** po-payment-form-diagnostic.js has process.exit inside main() defined before require.main guard -- simple text splitting falsely flagged it
- **Fix:** Enhanced checkExitCallsAfterGuard() to use brace-depth tracking, correctly identifying function-scoped exits as safe
- **Files modified:** tests/no-process-exit.test.js
- **Verification:** All 8 tests pass including po-payment-form-diagnostic.js
- **Committed in:** 96da4e9 (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (2 missing critical)
**Impact on plan:** Both auto-fixes were necessary for the static analysis test to be meaningful. Adding guards to scripts is aligned with plan intent (test 3 explicitly requires all scripts have guards).

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- PortalOC_StatusUpdater.js now exports updatePOStatus() for use by API routes in Phase 7
- All always-on code paths are exit-free, ready for continuous server operation
- Static analysis test will catch any future process.exit regressions
- 6 scripts now export their functions for API exposure in Phase 7

## Self-Check: PASSED

- All 7 key source/test files exist on disk
- All 3 task commits verified in git log (c9267ef, 16d8ffc, 96da4e9)
- 8/8 static analysis tests pass
- 25/25 regression tests pass

---
*Phase: 06-infrastructure-foundation*
*Completed: 2026-03-23*
