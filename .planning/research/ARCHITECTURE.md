# Architecture Patterns: License Validation Integration

**Domain:** License validation for always-on Node.js service (SageConnect v2.1)
**Researched:** 2026-03-25
**Confidence:** HIGH -- based on direct source code analysis of both SageConnect and sageconnect-license repos

## Executive Summary

License validation integrates as a cross-cutting concern across four layers of SageConnect: startup (index.js), periodic checks (CronScheduler), request blocking (middleware), and UI feedback (shared.js). The license server API contract is already finalized -- `GET /api/validate?key=<key>` returns `{ active, ts, sig, expiresAt? }` with HMAC-signed responses. The integration requires one new service module (`LicenseValidator`), one new middleware (`require-license`), modifications to four existing files, and two new env vars.

## License Server API Contract (Verified from Source)

The sageconnect-license server at `https://sageconnect-license.vercel.app` exposes:

```
GET /api/validate?key=sc_live_<hex>

Success response (200):
{ "active": true, "expiresAt": "2099-12-31T00:00:00.000Z", "ts": 1711324800000, "sig": "<hmac-hex>" }

Failure response (200 -- always 200, never 4xx):
{ "active": false, "ts": 1711324800000, "sig": "<hmac-hex>" }
```

Key details:
- Failure responses intentionally lack `expiresAt` field (uniform failure shape)
- `sig` is `HMAC-SHA256(JSON.stringify(payload_without_sig), HMAC_SECRET)`
- `ts` is server-side `Date.now()` -- can be used for clock drift detection
- Key prefix must be `sc_live_` or server short-circuits to fail
- Server always returns 200 (no HTTP error codes for invalid keys)

## Recommended Architecture

### New Components

```
src/
  services/
    LicenseValidator.js    <-- NEW: core validation + HMAC + caching
  middleware/
    require-license.js     <-- NEW: Express middleware that blocks when invalid
```

### Modified Components

```
src/
  index.js                 <-- MODIFY: add startup validation (fail-fast)
  config.js                <-- MODIFY: add license section (LICENSE_API_URL, HMAC_SECRET)
  services/CronScheduler.js <-- MODIFY: add pre-cycle license check
public/
  js/shared.js             <-- MODIFY: add license banner injection
src/
  routes/routes.js         <-- MODIFY: mount requireLicense middleware
  routes/system-routes.js  <-- MODIFY: add GET /license endpoint
```

### Unchanged Components

```
src/
  services/OperationManager.js  <-- NO CHANGES (locks/events unrelated to license)
  middleware/api-key.js          <-- NO CHANGES (orthogonal: authN vs license)
  routes/dashboard-routes.js     <-- NO CHANGES (read-only log viewing stays unlicensed)
  background.js                  <-- NO CHANGES (called by CronScheduler, guard is upstream)
```

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `LicenseValidator` | HTTP call to license server, HMAC verification, result caching, in-memory state | config.js (reads LICENSE_API_URL, HMAC_SECRET, SAGECONNECT_API_KEY) |
| `require-license` middleware | Blocks API requests when license invalid, returns 403 | LicenseValidator (reads cached state) |
| `index.js` (startup) | Fail-fast on boot if license invalid | LicenseValidator (one-time call) |
| `CronScheduler` (periodic) | Re-validates before each cron cycle | LicenseValidator (re-check call) |
| `shared.js` (UI) | Renders degraded banner when license invalid | New `/api/system/license` endpoint |
| `routes.js` (routing) | Applies license middleware to protected routes | require-license middleware |

## Data Flow

### Startup Flow (index.js)

```
index.js
  |
  +--> LicenseValidator.validate()
  |      |
  |      +--> GET LICENSE_API_URL/api/validate?key=SAGECONNECT_API_KEY
  |      +--> Verify HMAC signature
  |      +--> Cache result in-memory
  |      +--> Return { valid, expiresAt }
  |
  +--> If NOT valid: console.error + process.exit(1)  [fail-fast, matches config.js pattern]
  +--> If valid: startServer(3030) + initScheduler()  [existing flow]
```

**Rationale:** Fail-fast at startup is an established pattern in this codebase (config.js validates env vars then calls `process.exit(1)` on failure). License validation follows the same convention: if there is no valid license, the service must not start.

### Periodic Re-validation Flow (CronScheduler)

```
CronScheduler cron callback fires
  |
  +--> operationManager.acquireLock('background-cycle', operationId)
  |      (existing -- no change)
  |
  +--> LicenseValidator.validate()    <-- NEW: added before forResponse()
  |      |
  |      +--> GET LICENSE_API_URL/api/validate?key=SAGECONNECT_API_KEY
  |      +--> Verify HMAC, update cached state
  |      |
  |      +--> If NOT valid:
  |      |      log warning
  |      |      skip forResponse() + startChildProcess()
  |      |      record in history as "skipped: license invalid"
  |      |      releaseLock
  |      |      return
  |      |
  |      +--> If valid: continue existing flow
  |
  +--> forResponse({ operationId, emitter })   [existing]
  +--> startChildProcess()                      [existing]
```

**Rationale:** The CronScheduler already has a guard pattern (noOverlap + acquireLock). The license check inserts as a second guard, after the lock but before the actual work. This means:
1. The cron task still fires on schedule (keeps cron healthy).
2. Lock is still acquired (prevents manual trigger from bypassing the check).
3. Only the actual operations are skipped -- lock, logging, and history still function.

### API Request Blocking Flow (Middleware)

```
Incoming request
  |
  +--> express.Router()
  |      |
  |      +--> Dashboard routes (NO license check -- read-only logs)
  |      +--> System routes (NO license check -- /health for monitoring, /tenants for UI)
  |      |
  |      +--> requireLicense middleware   <-- NEW: applied BEFORE requireApiKey
  |      |      |
  |      |      +--> LicenseValidator.isValid()  (reads cached state, NO HTTP call)
  |      |      +--> If invalid: 403 { success: false, errors: ['License inactive'] }
  |      |      +--> If valid: next()
  |      |
  |      +--> Schedule routes (trigger endpoint has license + API key)
  |      +--> Operations routes (license-gated)
  |      +--> Payment routes (license + API key)
  |      +--> PO routes (license + API key)
```

**Key design decision:** The `requireLicense` middleware reads the **cached** license state from `LicenseValidator` -- it does NOT make an HTTP call per request. This means:
- Zero latency added to API requests
- No cascading failure if license server is temporarily down
- State is refreshed by startup + periodic cron re-validation

### Routes Protection Matrix

| Route Group | License Required | API Key Required | Rationale |
|-------------|:---:|:---:|-----------|
| `/health` | NO | NO | Load balancers and Servy health checks must always work |
| `/api/system/tenants` | NO | NO | UI needs tenant list to render even in degraded mode |
| `/api/system/license` (NEW) | NO | NO | UI polls this to show/hide license banner |
| `/api/dashboard`, `/api/logs/*` | NO | NO | Read-only log viewing -- useful even without license for troubleshooting |
| `/send-mail` | NO | NO | Legacy dashboard route, low risk |
| `/api/schedule` (GET) | YES | NO | Viewing schedule status is operational |
| `/api/schedule/history` (GET) | YES | NO | Viewing history is operational |
| `/api/schedule/:taskId/trigger` (POST) | YES | YES | Executing work requires license + auth |
| `/api/operations/*` | YES | NO | SSE streaming of active operations |
| `/api/payments/*` | YES | YES | Core business operations |
| `/api/pos/*` | YES | YES | Core business operations |

### UI Banner Flow (shared.js)

```
shared.js initPage(activePage)
  |
  +--> fetch('/api/system/tenants')     [existing]
  +--> fetch('/api/system/license')     <-- NEW: parallel with tenants
  |      |
  |      +--> Returns { active, expiresAt }
  |
  +--> renderSidebar(activePage)        [existing]
  +--> renderLicenseBanner(licenseData) <-- NEW: if !active, inject warning banner
```

The banner renders as a full-width warning bar above the page content:

```
+------------------------------------------------------------------+
| [!] Licencia inactiva -- Las operaciones estan bloqueadas.       |
+------------------------------------------------------------------+
| Sidebar | Page content (grayed out / disabled buttons)           |
```

**Implementation:** The banner is injected by `shared.js` into the top of `<body>`. This approach means:
- Every page gets the banner automatically (shared.js runs on all pages)
- No changes to individual HTML pages needed
- Banner is dismissed if a subsequent poll shows `active: true`

## New Component: LicenseValidator Service

### Interface

```javascript
// src/services/LicenseValidator.js

/**
 * Validates SAGECONNECT_API_KEY against the license server.
 * Caches result in-memory. HMAC-verifies response signature.
 *
 * @returns {Promise<{ valid: boolean, expiresAt: string|null, error: string|null }>}
 */
async function validate() { ... }

/**
 * Returns cached license validity. Synchronous, no HTTP call.
 * Used by middleware for zero-latency checks.
 *
 * @returns {boolean}
 */
function isValid() { ... }

/**
 * Returns full cached license state for the /api/system/license endpoint.
 *
 * @returns {{ active: boolean, expiresAt: string|null, lastChecked: string|null }}
 */
function getStatus() { ... }

module.exports = { validate, isValid, getStatus };
```

### Internal State

```javascript
let cachedState = {
    active: false,
    expiresAt: null,
    lastChecked: null,
    error: null,
};
```

### HMAC Verification

```javascript
const crypto = require('crypto');

function verifySignature(responseBody, hmacSecret) {
    const { sig, ...payload } = responseBody;
    const expected = crypto
        .createHmac('sha256', hmacSecret)
        .update(JSON.stringify(payload), 'utf-8')
        .digest('hex');

    // Constant-time comparison (matches api-key.js pattern)
    const expectedBuf = Buffer.from(expected, 'utf8');
    const sigBuf = Buffer.from(sig, 'utf8');
    if (expectedBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, sigBuf);
}
```

**Note:** The HMAC secret is shared between the license server (`HMAC_SECRET` env var on Vercel) and SageConnect client (`HMAC_SECRET` env var in .env). This prevents DNS hijacking/MITM attacks where someone could point the license URL to a fake server that always returns `{ active: true }`.

### Network Resilience

```
validate() behavior:
  - HTTP timeout: 10 seconds (license server is Vercel edge, should be < 1s)
  - On network error during startup: process.exit(1) -- fail-fast, same as missing env vars
  - On network error during periodic check: KEEP previous cached state
    - If last state was valid: continue operating (grace period)
    - If last state was invalid: remain blocked
  - Log all validation attempts (success and failure)
```

**Rationale for graceful degradation during periodic checks:** If the Vercel license server has a brief outage, SageConnect should not immediately stop processing. The startup check already confirmed a valid license. Periodic checks are a re-confirmation mechanism, not a primary gate. Losing connectivity to Vercel for 15 minutes should not stop a critical ERP integration.

## New Component: require-license Middleware

```javascript
// src/middleware/require-license.js

const { isValid } = require('../services/LicenseValidator');
const { errorResult } = require('../utils/ResultEnvelope');

function requireLicense(req, res, next) {
    if (!isValid()) {
        return res.status(403).json(
            errorResult(['License inactive or expired'], 'License required')
        );
    }
    next();
}

module.exports = { requireLicense };
```

**Design note:** This is intentionally simple -- it reads a boolean from LicenseValidator's cached state. The pattern mirrors `api-key.js` (same module shape, same ErrorResult usage, same early-return pattern). The 403 status code differentiates from 401 (API key) -- 403 = "you're authenticated but not authorized (no license)".

## Modified: config.js

New `license` section added to the config object:

```javascript
license: {
    apiUrl: process.env.LICENSE_API_URL || null,
    hmacSecret: process.env.HMAC_SECRET || null,
},
```

**Validation strategy:** These are NOT added to the `REQUIRED` object. Instead, LicenseValidator handles its own validation at startup:
- If `LICENSE_API_URL` is missing: process.exit(1) with clear error message
- If `HMAC_SECRET` is missing: process.exit(1) with clear error message
- This keeps the license concern self-contained rather than polluting the generic config validation

**New env vars for .env.example:**

```bash
# ====== LICENSE ======
# License validation server URL and HMAC secret for response verification
LICENSE_API_URL=https://sageconnect-license.vercel.app
HMAC_SECRET=your_shared_hmac_secret
```

## Modified: index.js

```javascript
// BEFORE (current):
const { startServer } = require('./server');
const { initScheduler } = require('./services/CronScheduler');

startServer(3030);
initScheduler();
console.log('[CRON] Scheduler initialized -- background cycle runs on schedule');

// AFTER (proposed):
const { startServer } = require('./server');
const { initScheduler } = require('./services/CronScheduler');
const { validate } = require('./services/LicenseValidator');

(async () => {
    // Validate license before starting anything
    const license = await validate();
    if (!license.valid) {
        console.error(`[LICENSE] Startup blocked -- ${license.error || 'license inactive'}`);
        process.exit(1);
    }
    console.log(`[LICENSE] Valid -- expires ${license.expiresAt}`);

    startServer(3030);
    initScheduler();
    console.log('[CRON] Scheduler initialized -- background cycle runs on schedule');
})();
```

**Note:** index.js becomes async (IIFE wrapper). This is a minimal change. The `config.js` require runs synchronously at import time (before the async IIFE) so fail-fast config validation still happens first, then license validation, then server start.

## Modified: CronScheduler.js

Inside the cron callback, after lock acquisition, before `forResponse()`:

```javascript
// Inside the async () => { ... } callback of cron.schedule()

const locked = operationManager.acquireLock('background-cycle', operationId);
if (!locked) { /* existing skip logic */ return; }

// NEW: License re-validation
const licenseValidator = require('./LicenseValidator');
const licenseResult = await licenseValidator.validate();
if (!licenseResult.valid) {
    logGenerator(LOG_FILE, 'warn', `[LICENSE] Cycle ${operationId} skipped -- license invalid`);
    operationManager.addHistory({
        taskId: 'background-cycle',
        operationId,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        success: false,
        errors: ['License inactive or expired'],
        summary: 'Skipped: license invalid',
    });
    operationManager.releaseLock('background-cycle');
    return;
}

// Existing: forResponse + startChildProcess
```

## Modified: routes.js

```javascript
// BEFORE:
const { requireApiKey } = require('../middleware/api-key');
router.use(require('./dashboard-routes'));
router.use('/api/system', require('./system-routes'));
router.use('/api/schedule', require('./schedule-routes'));
router.use('/api/operations', require('./operations-routes'));
router.use('/api/payments', requireApiKey, require('./payment-routes'));
router.use('/api/pos', requireApiKey, require('./po-routes'));

// AFTER:
const { requireApiKey } = require('../middleware/api-key');
const { requireLicense } = require('../middleware/require-license');

// Unlicensed routes -- always accessible
router.use(require('./dashboard-routes'));
router.use('/api/system', require('./system-routes'));

// Licensed routes -- blocked when license invalid
router.use('/api/schedule', requireLicense, require('./schedule-routes'));
router.use('/api/operations', requireLicense, require('./operations-routes'));
router.use('/api/payments', requireLicense, requireApiKey, require('./payment-routes'));
router.use('/api/pos', requireLicense, requireApiKey, require('./po-routes'));
```

**Middleware order:** `requireLicense` runs BEFORE `requireApiKey`. This means:
- Invalid license = 403 (no API key even checked)
- Valid license + missing API key = 401
- Valid license + valid API key = proceed
- This is the correct semantic ordering (authorization before authentication of specific resource)

## Modified: system-routes.js

New endpoint for UI license status:

```javascript
// GET /api/system/license
router.get('/license', (_req, res) => {
    const licenseValidator = require('../services/LicenseValidator');
    res.json(successResult(licenseValidator.getStatus(), 'License status'));
});
```

No API key, no license middleware -- this endpoint must be accessible for the UI to display the banner.

## Modified: shared.js

```javascript
// Inside initPage(activePage):
async function initPage(activePage) {
    // Existing: fetch tenants
    // NEW: fetch license status in parallel
    const [tenantRes, licenseRes] = await Promise.allSettled([
        fetch('/api/system/tenants', {
            headers: { 'Accept': 'application/json; charset=utf-8' }
        }).then(r => r.json()),
        fetch('/api/system/license', {
            headers: { 'Accept': 'application/json; charset=utf-8' }
        }).then(r => r.json()),
    ]);

    if (tenantRes.status === 'fulfilled' && tenantRes.value.success) {
        window.__TENANTS__ = tenantRes.value.data.tenants;
    }

    // License banner
    if (licenseRes.status === 'fulfilled' && licenseRes.value.success) {
        const license = licenseRes.value.data;
        if (!license.active) {
            renderLicenseBanner();
        }
    }

    renderSidebar(activePage);
}

function renderLicenseBanner() {
    const existing = document.getElementById('license-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'license-banner';
    banner.className = 'alert alert-danger text-center mb-0 rounded-0';
    banner.style.cssText = 'position: sticky; top: 0; z-index: 1050;';
    banner.innerHTML =
        '<i class="fas fa-exclamation-triangle me-2"></i>' +
        '<strong>Licencia inactiva</strong> -- Las operaciones estan bloqueadas. ' +
        'Contacte al administrador.';
    document.body.prepend(banner);
}
```

## Build Order (Dependency Chain)

The build order matters because components depend on each other:

```
Phase 1: config.js (add license section)
    |     No dependencies on new code. Other modules import config.
    v
Phase 2: LicenseValidator.js (new service)
    |     Depends on: config.js (license.apiUrl, license.hmacSecret, security.apiKey)
    |     Depends on: Node.js built-ins (crypto, https/fetch)
    v
Phase 3: require-license.js (new middleware)
    |     Depends on: LicenseValidator.isValid()
    v
Phase 4: index.js (startup validation)
    |     Depends on: LicenseValidator.validate()
    |     Depends on: server.js, CronScheduler.js (existing)
    v
Phase 5: CronScheduler.js (periodic check)
    |     Depends on: LicenseValidator.validate()
    v
Phase 6: routes.js (middleware wiring)
    |     Depends on: require-license.js
    v
Phase 7: system-routes.js (license status endpoint)
    |     Depends on: LicenseValidator.getStatus()
    v
Phase 8: shared.js (UI banner)
    |     Depends on: /api/system/license endpoint (Phase 7)
    v
Phase 9: .env.example + tests
```

**Testing can be interleaved at each phase.** The key constraint is that Phase 2 (LicenseValidator) must land before any consumer (Phases 3-8).

## Patterns to Follow

### Pattern 1: Singleton Module (matches OperationManager)
**What:** LicenseValidator exports functions from a module-level singleton (not a class)
**When:** The entire process needs one shared license state
**Example:** Same pattern as OperationManager -- `module.exports = new OperationManager()` exports a singleton instance. LicenseValidator uses module-level `let cachedState = { ... }` for the same effect.

### Pattern 2: Config Section (matches existing config.js structure)
**What:** License env vars are grouped under `config.license.*`
**When:** Adding any new configuration domain
**Example:** Follows `config.database.*`, `config.portal.*`, `config.security.*`, `config.schedule.*` convention.

### Pattern 3: Fail-Fast at Startup (matches config.js validate())
**What:** If license is invalid at boot, `process.exit(1)` with clear error
**When:** The service cannot function without a valid license
**Example:** Same pattern as missing `DB_USER` or `SERVER` -- clear error message, then exit.

### Pattern 4: ResultEnvelope for API Responses (matches all routes)
**What:** License-blocked responses use `errorResult()` from ResultEnvelope
**When:** Any API response, success or error
**Example:** `res.status(403).json(errorResult(['License inactive'], 'License required'))`.

### Pattern 5: Constant-Time Comparison (matches api-key.js)
**What:** HMAC signature verification uses `crypto.timingSafeEqual`
**When:** Comparing security-sensitive values
**Example:** Matches the existing api-key.js pattern with Buffer length check + timingSafeEqual.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Per-Request HTTP Validation
**What:** Calling the license server on every API request
**Why bad:** Adds 100-500ms latency to every request; cascading failure if license server is slow/down
**Instead:** Cache-based validation. HTTP calls only at startup + cron intervals.

### Anti-Pattern 2: Trusting HTTP Response Without HMAC
**What:** Only checking `response.active === true`
**Why bad:** Client sites could add a DNS entry pointing LICENSE_API_URL to a local server that always returns `{ active: true }`. The entire license system becomes trivially bypassable.
**Instead:** HMAC-verify every response. The shared secret is compiled into the obfuscated dist, making DNS bypass require the HMAC secret.

### Anti-Pattern 3: Blocking Health Checks
**What:** Applying license middleware to `/health` endpoint
**Why bad:** Servy (Windows Service manager) uses health checks to determine if the service is running. Blocking health checks would cause Servy to restart the service in a loop.
**Instead:** Health checks and monitoring endpoints are always accessible.

### Anti-Pattern 4: Hard-Failing on Periodic Check Network Errors
**What:** Setting license to invalid when a periodic re-check fails due to network timeout
**Why bad:** Temporary network issues (DNS resolution, Vercel cold start) would halt a critical ERP integration. The startup check already confirmed a valid license.
**Instead:** On network error during periodic check, keep the previously cached state. Log a warning. The next cron cycle will try again.

### Anti-Pattern 5: Mixing License and API Key Concerns
**What:** Combining license validation into the existing `api-key.js` middleware
**Why bad:** Violates single responsibility. API key = "who are you?" (authentication). License = "are you allowed to operate?" (authorization). They have different failure modes, different error codes (401 vs 403), and different bypass rules (some routes need license but not API key).
**Instead:** Separate middleware modules, applied independently.

## Scalability Considerations

| Concern | Current (1 deployment) | At 50 clients | At 200 clients |
|---------|------------------------|----------------|----------------|
| License server load | 1 request per startup + 1 per 15min cron = ~100/day | 5000/day | 20000/day |
| Vercel can handle this | Trivially | Yes (edge function, sub-100ms) | Yes (add caching layer if needed) |
| Clock drift | Not a concern | Not a concern | Could add ts-based freshness check |
| Secret rotation | Manual .env update | Needs deployment automation | Needs deployment automation |

## Sources

- SageConnect source: `src/index.js`, `src/server.js`, `src/config.js`, `src/services/CronScheduler.js`, `src/services/OperationManager.js`, `src/middleware/api-key.js`, `src/routes/routes.js`, `src/routes/system-routes.js`, `public/js/shared.js` -- **direct source analysis, HIGH confidence**
- License server source: `app/api/validate/route.ts`, `lib/crypto.ts`, `lib/db/schema.ts`, `app/api/validate/__tests__/route.test.ts` -- **direct source analysis, HIGH confidence**
- License server API contract: verified through route implementation + comprehensive test suite (12 test cases covering all edge cases) -- **HIGH confidence**
