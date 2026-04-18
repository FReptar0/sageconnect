---
phase: 07-rest-api-security
plan: 01
subsystem: api
tags: [helmet, cors, express-rate-limit, supertest, security, middleware, api-key]

# Dependency graph
requires:
  - phase: 06-infra-foundation
    provides: ResultEnvelope, route structure, config.js centralized loader
provides:
  - API key validation middleware (requireApiKey) with crypto.timingSafeEqual
  - Joi validation middleware factory (validate)
  - Async error handler wrapper (asyncHandler)
  - Envelope-to-HTTP status mapper (sendResult)
  - Route index architecture with sub-router mounting
  - Health check endpoint at GET /api/system/health
  - Global helmet + CORS + rate-limit security pipeline
  - Write rate limiter export for Plans 02/03
  - Security integration test suite (20 tests)
affects: [07-02-payment-routes, 07-03-po-routes, 08-scheduler-sse, 09-web-ui]

# Tech tracking
tech-stack:
  added: [helmet@^8.1.0, cors@^2.8.6, express-rate-limit@^7.5.1, supertest@^7.2.2]
  patterns: [sub-router index mounting, middleware factory, constant-time key comparison, envelope-shaped error responses]

key-files:
  created:
    - src/middleware/api-key.js
    - src/middleware/validate.js
    - src/middleware/async-handler.js
    - src/middleware/send-result.js
    - src/routes/dashboard-routes.js
    - src/routes/system-routes.js
    - tests/api/security.test.js
  modified:
    - src/server.js
    - src/routes/routes.js
    - src/config.js
    - package.json
    - tests/config.test.js
    - tests/no-process-exit.test.js

key-decisions:
  - "SAGECONNECT_API_KEY is optional -- missing key logs warning but does not crash the app"
  - "Helmet contentSecurityPolicy disabled for dashboard inline scripts"
  - "draft-7 standard headers for rate limiting (ratelimit + ratelimit-policy headers)"
  - "Test app builder pattern avoids config.js process.exit during test execution"

patterns-established:
  - "Sub-router index: routes.js mounts domain-specific routers with middleware"
  - "Middleware factory: validate(schema, source) returns Express middleware"
  - "Security test isolation: createTestApp() builds Express app without config.js dependency"
  - "Envelope-shaped rate limit messages: 429 responses match ResultEnvelope structure"

requirements-completed: [SEC-01, SEC-02, SEC-03, SEC-04]

# Metrics
duration: 8min
completed: 2026-03-23
---

# Phase 7 Plan 01: Security Middleware & Route Structure Summary

**Helmet/CORS/rate-limit pipeline, API key middleware with timingSafeEqual, Joi validation factory, route index with sub-routers, and 20 security integration tests**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-23T22:15:04Z
- **Completed:** 2026-03-23T22:23:28Z
- **Tasks:** 3
- **Files modified:** 14

## Accomplishments
- Installed helmet, cors, express-rate-limit as production deps and supertest as dev dep
- Created 4 middleware modules: api-key (timingSafeEqual), validate (Joi factory), async-handler, send-result
- Restructured routes.js from monolith to sub-router index pattern (dashboard-routes.js, system-routes.js)
- Added security middleware pipeline to server.js (helmet, CORS, global rate limiter, error handler)
- Added SAGECONNECT_API_KEY to config.js as optional field with console warning when missing
- Created 20 security integration tests covering all middleware and security features

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies + create middleware files + update config.js** - `3baf3e4` (feat)
2. **Task 2: Restructure routes + update server.js with security middleware** - `c510106` (feat)
3. **Task 3: Security integration tests** - `bd4ff55` (test)

**Plan metadata:** (pending docs commit)

## Files Created/Modified
- `src/middleware/api-key.js` - API key validation using crypto.timingSafeEqual
- `src/middleware/validate.js` - Joi validation middleware factory
- `src/middleware/async-handler.js` - Async route handler error wrapper
- `src/middleware/send-result.js` - Envelope-to-HTTP status code mapper
- `src/routes/dashboard-routes.js` - All 7 original dashboard routes (moved from routes.js)
- `src/routes/system-routes.js` - Health check endpoint (GET /health)
- `src/routes/routes.js` - Route index mounting sub-routers with requireApiKey placeholders
- `src/server.js` - helmet, cors, rate-limit, error handler, writeLimiter export
- `src/config.js` - security.apiKey optional field from SAGECONNECT_API_KEY env var
- `tests/api/security.test.js` - 20 security integration tests
- `tests/config.test.js` - Updated to expect 6 top-level config sections
- `tests/no-process-exit.test.js` - Updated for dashboard-routes.js restructure
- `package.json` - Added helmet, cors, express-rate-limit, supertest

## Decisions Made
- **SAGECONNECT_API_KEY optional:** The app does not crash if the key is missing -- it logs a warning and rejects all key-protected requests. This supports development workflows and gradual rollout.
- **CSP disabled in helmet:** Dashboard uses inline scripts, so contentSecurityPolicy: false avoids breaking the existing UI.
- **draft-7 rate limit headers:** Uses combined `ratelimit` and `ratelimit-policy` headers per the latest standard.
- **Test isolation via createTestApp():** Security tests build their own Express app to avoid config.js env var requirements. This makes tests fast and independent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated no-process-exit test for route restructure**
- **Found during:** Task 3 (Security integration tests)
- **Issue:** Moving routes from routes.js to dashboard-routes.js caused no-process-exit.test.js to fail because dashboard-routes.js was not in the ALLOWED_FILES set, and the autoTerminate guard test was checking the wrong file.
- **Fix:** Added dashboard-routes.js to ALLOWED_FILES set and updated the autoTerminate guard test to check dashboard-routes.js instead of routes.js.
- **Files modified:** tests/no-process-exit.test.js
- **Verification:** npx jest tests/no-process-exit.test.js passes (7 tests)
- **Committed in:** bd4ff55 (Task 3 commit)

**2. [Rule 1 - Bug] Updated config structure test from 5 to 6 sections**
- **Found during:** Task 1 (config.js update)
- **Issue:** config.test.js test "config has all five top-level sections" needed updating after adding security section.
- **Fix:** Changed test name and added expect(config).toHaveProperty('security').
- **Files modified:** tests/config.test.js
- **Verification:** npx jest tests/config.test.js passes (27 tests)
- **Committed in:** 3baf3e4 (Task 1 commit)

**3. [Rule 1 - Bug] Fixed rate limit header names in test**
- **Found during:** Task 3 (Security integration tests)
- **Issue:** Test expected `ratelimit-limit` and `ratelimit-remaining` headers but draft-7 standard uses combined `ratelimit` and `ratelimit-policy` headers.
- **Fix:** Updated test assertions to check correct header names.
- **Files modified:** tests/api/security.test.js
- **Verification:** npx jest tests/api/security.test.js passes (20 tests)
- **Committed in:** bd4ff55 (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (3 bugs from plan spec inaccuracies)
**Impact on plan:** All auto-fixes necessary for test correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required. SAGECONNECT_API_KEY can be added to .env when ready to enable API key protection.

## Next Phase Readiness
- All middleware modules are created and tested, ready for Plans 02 and 03 to build payment and PO endpoints
- Route index has commented placeholders for payment-routes.js and po-routes.js
- writeLimiter is exported from server.js for use by write endpoints
- validate() factory is ready for Joi schema creation per endpoint

## Self-Check: PASSED

All 8 created files verified on disk. All 3 task commits verified in git log.

---
*Phase: 07-rest-api-security*
*Completed: 2026-03-23*
