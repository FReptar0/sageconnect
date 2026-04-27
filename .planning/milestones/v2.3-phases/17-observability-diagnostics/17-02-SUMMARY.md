---
phase: 17-observability-diagnostics
plan: 02
subsystem: api
tags: [express, supertest, jest, sse, observability, operations-status, wire-shape]

# Dependency graph
requires:
  - phase: 17-observability-diagnostics
    provides: "Plan 17-01 — OperationManager.startStep/endStep + getRunningOperations() returns enriched slots with stepProgress"
provides:
  - "GET /api/operations/status JSDoc + module header documents the stepProgress wire shape (Phase 17 OBS-04)"
  - "Inline /status handler comment points to OperationManager.startStep / endStep ownership"
  - "3 new integration tests locking the wire contract: stepProgress array shape, null tenant for global steps, map-keyed-by-operationType (not array)"
  - "Regression guard against the schedule.html:589 .find() bug pattern at the API layer"
affects: [17-03-instrumentation, 17-04-ui-card, 18-recovery]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin pass-through API layer: OperationManager owns the operations map shape; route handler does not transform"
    - "Wire-shape locking via integration tests (supertest + jest.mock) to catch future shape regressions"
    - "Documentation-first commits separated from test-only commits (docs(...) then test(...))"

key-files:
  created: []
  modified:
    - src/routes/operations-routes.js
    - tests/api/operations-routes.test.js

key-decisions:
  - "Documentation-only edit on operations-routes.js — runtime path was already enriched transparently in Plan 17-01 (getRunningOperations returns slots with stepProgress). The route handler stays a thin pass-through."
  - "SSE endpoint (/:operationId/stream) NOT touched — preserves Phase 9 SSE consumer contract (verified by 3 surviving SSE tests)."
  - "Three new integration tests appended INSIDE the existing GET /api/operations/status describe block (not a new describe) — keeps locality of related assertions."
  - "Test for `Array.isArray(...) === false` and `Object.keys(...).contains('background-cycle')` is a deliberate regression guard against the bug pattern that schedule.html:589 fell into (operations.find(...) on a map)."
  - "Commit type chosen as docs(17-02) for Task 1 (JSDoc-only edits, zero behavior change) and test(17-02) for Task 2 (test-only additions)."
  - "schedule.html bug fix was intentionally NOT done here — it is owned by Plan 17-04 alongside the new UI card so the entire frontend change ships as one cohesive plan."

patterns-established:
  - "API contract locking: when a downstream consumer (UI/SSE) depends on a precise wire shape, add an explicit shape test (typeof / Array.isArray / Object.keys) so accidental refactors to the underlying data structure surface immediately"
  - "Thin route handler convention: routes do NOT transform service-layer outputs — all shape ownership lives in the service (OperationManager). JSDoc on the route documents the inherited shape but does not duplicate logic."

requirements-completed: [OBS-04]

# Metrics
duration: 3min
completed: 2026-04-27
---

# Phase 17 Plan 02: GET /api/operations/status Wire Contract Summary

**Documented and test-locked the GET /api/operations/status response shape so downstream UI consumers (Plan 17-04) can rely on stepProgress being present in a map keyed by operationType.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-27T18:59:09Z
- **Completed:** 2026-04-27T19:01:54Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `src/routes/operations-routes.js` module header now documents the full `GET /status` response shape (operations as a map keyed by operationType, each entry carrying `stepProgress: Array<{step, tenant, startedAt, finishedAt, error}>`), with an explicit warning that `operations` is a MAP not an array.
- Inline comment on the `/status` handler points future readers to `OperationManager.startStep / endStep` (Phase 17) as the source of truth for the stepProgress shape.
- 3 new integration tests in `tests/api/operations-routes.test.js` lock the wire contract: (a) stepProgress array surfaces with full nested shape, (b) null tenant survives the wire trip for global steps like `startChildProcess`, (c) operations field is a map keyed by operationType (not an array — prevents the schedule.html:589 regression pattern).
- All 8 operations-routes tests pass (5 baseline + 3 new). Exit code 0.
- SSE endpoint (`/:operationId/stream`) untouched — Phase 9 SSE consumers see no regression.

## Task Commits

Each task was committed atomically:

1. **Task 1: Update operations-routes.js JSDoc + module header** — `7ce3412` (docs)
2. **Task 2: Add integration tests confirming /status emits stepProgress** — `cbadb59` (test)

**Plan metadata:** _added below as part of completion commit_

## Files Created/Modified

- `src/routes/operations-routes.js` — +20 / -1 lines: expanded module header (10 → 27 lines) with full response shape JSDoc + map-vs-array warning; added 2-line inline comment on the `/status` handler referencing `OperationManager.startStep / endStep`. Runtime code path unchanged. SSE handler untouched.
- `tests/api/operations-routes.test.js` — +69 / -0 lines: appended 3 new tests inside the existing `describe('GET /api/operations/status', ...)` block. No new mocks, no new test app, no changes to existing tests or the SSE describe block.

## Decisions Made

- **Task 1 committed as `docs(17-02)`, not `feat`.** The runtime code path is byte-equivalent — only JSDoc and inline comments changed. Per CONVENTIONAL_COMMITS, `docs` is the correct type for documentation-only edits even when the file under change is JS source.
- **Task 2 committed as `test(17-02)`.** Test-only additions, no production code change.
- **Three new tests live INSIDE the existing GET /status describe block** (not a new describe). Keeps related assertions co-located, matches the file's existing structure (one describe per route).
- **Explicit `Array.isArray(...) === false` assertion** in test 3 is intentional — locks against the regression pattern where the operations payload could accidentally be returned as an array (which would break the schedule.html consumer's `operations[type]` access pattern). This is the API-layer half of the schedule.html:589 bug fix; the client-side half ships in Plan 17-04.
- **No SSE endpoint changes** — `/:operationId/stream` is byte-identical to its pre-plan state. Verified by running the 3 existing SSE tests after the route edit (all still pass).

## Deviations from Plan

None — plan executed exactly as written.

- Task 1: All 6 grep verification checks pass; module re-requires cleanly; existing test suite (5/5) still passes after the docs-only edit.
- Task 2: All 3 new tests pass with the exact names from the plan; full suite grows from 5 to 8 passing tests; exit code 0.

## Issues Encountered

- **Pre-existing combined-suite issue (NOT caused by this plan):** Running `npx jest tests/services/operation-manager.test.js tests/api/operations-routes.test.js` together emits a `process.exit(1)` from `loadRealConfig()` in the OperationManager test file. This is the same upstream issue documented in 17-01-SUMMARY.md (Issues Encountered, lines 102-104) — three license env vars (`LICENSE_API_URL`, `HMAC_SECRET`, `LICENSE_ADMIN_EMAIL`) added in v2.1 are not set in `setRequiredEnv()`. Workaround already known: run with `-t "OperationManager"` to skip the Schedule Section block.
- **Verified independently:** Running each suite alone with `--forceExit` shows 26/30 OperationManager tests pass (4 skipped in the broken Schedule Section block) and 8/8 operations-routes tests pass — Plans 17-01 and 17-02 both clean. The combined-run noise is purely test-infra debt, out of scope for this plan (would belong in a separate test-infrastructure plan that adds the license env vars to `setRequiredEnv()` in `tests/services/operation-manager.test.js:284-296`).

## User Setup Required

None — pure code/docs/test changes. No new env vars, no external services, no migration needed.

## Next Phase Readiness

- **Plan 17-03 (background.js + CronScheduler.js instrumentation):** Can proceed independently — its work is at the OperationManager call-site layer, not the API layer. The API contract this plan locks does not constrain how 17-03 chooses to instrument step boundaries.
- **Plan 17-04 (UI card + polling + schedule.html bug fix):** Now has a tested wire contract to consume. The polling consumer can rely on:
  - `res.body.data.operations` being an object keyed by operationType (never an array, never null).
  - Each entry carrying a `stepProgress` array (possibly empty), where each item has `{step, tenant, startedAt, finishedAt, error}`.
  - `tenant: null` being a valid value (for the cron-only `startChildProcess` step per D-12).
- **Blockers:** None. Wave 2 is half-complete (17-02 done, 17-03 still pending). Wave 3 (17-04) waits for 17-03.

## Self-Check: PASSED

- File `src/routes/operations-routes.js` exists and contains `stepProgress` (3 occurrences via grep, header + inline + table comment), `OperationManager.startStep`, and the `MAP keyed by operationType` warning.
- File `tests/api/operations-routes.test.js` contains 3 new test names: "returns stepProgress array on each operation entry", "preserves null tenant for global steps (startChildProcess)", "operations field is a map keyed by operationType (not an array)" (verified via grep).
- Commit `7ce3412` exists in `git log` (Task 1, docs).
- Commit `cbadb59` exists in `git log` (Task 2, test).
- 8/8 tests in `tests/api/operations-routes.test.js` pass under `npx jest tests/api/operations-routes.test.js` — exit 0.
- `node -e "require('./src/routes/operations-routes')"` — exit 0.
- `grep -c "stepProgress" src/routes/operations-routes.js` — 3 (>= 2 required).
- `git diff --name-only 132a316..HEAD` (after Task 2) shows only the two expected files (no scope creep).
- SSE endpoint code path untouched — verified by `git diff 132a316..HEAD -- src/routes/operations-routes.js | grep -E "^[-+]" | grep -v "^[-+]/\*\|^[-+]\*\|^[-+]\s*\*\|^[-+]//"` shows only comment-line changes for the route file.

---
*Phase: 17-observability-diagnostics*
*Completed: 2026-04-27*
