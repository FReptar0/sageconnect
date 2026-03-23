# Domain Pitfalls

**Domain:** Always-on Node.js service with operational web UI for ERP integration
**Researched:** 2026-03-23

## Critical Pitfalls

Mistakes that cause rewrites or major issues.

### Pitfall 1: Script Functions That Only Console.log (No Return Values)
**What goes wrong:** Scripts like `payment-reconciliation.js` expose `classifyPayments` and `uploadBatch` with structured return values, but most other scripts (all PO scripts, all diagnostic scripts) have their `main()` functions that only `console.log()` and return nothing useful. Wrapping them in API endpoints produces empty responses.
**Why it happens:** Scripts were written for CLI use where console output IS the output. The pattern was not consistent -- reconciliation was refactored to export testable functions (v1.0), but others were not.
**Consequences:** Every script needs refactoring before it can be an API endpoint. If done poorly, you end up with two code paths.
**Prevention:** Before building any route handler, audit each script function's return value. Refactor the function to return data AND console.log it (for CLI backward compatibility). This is the FIRST phase of work.
**Detection:** Script function returns `undefined` or a Promise that resolves to `undefined`.

**Affected scripts (return nothing useful from main flow):**
- `po-diagnostic.js` -- `diagnosticPO()` returns nothing, uses `console.table()`
- `po-query.js` -- `testSpecificPurchaseOrders()` returns nothing
- `po-upload.js` -- `uploadSpecificPurchaseOrders()` returns nothing visible
- `po-address-diagnostic.js` -- `diagnosticPOAddress()` returns nothing
- `po-payment-form-diagnostic.js` -- `diagnosticPaymentForm()` returns nothing
- `payment-uuid-diagnostic.js` -- `diagnosePayment()` returns nothing
- `portal-payments-generator.js` -- `testGeneratePaymentJson()` returns nothing
- `get-payment-cfdis.js` -- `getTypePTest()` returns data but nested inconsistently
- `upload-authorized-pos.js` -- hardcoded first tenant index, returns nothing

**Scripts with usable return values already:**
- `payment-reconciliation.js` -- `classifyPayments()` and `uploadBatch()` return structured objects
- `po-update.js` -- `testPurchaseOrderUpdate()` returns `{ success, error, mode }`
- `test-order-lifecycle.js` -- delegates to controller functions that return values

### Pitfall 2: Scheduled Task and Manual Operation Collision
**What goes wrong:** User triggers payment reconciliation from web UI at 10:13. At 10:15, the scheduled cron fires and also starts reconciliation. Both hit the same Sage SQL tables and Portal API simultaneously, causing duplicate payments or portal API errors.
**Why it happens:** Cron fires on a schedule regardless of what is happening. Without concurrency control, operations overlap.
**Consequences:** Duplicate payment uploads to portal (financial error), SQL connection pool exhaustion, confusing interleaved log entries.
**Prevention:** OperationManager with per-type locking. If a manual operation of the same type is running when cron fires, the cron execution skips and logs the skip reason. This is NOT optional -- it must be in the initial implementation.
**Detection:** Two log entries for the same operation starting within seconds of each other; portal API returning "duplicate external_id" errors.

### Pitfall 3: Removing AutoShutdownService Before Scheduler Is Stable
**What goes wrong:** AutoShutdownService exists because the current architecture runs the app via Task Scheduler, and if web-only mode is left running when the next scheduled run starts, there is a port conflict on 3030. Removing it before the new scheduler is fully working leaves you unable to use the app in either mode.
**Why it happens:** The desire to "clean up" legacy code before the replacement is ready.
**Consequences:** Port 3030 conflicts when Task Scheduler still fires; service crashes on startup.
**Prevention:** Keep AutoShutdownService functional until the LAST phase. Remove it only after: (1) node-cron scheduler is working, (2) Windows Task Scheduler entries are disabled, (3) Servy is managing the always-on process. This is a specific ordering dependency.
**Detection:** `EADDRINUSE` errors in logs; service fails to start.

### Pitfall 4: SSE Connections Leaking on Client Disconnect
**What goes wrong:** Client opens SSE connection for operation progress, then navigates away or closes the browser tab. The SSE response object remains in the OperationManager subscriber list, piling up stale connections.
**Why it happens:** Express does not automatically clean up SSE connections. The `res` object stays in memory until explicitly ended.
**Consequences:** Memory leak proportional to number of abandoned SSE connections. Over days of always-on operation, this accumulates.
**Prevention:** Always listen for `req.on('close')` and unsubscribe the response. Set a maximum SSE connection lifetime (e.g., 30 minutes). OperationManager must clean up subscribers when operation completes.
**Detection:** Increasing memory usage over time; stale entries in SSE subscriber lists.

## Moderate Pitfalls

### Pitfall 5: Breaking CLI Script Backward Compatibility
**What goes wrong:** Refactoring scripts to return structured data accidentally breaks the CLI invocation path. The `if (require.main === module)` block no longer produces console output.
**Prevention:** Every script refactor must preserve: (1) CLI invocation produces same console output, (2) exported functions return structured data. Test both paths. The adapter should call the function, which returns data AND logs to console.

### Pitfall 6: Hardcoded Tenant Index in Scripts
**What goes wrong:** Several scripts (e.g., `upload-authorized-pos.js`, `get-payment-cfdis.js`) have `const index = 0` hardcoded at module level. When exposed as API endpoints with `tenantIndex` as a parameter, the hardcoded value is used instead.
**Prevention:** Audit every script for module-level `const index = 0`. Move tenant index into function parameters. The adapter receives tenantIndex from the route and passes it through.

### Pitfall 7: Long-Running Operations Timing Out
**What goes wrong:** Payment reconciliation with `--from` spanning a full year can take 5+ minutes. Express default timeout or reverse proxy timeout kills the connection.
**Prevention:** Use 202 Accepted + SSE pattern for any operation that might take >30 seconds. Never keep an HTTP request open waiting for completion. For Express, if needed, increase `server.timeout` for SSE routes only.

### Pitfall 8: node-cron Schedule Drift After Process Restart
**What goes wrong:** If the always-on process restarts (crash, deploy, Servy restart) at 10:14, the :15 cron slot is missed. The next execution is at 10:30, creating a 30-minute gap instead of 15 minutes.
**Prevention:** On startup, check when the last successful execution was (from log files or a lightweight state file). If the last run was more than 20 minutes ago, trigger an immediate execution before resuming the normal cron schedule.

### Pitfall 9: Express Static File Caching Prevents Dashboard Updates
**What goes wrong:** After deploying new web UI code, browsers serve cached versions of HTML/CSS/JS from the existing static middleware.
**Prevention:** Add cache-busting query parameters to CSS/JS includes in HTML (e.g., `style.css?v=2.0.1`), or set `Cache-Control: no-cache` for development and short max-age for production.

## Minor Pitfalls

### Pitfall 10: SQL Injection via API Parameters
**What goes wrong:** API receives `poNumber` from HTTP request and passes it into raw SQL string interpolation (the pattern used throughout all scripts).
**Prevention:** This is documented as out-of-scope in PROJECT.md (internal network tool). However, add basic input sanitization in Joi schemas: PO numbers must match `/^PO\d+$/`, payment numbers must match `/^PY\d+$/`, tenant index must be a bounded integer. This is defense-in-depth, not a security boundary.

### Pitfall 11: Log File Path Differences Between CLI and Always-On
**What goes wrong:** When scripts run via CLI, `process.cwd()` is the project root. When run via Servy as a Windows Service, `process.cwd()` might be a system directory, breaking relative log paths.
**Prevention:** All paths should use `config.paths.logs` (absolute) rather than relative paths. Verify this during Servy integration.

### Pitfall 12: SSE Event Format Errors
**What goes wrong:** SSE requires the exact format `data: <content>\n\n` with a double newline. Forgetting the double newline or including raw newlines in the JSON payload breaks the stream.
**Prevention:** Always `JSON.stringify()` the event data (which escapes newlines) and always append `\n\n`.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Script refactoring | Breaking CLI backward compatibility (Pitfall 5) | Test every script both as CLI and via adapter after refactor |
| Script refactoring | Hardcoded tenant index (Pitfall 6) | Grep for `const index = 0` at module level |
| REST API creation | Console.log-only scripts (Pitfall 1) | Audit return values before writing routes |
| REST API creation | SQL injection via params (Pitfall 10) | Joi schemas with regex patterns for IDs |
| SSE implementation | Connection leaks (Pitfall 4) | Always handle `req.on('close')`; set max lifetime |
| SSE implementation | Event format errors (Pitfall 12) | Use a helper function for SSE writes |
| Scheduling implementation | Cron/manual collision (Pitfall 2) | OperationManager with per-type locking from day 1 |
| Scheduling implementation | Schedule drift after restart (Pitfall 8) | Check last execution time on startup |
| AutoShutdown removal | Premature removal (Pitfall 3) | Remove LAST, after scheduler + Servy are proven |
| Always-on deployment | Log path issues (Pitfall 11) | Verify absolute paths work under Servy |
| Dashboard UI updates | Browser caching (Pitfall 9) | Cache-busting query params on static assets |

## Sources

- Project codebase analysis: all 13 scripts in `src/scripts/`, `src/background.js`, `src/services/AutoShutdownService.js`
- [DigitalOcean: SSE in Node.js](https://www.digitalocean.com/community/tutorials/nodejs-server-sent-events-build-realtime-app)
- [Better Stack: Node.js Scheduled Tasks](https://betterstack.com/community/guides/scaling-nodejs/node-cron-scheduled-tasks/)
- [Yodaplus: Audit Trails in ERP](https://yodaplus.com/blog/audit-trails-in-erp-how-to-design-them-right/)
