---
type: hotfix
milestone: v2.3
discovered_during: production deployment of Phase 17 + EMFILE hotfix (2026-04-27)
severity: high
subsystem: data-access
tags: [mssql, pool, context-leak, runQuery, USE]
status: in_progress

# Discovery
reported_by: production logs (ZCL-RDS-02 / Capstone Copper) — "Invalid object name 'dbo.APBTA'"
diagnosed_via: src/scripts/diagnose-sage-tables.js (PR #15)
diagnostic_evidence: |
  Script confirmed that:
    - COPDAT exists, is ONLINE, and has all Sage tables with expected row counts
      (APBTA: 9482, POPORH1: 79193, APVENO: 23362, BKACCT: 19, APTCR: 75103)
    - Login `sage` is mapped as `dbo` in COPDAT
    - INFORMATION_SCHEMA.TABLES queried via runQuery(query, 'COPDAT') returned EMPTY
      while SELECT COUNT(*) FROM [COPDAT].dbo.[APBTA] returned 9482
    - The contradiction proves the session was NOT in COPDAT context when the
      INFORMATION_SCHEMA query ran, even though 'COPDAT' was the explicit DB arg

# Files
affected:
  - src/utils/SQLServerConnection.js
  - tests/SQLServerConnection.test.js
---

# HOTFIX: SQL Pool Context Leak (`runQuery` does not always prepend USE)

## Root Cause

`src/utils/SQLServerConnection.js` `runQuery` has two latent bugs that compound under pool reuse:

```js
async function runQuery(query, database = 'FESA') {
    const pool = await getPool();
    const request = pool.request();

    const fullQuery = database !== config.database.database
        ? `USE [${database}]; ${query}`
        : query;

    return request.query(fullQuery);
}
```

### Bug 1 — Hardcoded default `'FESA'`
The default value is the literal string `'FESA'`, not `config.database.database`. On the Capstone Copper server `DATABASE=COPDAT`, so any caller that omits the `database` argument silently runs against FESA via the conditional below. (`PortalPaymentController.js:153` is one such caller — its query uses an absolute path `fesa.dbo.fesaPagosFocaltec` so it works by accident, but the default is still wrong.)

### Bug 2 — Conditional `USE` skips the DB that matches `config.database.database`
The optimization "skip USE when the requested DB equals the config default" assumes each pool connection always sits in the config default DB. **That assumption is false in mssql/tedious connection pools:** when a connection executes `USE [otherDB]`, the connection retains that context after the request completes. The pool then reuses that connection for the next request.

Concrete failure sequence in production:
1. Pool connects. Initial connection context = COPDAT (from `poolConfig.database`).
2. `runQuery(sql, 'FESA')` is called (e.g., `PortalOC_Creator.js:223`). Since `'FESA' !== 'COPDAT'` it prepends `USE [FESA]; …`. **Connection now sits in FESA.**
3. Next call: `runQuery(sql, 'COPDAT')` (e.g., `PortalOC_Creator.js:192`). Since `'COPDAT' === 'COPDAT'` it skips `USE`. Query executes against the connection's current context — **FESA, not COPDAT**.
4. Sage tables (`APBTA`, `POPORH1`, etc.) don't exist in FESA → `Invalid object name 'dbo.APBTA'`.

The bug is **asymmetric and intermittent**:
- Asymmetric: only affects queries to the DB matching `config.database.database`.
- Intermittent: depends on which connection the pool hands out (clean → works, contaminated → fails). Explains why the bug is hard to reproduce locally and only surfaces at sustained load.

## Fix

```js
async function runQuery(query, database = config.database.database) {
    const pool = await getPool();
    const request = pool.request();
    const fullQuery = `USE [${database}]; ${query}`;
    return request.query(fullQuery);
}
```

Two changes:
1. **Default param** — now resolves to the configured default at runtime, not a literal string.
2. **Always prepend `USE [database]`** — guarantees a clean context per request, regardless of which connection the pool returns.

Cost: each request runs an extra `USE [DB]` statement. Sub-millisecond, irrelevant given query latency.

## Caller Impact

All existing call sites continue to work:
- `runQuery(sql, 'COPDAT')` — now reliably runs in COPDAT (was the broken case).
- `runQuery(sql, 'FESA')` — unchanged behavior (was already prepending USE).
- `runQuery(sql)` — now defaults to `config.database.database` instead of literal `'FESA'`. Reviewed: only `PortalPaymentController.js:153` uses this form, and its query uses absolute path `fesa.dbo.fesaPagosFocaltec`, so it is unaffected.

No call-site changes required.

## Test Updates

`tests/SQLServerConnection.test.js` has two existing tests that **encode the bug as the spec**:
- Line 86–92: `runQuery with default database does NOT prepend USE prefix` — must be flipped.
- Line 115–131: `runQuery signature accepts (query, database="FESA")` — must be updated to expect `USE [FESA]; …` for both variants.

Add one **regression test** that exercises the exact failure mode the script revealed:
> After `runQuery(sql, 'FESA')` runs, a subsequent `runQuery(sql, 'COPDAT')` must still emit `USE [COPDAT]; …` to the pool — proving context is reset every call.

## Validation

1. `npm test -- tests/SQLServerConnection.test.js` — all updated tests pass, new regression test passes.
2. `npm test` — full suite green (no other tests depend on the old behavior).
3. Post-deploy on prod: re-run `node src/scripts/diagnose-sage-tables.js`. Chequeo 4 (INFORMATION_SCHEMA) should now find APBTA, POPORH1, etc.
4. Operational: monitor logs for "Invalid object name" — should disappear after restart.

## Deployment

Standard flow:
1. Merge PR `hotfix/sql-pool-context-leak` into `master`.
2. GH Action `obfuscate-deploy.yml` publishes to `sageconnect-dist`.
3. On ZCL-RDS-02:
   ```bash
   Stop-Service sageconnect
   cd /e/sageconnect-dist
   git fetch && git reset --hard origin/master
   npm install --omit=dev
   Start-Service sageconnect
   ```
4. Watch first cycle in `/schedule.html` — should complete without 409s and without "Invalid object name" log lines.
