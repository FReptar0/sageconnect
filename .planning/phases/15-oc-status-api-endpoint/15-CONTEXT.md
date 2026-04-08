# Phase 15: OC Status API Endpoint - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

REST endpoint (`PUT /api/pos/status`) to update a single OC's status in Portal de Proveedores. Wires existing `PortalOC_StatusUpdater.updatePOStatus()` behind Joi validation, rate limiting, and the established route handler pattern. UI form is Phase 16.

</domain>

<decisions>
## Implementation Decisions

### Input interface
- Field name: `poNumber` (consistent with all other PO endpoints), NOT `ocSage`
- Tenant identification: `tenantIndex` only (0, 1, 2...) — no optional `database` override
- Status field: `status` with Joi `.valid('OPEN', 'CLOSED', 'CANCELLED', 'GENERATED')`
- Schema reuses existing `poNumberField` and `tenantIndexField` from po-schemas.js

### Backend service
- Use `PortalOC_StatusUpdater.updatePOStatus(ocSage, status, idDatabase)` — returns ResultEnvelope
- Route handler resolves `databases[tenantIndex]` and passes all 3 arguments to updatePOStatus
- Do NOT use PortalOC_StatusService (different return format, would need response wrapping)

### Response detail
- Success: show OC number, new status, and apiStatus (HTTP status code from portal) — hide idFocaltec
- Error: summary message only — no internal IDs, no stack traces, no portal error details
- Use `sendResult(res, result)` as-is since updatePOStatus returns ResultEnvelope; the response filtering (hiding idFocaltec) happens at the UI level (Phase 16), not the API level

### Claude's Discretion
- Exact Joi error messages for validation failures
- Whether to add JSDoc to the new schema/route
- writeLimiter configuration (reuse existing instance or configure differently)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PortalOC_StatusUpdater.updatePOStatus()`: Complete implementation with validation, portal API call, FESA update, ResultEnvelope response
- `po-schemas.js` reusable fields: `poNumberField`, `tenantIndexField`, `databaseField`
- `validate` middleware, `asyncHandler`, `sendResult`, `writeLimiter` — all ready to use

### Established Patterns
- All PO routes: `validate(schema, source) → asyncHandler → sendResult(res, result)`
- Write endpoints (upload, update, lifecycle) use `writeLimiter`
- Inline require of scripts/controllers inside handler (lazy loading)
- `databases` array resolved from `config.portal.tenants.map(t => t.database)`

### Integration Points
- New route added to `po-routes.js` (endpoint i, after lifecycle)
- New schema added to `po-schemas.js` and exported
- New schema imported in `po-routes.js`
- Route mounted at `/api/pos/status` (behind existing `requireApiKey` in routes.js)

</code_context>

<specifics>
## Specific Ideas

- "Use what we already use to avoid errors" — follow established patterns exactly, no novel approaches
- poNumber→ocSage mapping is the handler's job, transparent to the API consumer

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 15-oc-status-api-endpoint*
*Context gathered: 2026-04-08*
