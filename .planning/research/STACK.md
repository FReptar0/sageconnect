# Technology Stack

**Project:** SageConnect v2.1 License Validation
**Researched:** 2026-03-25

## Verdict: Zero New Dependencies Required

Every capability needed for license validation is already available in the existing codebase. Node.js `crypto` (built-in) handles HMAC verification and timing-safe comparison. `axios` (v1.7.7, already installed) handles HTTP calls to the license API. No new npm packages needed.

## Existing Stack Inventory (Relevant to License Validation)

| Technology | Version | Already Installed | Role in License Validation |
|------------|---------|-------------------|---------------------------|
| Node.js `crypto` | built-in (Node v24.12.0) | Yes (used in 3 files) | HMAC-SHA256 verification, `timingSafeEqual` |
| `axios` | 1.7.7 | Yes (used in 17 files) | HTTP client for license API calls |
| `node-cron` | 4.2.1 | Yes | Re-validation on each cron cycle |
| `joi` | 17.13.3 | Yes | Validate license API response shape |
| Express | 4.21.1 | Yes | Middleware for license-gated routes |
| `config.js` | custom | Yes | Centralized env var loading |

## Stack Additions (Config Only, No Dependencies)

### New Environment Variables

Add to `config.js` and `.env.example`:

| Variable | Required | Purpose | Example |
|----------|----------|---------|---------|
| `LICENSE_API_URL` | Yes | License server base URL | `https://sageconnect-license.vercel.app` |
| `HMAC_SECRET` | Yes | Shared secret for HMAC verification | 64-char hex string |

**Rationale:** `SAGECONNECT_API_KEY` already exists in `config.security`. `LICENSE_API_URL` and `HMAC_SECRET` are the only new env vars needed.

### Config Section Addition

```javascript
// In config.js, add to the config object:
license: {
    apiUrl: process.env.LICENSE_API_URL || '',
    hmacSecret: process.env.HMAC_SECRET || '',
},
```

Both `LICENSE_API_URL` and `HMAC_SECRET` must be added to the `REQUIRED` validation in `config.js` to maintain the fail-fast pattern. Add a `license` section to the `REQUIRED` object:

```javascript
const REQUIRED = {
    // ...existing sections...
    license: ['LICENSE_API_URL', 'HMAC_SECRET'],
};
```

## Detailed Technology Decisions

### 1. HMAC Verification: Node.js `crypto` (built-in)

**Confidence: HIGH** -- Verified working on this machine, already used in 3 codebase files.

The license server signs responses with `HMAC-SHA256(JSON.stringify(payload), HMAC_SECRET)`. The client-side verification is the mirror operation.

**Implementation pattern:**

```javascript
const crypto = require('crypto');

function verifyHmac(payload, receivedSig, secret) {
    const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload), 'utf-8')
        .digest('hex');

    if (expected.length !== receivedSig.length) return false;
    return crypto.timingSafeEqual(
        Buffer.from(expected, 'utf-8'),
        Buffer.from(receivedSig, 'utf-8')
    );
}
```

**Critical detail from license server source (`lib/crypto.ts`):** The server signs the payload object BEFORE appending the `sig` field. The response shape is:

```javascript
// Server builds payload, signs it, then spreads sig into response:
const payload = { active: true, expiresAt: '...', ts: 1234 };
return { ...payload, sig: signResponse(payload) };
```

The client MUST:
1. Extract `sig` from the response
2. Reconstruct the payload WITHOUT `sig`
3. `JSON.stringify()` the payload (key order matters -- use the same keys the server used)
4. Compare HMAC digests with `timingSafeEqual`

**Key order sensitivity:** `JSON.stringify({ active: true, expiresAt: '...', ts: 1234 })` produces a deterministic string because the server constructs the object in that exact key order. The client must destructure to match:

```javascript
const { sig, ...payload } = response.data;
// payload = { active, expiresAt?, ts } -- same key order as server
const valid = verifyHmac(payload, sig, config.license.hmacSecret);
```

**Response shapes (from `app/api/validate/route.ts`):**
- Active: `{ active: true, expiresAt: "ISO string", ts: number, sig: "hex" }`
- Inactive: `{ active: false, ts: number, sig: "hex" }`

**Existing codebase precedent:** `src/middleware/api-key.js` already uses `crypto.timingSafeEqual` with the Buffer pattern. Follow that exact approach.

### 2. HTTP Client: `axios` v1.7.7 (already installed)

**Confidence: HIGH** -- Version verified, 17 files already use it, `axios.create` and interceptors confirmed working locally.

Use `axios.create()` for a dedicated license client instance with specific timeout/retry config. This isolates license API settings from the portal API calls that use bare `axios`.

```javascript
const axios = require('axios');
const config = require('../config');

const licenseClient = axios.create({
    baseURL: config.license.apiUrl,
    timeout: 10000,
    headers: { 'Accept': 'application/json' },
});
```

**Why `axios.create` instead of bare `axios`:** The existing codebase uses bare `axios` calls for portal API interactions with no timeout config. The license client needs a specific timeout (10s) and retry behavior. A dedicated instance prevents config bleed between the two API targets.

**Why 10s timeout:** Vercel serverless functions on free tier have cold starts that can reach 5-7 seconds. The first validation on startup will very likely hit a cold start. 10s provides margin without blocking startup indefinitely. Subsequent calls to a warm function complete in <500ms.

### 3. Retry Pattern: axios Interceptor (no new dependency)

**Confidence: HIGH** -- `interceptors.response.use` API verified working on installed axios v1.7.7.

Use an axios response interceptor for retry logic rather than adding `axios-retry` or similar:

```javascript
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

licenseClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const cfg = error.config;
        cfg._retryCount = cfg._retryCount || 0;

        // Only retry on network errors or 5xx (not 4xx)
        const isRetryable = !error.response || error.response.status >= 500;

        if (isRetryable && cfg._retryCount < MAX_RETRIES) {
            cfg._retryCount += 1;
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * cfg._retryCount));
            return licenseClient.request(cfg);
        }
        return Promise.reject(error);
    }
);
```

**Why not `axios-retry`:** Quality gate says no new dependencies. The interceptor pattern is 15 lines and covers the exact semantics needed. The license API is a single GET endpoint.

**Retry semantics:**
- Network error (DNS failure, timeout, connection refused): Retry up to 2 times
- 5xx from Vercel (occasional 502/504 on cold start): Retry up to 2 times
- 4xx (invalid key, malformed request): Do NOT retry -- the key is wrong
- Linear backoff: 3s, 6s

### 4. Caching Pattern: In-Memory with TTL (no dependency)

**Confidence: HIGH** -- Simple variable with timestamp, no external dependency.

Cache the last valid license response in memory. Re-validate only on cron cycles and startup, not on every HTTP request.

```javascript
let cachedResult = null;   // { active, expiresAt, checkedAt }
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

function getCachedLicense() {
    if (!cachedResult) return null;
    if (Date.now() - cachedResult.checkedAt > CACHE_TTL_MS) return null;
    return cachedResult;
}

function setCachedLicense(result) {
    cachedResult = { ...result, checkedAt: Date.now() };
}
```

**Why not `node-cache` or `lru-cache`:** Single cached value with simple TTL. A Map/LRU is overkill for one entry.

**Why 20-minute TTL:** The cron runs every 15 minutes (default `CRON_SCHEDULE`). If a cron cycle is delayed or fails, the cache stays valid for 5 extra minutes before forcing a re-check. This prevents a brief cron delay from blocking all operations. The TTL is purely a safety net -- under normal operation, the cache is refreshed every cron cycle.

### 5. Response Validation: `joi` (already installed)

**Confidence: HIGH** -- Already used in `middleware/validate.js` for request validation.

Validate the license API response shape before trusting it:

```javascript
const Joi = require('joi');

const licenseResponseSchema = Joi.object({
    active: Joi.boolean().required(),
    expiresAt: Joi.string().isoDate().when('active', {
        is: true,
        then: Joi.required(),
        otherwise: Joi.forbidden(),
    }),
    ts: Joi.number().integer().required(),
    sig: Joi.string().hex().length(64).required(),
}).options({ allowUnknown: false });
```

**Why validate shape:** HMAC alone proves the response came from the real server. Schema validation catches API version mismatches or unexpected format changes. Belt and suspenders.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| HMAC | Node.js `crypto` | `tweetnacl`, `noble-hashes` | `crypto` is built-in, already used in codebase, same HMAC-SHA256 algorithm |
| HTTP client | `axios` (existing) | `node-fetch`, built-in `fetch` (Node 18+) | axios already used in 17 files, team knows it, consistency |
| Retry | axios interceptor | `axios-retry`, `p-retry` | No new dep needed for 15 lines of code |
| Cache | Plain variable + TTL | `node-cache`, `lru-cache` | Single cached value, Map/LRU is overkill |
| Response validation | `joi` (existing) | `zod`, manual `if` checks | joi already in codebase with same patterns |

## New File Structure

No new dependencies. Two new files to create:

```
src/
  services/
    LicenseValidator.js    # Core: validate, verify HMAC, cache, retry
  middleware/
    require-license.js     # Express middleware: block requests if license invalid
```

**`LicenseValidator.js`** is a singleton service (pattern matches OperationManager.js) that exports:
- `validateLicense()` -- async, calls license API, verifies HMAC, updates cache. Called at startup and each cron cycle.
- `isLicenseValid()` -- sync, reads cached result. Used by middleware and cron guard.
- `getLicenseStatus()` -- returns `{ active, expiresAt, checkedAt, error }` for web UI display.

**`require-license.js`** is Express middleware (pattern matches `api-key.js`) that:
- Calls `isLicenseValid()` (sync, reads cache -- no HTTP call per request)
- Returns 403 with `errorResult` envelope if invalid
- Skips check for health/status endpoints (so the UI can show the "inactive" banner)

## Installation

```bash
# No new packages to install.
# Verify existing dependencies are present:
node -e "require('axios'); require('crypto'); require('joi'); console.log('All deps available')"
```

## Environment Setup

Add to `.env`:
```bash
# ====== LICENSE ======
# License validation server URL
LICENSE_API_URL=https://sageconnect-license.vercel.app
# Shared HMAC secret for response signature verification (must match license server)
HMAC_SECRET=5ba563404b18c2d270f054b5f8e99e80470543610db17d51b5b2fa1de9fc8093
```

The `HMAC_SECRET` value MUST match the license server's `HMAC_SECRET` environment variable exactly.

## API Contract Reference

**Endpoint:** `GET {LICENSE_API_URL}/api/validate?key={SAGECONNECT_API_KEY}`

**Success response (active license):**
```json
{
  "active": true,
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "ts": 1711353600000,
  "sig": "a1b2c3...64-char-hex-hmac-sha256"
}
```

**Failure response (inactive/expired/invalid key):**
```json
{
  "active": false,
  "ts": 1711353600000,
  "sig": "d4e5f6...64-char-hex-hmac-sha256"
}
```

**Key format:** `sc_live_` prefix followed by 64 hex characters (72 chars total). This is the `SAGECONNECT_API_KEY` already in config.

**HMAC signing algorithm (from `sageconnect-license/lib/crypto.ts`):**
```
sig = HMAC-SHA256(JSON.stringify(payloadWithoutSig), HMAC_SECRET) -> hex digest
```

Where `payloadWithoutSig` is `{ active, ts }` or `{ active, expiresAt, ts }` (never includes `sig`).

## Sources

- Node.js `crypto`: verified locally on Node v24.12.0 -- `createHmac('sha256', ...)`, `timingSafeEqual` both confirmed working
- axios v1.7.7: verified in `package.json`, `axios.create()` and `interceptors.response.use` confirmed locally
- License server API contract: read from `sageconnect-license/app/api/validate/route.ts`
- HMAC signing implementation: read from `sageconnect-license/lib/crypto.ts`
- HMAC_SECRET value: read from `sageconnect-license/.env.local`
- API key format: read from `sageconnect-license/lib/validators.ts` (`/^sc_live_[0-9a-f]{64}$/`)
- Existing codebase patterns: `src/middleware/api-key.js` (timingSafeEqual), `src/services/OperationManager.js` (singleton), `src/utils/ResultEnvelope.js` (error responses)

---
*Stack research for: SageConnect v2.1 License Validation*
*Researched: 2026-03-25*
