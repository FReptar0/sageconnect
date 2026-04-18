# Phase 11: License Config - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Add LICENSE_API_URL and HMAC_SECRET to config.js with fail-fast validation. Update .env.example. No service logic — just config infrastructure for Phase 12.

</domain>

<decisions>
## Implementation Decisions

### Config pattern
- Follow exact existing pattern in config.js: add to REQUIRED validation, add to config object
- `config.license.apiUrl` — LICENSE_API_URL (full URL, e.g., https://sageconnect-license.vercel.app)
- `config.license.hmacSecret` — HMAC_SECRET (shared secret, 64-char hex)
- Both required — process.exit(1) if missing (same as database, portal sections)
- Add new `license` section to config object between `security` and `schedule` sections

### .env.example
- Add LICENSE section with both variables documented
- Include example values (placeholder URL, instruction to generate secret)

### Claude's Discretion
- Exact placement in config.js REQUIRED object and config sections
- Whether to add Joi/format validation on the values (URL format, hex format) or just presence check

</decisions>

<specifics>
## Specific Ideas

- This phase is intentionally minimal — just the config plumbing. LicenseValidator service comes in Phase 12.
- The HMAC_SECRET must match the one in the license server's .env (HMAC_SECRET on Vercel).

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config.js`: Centralized config with REQUIRED validation and fail-fast. Exact pattern to follow.
- `.env.example`: Documented template for all env vars

### Established Patterns
- REQUIRED object groups vars by section: `database: ['DB_USER', ...]`, `portal: ['URL', ...]`
- Config object mirrors: `database: { user: process.env.DB_USER, ... }`
- Optional sections use conditional: `security: { apiKey: process.env.SAGECONNECT_API_KEY || null }`

### Integration Points
- `src/config.js`: Add license section
- `.env.example`: Document new vars
- Phase 12 LicenseValidator will `require('../config')` and read `config.license.*`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-license-config*
*Context gathered: 2026-03-25*
