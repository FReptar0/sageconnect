# Phase 8: Scheduler + Real-Time Layer - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace Windows Task Scheduler with internal node-cron scheduling, add SSE progress streaming for running operations, and implement an OperationManager for concurrency control. No web UI changes in this phase — just the backend scheduling, real-time, and system API endpoints.

</domain>

<decisions>
## Implementation Decisions

### Cron schedule config
- Configurable via .env: `CRON_SCHEDULE='*/15 * * * *'` loaded through config.js
- Single schedule for all operations — one cron job runs `forResponse()` which does everything sequentially (same as today, just internalized)
- 5-second delays between operations made configurable via `OPERATION_DELAY_MS` in .env (default 5000)
- node-cron v4 with `noOverlap: true` to prevent concurrent cron runs

### Concurrency control (OperationManager)
- Block with 409 Conflict when a web user triggers an operation that's already running
- Per-operation-type locking (e.g., one lock for 'payment-reconciliation', one for 'po-upload')
- The entire cron cycle acquires a single `background-cycle` lock — all web requests for any operation get 409 while cron runs
- Simple and safe for financial data integrity — no queuing, no parallel execution

### SSE progress detail
- Per-step progress: stream events like 'buildProviders', 'downloadCFDI', 'checkPayments' per tenant during cron cycle
- SSE available for background cycle + manually triggered long-running operations (reconciliation, UUID repair)
- Events: `{ type: 'progress'|'complete'|'error', operation, tenant, step, message, timestamp }`
- Requires modifying `forResponse()` to emit progress events at each step

### Schedule visibility
- GET /api/schedule: returns cron expression, next run time, last run result
- GET /api/schedule/history: in-memory storage of last 24 hours of executions (~96 runs at 15-min intervals)
- GET /api/operations/status: separate endpoint for currently running operations (SYS-04)
- GET /api/operations/:operationId/stream: SSE endpoint for real-time progress (SYS-05)
- POST /api/schedule/:taskId/trigger: manually triggers a scheduled task (returns 409 if already running)

### Claude's Discretion
- OperationManager implementation details (Map-based locks, EventEmitter for SSE)
- How forResponse() emits progress events (callback, EventEmitter, or direct SSE write)
- In-memory history storage data structure (array, ring buffer, etc.)
- SSE reconnection and cleanup strategy

</decisions>

<specifics>
## Specific Ideas

- The cron cycle should feel like a single atomic operation from the web UI perspective — when it's running, all manual triggers return 409 with "Background cycle in progress" message
- SSE progress should be detailed enough that Phase 9 (Web UI) can show "Processing tenant 2/3: downloadCFDI" in the schedule dashboard
- The 5-second delays exist between portal API calls — making them configurable lets deployments tune performance vs rate-limiting

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/background.js`: `forResponse()` is the main loop — 7 sequential ops per tenant with 5s delays. Needs modification to emit progress events
- `src/utils/ResultEnvelope.js`: All operations already return envelopes — SSE can forward these
- `src/routes/system-routes.js`: Already has GET /health endpoint — add schedule/operations endpoints here
- `src/middleware/async-handler.js`: Reuse for new route handlers
- `src/middleware/api-key.js`: Apply to manual trigger endpoint

### Established Patterns
- Express Router split by domain (Phase 7) — schedule routes go in system-routes.js
- Global middleware in server.js, per-route middleware in route files
- CommonJS module.exports everywhere
- Winston logging via logGenerator() for all operational events

### Integration Points
- `src/index.js`: Currently starts server + calls startBackgroundProcesses(). Will need to initialize cron scheduler instead
- `src/background.js`: forResponse() called once per cycle — needs to emit progress events and acquire/release OperationManager locks
- `src/routes/routes.js`: Mount system-routes with schedule endpoints
- All API endpoints (Phase 7): Need to check OperationManager before executing scripts

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-scheduler-real-time-layer*
*Context gathered: 2026-03-23*
