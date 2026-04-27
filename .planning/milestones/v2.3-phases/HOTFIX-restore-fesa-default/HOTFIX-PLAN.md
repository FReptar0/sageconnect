---
type: hotfix
milestone: v2.3
discovered_during: production validation after PR #16 (SQL pool context leak fix), 2026-04-27
severity: high
subsystem: data-access
tags: [mssql, runQuery, regression, fesaParam, control-tables]
status: in_progress

# Discovery
reported_by: production logs from cron tick after PR #16 deploy
diagnosed_via: |
  Production logs showed:
    [ERROR] Error ejecutando consultas SQL para UUID ...: Invalid object name 'fesaParam'.
  These errors did NOT exist before PR #16. The `fesaParam` table lives in the
  FESA control database, not in COPDAT. Code inspection found 7 call sites of
  `runQuery(query)` (no second argument) where the query references unqualified
  FESA tables (`fesaParam`, `FESAPARAM`).

# Files
affected:
  - src/utils/GetTypesCFDI.js (lines 83, 147, 239, 339)
  - src/controller/CFDI_Downloader.js (line 167)
  - src/controller/SagePaymentController.js (lines 56, 75)
---

# HOTFIX: Restore FESA Default for Control-Table Queries

## Root Cause (Regression from PR #16)

PR #16 changed the default value of `runQuery`'s `database` parameter from the literal `'FESA'` to `config.database.database`. On the Capstone Copper server `DATABASE=COPDAT`, so the default became `'COPDAT'`.

**The reasoning was correct in isolation** (a default that follows the configured value is more flexible), but it ignored that **7 existing call sites were silently relying on the old `'FESA'` default**. These callers issue queries against unqualified FESA tables (e.g. `SELECT ... FROM fesaParam ...`) — they never passed an explicit database because they assumed the default was always `'FESA'`.

After PR #16:
- `runQuery(rfcQuery)` → defaults to `'COPDAT'` → prepends `USE [COPDAT]; SELECT ... FROM fesaParam` → fails with `Invalid object name 'fesaParam'`

The pool-context-leak bug is fixed (different problem, real fix), but PR #16 introduced this regression in the same change.

## Fix

Make the 7 affected call sites pass `'FESA'` explicitly. This restores the pre-#16 behavior **for those specific call sites only** — without reverting the (correct) "always prepend USE" change in `runQuery` itself.

### Affected sites

| File | Line | Query target |
|---|---|---|
| `src/utils/GetTypesCFDI.js` | 83 | `fesaParam` (RFC validation, type P) |
| `src/utils/GetTypesCFDI.js` | 147 | `fesaParam` (RFC validation, type I) |
| `src/utils/GetTypesCFDI.js` | 239 | `fesaParam` (RFC validation, type E) |
| `src/utils/GetTypesCFDI.js` | 339 | `fesaParam` (RFC validation, type N) |
| `src/controller/CFDI_Downloader.js` | 167 | `FESAPARAM` (idCia / database resolution) |
| `src/controller/SagePaymentController.js` | 56 | `FESAPARAM` (idCia lookup) |
| `src/controller/SagePaymentController.js` | 75 | `fesaParam` (optional fields lookup) |

All change from `runQuery(query)` → `runQuery(query, 'FESA')`.

### What stays as-is

- `src/utils/SQLServerConnection.js` `runQuery` — default param remains `config.database.database`. The "always prepend USE" behavior from PR #16 is correct and stays.
- 2 callers using absolute paths (`PortalPaymentController.js:153`, `:323`) reference `fesa.dbo.fesaPagosFocaltec` with full qualification — they work either way.

## Why not revert PR #16 default?

Two options were considered:
- **A. Revert `runQuery` default to literal `'FESA'`** — Restores pre-#16 implicit behavior but propagates the same hidden-default smell. New callers might now silently target FESA when they shouldn't.
- **B. Make all current FESA callers explicit (this PR)** — Behavior at each site is visible in code. Future readers don't have to guess what database a query targets. **Chosen.**

Option B is more defensive: the contract `runQuery(query, database)` is now genuinely "tell me which DB to run against" — no ambiguity.

## Tests

The existing `tests/SQLServerConnection.test.js` (regression test added in PR #16) still passes — it asserts the always-prepend-USE behavior. No new tests added for this hotfix because:
- The change is per-call-site (`'FESA'` argument added)
- Behavior is verified by the existing FESA-prepend-USE test
- Production observation (the original errors disappear after deploy) is the validation

## Validation

1. `npx jest tests/SQLServerConnection.test.js` — passes (7/7)
2. Full suite: same 4 pre-existing failures as master, no new failures
3. Post-deploy on prod:
   - Watch logs for "Invalid object name 'fesaParam'" — should disappear
   - Watch logs for cron tick completion — should now show CFDIs being processed instead of UUID error spam

## Deployment

Standard flow:
1. Merge PR `hotfix/restore-fesa-default-for-control-queries` into `master`
2. GH Action `obfuscate-deploy.yml` publishes to `sageconnect-dist`
3. On ZCL-RDS-02:
   ```powershell
   Stop-Service SageConnect
   cd E:\sageconnect-dist
   git fetch && git reset --hard origin/master
   npm install --omit=dev
   Start-Service SageConnect
   ```
4. Tail logs and confirm next cron tick runs without `Invalid object name 'fesaParam'`
