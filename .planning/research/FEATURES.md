# Feature Landscape

**Domain:** License validation client (kill switch) for on-premise Node.js service
**Researched:** 2026-03-25
**Milestone:** v2.1 License Validation
**Existing server:** `GET /api/validate?key=X` returns HMAC-signed `{ active, expiresAt, ts, sig }`

## Table Stakes

Features the license validation MUST have. Without these, the kill switch is bypassable or unreliable.

| Feature | Why Expected | Complexity | Dependencies on SageConnect | Notes |
|---------|--------------|------------|----------------------------|-------|
| **Startup validation (fail-fast)** | Service must not operate without a valid license. First line of defense. If startup proceeds without validation, a client who never restarts could run forever on a revoked key. | Low | `config.js` (new `license` section), `index.js` (async init before `startServer` + `initScheduler`) | Call `GET LICENSE_API_URL?key=SAGECONNECT_API_KEY` before starting server/cron. On failure: `process.exit(1)` with clear error log. Matches existing fail-fast pattern in `config.js` validate(). |
| **HMAC signature verification** | Without HMAC verification, a client (or their IT) could DNS-hijack `sageconnect-license.vercel.app` to a local mock server returning `{ active: true }` permanently. This is the entire security model for preventing bypass. | Low | Node.js `crypto` module (already used in `src/middleware/api-key.js`), shared `HMAC_SECRET` env var | Recompute HMAC-SHA256 over the payload fields (excluding `sig`) and compare with `sig` using `crypto.timingSafeEqual`. Must match server's `signResponse()`: `JSON.stringify({ active, expiresAt, ts })` for active, `JSON.stringify({ active, ts })` for inactive. Key ordering must be identical. |
| **Periodic re-validation** | License can be revoked after startup via the admin dashboard toggle. Without periodic checks, a revoked client runs until its next Windows Service restart -- which could be weeks or months. | Low | `CronScheduler.js` (hook into cron cycle callback), new `LicenseGuard` service | Check license at the start of each cron cycle (every 15 min by default). If invalid, skip `forResponse()` + `startChildProcess()`. Log clearly via `LogGenerator`. |
| **Operation blocking (cron + API)** | If license is invalid, ALL operations must stop -- not just cron. Manual triggers via `POST /api/schedule/:taskId/trigger` and data endpoints (`/api/payments/*`, `/api/pos/*`) must also refuse. Otherwise a user could manually trigger operations from the UI even after revocation. | Medium | `routes.js` (new middleware mount), `CronScheduler.js`, `schedule-routes.js` | Two enforcement points: (1) guard in `CronScheduler.js` cron callback before `forResponse()`, (2) Express middleware on `/api/payments`, `/api/pos`, `/api/schedule` routes returning 403 with `{ active: false }`. System routes (`/api/system/health`, `/api/system/tenants`) and static file serving must remain accessible. |
| **Web UI "Licencia inactiva" banner** | Operators on the client's server need a clear visual indicator that the service is blocked and why. Without it, they see confusing empty states, silently failing triggers, or assume the system is broken rather than license-revoked. | Low | `shared.js` (initPage flow), new `GET /api/system/license` endpoint | Global non-dismissible banner on all pages, injected via `shared.js` during `initPage()`. Red bar at top: "Licencia inactiva -- contacte a Tersoft". Hides/disables operational controls (trigger button, upload buttons) since they will return 403 anyway. |
| **New env vars: LICENSE_API_URL, HMAC_SECRET** | License server URL and HMAC secret must be configurable per deployment. Different clients may use different license server instances in the future, and HMAC_SECRET is deployment-specific. | Low | `config.js` (new `license` section in REQUIRED and config object), `.env.example` | `LICENSE_API_URL` defaults to `https://sageconnect-license.vercel.app/api/validate`. `HMAC_SECRET` must be required in fail-fast validation (no license validation possible without it). Map to `config.license.apiUrl` and `config.license.hmacSecret`. |
| **Structured logging for license events** | Audit trail: when license was checked, result, any failures. Critical for debugging on client servers where Tersoft has limited access. | Low | `LogGenerator.js` (existing utility) | Use existing `logGenerator(logFileName, level, message)` pattern. Log file: `LicenseValidation`. Events: `[CHECK] Validating license...`, `[VALID] License active, expires YYYY-MM-DD`, `[INVALID] License inactive`, `[ERROR] Network error: ...`, `[HMAC-FAIL] Signature mismatch`. |

## Differentiators

Features not strictly required for the kill switch to work, but significantly improve reliability and operability in the real deployment environment (client Windows Servers, Vercel-hosted license server).

| Feature | Value Proposition | Complexity | Dependencies on SageConnect | Notes |
|---------|-------------------|------------|----------------------------|-------|
| **Retry with backoff on startup** | License server on Vercel has cold starts (can take 5-10s on free tier). First request after idle may timeout. Service shouldn't fail permanently on a transient cold start. | Low | None (pure logic in LicenseGuard) | 3 retries with exponential backoff: 2s, 4s, 8s. Only for network errors (`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, HTTP 5xx). A `200 { active: false }` is NOT retried -- that is deliberate revocation. Periodic checks don't need retry (next cycle in 15 min). |
| **Timestamp freshness check** | Prevents replay attacks where a cached valid response from a compromised proxy is served indefinitely. Also detects gross clock skew between client server and Vercel. | Low | None beyond HMAC verification logic | `Math.abs(Date.now() - response.ts) < 300_000` (5-minute window). If stale, treat as HMAC failure. Log `[STALE-RESPONSE]` with both timestamps for diagnostics. |
| **Grace period for network errors** | If Vercel has an outage (it happens), don't immediately kill a paying client's service that was validly licensed 15 minutes ago. Distinguish between "server says inactive" (immediate kill) and "can't reach server" (temporary grace). | Medium | In-memory state in `LicenseGuard` | Track consecutive network failures. Allow continued operation for N consecutive network-error cycles (3 cycles = ~45 min with default 15-min cron). On `{ active: false }` from server (deliberate revocation): immediate block, zero grace. On service restart: always require fresh validation (no grace on startup). |
| **License status in `/api/system/health`** | External monitoring (Servy process health checks, uptime monitors) can see license status without accessing the web UI. Enables automated alerting. | Low | `system-routes.js` existing `/health` endpoint | Add `license: { active: true/false, lastCheck: ISO, expiresAt: ISO }` to health response. Health endpoint must remain accessible even when license is invalid (monitoring must always work). |
| **License expiry countdown in sidebar** | Proactive renewal: operators see "Licencia expira en X dias" before it actually expires. Prevents surprise service stops when license lapses due to forgotten renewal. | Low | `GET /api/system/license` endpoint, `shared.js` sidebar renderer | Yellow badge in sidebar when <= 30 days remaining. Red badge when <= 7 days. Green when > 30 days. Uses `expiresAt` from cached validation response. Only shown when license is active. |
| **Obfuscation-safe implementation** | Production deploys use `javascript-obfuscator` in a separate repo. HMAC computation and JSON key ordering must survive obfuscation. | Low | Obfuscation build pipeline | Use explicit property construction: `JSON.stringify({ active: payload.active, expiresAt: payload.expiresAt, ts: payload.ts })` rather than rest/spread operators. HMAC_SECRET from env var (not hardcoded string). Must verify in obfuscated test build. |

## Anti-Features

Features to explicitly NOT build. These would add complexity without proportional value, or would undermine the kill switch's purpose.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Offline license caching (persistent to disk)** | Defeats the kill switch purpose entirely. If license state is cached to a file, a client can: (1) delete the file to force re-evaluation, (2) tamper with the cached value, or (3) run indefinitely if the file says "active". Writing license state to disk is the #1 mistake in kill switch implementations. | In-memory state only. Service restart always requires fresh online validation. Grace period only for network errors during operation, never persisted. |
| **Client-side JWT/token decryption** | The license server already handles all authorization logic (key lookup, active check, expiry check). Adding JWT verification on the client means managing signing keys, token refresh, and token storage -- all for no additional security since HMAC already proves authenticity. | Keep the simple `GET + HMAC` model. Server owns authorization. Client only verifies signature authenticity. |
| **License feature flags / tiers** | All SageConnect deployments run the same feature set. There is no "basic" vs "premium" tier. Building tier infrastructure now is pure speculation. | Single `active: true/false` model. If tiers are needed later, the server response payload can be extended without changing the client validation flow. |
| **License management UI in SageConnect** | License management (activate, deactivate, rotate keys) belongs in the license server admin dashboard at `sageconnect-license.vercel.app/admin/dashboard`. Mixing the control plane (management) with the data plane (validation client) is a security antipattern -- a compromised client could re-activate itself. | SageConnect is read-only for license state. All management via the admin dashboard. |
| **Auto-rotation of SAGECONNECT_API_KEY** | Key rotation requires editing `.env` and restarting the service. This is a manual maintenance operation. Auto-rotation would need write access to `.env` on the Windows Server filesystem, which is dangerous and fragile. | Key rotation via admin dashboard (generates new key) + manual deployment (update `.env`, restart service). Documented in deployment guide. |
| **Email notification on license expiry** | Adds mailing dependency to the license code path. Mailing is optional in SageConnect (not all deployments configure it). The web UI banner handles client-side notification. Tersoft-side notification works via `lastSeenAt` going stale in the admin dashboard. | Client sees banner in web UI. Tersoft monitors `lastSeenAt` in admin dashboard -- if a client stops checking in, either their service is down or license was revoked. |
| **Encrypted communication beyond HTTPS** | The license server is on Vercel (HTTPS enforced). HMAC verification prevents response tampering. Adding encryption layers (e.g., encrypted payloads) is redundant when transport security (TLS) and payload authentication (HMAC) are already in place. | HTTPS (Vercel-enforced) + HMAC signature verification. This is sufficient for the threat model (prevent DNS hijack bypass). |

## Feature Dependencies

```
config.js license section (LICENSE_API_URL, HMAC_SECRET)
  |
  v
LicenseGuard service (core module)
  |-- startup validation (HMAC verify + retry + freshness check)
  |-- periodic check (called by CronScheduler)
  |-- in-memory state (active, expiresAt, lastCheck, consecutiveFailures)
  |
  +---> index.js integration
  |       Await LicenseGuard.validateOnStartup() BEFORE startServer() + initScheduler()
  |       On failure: process.exit(1)
  |
  +---> CronScheduler.js integration
  |       Call LicenseGuard.check() at start of cron callback
  |       If invalid: skip forResponse() + startChildProcess(), log, return
  |
  +---> license-gate middleware (Express)
  |       Reads LicenseGuard.isActive()
  |       Applied to: /api/payments/*, /api/pos/*, /api/schedule/*
  |       NOT applied to: /api/system/*, static files, HTML pages
  |       Returns 403 { success: false, errors: ["License inactive"] }
  |
  +---> GET /api/system/license endpoint
  |       Returns: { active, expiresAt, lastCheck }
  |       Always accessible (not gated)
  |
  +---> GET /api/system/health enhancement
  |       Add license.active, license.lastCheck, license.expiresAt to existing response
  |
  +---> shared.js UI integration
          initPage() calls GET /api/system/license
          If inactive: inject red banner, disable operational controls
          If active + expiring soon: show countdown badge in sidebar
```

**Key ordering constraint:** `config.js` must be updated first, then `LicenseGuard` built, then all integration points wired. The LicenseGuard is the single source of truth -- all other components read from it, none write to it.

## MVP Recommendation

Prioritize (in implementation order):

1. **config.js license section + env vars** -- Foundation; everything depends on it. Add `LICENSE_API_URL` and `HMAC_SECRET` to REQUIRED validation and config object.
2. **LicenseGuard service** -- Core business logic: HTTP call, HMAC verification, retry logic, in-memory state. Single module with clear API: `validateOnStartup()`, `check()`, `isActive()`, `getStatus()`.
3. **Startup fail-fast in index.js** -- Wire `await LicenseGuard.validateOnStartup()` before `startServer()` and `initScheduler()`. Immediate protection on deploy.
4. **Periodic re-validation in CronScheduler.js** -- Add license check at start of cron callback. Revocation takes effect within one cron cycle (~15 min).
5. **License gate middleware + route wiring** -- Block API operations when inactive. Mount in `routes.js` before payment/PO/schedule routes.
6. **GET /api/system/license endpoint** -- Expose license status for UI consumption.
7. **Web UI banner + control disabling** -- Modify `shared.js` `initPage()` to fetch license status and inject banner when inactive.

Defer to hardening pass:
- **Timestamp freshness check**: Simple to add inside LicenseGuard's HMAC verification. Low risk of omitting in MVP since HMAC alone prevents most bypass vectors.
- **License expiry countdown in sidebar**: Polish feature. The "Licencia inactiva" banner covers the critical blocked state. Countdown is proactive UX.
- **Grace period for network errors**: Start with a simple counter (3 consecutive failures). Can be refined later based on real-world Vercel reliability data.
- **Health endpoint enhancement**: Low effort but lower priority than the enforcement features.

## Sources

- SageConnect codebase: `src/config.js` (fail-fast validation pattern), `src/index.js` (startup sequence), `src/server.js` (Express app), `src/services/CronScheduler.js` (cron callback structure), `src/middleware/api-key.js` (HMAC/timingSafeEqual usage), `src/routes/routes.js` (middleware mounting), `public/js/shared.js` (initPage + sidebar renderer)
- License server: `app/api/validate/route.ts` (response shape and signing), `lib/crypto.ts` (HMAC-SHA256 `signResponse()` implementation -- `JSON.stringify(payload)` with explicit field ordering)
- [LicenseSpring: How to Implement Offline Software License Validation](https://licensespring.com/blog/guide/how-to-implement-offline-software-license-validation) -- Grace period and caching patterns
- [Statsig: Kill Switch in Software Safety](https://www.statsig.com/perspectives/killswitchsoftwareafety) -- Kill switch design principles
- [HMAC Verification in Node.js](https://gist.github.com/turret-io/76946bf8475848710f7d) -- HMAC verification patterns
- [Adobe: Connectivity Requirements and Offline Grace Period](https://helpx.adobe.com/document-cloud/kb/internet-connectivity-and-offline-grace-period---acrobat-dc.html) -- Industry grace period precedent (30-99 days for Adobe; our use case warrants ~45 min since the goal is a kill switch, not user convenience)
