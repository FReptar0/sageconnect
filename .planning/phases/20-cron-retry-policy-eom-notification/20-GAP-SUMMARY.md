# Phase 20 — Gap Closure Summary

**Date:** 2026-05-15
**Trigger:** `/gsd-verify-work` returned PASS-WITH-NOTES (`20-VERIFICATION.md`) with 2 gaps.
**Scope:** Post-verification fixes on `master`. Not a numbered plan. Both gaps closed.

---

## Gap 1 — RETRY-02 AUDTDATE type mismatch (functional bug)

**Commit:** `a3f0434` — `fix(20): wrap P.AUDTDATE in CONVERT for payment cron scope filter`

### Problem

`PortalPaymentController.js` line 71 called `buildScopeWhere(config.retry, { dateField: 'P.AUDTDATE' })`,
emitting `P.AUDTDATE >= DATEFROMPARTS(...) AND P.AUDTDATE < DATEADD(month, 1, ...)`.

`P.AUDTDATE` is a Sage 300 **integer** in YYYYMMDD form (e.g. `20260515`); the
right-hand side is a SQL `date`. SQL Server resolves `int >= date` by converting
the integer as a day-offset from 1900-01-01 — `20260515` days is far out of range —
so the payment query would error on every cron tick. The PO controller was
unaffected (it compares against a real date column).

### Fix

Changed the `dateField` argument to the CONVERT expression already used elsewhere
in the same query (lines 52 and 92):

```js
buildScopeWhere(config.retry, { dateField: 'CONVERT(Date, CONVERT(VARCHAR(8), P.AUDTDATE))' })
```

The emitted WHERE is now date-vs-date for both scope branches:
- `current_month` → `CONVERT(...) >= DATEFROMPARTS(...) AND CONVERT(...) < DATEADD(month, 1, ...)`
- `last_n_days` → `CONVERT(...) >= DATEADD(day, -N, CAST(GETDATE() AS DATE))`

`RetryPolicy.js` was **not** modified — the helper was correct (its JSDoc explicitly
supports a qualified expression as `dateField`); only the caller's argument was wrong.

### Files modified

- `src/controller/PortalPaymentController.js` — line 71 `dateField` argument.
- `tests/controller/PortalPaymentController.cron-where.test.js` — added a regression
  assertion: the built SQL must contain `CONVERT(Date, CONVERT(VARCHAR(8), P.AUDTDATE))`
  and must NOT contain a bare `P.AUDTDATE >= DATEFROMPARTS`. This is the SQL-shape
  guard that would have caught the bug (mocked-runQuery tests cannot catch SQL
  type errors but can assert query shape).

### Verification

- `node -c src/controller/PortalPaymentController.js` → SYNTAX OK.
- `npx jest PortalPaymentController.cron-where.test.js` → 3/3 pass, incl. new assertion.

### Note for UAT

The live Sage 300 confirmation flagged in `20-VERIFICATION.md` (human-verification
item 1) still applies: confirm against real data that a payment with AUDTDATE on
the 1st of the current month is returned. The fix makes the comparison type-correct;
real-data confirmation remains a prod-only check.

---

## Gap 2 — ROADMAP SC4 observability log line (minor)

**Commit:** `6a0b840` — `feat(20): add [CRON] retry-scope log line to both cron controllers`

### Problem

ROADMAP Success Criterion 4 names a per-tick log line
`[CRON] retry-scope=... window=...` so operators can confirm a `RETRY_SCOPE`
env change took effect. No such line existed anywhere in `src/`.

### Fix

Added one info-level `logGenerator` line per controller per run, immediately
after the existing `[BACKOFF]` summary line:

```
[CRON] retry-scope=${config.retry.scope} window=${retryWindow}
```

`retryWindow` is a human-readable description derived inline from `config.retry`:
`current calendar month` for `current_month`, `last N days` for `last_n_days`.

### Files modified

- `src/controller/PortalOC_Creator.js` — `[CRON]` line in `createPurchaseOrders`.
- `src/controller/PortalPaymentController.js` — `[CRON]` line in `uploadPayments`.

### Always-on compliance (CLAUDE.md §3)

No new module-scope state. The window string is computed inline per run; no
timer, listener, or `Map`/`Set` added.

### Verification

- `node -c` on both controllers → SYNTAX OK.
- `npx jest` on both `.cron-where` suites → 6/6 pass.

---

## Constraint compliance (both gaps)

| Constraint | Status |
|-----------|--------|
| CLAUDE.md §6 #1 — template-literal SQL preserved, no parameterized queries | PASS |
| CLAUDE.md §6 #2 — existing `runQuery` explicit `db` args unchanged; no new `runQuery` calls | PASS |
| CLAUDE.md §3 — no new module-scope state / timer / listener | PASS |
| HANDOFF.md §1 — no third-party names in code or commit messages | PASS |
| Untouched: 60-min antiquity filter, POSTED dedupe, INSERT blocks | PASS |

## Test gate

- `node -c` both controllers → SYNTAX OK.
- `npx jest PortalPaymentController.cron-where PortalOC_Creator.cron-where` → 6/6 pass
  (incl. the new Gap 1 regression assertion).
- `npm test` → 6 failed suites / 7 failed tests / 466 passed — **identical to the
  documented baseline** (`20-VERIFICATION.md` line 113; CLAUDE.md §6 #3). No
  regressions introduced.

## Commits

| Gap | Commit | Message |
|-----|--------|---------|
| 1 | `a3f0434` | fix(20): wrap P.AUDTDATE in CONVERT for payment cron scope filter |
| 2 | `6a0b840` | feat(20): add [CRON] retry-scope log line to both cron controllers |
