# Phase 7: REST API + Security - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Expose all 15 payment and PO script functions as secured REST endpoints with Joi validation, security middleware (helmet, cors, rate-limit), and API key authentication. No scheduling, SSE, or web UI in this phase — just the HTTP API layer on top of the Phase 6 infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Route organization
- Split routes by domain: `payment-routes.js`, `po-routes.js`, `system-routes.js`
- Move existing 7 dashboard routes from `routes.js` to `dashboard-routes.js` — all route files follow the same pattern
- `routes.js` becomes an index that mounts all route files
- Security middleware (helmet, cors, rate-limit) applied globally in `server.js`
- API key middleware applied per-route-group (all /api/payments and /api/pos endpoints)

### API key setup
- Single `API_KEY` stored in `.env`, loaded via `config.js`
- All /api/payments and /api/pos endpoints require the API key (both GET and POST/PUT)
- API key passed via `x-api-key` header
- Dashboard routes (/api/dashboard, /api/logs, etc.) remain unauthenticated — internal monitoring
- Single key for all operations — 1-2 internal users, no need for per-domain separation

### Error-to-HTTP mapping
- Mapped status codes: 200 (success), 400 (validation errors), 404 (not found), 500 (internal errors), 401 (missing/invalid API key), 429 (rate limited)
- Envelope passes through directly as HTTP response body: `res.status(code).json(result)` — zero transformation
- Route handler determines HTTP status from envelope content (success → 200, errors with validation → 400, etc.)

### Endpoint behavior
- Destructive endpoints (upload, repair, update) default to dry-run mode — require explicit `?dryRun=false` to execute
- `tenantIndex` defaults to 0 but accepts any valid index — multi-tenant on PdP side
- Single API key for the internal API regardless of tenant
- Endpoints block until script finishes and return full result — synchronous, suitable for 1-2 concurrent users
- SSE for long-running operations deferred to Phase 8

### Request validation
- Joi schemas for all endpoint parameters (tenantIndex range, PO numbers format, date formats, etc.)
- Invalid inputs return 400 with Joi validation details in the envelope `errors` field

### Claude's Discretion
- Specific Joi schemas per endpoint (field requirements, formats, ranges)
- Rate limit thresholds (requests per window)
- CORS allowed origins configuration
- HTTP status code mapping logic implementation details

</decisions>

<specifics>
## Specific Ideas

- The company uses one set of internal API credentials (single API_KEY) but connects to multiple Portal de Proveedores tenants. The tenantIndex parameter selects which PdP tenant to operate on.
- Phase 6 established that every exported function accepts `options={}` and returns `{ success, data, errors, summary, meta }` — the route handler just calls the function and passes the envelope to `res.json()`.
- Dry-run default is a safety net: even with API key auth, accidental uploads to portal should be prevented by default.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/utils/ResultEnvelope.js`: `createResult`/`successResult`/`errorResult` — scripts already return this shape
- `src/models/PurchaseOrder.js`: Joi schemas for PO validation — extend pattern for request validation
- `src/routes/routes.js`: 7 existing dashboard routes with `{ success, data }` response pattern
- `src/config.js`: Centralized config loader — add API_KEY to validation

### Established Patterns
- Express Router with CommonJS: `const router = express.Router()` + `module.exports = router`
- Async route handlers with try/catch wrapping
- `res.setHeader('Content-Type', 'application/json; charset=utf-8')` on all API responses
- Error responses already use `{ success: false, error: message }` shape

### Integration Points
- `src/server.js`: Mount new route files, apply global middleware
- All 13 scripts + PortalOC_StatusUpdater: Import exported functions, call with options from request body/query
- `.env` + `config.js`: Add API_KEY variable, validate on startup

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-rest-api-security*
*Context gathered: 2026-03-23*
