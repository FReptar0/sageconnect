---
phase: 13-enforcement
plan: 02
subsystem: licensing
tags: [license-enforcement, dns, cron, startup-gate, defense-in-depth]

# Dependency graph
requires:
  - phase: 12-licensevalidator-core
    provides: "LicenseValidator singleton with validate(), isValid(), getStatus(), _reset()"
provides:
  - "Async IIFE startup gate in index.js -- validate({ startup: true }) before startServer/initScheduler"
  - "Cron license guard -- skips background cycle when license invalid"
  - "DNS bypass detection -- dns.resolve4() warns on private/loopback IPs"
affects: [14-ui-enhancements]

# Tech tracking
tech-stack:
  added: [dns (node:dns)]
  patterns: [async-iife-startup, cron-license-guard, dns-defense-in-depth]

key-files:
  created: [tests/services/enforcement-wiring.test.js]
  modified: [src/index.js, src/services/CronScheduler.js, src/services/LicenseValidator.js, tests/services/LicenseValidator.test.js, tests/services/cron-scheduler.test.js]

key-decisions:
  - "DNS check is defense-in-depth only -- warns but never blocks validation; HMAC is the primary gate"
  - "DNS tests placed in LicenseValidator.test.js (not enforcement-wiring.test.js) due to Jest mock scoping"
  - "Added return after process.exit(1) in index.js for testability with mocked process.exit"

patterns-established:
  - "Async IIFE startup: license validation before any server initialization"
  - "Cron guard pattern: license check after lock acquisition, before business logic"
  - "DNS defense-in-depth: dns.resolve4() bypasses OS hosts file, warns on private IPs"

requirements-completed: [ENF-02, ENF-04]

# Metrics
duration: 13min
completed: 2026-03-25
---

# Phase 13 Plan 02: Enforcement Wiring Summary

**Startup license gate, cron cycle guard, and DNS bypass detection wired into index.js, CronScheduler, and LicenseValidator**

## Performance

- **Duration:** 13 min
- **Started:** 2026-03-25T22:12:36Z
- **Completed:** 2026-03-25T22:25:44Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- index.js wrapped in async IIFE: validate({ startup: true }) blocks startServer/initScheduler on invalid license
- CronScheduler license guard skips forResponse/startChildProcess when isValid() false, records "Ciclo omitido: licencia inactiva" in history
- dns.resolve4() checks license server hostname for private/loopback IPs (defense-in-depth, non-blocking)
- 15 new tests across enforcement-wiring and LicenseValidator test files, all 49 related tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire startup validation and cron guard** - `5716382` (test: RED) -> `00ca535` (feat: GREEN)
2. **Task 2: Add DNS bypass detection to LicenseValidator** - `f441f70` (test: RED) -> `02bb03d` (feat: GREEN)

_TDD tasks: each has RED (failing tests) and GREEN (implementation) commits_

## Files Created/Modified
- `src/index.js` - Async IIFE with validate({ startup: true }) before startServer/initScheduler
- `src/services/CronScheduler.js` - License guard after lock acquisition, before forResponse()
- `src/services/LicenseValidator.js` - dns.resolve4() verification and _isPrivateOrLoopback() helper
- `tests/services/enforcement-wiring.test.js` - 7 tests for startup gate and cron guard
- `tests/services/LicenseValidator.test.js` - 8 new DNS tests + dns mock for existing tests
- `tests/services/cron-scheduler.test.js` - Added LicenseValidator mock for compatibility

## Decisions Made
- DNS check is defense-in-depth only: warns on private/loopback IPs but NEVER blocks validation. HMAC signature verification is the sole security boundary (per user decision from CONTEXT.md).
- DNS tests placed in LicenseValidator.test.js rather than enforcement-wiring.test.js because the top-level jest.mock for LicenseValidator in enforcement-wiring prevents testing the real module's DNS code. This is a pragmatic deviation -- the tests are comprehensive regardless of file location.
- Added `return` after `process.exit(1)` in index.js safety-net block so the mock process.exit in tests correctly prevents further execution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added LicenseValidator mock to existing cron-scheduler.test.js**
- **Found during:** Task 1 (CronScheduler license guard)
- **Issue:** CronScheduler now imports LicenseValidator, but existing tests didn't mock it, causing isValid() to return undefined (falsy) and all cron tests to fail
- **Fix:** Added `jest.mock('../../src/services/LicenseValidator', () => ({ isValid: jest.fn(() => true), ... }))` to cron-scheduler.test.js
- **Files modified:** tests/services/cron-scheduler.test.js
- **Verification:** All 15 existing CronScheduler tests pass
- **Committed in:** 00ca535 (Task 1 commit)

**2. [Rule 1 - Bug] Added dns mock to existing LicenseValidator.test.js**
- **Found during:** Task 2 (DNS bypass detection)
- **Issue:** LicenseValidator now calls dns.resolve4() which tried to resolve 'license.test.com' in tests, causing timeouts in 3 existing startup retry tests
- **Fix:** Added `jest.mock('dns', () => ({ resolve4: mockDnsResolve4 }))` with default public IP response
- **Files modified:** tests/services/LicenseValidator.test.js
- **Verification:** All 19 existing LicenseValidator tests pass (no timeouts)
- **Committed in:** 02bb03d (Task 2 commit)

**3. [Rule 3 - Blocking] DNS tests placed in LicenseValidator.test.js instead of enforcement-wiring.test.js**
- **Found during:** Task 2 (DNS bypass detection)
- **Issue:** enforcement-wiring.test.js has a top-level jest.mock for LicenseValidator. jest.isolateModulesAsync + jest.doMock could not properly override this to get the real module's DNS code
- **Fix:** Added DNS tests to LicenseValidator.test.js which already requires the real module with proper mocks
- **Files modified:** tests/services/LicenseValidator.test.js, tests/services/enforcement-wiring.test.js
- **Verification:** All 8 DNS tests pass in LicenseValidator.test.js, enforcement-wiring.test.js has a note referencing the DNS tests location
- **Committed in:** 02bb03d (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 bug fixes, 1 blocking)
**Impact on plan:** All auto-fixes necessary for test compatibility. No scope creep. DNS tests are comprehensive regardless of file location.

## Issues Encountered
- Jest module isolation with top-level jest.mock is complex. jest.isolateModulesAsync with jest.doMock inside did NOT override top-level jest.mock for dependencies. Resolved by placing DNS tests in the file that already has the correct mock setup.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- License enforcement wiring complete: startup gate, cron guard, and DNS check all operational
- Phase 13 plans 01 and 02 together provide full enforcement: API middleware (01) + startup/cron/DNS (02)
- Ready for Phase 14 (UI enhancements) if planned

## Self-Check: PASSED

All files verified present. All 4 commits (5716382, 00ca535, f441f70, 02bb03d) found in git log.

---
*Phase: 13-enforcement*
*Completed: 2026-03-25*
