# Phase 13: Enforcement - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire LicenseValidator into all enforcement points: Express middleware (503 on invalid), CronScheduler guard (skip cycle), license status endpoint, DNS bypass detection, and startup validation in index.js. No UI changes — just backend enforcement.

</domain>

<decisions>
## Implementation Decisions

### 503 response body
- `{ success: false, error: 'Licencia inactiva. Contacte a su proveedor.' }` with HTTP 503
- Applied to all payment/PO/schedule endpoints when license is INVALID
- Dashboard/system routes remain accessible (so the UI can show the inactive banner)

### License status endpoint
- GET /api/system/license — NO auth required (public)
- Returns: `{ state: 'VALID'|'INVALID'|'ERROR', expiresAt, lastChecked }`
- Mounted in system-routes.js alongside existing /health and /tenants
- Web UI fetches this without needing the API key

### Startup validation
- index.js calls LicenseValidator.validate({ startup: true }) before initScheduler()
- If invalid after retries: process.exit(1) (handled by LicenseValidator internally)
- If valid: proceed to start server + scheduler

### CronScheduler guard
- Before each cycle, check LicenseValidator.isValid()
- If false: skip cycle, log "Ciclo omitido: licencia inactiva"
- If true: proceed normally

### DNS bypass detection (ENF-04)
- Use dns.resolve4() to verify LICENSE_API_URL hostname resolves to expected Vercel IP ranges
- Run as part of validate() — warn in logs if DNS looks suspicious but don't block (defense-in-depth, not primary gate)
- HMAC verification is the real security boundary

### Claude's Discretion
- Exact middleware placement (before or after api-key middleware)
- DNS verification implementation details (which IP ranges to check)
- How to integrate startup validation into the existing index.js flow
- Whether license middleware is a separate file or added to existing middleware

</decisions>

<specifics>
## Specific Ideas

- The middleware should be a separate file: `src/middleware/require-license.js` — keeps it modular like api-key.js
- License middleware goes BEFORE api-key middleware in the chain — no point checking API key if license is invalid
- The license endpoint should also return the service's HMAC_SECRET existence (boolean, not the value) for diagnostic purposes

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/services/LicenseValidator.js`: isValid(), getStatus(), validate() (Phase 12)
- `src/middleware/api-key.js`: Pattern for Express middleware
- `src/routes/system-routes.js`: /health and /tenants endpoints — add /license here
- `src/routes/routes.js`: Route mounting index
- `src/services/CronScheduler.js`: initScheduler() with lock guard
- `src/index.js`: Simplified always-on entry (startServer + initScheduler)

### Integration Points
- `src/index.js`: Add validate({ startup: true }) before initScheduler()
- `src/routes/routes.js`: Apply require-license middleware before api-key on protected routes
- `src/services/CronScheduler.js`: Add isValid() check at start of cron callback
- `src/routes/system-routes.js`: Add GET /license endpoint

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-enforcement*
*Context gathered: 2026-03-25*
