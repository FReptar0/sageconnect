---
phase: 08-scheduler-real-time-layer
plan: 01
subsystem: infra
tags: [concurrency, event-emitter, scheduling, node-cron, singleton]

# Dependency graph
requires:
  - phase: 06-infra-foundation
    provides: "config.js centralized loader, service patterns"
provides:
  - "OperationManager singleton with per-type locks, global background-cycle lock, EventEmitter progress, bounded history"
  - "config.schedule section (cronExpression, operationDelayMs)"
  - "node-cron@4 dependency installed"
affects: [08-02-PLAN, 08-03-PLAN, 09-web-dashboard]

# Tech tracking
tech-stack:
  added: [node-cron@4]
  patterns: [singleton-with-event-emitter, ring-buffer-history, per-type-locking]

key-files:
  created: [src/services/OperationManager.js, tests/services/operation-manager.test.js]
  modified: [src/config.js, package.json, package-lock.json]

key-decisions:
  - "OperationManager extends EventEmitter for progress:operationId SSE pattern"
  - "Ring buffer uses array shift (max 100) for simplicity over circular buffer"
  - "_reset() method on singleton for test isolation"

patterns-established:
  - "Singleton service pattern: class extends EventEmitter, module.exports = new Class()"
  - "Per-operation-type locking with global background-cycle blocker"
  - "Progress event naming: progress:{operationId}"

requirements-completed: [INFRA-04, SYS-04]

# Metrics
duration: 3min
completed: 2026-03-24
---

# Phase 8 Plan 1: OperationManager Summary

**Singleton concurrency controller with per-type locks, EventEmitter progress events, bounded history ring buffer, and config.schedule section for cron/delay settings**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-24T03:49:09Z
- **Completed:** 2026-03-24T03:52:41Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 5

## Accomplishments
- OperationManager singleton with per-operation-type lock semantics and global background-cycle blocking
- EventEmitter-based progress events (`progress:{operationId}`) ready for SSE streaming
- Bounded execution history ring buffer (max 100 entries) with time-filtered getHistory(hours)
- config.schedule section with cronExpression and operationDelayMs defaults from env vars
- node-cron@4 installed for Plan 02 CronScheduler usage
- 22 unit tests covering all lock/event/history/config behaviors

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests for OperationManager** - `f695c3b` (test)
2. **Task 1 (GREEN): OperationManager + config.schedule + node-cron** - `a8eb7a5` (feat)

## Files Created/Modified
- `src/services/OperationManager.js` - Singleton concurrency controller with locks, events, history
- `src/config.js` - Added schedule section (cronExpression, operationDelayMs)
- `package.json` - Added node-cron@4 dependency
- `package-lock.json` - Lock file updated
- `tests/services/operation-manager.test.js` - 22 unit tests for full OperationManager + config schedule coverage

## Decisions Made
- OperationManager extends EventEmitter directly for `progress:{operationId}` event pattern (SSE-ready)
- Ring buffer uses simple array push/shift (max 100) -- sufficient for execution history size
- Singleton exports `_reset()` method for test isolation (clears locks, history, listeners)
- CRON_SCHEDULE and OPERATION_DELAY_MS are optional env vars (not in REQUIRED validation) per plan

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Config schedule tests initially failed because jest.isolateModules loaded the top-level mock of config.js instead of the real module. Fixed by adding `jest.unmock()` inside the isolated module loader function.

## User Setup Required

None - no external service configuration required. CRON_SCHEDULE and OPERATION_DELAY_MS env vars are optional with sensible defaults.

## Next Phase Readiness
- OperationManager ready for Plan 02 (CronScheduler) to use acquireLock/releaseLock/emitProgress
- config.schedule ready for CronScheduler to read cronExpression and operationDelayMs
- node-cron@4 installed and available for import
- EventEmitter pattern ready for Plan 03 SSE endpoint to subscribe to progress events

## Self-Check: PASSED

- All created files exist on disk
- Both commits (f695c3b, a8eb7a5) found in git log
- node-cron@4 present in package.json dependencies
- config.schedule section present in src/config.js
- Test file is 336 lines (min 80 required)

---
*Phase: 08-scheduler-real-time-layer*
*Completed: 2026-03-24*
