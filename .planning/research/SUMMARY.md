# Project Research Summary

**Project:** SageConnect v2.0 — Always-On Service with Operational Web UI
**Domain:** Always-on Windows service (Node.js) with REST API and operational web UI for Sage 300 ERP integration
**Researched:** 2026-03-23
**Confidence:** HIGH

## Executive Summary

SageConnect is a Node.js service that integrates a Portal de Proveedores (vendor portal) with Sage 300 ERP via SQL Server and a REST API. The v1.1 architecture relies on Windows Task Scheduler to launch and kill the process every 15 minutes, requiring an `AutoShutdownService` hack to prevent port 3030 conflicts. The v2.0 milestone transforms this into an always-on Windows service managed by Servy, with internal scheduling via node-cron and a full REST API layer that exposes the 13 existing CLI scripts to a new operational web UI. The research is grounded in the existing codebase — this is not a greenfield project, and every technology recommendation was validated against what already exists.

The recommended approach is a phased migration with a strict ordering: (1) refactor scripts to return structured data before writing any routes, (2) build the REST API over adapted scripts with security hardening, (3) add the SSE real-time layer and node-cron internal scheduler, (4) build the operational web UI on top of the working API, (5) cut over to Servy and retire the Task Scheduler plumbing. The critical dependency chain runs from script refactor → REST API → SSE/scheduler → web UI → service cutover. Skipping or reordering these phases risks the three most dangerous pitfalls.

The primary risk is the gap between the current architecture (process dies every 15 min) and the target architecture (always-on process). `AutoShutdownService` must remain in place until the very last phase — removing it prematurely while Task Scheduler is still active causes `EADDRINUSE` crashes. The second critical risk is the 9 scripts that return nothing from their main flow; every one must be refactored before it can be wrapped in an API endpoint. Total new npm dependencies are only 5 (node-cron, helmet, express-rate-limit, cors, express-async-errors), keeping the build pipeline changes minimal.

---

## Key Findings

### Recommended Stack

The existing stack (Express 4.21.1, mssql, axios, winston, joi, nodemailer, Bootstrap 5.3 CDN) remains unchanged. Five npm packages are added for new capabilities, and one external tool is installed on the Windows server. No frontend framework is added — the existing pattern of static HTML + Bootstrap CDN + vanilla `fetch()` handles all operational UI needs. Native SSE (Server-Sent Events) replaces any need for Socket.IO for real-time progress.

**Core technologies:**
- **Servy 7.0** (external, Windows server install): Windows service manager — replaces PM2/Task Scheduler, self-contained .NET 10 build with health monitoring, log rotation, and restart policies. Installed via `winget install servy` or MSI; never an npm dependency.
- **node-cron@^4.2.1**: Internal scheduler — replaces Windows Task Scheduler entirely, `noOverlap: true` prevents concurrent runs, timezone support, eliminates `AutoShutdownService` once fully migrated.
- **helmet@^8.1.0**: HTTP security headers — CSP must whitelist existing CDN sources (cdn.jsdelivr.net, cdnjs.cloudflare.com).
- **express-rate-limit@^8.3.1**: API rate limiting — in-memory store is sufficient for single-instance service; no Redis needed.
- **cors@^2.8.6**: CORS headers — explicit config prevents issues if UI is accessed from a host other than localhost.
- **express-async-errors@^3.1.1**: Async error propagation — must be `require()`d before any route definitions; prevents silent crashes in async handlers.
- **Custom API key middleware** (zero new dependencies): `x-api-key` header checked against `API_KEY_OPS` env var — appropriate for an internal network API; JWT/Passport is over-engineering here.

**Critical version note:** node-cron v4 is required, not v3. v4 adds `noOverlap` (prevents concurrent scheduled runs), changes auto-start behavior, and removes deprecated options. Production server must be Node.js 18+.

See `.planning/research/STACK.md` for full rationale, version compatibility matrix, and `config.js` additions needed.

### Expected Features

The feature set is driven entirely by the 13 existing CLI scripts and the operations team's manual workflows. Every REST endpoint maps to an already-existing script; no new business logic is introduced in v2.0.

**Must have (table stakes):**
- REST endpoints for all 13 scripts — operations team needs to trigger scripts without SSH/RDP
- Structured JSON responses from all endpoints — scripts currently only `console.log()`; must return data objects first
- Tenant index parameter on every endpoint — multi-tenant is core to every script
- Dry-run default on destructive endpoints — API must default to safe mode, matching `--dry-run` CLI behavior
- Real-time operation progress via SSE — reconciliation and uploads take 30s–5min; blank UI is unacceptable
- Schedule management UI — next run, last result, manual trigger (replaces Windows Task Scheduler visibility)
- Payment reconciliation report (5-category view) — highest-value daily operation for the team
- PO status and diagnostic views — PO diagnostic is the most-used daily CLI script

**Should have (differentiators):**
- Operation concurrency control (409 when duplicate in-flight) — prevents double payment uploads to portal
- Schedule pause/override — disable cron during Sage maintenance windows without stopping the service
- Tenant switcher in navbar — switch context without editing URL params
- Batch operation progress with per-item SSE — "3/20 uploaded, 2 failed" in real-time
- Auto-resolution tracking in payment view — surfaces auto-resolved PROVIDERID fixes

**Defer to v2.1+:**
- UUID repair workflow UI — 3-stage state machine (scan/repair/upload), high complexity; CLI is adequate for now
- Cross-entity diagnostic (payment → invoices → PO → portal trace) — high complexity, low frequency
- Per-item SSE for batch operations — basic completion notification is sufficient for v2.0

See `.planning/research/FEATURES.md` for the full script-to-endpoint mapping table (all 13 scripts).

### Architecture Approach

The target architecture adds three new layers on top of the existing Express server without replacing anything: a **Script Adapter** layer (thin wrappers that call existing exported functions and return structured data), an **OperationManager** singleton (in-memory concurrency control, SSE broadcasting, operation state tracking), and a **SchedulerService** (node-cron wrapper with execution history and last-result tracking). Routes are split into domain files alongside the existing `routes.js`. The pattern for long-running operations is 202 Accepted + operationId, with the client opening a separate SSE stream to receive progress events.

**Major components:**
1. **Script Adapters** (`src/adapters/`) — wrap existing script exports, capture return values, emit progress events via callback; preserve CLI console output behavior unchanged
2. **OperationManager** (`src/services/OperationManager.js`) — Map-based operation tracking, per-type locking (prevents cron/manual collision), SSE subscriber management with `req.on('close')` cleanup
3. **SchedulerService** (`src/services/SchedulerService.js`) — node-cron wrapper, tracks last execution time, checks on startup whether a run was missed (>20 min gap triggers immediate execution)
4. **Route modules** (`src/routes/paymentRoutes.js`, `poRoutes.js`, `scheduleRoutes.js`, `operationRoutes.js`) — Joi validation on all inputs, 202+SSE for long operations, structured JSON errors (no raw SQL error messages in responses)

See `.planning/research/ARCHITECTURE.md` for data flow diagrams, anti-patterns to avoid, and SSE endpoint code patterns.

### Critical Pitfalls

1. **9 scripts return nothing from their main flow** — `po-diagnostic.js`, `po-query.js`, `po-upload.js`, `po-address-diagnostic.js`, `po-payment-form-diagnostic.js`, `payment-uuid-diagnostic.js`, `portal-payments-generator.js`, `get-payment-cfdis.js`, `upload-authorized-pos.js` all only `console.log()`. Wrapping them in routes produces empty API responses. Prevention: audit and refactor ALL scripts before writing any route handler.

2. **Cron/manual operation collision** — user triggers reconciliation at 10:13, cron fires at 10:15, both hit same SQL tables and Portal API simultaneously, risking duplicate payment uploads. Prevention: OperationManager per-type locking must be in place before cron and REST API coexist in the same process.

3. **Premature `AutoShutdownService` removal** — it exists because Task Scheduler still fires while the service is running. Removing it before Servy is managing the process and Task Scheduler entries are disabled causes `EADDRINUSE` on port 3030. Prevention: keep it until the very last migration step.

4. **SSE connection leaks on client disconnect** — stale `res` objects accumulate in OperationManager subscriber lists over days of always-on operation. Prevention: always handle `req.on('close')` to unsubscribe; set a maximum SSE connection lifetime; clean up subscribers when operation completes.

5. **Hardcoded tenant index in scripts** — `upload-authorized-pos.js` and `get-payment-cfdis.js` have `const index = 0` at module level, silently overriding any `tenantIndex` passed from the API. Prevention: grep for module-level `const index = 0` during the script refactor phase.

See `.planning/research/PITFALLS.md` for 12 total pitfalls, including moderate (CLI backward compat, long-running timeouts, schedule drift) and minor (log paths under Servy, SSE event format, browser caching).

---

## Implications for Roadmap

Based on the critical dependency chain discovered in research, work cannot proceed in any order other than the one below. Each phase gates the next.

### Phase 1: Script Refactor — Structured Returns
**Rationale:** Every downstream feature (REST API, web UI, SSE progress) depends on scripts returning structured data. This is the single largest prerequisite. Doing it first avoids building routes around `undefined` returns and rewriting them later.
**Delivers:** All 13 scripts return structured result objects from their exported functions while preserving identical CLI console output.
**Addresses:** "Structured JSON responses" (table stakes in FEATURES.md); prerequisite for all other features.
**Avoids:** Pitfall 1 (console.log-only scripts), Pitfall 5 (breaking CLI backward compatibility), Pitfall 6 (hardcoded tenant index).

### Phase 2: REST API Foundation + Security
**Rationale:** With structured returns available, routes can be written cleanly. Security hardening goes in at this layer — not bolted on later. `express-async-errors` must be added before any async route goes live.
**Delivers:** All 13 scripts accessible as REST endpoints with Joi validation, API key protection, rate limiting, and structured error responses. Testable via curl/Postman with no web UI yet.
**Uses:** helmet, express-rate-limit, cors, express-async-errors (new npm deps), custom API key middleware, Joi (existing).
**Implements:** Script Adapters, Route modules, OperationManager (concurrency locking only — SSE in Phase 3).
**Avoids:** Pitfall 7 (long-running timeouts — 202+SSE pattern established here even if SSE comes later), Pitfall 10 (SQL injection via Joi regex patterns on all ID params).

### Phase 3: Scheduler + Real-Time Layer
**Rationale:** node-cron replaces Windows Task Scheduler as internal scheduler. OperationManager gains SSE broadcasting. These go together because concurrency locking must be active before cron starts firing — Pitfall 2 is possible on the very first scheduled run if locking comes later.
**Delivers:** Always-on internal scheduler (`*/15 * * * *` with `noOverlap: true`), SSE progress streams for all long-running operations, schedule management API (`/api/schedule`), operation status API (`/api/operations/status`).
**Uses:** node-cron@^4.2.1 (new), native SSE (no dependency).
**Implements:** SchedulerService (with startup missed-execution check), OperationManager SSE layer.
**Avoids:** Pitfall 2 (cron/manual collision), Pitfall 4 (SSE connection leaks), Pitfall 8 (schedule drift after restart), Pitfall 12 (SSE event format errors).

### Phase 4: Operational Web UI
**Rationale:** REST API and SSE layer are now stable. Web UI is built on top of them with no new backend changes needed. Continues the existing Bootstrap 5.3 + vanilla JS pattern — no build tooling changes, no obfuscation pipeline changes.
**Delivers:** Payment reconciliation view (5-category report + drill-down), PO management view (status overview + diagnostic), schedule dashboard (next runs, last results, manual trigger buttons), tenant switcher in navbar.
**Uses:** Bootstrap 5.3 CDN (existing), vanilla JS `fetch()` + `EventSource` (no new dependencies).
**Implements:** Static HTML pages in `/public/`, new JS modules, SSE EventSource client.
**Avoids:** Pitfall 9 (browser caching — cache-busting query params on static assets).

### Phase 5: Servy Cutover + AutoShutdown Retirement
**Rationale:** Only after the scheduler, API, and UI are proven stable can the process lifecycle be migrated. This is the most irreversible phase — it changes how the service is deployed on the production server. `AutoShutdownService` is removed only here.
**Delivers:** SageConnect running as a native Windows service via Servy, auto-starting on reboot, health-monitored with log rotation. Windows Task Scheduler entries disabled. `AutoShutdownService` removed from codebase. PowerShell install script added to the production deployment repo.
**Uses:** Servy 7.0 (external, installed on Windows server via `winget install servy` or MSI).
**Avoids:** Pitfall 3 (premature AutoShutdownService removal), Pitfall 11 (log path issues under Servy — verify absolute paths in `config.paths`).

### Phase Ordering Rationale

- **Phase 1 before 2:** Routes written around `undefined` returns produce broken endpoints with no path to fix them without rewriting. Refactor first, routes second — no exceptions.
- **Phase 2 before 3:** OperationManager concurrency locking must exist before cron starts. A manual API call at 10:13 + cron at 10:15 with no lock = Pitfall 2 on day one.
- **Phase 3 before 4:** The web UI consumes SSE streams. Building the UI before SSE exists forces rework of every progress indicator.
- **Phase 4 before 5:** Validate all new runtime behavior (scheduler + API + UI) in the existing process lifecycle before cutting over to Servy. Debugging a Servy deployment on top of untested code is significantly harder.
- **AutoShutdownService removed last:** Explicitly sequenced as the final action in PITFALLS.md. Any earlier removal while Task Scheduler is still active causes port 3030 conflicts.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 5 (Servy Cutover):** First deployment of Servy on the production Windows server. CLI parameters are verified, but the exact server environment (Windows Server version, firewall rules for port 3030, service account permissions for SQL Server and log directory) is unknown. Recommend a dry-run install on a test machine first.
- **Phase 3 (SSE under Servy, advanced):** SSE connections may behave differently under a Windows service account vs. an interactive user session. Validate that persistent SSE streams are not blocked by Windows service isolation policies before Phase 5 cutover.

Phases with standard patterns (research-phase likely unnecessary):
- **Phase 1 (Script Refactor):** Pure Node.js refactoring, no new dependencies. Systematic work with clear patterns.
- **Phase 2 (REST API):** Express + Joi + helmet + rate-limit are extensively documented. Official Express security best practices cover this entirely.
- **Phase 4 (Web UI):** Bootstrap 5.3 + vanilla JS + `EventSource` API are stable, heavily documented. The existing dashboard proves the team already knows this pattern.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All additions verified via official npm pages and Express docs. Servy verified via GitHub releases and CLI wiki. node-cron v4 migration changes confirmed against official migration guide. |
| Features | HIGH | Derived directly from codebase analysis of all 13 scripts and existing routes. Script-to-endpoint mapping is based on actual exported function signatures. |
| Architecture | HIGH | Target components map 1:1 to existing code structure. Script Adapter and OperationManager are standard Node.js service patterns with multiple reference implementations. |
| Pitfalls | HIGH | All critical pitfalls identified from actual codebase states — 9 scripts named by filename with confirmed `undefined` returns. Not theoretical risks. |
| Servy on production server | MEDIUM | Tool is validated; production server environment (Windows Server version, service account setup, network policies) is not yet verified. |
| SSE in production | MEDIUM | Basic SSE pattern is well-documented; long-running connection behavior under always-on Windows service is not yet confirmed. |

**Overall confidence:** HIGH

### Gaps to Address

- **Servy service account permissions:** The account running the Node.js process must have read/write access to the log directory, SQL Server connection, and Portal API network endpoint. Verify against production server's account setup before Phase 5.
- **Portal API concurrency behavior:** The OperationManager prevents internal duplicate operations, but multi-tenant runs may still send concurrent requests to the Portal API. Validate with a multi-tenant load test before pushing Phase 2 to production.
- **mssql connection pool under always-on:** The current architecture exits the process after each run, releasing all connections. An always-on process must explicitly manage the connection pool lifecycle. Verify pool reuse and cleanup behavior — no current evidence of explicit `pool.close()` calls.
- **Missed-execution startup mechanism:** PITFALLS.md recommends checking last execution time on startup and triggering an immediate run if >20 min have passed. The persistence mechanism (log file parse vs. lightweight state file like `scheduler-state.json`) needs a decision in Phase 3 planning.
- **Obfuscation pipeline coverage:** The `scripts/obfuscate.js` pipeline must include all new files added in `src/adapters/`, `src/routes/`, and `src/services/`. Verify glob patterns cover these directories before Phase 5 production build.

---

## Sources

### Primary (HIGH confidence)
- [Servy GitHub](https://github.com/aelassas/servy) — CLI parameters, releases, Node.js install examples verified
- [Servy CLI Wiki](https://github.com/aelassas/servy/wiki/Servy-CLI) — full install parameter reference
- [node-cron npm](https://www.npmjs.com/package/node-cron) — v4.2.1 API, `noOverlap`, timezone options
- [node-cron v3 to v4 migration](https://nodecron.com/migrating-from-v3) — breaking changes confirmed
- [Express security best practices](https://expressjs.com/en/advanced/best-practice-security.html) — helmet + rate-limit official recommendations
- [helmet npm](https://www.npmjs.com/package/helmet) — v8.1.0
- [express-rate-limit npm](https://www.npmjs.com/package/express-rate-limit) — v8.3.1
- [cors npm](https://www.npmjs.com/package/cors) — v2.8.6
- SageConnect codebase — `src/scripts/` (13 scripts), `src/routes/routes.js`, `src/background.js`, `src/services/AutoShutdownService.js`, `src/config.js`

### Secondary (MEDIUM confidence)
- [DigitalOcean: SSE in Node.js](https://www.digitalocean.com/community/tutorials/nodejs-server-sent-events-build-realtime-app) — SSE endpoint patterns and connection cleanup
- [Better Stack: Node.js Schedulers Comparison](https://betterstack.com/community/guides/scaling-nodejs/best-nodejs-schedulers/) — node-cron vs croner vs cron vs node-schedule
- [Better Stack: node-cron Scheduled Tasks](https://betterstack.com/community/guides/scaling-nodejs/node-cron-scheduled-tasks/) — production patterns
- [Servy vs NSSM vs WinSW](https://dev.to/aelassas/servy-vs-nssm-vs-winsw-2k46) — Windows service manager comparison

### Tertiary (LOW confidence)
- [Yodaplus: Audit Trails in ERP](https://yodaplus.com/blog/audit-trails-in-erp-how-to-design-them-right/) — ERP audit view patterns (referenced for payment audit feature design)
- [Modern Node.js Patterns for 2025](https://kashw1n.com/blog/nodejs-2025/) — general service architecture patterns
- [LogRocket: Comparing Node.js Schedulers](https://blog.logrocket.com/comparing-best-node-js-schedulers/) — scheduler feature comparison

---
*Research completed: 2026-03-23*
*Ready for roadmap: yes*
