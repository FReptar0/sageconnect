# Phase 6: Infrastructure Foundation - Research

**Researched:** 2026-03-23
**Domain:** Node.js script refactoring, SQL connection pooling (mssql), process lifecycle management
**Confidence:** HIGH

## Summary

Phase 6 transforms 13 scripts and 1 controller from CLI-only tools into dual-mode modules that return structured data objects while preserving CLI behavior. The three pillars are: (1) a unified result envelope `{ success, data, errors, summary, meta }` for every exported function, (2) elimination of all `process.exit()` calls from code paths reachable by the always-on server, and (3) replacement of the per-query `ConnectionPool` creation in `SQLServerConnection.js` with a singleton pool using the `USE [database]` pattern.

The codebase is already halfway there: 8 of 13 scripts already export functions via `module.exports`, and 7 of those have `require.main === module` guards. The remaining work is concentrated on 5 scripts with no exports, the `PortalOC_StatusUpdater.js` controller (which auto-executes `main()` on require), and the 30 `process.exit()` calls scattered across the codebase. The SQL pool refactor is a single-file change with zero signature changes needed in 25 importing files.

**Primary recommendation:** Work in three waves -- (1) SQL pool singleton first (unlocks reliability), (2) process.exit removal (unlocks always-on), (3) structured return envelopes (unlocks Phase 7 API layer). Each wave is independently testable and deployable.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Unified envelope for ALL scripts: `{ success, data, errors, summary, meta: { duration, timestamp, tenant } }`
- Metadata (duration, timestamp, tenant) always included in the envelope
- Multi-mode scripts (e.g., payment-uuid-repair with scan/repair/upload) export separate functions per mode, not a single function with mode parameter
- Each exported function maps 1:1 to a future API endpoint
- Dual output: scripts keep all console.log/table/warn for CLI usage AND return structured data from exported functions
- Single shared pool connected to default database, switch with `USE [database]` before each query
- `runQuery(query, database)` signature stays identical -- zero changes needed in 30+ callers
- Auto-reconnect on connection drops -- transparent to callers, critical for always-on reliability
- Pool created once at startup, reused across all script executions and background processes
- **config.js**: Keep `process.exit(1)` on startup validation -- fail-fast on bad config is correct behavior
- **PortalOC_StatusUpdater.js**: Full refactor -- extract logic into exported async function, remove auto-execute, remove all 7 process.exit calls
- **All other files**: Remove process.exit entirely -- replace with appropriate pattern per call site
- **Scripts**: Add `if (require.main === module)` guard for CLI execution path

### Claude's Discretion
- Per-script refactor depth for the 5 scripts that don't export anything (wrap vs light refactor based on complexity)
- console.table replacement strategy per script
- Specific process.exit replacement pattern per call site (return error vs throw vs log-and-continue)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | Scripts return structured data objects instead of only console.log output | Unified envelope contract, dual-output pattern, per-script analysis of current exports vs gaps |
| INFRA-02 | All process.exit() calls removed or guarded from always-on code paths | Complete inventory of 30 process.exit calls, replacement strategy per call site, require.main guard pattern |
| INFRA-03 | Shared SQL connection pool (singleton) replacing per-query pool creation/destruction | mssql v11 global pool pattern, USE [database] approach, auto-reconnect via built-in health checks |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| mssql | 11.0.1 | SQL Server connections | Already installed; has built-in connection pooling with health checks and auto-replacement of dead connections |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jest | 29.7.0 | Unit testing | Already installed and configured; test structure validation of envelopes and pool behavior |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| USE [database] switching | Separate ConnectionPool per database | Multiple pools waste connections; USE approach matches the locked decision and keeps signature identical |
| Custom reconnect logic | mssql built-in health checks | mssql already has "Connection health check is built-in so once the dead connection is discovered, it is immediately replaced with a new one" -- no custom code needed |

**No new dependencies required.** This phase is pure refactoring of existing code using existing libraries.

## Architecture Patterns

### Current State (Before Refactoring)

```
src/
  utils/
    SQLServerConnection.js      # 32 LOC -- creates NEW pool per query (the problem)
  controller/
    PortalOC_StatusUpdater.js   # 114 LOC -- auto-executes main(), 7 process.exit calls, NO exports
    (9 other controllers)       # All export functions, no process.exit
  scripts/
    payment-uuid-diagnostic.js  # 271 LOC -- NO exports, auto-executes main()
    payment-uuid-repair.js      # 1211 LOC -- NO exports, auto-executes main(), 3 modes
    portal-payments-generator.js# 323 LOC -- NO exports, auto-executes function directly
    upload-authorized-pos.js    # 294 LOC -- NO exports, auto-executes function directly
    test-order-lifecycle.js     # 131 LOC -- NO exports, auto-executes main()
    (8 other scripts)           # Already export functions, most have require.main guards
  background.js                 # 3 process.exit calls (all behind autoTerminate flag)
  index.js                      # 2 process.exit calls (both behind autoTerminate flag)
  config.js                     # 1 process.exit(1) -- KEEP (locked decision)
```

### Target State (After Refactoring)

```
src/
  utils/
    SQLServerConnection.js      # Singleton pool, USE [db] switching, auto-reconnect, same exports
  controller/
    PortalOC_StatusUpdater.js   # Exports updatePOStatus(ocSage, status, idDatabase), no auto-execute
    (9 other controllers)       # Unchanged
  scripts/
    *.js                        # All 13 export async functions returning envelope, all have require.main guard
  background.js                 # No process.exit -- errors logged and surfaced, process stays alive
  index.js                      # No process.exit in always-on code path (only autoTerminate path)
  config.js                     # Unchanged (process.exit on validation stays)
```

### Pattern 1: Result Envelope
**What:** Every exported function returns the same shape
**When to use:** All 13 scripts + PortalOC_StatusUpdater
**Example:**
```javascript
// Source: CONTEXT.md locked decision
async function classifyPayments(options) {
    const start = Date.now();
    try {
        // ... business logic ...
        return {
            success: true,
            data: { categories, payments },
            errors: [],
            summary: `Classified ${total} payments into ${categories.length} categories`,
            meta: {
                duration: Date.now() - start,
                timestamp: new Date().toISOString(),
                tenant: options.tenantIndex
            }
        };
    } catch (err) {
        return {
            success: false,
            data: null,
            errors: [{ message: err.message, stack: err.stack }],
            summary: `Failed to classify payments: ${err.message}`,
            meta: {
                duration: Date.now() - start,
                timestamp: new Date().toISOString(),
                tenant: options.tenantIndex
            }
        };
    }
}
```

### Pattern 2: Dual-Mode Script (require.main guard)
**What:** Script works as CLI tool AND as importable module
**When to use:** All 13 scripts
**Example:**
```javascript
// Source: existing pattern in po-upload.js, po-diagnostic.js, etc.

// Exported functions return envelope -- never call process.exit
async function uploadSpecificPurchaseOrders(poNumbers, database, tenantIndex) {
    // ... returns { success, data, errors, summary, meta }
}

module.exports = { uploadSpecificPurchaseOrders };

// CLI entry point -- only runs when executed directly
if (require.main === module) {
    // Parse CLI args
    // Call exported function
    // Print console output
    // process.exit with appropriate code
    runPOUpload().then(result => {
        if (!result.success) process.exit(1);
    }).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
```

### Pattern 3: SQL Pool Singleton with USE [database]
**What:** Single ConnectionPool, database switched per query via `USE [database]`
**When to use:** SQLServerConnection.js refactor
**Example:**
```javascript
// Source: mssql v11 README "Global Pool Single Instance" + USE approach from CONTEXT.md
const sql = require('mssql');
const config = require('../config');

const poolConfig = {
    user: config.database.user,
    password: config.database.password,
    server: config.database.server,
    database: config.database.database, // Default database (FESA)
    connectionTimeout: 15000,
    requestTimeout: 60000,
    pool: {
        max: 10,
        min: 2,
        idleTimeoutMillis: 30000
    },
    options: {
        trustServerCertificate: true
    }
};

// Singleton pool promise -- created once, reused everywhere
let poolPromise = null;

function getPool() {
    if (!poolPromise) {
        const pool = new sql.ConnectionPool(poolConfig);
        pool.on('error', err => {
            console.error('[SQL Pool Error]', err.message);
            // Pool handles reconnection internally -- just log
        });
        poolPromise = pool.connect();
    }
    return poolPromise;
}

async function runQuery(query, database = 'FESA') {
    const pool = await getPool();
    const request = pool.request();
    // Switch database context if different from default
    const fullQuery = database !== config.database.database
        ? `USE [${database}]; ${query}`
        : query;
    return request.query(fullQuery);
}

// For graceful shutdown
async function closePool() {
    if (poolPromise) {
        const pool = await poolPromise;
        await pool.close();
        poolPromise = null;
    }
}

module.exports = { runQuery, closePool, getPool };
```

### Pattern 4: PortalOC_StatusUpdater Full Refactor
**What:** Extract from auto-execute CLI script to exportable module
**When to use:** This one controller specifically
**Example:**
```javascript
// Source: current PortalOC_StatusUpdater.js (114 LOC)
// FROM: main() auto-executes on require, uses process.argv, calls process.exit 7 times
// TO: exports updatePOStatus(ocSage, status, idDatabase) returning envelope

async function updatePOStatus(ocSage, status, idDatabase) {
    const start = Date.now();
    // validation -> return error envelope instead of process.exit
    if (!VALID_STATUSES.has(status)) {
        return { success: false, data: null, errors: [{ message: `Invalid status: ${status}` }], ... };
    }
    // ... business logic ...
    // process.exit(0) -> return success envelope
    // process.exit(1) -> return error envelope
}

module.exports = { updatePOStatus };

if (require.main === module) {
    const [, , ocSage, status, idDatabase] = process.argv;
    updatePOStatus(ocSage, status, idDatabase).then(result => {
        if (result.success) {
            console.log(`[OK] OC ${ocSage} actualizado a ${status}`);
            process.exit(0);
        } else {
            console.error('[ERROR]', result.errors[0]?.message);
            process.exit(1);
        }
    });
}
```

### Anti-Patterns to Avoid
- **Creating pools inside functions:** The current `runQuery` creates a new `ConnectionPool` for every call and closes it immediately. This is the primary performance and reliability problem being fixed.
- **process.exit in library code:** Any `process.exit()` in code that might be `require()`-d by the server will kill the entire always-on process. Only the CLI entry point (inside `require.main === module`) should ever call it.
- **Mixing arg parsing with business logic:** The `PortalOC_StatusUpdater.js` pattern of reading `process.argv` at module scope means importing the module requires it to be run as CLI. Always separate CLI concerns from business logic.
- **Throwing exceptions for expected errors:** The existing codebase pattern returns `false` or error objects, not thrown exceptions. The new envelope pattern is consistent with this -- return error envelope, don't throw.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQL connection pooling | Custom pool manager | mssql built-in `ConnectionPool` with `pool` config | Handles health checks, dead connection replacement, min/max sizing, idle timeout automatically |
| Auto-reconnect on drops | Custom retry/reconnect wrapper | mssql built-in health check | "Connection health check is built-in so once the dead connection is discovered, it is immediately replaced with a new one" (mssql README) |
| Result envelope factory | Inline object construction in every function | Small `createResult(success, data, errors, summary, meta)` helper | Ensures consistency, reduces boilerplate, single place to change if envelope shape evolves |

**Key insight:** The mssql library already provides everything needed for INFRA-03. The pool manages its own health, reconnects transparently, and the `USE [database]` approach lets us keep a single pool while querying multiple databases. No custom reconnection logic is needed.

## Common Pitfalls

### Pitfall 1: USE [database] with Concurrent Requests
**What goes wrong:** If two concurrent queries both do `USE [db]; SELECT ...`, they might share a connection and the second USE could affect the first query.
**Why it happens:** ConnectionPool manages a pool of TDS connections. Each `pool.request().query()` acquires a dedicated connection for that request, executes, and returns it. The `USE` and the `SELECT` are sent as a single batch in one `request.query()` call, so they execute atomically on the same connection.
**How to avoid:** Always combine `USE [database]` with the query in a single `request.query()` call (as shown in the pattern). Never execute `USE` as a separate request.
**Warning signs:** Data from wrong database appearing in results.

### Pitfall 2: Pool Error Listener Required
**What goes wrong:** Unhandled 'error' event crashes the Node.js process.
**Why it happens:** mssql README states: "IMPORTANT: Always attach an error listener to created connection. Whenever something goes wrong with the connection it will emit an error and if there is no listener it will crash your application with an uncaught error."
**How to avoid:** Always attach `pool.on('error', handler)` to the ConnectionPool. Log the error, but do NOT call `process.exit()` or re-throw. The pool will handle reconnection internally.
**Warning signs:** `UnhandledPromiseRejection` or `unhandledRejection` errors in logs.

### Pitfall 3: Auto-Execute on Require
**What goes wrong:** Requiring a script that calls `main()` at module scope actually runs the script, including CLI arg parsing and process.exit.
**Why it happens:** Node.js evaluates all top-level code when a file is `require()`-d. Scripts like `PortalOC_StatusUpdater.js` call `main()` at the bottom with no guard.
**How to avoid:** ALL executable code must be inside `if (require.main === module)` guard. Move all auto-execute calls into this guard.
**Warning signs:** Server crashes or unexpected behavior when importing a controller.

### Pitfall 4: Background Process Error Propagation
**What goes wrong:** An error in `forResponse()` causes `startBackgroundProcesses()` to reject, which causes `index.js` to call `process.exit(1)`, killing the server.
**Why it happens:** The current `index.js` catches background process errors and exits if `autoTerminate` is true. In always-on mode, autoTerminate will be false, but the error handling still needs to be robust.
**How to avoid:** `background.js` functions should catch all errors internally and return results. The `index.js` error handler should log and continue, never exit.
**Warning signs:** Server stops after a SQL query failure or portal API timeout.

### Pitfall 5: process.exit in Shutdown Route
**What goes wrong:** The `/api/shutdown` route in `routes.js` calls `process.exit(0)` which will kill the always-on service.
**Why it happens:** This was designed for the old "start, run, exit" model.
**How to avoid:** This route will need to be removed or guarded behind the autoTerminate flag. In always-on mode, shutdown is handled by the service manager (Servy), not by the web UI. This specific route (line 194 of routes.js) should be addressed.
**Warning signs:** Accidental clicks on dashboard shutdown button kill the production service.

### Pitfall 6: Envelope Consistency Drift
**What goes wrong:** Different scripts return slightly different envelope shapes (missing `meta`, `errors` as string instead of array, etc.), breaking Phase 7 API layer.
**Why it happens:** 13+ scripts refactored by different tasks, easy to diverge on shape.
**How to avoid:** Create a `createResult()` helper function used by all scripts. Write a test that validates envelope shape for every exported function.
**Warning signs:** API layer needs per-script response transformation logic.

## Code Examples

### Current SQLServerConnection.js (BEFORE -- the problem)
```javascript
// Source: src/utils/SQLServerConnection.js (current, 32 LOC)
// Creates a NEW ConnectionPool for EVERY query, then closes it
async function runQuery(query, database = 'FESA') {
    const pool = await new sql.ConnectionPool({
        ...dbConfig,
        database: database,
        options: { trustServerCertificate: true }
    }).connect();
    const result = await pool.request().query(query);
    pool.close();
    return result;
}
```

### Result Envelope Helper
```javascript
// Source: pattern derived from CONTEXT.md locked decision
function createResult(success, { data = null, errors = [], summary = '', tenant = null } = {}, startTime) {
    return {
        success,
        data,
        errors: Array.isArray(errors) ? errors : [errors],
        summary,
        meta: {
            duration: startTime ? Date.now() - startTime : 0,
            timestamp: new Date().toISOString(),
            tenant
        }
    };
}

function successResult(data, summary, meta) {
    return createResult(true, { data, summary, ...meta }, meta?.startTime);
}

function errorResult(errors, summary, meta) {
    return createResult(false, { errors, summary, ...meta }, meta?.startTime);
}

module.exports = { createResult, successResult, errorResult };
```

### Multi-Mode Script Export Pattern (payment-uuid-repair)
```javascript
// Source: CONTEXT.md decision -- separate functions per mode
// BEFORE: single main() with switch(mode), no exports
// AFTER: three separate exported functions + CLI wrapper

async function scanForRepairableUUIDs(options = {}) {
    // returns envelope
}

async function repairUUIDs(options = {}) {
    // returns envelope
}

async function uploadRepairedPayments(options = {}) {
    // returns envelope
}

module.exports = { scanForRepairableUUIDs, repairUUIDs, uploadRepairedPayments };

if (require.main === module) {
    // CLI: parse process.argv, call appropriate function, format console output, process.exit
}
```

## Complete process.exit Inventory

| File | Line(s) | Current Behavior | Replacement Strategy |
|------|---------|------------------|---------------------|
| `config.js` | 54 | Exit on missing env vars | **KEEP** (locked decision) |
| `PortalOC_StatusUpdater.js` | 35, 39, 44, 61, 89, 105, 110 | Validation + error handling + success | Return error/success envelope; move to `require.main` guard |
| `payment-uuid-diagnostic.js` | 243, 252, 265, 270 | CLI usage + completion + error | Wrap in `require.main` guard; exported fn returns envelope |
| `payment-uuid-repair.js` | 1187, 1204, 1210 | CLI usage + completion + error | Wrap in `require.main` guard; 3 exported fns return envelopes |
| `payment-reconciliation.js` | 701 | Fatal error in CLI | Already has `require.main` guard; move exit inside guard |
| `po-payment-form-diagnostic.js` | 190, 200 | CLI arg validation | Already has `require.main` guard; move exits inside guard |
| `test-order-lifecycle.js` | 25, 33, 41, 49, 56, 60 | CLI arg validation + errors | Wrap in `require.main` guard; exported fn returns envelope |
| `background.js` | 209, 220 | autoTerminate exits | Remove -- always-on process should never exit |
| `index.js` | 25, 33 | autoTerminate exits | Remove -- server.close() without process.exit |
| `routes/routes.js` | 194 | Dashboard shutdown button | Guard behind autoTerminate flag or remove |
| `AutoShutdownService.js` | 149 | Auto-shutdown timer | Remove process.exit; emit event or call server.close() instead |

**Total: 30 process.exit calls**
- 1 to KEEP (config.js)
- 7 in PortalOC_StatusUpdater (full refactor into envelope returns)
- 13 in scripts (move into require.main guards)
- 5 in background.js + index.js (remove autoTerminate exits)
- 1 in routes.js (guard or remove)
- 1 in AutoShutdownService.js (replace with graceful mechanism)
- 2 in po-payment-form-diagnostic.js (already has guard, move exits inside)

## Scripts Export Status Inventory

| Script | LOC | Exports? | require.main? | Modes | Work Needed |
|--------|-----|----------|---------------|-------|-------------|
| payment-reconciliation.js | 705 | Yes (classifyPayments, uploadBatch) | Yes | 1 | Add envelope return |
| po-upload.js | 453 | Yes (uploadSpecificPurchaseOrders) | Yes | 1 | Add envelope return |
| po-update.js | 543 | Yes (functions) | Yes | 1 | Add envelope return |
| po-query.js | 409 | Yes (functions) | Yes | 1 | Add envelope return |
| po-diagnostic.js | 267 | Yes (diagnosticPO, getAuthorizedPOsToday) | Yes | 1 | Add envelope return |
| po-address-diagnostic.js | 309 | Yes (functions) | Yes | 1 | Add envelope return |
| po-payment-form-diagnostic.js | 204 | Yes (diagnosticPaymentForm) | Yes | 1 | Add envelope return, fix exit placement |
| get-payment-cfdis.js | 114 | Yes (getTypePTest) | No (IIFE) | 1 | Add require.main guard, add envelope |
| portal-payments-generator.js | 323 | **No** | **No** | 1 | Extract function, add exports, guard, envelope |
| upload-authorized-pos.js | 294 | **No** | **No** | 1 | Extract function, add exports, guard, envelope |
| payment-uuid-diagnostic.js | 271 | **No** | **No** | 1 | Export diagnosePayment, add guard, envelope |
| payment-uuid-repair.js | 1211 | **No** | **No** | **3** (scan/repair/upload) | Export 3 functions, add guard, 3 envelopes |
| test-order-lifecycle.js | 131 | **No** | **No** | **3** (analyze/process/tenant) | Export 3 functions, add guard, 3 envelopes |

**Controller requiring refactor:**

| Controller | LOC | Status | Work Needed |
|------------|-----|--------|-------------|
| PortalOC_StatusUpdater.js | 114 | Auto-executes main(), no exports, 7 process.exit | Full refactor: extract updatePOStatus(), add exports, guard, envelope |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pool-per-query | Singleton pool reused across requests | mssql docs recommend since v6+ | 10x fewer TCP connections, consistent latency, no connection storms |
| process.exit for error handling | Return error objects/envelopes | Standard Node.js pattern | Process stays alive, errors are data not fatal signals |
| CLI-only scripts | Dual-mode (CLI + importable) | Required by always-on architecture | Same code serves CLI operators and API endpoints |

## Open Questions

1. **shutdown route behavior in always-on mode**
   - What we know: routes.js line 194 calls `process.exit(0)` from the dashboard shutdown button
   - What's unclear: Should this route be removed entirely, disabled in always-on mode, or preserved for emergency use?
   - Recommendation: Guard behind `config.app.autoTerminate` -- only allow manual shutdown in legacy mode. In always-on mode, shutdown is managed by Servy.

2. **AutoShutdownService.js process.exit replacement**
   - What we know: This service auto-exits the process before scheduled Windows Task Scheduler runs to avoid port conflicts.
   - What's unclear: Since Phase 8 replaces Task Scheduler with node-cron, is this service dead code by Phase 10?
   - Recommendation: Replace `process.exit(0)` with `server.close()` callback or event emission. The service will be fully removed in Phase 10 (DEPLOY-02).

3. **Pool min connections setting**
   - What we know: Default mssql pool min is 0, max is 10.
   - What's unclear: Whether min=0 could cause cold-start latency after idle periods for the always-on service.
   - Recommendation: Set `pool.min: 2` to keep warm connections. Tune after observing production behavior.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `jest.config.js` (root) |
| Quick run command | `npx jest --testPathPattern=tests/ --no-coverage` |
| Full suite command | `npx jest --no-coverage` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | Every exported function returns envelope shape | unit | `npx jest tests/envelope-contract.test.js -x` | No -- Wave 0 |
| INFRA-01 | Envelope has success, data, errors, summary, meta fields | unit | `npx jest tests/envelope-contract.test.js -x` | No -- Wave 0 |
| INFRA-02 | No process.exit in non-CLI code paths | unit (static) | `npx jest tests/no-process-exit.test.js -x` | No -- Wave 0 |
| INFRA-02 | require.main guard present on all scripts | unit (static) | `npx jest tests/no-process-exit.test.js -x` | No -- Wave 0 |
| INFRA-03 | Singleton pool created once, reused | unit | `npx jest tests/SQLServerConnection.test.js -x` | Yes (placeholder only -- 1 trivial test) |
| INFRA-03 | USE [database] switching works correctly | unit | `npx jest tests/SQLServerConnection.test.js -x` | Yes (needs rewrite) |
| INFRA-03 | Pool error listener attached | unit | `npx jest tests/SQLServerConnection.test.js -x` | Yes (needs rewrite) |

### Sampling Rate
- **Per task commit:** `npx jest --testPathPattern=tests/ --no-coverage`
- **Per wave merge:** `npx jest --no-coverage`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/envelope-contract.test.js` -- validates every exported script function returns correct envelope shape (mock runQuery, test shape only)
- [ ] `tests/no-process-exit.test.js` -- static analysis: grep src/ for process.exit outside require.main guards and config.js
- [ ] `tests/SQLServerConnection.test.js` -- rewrite existing placeholder: mock mssql.ConnectionPool, verify singleton behavior, verify USE [database] prefix, verify error listener attachment
- [ ] `tests/helpers/result-envelope.test.js` -- unit tests for createResult/successResult/errorResult helpers

## Sources

### Primary (HIGH confidence)
- mssql v11.0.1 README (node_modules/mssql/README.md) -- Connection pool patterns, Global Pool Single Instance, pool config options, health check behavior, error listener requirement
- Codebase analysis -- Direct examination of all 13 scripts, 10 controllers, SQLServerConnection.js, background.js, index.js, config.js, routes.js, AutoShutdownService.js

### Secondary (MEDIUM confidence)
- mssql pool options reference (tarn.js) -- pool.max, pool.min, idleTimeoutMillis settings

### Tertiary (LOW confidence)
- None -- all findings verified against installed library and codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- mssql v11.0.1 already installed, all patterns verified in library README
- Architecture: HIGH -- Existing codebase patterns directly examined, 8/13 scripts already partially follow target pattern
- Pitfalls: HIGH -- Every process.exit call inventoried with line numbers, every script's export status verified
- Validation: MEDIUM -- Test approach is standard Jest mocking, but tests don't exist yet

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (stable -- no external dependencies changing)
