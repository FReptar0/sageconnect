---
phase: 20-cron-retry-policy-eom-notification
plan: 07
subsystem: background-cron
tags: [eom-notification, cron-tick-guard, background-js, integration-test]
requires: [20-01, 20-02, 20-03, 20-04]
provides:
  - "EOM cron-tick gate at top of forResponse() — dispatches two end-of-month operator emails (POs + payments) on the last calendar day, gated by per-category sentinels"
  - "dispatchEomIfDue(now, cfg) + buildEomDataQuery(category, tenantDb) exported from src/background.js"
affects:
  - "src/background.js — forResponse() now runs the EOM gate before the tenant loop"
tech-stack:
  added: []
  patterns:
    - "Cron-tick guard wrapped in withStepTimeout (defense-in-depth step tier, CLAUDE.md §9)"
    - "Best-effort dispatch — EOM failure logged but never re-thrown, cron tick continues"
    - "Atomic per-category sentinel write (always, success or failure) per SPEC EOM-04"
key-files:
  created:
    - tests/integration/eom-dispatch.test.js
  modified:
    - src/background.js
    - tests/services/background.forResponse.stepTimeout.test.js
    - tests/integration/timeout-logging.test.js
decisions:
  - "EOM gate placed at top of forResponse() after [START] log, before tenant loop (CONTEXT D-11)"
  - "EOM data query HARDCODES buildScopeWhere({scope:'current_month'}) — config.retry.scope ignored (CONTEXT D-09)"
  - "Two emails per dispatch — one per category, all tenants combined (CONTEXT D-08)"
  - "Empty category still sends 'Sin pendientes' email + sentinel success:true rowCount:0 (CONTEXT D-10)"
metrics:
  duration: "~25 min"
  completed: 2026-05-15
  tasks: 2
  files: 4
---

# Phase 20 Plan 07: EOM Cron-Tick Gate Summary

End-of-month operator-notification gate wired into `forResponse()` — on the last calendar day at/after `EOM_NOTIFICATION_HOUR` it dispatches two consolidated HTML emails (pending POs + pending payments, all tenants combined) to the operator mailbox, writes per-category sentinels unconditionally, and on SMTP failure falls back to an admin alert. The gate is best-effort, wrapped in `withStepTimeout` to honor the defense-in-depth step tier, and adds no new always-on state.

## What Was Built

### Task 1 — EOM gate in `src/background.js` (commit `6dbcadc`)

- **6 imports added** at top of file: `fs`, `path`, `runQuery` (SQLServerConnection), `shouldDispatchEom`/`buildEomEmailHtml`/`writeSentinelAtomically` (EomNotification), `sendOperatorReport` (EmailSender), `sendAdminAlert` (AdminEmailSender), `buildScopeWhere` (RetryPolicy).
- **Gate block** inserted after the `[START]` log entry and before `const tenantIds = ...` (the tenant loop). When `config.eom.notificationEnabled === false` it emits `[EOM-SKIP] reason=enabled-false` and short-circuits before any query/sentinel/fs work. Otherwise it runs `dispatchEomIfDue(date, config)` wrapped in `withStepTimeout(..., config.schedule.stepTimeoutMs, 'step=eomDispatch')`. The catch logs `[TIMEOUT]` (when the error is a step timeout) and `[EOM-DISPATCH] Failed:` — and does **not** re-throw, so the cron tick continues to the tenant loop.
- **`dispatchEomIfDue(now, cfg)`** — top-level function. For each of `['pos', 'payments']`: builds the per-category sentinel path `eom-{YYYY-MM}-{category}.sent`, calls `shouldDispatchEom`; on gate-false emits `[EOM-SKIP] category=… reason=gate-false` and continues. On gate-pass it emits `[EOM-GATE]`, runs one `runQuery(sql, tenantDb)` per tenant (per-tenant query failures logged + skipped, partial data preferred), aggregates rows, builds the HTML via `buildEomEmailHtml` (called unconditionally — empty categories still send), and calls `sendOperatorReport`. On SMTP failure it builds a `success:false` sentinel payload, logs `sent=false`, and fires `sendAdminAlert('[SageConnect] EOM email FAILED for {YYYY-MM} - {category}', …)`. The sentinel is **always** written via `writeSentinelAtomically` (success or failure).
- **`buildEomDataQuery(category, tenantDb)`** — top-level function. Builds the POs query (`POPORH1` + `Autoriza_OC` + OUTER APPLY on `fesaOCFocaltec`) and the payments query (`APBTA`/`BKACCT`/`APTCR` + OUTER APPLY on `fesaPagosFocaltec`). Both call `buildScopeWhere({ scope: 'current_month' }, { dateField })` with **hardcoded** `current_month` per CONTEXT D-09. Every `runQuery` passes the tenant DB explicitly (CLAUDE.md §6 #2).
- `dispatchEomIfDue` + `buildEomDataQuery` added to `module.exports` for testability. Existing exports and the entire tenant loop preserved verbatim.

### Task 2 — Integration test + affected-suite fixes (commit `93bed48`)

- **New `tests/integration/eom-dispatch.test.js`** — 3 SPEC EOM-04 scenarios:
  - `(a)` first tick of the last day → both operator emails sent, sentinels written with `success:true rowCount:1`, `[EOM-GATE]`/`[EOM-DISPATCH] sent=true`/`[EOM-SENTINEL]` logged, no admin alert.
  - `(b)` second tick same month (sentinels pre-written) → no email, no `runQuery`, `[EOM-SKIP] reason=gate-false` for both categories, sentinel content unchanged.
  - `(c)` SMTP failure → `sendOperatorReport` rejects, sentinels written `success:false` with the error, `sendAdminAlert` fired twice with subjects matching `EOM email FAILED for 2026-05 - {pos|payments}`; a subsequent tick is blocked by the sentinel (no resend).
  - The config mock intentionally sets `retry.scope = 'last_n_days'`, proving the EOM data query ignores it and hardcodes `current_month` (CONTEXT D-09).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two existing test suites broke on the new EOM gate**
- **Found during:** Task 2 full-suite verification.
- **Issue:** `tests/services/background.forResponse.stepTimeout.test.js` mocks `src/config` without an `eom` namespace; the new gate reads `config.eom.notificationEnabled` and threw `TypeError` before the tenant loop, failing 4 tests. `tests/integration/timeout-logging.test.js` asserts `await withStepTimeout(` appears exactly 7 times in `background.js`; the EOM gate adds a legitimate 8th wrap (mandated by CONTEXT D-11), failing 1 test.
- **Fix:** Added `eom: { notificationHour: 18, notificationEnabled: false }` to the stepTimeout test's config mock (gate short-circuits — that suite tests the step-timeout path, not EOM). Updated the `timeout-logging.test.js` count assertion 7 → 8 and added a positive assertion that the EOM dispatch is the wrapped 8th step. Both are stale-assertion fixes against correct, plan-mandated production behavior — the gate code itself is unchanged.
- **Files modified:** `tests/services/background.forResponse.stepTimeout.test.js`, `tests/integration/timeout-logging.test.js`
- **Commit:** `93bed48`

**2. [Plan deviation - test mock completeness] EOM integration test config mock**
- **Found during:** Task 2 first test run.
- **Issue:** The plan's prescribed config mock for `eom-dispatch.test.js` omitted `config.app.defaultAddress`, which `PortalOC_Creator.js` (transitively required by `background.js`) reads at module load — causing a `TypeError: Cannot read properties of undefined (reading 'city')` and a suite-load failure.
- **Fix:** Added `defaultAddress: {...}` and `addressIdentifiersSkip: []` to the test's `app` config mock. The plan also recommended mocking `nodemailer` directly, but `sendOperatorReport`/`sendAdminAlert` swallow SMTP errors internally — so a nodemailer rejection cannot drive `dispatchEomIfDue`'s failure branch. The test instead mocks `EmailSender` and `AdminEmailSender` directly, which is the correct seam to exercise the success/failure paths.
- **Files modified:** `tests/integration/eom-dispatch.test.js`
- **Commit:** `93bed48`

## Verification

- `node -c src/background.js` — SYNTAX OK.
- `npx jest tests/integration/eom-dispatch.test.js` — 3/3 pass.
- `npx jest tests/integration/timeout-logging.test.js tests/services/background.forResponse.stepTimeout.test.js` — 18/18 pass (both restored).
- `npm test` — 6 failed suites / 7 failed tests, identical to the documented pre-existing baseline (CLAUDE.md §6 #3). Passed count grew 456 → 461 (+3 new EOM tests, +2 restored stepTimeout tests).
- Defense-in-depth invariant intact: the EOM step is wrapped in `withStepTimeout(..., config.schedule.stepTimeoutMs, ...)` — bounded by the 5-min step tier, does not push past `child` or `lock` tiers (CLAUDE.md §9).
- Always-on (CLAUDE.md §3): the gate adds no `setInterval`/`setTimeout`/listener/module-scope `Map`/`Set` — it runs inline within the existing cron tick using only stack-local variables.
- HANDOFF.md §1: no third-party names in `background.js` (`grep -ci tersoft` → 0).

## Known Stubs

None. The EOM data queries (`buildEomDataQuery`) are fully wired against the live `fesa.*` control tables and tenant DBs; the gate composes the Wave 1 helpers in the production path.

## Self-Check: PASSED

- `src/background.js` — FOUND, syntax OK, gate at line 45 before tenant loop at line 69.
- `tests/integration/eom-dispatch.test.js` — FOUND, 3/3 tests pass.
- Commit `6dbcadc` (feat 20-07 gate) — FOUND in git log.
- Commit `93bed48` (test 20-07) — FOUND in git log.
