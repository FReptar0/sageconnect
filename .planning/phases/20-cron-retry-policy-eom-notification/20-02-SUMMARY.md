---
phase: 20-cron-retry-policy-eom-notification
plan: 02
subsystem: testing
tags: [retry-policy, backoff, sql-builder, pure-helpers, jest]

# Dependency graph
requires:
  - phase: 20-01
    provides: config.retry.backoff.* + config.retry.scope namespaces (range-guarded at boot)
provides:
  - src/utils/RetryPolicy.js — 3 pure helpers (computeBackoffWaitMinutes, buildScopeWhere, buildErrorStatsApply)
  - Single source of truth for backoff math + scope-WHERE SQL + OUTER APPLY error-stats fragment
affects: [20-04 PortalOC_Creator WHERE rewrite, 20-05 PortalPaymentController WHERE rewrite, 20-06 po-cron-diagnostic, 20-08/20-09 retry-month operator scripts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-helper SQL builder module — no module-scope state, no I/O, no logging (CLAUDE.md §3 clean)"
    - "Defensive input validation returns safe values, never throws (except programmer-error scope fallthrough)"

key-files:
  created:
    - src/utils/RetryPolicy.js
    - tests/utils/RetryPolicy.test.js
  modified: []

key-decisions:
  - "Helpers kept fully pure — no require('../config'); callers always pass config explicitly (CONTEXT D-Discretion #4 recommended path, preserves test isolation)"
  - "buildErrorStatsApply takes explicit joinColumn param (default 'ocSage') rather than deriving it from dbColumn — clearer; both controllers pass it explicitly"
  - "Internal DEFAULT_* constants (15/2/1440) mirror customer-confirmed curve as defensive fallback for malformed backoffConfig members"

patterns-established:
  - "RetryPolicy.js module shape mirrors src/utils/duration.js — file-header REQ refs, JSDoc per export, multi-export, defensive validation"

requirements-completed: [RETRY-04, RETRY-05]

# Metrics
duration: 8min
completed: 2026-05-15
---

# Phase 20 Plan 02: RetryPolicy Pure Helpers Summary

**Created `src/utils/RetryPolicy.js` — 3 stateless helpers (geometric-backoff math, sargable scope-WHERE SQL, OUTER APPLY error-stats fragment) — as the single source of truth shared by the Wave 2 controllers, the diagnostic script, and the Wave 3 operator scripts.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-15T22:00:00Z (approx)
- **Completed:** 2026-05-15T22:08:00Z (approx)
- **Tasks:** 2 completed
- **Files modified:** 2 created (1 module + 1 test file)

## Accomplishments

- **`computeBackoffWaitMinutes(errorCount, backoffConfig)`** — geometric backoff `initialMin * multiplier^(n-1)` capped at `maxMin`. Returns the customer-confirmed canonical curve `0, 15, 30, 60, 120, 240, 480, 960, 1440` (and 1440 thereafter). Defensive: non-finite/negative `errorCount` → 0; missing/invalid `backoffConfig` members fall back to module defaults; never throws.
- **`buildScopeWhere(scopeConfig, options)`** — sargable SQL fragment. `current_month` → `DATEFROMPARTS(...)` lower bound + `DATEADD(month, 1, ...)` exclusive upper bound. `last_n_days` → `DATEADD(day, -N, CAST(GETDATE() AS DATE))`. `options.dateField` lets callers override the column (`'Fecha'` default for POs, `'P.AUDTDATE'` for payments). Invalid scope throws (defense-in-depth past the 20-01 boot guard).
- **`buildErrorStatsApply({fesaTable, joinColumn, joinKey, dbAlias, dbColumn})`** — `OUTER APPLY (...) AS ef` fragment counting ERROR rows. `dbColumn` defaults to `'idDatabase'` (POs); payments pass `'idCia'`. `joinColumn` defaults to `'ocSage'`; payments pass `'NoPagoSage'`. Fixed alias `ef` per D-05.
- **11 unit tests** in `tests/utils/RetryPolicy.test.js` across 3 `describe` blocks — canonical curve, cap, defensive input, custom config, both scope branches with custom dateField, invalid-scope throw, and both POs/payments field-name cases.

## Deviations from Plan

None — plan executed exactly as written.

## Authentication Gates

None.

## Verification

- `node -c src/utils/RetryPolicy.js` — syntax OK.
- Inline `node -e` probes: curve, current_month scope, last_n_days scope, OUTER APPLY shape — all returned "OK".
- `npx jest tests/utils/RetryPolicy.test.js` — 11/11 tests passing.
- `npm test` — 6 failed suites / 7 failed tests (pre-existing baseline unchanged); 429 passed (418 baseline + 11 new). The new test file added cleanly with no regressions.

## Notes for Downstream Plans

- Wave 2 controllers (20-04 PortalOC_Creator, 20-05 PortalPaymentController) consume all 3 helpers via `require('../utils/RetryPolicy')`. They MUST pass `config.retry` / `config.retry.backoff` explicitly — the helpers do not read config themselves.
- `buildScopeWhere` payment callers pass `options.dateField: 'P.AUDTDATE'` (verify exact authorization-date column in the 20-05 plan).
- `buildErrorStatsApply` payment callers pass `joinColumn: 'NoPagoSage'` and `dbColumn: 'idCia'` — POs use the `'ocSage'` / `'idDatabase'` defaults.

## Commits

- `f303c74` feat(20-02): add RetryPolicy.js pure helpers for cron retry policy
- `2782a4f` test(20-02): add RetryPolicy.test.js — 11 tests across 3 helpers

## Self-Check: PASSED

- `src/utils/RetryPolicy.js` — FOUND
- `tests/utils/RetryPolicy.test.js` — FOUND
- Commit `f303c74` — FOUND
- Commit `2782a4f` — FOUND
