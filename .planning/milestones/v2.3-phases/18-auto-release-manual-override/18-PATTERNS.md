# Phase 18: Auto-release & Manual Override - Pattern Map

**Mapped:** 2026-04-28
**Files analyzed:** 10 files to create/modify
**Analogs found:** 10 / 10 (every file has at least a strong analog in the existing codebase)

> **Read order for the planner:** start at `## File Classification`, then read the per-file pattern blocks in `## Pattern Assignments`. Cross-cutting concerns (lazy-load, ResultEnvelope, listener registration timing, email-to-admin) live in `## Shared Patterns`.

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `src/services/OperationManager.js` (modify) | service / EventEmitter / lock primitive | event-driven (emit `lock:timeout`) | self — extend `acquireLock`/`releaseLock` + `startStep`/`endStep` | exact (extend existing class) |
| `src/services/CronScheduler.js` (modify) | service / scheduler bootstrapping | event-driven listener + side effects (history, email, log) | `src/routes/operations-routes.js:81` (the ONLY existing `operationManager.on(...)` listener) + `src/services/LicenseValidator.js:128-155` (admin-email pattern) | role-match (best available) |
| `src/routes/schedule-routes.js` (modify) | Express route / write endpoint | request-response, idempotent | self — `POST /:taskId/trigger` (lines 108-167, same file) | exact |
| `src/routes/schemas/schedule-schemas.js` (modify) | Joi schema / params + body | request validation | `triggerSchema` (line 13, same file) for params + `src/routes/schemas/payment-schemas.js:46-49` (`uuidRepairRepairSchema`) for body shape | exact |
| `src/utils/EmailSender.js` (read-only / reuse) | utility / SMTP wrapper | request-response (synchronous send) | self — current `sendMail({h1, p, status, message, position, idCia})` shape | exact |
| `src/config.js` (modify) | config loader | initialization | `config.schedule.cronExpression` and `config.schedule.operationDelayMs` (lines 165-168, same file) | exact |
| `public/schedule.html` (modify) | static HTML / vanilla JS dashboard | DOM + polling + event handlers | self — Phase 17 card "Operación en curso" (lines 167-191) + Phase 17 polling loop (lines 632-661) | exact (extending Phase 17 surface) |
| `public/js/shared.js` (modify, optional) | vanilla JS helper / formatter | pure function | `formatRelative(isoString)` (lines 315-346, same file) | exact (sibling formatter) |
| `tests/services/OperationManager.timer.test.js` (create) | unit test / Jest | function-call assertion + timer mocks | `tests/services/operation-manager.test.js:269-352` (Phase 17 stepProgress block) — the existing test file already mocks config, LogGenerator, and uses `_reset()` between tests | role-match (extend existing test conventions) |
| `tests/api/schedule-force-release.test.js` (create) | integration test / supertest | HTTP request → assertion | `tests/api/schedule-routes.test.js` (entire file, esp. lines 1-167) — same mocks, same supertest factory pattern, same describe blocks for trigger endpoint | exact (clone trigger endpoint test, swap path + body) |
| `tests/services/CronScheduler.timeout-listener.test.js` (create) | unit test / EventEmitter listener | event emit → side-effect assertion | `tests/services/cron-scheduler.test.js` (entire file) for the mock layout + `tests/api/operations-routes.test.js:46-58` for the **real `EventEmitter` mock** technique (essential for testing `lock:timeout` emission) | role-match (combine two analogs) |

**Match-quality legend:**
- **exact** = copy structure verbatim, swap names/strings only.
- **role-match** = same role and data flow, but the new file extends or composes the analog rather than cloning it.

---

## Pattern Assignments

### 1. `src/services/OperationManager.js` (service, EventEmitter, lock primitive — MODIFY)

**Analog:** itself — extend the existing `acquireLock` / `releaseLock` / `_reset` methods.

**Imports pattern (no change required — file already has):**
```javascript
// src/services/OperationManager.js:13
const { EventEmitter } = require('events');
```

**Existing slot shape (Phase 17 — line 47-51) the new code MUST extend:**
```javascript
// src/services/OperationManager.js:47-51
this.locks.set(operationType, {
    operationId,
    startedAt: new Date().toISOString(),
    stepProgress: [],
});
return true;
```

The new code adds **one** field (`timeoutHandle`) to this exact object literal. Do **not** introduce a separate Map for timer handles — the encapsulation is the entire point of D-01.

**Existing JSDoc shape on slot (line 19-20) — must update to include `timeoutHandle`:**
```javascript
// src/services/OperationManager.js:19-20
/** @type {Map<string, { operationId: string, startedAt: string, stepProgress: Array<{ step: string, tenant: string|null, startedAt: string, finishedAt: string|null, error: string|null }> }>} */
this.locks = new Map();
```

After the change, the JSDoc should add `timeoutHandle: NodeJS.Timeout` to the slot shape.

**Existing `releaseLock` (line 56-62) is the analog for the cancellation pattern:**
```javascript
// src/services/OperationManager.js:56-62
/**
 * Release a per-operation-type lock. Discards stepProgress (volatile by design — see Phase 17 D-01).
 * @param {string} operationType
 */
releaseLock(operationType) {
    this.locks.delete(operationType);
}
```

**Pattern to follow for the modified `releaseLock`:** read the slot first, `clearTimeout(slot.timeoutHandle)`, then `this.locks.delete`. The `clearTimeout` MUST run before `delete` to prevent fire-after-release. `clearTimeout(undefined)` is safe (Node.js no-op), so an absent `timeoutHandle` does not need a guard.

**Existing emit pattern (line 128-130) is the analog for the new `lock:timeout` emission:**
```javascript
// src/services/OperationManager.js:122-130
/**
 * Emit a progress event for a specific operation ID.
 * SSE subscribers listen on 'progress:{operationId}'.
 *
 * @param {string} operationId
 * @param {Object} event - { type, operation, tenant, step, message, timestamp }
 */
emitProgress(operationId, event) {
    this.emit(`progress:${operationId}`, event);
}
```

**Pattern to follow for `_fireTimeout`:** internal method (D-01 / Claude's Discretion: regular underscore-prefix `_fireTimeout`, NOT private `#fireTimeout` — the codebase uses underscore convention, e.g., `_reset()` at line 169-173). Snapshot slot data, call `releaseLock` (which now also clears its own already-fired timer — `clearTimeout` of an already-fired timer is also a no-op), then `this.emit('lock:timeout', { operationType, operationId, startedAt, stepProgress, durationMs })`.

**Existing `_reset` (line 165-173) — MUST be extended to clear pending timers:**
```javascript
// src/services/OperationManager.js:165-173
/**
 * Reset internal state (for testing only).
 * @private
 */
_reset() {
    this.locks.clear();
    this.history = [];
    this.removeAllListeners();
}
```

The new `_reset()` MUST iterate `this.locks.values()` and call `clearTimeout(slot.timeoutHandle)` BEFORE `this.locks.clear()`. Otherwise tests that exercise the timer path would leak a stuck `setTimeout` across the Jest worker, hanging the test process indefinitely.

**Existing module export (line 176) — no change:**
```javascript
// src/services/OperationManager.js:176
module.exports = new OperationManager();  // singleton
```

**`durationMs` derivation (D-02 + D-04):** computed from `Date.now() - new Date(slot.startedAt).getTime()`. Format with the new `formatDurationMin` helper (see Shared Patterns).

**setMaxListeners ceiling (line 24):** currently `20`. The single `lock:timeout` listener registered at boot is well within budget; do not change this number.

---

### 2. `src/services/CronScheduler.js` (service, scheduler bootstrapping — MODIFY)

**Primary analog (listener registration):** `src/routes/operations-routes.js:81` (the only existing `operationManager.on(...)` consumer in the codebase).

**Secondary analog (admin-email pattern):** `src/services/LicenseValidator.js:128-155` (`sendLicenseAlert`).

**Imports pattern (already present — extend, do not duplicate):**
```javascript
// src/services/CronScheduler.js:14-20
const cron = require('node-cron');
const crypto = require('crypto');
const config = require('../config');
const operationManager = require('./OperationManager');
const licenseValidator = require('./LicenseValidator');
const { forResponse, startChildProcess } = require('../background');
const { logGenerator } = require('../utils/LogGenerator');
```

**Add to imports:** `const { sendMail } = require('../utils/EmailSender');` AND a require for the `formatDurationMin` helper at its chosen location (see Shared Patterns).

**Listener registration timing (CRITICAL — registration MUST occur in `initScheduler()`, NOT at module load):**

The lazy-load pattern at `src/routes/schedule-routes.js:26-32` exists because Phase 02 was rolled out incrementally:
```javascript
// src/routes/schedule-routes.js:26-32
// Lazy-load CronScheduler (may not exist if Plan 02 not yet executed)
let cronScheduler = null;
try {
    cronScheduler = require('../services/CronScheduler');
} catch (_e) {
    // Plan 02 (CronScheduler) not yet executed -- use defaults
}
```

Therefore the listener MUST register inside `initScheduler()` (called once at startup from `src/index.js:27`) — **not at module require time**. If you register at module load, then any test that requires `CronScheduler` (e.g. via `schedule-routes`) will accumulate listeners across `jest.isolateModules` blocks and leak into other tests.

**Listener registration template (build from `operations-routes.js:81` style):**
```javascript
// Pattern to follow — placement: inside initScheduler(), AFTER cron.schedule(...) returns
// but BEFORE the function returns. (Order does not matter for correctness; placement
// after `cron.schedule` keeps initScheduler readable as "create task, then wire events".)
operationManager.on('lock:timeout', async ({ operationType, operationId, startedAt, stepProgress, durationMs }) => {
    // 1. Derive stuckOnStep / stuckOnTenant by iterating stepProgress from the end
    // 2. operationManager.addHistory({ ... })  -- shape per D-04 (see Shared Patterns)
    // 3. await sendMail({ ... })  -- shape per D-08 (see Shared Patterns)
    // 4. logGenerator(LOG_FILE, level, message)
});
```

**Existing addHistory call (lines 64-72, 103-113) is the exact shape analog:**
```javascript
// src/services/CronScheduler.js:64-72  (license-skip path — note `success: false` + `errors: [string]` + `summary: string`)
operationManager.addHistory({
    taskId: 'background-cycle',
    operationId,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    success: false,
    errors: ['Licencia inactiva'],
    summary: 'Ciclo omitido: licencia inactiva',
});
```

```javascript
// src/services/CronScheduler.js:103-113 (finally path — success/failure branches)
operationManager.addHistory({
    taskId: 'background-cycle',
    operationId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    success,
    errors,
    summary: success
        ? `Completed in ${durationMs}ms`
        : `Failed after ${durationMs}ms: ${errors.join(', ')}`,
});
```

The new `lock:timeout` listener follows the same shape but with two **additional** fields per D-04: `stuckOnStep` and `stuckOnTenant`. The existing `addHistory` (OperationManager:145-150) accepts arbitrary keys — no breaking change to consumers (history readers are `getHistory()` consumers in `schedule-routes.js:92` and the dashboard, which iterate without filtering keys).

**Existing logging convention (lines 49, 57, 62, 78, 94, 98) — concrete logging template:**
```javascript
// src/services/CronScheduler.js:49 (warn)
logGenerator(LOG_FILE, 'warn', `[OVERLAP] background-cycle lock not acquired for ${operationId} -- skipping`);

// src/services/CronScheduler.js:78 (info — start)
logGenerator(LOG_FILE, 'info', `[START] Background cycle ${operationId} started`);

// src/services/CronScheduler.js:98 (error)
logGenerator(LOG_FILE, 'error', `[ERROR] Background cycle ${operationId} failed: ${error.message}`);
```

**Per CONTEXT Claude's Discretion:** auto-release uses `'warn'` (REC-02 calls timeout an exceptional event) with prefix `[TIMEOUT]`. Force-release manual is **not** triggered here (it goes through the new route handler). Email-failure inside the listener uses `'warn'` per the LicenseValidator analog (line 152: `'Failed to send license alert email: ' + err.message`) and DOES NOT throw — fire-and-forget per ARCHITECTURE.md "Email failure must NOT block license validation flow".

**Email pattern from `LicenseValidator.js:128-155` (the closest existing analog — admin-email + `[SageConnect]` subject prefix + try/catch swallow):**
```javascript
// src/services/LicenseValidator.js:128-155 (sendLicenseAlert — uses nodemailer directly)
async function sendLicenseAlert(subject, message) {
    try {
        const nodemailer = require('nodemailer');
        const transportConfig = {
            host: config.mailing.server,
            port: config.mailing.port,
            secure: config.mailing.ssl,
        };
        if (config.mailing.password) {
            transportConfig.auth = {
                user: config.mailing.from,
                pass: config.mailing.password,
            };
        }
        const transport = nodemailer.createTransport(transportConfig);
        await transport.sendMail({
            from: config.mailing.from,
            to: config.license.adminEmail,
            subject: '[SageConnect] ' + subject,
            html: '<h2>' + subject + '</h2><p>' + message + '</p><p><small>Company: ' + (config.app.company || 'Unknown') + ' | Time: ' + new Date().toISOString() + '</small></p>',
        });
        logGenerator(LOG_FILE, 'info', 'License alert email sent to ' + config.license.adminEmail + ': ' + subject);
    } catch (err) {
        logGenerator(LOG_FILE, 'warn', 'Failed to send license alert email: ' + err.message);
        console.warn('[LICENSE] Failed to send alert email: ' + err.message);
    }
}
```

**Decision for Phase 18:** the CONTEXT line 242 says "Phase 18 puede pasar h1 directo como 'Auto-timeout' / 'Liberación manual' sin tocar EmailSender". This is the cleaner path because `sendMail` already prefixes `${idCia} - ${data.h1}` as the subject. **Passing `data.h1 = "Auto-timeout: lock background-cycle liberado después de 14m"` and `data.idCia = "[SageConnect]"` produces** `subject: "[SageConnect] - Auto-timeout: lock background-cycle liberado después de 14m"` — close enough to the spec subject `"[SageConnect] Auto-timeout: lock <operationType> liberado después de <duración>"` without modifying `EmailSender.js`. **Recommendation for the planner:** prefer passing through `EmailSender.sendMail` (analog 1, see EmailSender section below) over duplicating the LicenseValidator nodemailer pattern, unless the planner decides the subject format `${idCia} - ${data.h1}` (note the literal " - " separator) is unacceptable.

---

### 3. `src/routes/schedule-routes.js` (Express route / write endpoint — MODIFY)

**Analog:** itself — `POST /:taskId/trigger` at lines 108-167 (same file).

**Imports pattern (already present — line 13-24, no new imports needed):**
```javascript
// src/routes/schedule-routes.js:13-24
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const { validate } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/async-handler');
const { requireApiKey } = require('../middleware/api-key');
const { successResult, errorResult } = require('../utils/ResultEnvelope');
const operationManager = require('../services/OperationManager');
const config = require('../config');
const { triggerSchema } = require('./schemas/schedule-schemas');
const { forResponse } = require('../background');
```

**Add to imports:** `forceReleaseSchema` from `./schemas/schedule-schemas` (one new import line).

**Existing writeLimiter (lines 35-51) — reuse as-is, do not redefine:**
```javascript
// src/routes/schedule-routes.js:35-51
const writeLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        success: false,
        data: null,
        errors: ['Too many write requests, please try again later'],
        summary: 'Rate limited',
        meta: {
            duration: 0,
            timestamp: new Date().toISOString(),
            tenant: null,
        },
    },
});
```

**Trigger handler (the EXACT template — lines 105-167):**
```javascript
// src/routes/schedule-routes.js:105-167  (POST /:taskId/trigger — the analog for force-release)
router.post(
    '/:taskId/trigger',
    requireApiKey,
    validate(triggerSchema, 'params'),
    writeLimiter,
    asyncHandler(async (req, res) => {
        const { taskId } = req.params;
        const operationId = crypto.randomUUID();

        const locked = operationManager.acquireLock(taskId, operationId);
        if (!locked) {
            return res.status(409).json(
                errorResult(
                    ['Background cycle is already running'],
                    'Conflict'
                )
            );
        }

        // Start background cycle without awaiting -- return immediately
        const startedAt = new Date().toISOString();
        forResponse({ operationId, emitter: operationManager })
            .then(() => { /* ... */ })
            .catch((err) => { /* ... */ })
            .finally(() => {
                operationManager.releaseLock(taskId);
            });

        const result = successResult(
            {
                operationId,
                taskId,
                message: 'Task triggered',
            },
            'Task triggered successfully'
        );

        res.json(result);
    })
);
```

**Middleware order (CRITICAL — this is the exact order used by every write endpoint in the project):**
```
requireApiKey → validate(schema, source) → writeLimiter → asyncHandler(handler)
```

This order is enforced in:
- `src/routes/schedule-routes.js:110-113` (trigger)
- `src/routes/payment-routes.js:60-61` (validate → writeLimiter; api-key applied at app level — see schedule.html-key-injection / app-level requireApiKey wiring per dashboard pattern; in `payment-routes.js` it is mounted under a guarded path. For the new force-release endpoint, **explicit `requireApiKey` must be in the chain**, matching the `trigger` endpoint, NOT the `payment-routes` style.)

For Phase 18, follow `trigger` exactly (explicit `requireApiKey` first).

**Idempotency pattern (NEW — D-07: always 200):**

Unlike `trigger` (which returns 409 when `acquireLock` returns `false`), the new force-release handler **must NOT 409**. Instead:

```javascript
// Pseudo-pattern for the new force-release handler (planner translates to actual JS)
asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const reason = req.body && req.body.reason;  // optional, validated by Joi

    // Snapshot the current lock BEFORE releasing (for the response payload + email body)
    const running = operationManager.getRunningOperations();
    const slot = running[taskId] || null;

    if (!slot) {
        // Idempotent path — D-07 case 2: no lock active
        return res.json(successResult(
            { released: false, previousLock: null },
            'Sin lock activo para liberar'
        ));
    }

    // Snapshot fields needed for previousLock + email
    const previousLock = {
        operationId: slot.operationId,
        startedAt: slot.startedAt,
        durationMs: Date.now() - new Date(slot.startedAt).getTime(),
        stuckOnStep: /* derive from slot.stepProgress, see D-04 */ null,
        stuckOnTenant: /* derive from slot.stepProgress, see D-04 */ null,
    };

    // Release the lock — this also clears the auto-timer via the modified releaseLock (D-01)
    operationManager.releaseLock(taskId);

    // addHistory entry for the manual force-release (paired with auto-release listener)
    operationManager.addHistory({ /* shape per Shared Patterns / D-04 — but with success:false, summary:'Lock forzado manualmente por operador' */ });

    // sendMail to admin (force-release variant — fire-and-forget, do NOT await blocking)
    sendMail(/* ... */).catch((err) => {
        logGenerator(LOG_FILE, 'warn', '[FORCE-RELEASE] Email failed: ' + err.message);
    });

    return res.json(successResult(
        { released: true, previousLock },
        `Lock ${taskId} liberado`
    ));
})
```

**Error handling (`errorResult`):** only used for the (impossible-given-Joi) malformed input case caught by middleware. The handler itself never returns 4xx — Joi catches taskId / reason validation upstream, and the slot-missing case is success per D-07. This is a deliberate departure from `trigger`'s 409 path.

**`asyncHandler` reminder (already imported, used by every existing route — `src/middleware/async-handler.js:12`):**
```javascript
// src/middleware/async-handler.js:12
const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
```

Any `throw` inside the async handler propagates to the central error handler in `server.js`. The handler's role is to call `res.json(...)` directly — never `res.status(500).json(...)` for unexpected errors (the error handler does that).

**Module export (line 169) — no change:** `module.exports = router;`

---

### 4. `src/routes/schemas/schedule-schemas.js` (Joi schema — MODIFY)

**Analog (params):** `triggerSchema` at line 13 (same file).
**Analog (body):** `uuidRepairRepairSchema` at `src/routes/schemas/payment-schemas.js:46-49`.

**Existing imports (line 8) — no change:**
```javascript
// src/routes/schemas/schedule-schemas.js:8
const Joi = require('joi');
```

**Existing triggerSchema (line 13-15) — exact analog for the params schema:**
```javascript
// src/routes/schemas/schedule-schemas.js:13-15
const triggerSchema = Joi.object({
    taskId: Joi.string().valid('background-cycle').required(),
});
```

**Pattern to follow for `forceReleaseSchema.params`:** identical to `triggerSchema`. The valid taskId list is `['background-cycle']` for v1 (D-07 — string valid in operationTypes). Open question for the planner: should it be a separate schema or **reuse `triggerSchema` directly** for params? Given the param shape is literally identical, the planner may export `triggerSchema` for both endpoints (DRY), OR define a parallel `forceReleaseParamsSchema` that mirrors it. Either is acceptable; **CONTEXT line 211 calls it "forceReleaseSchema"** — interpret as "the new schema for force-release", which the planner can choose to split into `params` + `body` schemas.

**Existing body-schema analog from `payment-schemas.js:46-49` — exact template for the optional body:**
```javascript
// src/routes/schemas/payment-schemas.js:46-49 (uuidRepairRepairSchema)
const uuidRepairRepairSchema = Joi.object({
    tenantIndex: Joi.number().integer().min(0).max(tenantMax).default(0),
    dryRun: Joi.boolean().default(true),
});
```

**Pattern to follow for `forceReleaseBodySchema`:**
```javascript
// Pattern (planner translates to real Joi):
const forceReleaseBodySchema = Joi.object({
    reason: Joi.string().max(200).allow('', null).optional(),
});
```

Notes:
- `max(200)` per D-07 (CONTEXT line 167).
- Empty body is acceptable — D-07 says body is optional. Joi's default `Joi.object({})` validates an empty body as `{}`, so `validate(forceReleaseBodySchema, 'body')` with no body sent should succeed (Express's `express.json()` produces `{}` when no Content-Type/body is provided OR throws — verify in test that an entirely missing body does not 400).
- `stripUnknown: true` is already enabled in `src/middleware/validate.js:23`, so any extra body fields are silently dropped — consistent with existing endpoints.

**Existing module exports (line 17-19) — extend:**
```javascript
// src/routes/schemas/schedule-schemas.js:17-19 (current)
module.exports = {
    triggerSchema,
};
```

After Phase 18: also export `forceReleaseSchema` (or `forceReleaseParamsSchema` + `forceReleaseBodySchema`).

**Ordering of validate calls in the route:** the route handler has both params AND body validation, so the route must invoke `validate()` twice. Pattern from existing routes (e.g., `src/routes/schedule-routes.js:111` uses one `validate()` call; `src/routes/payment-routes.js:60` uses one `validate(reconciliationSchema, 'body')` call). For dual validation:

```javascript
// Pattern (combine params + body — Express middleware composes naturally)
router.post(
    '/:taskId/force-release',
    requireApiKey,
    validate(forceReleaseParamsSchema, 'params'),  // first: validates URL param
    validate(forceReleaseBodySchema, 'body'),      // second: validates body
    writeLimiter,
    asyncHandler(/* ... */),
);
```

Both `validate()` calls are independent — each replaces `req.params` / `req.body` with the validated value (per `src/middleware/validate.js:33`). No conflict.

---

### 5. `src/utils/EmailSender.js` (utility / SMTP wrapper — READ-ONLY / REUSE)

**Analog:** itself — `sendMail(data)` at line 6-56.

**Existing function signature and shape (lines 6-50):**
```javascript
// src/utils/EmailSender.js:6-50
async function sendMail(data) {
    const logFileName = 'EmailSender';
    const html = `<h1>${data.h1}</h1>
    <p>${data.p}</p>
    <table>
        <tr><th>Status</th><th>Message</th></tr>
        <tr><td>${data.status}</td><td>${data.message}</td></tr>
    </table>`;
    // ...
    const mailOptions = {
        from: config.mailing.from,
        to,                                                       // resolved from config.mailing.notices[data.position]
        cc,                                                       // resolved from config.mailing.cc
        subject: `${data.idCia || 'NOT FOUND'} - ${data.h1}`,    // <-- subject is hardcoded
        html
    };
    const result = await transport.sendMail(mailOptions);
    return result;
}
```

**Per CONTEXT (line 211-212):** "reutilizar `sendMail`; posiblemente extender el shape de `data` para subject custom". Phase 18 has two options:

| Option | Action | Risk |
|--------|--------|------|
| **(A) Reuse as-is** | Pass `data.idCia = '[SageConnect]'` and `data.h1 = 'Auto-timeout: lock background-cycle liberado después de 14m'`. Subject becomes `[SageConnect] - Auto-timeout: ...` (literal " - " separator). | Subject differs slightly from the CONTEXT spec (extra " - "). Acceptable. |
| **(B) Extend EmailSender** | Add optional `data.subject` field — when set, use it directly; else fall back to `${data.idCia} - ${data.h1}`. | Touches a primitive used by 4 callers (`background.js:310`, `background.js:351`, `controller/SagePaymentController.js:12`, `routes/dashboard-routes.js:24`). Each existing caller does NOT set `data.subject`, so the fallback preserves behavior. Low risk if planner adds the field carefully. |

**Recommendation for the planner:** option **(A)** keeps the change scope tight to Phase 18 — auto-release and force-release listeners construct `data.h1` carefully so the resulting subject matches CONTEXT. Defer (B) until a future phase needs custom subjects.

**Existing recipient resolution (line 35-39):**
```javascript
// src/utils/EmailSender.js:35-39
const to = config.mailing.notices[data.position]
    || config.mailing.notices[0];

const cc = config.mailing.cc || [];
```

**Implication for the listener:** Phase 18 sends to `LICENSE_ADMIN_EMAIL`, NOT `MAILING_NOTICES`. Two paths:

- **Path 1 (preferred):** Reuse `sendMail` with `data.position` set to a value that maps to admin. Currently `notices[0]` is the first notices entry — NOT the admin address. So this path fails the "send to admin" requirement unless config wires admin into `notices[0]`.
- **Path 2 (recommended):** Use the `LicenseValidator.sendLicenseAlert` pattern — direct nodemailer send to `config.license.adminEmail`. Concretely: extract a small helper `sendAdminAlert(subject, body)` that mirrors `sendLicenseAlert` (LicenseValidator:128-155) but lives in a shared util OR copy the inline implementation into the listener.

**Resolution for the planner:** since CONTEXT (line 173) and the deferred file `LICENSE_ADMIN_EMAIL` env var explicitly target the admin, use **path 2** with the `LicenseValidator.sendLicenseAlert` pattern (see `src/services/LicenseValidator.js:128-155` reproduced above). This avoids contaminating the operator-facing `MAILING_NOTICES` mailbox. The "reuse `sendMail`" line in CONTEXT is aspirational — the actual code-search shows that no existing call site sends to `LICENSE_ADMIN_EMAIL` via `sendMail`, only via inline nodemailer.

**Extracted email helper sketch (planner's choice — NEW utility OR inline):**
- **NEW utility:** `src/utils/AdminEmailSender.js` exports `sendAdminAlert(subject, message)` — copies `LicenseValidator.sendLicenseAlert` body verbatim. Reusable for future admin-alert phases.
- **Inline:** copy the snippet directly into the `lock:timeout` listener AND into the force-release route handler. ~30 lines duplicated, simpler to land but uglier.

**Recommendation:** inline for Phase 18 (reduces blast radius), refactor later if more admin-email events appear.

---

### 6. `src/config.js` (config loader — MODIFY)

**Analog:** `config.schedule.cronExpression` and `config.schedule.operationDelayMs` at lines 165-168 (same file).

**Existing schedule section (lines 165-168) — exact pattern:**
```javascript
// src/config.js:165-168
schedule: {
    cronExpression: process.env.CRON_SCHEDULE || '*/15 * * * *',
    operationDelayMs: parseInt(process.env.OPERATION_DELAY_MS, 10) || 5000,
},
```

**Pattern to follow for `lockTimeoutMs`:**
```javascript
// New entry inside the same schedule: { } block
lockTimeoutMs: parseInt(process.env.LOCK_TIMEOUT_MS, 10) || 14 * 60 * 1000,
```

Notes:
- Default `14 * 60 * 1000` per CONTEXT D-01 (14 min).
- Env var `LOCK_TIMEOUT_MS` per CONTEXT D-01.
- `parseInt(..., 10) || default` is the established pattern (line 167).

**Validation (per CONTEXT specifics line 270): `lockTimeoutMs` should be > 60000 (1 min)**. The existing `validate()` function (lines 36-57) handles "missing required" only — there is NO existing range-validation pattern for numeric values. The planner has two choices:

1. **Skip range validation** — rely on `parseInt(..., 10) || 14*60*1000` to fall back to default for any non-numeric input. Misses the "configured but absurd" case.
2. **Add post-build validation** — after the `config` object is built, do an explicit fail-fast check:
   ```javascript
   // Pattern (NEW — no existing analog in config.js for range checks; follow validate()'s console.error + process.exit style)
   if (config.schedule.lockTimeoutMs < 60000) {
       console.error('[CONFIG ERROR] LOCK_TIMEOUT_MS must be >= 60000 (1 min). Got: ' + config.schedule.lockTimeoutMs);
       process.exit(1);
   }
   ```
   Place this immediately after `const config = { ... };` and before `module.exports = config;` (between lines 169 and 176).

**Recommendation for the planner:** option 2. Mirror the existing fail-fast `process.exit(1)` style at lines 49-55 to keep config validation centralized.

**Existing module export (line 176) — no change:**
```javascript
// src/config.js:176
module.exports = config;
```

**REQUIRED list (lines 20-31) — DO NOT add `LOCK_TIMEOUT_MS`** because it has a sensible default. Adding it to `REQUIRED` would force every existing prod `.env` to include `LOCK_TIMEOUT_MS=...` or fail startup — a backward-compat break with no benefit.

**Other env vars to consider documenting (CONTEXT silent — Claude's Discretion):** add a one-line code comment above `lockTimeoutMs` describing the unit (`milliseconds`) and what triggering means (`auto-release after this duration`). The codebase has zero `.env.example` checked into git in the discoverable paths — so no `.env.example` update task needed unless the planner explicitly adds one.

---

### 7. `public/schedule.html` (static HTML / vanilla JS — MODIFY)

**Analog:** itself — Phase 17 active-operation card (lines 167-191) + polling loop (lines 632-661) + cleanup hooks (lines 753-766).

**Existing card markup (lines 167-191) — EXACT structure the new button mounts inside:**
```html
<!-- public/schedule.html:167-191 -->
<!-- Active Operation Card (Phase 17 — OBS-01, OBS-02) -->
<div id="active-operation-card" class="card mb-4" style="display: none;">
    <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="fas fa-play-circle me-2"></i>Operación en curso</span>
        <span id="active-op-badge"></span>
    </div>
    <div class="card-body">
        <div id="active-op-summary" class="mb-2">
            <span class="text-muted">Operación:</span>
            <code id="active-op-type">background-cycle</code>
            <span class="text-muted ms-3">ID:</span>
            <code id="active-op-id" title="">—</code>
        </div>
        <div class="mb-1">
            <i class="fas fa-clock me-1 text-muted"></i>
            <span class="text-muted">Iniciada:</span>
            <span id="active-op-elapsed" title="">—</span>
        </div>
        <div id="active-op-step-line">
            <i class="fas fa-spinner fa-spin me-1 text-primary"></i>
            <span class="text-muted">Step actual:</span>
            <span id="active-op-step">Inicializando ciclo…</span>
        </div>
    </div>
</div>
```

**Insertion point (per UI-SPEC):** REPLACE the empty `<span id="active-op-badge"></span>` at line 171 with the flex container from UI-SPEC section "Component Inventory > 1. Force-release button" (UI-SPEC lines 161-173). Card visibility (`display:none` / shown on lock) is owned by Phase 17 logic at `public/schedule.html:670` (`card.style.display = '';`) and `:715` (`card.style.display = 'none'`). Phase 18 needs **zero** visibility logic — the button rides the card visibility automatically (CONTEXT D-06).

**Modal markup placement:** at the bottom of the file, immediately before `</body>` (UI-SPEC section "Component Inventory > 2. Force-release modal", lines 188-238). The closing `</body>` is at line 768 in the current file — insert AFTER `</div>` of `<div id="toast-container">` (line 242) and BEFORE the `<script src="/js/shared.js">` at line 245, OR after the `<script>` block. Either works since modals are inert until shown. **Recommendation:** insert immediately before `</body>` (line 768) per Bootstrap convention.

**Existing JS handler-binding pattern (line 275-288) — analog for the modal-event wiring:**
```javascript
// public/schedule.html:275-288 (DOMContentLoaded — extend to wire the modal)
document.addEventListener('DOMContentLoaded', async () => {
    await initPage('/schedule.html');
    await loadScheduleData();

    // Phase 17 (D-06): permanent 5s polling for the "Operación en curso" card.
    await pollActiveOperation();
    activeOpPollHandle = setInterval(pollActiveOperation, 5000);

    activeOpHeartbeatHandle = setInterval(refreshActiveOperationHeartbeat, 1000);
});
```

**Pattern to follow (Phase 18 additions — INSIDE the same DOMContentLoaded):**
- `document.getElementById('forceReleaseModal').addEventListener('show.bs.modal', () => { /* populate context */ });`
- `document.getElementById('forceReleaseModal').addEventListener('shown.bs.modal', () => { /* focus Cancelar */ });`
- `document.getElementById('btn-force-release-confirm').addEventListener('click', submitForceRelease);`

These three listener-binds belong inside the existing `DOMContentLoaded` callback (line 275-288) AFTER `initPage` resolves. Bootstrap's `Modal` class is loaded globally via the CDN script tag at line 12-14, so `bootstrap.Modal` is available without explicit import.

**Existing apiCall pattern (shared.js:72-95) — exact analog for the POST:**
```javascript
// public/js/shared.js:72-95 (apiCall — already used by triggerCycle and pollActiveOperation)
async function apiCall(method, path, body = null) {
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json; charset=utf-8',
    };
    const apiKey = resolveApiKey();
    if (apiKey) {
        headers['x-api-key'] = apiKey;
    }
    const opts = { method, headers };
    if (body) {
        opts.body = JSON.stringify(body);
    }
    try {
        const res = await fetch(path, opts);
        return await res.json();
    } catch (err) {
        showToast('Error de red: ' + err.message, 'error');
        throw err;
    }
}
```

**Pattern to follow for the POST in `submitForceRelease()`:** literally
```javascript
const res = await apiCall('POST', '/api/schedule/background-cycle/force-release', {});
```

Empty `{}` is fine — backend Joi schema defaults `reason` to optional. The UI-SPEC (line 144) confirms v1 does not collect a free-text reason.

**Existing `confirmAction` (shared.js:370-372) is being SUPERSEDED:**
```javascript
// public/js/shared.js:370-372
function confirmAction(message) {
    return window.confirm(message);
}
```

`triggerCycle()` at `schedule.html:445-481` still uses `confirmAction`. **DO NOT remove `confirmAction` in Phase 18** — it's used by `triggerCycle`, `payments.html`, and `pos.html`. Phase 18 uses Bootstrap modal exclusively for the new force-release confirmation; it doesn't replace existing `confirmAction` callers.

**Existing showToast pattern (shared.js:174-210) — exact analog for the warning toast on `released:false`:**
```javascript
// public/js/shared.js:174-210 (showToast)
function showToast(message, type = 'success') {
    // ... constructs Bootstrap Toast with bg class per type
    const styles = {
        success: { bg: 'bg-success text-white', icon: 'fa-check-circle' },
        error:   { bg: 'bg-danger text-white',  icon: 'fa-exclamation-triangle' },
        warning: { bg: 'bg-warning text-dark',  icon: 'fa-exclamation-circle' },
    };
    // ...
}
```

**Pattern to follow:** `showToast('El lock ya se había liberado', 'warning');` per UI-SPEC line 122.

**Existing Bootstrap Toast initialization (shared.js:205) — the ONLY existing `new bootstrap.X` analog in the codebase:**
```javascript
// public/js/shared.js:205
const bsToast = new bootstrap.Toast(toastEl, { delay: 5000 });
```

**Pattern to follow for the modal:** `bootstrap.Modal.getInstance(document.getElementById('forceReleaseModal')).hide();` AFTER successful POST. The modal instance is created implicitly via the `data-bs-toggle="modal" data-bs-target="#forceReleaseModal"` declarative attribute on the trigger button (UI-SPEC line 168-169) — Bootstrap auto-instantiates on first toggle, and `getInstance(...)` returns the cached instance afterward. No explicit `new bootstrap.Modal(...)` call needed in normal flow.

**Existing cleanup pattern (lines 753-766) — extend for completeness:**
```javascript
// public/schedule.html:753-766 (beforeunload — current Phase 17 cleanup)
window.addEventListener('beforeunload', function () {
    if (evtSource) {
        evtSource.close();
        evtSource = null;
    }
    if (activeOpPollHandle) {
        clearInterval(activeOpPollHandle);
        activeOpPollHandle = null;
    }
    if (activeOpHeartbeatHandle) {
        clearInterval(activeOpHeartbeatHandle);
        activeOpHeartbeatHandle = null;
    }
});
```

Phase 18 introduces no new long-lived intervals or listeners that survive page lifetime, so this block does NOT need extension. The Bootstrap modal cleans up on `hidden.bs.modal` automatically.

**Existing STEP_LABELS constant (line 252-261) — REUSE in modal context line:**
```javascript
// public/schedule.html:252-261
const STEP_LABELS = {
    buildProviders: 'Construir Proveedores XML',
    downloadCFDI: 'Descargar CFDIs',
    checkPayments: 'Verificar Pagos',
    uploadPayments: 'Subir Pagos',
    createPurchaseOrders: 'Crear Ordenes de Compra',
    processOrderChanges: 'Procesar Cambios de Ordenes',
    closePurchaseOrders: 'Cerrar Ordenes de Compra',
    startChildProcess: 'Importar CFDIs (proceso hijo)',
};
```

The UI-SPEC pseudocode (line 344) explicitly references `STEP_LABELS[display.step] || display.step` — same exact pattern as the existing `renderActiveOperationCard` at line 701 (`const label = STEP_LABELS[display.step] || display.step;`).

**`activeOpSnapshot` global (line 269) — REUSE in `show.bs.modal` listener:**
```javascript
// public/schedule.html:269
let activeOpSnapshot = null;         // last successful poll payload for the active op (or null when idle)
```

The `show.bs.modal` listener reads `activeOpSnapshot` directly (UI-SPEC line 330). Phase 17 sets it in `pollActiveOperation` (line 649: `activeOpSnapshot = bgOp;`) and unsets it in `hideActiveOperationCard` (line 716: `activeOpSnapshot = null;`).

**Optimistic UI hide function (UI-SPEC line 304) — already exists in the codebase as `hideActiveOperationCard`** at line 713-721. **Reuse, do not duplicate.** The UI-SPEC pseudocode says `hideActiveOperationCard()` — call it directly after success.

---

### 8. `public/js/shared.js` (vanilla JS helper — OPTIONAL MODIFY)

**Analog:** `formatRelative(isoString)` at lines 315-346 (same file).

**Existing formatRelative function (lines 315-346) — sibling formatter:**
```javascript
// public/js/shared.js:315-346
function formatRelative(isoString) {
    if (!isoString) return 'No disponible';
    try {
        const past = new Date(isoString).getTime();
        if (Number.isNaN(past)) return 'No disponible';
        const diffMs = Date.now() - past;
        if (diffMs < 0) return 'en el futuro';

        const totalSeconds = Math.floor(diffMs / 1000);
        if (totalSeconds < 60) {
            return 'hace ' + totalSeconds + 's';
        }
        const totalMinutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (totalMinutes < 60) {
            return 'hace ' + totalMinutes + 'm ' + seconds + 's';
        }
        const totalHours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (totalHours < 24) {
            return 'hace ' + totalHours + 'h ' + minutes + 'm';
        }
        const totalDays = Math.floor(totalHours / 24);
        const hours = totalHours % 24;
        return 'hace ' + totalDays + 'd ' + hours + 'h';
    } catch {
        return 'No disponible';
    }
}
```

**Pattern to follow for `formatDurationMin(durationMs)`:** identical structure but takes `durationMs` (number) directly instead of an ISO string, and returns the duration without the "hace " prefix. Per CONTEXT D-04 line 96: should return "14m" / "14m 32s" depending on whether seconds are nonzero. Mirror the totalMinutes / seconds branches above. Skip the ISO-parsing prefix and the "en el futuro" branch — `durationMs` is always non-negative for our call sites.

**Placement decision (CONTEXT Claude's Discretion line 185):**
- Backend uses: `CronScheduler.js` listener (D-04), force-release route handler (D-04 reuses for `previousLock.durationMs` formatting in summary). Backend is CommonJS — needs `require('../utils/duration')` or similar.
- Frontend uses: modal context line uses `formatRelative` (already exists), so frontend does NOT need `formatDurationMin` for the UI itself. However, the `summary` field flows from backend through the API and IS displayed on the dashboard via `renderHistory` at `schedule.html:381-417` — but that field is already fully rendered server-side, no client formatting needed.

**Decision matrix:**

| Option | File | Pro | Con |
|--------|------|-----|-----|
| (a) `src/utils/duration.js` (NEW backend-only util) | server | clean separation; backend has multiple call sites (listener, force-release handler) | new file with one function; small footprint may not justify a new module |
| (b) `src/utils/TimezoneHelper.js` (extend existing) | server | piggybacks on the existing time helper; one fewer file | TimezoneHelper is about formatting current dates, not durations — semantic mismatch |
| (c) Inline in CronScheduler.js | server | zero ceremony | duplicated when the force-release handler also needs it |
| (d) `public/js/shared.js` (extend existing) | frontend | already imported on every page | wrong runtime — backend can't `require('public/js/shared.js')` |

**Recommendation for the planner:** option **(a)**. Create `src/utils/duration.js` exporting `formatDurationMin(durationMs)` AND `formatDurationFull(durationMs)` if needed. CommonJS module: `module.exports = { formatDurationMin };`. Both backend call sites import it.

**If the planner picks (a), no change is needed in `public/js/shared.js`.** The "(modify, optional)" tag in the file list reflects this — the helper goes server-side, frontend uses the existing `formatRelative` for UI, and the dashboard reads the pre-formatted `summary` string from the backend payload.

---

### 9. `tests/services/OperationManager.timer.test.js` (unit test — CREATE)

**Analog:** `tests/services/operation-manager.test.js` (entire file, especially the Phase 17 stepProgress block at lines 269-352).

**Imports + mocks pattern (lines 1-30) — copy verbatim:**
```javascript
// tests/services/operation-manager.test.js:1-30
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

// Mock config.js to avoid .env validation / process.exit
jest.mock('../../src/config', () => ({
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs' },
}));

// Mock LogGenerator to prevent file I/O
jest.mock('../../src/utils/LogGenerator', () => ({
    getLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    })),
}));

const operationManager = require('../../src/services/OperationManager');
```

**Add for Phase 18:** the new test file MUST also mock `src/config` to include `schedule: { lockTimeoutMs: <test-value> }` since OperationManager will read `config.schedule.lockTimeoutMs`. Mock value of `1000` (1 second) keeps tests fast and avoids waiting 14 minutes:

```javascript
// Pattern (planner translates):
jest.mock('../../src/config', () => ({
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs' },
    schedule: { lockTimeoutMs: 1000 },  // 1s — fast test
}));
```

**Reset hook (lines 33-36) — copy verbatim:**
```javascript
// tests/services/operation-manager.test.js:33-36
beforeEach(() => {
    operationManager._reset();
});
```

The modified `_reset()` MUST clear pending timers (see OperationManager pattern). Tests rely on this to prevent timer leaks between cases.

**Existing acquireLock test (lines 41-71) — exact analog for the timer-arming test:**
```javascript
// tests/services/operation-manager.test.js:41-46
test('acquireLock returns true when no lock held for that operation type', () => {
    const result = operationManager.acquireLock('payment-reconciliation', 'op-1');
    expect(result).toBe(true);
});
```

**Pattern to follow for new tests:**

| Test | Strategy |
|------|----------|
| `acquireLock arms a setTimeout when lock is created` | Spy on `global.setTimeout`. Assert it's called with `(any function, lockTimeoutMs)`. Verify the slot's `timeoutHandle` field is populated. |
| `releaseLock cancels the timer` | Spy on `global.clearTimeout`. Acquire then release. Assert `clearTimeout` called with the same handle that `setTimeout` returned. |
| `_fireTimeout emits 'lock:timeout' with correct shape` | **Use Jest fake timers.** `jest.useFakeTimers()` in `beforeAll`. Acquire lock, push some `startStep`/`endStep` entries, then `jest.advanceTimersByTime(1001)`. Listen on `operationManager.on('lock:timeout', ...)` and assert payload shape (operationType, operationId, startedAt, stepProgress, durationMs). |
| `_fireTimeout releases the lock automatically` | After advanceTimersByTime, assert `operationManager.getRunningOperations()` is empty for that type. |
| `releaseLock after timer fires is a no-op (idempotent)` | After `_fireTimeout` (slot already deleted), call `releaseLock` again. Assert no error, no second emit. |
| `_reset clears pending timers (no leak between tests)` | `acquireLock` (timer armed), `_reset()`, advanceTimersByTime well past `lockTimeoutMs`. Assert no `lock:timeout` emit (subscribe a listener and assert it's never called). |

**Existing event-listener test pattern (lines 137-153) — exact analog:**
```javascript
// tests/services/operation-manager.test.js:137-153
test('emitProgress emits event on progress:{operationId} channel', (done) => {
    const event = { /* ... */ };

    operationManager.on('progress:op-1', (received) => {
        expect(received).toEqual(event);
        done();
    });

    operationManager.emitProgress('op-1', event);
});
```

**Pattern to follow for `lock:timeout` emission test (sync version, no `done` callback needed because Jest fake timers make it synchronous):**
```javascript
// Pattern (planner translates):
test('_fireTimeout emits lock:timeout with correct payload after LOCK_TIMEOUT_MS', () => {
    jest.useFakeTimers();
    const events = [];
    operationManager.on('lock:timeout', (payload) => events.push(payload));
    operationManager.acquireLock('background-cycle', 'op-timer-1');
    operationManager.startStep('background-cycle', 'downloadCFDI', 'capstone');

    jest.advanceTimersByTime(1001);  // > lockTimeoutMs (1000 in mocked config)

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({
        operationType: 'background-cycle',
        operationId: 'op-timer-1',
        startedAt: expect.any(String),
        stepProgress: expect.any(Array),
        durationMs: expect.any(Number),
    }));
    expect(events[0].durationMs).toBeGreaterThanOrEqual(1000);
    jest.useRealTimers();
});
```

**Restore real timers in `afterEach`** (parallels the existing `afterAll` cleanup pattern at line 369): call `jest.useRealTimers()` to prevent fake-timer leakage to other test files.

---

### 10. `tests/api/schedule-force-release.test.js` (integration test — CREATE)

**Analog:** `tests/api/schedule-routes.test.js` (entire file — same mock layout, same supertest factory).

**Mock block (lines 1-134) — copy verbatim, no edits needed:** the new test file shares the same dependencies (config, OperationManager, CronScheduler, background, LogGenerator, SQLServerConnection, TimezoneHelper, express-rate-limit, api-key middleware). The exact mock objects used by the trigger-test work identically for the force-release test.

**Test app factory (lines 145-159) — copy verbatim:**
```javascript
// tests/api/schedule-routes.test.js:145-159
function createScheduleTestApp() {
    const app = express();
    app.use(express.json());

    // Mount schedule routes (schedule-routes applies requireApiKey internally on POST)
    const scheduleRoutes = require('../../src/routes/schedule-routes');
    app.use('/api/schedule', scheduleRoutes);

    // Error handler
    app.use((err, req, res, _next) => {
        res.status(500).json(errorResult([err.message], 'Internal server error'));
    });

    return app;
}
```

**Existing trigger-endpoint test block (lines 232-279) — exact template for the new tests:**
```javascript
// tests/api/schedule-routes.test.js:232-279
describe('POST /api/schedule/:taskId/trigger', () => {
    test('returns 200 with operationId when triggered with valid API key', async () => {
        const res = await request(app)
            .post('/api/schedule/background-cycle/trigger')
            .set('x-api-key', TEST_API_KEY);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty('operationId');
        expect(res.body.data.taskId).toBe('background-cycle');
        expect(mockOperationManager.acquireLock).toHaveBeenCalledWith(
            'background-cycle',
            expect.any(String)
        );
    });

    test('returns 401 without API key', async () => {
        const res = await request(app)
            .post('/api/schedule/background-cycle/trigger');

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.errors).toContain('Invalid or missing API key');
    });

    test('returns 409 when acquireLock returns false (already running)', async () => {
        mockOperationManager.acquireLock.mockReturnValue(false);
        // ...
    });

    test('returns 400 for invalid taskId', async () => {
        const res = await request(app)
            .post('/api/schedule/invalid-task/trigger')
            .set('x-api-key', TEST_API_KEY);

        expect(res.status).toBe(400);
        // ...
    });
});
```

**Pattern to follow for `POST /api/schedule/:taskId/force-release`:**

| Scenario | Test | Mock setup | Expected |
|----------|------|------------|----------|
| With lock active, valid API key, no body | POST `/api/schedule/background-cycle/force-release` + `x-api-key` | `mockOperationManager.getRunningOperations` returns `{ 'background-cycle': { operationId: 'op-x', startedAt: <ISO>, stepProgress: [...] } }` | 200 + `success:true` + `data.released:true` + `data.previousLock` matches snapshot. `releaseLock` was called. `addHistory` was called once. `sendMail` (or admin-email helper) was called. |
| With NO lock active (idempotent path) | POST + `x-api-key` | `getRunningOperations` returns `{}` | 200 + `success:true` + `data.released:false` + `data.previousLock:null`. `releaseLock` NOT called. `addHistory` NOT called (or called — D-08 says email both paths, so addHistory should also be in both paths; planner verifies). `sendMail` NOT called. |
| With body `{reason: "test"}` | POST + body + `x-api-key` | lock active | 200 + reason flows to `addHistory` summary or email body. |
| Without API key | POST without header | (any) | 401 + `errors: ['Invalid or missing API key']`. |
| Invalid taskId | POST `/api/schedule/foo/force-release` + `x-api-key` | (any) | 400 + Joi error. |
| Invalid body (reason > 200 chars) | POST + oversized reason + `x-api-key` | (any) | 400 + Joi error. |
| ResultEnvelope shape | (any successful case) | (any) | response has `success`, `data`, `errors:[]`, `summary:string`, `meta:{duration:number, timestamp:string, tenant:null}`. Per `tests/api/schedule-routes.test.js:189-196` the trigger test asserts the same envelope. |

**Mock setup detail (CRITICAL):** the existing `mockOperationManager` at lines 47-58 lacks `getRunningOperations` returning anything realistic (it returns `{}` per line 53 default). The new test must override per-case:
```javascript
// Pattern (planner translates):
mockOperationManager.getRunningOperations.mockReturnValue({
    'background-cycle': {
        operationId: 'op-test-1',
        startedAt: '2026-04-28T18:14:32.000Z',
        stepProgress: [
            { step: 'downloadCFDI', tenant: 'capstone', startedAt: '2026-04-28T18:15:00.000Z', finishedAt: null, error: null },
        ],
    },
});
```

**Mock for `sendMail` (NEW — not in existing schedule-routes.test.js):** add a `jest.mock('../../src/utils/EmailSender', ...)` block at the top, mirror the existing module-mock style (lines 84-98):
```javascript
jest.mock('../../src/utils/EmailSender', () => ({
    sendMail: jest.fn().mockResolvedValue({ accepted: ['admin@test'], rejected: [] }),
}));
```

This ensures the route handler's email-fire-and-forget call doesn't try to make a real SMTP connection. Tests assert `sendMail` was called with the expected `data` shape.

**Existing TEST_API_KEY constant (line 143) — reuse:** `const TEST_API_KEY = 'test-api-key';`

**Existing `beforeEach` resetting mocks (lines 172-178) — reuse style:** add `mockOperationManager.getRunningOperations.mockReturnValue({})` to the default reset to avoid stale state.

---

### 11. `tests/services/CronScheduler.timeout-listener.test.js` (unit test — CREATE)

**Primary analog:** `tests/services/cron-scheduler.test.js` (whole file) — same mock layout for cron, OperationManager, background, LicenseValidator, LogGenerator.

**Secondary analog:** `tests/api/operations-routes.test.js:46-58` — the **real `EventEmitter` mock** technique:
```javascript
// tests/api/operations-routes.test.js:46-58
const { EventEmitter } = require('events');

const mockOpManager = new EventEmitter();
mockOpManager.getRunningOperations = jest.fn().mockReturnValue({});
mockOpManager.acquireLock = jest.fn().mockReturnValue(true);
mockOpManager.releaseLock = jest.fn();
mockOpManager.isLocked = jest.fn().mockReturnValue(false);
mockOpManager.emitProgress = jest.fn();
mockOpManager.getHistory = jest.fn().mockReturnValue([]);
mockOpManager.addHistory = jest.fn();
mockOpManager._reset = jest.fn();
mockOpManager.setMaxListeners(20);

jest.mock('../../src/services/OperationManager', () => mockOpManager);
```

This is critical — the cron-scheduler.test.js uses a plain object mock (lines 41-49) that does NOT extend `EventEmitter`, so `.on()` and `.emit()` would fail. The new listener-test MUST use the `operations-routes.test.js` style (real `EventEmitter` + jest.fn methods bolted on) to be able to actually emit `lock:timeout` and assert the listener handles it.

**Mock layout (combine both analogs):**
```javascript
// Pattern (planner translates — combines cron-scheduler.test.js mocks + operations-routes.test.js EventEmitter pattern):
const { describe, test, expect, beforeEach } = require('@jest/globals');
const { EventEmitter } = require('events');

// Mock node-cron (verbatim from cron-scheduler.test.js:14-22)
const mockTask = { getStatus: jest.fn(), getNextRun: jest.fn(), on: jest.fn() };
jest.mock('node-cron', () => ({ schedule: jest.fn(() => mockTask) }));

// Mock config.js (verbatim from cron-scheduler.test.js:25-38, plus add lockTimeoutMs)
jest.mock('../../src/config', () => ({
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 1000, lockTimeoutMs: 1000 },
    app: { timezone: 'America/Mexico_City', company: 'TestCo' },
    portal: { tenants: [{ id: 'T1' }] },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs' },
    license: { adminEmail: 'admin@test.com' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', password: '' },
}));

// Mock OperationManager AS A REAL EVENTEMITTER (operations-routes.test.js style)
const mockOpManager = new EventEmitter();
mockOpManager.acquireLock = jest.fn(() => true);
mockOpManager.releaseLock = jest.fn();
mockOpManager.addHistory = jest.fn();
mockOpManager.startStep = jest.fn();
mockOpManager.endStep = jest.fn();
mockOpManager.emitProgress = jest.fn();
mockOpManager.getRunningOperations = jest.fn(() => ({}));
mockOpManager.setMaxListeners(20);
jest.mock('../../src/services/OperationManager', () => mockOpManager);

// Mock background.js / LicenseValidator / LogGenerator (verbatim from cron-scheduler.test.js)
jest.mock('../../src/background', () => ({ forResponse: jest.fn().mockResolvedValue(undefined), startChildProcess: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../src/services/LicenseValidator', () => ({ isValid: jest.fn(() => true), validate: jest.fn(), getStatus: jest.fn(), _reset: jest.fn() }));
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: jest.fn() }));

// Mock EmailSender (NEW for this test — listener calls sendMail)
const mockSendMail = jest.fn().mockResolvedValue({ accepted: ['admin@test.com'] });
jest.mock('../../src/utils/EmailSender', () => ({ sendMail: mockSendMail }));
```

**isolateModules pattern (lines 88-101) — reuse for fresh CronScheduler per test:**
```javascript
// tests/services/cron-scheduler.test.js:96-101 (verbatim)
jest.isolateModules(() => {
    CronScheduler = require('../../src/services/CronScheduler');
});
```

**Pattern to follow for the new test cases:**

| Test | Strategy |
|------|----------|
| `initScheduler registers a 'lock:timeout' listener on operationManager` | Before `initScheduler`, assert `mockOpManager.listenerCount('lock:timeout') === 0`. After `initScheduler`, assert it equals `1`. |
| `lock:timeout listener calls addHistory with the correct shape` | Emit `mockOpManager.emit('lock:timeout', { operationType: 'background-cycle', operationId: 'op-z', startedAt: '<ISO>', stepProgress: [...], durationMs: 14*60*1000 })`. Assert `mockOpManager.addHistory` was called once with shape including `taskId`, `success:false`, `errors:['Timeout']`, `summary:` containing 'Timeout', `stuckOnStep`, `stuckOnTenant`. |
| `lock:timeout listener calls sendMail with subject indicating Auto-timeout` | After emit, assert `mockSendMail` was called with `data.h1` matching pattern `/Auto-timeout/` (Spanish text per CONTEXT D-08). |
| `lock:timeout listener logs to LogGenerator with 'warn' level` | Assert `mockLogGenerator` (from `LogGenerator` mock) was called with `('CronScheduler', 'warn', /TIMEOUT/)`. |
| `lock:timeout listener swallows sendMail errors` | `mockSendMail.mockRejectedValue(new Error('SMTP down'))`. Emit. Assert listener does NOT throw (the test passes if no exception leaks; LogGenerator should be called with 'warn' for the email failure). |
| `stuckOnStep / stuckOnTenant derived correctly from stepProgress` | Emit with `stepProgress: [{step:'a', tenant:'t1', finishedAt:'...'}, {step:'b', tenant:'t2', finishedAt:null}]`. Assert addHistory's record has `stuckOnStep:'b'`, `stuckOnTenant:'t2'`. |
| `stuckOnStep is null when stepProgress is empty` | Empty stepProgress array. Assert `stuckOnStep:null`, `stuckOnTenant:null`. |
| `listener does not double-register on second initScheduler call` | (defensive) Although `initScheduler` is called once at startup, ensure that if it accidentally runs twice (e.g. during a hot-reload), listenerCount stays bounded — either by checking `listenerCount` before adding, or by accepting two listeners and writing the test to assert exactly the boot-time behavior. **Recommendation: planner decides — if `initScheduler` is idempotent in design, write the test for that. If not, document the constraint.** |

**Existing assertion style (cron-scheduler.test.js:201-217) — copy for shape verification:**
```javascript
// tests/services/cron-scheduler.test.js:201-217
const record = mockOperationManager.addHistory.mock.calls[0][0];
expect(record).toEqual(
    expect.objectContaining({
        taskId: 'background-cycle',
        operationId: MOCK_UUID,
        success: true,
        errors: [],
    })
);
expect(record.startedAt).toBeDefined();
expect(record.finishedAt).toBeDefined();
expect(record.summary).toBeDefined();
```

---

## Shared Patterns

### Pattern S-1: Lazy-load + initScheduler timing (the listener-registration trap)

**Source:** `src/routes/schedule-routes.js:26-32` (lazy-load) + `src/index.js:27` (single-call boot).

**Apply to:** `src/services/CronScheduler.js` (the `lock:timeout` listener registration).

**Concrete excerpt (line 26-32):**
```javascript
// src/routes/schedule-routes.js:26-32
let cronScheduler = null;
try {
    cronScheduler = require('../services/CronScheduler');
} catch (_e) {
    // Plan 02 (CronScheduler) not yet executed -- use defaults
}
```

**Lesson:** the existing codebase uses lazy-load defensively. If listener registration runs at module-require time (inside `module.exports = (function setup() { ... })()` or top-level `operationManager.on('lock:timeout', ...)`), then any caller that lazy-loads CronScheduler (including future tests, and the live `schedule-routes` consumer) will accidentally trigger registration in unintended contexts.

**Required behavior:** register `operationManager.on('lock:timeout', ...)` ONLY inside the body of `initScheduler()` (which is called exactly once from `src/index.js:27`). Do not call from module top-level.

### Pattern S-2: ResultEnvelope shape (every API response)

**Source:** `src/utils/ResultEnvelope.js:23-35` (`createResult`) + `:47-49` (`successResult`).

**Apply to:** `src/routes/schedule-routes.js` (force-release handler).

**Concrete excerpt (line 23-35):**
```javascript
// src/utils/ResultEnvelope.js:23-35
function createResult(success, { data = null, errors = [], summary = '', tenant = null } = {}, startTime) {
    return {
        success,
        data,
        errors: Array.isArray(errors) ? errors : [errors],
        summary,
        meta: {
            duration: startTime ? Date.now() - startTime : 0,
            timestamp: new Date().toISOString(),
            tenant,
        },
    };
}
```

```javascript
// src/utils/ResultEnvelope.js:47-49
function successResult(data, summary, { tenant = null, startTime = null } = {}) {
    return createResult(true, { data, errors: [], summary, tenant }, startTime);
}
```

**Apply EXACTLY:** `res.json(successResult({ released: <bool>, previousLock: <object|null> }, 'Lock background-cycle liberado'))`. Never construct envelope literals by hand.

### Pattern S-3: asyncHandler always wraps async route bodies

**Source:** `src/middleware/async-handler.js:12`.

**Apply to:** `src/routes/schedule-routes.js` (force-release handler).

**Concrete excerpt:**
```javascript
// src/middleware/async-handler.js:12
const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
```

**Apply:** `asyncHandler(async (req, res) => { ... })` — never raw `async (req, res) => { ... }` directly. Errors `throw`n inside auto-route to the central error handler.

### Pattern S-4: Middleware order on write endpoints

**Source:** `src/routes/schedule-routes.js:108-113` (trigger).

**Apply to:** new force-release handler.

**Concrete excerpt:**
```javascript
// src/routes/schedule-routes.js:108-113
router.post(
    '/:taskId/trigger',
    requireApiKey,                                    // 1. auth
    validate(triggerSchema, 'params'),                // 2. input validation
    writeLimiter,                                     // 3. rate limit
    asyncHandler(async (req, res) => { /* ... */ })   // 4. business logic
);
```

**Apply EXACTLY:** `requireApiKey → validate(params) → validate(body) → writeLimiter → asyncHandler`. The body-validate slot is new (trigger has only params validation); insert it between params-validate and writeLimiter.

### Pattern S-5: addHistory entry shape (for the timeout listener AND force-release handler)

**Source:** `src/services/CronScheduler.js:64-72` (license-skip path — closest analog for "non-success entry") + D-04 in CONTEXT for the timeout-specific extensions.

**Apply to:** `src/services/CronScheduler.js` (lock:timeout listener) AND `src/routes/schedule-routes.js` (force-release handler).

**Base shape (existing — line 64-72):**
```javascript
// src/services/CronScheduler.js:64-72
operationManager.addHistory({
    taskId: 'background-cycle',
    operationId,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    success: false,
    errors: ['Licencia inactiva'],
    summary: 'Ciclo omitido: licencia inactiva',
});
```

**Phase 18 extension (CONTEXT D-04):** add two extra fields:
```javascript
// Pattern (planner translates — auto-release listener):
operationManager.addHistory({
    taskId: operationType,                                  // 'background-cycle'
    operationId,
    startedAt,
    finishedAt: new Date().toISOString(),
    success: false,
    errors: ['Timeout'],
    summary: `Timeout — lock forzosamente liberado después de ${formatDurationMin(durationMs)}`,
    stuckOnStep: lastOpenStep?.step ?? null,
    stuckOnTenant: lastOpenStep?.tenant ?? null,
});
```

```javascript
// Pattern (planner translates — force-release handler):
operationManager.addHistory({
    taskId,
    operationId: previousLock.operationId,
    startedAt: previousLock.startedAt,
    finishedAt: new Date().toISOString(),
    success: false,
    errors: ['ManualForceRelease'],
    summary: `Lock forzado manualmente por operador${reason ? ` (motivo: ${reason})` : ''}`,
    stuckOnStep: previousLock.stuckOnStep,
    stuckOnTenant: previousLock.stuckOnTenant,
});
```

`OperationManager.addHistory` (line 145-150) accepts arbitrary keys — it's a plain `this.history.push(record)`. Existing consumers (`getHistory()`, `schedule-routes.js:92`, `renderHistory` in `schedule.html:381`) iterate without filtering keys, so the new fields surface naturally in the API + dashboard without further changes.

### Pattern S-6: Email-to-admin (the analog is LicenseValidator, NOT EmailSender)

**Source:** `src/services/LicenseValidator.js:128-155` (`sendLicenseAlert`).

**Apply to:** `src/services/CronScheduler.js` (lock:timeout listener) AND `src/routes/schedule-routes.js` (force-release handler).

**Concrete excerpt:** see full body reproduced in section 2 above.

**Key invariants the new code MUST preserve:**
1. **Recipient = `config.license.adminEmail`** (NOT `config.mailing.notices`).
2. **Subject prefix = `'[SageConnect] '`** (literal — see line 146).
3. **try/catch swallow** — email failure logs `'warn'` and continues. NEVER throws. Comment explicitly: "Email failure must NOT block the lock-release flow" (mirroring the LicenseValidator comment at line 151).
4. **`html` body** includes operationId, startedAt, durationMs (formatted), stuckOnStep, stuckOnTenant, AND for force-release path the `reason` if provided.

**Subject distinction (CONTEXT D-08):**
- Auto-release: `'[SageConnect] Auto-timeout: lock <operationType> liberado después de <duración>'`
- Force-release: `'[SageConnect] Liberación manual: lock <operationType> forzado por operador'`

### Pattern S-7: Logging via logGenerator (every winston call goes through this)

**Source:** `src/utils/LogGenerator.js` (existing wrapper) + `src/services/CronScheduler.js:22, :49, :78, :98` (call sites).

**Apply to:** `src/services/CronScheduler.js` (listener) AND `src/routes/schedule-routes.js` (force-release handler).

**Concrete excerpt:**
```javascript
// src/services/CronScheduler.js:22
const LOG_FILE = 'CronScheduler';

// src/services/CronScheduler.js:49 (warn)
logGenerator(LOG_FILE, 'warn', `[OVERLAP] background-cycle lock not acquired for ${operationId} -- skipping`);

// src/services/CronScheduler.js:98 (error)
logGenerator(LOG_FILE, 'error', `[ERROR] Background cycle ${operationId} failed: ${error.message}`);
```

**Apply:**
- Auto-release listener: `logGenerator('CronScheduler', 'warn', '[TIMEOUT] Auto-released lock <operationType> after <duration> -- operationId=<id>, stuckOnStep=<step>')`. Per CONTEXT line 187, auto-release uses `info` for "exitoso" and `warn` for the actual timeout (the latter is more precise — a timeout IS exceptional). Use `'warn'`.
- Force-release route: `logGenerator('schedule-routes' or new LOG_FILE, 'warn', '[FORCE-RELEASE] Manual force-release of lock <operationType> -- operationId=<id>, reason=<reason or "(none)">')`.
- Email failure: `logGenerator(<same LOG_FILE>, 'warn', '[TIMEOUT-EMAIL] Failed: <err.message>')` — non-blocking.

The `LOG_FILE` for `schedule-routes.js` is currently undeclared (the file does not log explicitly today). The planner can either declare a new `const LOG_FILE = 'ScheduleRoutes';` at the top of the file OR import `logGenerator` and use `'CronScheduler'` to keep all schedule-related logs in one file. **Recommendation:** new `LOG_FILE = 'ScheduleRoutes'` to mirror the per-module convention seen in `LicenseValidator` (LOG_FILE = 'LicenseValidator'), `EmailSender` (LOG_FILE = 'EmailSender'), and 14 other modules.

### Pattern S-8: Bootstrap component init (Toast precedent only — Modal is new)

**Source:** `public/js/shared.js:204-205` (the ONLY existing `new bootstrap.X` in the codebase).

**Apply to:** `public/schedule.html` (modal interactions).

**Concrete excerpt:**
```javascript
// public/js/shared.js:204-205
const toastEl = document.getElementById(id);
const bsToast = new bootstrap.Toast(toastEl, { delay: 5000 });
bsToast.show();
```

**Apply:** Bootstrap 5.3 modal pattern (declarative trigger via `data-bs-toggle="modal"`, programmatic hide via `bootstrap.Modal.getInstance(el).hide()`). UI-SPEC section "Component Inventory > 1. Force-release button" hands the planner the exact markup. The trigger button uses the declarative `data-bs-toggle="modal" data-bs-target="#forceReleaseModal"` attribute pair, so no JS is needed to OPEN the modal — Bootstrap auto-instantiates. Programmatic close after success uses `getInstance(...)` (returns the cached instance from the auto-init).

**Verify:** Bootstrap CDN is already loaded at `public/schedule.html:12-14` with integrity hash. No new CDN tag required.

### Pattern S-9: Test mocks for config validation bypass

**Source:** `tests/services/operation-manager.test.js:13-17` and `tests/api/schedule-routes.test.js:17-42`.

**Apply to:** all new test files.

**Concrete excerpt (operation-manager.test.js style — minimal):**
```javascript
// tests/services/operation-manager.test.js:13-17
jest.mock('../../src/config', () => ({
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs' },
}));
```

**Apply:** every new test file MUST mock `src/config` BEFORE any other `require` to prevent `process.exit(1)` from `validate()` (`src/config.js:36-57`) when the test runner doesn't have a real `.env` populated. Add `schedule.lockTimeoutMs` to the mock for Phase 18 tests.

### Pattern S-10: stuckOnStep / stuckOnTenant derivation (used by listener AND route handler)

**Source:** existing pattern in `public/schedule.html:695-700` (the "find last open step" iteration).

**Apply to:** `src/services/CronScheduler.js` (listener) AND `src/routes/schedule-routes.js` (force-release handler) — both must derive these fields from `stepProgress` to populate D-04 fields.

**Concrete excerpt (frontend — but identical algorithm applies server-side):**
```javascript
// public/schedule.html:695-700
let active = null;
for (let i = sp.length - 1; i >= 0; i--) {
    if (!sp[i].finishedAt) { active = sp[i]; break; }
}
```

**Apply server-side:**
```javascript
// Pattern (planner translates):
function findLastOpenStep(stepProgress) {
    if (!Array.isArray(stepProgress)) return null;
    for (let i = stepProgress.length - 1; i >= 0; i--) {
        if (!stepProgress[i].finishedAt) return stepProgress[i];
    }
    return null;
}
const lastOpenStep = findLastOpenStep(stepProgress);
const stuckOnStep = lastOpenStep?.step ?? null;
const stuckOnTenant = lastOpenStep?.tenant ?? null;
```

This helper could live in `src/utils/duration.js` (next to `formatDurationMin`) or inline. **Recommendation:** inline (one usage per call site, three lines). Keep `src/utils/duration.js` focused on duration formatting only.

---

## No Analog Found

**None.** Every file in the Phase 18 file list has a strong existing analog in the codebase. The most novel additions are:

1. **Bootstrap Modal usage in `public/schedule.html`** — first modal in the project (Toast is the only `bootstrap.X` precedent). Bootstrap is already loaded; the pattern is well-known across the Bootstrap ecosystem; UI-SPEC dictates exact markup.
2. **`lock:timeout` event** — second `OperationManager` event (after `progress:{operationId}`). Pattern is identical (existing emit at line 128-130 + existing listener at `operations-routes.js:81`).
3. **`config.schedule.lockTimeoutMs` post-build range validation** — first numeric range check in `config.js`. Pattern is to mirror the existing `validate()` fail-fast style (lines 36-57).

These are extensions of established patterns, not new architectural patterns. Planner should reference the analog files cited per file above; nothing requires consulting `RESEARCH.md` for Phase 18.

---

## Metadata

**Analog search scope (read in this session):**
- `src/services/OperationManager.js` (full)
- `src/services/CronScheduler.js` (full)
- `src/services/LicenseValidator.js` (lines 1-160, focused on email helper)
- `src/routes/schedule-routes.js` (full)
- `src/routes/operations-routes.js` (full)
- `src/routes/schemas/schedule-schemas.js` (full)
- `src/routes/schemas/payment-schemas.js` (lines 1-80, body-schema analog)
- `src/routes/payment-routes.js` (lines 30-120, middleware-order analog)
- `src/utils/EmailSender.js` (full)
- `src/utils/ResultEnvelope.js` (full)
- `src/utils/TimezoneHelper.js` (full)
- `src/middleware/async-handler.js` (full)
- `src/middleware/api-key.js` (full)
- `src/middleware/validate.js` (full)
- `src/config.js` (full)
- `src/index.js` (full)
- `public/schedule.html` (full, 770 lines)
- `public/js/shared.js` (full, 416 lines)
- `tests/services/operation-manager.test.js` (full, 425 lines)
- `tests/services/cron-scheduler.test.js` (full, 325 lines)
- `tests/api/schedule-routes.test.js` (full, 281 lines)
- `tests/api/operations-routes.test.js` (full, 312 lines)
- `tests/EmailSender.test.js` (full, 45 lines)
- `tests/config.test.js` (full, 434 lines)

**Files scanned via Grep (signature/pattern lookups):** ~40 across `src/` and `public/`.

**Pattern extraction date:** 2026-04-28
