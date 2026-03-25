---
phase: 12-licensevalidator-core
plan: 02
subsystem: infra
tags: [license, hmac, crypto, three-state, retry, singleton]

# Dependency graph
requires:
  - phase: 12-licensevalidator-core
    plan: 01
    provides: "config.license.adminEmail, LICENSE_ADMIN_EMAIL fail-fast validation"
  - phase: 11-license-config
    provides: "config.license.apiUrl, config.license.hmacSecret, config.security.apiKey"
provides:
  - "LicenseValidator singleton with validate(), isValid(), getStatus() exports"
  - "HMAC-SHA256 signature verification matching license server's signing implementation"
  - "Three-state cached model (VALID/INVALID/ERROR) with 24h ERROR TTL"
  - "Startup retry with exponential backoff and process.exit(1) on exhaustion"
  - "Email notifications on license startup failure and revocation"
affects: [13-enforcement-wiring, 14-license-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level singleton with _reset() for testing"
    - "Explicit HMAC payload construction (no spread operator) for obfuscation safety"
    - "timingSafeEqual for HMAC comparison (same pattern as api-key.js)"
    - "nodemailer direct transport for arbitrary recipient emails"

key-files:
  created:
    - src/services/LicenseValidator.js
    - tests/services/LicenseValidator.test.js
  modified: []

key-decisions:
  - "Used nodemailer directly instead of EmailSender.sendMail() -- EmailSender uses config.mailing.notices array indexing which does not support arbitrary recipient emails"
  - "Test file placed at tests/services/ (Jest testMatch pattern) instead of src/services/__tests__/ (plan path)"
  - "HMAC payload uses explicit property assignment, not spread operator, to ensure field order survives javascript-obfuscator"

patterns-established:
  - "Three-state license model: VALID (operate), INVALID (block), ERROR (cached state up to 24h)"
  - "Startup fail-fast with retry: exponential backoff then process.exit(1)"

requirements-completed: [LIC-01, LIC-02, LIC-03, LIC-04, LIC-05]

# Metrics
duration: 4min
completed: 2026-03-25
---

# Phase 12 Plan 02: LicenseValidator Core Service Summary

**HMAC-verified license validation singleton with three-state cache, 24h ERROR TTL, startup retry with backoff, and email notifications**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-25T21:29:59Z
- **Completed:** 2026-03-25T21:34:03Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- LicenseValidator.js singleton service with HMAC-SHA256 signature verification matching license server's exact signing implementation
- Three-state cached model (VALID/INVALID/ERROR) preventing false blocks during Vercel outages with 24h ERROR TTL
- Timestamp freshness checking (5-min window, 60s future tolerance) preventing replay attacks
- Startup retry with exponential backoff (1s, 2s, 4s) and process.exit(1) on exhaustion
- Email notifications via nodemailer on startup failure and license revocation
- 19 comprehensive tests covering all behaviors

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1 RED: Failing tests for LicenseValidator** - `8f81308` (test)
2. **Task 1 GREEN: Implement LicenseValidator core service** - `778bf0b` (feat)

## Files Created/Modified
- `src/services/LicenseValidator.js` - Core license validation singleton with validate(), isValid(), getStatus(), _reset() exports (345 lines)
- `tests/services/LicenseValidator.test.js` - 19 tests covering HMAC verification, timestamp freshness, three-state model, 24h TTL, startup retry

## Decisions Made
- Used nodemailer directly instead of EmailSender.sendMail() -- EmailSender uses notices array indexing which cannot send to arbitrary recipient emails (config.license.adminEmail)
- Test file placed at `tests/services/LicenseValidator.test.js` instead of plan's `src/services/__tests__/` path because Jest testMatch is configured for `tests/**/*.test.js`
- HMAC payload constructed with explicit property assignment (not spread operator) to ensure field order survives javascript-obfuscator (Pitfall 5 + 7 from PITFALLS.md)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test file path adjusted from src/services/__tests__/ to tests/services/**
- **Found during:** Task 1 (TDD RED phase)
- **Issue:** Plan specified `src/services/__tests__/LicenseValidator.test.js` but Jest testMatch is configured for `<rootDir>/tests/**/*.test.js` -- tests would not be discovered
- **Fix:** Placed test file at `tests/services/LicenseValidator.test.js` following existing test patterns (cron-scheduler.test.js, operation-manager.test.js in same directory)
- **Files modified:** tests/services/LicenseValidator.test.js
- **Verification:** `npx jest tests/services/LicenseValidator.test.js` discovers and runs all 19 tests
- **Committed in:** 8f81308 (RED phase commit)

**2. [Rule 3 - Blocking] Added Jest fake timers for startup retry tests**
- **Found during:** Task 1 (TDD GREEN phase)
- **Issue:** Startup retry tests timed out (5s Jest default) because real setTimeout delays (1s + 2s + 4s = 7s) exceeded limit
- **Fix:** Used `jest.useFakeTimers()` and `jest.advanceTimersByTimeAsync()` for retry tests, keeping real backoff logic in production code
- **Files modified:** tests/services/LicenseValidator.test.js
- **Verification:** Both retry tests complete in ~10ms with fake timers
- **Committed in:** 778bf0b (GREEN phase commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for test execution. No scope creep. Production code follows plan exactly.

## Issues Encountered
- Verification commands from plan (`node -e "require('./src/services/LicenseValidator')..."`) cannot run without .env file because config.js calls process.exit(1) on missing env vars. Tests use mocked config and verify all required behavior. This is expected and not a problem.

## User Setup Required
None - no external service configuration required (LICENSE_ADMIN_EMAIL was configured in Plan 01).

## Next Phase Readiness
- LicenseValidator.validate(), isValid(), getStatus() ready for Phase 13 consumers:
  - index.js startup gate: `await validate({ startup: true })`
  - CronScheduler periodic checks: `await validate()`
  - Express middleware: `isValid()` for request blocking
  - API endpoint: `getStatus()` for system health UI
- No blockers for proceeding to Phase 13

## Self-Check: PASSED

- FOUND: src/services/LicenseValidator.js
- FOUND: tests/services/LicenseValidator.test.js
- FOUND: 12-02-SUMMARY.md
- FOUND: commit 8f81308
- FOUND: commit 778bf0b

---
*Phase: 12-licensevalidator-core*
*Completed: 2026-03-25*
