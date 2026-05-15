---
phase: 20-cron-retry-policy-eom-notification
plan: 06
subsystem: payment-cron-uploader
tags: [retry-policy, backoff, cron-where, payments]
requires:
  - 20-01 (config.retry.* env vars + range guards)
  - 20-02 (src/utils/RetryPolicy.js helpers)
provides:
  - PortalPaymentController cron WHERE with configurable monthly scope + exponential backoff
affects:
  - src/controller/PortalPaymentController.js
tech-stack:
  added: []
  patterns:
    - JS post-filter backoff loop (mirrors 20-05 PortalOC_Creator)
    - OUTER APPLY error-stats fragment from RetryPolicy.buildErrorStatsApply
key-files:
  created:
    - tests/controller/PortalPaymentController.cron-where.test.js
  modified:
    - src/controller/PortalPaymentController.js
decisions:
  - "OUTER APPLY uses dbColumn='idCia' — fesaPagosFocaltec uses idCia (not idDatabase) as DB discriminator"
  - "errorCount + lastErrorAt added to inner SELECT so the SELECT A.* outer wrapper exposes them to the recordset"
  - "Vestigial currentDate JS variable + getCurrentDateCompact import removed (unused after rewrite)"
metrics:
  duration: ~8m
  completed: 2026-05-15
  tasks: 2
  files: 2
---

# Phase 20 Plan 06: Payment cron WHERE retry policy Summary

Rewrote the `PortalPaymentController.js` cron WHERE — replaced the fixed `P.AUDTDATE >= ${currentDate}` lookback with a configurable monthly scope filter plus a JS exponential-backoff post-filter derived from `fesa.dbo.fesaPagosFocaltec` ERROR rows, mirroring the 20-05 PortalOC_Creator pattern.

## What Changed

**`src/controller/PortalPaymentController.js`:**
- Added `require('../utils/RetryPolicy')` import (buildScopeWhere, buildErrorStatsApply, computeBackoffWaitMinutes).
- Removed the vestigial `getCurrentDateCompact` import and the `const currentDate = getCurrentDateCompact()` declaration; adjusted the `[INICIO]` console.log accordingly.
- Inserted an `OUTER APPLY` block between `JOIN APTCR P` and the `WHERE` keyword, built by `buildErrorStatsApply` with `fesaTable: 'fesa.dbo.fesaPagosFocaltec'`, `joinColumn: 'NoPagoSage'`, `joinKey: 'P.DOCNBR'`, `dbAlias: database[index]`, **`dbColumn: 'idCia'`**.
- Added `ef.errorCount` and `ef.lastErrorAt` to the inner SELECT list so the `SELECT A.* FROM (...) AS A` outer wrapper exposes them on every recordset row.
- Replaced `AND P.AUDTDATE >= ${currentDate}` with `AND ${buildScopeWhere(config.retry, { dateField: 'P.AUDTDATE' })}`.
- Inserted a JS post-filter loop after `runQuery` — defers rows whose `errorCount > 0` and `lastErrorAt + computeBackoffWaitMinutes(...)` is still in the future; emits per-row `[BACKOFF-DEFER] Pago ...` and a rolled-up `[BACKOFF] tenant=... candidates/deferred/processing` summary.
- Preserved verbatim: 60-min antiquity filter, NOT IN POSTED dedupe, NOT IN APPYM clearance check, all SELECT columns, JOINs, per-payment loop, control-table INSERT.

**`tests/controller/PortalPaymentController.cron-where.test.js` (new):**
- 3 integration tests with mocked `runQuery` per CONTEXT D-12 Layer 2: POSTED skip (empty recordset), ERROR-in-backoff defer (5 min ago), ERROR-out-of-backoff include (20 min ago).
- Each test asserts OUTER APPLY + sargable scope + `idCia` discriminator + `>= 60` antiquity filter + `NOT IN ( SELECT NoPagoSage` dedupe are present in the SQL string.

## Deviations from Plan

**1. [Rule 2 - Missing critical functionality] Added `ef.errorCount` / `ef.lastErrorAt` to the inner SELECT.**
- **Found during:** Task 1.
- **Issue:** The plan's `buildErrorStatsApply` interpolation adds the OUTER APPLY `ef` alias, but `PortalPaymentController`'s query is `SELECT A.* FROM (SELECT ... ) AS A` — the OUTER APPLY columns are only visible if the inner SELECT projects them. Without this, `row.errorCount` / `row.lastErrorAt` would always be `undefined` and the backoff post-filter would be a no-op.
- **Fix:** Added `ef.errorCount AS errorCount, ef.lastErrorAt AS lastErrorAt` to the inner SELECT list (after `DIFERENCIA_MINUTOS`). The OUTER APPLY is on the inner query's FROM clause, so `ef` is in scope there.
- **Files modified:** src/controller/PortalPaymentController.js
- **Commit:** 18d1900

## Verification

- `node -c src/controller/PortalPaymentController.js` — SYNTAX OK.
- `npx jest tests/controller/PortalPaymentController.cron-where.test.js` — 3/3 tests pass.
- `npm test` — 6 failed suites / 7 failed tests — matches the documented pre-existing baseline (CLAUDE.md §6 #3) exactly; passed count grew from 455 to 458 (the 3 new tests).
- All Task 1 + Task 2 source assertions confirmed: RetryPolicy import present, `dbColumn: 'idCia'`, `joinColumn: 'NoPagoSage'`, `joinKey: 'P.DOCNBR'`, old `${currentDate}` lookback removed, vestigial declaration removed, `>= 60` preserved, NOT IN POSTED dedupe preserved, no third-party names.

## Commits

- `18d1900` — feat(20-06): rewrite payment cron WHERE with scope filter + backoff
- `b6bda1b` — test(20-06): add cron WHERE rewrite integration tests for payments

## Self-Check: PASSED
- src/controller/PortalPaymentController.js — FOUND
- tests/controller/PortalPaymentController.cron-where.test.js — FOUND
- Commit 18d1900 — FOUND
- Commit b6bda1b — FOUND
