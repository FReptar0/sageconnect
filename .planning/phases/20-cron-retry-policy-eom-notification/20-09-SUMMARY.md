---
phase: 20-cron-retry-policy-eom-notification
plan: 09
subsystem: operator-scripts
tags: [retry-policy, operator-tooling, dry-run, cli]
requires: [20-02, 20-05, 20-06]
provides:
  - "src/scripts/retry-month-pos.js — operator sweep tool for pending POs (dry-run / --apply)"
  - "src/scripts/retry-month-payments.js — operator sweep tool for pending payments (dry-run / --apply)"
affects: []
tech-stack:
  added: []
  patterns:
    - "Convention A: default --dry-run, --apply opt-in (HANDOFF.md §6)"
    - "Console → winston interceptor for full output capture"
    - "Controller delegation on --apply (single execution path, no operator/cron divergence)"
key-files:
  created:
    - src/scripts/retry-month-pos.js
    - src/scripts/retry-month-payments.js
    - tests/scripts/retry-month-pos.test.js
    - tests/scripts/retry-month-payments.test.js
  modified: []
decisions:
  - "Scripts reuse RetryPolicy.js helpers verbatim — no copy-paste SQL or backoff formula (CONTEXT D-05 single source of truth)"
  - "--apply delegates to createPurchaseOrders / uploadPayments — the SAME fns the cron uses; scripts contain no mutating SQL"
  - "retry-month-payments.js preserves the 60-min antiquity filter (REQ RETRY-02 boundary) and uses dbColumn='idCia' for fesaPagosFocaltec"
metrics:
  duration: ~12m
  completed: 2026-05-15
---

# Phase 20 Plan 09: Retry-Month Operator Scripts Summary

Two operator CLI tools — `retry-month-pos.js` and `retry-month-payments.js` — that preview (default `--dry-run`) or drain (`--apply`) the new cron retry backlog using the same RetryPolicy helpers and controller functions as the Wave 2 cron path.

## What Was Built

- **`src/scripts/retry-month-pos.js`** — sweeps pending POs in the configured retry scope, prints an aligned table (PO, tenant, fechaAuth, errorCount, nextEligibleAt, verdict), logs each row via `logGenerator('RetryMonthPOs', ...)` with `[DRY-RUN]`/`[APPLY]` prefix. On `--apply`, calls `createPurchaseOrders(tenantIndex)` per tenant.
- **`src/scripts/retry-month-payments.js`** — same shape for payments. Uses `dbColumn: 'idCia'` for `fesaPagosFocaltec`, preserves the 60-min antiquity filter (REQ RETRY-02 boundary). On `--apply`, calls `uploadPayments(tenantIndex)` per tenant.
- **`tests/scripts/retry-month-pos.test.js`** (3 tests) + **`tests/scripts/retry-month-payments.test.js`** (2 tests) — smoke tests asserting dry-run vs apply paths, `data.mode` field, controller delegation, and SQL filter preservation (`>= 60`, `idCia`, sargable scope).

Both scripts: default `--dry-run`, `--apply` opt-in; reuse `buildScopeWhere` / `buildErrorStatsApply` / `computeBackoffWaitMinutes` (no copy-paste); return a `ResultEnvelope` with `data.mode`; contain no mutating SQL (mutation lives only in the delegated controllers).

## Deviations from Plan

None — plan executed exactly as written. The plan's Step 2 imports `errorResult` from `ResultEnvelope`; it is unused in the final scripts but kept verbatim per the plan's explicit code block (harmless, no lint configured per CLAUDE.md §5).

## Tasks & Commits

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Create src/scripts/retry-month-pos.js | 5943f16 |
| 2 | Create src/scripts/retry-month-payments.js | 941d476 |
| 3 | Create smoke tests | ea11044 |

## Verification

- `node -c src/scripts/retry-month-pos.js` / `retry-month-payments.js` → SYNTAX OK
- No raw `INSERT/UPDATE/DELETE` in either script (0 matches) — mutation only via controller delegation
- `retry-month-payments.js`: `dbColumn: 'idCia'` (1 match), `>= 60` antiquity filter (1 match)
- New smoke tests: 5 passed / 5 total
- `npm test`: 6 failed suites / 7 failed tests (pre-existing baseline unchanged), 466 passed (up from 461 — +5 new tests)

## Self-Check: PASSED

- FOUND: src/scripts/retry-month-pos.js
- FOUND: src/scripts/retry-month-payments.js
- FOUND: tests/scripts/retry-month-pos.test.js
- FOUND: tests/scripts/retry-month-payments.test.js
- FOUND: commit 5943f16
- FOUND: commit 941d476
- FOUND: commit ea11044
