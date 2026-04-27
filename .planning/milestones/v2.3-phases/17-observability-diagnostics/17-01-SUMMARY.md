---
phase: 17-observability-diagnostics
plan: 01
subsystem: infra
tags: [operationmanager, locks, eventemitter, observability, scheduler, in-memory]

# Dependency graph
requires:
  - phase: 08-scheduler-real-time-layer
    provides: OperationManager singleton with per-type locks, EventEmitter SSE, ring buffer history
provides:
  - "stepProgress array stored on each lock slot ({step, tenant, startedAt, finishedAt, error})"
  - "OperationManager.startStep(operationType, step, tenant) — appends entry, no-op if lock missing"
  - "OperationManager.endStep(operationType, step, tenant, { error }) — closes last open matching entry, no-op if lock missing"
  - "getRunningOperations() snapshot enriched with stepProgress (existing shape preserved)"
  - "8 unit tests covering acquireLock init, startStep entry shape, null tenant, endStep happy path + error, no-op semantics, releaseLock discards stepProgress"
affects: [17-02-operations-routes, 17-03-instrumentation, 17-04-ui-card, 18-recovery, 19-root-cause-fix]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Volatile in-memory step heartbeat tracking (no persistence to history ring buffer)"
    - "No-op-on-missing-lock as race condition defense for cleanup paths"
    - "Backward-compatible Map slot extension (additive shape change, getRunningOperations untouched)"

key-files:
  created: []
  modified:
    - src/services/OperationManager.js
    - tests/services/operation-manager.test.js

key-decisions:
  - "stepProgress lives inside the existing this.locks slot, not as a separate Map (D-01) — inherits release semantics for free"
  - "startStep/endStep are no-ops when lock slot is missing (D-02) — defends against cleanup races during releaseLock"
  - "endStep iterates backwards (LIFO) to resolve concurrent retries of the same step+tenant in the order they started"
  - "Tenant nullish-coalesced (?? null) so undefined becomes null on the wire (deterministic shape)"
  - "No Winston/logger calls inside startStep/endStep (D-13) — silent to avoid log inflation; logs only at error sites in callers"
  - "emitProgress / EventEmitter signature untouched — SSE consumers in Phase 9 see no regression"

patterns-established:
  - "Step heartbeat lifecycle: acquireLock → [startStep → ... → endStep]* → releaseLock (volatile, gone after release)"
  - "stepProgress entry shape contract: { step, tenant, startedAt, finishedAt: null|ISO, error: null|string }"
  - "Slot extension by mutation: new fields added to existing Map values are visible via Object.fromEntries(this.locks) without explicit projection"

requirements-completed: [OBS-03]

# Metrics
duration: 6min
completed: 2026-04-27
---

# Phase 17 Plan 01: OperationManager Step Progress Foundation Summary

**Per-lock stepProgress array with startStep/endStep methods on OperationManager, preserving existing EventEmitter/SSE behavior and backed by 8 new unit tests.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-27T18:46:21Z
- **Completed:** 2026-04-27T18:52:18Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `OperationManager` lock slot now carries an inline `stepProgress: []` array initialized in `acquireLock` and discarded in `releaseLock` (volatile per D-01).
- New public method `startStep(operationType, step, tenant)` appends `{ step, tenant: tenant ?? null, startedAt, finishedAt: null, error: null }` to the slot's `stepProgress`. No-op when the slot is absent (D-02 race defense).
- New public method `endStep(operationType, step, tenant, { error = null } = {})` walks the array backwards (LIFO) and closes the last matching open entry by setting `finishedAt` + `error`. No-op when the slot is absent or no open match exists.
- `getRunningOperations()` now returns slots enriched with `stepProgress` automatically (no projection logic — slot mutation is transparent through `Object.fromEntries`).
- 8 new unit tests under describe `"OperationManager - Step Progress (Phase 17)"` lock the contract that Plans 17-02/03 will rely on.
- Existing 18 OperationManager tests still pass — no regression on locks, isLocked, getRunningOperations, EventEmitter, or history ring buffer behavior.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend OperationManager with stepProgress slot + startStep/endStep methods** — `4c1367d` (feat)
2. **Task 2: Add unit tests for stepProgress lifecycle, edge cases, enriched getRunningOperations** — `a804422` (test)

**Plan metadata:** _added below as part of completion commit_

## Files Created/Modified

- `src/services/OperationManager.js` — +51 / -4 lines: extended slot JSDoc, added `stepProgress: []` init in `acquireLock`, added `startStep` and `endStep` methods (with full JSDoc), updated `releaseLock` and `getRunningOperations` JSDoc to document new shape and volatility.
- `tests/services/operation-manager.test.js` — +89 / -1 lines: appended new describe block `"OperationManager - Step Progress (Phase 17)"` with 8 tests, plus a renumbered comment header for Config Schedule Section (now `// 9.` instead of `// 7.`).

## Decisions Made

- **stepProgress on the lock slot, not a separate Map.** Inherits `releaseLock` cleanup automatically; one less Map to keep in sync. Matches D-01 in CONTEXT.md.
- **No-op on missing lock for both methods.** Defends against the race window where Phase 17-03 instrumentation may fire `endStep` after `releaseLock` has already cleared the slot (e.g., in long-running `try/finally` blocks). Matches D-02.
- **LIFO scan in `endStep`.** A linear backward scan resolves concurrent step+tenant retries in the order they started — matches typical retry semantics where the most recently started attempt is the one currently executing.
- **`tenant ?? null` normalization.** Both `startStep` and `endStep` coerce `undefined` → `null` so callers can pass either without changing the entry shape on the wire.
- **No logger calls in startStep/endStep.** Per D-13 (Claude's discretion): instrumentation hot path stays silent to avoid inflating Winston logs at every step boundary; errors are logged at the caller's catch sites instead.

## Deviations from Plan

None — plan executed exactly as written. All 10 grep verification checks pass. File length growth is +47 lines (within the 30-60 sanity bound). No new `require()` statements added.

## Issues Encountered

- **Pre-existing jest issue (not caused by this plan):** The `Config - Schedule Section` describe block at the end of `operation-manager.test.js` calls `loadRealConfig()` which triggers `process.exit(1)` because three license env vars (`LICENSE_API_URL`, `HMAC_SECRET`, `LICENSE_ADMIN_EMAIL`) added in v2.1 are not set in `setRequiredEnv()`. This causes jest's worker to terminate non-gracefully, suppressing the normal `Tests: X passed` summary line and producing exit code 1 even though the OperationManager tests themselves pass. Workaround: run with `-t "OperationManager"` to skip the Schedule Section block, or with `--forceExit` to suppress the open-handles warning.
- **Verified on baseline (pre-changes):** This issue exists independently of this plan's edits. No fix attempted here — not in scope, and would belong in a separate test-infrastructure plan (note for future: add the three license env vars to `setRequiredEnv()` in `tests/services/operation-manager.test.js:284-296`).
- **Test outcome with `-t "OperationManager"`:** **26 passed / 4 skipped / 30 total** — all 18 baseline + 8 new OperationManager tests pass. Exit code 0.

## User Setup Required

None — pure in-memory data structure changes. No new env vars, no external services, no migration needed.

## Next Phase Readiness

- **Plan 17-02 (operations-routes.js):** Can now consume the enriched `getRunningOperations()` shape directly. The endpoint shape `{operations: {[type]: {operationId, startedAt, stepProgress: [...]}}}` per D-04 is already produced — Plan 17-02 only needs to update the JSON serializer + add tests. Bug fix in `schedule.html:589` (`operations.find()` on a map) lives in Plan 17-04.
- **Plan 17-03 (background.js + CronScheduler.js instrumentation):** Can now wrap each step in `try { startStep + emitProgress + await stepFn() } finally { endStep(..., { error: caughtMessage }) }` per D-11. The no-op-on-missing-lock guarantee means the `try/finally` is safe even if the outer `catch` releases the lock before `finally` runs.
- **Plan 17-04 (UI card + polling):** Will consume the enriched API response from 17-02 with no contract drift expected.
- **Blockers:** None. Foundation contract is stable; downstream plans can proceed in parallel where dependencies allow (17-02 and 17-03 are both wave 2).

## Self-Check: PASSED

- File `src/services/OperationManager.js` exists and contains `startStep`, `endStep`, `stepProgress: []` (verified via grep).
- File `tests/services/operation-manager.test.js` contains describe `"OperationManager - Step Progress (Phase 17)"` (verified via grep).
- Commit `4c1367d` exists in `git log` (Task 1).
- Commit `a804422` exists in `git log` (Task 2).
- 26 OperationManager tests pass under `npx jest tests/services/operation-manager.test.js -t "OperationManager" --forceExit` (verified, exit 0).
- 4 grep hits for `startStep|endStep` in `src/services/OperationManager.js` (>= 4 required by plan verification).
- `git diff --name-only e11b324..HEAD` shows only the two expected files (no scope creep).

---
*Phase: 17-observability-diagnostics*
*Completed: 2026-04-27*
