---
phase: 20-cron-retry-policy-eom-notification
plan: 05
subsystem: po-cron-uploader
tags: [cron, retry-policy, backoff, posted-dedupe, sql-rewrite]
requires:
  - "config.retry.{scope, lookbackDays, backoff.{initialMin, multiplier, maxMin}} (20-01)"
  - "src/utils/RetryPolicy.js — buildScopeWhere, buildErrorStatsApply, computeBackoffWaitMinutes (20-02)"
provides:
  - "PortalOC_Creator.js cron WHERE with configurable scope + exponential backoff + WHERE-level POSTED dedupe"
  - "[BACKOFF-DEFER] per-row + [BACKOFF] per-tick log lines for operator observability"
affects:
  - "Wave 2 po-cron-diagnostic (20-08) — Section 4 must mirror this rewritten WHERE"
  - "Wave 3 retry-month scripts (20-09) — reuse same RetryPolicy helpers for cron parity"
tech-stack:
  added: []
  patterns:
    - "JS post-filter for backoff math (D-01 — single source of truth via computeBackoffWaitMinutes)"
    - "OUTER APPLY cross-DB error-stats fragment built by RetryPolicy.buildErrorStatsApply (D-02/D-05)"
    - "WHERE-level NOT EXISTS POSTED dedupe replacing per-PO loop check (D-03/RETRY-06)"
key-files:
  created:
    - "tests/controller/PortalOC_Creator.cron-where.test.js"
  modified:
    - "src/controller/PortalOC_Creator.js"
decisions:
  - "buildScopeWhere called with dateField option (not dateColumn) — confirmed by reading RetryPolicy.js signature (D-discretion #1)"
  - "buildErrorStatsApply uses dbColumn 'idDatabase' for POs (idCia is the payment table) — passed explicitly"
  - "In-loop POSTED check (was a SELECT round-trip per PO) removed; the 3 INSERT blocks preserved verbatim"
metrics:
  duration: "~10 min"
  completed: "2026-05-15"
  tasks: 2
  files: 2
---

# Phase 20 Plan 05: PortalOC_Creator Cron WHERE Rewrite Summary

Rewrote the PO cron uploader WHERE in `src/controller/PortalOC_Creator.js` to combine three RETRY changes: a configurable scope filter (RETRY-01) replacing the `MAX(Autoriza_OC_detalle.Fecha) = CAST(GETDATE() AS DATE)` daily-window blind spot, an OUTER APPLY pulling per-row `errorCount`/`lastErrorAt` for exponential backoff (RETRY-04), and a WHERE-level `NOT EXISTS` POSTED dedupe (RETRY-06). A JS post-filter applies `computeBackoffWaitMinutes` to defer ERROR rows still inside their backoff window. The redundant in-loop POSTED check was removed — POSTED is now caught before the upload loop, eliminating one FESA round-trip per PO. This is the Wave 2 application of the Wave 1 `RetryPolicy.js` helpers (20-02) and `config.retry` envs (20-01); it fixes the daily-window blind spot that excluded `PO0083449` from 2026-05-08 onward (verified in prod 2026-05-12).

## What Was Built

### Task 1 — WHERE rewrite + JS post-filter + remove in-loop POSTED check (commit df5ad2d)
- Added `require('../utils/RetryPolicy')` import (buildScopeWhere, buildErrorStatsApply, computeBackoffWaitMinutes) adjacent to existing utility imports.
- Inserted `buildErrorStatsApply(...)` OUTER APPLY after the last `left outer join`, before `where` — adds `ef.errorCount` + `ef.lastErrorAt` to every recordset row. Used `dbColumn: 'idDatabase'` (POs), `joinColumn: 'ocSage'`, `joinKey: 'A.PONUMBER'`.
- Replaced the `MAX(Fecha) = CAST(GETDATE() AS DATE)` equality with `buildScopeWhere(config.retry, { dateField: '(SELECT MAX(Fecha) FROM ...)' })` — sargable `current_month` / `last_n_days` scope.
- Added `AND NOT EXISTS (SELECT 1 FROM fesa.dbo.fesaOCFocaltec WHERE ocSage = A.PONUMBER AND idDatabase = '${db}' AND status = 'POSTED')` before `${skipCondition}`.
- Added JS post-filter loop after `runQuery`: for each row with `errorCount > 0`, computes `nextEligibleAt = lastErrorAt + computeBackoffWaitMinutes(errorCount, config.retry.backoff) * 60000`; drops the row if still in the backoff window. Emits `[BACKOFF-DEFER] PO ${id} tenant=${db} attempts=${n} nextEligibleAt=${ISO}` per deferred row and a `[BACKOFF] tenant=${db} candidates=${X} deferred=${Y} processing=${Z}` summary per tick.
- Removed the in-loop `// 4.1) Comprobar si ya existe en fesaOCFocaltec` block (the SELECT + `[WARN] ya procesada (POSTED)` skip) — superseded by the WHERE-level NOT EXISTS.

### Task 2 — Integration test (commit f0ae3c8)
- New `tests/controller/PortalOC_Creator.cron-where.test.js` — 3 cases per CONTEXT D-12 Layer 2:
  - **POSTED skip**: empty recordset → no portal POST, `[BACKOFF] candidates=0 deferred=0 processing=0`.
  - **ERROR-in-backoff skip**: 1 ERROR row 5 min ago → JS post-filter defers, `[BACKOFF-DEFER] PO PO0083449 ...` + `[BACKOFF] ... deferred=1 processing=0`.
  - **ERROR-out-of-backoff include**: 1 ERROR row 20 min ago → row kept, portal POST attempted, `[BACKOFF] ... deferred=0 processing=1`.
- Config mock includes `retry` and `eom` namespaces; `runQuery`, `LogGenerator`, `PortalClient`, and transitive util imports mocked. `RetryPolicy.js` deliberately NOT mocked so tests assert the real SQL shape (OUTER APPLY, NOT EXISTS, DATEFROMPARTS).

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Note on a planning-phase grep-count estimate (not a deviation)

The Task 1 acceptance criteria estimated `grep -cE "INSERT INTO fesa\.dbo\.fesaOCFocaltec"` would return 2. The original file actually has 3 INSERT blocks (ERROR on Joi-validation fail, POSTED on success, ERROR on send fail), all preserved verbatim. The removed in-loop block was a `SELECT` POSTED *check* (the 4th FESA `runQuery`), not an INSERT. So the FESA `runQuery` count correctly dropped from 4 to 3 and all 3 INSERT blocks are intact — matching the plan's stated intent ("count of FESA calls drops from 4 to 3"). The "2" in the acceptance grep was a planning-phase miscount; no behavior was changed.

## Verification Results

- `node -c src/controller/PortalOC_Creator.js` → SYNTAX OK.
- Source assertions: RetryPolicy import (1), buildScopeWhere(config.retry) (1), buildErrorStatsApply (1), computeBackoffWaitMinutes (1), [BACKOFF-DEFER] (1), [BACKOFF] summary (1), old daily-equality `= CAST(GETDATE() AS DATE)` removed (0), in-loop POSTED check removed (0), `ya procesada (POSTED)` removed (0), `status = 'POSTED'` (1), tersoft (0).
- `npx jest tests/controller/PortalOC_Creator.cron-where.test.js` → 3/3 passed.
- `npm test` → 6 failed suites / 7 failed tests — identical to the documented pre-existing baseline (CLAUDE.md §6 #3); 455 passed (includes the 3 new tests).

## Constraint Compliance

- CLAUDE.md §3 (always-on): no new module-scope state, timer, listener, or child process — JS post-filter uses only loop-local `const`.
- CLAUDE.md §6 #1: template-literal SQL preserved; no parameterized queries introduced. Interpolated values are range-guarded envs (`config.retry.*`) and controlled tenant DB names (`databases[index]`).
- CLAUDE.md §6 #2: every `runQuery` passes `db` explicitly — `databases[index]` for the tenant-DB main query, `'FESA'` for the 3 control-table INSERTs.
- CLAUDE.md §9: no new timer; OUTER APPLY bounded by month-scope row count — defense-in-depth invariant unchanged.
- HANDOFF.md §1: no third-party names in any new comment or log line.
- HANDOFF.md §7: cron's "what to retry" view now depends on BOTH the tenant DB authorization (Autoriza_OC) AND the FESA control table (NOT EXISTS POSTED + OUTER APPLY ERROR stats) — the intended dual-source verification.

## Self-Check: PASSED
- FOUND: src/controller/PortalOC_Creator.js
- FOUND: tests/controller/PortalOC_Creator.cron-where.test.js
- FOUND commit: df5ad2d
- FOUND commit: f0ae3c8
