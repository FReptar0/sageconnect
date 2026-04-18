# Phase 8: Scheduler + Real-Time Layer - Research

**Researched:** 2026-03-23
**Domain:** Task scheduling (node-cron), Server-Sent Events (SSE), concurrency control (OperationManager)
**Confidence:** HIGH

## Summary

Phase 8 replaces Windows Task Scheduler with an internal node-cron v4 scheduler, adds an OperationManager for concurrency control (per-operation-type locks + a global background-cycle lock), and introduces Server-Sent Events (SSE) for real-time progress streaming. The existing `forResponse()` function in `src/background.js` already runs 7 sequential operations per tenant with 5-second delays -- this phase internalizes that cycle into a cron job, emits progress events at each step, and exposes 5 new system API endpoints for schedule visibility and operation status.

node-cron v4.2.1 (latest stable) provides built-in `noOverlap: true` for preventing concurrent cron runs, a `getNextRun()` method for schedule visibility, a `getStatus()` state machine (`stopped`/`idle`/`running`/`destroyed`), and lifecycle events (`execution:started`, `execution:finished`, `execution:failed`, `execution:overlap`). These features map directly to the phase requirements.

SSE is the correct choice for one-way progress streaming (explicitly decided: no WebSocket/Socket.io). Native Express SSE requires only headers (`text/event-stream`, `no-cache`, `keep-alive`) and `res.write()` -- no library needed. The OperationManager will use Node.js `EventEmitter` as the bridge between background operations and SSE connections.

**Primary recommendation:** Build three new modules -- `OperationManager` (Map-based locks + EventEmitter), `CronScheduler` (wraps node-cron v4 with schedule visibility), and SSE middleware -- then modify `forResponse()` to emit progress events through the OperationManager at each step.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Configurable via .env: `CRON_SCHEDULE='*/15 * * * *'` loaded through config.js
- Single schedule for all operations -- one cron job runs `forResponse()` which does everything sequentially (same as today, just internalized)
- 5-second delays between operations made configurable via `OPERATION_DELAY_MS` in .env (default 5000)
- node-cron v4 with `noOverlap: true` to prevent concurrent cron runs
- Block with 409 Conflict when a web user triggers an operation that's already running
- Per-operation-type locking (e.g., one lock for 'payment-reconciliation', one for 'po-upload')
- The entire cron cycle acquires a single `background-cycle` lock -- all web requests for any operation get 409 while cron runs
- Per-step progress: stream events like 'buildProviders', 'downloadCFDI', 'checkPayments' per tenant during cron cycle
- SSE available for background cycle + manually triggered long-running operations (reconciliation, UUID repair)
- Events: `{ type: 'progress'|'complete'|'error', operation, tenant, step, message, timestamp }`
- Requires modifying `forResponse()` to emit progress events at each step
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

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-04 | node-cron v4 scheduler replaces Windows Task Scheduler with noOverlap guard | node-cron v4.2.1 provides `noOverlap: true` option, `getNextRun()`, lifecycle events, and state machine (`stopped`/`idle`/`running`/`destroyed`) |
| INFRA-05 | Background process loop refactored from "run once and exit" to "scheduled recurring job" | `cron.schedule()` auto-starts the task; `forResponse()` already structured as a single async function -- wrap it as the cron callback |
| SYS-01 | GET /api/schedule returns all scheduled tasks with next run times | `cron.getTasks()` returns Map of ScheduledTasks; each has `getNextRun()` returning `Date \| null` and `getStatus()` returning state string |
| SYS-02 | POST /api/schedule/:taskId/trigger manually triggers a scheduled task | OperationManager acquires lock, calls `task.execute()` on the ScheduledTask, returns 409 if lock already held |
| SYS-03 | GET /api/schedule/history returns last N executions per task | In-memory ring buffer storing execution records (start, end, success, errors) -- cleared beyond 24 hours |
| SYS-04 | GET /api/operations/status returns which operations are currently running | OperationManager exposes `getRunningOperations()` from its locks Map |
| SYS-05 | GET /api/operations/:operationId/stream SSE endpoint for real-time operation progress | EventEmitter-based SSE: OperationManager emits progress events, SSE endpoint subscribes to specific operationId |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-cron | 4.2.1 | Cron-based task scheduling | User-locked decision; provides noOverlap, getNextRun(), lifecycle events out of the box |
| events (Node.js built-in) | N/A | EventEmitter for SSE bridge | No external dependency; standard Node.js pattern for pub/sub within a process |
| crypto (Node.js built-in) | N/A | UUID generation for operation IDs | `crypto.randomUUID()` available in Node.js 16+ |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| express | 4.21.1 (existing) | HTTP framework + SSE endpoints | Already installed; SSE needs no additional library |
| joi | 17.13.3 (existing) | Request validation for new endpoints | Already installed; validate trigger params |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node-cron | croner | croner is newer/faster, but node-cron is the user-locked decision with a simpler API |
| Native SSE | better-sse library | better-sse adds nice abstractions but an extra dependency for what amounts to 20 lines of header setup |
| EventEmitter | RxJS/streams | Massively over-engineered for this use case; EventEmitter is the standard Node.js pattern |

**Installation:**
```bash
npm install node-cron@4
```

No other new dependencies needed -- SSE is native Express, EventEmitter is built-in.

## Architecture Patterns

### Recommended Project Structure
```
src/
  services/
    OperationManager.js     # Concurrency locks + EventEmitter for SSE
    CronScheduler.js        # Wraps node-cron, manages schedule lifecycle
  routes/
    schedule-routes.js      # GET /schedule, POST /schedule/:taskId/trigger, GET /schedule/history
    operations-routes.js    # GET /operations/status, GET /operations/:operationId/stream (SSE)
    schemas/
      schedule-schemas.js   # Joi schemas for trigger endpoint
  background.js             # Modified forResponse() emitting progress events
  config.js                 # Add CRON_SCHEDULE and OPERATION_DELAY_MS
```

### Pattern 1: OperationManager (Singleton with EventEmitter)
**What:** Central concurrency controller that manages per-operation locks and emits progress events for SSE subscribers.
**When to use:** Any operation that needs concurrency protection and/or progress streaming.
**Example:**
```javascript
// Source: Custom pattern based on Node.js EventEmitter
const { EventEmitter } = require('events');

class OperationManager extends EventEmitter {
  constructor() {
    super();
    this.locks = new Map();       // operationType -> { operationId, startedAt, ... }
    this.history = [];            // Execution history ring buffer
  }

  acquireLock(operationType, operationId) {
    if (this.locks.has('background-cycle') || this.locks.has(operationType)) {
      return false; // Already running
    }
    this.locks.set(operationType, { operationId, startedAt: new Date() });
    return true;
  }

  releaseLock(operationType) {
    this.locks.delete(operationType);
  }

  emitProgress(operationId, event) {
    // event: { type, operation, tenant, step, message, timestamp }
    this.emit(`progress:${operationId}`, event);
  }

  getRunningOperations() {
    return Object.fromEntries(this.locks);
  }
}

// Singleton export
module.exports = new OperationManager();
```

### Pattern 2: SSE Endpoint with EventEmitter Subscription
**What:** Express route handler that sets SSE headers, subscribes to OperationManager events, and cleans up on disconnect.
**When to use:** GET /api/operations/:operationId/stream
**Example:**
```javascript
// Source: MDN SSE spec + Express pattern
router.get('/:operationId/stream', (req, res) => {
  const { operationId } = req.params;

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // Disable proxy buffering
  });
  res.flushHeaders();

  // Send retry interval (10 seconds)
  res.write('retry: 10000\n\n');

  // Subscribe to progress events
  const handler = (event) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  operationManager.on(`progress:${operationId}`, handler);

  // Cleanup on client disconnect
  req.on('close', () => {
    operationManager.off(`progress:${operationId}`, handler);
    res.end();
  });
});
```

### Pattern 3: Cron Scheduler Wrapper
**What:** Thin wrapper around node-cron that integrates with OperationManager and config.
**When to use:** Initialization in index.js, replacing the direct `startBackgroundProcesses()` call.
**Example:**
```javascript
// Source: node-cron v4 API
const cron = require('node-cron');
const config = require('../config');
const operationManager = require('./OperationManager');
const { forResponse } = require('../background');

function initScheduler() {
  const task = cron.schedule(config.schedule.cronExpression, async () => {
    const operationId = crypto.randomUUID();
    operationManager.acquireLock('background-cycle', operationId);
    try {
      await forResponse({ operationId, emitter: operationManager });
    } finally {
      operationManager.releaseLock('background-cycle');
      operationManager.addHistory({ operationId, /* ... */ });
    }
  }, {
    name: 'background-cycle',
    noOverlap: true,
    timezone: config.app.timezone,
  });

  return task;
}
```

### Pattern 4: Modified forResponse() with Progress Emission
**What:** Modify the existing loop to emit progress events at each step via a callback/emitter.
**When to use:** Both cron execution and manual triggers.
**Example:**
```javascript
// Source: Modification of existing src/background.js
async function forResponse(options = {}) {
  const { operationId = null, emitter = null } = options;
  const delay = config.schedule?.operationDelayMs ?? 5000;

  for (let i = 0; i < tenantIds.length; i++) {
    const tenantId = tenantIds[i];

    // Emit progress before each step
    if (emitter && operationId) {
      emitter.emitProgress(operationId, {
        type: 'progress',
        operation: 'background-cycle',
        tenant: tenantId,
        step: 'buildProviders',
        message: `Iniciando buildProvidersXML para tenant ${i}`,
        timestamp: new Date().toISOString(),
      });
    }

    await buildProvidersXML(i);
    await new Promise(resolve => setTimeout(resolve, delay));

    // ... repeat for each operation
  }
}
```

### Anti-Patterns to Avoid
- **Global mutable state for locks:** Do NOT use plain global variables for lock state. Use a singleton class with clear acquire/release semantics. Race conditions are unlikely in single-threaded Node.js but the code must be understandable.
- **res.send() or res.end() during SSE streaming:** These terminate the connection. Only use `res.write()`. Call `res.end()` only in the cleanup handler when the client disconnects or the operation completes.
- **Forgetting SSE cleanup:** Every `operationManager.on()` in an SSE handler MUST have a corresponding `operationManager.off()` in the `req.on('close')` handler. Leaked listeners cause memory leaks proportional to connection count.
- **Buffered SSE behind compression:** If compression middleware is active, SSE data gets buffered. Use `res.flush()` after each write, or disable compression for SSE routes. The current server.js does not use compression, so this is not an immediate concern.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron expression parsing | Custom parser | node-cron v4 `validate()` | Cron syntax has edge cases (day-of-week vs day-of-month, month names, etc.) |
| Next run time calculation | Date arithmetic | node-cron `getNextRun()` | Handles timezone, DST, and expression-to-date conversion correctly |
| Overlap prevention | Custom timers/flags | node-cron `noOverlap: true` | Built into the scheduler; fires `execution:overlap` event for logging |
| SSE protocol formatting | Custom string builder | Use a small helper that formats `event:` + `data:` + `\n\n` | The SSE spec is simple but the double-newline termination is easy to get wrong |
| UUID generation | Custom ID scheme | `crypto.randomUUID()` | Built into Node.js, cryptographically random, standard format |

**Key insight:** node-cron v4 already handles the two hardest parts (overlap prevention and next-run calculation). The OperationManager and SSE layer are straightforward event plumbing -- keep them simple.

## Common Pitfalls

### Pitfall 1: SSE Connection Limits (HTTP/1.1)
**What goes wrong:** Browsers limit SSE to 6 concurrent connections per domain on HTTP/1.1. If the web UI opens multiple SSE streams, it can exhaust the limit.
**Why it happens:** The SSE spec over HTTP/1.1 has a hard limit in all browsers.
**How to avoid:** This project has 1-2 internal users, so unlikely to hit the limit. But design the SSE endpoint so that a single stream can deliver progress for ALL operations (use event types to distinguish). The Phase 9 web UI should use a single EventSource if possible.
**Warning signs:** SSE connections hang or fail silently after 6 tabs are open.

### Pitfall 2: Memory Leak from Orphaned EventEmitter Listeners
**What goes wrong:** If SSE handler subscribes to OperationManager events but fails to unsubscribe on disconnect, listeners accumulate.
**Why it happens:** Missing `req.on('close', ...)` cleanup, or errors before cleanup runs.
**How to avoid:** Always pair `on()` with `off()` in a `req.on('close')` handler. Set `operationManager.setMaxListeners()` to a reasonable value (e.g., 20) and log warnings when exceeded.
**Warning signs:** Node.js "MaxListenersExceededWarning" in console.

### Pitfall 3: Cron Timezone Misconfiguration
**What goes wrong:** Cron runs at unexpected times because the timezone defaults to UTC instead of `America/Mexico_City`.
**Why it happens:** node-cron defaults to system timezone, but production Windows Server may have a different system TZ than expected.
**How to avoid:** Always pass `timezone: config.app.timezone` to `cron.schedule()`. The TIMEZONE env var is already required by config.js.
**Warning signs:** Schedule history shows runs at wrong hours.

### Pitfall 4: 409 Response During Cron Cycle Blocks ALL Manual Operations
**What goes wrong:** User tries to run a manual reconciliation during a cron cycle and gets 409 even though reconciliation is not currently executing (it might be on the "buildProviders" step).
**Why it happens:** The `background-cycle` lock blocks ALL operations by design -- this is the user's locked decision.
**How to avoid:** This is correct behavior per the user decision. The 409 response body should include a clear message: "Background cycle in progress" with the current step information. Phase 9 UI should display this clearly.
**Warning signs:** Not a bug -- this is by design for financial data integrity.

### Pitfall 5: History Array Growing Unbounded
**What goes wrong:** If the history cleanup mechanism fails or is not implemented, the array grows forever.
**Why it happens:** No periodic pruning or size limit on the in-memory history.
**How to avoid:** Use a ring buffer (fixed-size circular array) OR prune entries older than 24 hours on each write. At 15-min intervals, 24 hours = 96 entries -- a fixed array of 100 is simple and bounded.
**Warning signs:** Memory usage slowly increases over days/weeks.

### Pitfall 6: forResponse() Error Handling with Progress Events
**What goes wrong:** If an operation throws mid-cycle, the SSE stream might not receive the error event, leaving the UI in a "perpetually loading" state.
**Why it happens:** The catch block in forResponse() continues to the next tenant but doesn't emit a progress error event.
**How to avoid:** Wrap each operation step in try/catch and emit both error events AND continue-next-tenant events. Always emit a `complete` event at the very end, even if there were errors during the cycle.
**Warning signs:** UI shows "running..." forever after an error.

## Code Examples

Verified patterns from official sources and codebase analysis:

### node-cron v4 Schedule with noOverlap
```javascript
// Source: node-cron v4 API (github.com/node-cron/node-cron)
const cron = require('node-cron');

const task = cron.schedule('*/15 * * * *', async (ctx) => {
  console.log(`Task status: ${ctx.task.getStatus()}`); // 'running'
  // ... do work
}, {
  name: 'background-cycle',
  noOverlap: true,
  timezone: 'America/Mexico_City',
});

// Task auto-starts. Methods available:
task.getStatus();     // 'stopped' | 'idle' | 'running' | 'destroyed'
task.getNextRun();    // Date | null
task.stop();          // Pauses scheduling
task.start();         // Resumes scheduling

// Lifecycle events:
task.on('execution:started', (ctx) => { /* ... */ });
task.on('execution:finished', (ctx) => { /* ... */ });
task.on('execution:failed', (ctx) => { console.error(ctx.execution?.error); });
task.on('execution:overlap', (ctx) => { console.warn('Overlap prevented'); });

// Registry access:
const allTasks = cron.getTasks();  // Map<string, ScheduledTask>
const oneTask = cron.getTask('background-cycle');  // ScheduledTask | undefined
```

### node-cron v4 createTask (for manual-start pattern)
```javascript
// Source: node-cron v4 API
// createTask returns a stopped task -- useful if you need to configure events before starting
const task = cron.createTask('*/15 * * * *', async () => {
  await forResponse();
}, { name: 'background-cycle', noOverlap: true });

// Configure events before starting
task.on('execution:failed', (ctx) => {
  logGenerator('CronScheduler', 'error', `Cron failed: ${ctx.execution?.error?.message}`);
});

task.start(); // Explicitly start when ready
```

### SSE Headers Setup (Express)
```javascript
// Source: MDN Server-Sent Events spec + Express docs
function setupSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Set reconnection interval (client retries after 10s if disconnected)
  res.write('retry: 10000\n\n');

  return res;
}
```

### SSE Event Writing Format
```javascript
// Source: MDN SSE protocol spec
// Named event with JSON data:
function sendSSEEvent(res, eventType, data) {
  res.write(`event: ${eventType}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Usage:
sendSSEEvent(res, 'progress', {
  type: 'progress',
  operation: 'background-cycle',
  tenant: 'T1',
  step: 'downloadCFDI',
  message: 'Descargando CFDIs para tenant 0',
  timestamp: new Date().toISOString(),
});

// Keep-alive comment (prevents proxy timeouts):
res.write(': heartbeat\n\n');
```

### Config.js Extension Pattern
```javascript
// Source: Existing src/config.js pattern
// Add to config object:
schedule: {
  cronExpression: process.env.CRON_SCHEDULE || '*/15 * * * *',
  operationDelayMs: parseInt(process.env.OPERATION_DELAY_MS, 10) || 5000,
},
```

### Ring Buffer for History Storage
```javascript
// Source: Standard pattern for bounded in-memory storage
class RingBuffer {
  constructor(maxSize = 100) {
    this.buffer = [];
    this.maxSize = maxSize;
  }

  push(item) {
    this.buffer.push(item);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  getAll() {
    return [...this.buffer];
  }

  getRecent(hours = 24) {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    return this.buffer.filter(item => new Date(item.startedAt).getTime() > cutoff);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| node-cron v3 EventEmitter events | v4 colon-delimited events (`task:started` not `task-started`) | v4.0.0 (2024) | Event listener code must use new names |
| node-cron v3 `scheduled` and `runOnInit` options | v4 removed; use `createTask()` for initially-stopped tasks | v4.0.0 (2024) | `cron.schedule()` auto-starts; `cron.createTask()` starts stopped |
| node-cron v3 checks every second | v4 dynamic delay based on cron expression | v4.0.0 (2024) | More CPU-efficient; no behavioral change |
| `@types/node-cron` for TypeScript | v4 rewritten in TypeScript; types included | v4.0.0 (2024) | No separate @types package needed (this project uses JS, so no impact) |
| External overlap prevention | Built-in `noOverlap: true` + `execution:overlap` event | v4.0.0 (2024) | Eliminates need for custom overlap detection |

**Deprecated/outdated:**
- node-cron v3 `scheduled: false` option: removed in v4. Use `createTask()` instead for initially-stopped tasks.
- node-cron v3 `runOnInit: true` option: removed in v4. Call `task.execute()` manually after creation if needed.
- `@types/node-cron`: Not needed for v4; package ships its own types.

## Open Questions

1. **Rate limiting on SSE endpoints**
   - What we know: The global API rate limiter (200 req/15min) applies to `/api/*` routes. SSE connections are long-lived, so each connection counts as one request.
   - What's unclear: Should SSE endpoints be excluded from rate limiting? A long-lived SSE connection should not count against the request budget.
   - Recommendation: Exclude `/api/operations/:operationId/stream` from the global rate limiter by mounting it before the rate limit middleware, or apply a separate limiter with a higher threshold.

2. **Keep-alive / heartbeat for SSE**
   - What we know: Proxies and load balancers may close idle SSE connections after 30-60 seconds of inactivity.
   - What's unclear: Whether the production environment has proxy/LB that would do this. The project runs on a Windows Server with direct access.
   - Recommendation: Send a comment heartbeat (`: heartbeat\n\n`) every 30 seconds as a safety measure. Cheap insurance against timeout disconnections.

3. **Manual trigger vs cron execution sharing**
   - What we know: POST /api/schedule/:taskId/trigger should run the same `forResponse()` function. Both cron and manual trigger should emit SSE progress.
   - What's unclear: Whether manual trigger should use node-cron's `task.execute()` or directly call `forResponse()`.
   - Recommendation: Manual trigger should call `forResponse()` directly (not `task.execute()`), because `task.execute()` may interact with noOverlap state in unexpected ways. Both paths go through OperationManager for lock management.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `jest.config.js` |
| Quick run command | `npx jest --testPathPattern=tests/api/ --no-coverage -x` |
| Full suite command | `npx jest --no-coverage` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-04 | node-cron scheduler initializes with noOverlap and timezone | unit | `npx jest tests/services/cron-scheduler.test.js -x` | Wave 0 |
| INFRA-05 | forResponse() runs as scheduled recurring job (not run-once) | integration | `npx jest tests/services/cron-scheduler.test.js -x` | Wave 0 |
| SYS-01 | GET /api/schedule returns schedule info with next run | integration | `npx jest tests/api/schedule-routes.test.js -x` | Wave 0 |
| SYS-02 | POST /api/schedule/:taskId/trigger fires task, 409 if running | integration | `npx jest tests/api/schedule-routes.test.js -x` | Wave 0 |
| SYS-03 | GET /api/schedule/history returns last 24h of executions | integration | `npx jest tests/api/schedule-routes.test.js -x` | Wave 0 |
| SYS-04 | GET /api/operations/status returns running operations | integration | `npx jest tests/api/operations-routes.test.js -x` | Wave 0 |
| SYS-05 | GET /api/operations/:operationId/stream delivers SSE events | integration | `npx jest tests/api/operations-routes.test.js -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx jest --testPathPattern=tests/api/ --no-coverage -x`
- **Per wave merge:** `npx jest --no-coverage`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/services/operation-manager.test.js` -- covers OperationManager lock semantics, EventEmitter progress
- [ ] `tests/services/cron-scheduler.test.js` -- covers INFRA-04, INFRA-05 (mock node-cron)
- [ ] `tests/api/schedule-routes.test.js` -- covers SYS-01, SYS-02, SYS-03
- [ ] `tests/api/operations-routes.test.js` -- covers SYS-04, SYS-05 (SSE testing)

### Testing SSE Endpoints
SSE endpoints require special testing considerations:
- **supertest** can test SSE by reading the raw response stream: use `request(app).get('/api/operations/abc/stream').buffer(false)` and parse the stream manually
- The response will be chunked -- read events by splitting on `\n\n`
- Set a short timeout in tests (2-3 seconds) to avoid hanging
- Mock the OperationManager to emit test events on demand

### Testing node-cron
- Mock `node-cron` entirely in tests -- do not let real cron timers run in test suites
- Test the CronScheduler wrapper's logic (config loading, event wiring) not the cron library itself
- Follow the established `jest.mock()` pattern from `payment-routes.test.js`

## Sources

### Primary (HIGH confidence)
- [node-cron/node-cron GitHub](https://github.com/node-cron/node-cron) -- ScheduledTask interface, TaskEvent types, state machine, task registry (source code review)
- [MDN: Using Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) -- SSE protocol spec, event format, reconnection behavior, browser limits
- [node-cron npm](https://www.npmjs.com/package/node-cron) -- Version 4.2.1 confirmed as latest stable

### Secondary (MEDIUM confidence)
- [nodecron.com/migrating-from-v3](https://nodecron.com/migrating-from-v3) -- v3-to-v4 migration guide (site was down during fetch but search snippet extracted key info)
- [nodecron.com/scheduling-options.html](https://nodecron.com/scheduling-options.html) -- noOverlap documentation, Options type
- [Mastering JS: SSE with Express](https://masteringjs.io/tutorials/express/server-sent-events) -- Express SSE implementation pattern

### Tertiary (LOW confidence)
- None -- all findings verified via source code or official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- node-cron v4.2.1 confirmed via npm, API verified via source code
- Architecture: HIGH -- patterns derived from existing codebase (CommonJS, Express Router, singleton services, test patterns) combined with verified library APIs
- Pitfalls: HIGH -- SSE browser limits from MDN, EventEmitter leak patterns from Node.js docs, cron overlap handling from source code review

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (stable domain, 30-day validity)
