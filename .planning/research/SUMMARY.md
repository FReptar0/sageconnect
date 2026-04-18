# Project Research Summary

**Project:** SageConnect v2.1 License Validation
**Domain:** License validation kill switch for on-premise Node.js ERP integration service
**Researched:** 2026-03-25
**Confidence:** HIGH

## Executive Summary

SageConnect v2.1 adds a license validation kill switch to an existing on-premise Node.js service running on client-controlled Windows Servers. The threat model is concrete and demanding: the client has admin rights, can edit the hosts file, inspect and modify files on disk, and is motivated to bypass the license. The research consensus is that the correct approach is a cryptographically signed, in-memory-cached validation system using HMAC-SHA256. The license server is already built and operational at `sageconnect-license.vercel.app` — its API contract is verified from source. The client-side implementation is straightforward in structure but sensitive in several correctness details.

The recommended architecture centers on a single new service module (`LicenseValidator.js`) that serves as the sole source of truth for license state. It makes HTTP requests to the license server, verifies each response's HMAC signature using a shared secret, and maintains an in-memory cache. Every other component — startup sequence, cron scheduler, Express middleware, and the web UI — reads from this module's cached state rather than making independent network calls. This eliminates per-request latency, prevents cascading failures from Vercel cold starts or brief outages, and ensures one enforcement point. Zero new npm dependencies are required: `crypto` (built-in), `axios` v1.7.7, and `joi` v17.13.3 are all already installed and used in the codebase.

The critical risks are correctness details, not architectural complexity. JSON key ordering in HMAC payloads must match the server exactly or every license check fails permanently. Timestamp freshness validation is mandatory alongside HMAC — without it, one captured response bypasses revocation forever. The three-state model (VALID / INVALID / ERROR) must be implemented to prevent Vercel infrastructure hiccups from falsely blocking paying clients. The startup integration requires converting `index.js` to an async IIFE to guarantee the server does not start before the license is confirmed. None of these are hard to implement — they are easy to omit if not explicitly flagged.

## Key Findings

### Recommended Stack

The entire implementation uses existing dependencies. No new npm packages are needed. Node.js `crypto` (built-in, already used in `src/middleware/api-key.js`) handles HMAC-SHA256 verification via `crypto.timingSafeEqual`. `axios` v1.7.7 (already used in 17 files) provides the HTTP client via `axios.create()` for a dedicated license client instance with isolated timeout and retry configuration. `joi` (used in `middleware/validate.js`) validates the API response shape before HMAC is checked. `node-cron` (already drives the integration cycle) enables periodic re-validation as a natural hook into the existing cron callback.

Two new environment variables are required: `LICENSE_API_URL` (the license server base URL) and `HMAC_SECRET` (the shared HMAC secret that must match the value on the Vercel-hosted license server exactly). These map to a new `config.license` section in `config.js`, following the existing `config.database`, `config.portal`, `config.security`, and `config.schedule` conventions.

**Core technologies:**
- `Node.js crypto` (built-in): HMAC-SHA256 verification and `timingSafeEqual` constant-time comparison — already used in the codebase, zero new risk
- `axios` v1.7.7 (existing): Dedicated `axios.create()` instance with 10s timeout and inline retry interceptor (2 retries, linear backoff) — 10s accommodates Vercel cold starts that can reach 7s; inline interceptor avoids adding `axios-retry` as a dependency
- `joi` v17.13.3 (existing): Response schema validation before HMAC check — detects API version mismatches before they cause silent HMAC failures
- `node-cron` v4.2.1 (existing): Periodic re-validation hook inside the existing cron callback — no new scheduling infrastructure needed

### Expected Features

The feature landscape divides into a 7-step MVP sequence and a subsequent hardening pass. The MVP provides a functional kill switch; the hardening pass closes replay and bypass attack vectors.

**Must have (table stakes):**
- Startup fail-fast validation — service must not start without a confirmed valid license; matches the existing `config.js` `process.exit(1)` pattern
- HMAC signature verification — the only defense that survives a hosts file redirect to a rogue local server; the entire system is trivially bypassable without it
- Periodic re-validation in cron — license revocation must take effect within one cron cycle (~15 min); without this, a revoked client runs until the next Windows Service restart, which could be weeks
- Operation blocking via Express middleware — both cron-triggered and manually triggered API operations must be blocked; a cron-only guard can be bypassed via `POST /api/schedule/:taskId/trigger`
- Web UI "Licencia inactiva" banner — operators need a clear visual reason the system is blocked, not a confusing empty state or silent 403 responses
- Structured logging for license events — required for remote debugging on client servers where Tersoft has limited access
- New env vars `LICENSE_API_URL` and `HMAC_SECRET` in `config.js` and `.env.example`

**Should have (differentiators):**
- Timestamp freshness check (5-minute window) — prevents replay attacks; should be treated as MVP since HMAC without freshness creates false security
- Retry with exponential backoff at startup — Vercel cold starts can reach 7s; three retries with 2s/4s/8s backoff prevent one transient timeout from blocking service startup permanently
- Grace period for network errors during cron (3 consecutive ERROR cycles / ~45 min) — distinguishes Vercel outage from deliberate revocation; paying clients keep running during brief infrastructure issues
- License expiry countdown in sidebar — proactive renewal UX; yellow badge at 30 days remaining, red at 7 days
- License status in `/api/system/health` — enables external monitoring tools and Servy health checks to detect license state without accessing the web UI

**Defer (v2+):**
- Asymmetric signatures (Ed25519 via `jose`) — eliminates the HMAC_SECRET extraction attack vector; the single most impactful future security upgrade; deferred because the layered HMAC + DNS bypass detection + cert pinning approach adequately covers the v2.1 threat model
- License management UI in SageConnect — management belongs in the admin dashboard, mixing control plane and data plane is a security antipattern
- Email notifications on expiry — adds mailing dependency; web UI banner and admin dashboard `lastSeenAt` monitoring cover this adequately
- Offline persistent license cache — explicitly an anti-feature; defeats the kill switch purpose entirely; anyone with filesystem access can tamper with plain JSON on disk

### Architecture Approach

The integration is a cross-cutting concern across four existing layers of SageConnect. Two new files are created (`src/services/LicenseValidator.js` and `src/middleware/require-license.js`) and six existing files are modified (`index.js`, `config.js`, `CronScheduler.js`, `routes.js`, `system-routes.js`, `public/js/shared.js`). `LicenseValidator.js` follows the singleton module pattern used by `OperationManager.js`. `require-license.js` follows the early-return middleware pattern of `api-key.js`. The license server API contract is fully verified from source and always returns HTTP 200 — never 4xx for invalid keys. The middleware reads only cached state on every request (zero HTTP latency per request); re-validation happens exclusively at startup and on each cron cycle.

**Major components:**
1. `LicenseValidator.js` (new service) — single source of truth; owns HTTP call, HMAC verification, timestamp freshness check, in-memory cache, and `validate()` / `isValid()` / `getStatus()` interface
2. `require-license.js` (new middleware) — reads `LicenseValidator.isValid()` synchronously (no HTTP call per request); returns 403 with `errorResult` envelope on invalid; applied before `requireApiKey` on operational routes only
3. `index.js` modification — async IIFE wrapper; `await validate()` blocks `startServer()` and `initScheduler()` until license is confirmed
4. `CronScheduler.js` modification — `await licenseValidator.validate()` inserted after lock acquisition, before `forResponse()` and `startChildProcess()`; records "skipped: license invalid" in history on block
5. `GET /api/system/license` endpoint (new, in system-routes.js) — exempt from license middleware; returns `{ active, expiresAt, lastChecked }` for UI consumption and external monitoring
6. `shared.js` modification — `initPage()` fetches `/api/system/license` in parallel with `/api/system/tenants`; injects sticky red banner when `active: false`; polls every 60 seconds for real-time updates

### Critical Pitfalls

1. **DNS/Hosts File Redirect** — Client points `sageconnect-license.vercel.app` to localhost and runs a rogue server returning `{ active: true }`. HMAC verification is the primary defense (the fake server cannot produce valid signatures without the shared secret). Defense-in-depth: use `dns.resolve4()` instead of `dns.lookup()` to bypass the hosts file, and TLS certificate pinning to reject self-signed certs on the rogue server.

2. **HMAC Replay Attack** — Client captures one valid signed response with network proxy and replays it indefinitely after revocation. Prevention: mandatory timestamp freshness check (`Math.abs(Date.now() - response.ts) < 300_000` ms); stale responses are treated identically to HMAC failures. This is not optional hardening — implement it in the same phase as HMAC verification.

3. **JSON Key Order Mismatch in HMAC Payload** — Client reconstructs the payload with keys in different order than the server; HMAC never matches; service refuses to start permanently. The server constructs `{ active, expiresAt?, ts }` in that exact order. Use explicit property construction, never spread operators (`{ sig, ...payload } = data` is safe for extraction but the rebuilt payload for verification must be explicit). Add an integration test against a known server response with a known secret, and run it against the obfuscated build.

4. **Startup Race Condition** — `startServer()` and `initScheduler()` called without awaiting `validateLicense()`; server accepts requests before license is checked. Prevention: async IIFE in `index.js` with `await validate()` before all other initialization calls. Verified risk from reading the current synchronous `src/index.js`.

5. **Conflating Network Errors with "License Invalid"** — A Vercel cold start timeout (up to 7s on free tier) immediately sets license to invalid and blocks a paying client's service. Prevention: three-state model (VALID / INVALID / ERROR); on ERROR, keep the previously cached state and log a warning; only an explicit `{ active: false }` response with valid HMAC and fresh timestamp triggers an immediate block.

## Implications for Roadmap

The architecture research defines an 8-phase build order with hard dependencies. The feature research confirms a 7-step MVP sequence before hardening. These align into four cohesive implementation phases.

### Phase 1: Foundation — Config and Core Service

**Rationale:** `LicenseValidator.js` is depended on by every other integration point. It cannot be built until `config.js` has the `license` section. Everything else is unblocked once this module exists and is tested.
**Delivers:** `config.js` license section with `LICENSE_API_URL` and `HMAC_SECRET` in REQUIRED validation. `.env.example` updated with commented variables. `LicenseValidator.js` service with HMAC verification (explicit key order), timestamp freshness check, in-memory cache, retry logic (2 retries, 3s/6s linear backoff), and `validate()` / `isValid()` / `getStatus()` exports. Structured logging for all license events via existing `LogGenerator`.
**Addresses:** New env vars (table stakes), HMAC verification (table stakes), structured logging (table stakes), timestamp freshness (should have — implemented here, not deferred)
**Avoids:** Pitfall 5 (key order mismatch — explicit payload construction enforced here), Pitfall 10 (HMAC_SECRET mismatch — truncated prefix logging at startup), Pitfall 16 (missing .env.example), Pitfall 2 (replay — timestamp freshness built into HMAC verification flow)

### Phase 2: Enforcement — Startup, Cron, and Middleware

**Rationale:** With `LicenseValidator.js` complete, all enforcement points can be wired in one cohesive phase. Startup, cron, and API middleware must be consistent; implementing them together reduces the risk of partial enforcement where one path is blocked but another is not.
**Delivers:** Async IIFE startup validation in `index.js` with `process.exit(1)` on failure. Cron guard in `CronScheduler.js` after lock acquisition. `require-license.js` Express middleware applying to `/api/schedule`, `/api/operations`, `/api/payments`, `/api/pos` (not to `/api/system/*` or static files). `GET /api/system/license` endpoint in `system-routes.js`.
**Uses:** `LicenseValidator.validate()`, `LicenseValidator.isValid()`, `ResultEnvelope.errorResult()`, existing route structure in `routes.js`
**Avoids:** Pitfall 4 (startup race condition — async IIFE), Pitfall 8 (blocking system endpoints — protection matrix applied precisely), Pitfall 3 (network errors treated as invalid — three-state model from Phase 1 propagates through here)

### Phase 3: Resilience — Grace Period, Caching, and Defense-in-Depth

**Rationale:** The Phase 2 enforcement has a sharp edge: any network failure during cron immediately affects cached state. This phase adds the grace period buffer and the layered defenses that raise the cost of bypass attempts.
**Delivers:** Consecutive network failure counter (3-cycle grace period / ~45 min before state changes on ERROR). 24-hour ERROR-state cache TTL (vs immediate update for deliberate INVALID responses). `dns.resolve4()` hostname resolution to bypass OS hosts file. TLS certificate pinning on the license axios instance using `checkServerIdentity`. Startup check for `NODE_TLS_REJECT_UNAUTHORIZED === '0'` with security warning log. Monotonic timestamp file to detect clock rollback.
**Addresses:** Grace period for network errors (should have), defense-in-depth against bypass attempts
**Avoids:** Pitfall 9 (cache TTL too short), Pitfall 1 (DNS/hosts file redirect — `dns.resolve4()` + cert pinning), Pitfall 11 (`NODE_TLS_REJECT_UNAUTHORIZED`), Pitfall 13 (clock manipulation)
**Research flag:** TLS certificate pinning implementation needs validation — Vercel's certificate rotation cadence and whether to pin leaf cert, intermediate CA, or root CA must be confirmed before implementation. See Gaps section.

### Phase 4: UX and Polish — Web UI and Expiry Indicators

**Rationale:** All enforcement is complete after Phase 2. This phase ensures operators can see license state clearly and proactively, avoiding confused support tickets when the service is deliberately blocked.
**Delivers:** Sticky "Licencia inactiva" red banner in `shared.js` injected via `initPage()` on all pages. 60-second polling of `/api/system/license` for real-time banner updates. Expiry countdown badge in sidebar (yellow at 30 days, red at 7 days, green otherwise). License status object (`{ active, lastCheck, expiresAt }`) added to `/api/system/health` response.
**Addresses:** "Licencia inactiva" banner (table stakes), license expiry countdown (should have), health endpoint enhancement (should have)
**Avoids:** Pitfall 18 (banner not updating in real time — 60s polling), Pitfall 8 (banner fetch depends on ungated `/api/system/license` endpoint from Phase 2)

### Phase Ordering Rationale

- Phase 1 before all others: `LicenseValidator.js` is a hard import dependency for every consumer. Nothing can be wired until this module exists.
- Timestamp freshness is implemented in Phase 1 alongside HMAC, not deferred: HMAC verification without freshness checking creates a false sense of security and is indistinguishable from a system that is fully bypassable via replay.
- Phase 2 before Phase 3: enforcement must exist before resilience hardening can be layered on top.
- Phase 3 before Phase 4: the UI banner polls `/api/system/license` which must reflect correct grace-period state; if Phase 3 is skipped, the banner could show "inactive" during legitimate Vercel outages, eroding trust.
- Phase 4 last: pure UX layer; its only upstream dependency is the `/api/system/license` endpoint from Phase 2.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 — TLS certificate pinning:** The Snyk article on SSL/TLS pinning in Node.js is rated MEDIUM confidence in PITFALLS.md. Vercel's certificate rotation cadence and fingerprint source need confirmation before hardcoding a pin. If Vercel rotates leaf certificates frequently (as Cloudflare does), pinning the intermediate or root CA is safer. Recommend `/gsd:research-phase` or a targeted investigation before implementing this specific item.

Phases with standard patterns (skip research-phase):
- **Phase 1:** API contract verified from direct source analysis of both repos. HMAC pattern verified from existing `api-key.js`. All technology verified locally. No unknowns.
- **Phase 2:** Express middleware, cron guard insertion, and route modification patterns all have direct precedents in the existing codebase. No external research needed.
- **Phase 4:** Bootstrap alert banner injection and sidebar badge rendering are vanilla JS/CSS work with no external dependencies or novel patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified locally on Node v24.12.0; versions confirmed in package.json; `axios.create()` and `interceptors.response.use` confirmed working on v1.7.7; no new dependencies required |
| Features | HIGH | Derived from direct source analysis of both SageConnect and sageconnect-license repos; license server API contract verified through route implementation and a 12-case test suite covering all edge cases |
| Architecture | HIGH | Component boundaries, data flow, build order, and route protection matrix all derived from direct source code analysis; all integration points verified against actual file structure |
| Pitfalls | HIGH (critical), MEDIUM (some hardening) | Critical pitfalls (DNS bypass, replay, key order, race condition, three-state model) rated HIGH from documented attacks and source code verification; TLS pinning and clock manipulation mitigations rated MEDIUM — real threats but implementation specifics need validation |

**Overall confidence:** HIGH

### Gaps to Address

- **TLS certificate pinning specifics:** Vercel's certificate fingerprint and rotation policy need to be confirmed before implementing pinning in Phase 3. Pinning a leaf cert that Vercel rotates quarterly will cause production outages. Determine whether to pin the leaf cert, intermediate CA, or root CA. If pinning the root CA, confirm which CA Vercel uses. Handle this during Phase 3 planning.

- **Obfuscation compatibility of HMAC payload construction:** PITFALLS.md (Pitfall 7) flags a MEDIUM-confidence risk that `javascript-obfuscator` with `transformObjectKeys: true` could alter property insertion order in the HMAC payload, breaking verification in the obfuscated production build. This cannot be resolved by research alone — it requires empirical testing with `npm run obfuscate` after Phase 1 is complete. Add an obfuscated-build smoke test (known server response + known secret = expected HMAC result) to the Phase 1 definition of done.

- **Obfuscated deployment file inclusion:** The separate obfuscated deployment repo (`sageconnect-license`) will need the two new files (`LicenseValidator.js`, `require-license.js`) included in the obfuscation pipeline. Verify that `scripts/obfuscate.js` glob patterns capture `src/services/` and `src/middleware/` comprehensively rather than listing files explicitly.

- **HMAC_SECRET distribution process:** The shared secret must be delivered to each new client deployment. Currently this is a manual copy from the license server's `.env`. This is a deployment process gap, not an implementation gap — document it in the deployment guide and consider whether a one-time secure delivery mechanism is needed.

- **Grace period duration calibration:** The 3-cycle / ~45-minute grace period for network errors is a reasonable design choice but not a validated one. Real-world Vercel outage frequency data from the specific deployment would inform whether this is too aggressive. Start with 3 cycles and revisit after observing the first few weeks of production operation.

## Sources

### Primary (HIGH confidence — direct source code analysis)

- `sageconnect-license/app/api/validate/route.ts` — license validation endpoint, response shape, HTTP 200 always
- `sageconnect-license/lib/crypto.ts` — `signResponse()` implementation: `createHmac('sha256', HMAC_SECRET).update(JSON.stringify(payload)).digest('hex')`; field ordering confirmed
- `sageconnect-license/lib/validators.ts` — API key format: `/^sc_live_[0-9a-f]{64}$/`
- `sageconnect-license/app/api/validate/__tests__/route.test.ts` — 12 test cases covering all response shapes and edge cases
- `sageconnect-license/.env.local` — actual HMAC_SECRET value for cross-environment validation
- SageConnect: `src/index.js`, `src/config.js`, `src/server.js`, `src/services/CronScheduler.js`, `src/services/OperationManager.js`, `src/middleware/api-key.js`, `src/routes/routes.js`, `src/routes/system-routes.js`, `public/js/shared.js`
- Node.js `crypto.createHmac` + `timingSafeEqual`: verified locally on Node v24.12.0
- axios v1.7.7: `axios.create()` and `interceptors.response.use` confirmed working
- [Node.js DNS docs v22](https://nodejs.org/docs/latest-v22.x/api/dns.html) — `dns.lookup()` vs `dns.resolve*()` hosts file behavior
- [Keygen.sh offline licenses](https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/) — cryptographic validation caching architecture
- [Keygen.sh API signatures](https://keygen.sh/docs/api/signatures/) — response signature verification flow
- [HMAC + Timestamps + Nonces](https://thomasrones.com/technical/system-design/hmac-timestamp-nonce/) — replay prevention architecture
- [License bypass via hosts file](https://github.com/thibautsabot/bypass-license-verification) — documented attack reproducing the exact threat model

### Secondary (MEDIUM confidence)

- [Snyk: SSL/TLS pinning in Node.js](https://snyk.io/blog/ssl-tls-pinning-node-js/) — certificate fingerprint pinning implementation
- [Vercel cold start performance](https://vercel.com/kb/guide/how-can-i-improve-serverless-function-lambda-cold-start-performance-on-vercel) — latency expectations informing the 10s timeout
- [Neon connection latency](https://neon.com/docs/connect/connection-latency) — database cold start timing (up to 3s)
- [Clock Tampering Detection](https://www.codeproject.com/Articles/1101956/Check-for-Clock-Tampering-to-Extend-Licence-Durati) — monotonic timestamp approach
- [Statsig: Kill Switch in Software Safety](https://www.statsig.com/perspectives/killswitchsoftwareafety) — kill switch design principles
- [LicenseSpring: Offline Validation Patterns](https://licensespring.com/blog/guide/how-to-implement-offline-software-license-validation) — grace period and caching patterns

### Tertiary (LOW confidence)

- [JScrambler: JavaScript Obfuscation Guide 2026](https://jscrambler.com/blog/javascript-obfuscation-the-definitive-guide) — obfuscation state of the art (informs the obfuscation-is-not-a-security-boundary guidance)
- [REstringer deobfuscator](https://github.com/HumanSecurity/restringer) — deobfuscation tool capabilities
- [Deobfuscation via LLMs (arxiv)](https://arxiv.org/html/2512.14070v1) — LLM-based code simplification research
- [jose npm](https://www.npmjs.com/package/jose) — Ed25519 support for the planned v2.2 asymmetric signature upgrade

---
*Research completed: 2026-03-25*
*Ready for roadmap: yes*
