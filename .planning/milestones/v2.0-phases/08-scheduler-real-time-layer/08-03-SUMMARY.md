---
phase: 08-scheduler-real-time-layer
plan: 03
subsystem: api
tags: [rest-api, sse, server-sent-events, express-router, joi, cron-schedule, real-time]

# Dependency graph
requires:
  - phase: 08-scheduler-real-time-layer
    plan: 01
    provides: "OperationManager singleton with locks, EventEmitter progress, bounded history"
  - phase: 07-rest-api-security
    provides: "Express route patterns, middleware (api-key, validate, asyncHandler, sendResult), Joi schemas"
provides:
  - "GET /api/schedule -- cron expression, task status, next/last run"
  - "POST /api/schedule/:taskId/trigger -- manual trigger with 409 conflict, API key, rate limit"
  - "GET /api/schedule/history -- last 24h execution history"
  - "GET /api/operations/status -- running operations"
  - "GET /api/operations/:operationId/stream -- SSE real-time progress events with cleanup"
  - "Joi triggerSchema for taskId validation"
affects: [09-web-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns: [sse-event-stream, lazy-require-for-parallel-wave, inline-write-limiter]

key-files:
  created: [src/routes/schedule-routes.js, src/routes/operations-routes.js, src/routes/schemas/schedule-schemas.js, tests/api/schedule-routes.test.js, tests/api/operations-routes.test.js]
  modified: [src/routes/routes.js]

key-decisions:
  - "Lazy CronScheduler require with try/catch handles Wave 2 parallel execution gracefully"
  - "SSE endpoint uses direct res.write (no asyncHandler/sendResult) with heartbeat + auto-cleanup"
  - "Schedule and operations routes mounted without global requireApiKey (POST trigger applies it internally)"
  - "triggerSchema Joi validation restricts manual trigger to known task IDs only (background-cycle)"

patterns-established:
  - "SSE pattern: writeHead + flushHeaders + event subscription + heartbeat + req.on('close') cleanup"
  - "Route-level API key: requireApiKey applied per-handler instead of at mount level for mixed auth"
  - "Lazy require pattern for optional dependencies in parallel wave execution"

requirements-completed: [SYS-01, SYS-02, SYS-03, SYS-04, SYS-05]

# Metrics
duration: 4min
completed: 2026-03-24
---

# Phase 8 Plan 3: Schedule & Operations Routes Summary

**REST endpoints for schedule visibility, manual trigger with conflict detection, execution history, and SSE real-time progress streaming via OperationManager events**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-24T03:55:31Z
- **Completed:** 2026-03-24T04:00:24Z
- **Tasks:** 2 (TDD: RED + GREEN for both)
- **Files modified:** 6

## Accomplishments
- 5 new system API endpoints: schedule status, history, manual trigger, operations status, SSE stream
- SSE endpoint subscribes to OperationManager EventEmitter, streams progress events, cleans up on disconnect
- Manual trigger returns 409 Conflict when background-cycle lock is held, 401 without API key, 400 for invalid task
- Lazy CronScheduler import gracefully handles Wave 2 parallel execution (Plan 02 may not exist yet)
- 12 integration tests covering all endpoints, SSE event delivery, and listener cleanup

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests for schedule and operations routes** - `007eee9` (test)
2. **Task 2 (GREEN): Schedule routes + operations routes + Joi schemas + wiring** - `346093b` (feat)

## Files Created/Modified
- `src/routes/schedule-routes.js` - GET /, GET /history, POST /:taskId/trigger endpoints
- `src/routes/operations-routes.js` - GET /status, GET /:operationId/stream (SSE) endpoints
- `src/routes/schemas/schedule-schemas.js` - Joi triggerSchema validating taskId
- `src/routes/routes.js` - Mount schedule-routes and operations-routes after system-routes
- `tests/api/schedule-routes.test.js` - 7 integration tests for schedule endpoints
- `tests/api/operations-routes.test.js` - 5 integration tests for operations endpoints and SSE

## Decisions Made
- Lazy CronScheduler require with try/catch: since Plans 02 and 03 run in parallel (Wave 2), CronScheduler.js may not exist. Route handler falls back to config defaults.
- SSE endpoint bypasses asyncHandler and sendResult: raw res.write for event-stream protocol with 30s heartbeat interval
- Schedule and operations routes mounted without global requireApiKey: GET endpoints are read-only, POST trigger applies requireApiKey internally per the domain-split pattern
- triggerSchema uses Joi.string().valid('background-cycle') to restrict manual trigger to known task IDs only
- api-key mock moved to top-level jest.mock in tests to comply with Jest's out-of-scope variable restriction

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed jest.mock out-of-scope variable in schedule test**
- **Found during:** Task 2 (GREEN phase test execution)
- **Issue:** jest.mock inside createScheduleTestApp() referenced local variable `testRequireApiKey`, violating Jest's scoping rules
- **Fix:** Moved api-key mock to top-level jest.mock with inline implementation using require('crypto')
- **Files modified:** tests/api/schedule-routes.test.js
- **Verification:** All 7 schedule tests pass
- **Committed in:** 346093b (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Test mock restructuring only -- no impact on production code or scope.

## Issues Encountered
- CronScheduler.js does not exist yet (Plan 02 not executed). Handled as designed with lazy require and config defaults fallback.

## User Setup Required

None - no external service configuration required. All endpoints use existing config values.

## Next Phase Readiness
- All 5 system API endpoints ready for Phase 9 (Web UI) to consume
- SSE streaming ready for real-time progress display in dashboard
- Schedule status, history, and manual trigger complete the operational API surface
- CronScheduler integration will activate automatically when Plan 02 completes

## Self-Check: PASSED

- `src/routes/schedule-routes.js` exists
- `src/routes/operations-routes.js` exists
- `src/routes/schemas/schedule-schemas.js` exists
- `tests/api/schedule-routes.test.js` exists (225 lines, min 80 required)
- `tests/api/operations-routes.test.js` exists (175 lines, min 60 required)
- Commit 007eee9 found in git log
- Commit 346093b found in git log

---
*Phase: 08-scheduler-real-time-layer*
*Completed: 2026-03-24*
