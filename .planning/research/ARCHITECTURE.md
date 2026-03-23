# Architecture Patterns

**Domain:** Always-on Node.js service with operational web UI
**Researched:** 2026-03-23

## Recommended Architecture

### Current Architecture (v1.1)
```
Windows Task Scheduler (every 15 min)
  |
  v
index.js --> startServer(3030) + startBackgroundProcesses()
  |                                    |
  v                                    v
server.js (Express)              background.js (sequential pipeline)
  |                                    |
  v                                    v
routes.js (dashboard API)        forResponse() --> startChildProcess()
  |                                    |
  v                                    v
LogDashboardService              7 controllers (per tenant, sequential)
AutoShutdownService              5-second delays between each
```

### Target Architecture (v2.0)
```
Servy (Windows Service) --> Always-on Node.js process
  |
  v
index.js --> startServer(3030)
  |
  +-- Express Server
  |     |
  |     +-- /api/dashboard/*          (existing read-only dashboard)
  |     +-- /api/payments/*           (NEW: payment operations)
  |     +-- /api/pos/*                (NEW: PO operations)
  |     +-- /api/schedule/*           (NEW: schedule management)
  |     +-- /api/operations/*         (NEW: operation status + SSE)
  |     +-- / (public/index.html)     (existing + NEW views)
  |
  +-- SchedulerService (node-cron)
  |     |
  |     +-- Every 15 min: forResponse() pipeline
  |     +-- After pipeline: startChildProcess()
  |     +-- Tracks: last run, next run, result per task
  |
  +-- OperationManager (in-memory)
        |
        +-- Tracks running operations
        +-- Provides SSE event streams
        +-- Enforces concurrency limits (1 per operation type)
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Express Server | HTTP routing, static files, middleware | All components via request handlers |
| Route Handlers (payment, PO, schedule) | Request validation, parameter mapping, response formatting | OperationManager, ScriptAdapters |
| Script Adapters | Wrap existing script functions to return structured data instead of console.log | Existing controllers/scripts, SQL Server, Portal API |
| SchedulerService | Cron-based task scheduling, execution tracking | OperationManager, Script Adapters |
| OperationManager | Concurrency control, SSE event broadcasting, operation state tracking | Route Handlers, SchedulerService |
| Existing Controllers | Business logic for CFDI, payments, POs | SQL Server (mssql), Portal API (axios) |
| LogDashboardService | Log file reading and aggregation (existing) | File system |
| Config | Centralized environment config (existing) | All components |

### Data Flow

**Manual operation (user triggers from web UI):**
```
Browser --> POST /api/payments/reconciliation
  --> Route validates params (Joi)
  --> OperationManager.start('payment-reconciliation', params)
    --> Check: is another reconciliation running? If yes, 409
    --> Create SSE channel for this operation
    --> Call paymentReconciliationAdapter(params)
      --> classifyPayments() (existing logic)
      --> Emit progress events to SSE channel
      --> Return structured result
    --> Store result in execution history
  --> Return 202 Accepted + operationId
  --> Client opens SSE: GET /api/operations/{operationId}/stream
  --> Receives progress events until completion
```

**Scheduled operation (cron triggers):**
```
node-cron fires at :00, :15, :30, :45
  --> SchedulerService.execute('forResponse')
    --> OperationManager.start('scheduled-forResponse', {auto: true})
      --> Runs forResponse() pipeline
      --> Logs progress
    --> OperationManager.complete('scheduled-forResponse', result)
  --> SchedulerService records execution result
  --> If SSE clients watching schedule: emit update
```

## Patterns to Follow

### Pattern 1: Script Adapter
**What:** Thin wrapper around existing script functions that captures console output and returns structured data.
**When:** Every time a CLI script is exposed as an API endpoint.
**Why:** Scripts currently use `console.log()` for output. Rewriting them is risky and unnecessary. Adapters intercept output and structure it.

```javascript
// src/adapters/paymentReconciliationAdapter.js
const { classifyPayments, uploadBatch } = require('../scripts/payment-reconciliation');

async function runReconciliation(params, emitProgress) {
  emitProgress({ step: 'fetching-portal', message: 'Fetching portal invoices...' });

  // Call existing function -- it already returns structured data
  const { categories, autoResolvedCount, autoResolvedSet } =
    await classifyPayments(deduped, portalUuidMap, params.index, db);

  emitProgress({ step: 'classified', message: `Classified ${totalCount} payments` });

  return {
    success: true,
    categories: {
      ready: categories.ready.length,
      no_providerid: categories.no_providerid.length,
      no_uuid: categories.no_uuid.length,
      not_in_portal: categories.not_in_portal.length,
      provider_mismatch: categories.provider_mismatch.length,
    },
    autoResolved: autoResolvedCount,
    details: categories
  };
}
```

### Pattern 2: Operation Manager (Singleton)
**What:** In-memory tracker for running operations with concurrency control and SSE broadcasting.
**When:** Any long-running operation that needs progress feedback.
**Why:** Prevents duplicate operations, provides consistent status tracking, enables SSE.

### Pattern 3: SSE Endpoint
**What:** Standard SSE endpoint pattern for Express.
**When:** Any endpoint that needs to stream progress to the browser.

```javascript
router.get('/api/operations/:operationId/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const { operationId } = req.params;
  operationManager.subscribe(operationId, res);
  req.on('close', () => { operationManager.unsubscribe(operationId, res); });
});
```

### Pattern 4: Route Organization
**What:** Group routes by domain into separate files.

```
src/routes/
  routes.js          (existing dashboard + email routes)
  paymentRoutes.js   (NEW: /api/payments/*)
  poRoutes.js        (NEW: /api/pos/*)
  scheduleRoutes.js  (NEW: /api/schedule/*)
  operationRoutes.js (NEW: /api/operations/*)
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Rewriting Script Logic in Route Handlers
**What:** Duplicating SQL queries and business logic from scripts directly in API route handlers.
**Why bad:** Two sources of truth; bugs fixed in one place but not the other.
**Instead:** Use the adapter pattern -- wrap existing exported functions.

### Anti-Pattern 2: Blocking the Event Loop During Long Operations
**What:** Running a synchronous 2-minute reconciliation inside a request handler.
**Why bad:** Express cannot serve other requests; client may timeout; no progress feedback.
**Instead:** Return 202 Accepted immediately with an operationId; run asynchronously; provide SSE.

### Anti-Pattern 3: Global State for Operation Tracking
**What:** Using `global.isRunning = true` (like existing `global.childProcessComplete`).
**Why bad:** No per-operation tracking, no concurrent operation support, no cleanup on crash.
**Instead:** Use OperationManager class with proper Map-based tracking.

### Anti-Pattern 4: Console.log as API Response
**What:** Calling a script function and trying to capture its console.log output as the API response.
**Why bad:** Console output is unstructured text mixed with progress messages, errors, and results.
**Instead:** Refactor script functions to return structured objects alongside console.log.

### Anti-Pattern 5: Exposing Raw SQL Error Messages
**What:** Returning `err.message` from SQL errors directly in JSON responses.
**Why bad:** Leaks table names, column names, and query structure.
**Instead:** Log full error server-side; return generic error message + error code in API response.

## Scalability Considerations

| Concern | Current (1 server) | Future (if needed) |
|---------|---------------------|-------------------|
| Concurrent users | 1-5 operations team members; in-memory state is fine | If >20 concurrent: add request queuing |
| Background task conflicts | OperationManager prevents duplicate ops | Sufficient for single-server deployment |
| Log file growth | Daily rotation already in place | Add log cleanup/archival if disk fills |
| SSE connections | Few concurrent clients; no concern | If >50 clients: use SSE broadcast channels |

## Sources

- Project codebase: `src/index.js`, `src/background.js`, `src/server.js`, `src/routes/routes.js`
- [DigitalOcean: SSE in Node.js](https://www.digitalocean.com/community/tutorials/nodejs-server-sent-events-build-realtime-app)
- [DEV.to: Real-time Log Streaming with SSE](https://dev.to/manojspace/real-time-log-streaming-with-nodejs-and-react-using-server-sent-events-sse-48pk)
- [Modern Node.js Patterns for 2025](https://kashw1n.com/blog/nodejs-2025/)
