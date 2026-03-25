# Phase 7: REST API + Security - Research

**Researched:** 2026-03-23
**Domain:** Express.js REST API layer with security middleware (helmet, cors, rate-limit) and Joi request validation
**Confidence:** HIGH

## Summary

Phase 7 adds an HTTP API layer on top of the 14 script functions extracted in Phase 6. The core task is wiring Express route handlers to existing exported functions that already return `ResultEnvelope` objects (`{ success, data, errors, summary, meta }`). The envelope-passthrough design means route handlers are thin: parse request params, call script function, map envelope to HTTP status, send `res.json(result)`.

Three new npm dependencies are needed: `helmet` (security headers), `cors` (cross-origin configuration), and `express-rate-limit` (throttling). All three are mature, well-maintained packages with CommonJS support that integrate as standard Express middleware. The project already has `joi@17.13.3` for model validation -- the same library will be used to build request validation schemas.

**Primary recommendation:** Use a thin validation middleware factory (`validate(schema, source)`) that wraps Joi schemas and returns 400 errors in the envelope format. Route handlers should be pure orchestrators: validate -> call function -> map status -> respond.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Split routes by domain: `payment-routes.js`, `po-routes.js`, `system-routes.js`
- Move existing 7 dashboard routes from `routes.js` to `dashboard-routes.js` -- all route files follow the same pattern
- `routes.js` becomes an index that mounts all route files
- Security middleware (helmet, cors, rate-limit) applied globally in `server.js`
- API key middleware applied per-route-group (all /api/payments and /api/pos endpoints)
- Single `API_KEY` stored in `.env`, loaded via `config.js`
- All /api/payments and /api/pos endpoints require the API key (both GET and POST/PUT)
- API key passed via `x-api-key` header
- Dashboard routes (/api/dashboard, /api/logs, etc.) remain unauthenticated -- internal monitoring
- Single key for all operations -- 1-2 internal users, no need for per-domain separation
- Mapped status codes: 200 (success), 400 (validation errors), 404 (not found), 500 (internal errors), 401 (missing/invalid API key), 429 (rate limited)
- Envelope passes through directly as HTTP response body: `res.status(code).json(result)` -- zero transformation
- Route handler determines HTTP status from envelope content (success -> 200, errors with validation -> 400, etc.)
- Destructive endpoints (upload, repair, update) default to dry-run mode -- require explicit `?dryRun=false` to execute
- `tenantIndex` defaults to 0 but accepts any valid index -- multi-tenant on PdP side
- Single API key for the internal API regardless of tenant
- Endpoints block until script finishes and return full result -- synchronous
- SSE for long-running operations deferred to Phase 8
- Joi schemas for all endpoint parameters (tenantIndex range, PO numbers format, date formats, etc.)
- Invalid inputs return 400 with Joi validation details in the envelope `errors` field

### Claude's Discretion
- Specific Joi schemas per endpoint (field requirements, formats, ranges)
- Rate limit thresholds (requests per window)
- CORS allowed origins configuration
- HTTP status code mapping logic implementation details

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PAY-01 | POST /api/payments/reconciliation runs payment reconciliation with tenant/date/batch filters | `main()` in payment-reconciliation.js orchestrates classifyPayments+uploadBatch -- needs wrapper function or refactor to accept options={} |
| PAY-02 | GET /api/payments/uuid-diagnostic returns UUID diagnostic for specific PY document numbers | `diagnosePayment(options={})` already accepts options pattern |
| PAY-03 | POST /api/payments/uuid-repair/scan scans for repairable UUIDs | `scanForRepairableUUIDs(options={})` already accepts options pattern |
| PAY-04 | POST /api/payments/uuid-repair/repair applies UUID repairs (dry-run by default) | `repairUUIDs(options={})` already accepts options pattern |
| PAY-05 | POST /api/payments/uuid-repair/upload uploads repaired payments to portal | `uploadRepairedPayments(options={})` already accepts options pattern |
| PAY-06 | POST /api/payments/generate generates payment JSON and optionally posts to portal | `generatePayments(options={})` already accepts options pattern |
| PAY-07 | GET /api/payments/cfdis fetches CFDI Type P invoices from portal | `getTypePTest(index)` takes positional arg -- needs thin wrapper or options adapter |
| PO-01 | GET /api/pos/diagnostic returns comprehensive PO diagnostic | `diagnosticPO(poNumber, database, empresa)` takes positional args |
| PO-02 | GET /api/pos/query validates specific POs without posting | `testSpecificPurchaseOrders(poNumbers, database, tenantIndex)` takes positional args |
| PO-03 | POST /api/pos/upload posts POs to Portal de Proveedores | `uploadSpecificPurchaseOrders(poNumbers, database, tenantIndex)` takes positional args |
| PO-04 | PUT /api/pos/update updates PO in portal (dry-run by default) | `testPurchaseOrderUpdate(poNumber, database, tenantIndex, dryRun)` takes positional args |
| PO-05 | GET /api/pos/address-diagnostic returns address config diagnostic | `diagnosticPOAddress(poNumber, database)` takes positional args |
| PO-06 | GET /api/pos/payment-form-diagnostic returns CFDI payment form diagnostic | `diagnosticPaymentForm(poNumber, database)` takes positional args |
| PO-07 | POST /api/pos/upload-authorized uploads today's authorized POs | `uploadAuthorizedPOs(options={})` already accepts options pattern |
| PO-08 | POST /api/pos/lifecycle manages PO lifecycle (analyze/process/tenant modes) | `analyzeOrders/processOrders/testTenant(options={})` all accept options pattern |
| SEC-01 | helmet middleware for HTTP security headers | helmet@8.x applied globally in server.js |
| SEC-02 | cors middleware configured for internal network | cors@2.8.x applied globally in server.js |
| SEC-03 | express-rate-limit on write endpoints | express-rate-limit@7.x applied globally + stricter on write routes |
| SEC-04 | API key middleware for all /api/payments and /api/pos endpoints (user decision expands from original destructive-only) | Custom middleware checking x-api-key header against config value |

</phase_requirements>

## Standard Stack

### Core (New Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| helmet | ^8.0.0 | HTTP security headers (13 headers by default) | 7.6M weekly npm downloads, Express official recommendation |
| cors | ^2.8.5 | Cross-origin resource sharing middleware | Express official middleware, 23K dependents |
| express-rate-limit | ^7.5.0 | IP-based request rate limiting | 15.6M weekly npm downloads, in-memory store sufficient for 1-2 users |

### Existing (Already Installed)
| Library | Version | Purpose | Role in Phase 7 |
|---------|---------|---------|-----------------|
| express | 4.21.1 | HTTP framework | Route handling, middleware pipeline |
| joi | 17.13.3 | Schema validation | Request parameter validation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| express-rate-limit | rate-limiter-flexible | More features (Redis, penalties) but overkill for 1-2 internal users with in-memory store |
| Custom Joi middleware | celebrate/express-joi-validation | Extra dependency when a 15-line factory function does the same thing |
| helmet defaults | Manual header setting | helmet sets 13 headers correctly; hand-rolling misses edge cases |

**Installation:**
```bash
npm install helmet cors express-rate-limit
```

**Important version notes:**
- `express-rate-limit` v7+ uses named export for CommonJS: `const { rateLimit } = require('express-rate-limit')`
- `helmet` v8.x works with `const helmet = require('helmet')` (CommonJS default export)
- `cors` v2.8.x works with `const cors = require('cors')` (CommonJS default export)
- Do NOT install v8.x of express-rate-limit -- it may drop CommonJS support. Pin to ^7.5.0.

## Architecture Patterns

### Recommended Project Structure
```
src/
  routes/
    routes.js              # Index: mounts all route files
    payment-routes.js      # 7 payment endpoints (PAY-01..PAY-07)
    po-routes.js           # 8 PO endpoints (PO-01..PO-08)
    system-routes.js       # Health check, future system routes
    dashboard-routes.js    # Moved from current routes.js (7 existing routes)
  middleware/
    api-key.js             # x-api-key validation middleware
    validate.js            # Joi validation middleware factory
  scripts/                 # Already exists -- 13 scripts + lifecycle
  utils/
    ResultEnvelope.js      # Already exists
  config.js                # Add API_KEY to validation + config object
  server.js                # Add helmet, cors, rate-limit as global middleware
```

### Pattern 1: Validation Middleware Factory
**What:** A reusable factory that creates Express middleware from Joi schemas
**When to use:** Every route that accepts parameters (query, body, params)
**Example:**
```javascript
// src/middleware/validate.js
const Joi = require('joi');
const { errorResult } = require('../utils/ResultEnvelope');

/**
 * Creates Express middleware that validates request data against a Joi schema.
 * @param {Joi.Schema} schema - Joi schema to validate against
 * @param {'query'|'body'|'params'} source - Request property to validate
 */
function validate(schema, source = 'query') {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[source], {
            abortEarly: false,
            stripUnknown: true,
            convert: true,
        });
        if (error) {
            const errors = error.details.map(d => d.message);
            return res.status(400).json(
                errorResult(errors, 'Validation failed')
            );
        }
        req[source] = value; // Replace with validated+converted values
        next();
    };
}

module.exports = { validate };
```

### Pattern 2: API Key Middleware
**What:** Middleware that checks `x-api-key` header against configured value
**When to use:** Applied to all /api/payments and /api/pos route groups
**Example:**
```javascript
// src/middleware/api-key.js
const config = require('../config');
const { errorResult } = require('../utils/ResultEnvelope');

function requireApiKey(req, res, next) {
    const key = req.headers['x-api-key'];
    if (!key || key !== config.security.apiKey) {
        return res.status(401).json(
            errorResult(['Invalid or missing API key'], 'Unauthorized')
        );
    }
    next();
}

module.exports = { requireApiKey };
```

### Pattern 3: Envelope-to-HTTP Status Mapping
**What:** Helper that determines HTTP status code from a ResultEnvelope
**When to use:** Every route handler, after calling the script function
**Example:**
```javascript
// Inside route handler or as a helper
function sendResult(res, result) {
    let status = 200;
    if (!result.success) {
        // Determine status from error context
        if (result.errors.some(e => /not found/i.test(e))) {
            status = 404;
        } else if (result.errors.some(e => /validation/i.test(e))) {
            status = 400;
        } else {
            status = 500;
        }
    }
    return res.status(status).json(result);
}
```

### Pattern 4: Thin Route Handler
**What:** Route handlers that do nothing but wire request to script function
**When to use:** All 15 endpoints
**Example:**
```javascript
// src/routes/payment-routes.js
const express = require('express');
const router = express.Router();
const { validate } = require('../middleware/validate');
const { generatePayments } = require('../scripts/portal-payments-generator');
const { generatePaymentsSchema } = require('./schemas/payment-schemas');

router.post('/generate',
    validate(generatePaymentsSchema, 'body'),
    async (req, res, next) => {
        try {
            const result = await generatePayments({
                tenantIndex: req.body.tenantIndex,
                pyFilter: req.body.pyFilter,
                dateFilter: req.body.dateFilter,
                shouldPost: req.body.dryRun === false, // dry-run default
            });
            sendResult(res, result);
        } catch (err) {
            next(err);
        }
    }
);
```

### Pattern 5: Global Middleware Stack Order
**What:** Correct ordering of middleware in server.js
**When to use:** server.js setup
**Example:**
```javascript
// server.js -- middleware order matters
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');

// 1. Security headers (first -- applies to all responses including errors)
app.use(helmet());

// 2. CORS (before routes -- handles preflight OPTIONS)
app.use(cors({ origin: true })); // reflect request origin for internal use

// 3. Rate limiting (before routes)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, data: null, errors: ['Too many requests'], summary: 'Rate limited', meta: {} },
});
app.use('/api', globalLimiter);

// 4. Body parsing (before routes that read body)
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// 5. Routes
app.use(require('./routes/routes'));
```

### Anti-Patterns to Avoid
- **Fat route handlers:** Do NOT put business logic in route files. The script function is the logic; the route handler is just plumbing.
- **Transforming envelopes:** Do NOT reshape the envelope before sending. The decision is `res.status(code).json(result)` -- envelope passes through as-is.
- **Positional args in route handlers:** For scripts that still use positional args (PO scripts, get-payment-cfdis), create a thin adapter in the route handler that maps request params to the positional args. Do NOT refactor script signatures in this phase.
- **Global rate limit only:** Apply a tighter rate limit to write endpoints (POST/PUT) beyond the global limit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP security headers | Custom header-setting middleware | `helmet()` | 13 headers with correct values; CSP, HSTS, X-Frame-Options interactions are subtle |
| Rate limiting | Custom counter with timestamps | `express-rate-limit` | Handles sliding windows, IPv6 subnet masking, standard headers, edge cases |
| CORS handling | Manual Access-Control-* headers | `cors()` | Preflight (OPTIONS) handling, credential negotiation, origin reflection |
| Request validation | Manual if/else checks on req.body | Joi schemas + validate middleware | Type coercion, detailed error messages, composable schemas |
| API key comparison | `req.headers['x-api-key'] == apiKey` | Constant-time comparison (`crypto.timingSafeEqual`) | Timing attack prevention (though low risk on internal network, it's the correct pattern) |

**Key insight:** The three security packages (helmet, cors, rate-limit) each handle dozens of edge cases that are invisible until exploited. The cost is three `npm install` calls; the alternative is weeks of security review.

## Common Pitfalls

### Pitfall 1: payment-reconciliation Has No Single Entry Point
**What goes wrong:** The `main()` function in payment-reconciliation.js is the orchestrator but is NOT exported. Only `classifyPayments` and `uploadBatch` are exported -- these are mid-level functions that require pre-fetched data (portal UUIDs, deduped rows).
**Why it happens:** Phase 6 extracted the existing functions without creating a top-level API-friendly wrapper because the CLI flow was complex.
**How to avoid:** For PAY-01, the route handler needs to either: (a) create a new exported wrapper function that encapsulates what `main()` does with options={} interface, or (b) replicate the orchestration logic in the route handler (bad -- violates thin handler pattern). Option (a) is correct.
**Warning signs:** If the route handler is more than 10 lines, it's doing too much.

### Pitfall 2: Script Functions With Mixed Signatures
**What goes wrong:** Some scripts use `options={}` (payment-uuid-repair, portal-payments-generator, upload-authorized-pos, test-order-lifecycle) while others use positional args (PO scripts, get-payment-cfdis, payment-reconciliation internals).
**Why it happens:** Phase 6 converted the "hard" scripts (5 that needed full refactor) to options pattern but left simpler scripts with their original signatures.
**How to avoid:** In route handlers for positional-arg scripts, map request params to positional args inline. This is acceptable for thin handlers. Do NOT refactor script signatures in this phase -- that risks regressions.
**Warning signs:** Inconsistent parameter passing across route files.

### Pitfall 3: express-rate-limit v8 CommonJS Breaking Change
**What goes wrong:** Installing `express-rate-limit@8.x` may break CommonJS `require()` imports. The maintainers discussed dropping CommonJS in v8.
**Why it happens:** ESM migration trend in Node.js ecosystem.
**How to avoid:** Pin to `^7.5.0` in package.json. Use named export: `const { rateLimit } = require('express-rate-limit')`.
**Warning signs:** `ERR_REQUIRE_ESM` errors on startup.

### Pitfall 4: Helmet CSP Blocking Inline Scripts
**What goes wrong:** The default Content-Security-Policy blocks inline `<script>` tags in the existing HTML dashboard (public/index.html).
**Why it happens:** helmet() enables CSP by default which restricts script sources.
**How to avoid:** Disable or customize CSP for the HTML-serving routes. Since this is an internal tool: `helmet({ contentSecurityPolicy: false })` is acceptable, or configure CSP directives to allow 'self' and 'unsafe-inline'.
**Warning signs:** Dashboard page loads but JavaScript doesn't execute; browser console shows CSP violations.

### Pitfall 5: API_KEY Collision With Portal API_KEY
**What goes wrong:** The `.env` file already has `API_KEY` as a comma-separated list of Portal de Proveedores tenant API keys. Adding a new `API_KEY` for the REST API would collide.
**Why it happens:** config.js uses `API_KEY` for portal tenant keys in `parseTenants()`.
**How to avoid:** Use a distinct name like `SAGECONNECT_API_KEY` or `REST_API_KEY` for the internal API key. Add it to config.js under a new `security` section.
**Warning signs:** The API key check always fails because `config.portal.tenants[0].key` is a portal key, not the REST API key.

### Pitfall 6: Missing Error Handler for Async Route Exceptions
**What goes wrong:** If a script function throws an unhandled exception (not caught by try/catch in the handler), Express returns an HTML error page instead of JSON.
**Why it happens:** Express 4.x does not catch async errors by default. The existing routes use manual try/catch but it's easy to forget.
**How to avoid:** Add a global error handler middleware at the end of the middleware stack that catches errors and returns a JSON envelope. Also wrap async handlers with a utility: `const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)`.
**Warning signs:** 500 responses with HTML content-type instead of JSON.

### Pitfall 7: tenantIndex Out of Range
**What goes wrong:** A request with `tenantIndex=5` when only 2 tenants exist causes array index out of bounds, resulting in undefined values passed to portal API calls.
**Why it happens:** Scripts access `config.portal.tenants[tenantIndex]` without bounds checking.
**How to avoid:** Joi schema for tenantIndex should validate `Joi.number().integer().min(0).max(config.portal.tenants.length - 1).default(0)`. Catch this at the validation layer.
**Warning signs:** Axios calls fail with undefined tenant credentials.

## Code Examples

### Global Middleware Setup (server.js)
```javascript
// Source: helmet docs + cors docs + express-rate-limit docs
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');

// Security headers -- disable CSP for dashboard HTML or configure for 'self'
app.use(helmet({
    contentSecurityPolicy: false,  // Dashboard uses inline scripts
}));

// CORS -- internal network, reflect origin
app.use(cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
}));

// Global rate limit for all /api routes
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    limit: 200,                 // 200 requests per window per IP
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        success: false,
        data: null,
        errors: ['Too many requests, please try again later'],
        summary: 'Rate limited',
        meta: { duration: 0, timestamp: new Date().toISOString(), tenant: null },
    },
});
app.use('/api', apiLimiter);

// Stricter limit for write operations
const writeLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,   // 1 minute
    limit: 10,                   // 10 write ops per minute per IP
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        success: false,
        data: null,
        errors: ['Write rate limit exceeded'],
        summary: 'Rate limited',
        meta: { duration: 0, timestamp: new Date().toISOString(), tenant: null },
    },
});
// Applied per-route in payment-routes.js and po-routes.js on POST/PUT handlers
```

### Route Index File (routes.js refactored)
```javascript
// src/routes/routes.js -- becomes a mount index
const express = require('express');
const router = express.Router();
const { requireApiKey } = require('../middleware/api-key');

// Dashboard routes -- no API key required
router.use(require('./dashboard-routes'));

// API routes -- API key required
router.use('/api/payments', requireApiKey, require('./payment-routes'));
router.use('/api/pos', requireApiKey, require('./po-routes'));

// System routes (health check etc.)
router.use('/api/system', require('./system-routes'));

module.exports = router;
```

### Joi Schema Example (Payment Endpoints)
```javascript
// src/routes/schemas/payment-schemas.js
const Joi = require('joi');
const config = require('../../config');

const tenantMax = config.portal.tenants.length - 1;

const reconciliationSchema = Joi.object({
    tenantIndex: Joi.number().integer().min(0).max(tenantMax).default(0),
    fromDate: Joi.string().pattern(/^\d{8}$/).optional()
        .description('YYYYMMDD format'),
    pyFilter: Joi.string().pattern(/^PY\d+$/).optional(),
    batchLimit: Joi.number().integer().min(1).max(100).default(20),
    dryRun: Joi.boolean().default(true),
});

const uuidDiagnosticSchema = Joi.object({
    docNbr: Joi.alternatives().try(
        Joi.string().pattern(/^PY\d+$/),
        Joi.array().items(Joi.string().pattern(/^PY\d+$/))
    ).required(),
    tenantIndex: Joi.number().integer().min(0).max(tenantMax).default(0),
});

const generatePaymentsSchema = Joi.object({
    tenantIndex: Joi.number().integer().min(0).max(tenantMax).default(0),
    pyFilter: Joi.string().pattern(/^PY\d+$/).optional(),
    dateFilter: Joi.string().pattern(/^\d{8}$/).optional(),
    dryRun: Joi.boolean().default(true),
});

module.exports = {
    reconciliationSchema,
    uuidDiagnosticSchema,
    generatePaymentsSchema,
};
```

### Async Handler Wrapper
```javascript
// src/middleware/async-handler.js
// Catches async errors and forwards to Express error handler
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = { asyncHandler };
```

### Global JSON Error Handler
```javascript
// Added at end of middleware stack in server.js
app.use((err, req, res, _next) => {
    const { errorResult } = require('./utils/ResultEnvelope');
    console.error('[API ERROR]', err.message);
    res.status(500).json(
        errorResult([err.message], 'Internal server error')
    );
});
```

### config.js Addition for API_KEY
```javascript
// Add to REQUIRED validation (new section):
// Note: Use SAGECONNECT_API_KEY to avoid collision with portal API_KEY
const REQUIRED = {
    // ... existing sections ...
    security: ['SAGECONNECT_API_KEY'],
};

// Add to config object:
const config = {
    // ... existing sections ...
    security: {
        apiKey: process.env.SAGECONNECT_API_KEY,
    },
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `const rateLimit = require('express-rate-limit')` | `const { rateLimit } = require('express-rate-limit')` | express-rate-limit v7 (2023) | Named export required; default export deprecated |
| `max` option in rate-limit | `limit` option | express-rate-limit v7 | `max` still works but `limit` is canonical |
| Manual X-RateLimit-* headers | `standardHeaders: 'draft-7'` | express-rate-limit v7 | IETF standard rate limit headers |
| helmet v4 with many sub-packages | helmet v8 single package | helmet v5+ (2022) | Simplified API, all headers in one call |
| Joi `schema.validate()` throws | Returns `{ error, value }` | Joi v17 default | Use `abortEarly: false` for all validation errors at once |

**Deprecated/outdated:**
- `express-rate-limit` default export -- use named `{ rateLimit }` import
- `legacyHeaders: true` in rate-limit -- prefer `standardHeaders: 'draft-7'` and `legacyHeaders: false`
- helmet sub-packages (helmet-csp, etc.) -- all integrated into main helmet package since v5

## Open Questions

1. **payment-reconciliation API-friendly wrapper**
   - What we know: `main()` is the full orchestrator but not exported. `classifyPayments` and `uploadBatch` are exported but require pre-processed data.
   - What's unclear: Whether to create a new exported function wrapping `main()` logic, or to export `main()` directly with options parameter.
   - Recommendation: Create a new `runReconciliation(options={})` that encapsulates `main()` logic with proper options parameter and envelope return. This keeps the existing `main()` for CLI backward compatibility.

2. **SAGECONNECT_API_KEY vs alternative naming**
   - What we know: `API_KEY` is already used for portal tenant keys (comma-separated). A new key is needed for the REST API.
   - What's unclear: Whether the team has a naming convention preference.
   - Recommendation: Use `SAGECONNECT_API_KEY` in .env and `config.security.apiKey` in code. Clear, unambiguous, follows existing naming pattern.

3. **Rate limit thresholds for internal use**
   - What we know: 1-2 concurrent internal users. Operations can be long-running (30s+ for reconciliation).
   - What's unclear: Exact threshold that prevents accidental abuse without blocking legitimate use.
   - Recommendation: Global: 200 req/15min. Write endpoints: 10 req/min. These are generous for internal use but prevent accidental loops.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 with babel-jest transform |
| Config file | `jest.config.js` at project root |
| Quick run command | `npx jest --testPathPattern=<file> --no-coverage` |
| Full suite command | `npx jest` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PAY-01 | POST /api/payments/reconciliation returns envelope | integration | `npx jest tests/api/payment-routes.test.js -t "reconciliation" -x` | -- Wave 0 |
| PAY-02 | GET /api/payments/uuid-diagnostic returns envelope | integration | `npx jest tests/api/payment-routes.test.js -t "uuid-diagnostic" -x` | -- Wave 0 |
| PAY-03 | POST /api/payments/uuid-repair/scan returns envelope | integration | `npx jest tests/api/payment-routes.test.js -t "scan" -x` | -- Wave 0 |
| PAY-04 | POST /api/payments/uuid-repair/repair returns envelope | integration | `npx jest tests/api/payment-routes.test.js -t "repair" -x` | -- Wave 0 |
| PAY-05 | POST /api/payments/uuid-repair/upload returns envelope | integration | `npx jest tests/api/payment-routes.test.js -t "upload" -x` | -- Wave 0 |
| PAY-06 | POST /api/payments/generate returns envelope | integration | `npx jest tests/api/payment-routes.test.js -t "generate" -x` | -- Wave 0 |
| PAY-07 | GET /api/payments/cfdis returns envelope | integration | `npx jest tests/api/payment-routes.test.js -t "cfdis" -x` | -- Wave 0 |
| PO-01 | GET /api/pos/diagnostic returns envelope | integration | `npx jest tests/api/po-routes.test.js -t "diagnostic" -x` | -- Wave 0 |
| PO-02 | GET /api/pos/query returns envelope | integration | `npx jest tests/api/po-routes.test.js -t "query" -x` | -- Wave 0 |
| PO-03 | POST /api/pos/upload returns envelope | integration | `npx jest tests/api/po-routes.test.js -t "upload" -x` | -- Wave 0 |
| PO-04 | PUT /api/pos/update returns envelope | integration | `npx jest tests/api/po-routes.test.js -t "update" -x` | -- Wave 0 |
| PO-05 | GET /api/pos/address-diagnostic returns envelope | integration | `npx jest tests/api/po-routes.test.js -t "address" -x` | -- Wave 0 |
| PO-06 | GET /api/pos/payment-form-diagnostic returns envelope | integration | `npx jest tests/api/po-routes.test.js -t "payment-form" -x` | -- Wave 0 |
| PO-07 | POST /api/pos/upload-authorized returns envelope | integration | `npx jest tests/api/po-routes.test.js -t "upload-authorized" -x` | -- Wave 0 |
| PO-08 | POST /api/pos/lifecycle returns envelope | integration | `npx jest tests/api/po-routes.test.js -t "lifecycle" -x` | -- Wave 0 |
| SEC-01 | All responses include security headers | unit | `npx jest tests/api/security.test.js -t "helmet" -x` | -- Wave 0 |
| SEC-02 | CORS headers present on responses | unit | `npx jest tests/api/security.test.js -t "cors" -x` | -- Wave 0 |
| SEC-03 | Write endpoints enforce rate limits | unit | `npx jest tests/api/security.test.js -t "rate-limit" -x` | -- Wave 0 |
| SEC-04 | API key required on /api/payments and /api/pos | unit | `npx jest tests/api/security.test.js -t "api-key" -x` | -- Wave 0 |

### Testing Strategy
- **Route tests** use `supertest` to test the Express app directly (no real HTTP server). Mock all script functions to return canned envelopes.
- **Security tests** verify middleware behavior: headers present, 401 on missing key, 429 on rate limit.
- **Validation tests** verify Joi schemas reject invalid input and return 400 with error details.

### Sampling Rate
- **Per task commit:** `npx jest tests/api/ --no-coverage`
- **Per wave merge:** `npx jest`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/api/payment-routes.test.js` -- covers PAY-01..PAY-07
- [ ] `tests/api/po-routes.test.js` -- covers PO-01..PO-08
- [ ] `tests/api/security.test.js` -- covers SEC-01..SEC-04
- [ ] `tests/api/validation.test.js` -- covers Joi schema validation (400 responses)
- [ ] Install `supertest` as devDependency: `npm install --save-dev supertest`
- [ ] Create `tests/api/` directory

## Sources

### Primary (HIGH confidence)
- [helmet GitHub](https://github.com/helmetjs/helmet) -- default headers, configuration, CommonJS usage
- [helmet official docs](https://helmetjs.github.io/) -- 13 default headers documented
- [Express CORS middleware docs](https://expressjs.com/en/resources/middleware/cors.html) -- full configuration options, origin/methods/allowedHeaders
- [express-rate-limit official docs](https://express-rate-limit.mintlify.app/reference/configuration) -- windowMs, limit, standardHeaders, legacyHeaders, handler, skip, keyGenerator
- [express-rate-limit GitHub](https://github.com/express-rate-limit/express-rate-limit) -- CommonJS named export pattern, v7 migration
- Existing codebase: `src/routes/routes.js`, `src/server.js`, `src/config.js`, `src/utils/ResultEnvelope.js`, all 13 scripts in `src/scripts/`

### Secondary (MEDIUM confidence)
- [Express security best practices](https://expressjs.com/en/advanced/best-practice-security.html) -- middleware ordering recommendations
- [express-rate-limit npm](https://www.npmjs.com/package/express-rate-limit) -- v7.5.0 latest stable, 15.6M weekly downloads
- [cors npm](https://www.npmjs.com/package/cors) -- v2.8.6 latest, CommonJS support confirmed

### Tertiary (LOW confidence)
- Rate limit thresholds (200 global / 10 write per minute) -- based on general best practices for internal tools, not verified against specific load patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all three packages verified via official docs and GitHub; versions confirmed via npm
- Architecture: HIGH -- patterns derived from actual codebase analysis (route files, server.js, config.js, script exports)
- Pitfalls: HIGH -- identified through code inspection (API_KEY collision verified in config.js, payment-reconciliation main() not exported verified, CSP issue well-documented)
- Validation schemas: MEDIUM -- Joi patterns are well-established but specific field formats (PO numbers, date formats) inferred from script code

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (stable ecosystem, no expected breaking changes)
