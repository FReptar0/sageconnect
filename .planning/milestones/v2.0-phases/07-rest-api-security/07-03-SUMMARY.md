---
phase: 07-rest-api-security
plan: 03
subsystem: api
tags: [po-routes, joi, express, supertest, rest-endpoints, purchase-orders]

# Dependency graph
requires:
  - phase: 07-rest-api-security
    plan: 01
    provides: validate middleware, asyncHandler, sendResult, requireApiKey, route index structure
provides:
  - 8 PO REST endpoints (diagnostic, query, upload, update, address-diagnostic, payment-form-diagnostic, upload-authorized, lifecycle)
  - Joi validation schemas for all PO endpoints (po-schemas.js)
  - 31 integration tests covering happy path, validation, API key, dry-run defaults, normalization, and dispatch
affects: [08-scheduler-sse, 09-web-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [thin adapter route handlers mapping request params to script positional args, local writeLimiter to avoid circular dependency, poNumbers normalization (string-to-array)]

key-files:
  created:
    - src/routes/schemas/po-schemas.js
    - src/routes/po-routes.js
    - tests/api/po-routes.test.js
  modified:
    - src/routes/routes.js

key-decisions:
  - "Local writeLimiter in po-routes.js to avoid circular dependency with server.js"
  - "dryRun defaults to true via Joi schema on PUT /update for destructive endpoint safety"
  - "Mock express-rate-limit in tests to prevent write limiter from blocking test suite execution"

patterns-established:
  - "Thin adapter route handlers: map req.query/body params to script positional args inline"
  - "poNumbers normalization: accept string or array, split comma-separated strings in handler"
  - "Test isolation: mock config.js, all script modules, and express-rate-limit for supertest-based tests"

requirements-completed: [PO-01, PO-02, PO-03, PO-04, PO-05, PO-06, PO-07, PO-08]

# Metrics
duration: 7min
completed: 2026-03-23
---

# Phase 7 Plan 03: PO Routes Summary

**8 PO REST endpoints with Joi validation, positional-arg adapter handlers, dry-run safety defaults, and 31 integration tests covering all dispatch and normalization paths**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-23T22:27:58Z
- **Completed:** 2026-03-23T22:35:35Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created 8 PO endpoint route handlers in po-routes.js mapping request params to script positional args
- Created Joi validation schemas for all 8 PO endpoints with tenantIndex range validation, poNumbers alternatives, and dryRun default
- Mounted PO routes in routes.js behind requireApiKey middleware
- Created 31 integration tests covering happy path, validation errors, API key enforcement, dry-run defaults, poNumbers normalization, lifecycle mode dispatch, and tenantIndex validation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create PO schemas + PO routes + mount in routes.js** - `7234c4e` (feat)
2. **Task 2: PO routes integration tests** - `4d7c33c` (test)

**Plan metadata:** (pending docs commit)

## Files Created/Modified
- `src/routes/schemas/po-schemas.js` - Joi schemas for all 8 PO endpoints (diagnostic, query, upload, update, address-diagnostic, payment-form-diagnostic, upload-authorized, lifecycle)
- `src/routes/po-routes.js` - 8 PO route handlers with local writeLimiter, validation, async handling
- `src/routes/routes.js` - Added PO routes mount line behind requireApiKey
- `tests/api/po-routes.test.js` - 31 integration tests across 7 describe blocks

## Decisions Made
- **Local writeLimiter:** Created a local rate limiter instance in po-routes.js (same config as server.js) instead of importing from server.js to avoid circular dependency.
- **dryRun defaults true:** PUT /update defaults dryRun to true via Joi schema, preventing accidental destructive operations even if the caller forgets the flag.
- **Mock express-rate-limit in tests:** The write rate limiter (10 req/min) would block test execution after 10 write endpoint tests. Mocking it with a pass-through middleware resolves this without affecting test coverage of actual route logic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Rate limiter blocking test suite execution**
- **Found during:** Task 2 (PO routes integration tests)
- **Issue:** The writeLimiter in po-routes.js (10 requests per minute) caused the 11th write endpoint test to get rate-limited (429 instead of expected 200), causing `mode=tenant calls testTenant` to fail.
- **Fix:** Added `jest.mock('express-rate-limit')` to return a pass-through middleware in the test file.
- **Files modified:** tests/api/po-routes.test.js
- **Verification:** All 31 tests pass consistently.
- **Committed in:** 4d7c33c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Auto-fix necessary for test reliability. No scope creep.

## Issues Encountered
- Pre-existing test failures in TransformTime.test.js and PaymentReconciliation.test.js are unrelated to this plan. Logged to deferred-items.md.
- Full test suite occasionally has supertest timeout issues when all 14 suites run in parallel. API tests pass reliably when run in isolation.

## User Setup Required
None - no external service configuration required. PO endpoints are available once SAGECONNECT_API_KEY is set in .env.

## Next Phase Readiness
- All 8 PO endpoints are implemented and tested, completing the REST API layer for PO operations
- Combined with Plan 01 (security) and Plan 02 (payments), Phase 7 delivers the full secured REST API
- Phase 8 (scheduler + SSE) can build on these endpoints for scheduled operations and real-time event streaming

## Self-Check: PASSED

All 3 created files verified on disk. All 2 task commits verified in git log.

---
*Phase: 07-rest-api-security*
*Completed: 2026-03-23*
