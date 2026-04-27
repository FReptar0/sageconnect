---
phase: 17-observability-diagnostics
plan: 03
subsystem: infra
tags: [background-cycle, cron-scheduler, instrumentation, observability, step-progress, jest]

# Dependency graph
requires:
  - phase: 17-observability-diagnostics
    provides: "Plan 17-01 — OperationManager.startStep / endStep + stepProgress slot inside acquireLock"
  - phase: 17-observability-diagnostics
    provides: "Plan 17-02 — GET /api/operations/status wire shape locked (operations as a map keyed by operationType, each entry carrying stepProgress array)"
provides:
  - "src/background.js forResponse — each of the 7 per-tenant steps wrapped in try/catch/finally that calls emitter.startStep + emitProgress before await and emitter.endStep with { error } in finally"
  - "src/services/CronScheduler.js — await startChildProcess() wrapped in inner try/catch/finally that calls operationManager.startStep('background-cycle', 'startChildProcess', null) before and endStep with { error } in finally"
  - "Backwards-compat preserved via `if (emitter && operationId)` guards (node src/background.js direct invocation still works)"
  - "Tenant-level catch (background.js outer try at the for-loop body) preserved — each step catch re-throws so the OUTER catch still fires"
  - "2 new unit tests in tests/services/cron-scheduler.test.js covering success path, error path, ordering, and forResponse-not-wrapped-here regression guard"
  - "scripts/verify-bg-instrumentation.js — 16 structural smoke checks for background.js"
  - "scripts/verify-cron-instrumentation.js — 9 structural smoke checks for CronScheduler.js"
affects: [17-04-ui-card, 18-recovery, 19-root-cause-fix]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Block-scoped step instrumentation: { const __step = '...'; let __stepError = null; try { ... } catch (e) { __stepError = e.message; throw e; } finally { ... } } prevents const collisions across sibling step blocks in the same loop iteration"
    - "Inner catch capture-and-re-throw: catches the step error to write it into the lock-resident stepProgress entry via endStep, then re-throws so the OUTER tenant-level catch still drives the loop continuation logic — observability layer never swallows errors"
    - "tenant=null literal for global steps (startChildProcess) — matches the wire shape locked by Plan 17-02 integration tests"
    - "Cron-only instrumentation in CronScheduler.js (NOT background.js) for startChildProcess — manual trigger path uses forResponse without startChildProcess so this asymmetry is intentional per D-12"

key-files:
  created:
    - scripts/verify-bg-instrumentation.js
    - scripts/verify-cron-instrumentation.js
  modified:
    - src/background.js
    - src/services/CronScheduler.js
    - tests/services/cron-scheduler.test.js

key-decisions:
  - "Inner try/catch (not just try/finally) per step — the catch is required to capture stepErr.message into __stepError so the finally can pass it to endStep. Without the catch the variable stays null and the failure context is lost from the stepProgress entry."
  - "Block-scope `{ ... }` wrapper around each step prevents `const __step` collisions across the 7 sibling steps in the same for-loop iteration. Using `let` would be wrong because the value never changes inside a single block — `const` documents intent."
  - "Re-throw stepErr inside the inner catch — observability does NOT change the existing tenant-level error-handling contract. The outer try/catch at background.js line ~243 still continues to the next tenant, exactly as today."
  - "startChildProcess instrumented in CronScheduler.js only — adding it to background.js would either (a) instrument the manual trigger path with a step that never runs there, or (b) require conditional logic to detect cron vs manual. D-12 chose the cleaner path: instrumentation lives where the call lives."
  - "tenant: null literal (not 'global', not 'null' string) — matches the wire shape Plan 17-02 locked with `expect(entry.tenant).toBeNull()`."
  - "scripts/verify-*-instrumentation.js committed as part of the source change — they are structural smoke checks the planner mandated, kept as future regression guards (e.g., if someone refactors background.js, the script catches missing wraps)."
  - "Test 1 of Task 3 includes a negative assertion (`startStep NOT called with forResponse|buildProviders|downloadCFDI`) — locks against a future regression where someone accidentally instruments forResponse at the CronScheduler layer (would double-count steps)."

patterns-established:
  - "Per-step heartbeat instrumentation: try { startStep + emitProgress + await stepFn } catch { capture + re-throw } finally { endStep with error } — replicated 7 times per tenant (inside outer tenant try/catch) plus once for startChildProcess in cron path"
  - "Backwards-compat guard pattern preserved: `if (emitter && operationId)` wraps BOTH startStep and emitProgress, so direct invocation (`node src/background.js`) with no emitter remains a no-op for the new instrumentation"
  - "Mock extension as a forced-error gate: when production code adds a new method call on a mocked dependency, EVERY test using that dependency must extend the mock OR they all fail with TypeError. This plan deliberately committed Task 2 (production code) before Task 3 (mock + tests) so the broken-then-fixed transition is visible in git history as a teaching artifact for future contributors."

requirements-completed: [OBS-02, OBS-05]

# Metrics
duration: 5min
completed: 2026-04-27
---

# Phase 17 Plan 03: forResponse + CronScheduler Step Instrumentation Summary

**Per-step startStep/endStep wrapping in forResponse (7 steps × N tenants) and in CronScheduler around startChildProcess (cron-only, tenant=null), populating the stepProgress wire shape Plan 17-02 locked.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-27T19:06:12Z
- **Completed:** 2026-04-27T19:11:03Z
- **Tasks:** 3
- **Files modified:** 3 (+ 2 new verification scripts)

## Accomplishments

- All 7 per-tenant steps in `forResponse` (`buildProviders`, `downloadCFDI`, `checkPayments`, `uploadPayments`, `createPurchaseOrders`, `processOrderChanges`, `closePurchaseOrders`) are now wrapped in block-scoped `{ try { startStep + emitProgress + await stepFn } catch { capture + re-throw } finally { endStep with error } }` blocks.
- `CronScheduler.js` now wraps the cron-only `await startChildProcess()` call with `operationManager.startStep('background-cycle', 'startChildProcess', null)` before and `operationManager.endStep` in finally — caught errors re-thrown so the OUTER catch still records `success=false` to history.
- Backwards compatibility preserved: the `if (emitter && operationId)` guard wraps BOTH `startStep` and `emitProgress` in background.js, so `node src/background.js` direct invocation (no emitter) still works.
- `mockOperationManager` in `tests/services/cron-scheduler.test.js` extended with `startStep` + `endStep` jest.fn() — required because Task 2 made the cron callback call these methods on every tick.
- 2 new unit tests cover: (a) startStep + endStep called with exact args and ordered correctly on success path, plus a negative assertion that forResponse is NOT instrumented at the CronScheduler layer (regression guard); (b) endStep receives the error message when startChildProcess rejects, AND the outer history records `success=false` (verifies the inner re-throw reached the outer catch).
- 17/17 tests pass in `cron-scheduler.test.js` (15 baseline + 2 new), 0 regression. Combined run with `operation-manager.test.js` shows 43 passing / 4 skipped (skipped are pre-existing Schedule Section block, documented in 17-01-SUMMARY).
- `scripts/verify-bg-instrumentation.js` (16 checks) and `scripts/verify-cron-instrumentation.js` (9 checks) both pass — usable as future regression guards.

## Task Commits

Each task was committed atomically:

1. **Task 1: Instrument the 7 forResponse steps in background.js with try/catch/finally + startStep/endStep** — `4bfcc70` (feat)
2. **Task 2: Instrument startChildProcess in CronScheduler.js with startStep/endStep** — `9b109f5` (feat)
3. **Task 3: Add unit test for CronScheduler startChildProcess instrumentation** — `98d41f5` (test)

**Plan metadata:** _added below as part of completion commit_

## Files Created/Modified

- `src/background.js` — +176 / -77 lines: each of the 7 step blocks expanded from a flat `if-emitProgress + log + await + log` pattern into a block-scoped `{ try/catch/finally }` wrap with `__step` / `__stepError` locals, startStep guard, and endStep in finally. The completion `emitProgress({ type: 'complete' })` and tenant-error `emitProgress({ type: 'error' })` blocks remain untouched (they are not steps). `startChildProcess` function untouched (handled in CronScheduler per D-12).
- `src/services/CronScheduler.js` — +14 / -0 lines: inner try/catch/finally inserted between `await forResponse(...)` and `logGenerator [COMPLETE]` lines, wrapping `await startChildProcess()`. No imports added (`operationManager` was already required at line 17). Lifecycle handlers (4 `task.on` calls) untouched.
- `tests/services/cron-scheduler.test.js` — +49 / -0 lines: extended `mockOperationManager` with `startStep: jest.fn()` and `endStep: jest.fn()` keys (lines 41-48); appended 2 new tests inside the existing `cron callback (execution cycle)` describe block, after the `updates lastRun after execution` test, using the existing `cronCallback` local variable (captured in the existing `beforeEach`).
- `scripts/verify-bg-instrumentation.js` — NEW: 16 structural smoke checks (7 step name asserts + 9 instrumentation/structure asserts).
- `scripts/verify-cron-instrumentation.js` — NEW: 9 structural smoke checks confirming the inner try/catch/finally + tenant=null + lifecycle handlers untouched.

## Decisions Made

- **Block-scoped wrapper per step.** Used `{ ... }` blocks so each step gets its own `__step` / `__stepError` locals without colliding with siblings in the same for-loop iteration. Alternatives considered: numbered locals (`__step1`, `__step2`, ...) would be uglier; sharing a single `__step` mutated between blocks would lose the const safety. Block scope is the cleanest pattern.
- **Inner try/catch (not just try/finally).** The catch is required to capture `stepErr.message` into `__stepError` so the finally can pass it to `endStep`. A bare `try/finally` would leave the variable null and lose failure context in the stepProgress entry.
- **Re-throw inside inner catch.** Observability never swallows errors. The outer tenant-level catch (background.js line ~243) is the one that decides to log+continue to the next tenant — preserving that behavior is mandatory per D-03 / D-11.
- **Plan stated "no setTimeout after closePurchaseOrders" but the code already has one.** Looking at the original file, `await new Promise(resolve => setTimeout(resolve, delay))` exists after closePurchaseOrders too (before `[TENANT-COMPLETE]` log). Kept it as-is — removing it would be an unrelated behavior change and the verification check only requires `>= 6` setTimeout calls so 7 is fine. This is a minor plan-prose imprecision that does not affect correctness; flagged here for transparency.
- **Verification scripts committed alongside source.** They are not throwaway — they encode the structural contract (exactly 7 startStep / 7 endStep calls in background.js, exactly 1 in CronScheduler.js with tenant=null) and will catch any future refactor that accidentally drops or duplicates wraps. Cost: ~50 LOC for two scripts. Benefit: regression guard that runs in milliseconds.
- **Task 2 committed BEFORE Task 3 (production before tests).** This produces a transient broken-tests state visible in git as commit `9b109f5` → tests broken → `98d41f5` → tests fixed. This was deliberate: it documents in git history that Task 3's mock extension is REQUIRED, not optional, and any future contributor refactoring CronScheduler will see the breakage if they remove startStep/endStep from the mock.

## Deviations from Plan

None of substance — plan executed as written. Two minor notes:

- **Verification check count.** The plan claimed Task 1 verify script has "17 checks" (7 step name + 10 structural) but the actual checks total is 16 (7 step name + 9 structural — the plan's structural list double-counts one item). All 16 checks pass.
- **closePurchaseOrders trailing setTimeout.** The plan said "the LAST step has no `await new Promise(resolve => setTimeout(resolve, delay));` after it (look at lines 142-144 — the next line is the `[TENANT-COMPLETE]` log)". The actual file (current line ~225) has the setTimeout BEFORE `[TENANT-COMPLETE]`. Preserved the existing setTimeout to avoid an unrelated behavior change. The verification check (`>= 6` setTimeout calls) is satisfied either way.

Both notes are plan-prose imprecisions that do not affect the implementation contract.

**Total deviations:** 0 auto-fixes needed.
**Impact on plan:** Zero. All verification checks pass, all tests pass, no regressions.

## Issues Encountered

- **Predicted test breakage between Task 2 and Task 3.** After Task 2 (production code change), running `npx jest tests/services/cron-scheduler.test.js` showed 2 tests failing with `TypeError: operationManager.endStep is not a function` — exactly as the plan predicted. Task 3 fixed it by extending `mockOperationManager` with `startStep: jest.fn(), endStep: jest.fn()`. Final state: 17/17 pass.
- **Pre-existing combined-suite issue (NOT caused by this plan):** Same upstream test-infra issue documented in 17-01-SUMMARY and 17-02-SUMMARY — `loadRealConfig()` in `operation-manager.test.js` triggers `process.exit(1)` because three license env vars are not set in `setRequiredEnv()`. Workaround already known: run with `-t "OperationManager|CronScheduler|forResponse"` and `--forceExit`. Combined run shows 43 passing / 4 skipped, exit 0.
- **Module-load self-check (`node -e "require('./src/background')"`) hits config fail-fast.** This is a pre-existing behavior of `src/config.js` which calls `process.exit(1)` when required env vars are missing. Not caused by this plan, not fixable without setting up test env vars (out of scope). The `node --check src/background.js` parse smoke test succeeds, which is what the plan's automated verification actually requires.

## User Setup Required

None — pure code/test changes. No new env vars, no external services, no migration needed. Existing direct-invocation path (`node src/background.js` with no emitter) preserved by the `if (emitter && operationId)` guards.

## Next Phase Readiness

- **Plan 17-04 (UI card + polling + schedule.html bug fix):** Ready to consume. The `stepProgress` array Plan 17-02 wired up at the API layer is now actually populated at runtime by Plan 17-03. UI polling against `GET /api/operations/status` will see real entries: 7 per-tenant steps from `forResponse` (manual trigger or cron) plus 1 global `startChildProcess` entry with `tenant: null` (cron only). Heartbeat formula (`Date.now() - new Date(entry.startedAt).getTime()`) per D-08 will work as designed.
- **Phase 18 (recovery — auto-release + force-release):** Foundation observability is now complete (lock state + step heartbeats both visible). Phase 18 can use the heartbeat staleness as a signal for auto-release decisions.
- **Phase 19 (root cause fix — timeouts):** The new instrumentation will visibly show WHICH step a hung cycle stopped at, making the per-step timeout decisions concrete (e.g., "axios calls in `uploadPayments` should have a 5min timeout because the heartbeat shows that step hangs").
- **Blockers:** None. Wave 2 is complete (17-02 + 17-03 both done). Wave 3 (17-04) is the only remaining plan in Phase 17.

## Self-Check: PASSED

- File `src/background.js` exists and contains 7 occurrences of `emitter.startStep` and 7 of `emitter.endStep` (verified via `grep -c`).
- File `src/services/CronScheduler.js` exists and contains 1 occurrence of `operationManager.startStep('background-cycle', 'startChildProcess'` (verified via `grep -c`).
- File `tests/services/cron-scheduler.test.js` mockOperationManager extended with startStep + endStep keys (verified by reading the file post-edit).
- Files `scripts/verify-bg-instrumentation.js` and `scripts/verify-cron-instrumentation.js` exist and exit 0 (verified by running them).
- Commit `4bfcc70` exists in `git log` (Task 1, feat).
- Commit `9b109f5` exists in `git log` (Task 2, feat).
- Commit `98d41f5` exists in `git log` (Task 3, test).
- 17/17 cron-scheduler tests pass under `npx jest tests/services/cron-scheduler.test.js`, exit 0.
- 8/8 operations-routes tests still pass (no regression to Plan 17-02), exit 0.
- 26 OperationManager tests still pass under `-t "OperationManager"` (no regression to Plan 17-01).
- Combined run `npx jest tests/services/cron-scheduler.test.js tests/services/operation-manager.test.js -t "OperationManager|CronScheduler|forResponse"` shows 43 passing / 4 skipped, exit 0.
- `node --check src/background.js` and `node --check src/services/CronScheduler.js` exit 0.
- `git diff --diff-filter=D --name-only HEAD~3 HEAD` shows no unintended deletions.

---
*Phase: 17-observability-diagnostics*
*Completed: 2026-04-27*
