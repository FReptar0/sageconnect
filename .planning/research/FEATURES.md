# Feature Landscape

**Domain:** Always-on Node.js service with operational web UI for Sage 300 ERP integration
**Researched:** 2026-03-23
**Mode:** Ecosystem (features for v2.0 always-on service milestone)

## Table Stakes

Features users expect. Missing = product feels incomplete or defeats the purpose of always-on.

### 1. CLI Scripts as REST Endpoints

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| POST endpoints for destructive operations (upload, repair, update) | Users need to trigger operations without SSH/RDP access to server | Medium | 13 scripts already have exported `main()` functions; wrap in Express route handlers |
| GET endpoints for read-only operations (diagnostics, queries) | Diagnostics are the most frequent manual operation | Low | Pure queries, no side effects |
| Tenant index parameter in all endpoints | Multi-tenant is core architecture; every script takes `--index=N` | Low | Already parameterized in every script |
| Dry-run mode for destructive endpoints | Scripts already support `--dry-run`/`--upload` flags; API must preserve safety | Low | Map to query param `?dryRun=true`, default true |
| Structured JSON responses (not console output) | CLI scripts write to `console.log/table`; API consumers need parseable JSON | Medium | Biggest adaptation: scripts currently output to stdout, need to return data objects instead |
| Request validation with Joi | Already using Joi for PO validation; consistent validation on API inputs | Low | Extend existing Joi usage to request schemas |

### 2. Real-Time Operation Feedback in Web UI

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Operation progress during long-running tasks | Payment reconciliation and PO uploads take 30s-5min; blank screen = "is it working?" | Medium | SSE (Server-Sent Events) is the right fit -- one-way server-to-client, built-in reconnect, works with Express |
| Live log streaming for active operations | Existing dashboard shows log files; always-on service should show live output | Medium | SSE endpoint per operation, pipe log events to connected clients |
| Operation status indicators (running/idle/error) | Users need to know if background processes are currently executing | Low | In-memory state tracker, exposed via GET endpoint |
| Operation completion notifications | Users who triggered an operation need to know when it finishes | Low | SSE sends completion event; UI shows toast/alert |

### 3. Scheduled Task Management via Web

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| View current schedule (next execution times) | Replaces Windows Task Scheduler visibility | Low | node-cron exposes schedule metadata |
| View last execution result per task | "Did the 10:15 run succeed?" is the most asked question | Low | Store last result in memory + log |
| Manual trigger of scheduled tasks | "Run it now" without waiting for next cycle | Low | Same endpoint as REST API, but triggered from schedule UI |
| View execution history (last N runs) | Audit trail of what ran and when | Medium | Requires lightweight persistence -- append to daily log files or in-memory ring buffer |

### 4. Payment Audit Views

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Payment reconciliation report (5 categories) | Core business value -- categorized view of ready/missing-providerid/missing-uuid/not-in-portal/provider-mismatch | Medium | `classifyPayments` already returns structured categories; surface via API + render in UI |
| Payment status tracking (uploaded/pending/failed) | Control table `fesaPagosFocaltec` already tracks status; expose it | Low | SQL query to control table, render as filterable table |
| Payment detail drill-down (invoices per payment) | Each PY payment has multiple linked invoices; users need to see the breakdown | Medium | Already queried in reconciliation script; expose per-payment detail endpoint |
| Upload history with portal response | "Was PY0061652 uploaded? What did the portal say?" | Low | Control table has `idFocaltec` column; combine with log data |

### 5. PO Management Views

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| PO status overview (posted/error/pending) | `fesaOCFocaltec` control table tracks PO lifecycle | Low | SQL query + render as table with status badges |
| PO diagnostic from web (single PO lookup) | `po-diagnostic.js` is the most-used CLI script; should be one click | Low | Already exported as `diagnosticPO()` function |
| Today's authorized POs | `getAuthorizedPOsToday()` already exists; show in dashboard | Low | Direct function call, render as list |
| PO validation preview before upload | `po-query.js` does dry-run validation; expose in UI | Medium | Needs structured return from `testSpecificPurchaseOrders` |

## Differentiators

Features that set the operational UI apart from basic log viewers. Not expected from "just exposing scripts," but valued by operations team.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Auto-resolution dashboard (PROVIDERID fixes) | Shows auto-resolved payments in real-time; reduces manual intervention tracking | Low | `autoResolvedSet` already tracked in reconciliation; surface in payment view |
| UUID repair workflow (scan/repair/upload pipeline) | `payment-uuid-repair.js` has 3-stage pipeline; web UI guides through stages | High | Complex state machine: scan results -> select -> repair -> verify -> upload |
| Batch operation progress with per-item status | "3/20 payments uploaded, 2 failed, 15 remaining" in real-time | Medium | SSE + per-item result tracking during batch uploads |
| Cross-entity diagnostic (payment -> invoices -> PO -> portal) | Trace a problem from payment through invoices to POs and portal status | High | Joins across multiple data sources; requires multiple queries |
| Schedule override/pause | Temporarily disable the 15-minute cycle during maintenance without stopping the service | Low | Toggle flag on scheduler; useful during Sage maintenance windows |
| Tenant switcher in UI | Multi-tenant support visible in UI; switch context without URL params | Low | Dropdown in navbar, stores selected tenant in session |
| Operation queue with concurrency control | Prevent two users from running payment upload simultaneously | Medium | In-memory semaphore per operation type; reject with 409 if already running |

## Anti-Features

Features to explicitly NOT build. Based on project constraints and "Out of Scope" from PROJECT.md.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Authentication/authorization system | Internal tool on local network; auth adds complexity with zero security value here | Trust network isolation; document that it must not be exposed to internet |
| Direct database editing from UI | SQL injection risk; Sage 300 data integrity depends on business logic | Read-only views + operations through existing validated business logic in scripts |
| Multi-environment support (dev/staging/prod) | Single deployment target (Windows Server); no staging exists | .env per deployment is sufficient |
| CRUD admin panel for config/tenants | AdminJS-style panels are for data management apps; this is an operations dashboard | Edit `.env` file directly; service restarts on deploy |
| WebSocket-based real-time (Socket.io) | Over-engineered for one-way progress updates; adds dependency | Use SSE (Server-Sent Events) -- native browser API, no client library needed |
| SPA framework (React/Vue/Angular) | Current dashboard is vanilla HTML+Bootstrap; team doesn't use SPAs; build tooling overhead | Extend existing Bootstrap 5.3 dashboard with vanilla JS; use htmx for dynamic interactions if needed |
| Persistent job queue (Redis/MongoDB) | No Redis or MongoDB in infrastructure; adding database for job queue is overkill | In-memory scheduling with node-cron; log persistence via existing log files |
| GraphQL API | Only internal consumers; REST is simpler and team already knows Express | Stick with REST endpoints following existing route patterns |
| Internationalization (i18n) | Team and users are Spanish-speaking; app already uses Spanish throughout | Keep Spanish; English in code comments only |

## Feature Dependencies

```
[Schedule Management] --> [REST API Endpoints] (scheduled tasks call the same endpoints)
[REST API Endpoints] --> [Structured JSON Returns] (scripts must return data, not just console.log)
[Real-Time Feedback] --> [REST API Endpoints] (SSE wraps around endpoint execution)
[Payment Audit Views] --> [REST API: Payment Endpoints] (views consume payment API)
[PO Management Views] --> [REST API: PO Endpoints] (views consume PO API)
[Operation Queue] --> [REST API Endpoints] (semaphore wraps endpoint handlers)
[UUID Repair Workflow] --> [REST API: Payment Endpoints] + [Real-Time Feedback]
[Batch Progress] --> [Real-Time Feedback] (SSE streams per-item results)
[Tenant Switcher] --> [REST API Endpoints] (all endpoints accept tenant parameter)
```

**Critical dependency chain:**
```
1. Script refactor (return data, not console.log)
   |
   v
2. REST API endpoints (wrap refactored scripts)
   |
   v
3. SSE real-time layer (wraps endpoint execution)
   |       |
   v       v
4a. Web UI views     4b. Schedule management
```

## MVP Recommendation

**Phase 1 -- Foundation:** Refactor scripts to return structured data + REST API endpoints

Prioritize:
1. **Structured returns from scripts** -- This is the prerequisite for everything else. Scripts currently do `console.log()` and return nothing useful. They need to return result objects.
2. **REST API for payment operations** -- Payments are the highest-value, most-frequent manual operations (reconciliation, diagnostics, UUID repair scan)
3. **REST API for PO operations** -- PO diagnostics and queries are the second most frequent operations
4. **Basic operation status** -- GET /api/operations/status showing running/idle per operation

**Phase 2 -- Real-Time + Scheduling:** SSE layer + node-cron integration

Prioritize:
1. **node-cron scheduler** replacing Windows Task Scheduler (the "always-on" core)
2. **SSE for operation progress** during long-running tasks
3. **Schedule management API** (view schedule, view last results, manual trigger)

**Phase 3 -- Web UI:** Operational views built on the API

Prioritize:
1. **Payment audit view** -- reconciliation report + status table + drill-down
2. **PO management view** -- status overview + diagnostic + authorized today
3. **Schedule dashboard** -- next runs, last results, manual trigger buttons
4. **Tenant switcher** in navbar

**Defer:**
- UUID repair workflow UI (High complexity, low frequency -- CLI is adequate for now)
- Cross-entity diagnostic (High complexity -- can be added as enhancement later)
- Batch progress with per-item SSE (Medium complexity -- basic completion notification is sufficient for MVP)

## Script-to-Endpoint Mapping

All 13 existing scripts mapped to proposed REST endpoints:

### Payment Operations
| Script | Proposed Endpoint | Method | Params |
|--------|-------------------|--------|--------|
| `payment-reconciliation.js` | `/api/payments/reconciliation` | POST | `tenantIndex`, `from`, `batchLimit`, `pyFilter`, `upload` |
| `payment-uuid-diagnostic.js` | `/api/payments/uuid-diagnostic` | GET | `tenantIndex`, `docNumbers[]` |
| `payment-uuid-repair.js` (scan) | `/api/payments/uuid-repair/scan` | POST | `tenantIndex`, `months` |
| `payment-uuid-repair.js` (repair) | `/api/payments/uuid-repair/repair` | POST | `tenantIndex`, `apply`, `batch`, `pyFilter` |
| `payment-uuid-repair.js` (upload) | `/api/payments/uuid-repair/upload` | POST | `tenantIndex`, `apply`, `batch`, `pyFilter` |
| `portal-payments-generator.js` | `/api/payments/generate` | POST | `tenantIndex`, `pyFilter`, `dateFilter`, `post` |
| `get-payment-cfdis.js` | `/api/payments/cfdis` | GET | `tenantIndex` |

### PO Operations
| Script | Proposed Endpoint | Method | Params |
|--------|-------------------|--------|--------|
| `po-diagnostic.js` | `/api/pos/diagnostic` | GET | `poNumber`, `database`, `empresa` |
| `po-query.js` | `/api/pos/query` | GET | `poNumbers[]`, `database`, `tenantIndex` |
| `po-upload.js` | `/api/pos/upload` | POST | `poNumbers[]`, `database`, `tenantIndex` |
| `po-update.js` | `/api/pos/update` | PUT | `poNumber`, `database`, `tenantIndex`, `dryRun` |
| `po-address-diagnostic.js` | `/api/pos/address-diagnostic` | GET | `poNumber`, `database` |
| `po-payment-form-diagnostic.js` | `/api/pos/payment-form-diagnostic` | GET | `poNumber`, `database` |
| `upload-authorized-pos.js` | `/api/pos/upload-authorized` | POST | `tenantIndex` |
| `test-order-lifecycle.js` | `/api/pos/lifecycle` | POST | `action`, `poNumber`, `tenantIndex` |

### System Operations
| Feature | Proposed Endpoint | Method | Notes |
|---------|-------------------|--------|-------|
| Schedule status | `/api/schedule` | GET | List all scheduled tasks with next run time |
| Schedule trigger | `/api/schedule/:taskId/trigger` | POST | Manual trigger of a specific scheduled task |
| Schedule history | `/api/schedule/history` | GET | Last N executions per task |
| Operation status | `/api/operations/status` | GET | Which operations are currently running |
| SSE progress stream | `/api/operations/:operationId/stream` | GET (SSE) | Real-time progress for a running operation |

## Sources

- Project codebase analysis: `src/scripts/` (13 scripts), `src/routes/routes.js`, `src/background.js`, `src/config.js`
- [Better Stack: Schedulers in Node.js Comparison](https://betterstack.com/community/guides/scaling-nodejs/best-nodejs-schedulers/)
- [Better Stack: Job Scheduling with Node-cron](https://betterstack.com/community/guides/scaling-nodejs/node-cron-scheduled-tasks/)
- [DigitalOcean: Server-Sent Events in Node.js](https://www.digitalocean.com/community/tutorials/nodejs-server-sent-events-build-realtime-app)
- [DEV.to: Real-time Log Streaming with SSE](https://dev.to/manojspace/real-time-log-streaming-with-nodejs-and-react-using-server-sent-events-sse-48pk)
- [Yodaplus: Audit Trails in ERP](https://yodaplus.com/blog/audit-trails-in-erp-how-to-design-them-right/)
- [Stripe: ERP Payment Integration Guide](https://stripe.com/resources/more/erp-payment-integration-a-quick-start-guide-for-businesses)
- [Cronicle: Task Scheduler with Web UI](https://cronicle.net/)
- [LogRocket: Comparing Node.js Schedulers](https://blog.logrocket.com/comparing-best-node-js-schedulers/)
