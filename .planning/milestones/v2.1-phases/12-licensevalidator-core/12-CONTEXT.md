# Phase 12: LicenseValidator Core - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Create the LicenseValidator singleton service: HTTP call to license API, HMAC verification, timestamp freshness, retry with backoff, three-state cache (VALID/INVALID/ERROR), startup fail-fast, periodic re-validation support. Also add LICENSE_ADMIN_EMAIL env var for failure notifications. No enforcement wiring (Phase 13) or UI (Phase 14) — just the core service.

</domain>

<decisions>
## Implementation Decisions

### HMAC verification
- Verify response signature using crypto.createHmac('sha256', HMAC_SECRET)
- Payload: JSON.stringify of response body WITHOUT the sig field, matching server's signing order
- Use crypto.timingSafeEqual for signature comparison (existing pattern from api-key.js)
- Reject invalid/missing signatures — treat as INVALID

### Timestamp freshness
- Reject responses with `ts` older than 5 minutes (300,000 ms)
- Prevents replay attacks where a valid response is captured and replayed indefinitely
- Use server's `ts` field compared to local Date.now()

### Startup behavior
- 3 retries with exponential backoff (1s, 2s, 4s) — handles Vercel cold starts
- After 3 failures: log to winston + console.error + send email to LICENSE_ADMIN_EMAIL + process.exit(1)
- Servy will restart the service, retrying the cycle
- New env var: `LICENSE_ADMIN_EMAIL` (required) — separate from existing MAILING_NOTICES

### Periodic re-validation
- Called each cron cycle by CronScheduler (wiring in Phase 13)
- Updates cached state: VALID, INVALID, or ERROR
- On state change to INVALID: send email to LICENSE_ADMIN_EMAIL

### Three-state model
- **VALID**: License confirmed active. Operate normally.
- **INVALID**: License explicitly revoked/expired by server. Block everything.
- **ERROR**: License server unreachable. Use cached VALID state for up to 24 hours. After 24h of consecutive ERROR → switch to INVALID.
- Network errors (Vercel down) never immediately block a paying client
- Revocations (server returns active:false) block immediately

### Admin email notifications
- New env var: `LICENSE_ADMIN_EMAIL` (required in config.js)
- Send email on: startup failure (all retries exhausted), periodic re-check detects revocation
- Use existing EmailSender utility
- Different recipient than MAILING_NOTICES — this is for Tersoft admin, not client operations

### Claude's Discretion
- Singleton pattern details (module-level instance like OperationManager)
- Exact retry timing (1s/2s/4s backoff is a suggestion, not a requirement)
- Internal state storage structure
- Method naming (validate, getState, etc.)
- Whether LICENSE_ADMIN_EMAIL goes in the license config section or a new section

</decisions>

<specifics>
## Specific Ideas

- The service should expose a clean API: `validate()` (async, does HTTP call), `getState()` (sync, returns cached state), `isValid()` (sync boolean shortcut)
- The 24-hour ERROR→INVALID timeout should track `lastSuccessfulCheck` timestamp, not count consecutive failures
- Email should include: which deployment (company name from config?), what failed (startup/revocation), timestamp

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config.js`: config.license.apiUrl, config.license.hmacSecret (Phase 11)
- `src/utils/EmailSender.js`: sendMail() for notifications
- `src/middleware/api-key.js`: crypto.timingSafeEqual pattern already in use
- `src/services/OperationManager.js`: singleton service pattern to follow
- axios 1.7.7: already installed, used across the codebase

### Established Patterns
- CommonJS singleton services in `src/services/`
- Winston logging via logGenerator()
- Config access via `require('../config')`

### Integration Points
- Phase 13: CronScheduler will call validate() each cycle
- Phase 13: Express middleware will call getState()/isValid()
- Phase 13: index.js will call validate() on startup
- Phase 14: UI will consume GET /api/system/license

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-licensevalidator-core*
*Context gathered: 2026-03-25*
