# External Integrations

**Analysis Date:** 2026-03-12 (initial), refreshed 2026-05-12 (post-v2.3)

## APIs & External Services

### Focaltec — Portal de Proveedores

- **Service:** supplier portal for managing purchase orders, CFDIs, and payments.
- **Client:** singleton `axios.create({timeout: PORTAL_HTTP_TIMEOUT_MS})` in `src/utils/PortalClient.js`. 18 call sites across 9 controller/utility files all share this instance.
- **Auth:** custom headers `PDPTenantKey` (= `config.portal.tenants[i].key`) and `PDPTenantSecret` (= `.secret`). Set per-call by the calling controller, never logged.
- **Base URL:** `config.portal.url` — `https://api.portaldeproveedores.mx` (production) or `https://api-sandbox.portaldeproveedores.mx` (sandbox).
- **Documented endpoints** (extracted from the upstream swagger at [`API-SPEC.md`](API-SPEC.md)):
  - `GET  /api/1.0/extern/tenants/{tenantId}/cfdis`
  - `GET  /api/1.0/extern/tenants/{tenantId}/cfdis/{cfdiId}/files`
  - `GET  /api/1.0/extern/tenants/{tenantId}/payments/{paymentId}`
  - `GET  /api/1.0/extern/tenants/{tenantId}/providers/{providerId}`
  - `POST /api/1.0/extern/tenants/{tenantId}/purchase-orders`
  - `PUT  /api/1.0/extern/tenants/{tenantId}/purchase-orders/{id}/status`
  - `PUT  /api/1.0/extern/tenants/{tenantId}/purchase-orders/{id}`
  - `POST /api/1.0/extern/tenants/{tenantId}/payments`
  - `POST /api/1.0/batch/tenants/{tenantId}/payments`

### SageConnect License Server (Vercel)

- **Service:** remote license issuance and revocation for SageConnect installations. Hosted on Vercel.
- **Configured via:** `LICENSE_API_URL`, `HMAC_SECRET`, `LICENSE_ADMIN_EMAIL`.
- **Client:** an internal axios instance inside `src/services/LicenseValidator.js`, separate from `PortalClient` (different timeout policy, HMAC signing requirements).
- **Auth:** the client identifies itself with `SAGECONNECT_API_KEY` (dual-purpose: same key used by the dashboard `requireApiKey` middleware).
- **Validation flow:** POST to `LICENSE_API_URL` → verify HMAC-SHA256 over the response → enforce 5-minute timestamp freshness (anti-replay) → cache result for 24 h in a three-state model (VALID / INVALID / ERROR). DNS bypass defense via `dns.resolve4()` (catches hosts-file redirection to loopback / private ranges).
- **Failure modes:** startup fail-fast (`process.exit(1)` from `src/index.js`); cron cycle skip (the scheduler checks license state on every tick); Express 503 from `requireLicense` middleware on `/api/payments`, `/api/pos`, `/api/schedule`, `/api/operations`.
- **Notifications:** `LICENSE_ADMIN_EMAIL` receives mail on startup failure and mid-cycle revocation.

### CFDI document processing

- **Service:** Mexican fiscal authority CFDI (Comprobante Fiscal Digital por Internet) documents handled through the Focaltec API.
- **Types processed:** `PAYMENT_CFDI`, `INVOICE`, `CREDIT_NOTE`.
- **Local processing:** XML parsing via `xml2js` for payment/invoice reconciliation, persistence into `APIBHO` (invoice UUID) and `APVENO` (provider ID) Sage tables.

## Data Storage

### SQL Server (Sage 300 + FESA)

- **Driver:** `mssql@11.0.1` via the singleton pool in `src/utils/SQLServerConnection.js`.
- **Pool configuration:** 15 s connection timeout, 60 s query timeout, `trustServerCertificate: true` (self-signed cert is the prod norm), default pool size (mssql defaults — bounded pool override is open tech-debt).
- **Multi-DB safety:** `runQuery(query, database = config.database.database)` always prepends `USE [database]`. Default resolves at call time from config; callers targeting a non-default DB must pass `database` explicitly (PR #19 closed 7 latent regressions caused by relying on the old hardcoded `'FESA'` default).
- **Key tables:**
  - `fesa.dbo.fesaOCFocaltec` — tracks POs synced to Focaltec. Columns: `idFocaltec`, `ocSage`, `status`, `lastUpdate`, `createdAt`, `responseAPI`, `idDatabase`.
  - `<sageDB>.dbo.APVENO` — vendor "PROVIDERID" mapping (Sage VENDOR field set after portal lookup).
  - `<sageDB>.dbo.APIBHO` — invoice "FOLIOCFD" mapping (UUID written after portal CFDI match).
  - `<sageDB>.dbo.ICLOC`, `OE*` — purchase-order source data.

### Local filesystem

- **Logs:** `logs/sageconnect/YYYY-MM-DD/[ProcessName].log` (winston-managed). In production at Capstone (server `ZCL-RDS-02`), `E:\sageconnect-dist\logs\` for app logs and Servy stdout/stderr, rotated to `C:\Logs\sageconnect\servy\YYYY-MM-DD\` by `Rotate-SageConnectLogs.ps1` (staged at `C:\Scripts\` outside the dist repo so it survives `git reset --hard`).
- **CFDI staging:** `DOWNLOADS_PATH` (typically `./downloads`).
- **Provider XML staging:** `PROVIDERS_PATH` (typically `./downloads/providers`).
- **Reports:** `reports/` (one-shot script outputs).

### Caching

- License state — 24 h TTL in-memory three-state cache (`LicenseValidator.js`).
- winston transports — module-scope `Map` keyed by `(date, fileName)` (`LogGenerator.js`).
- No Redis, no Memcached, no external cache.

## Authentication & Identity

**Focaltec portal**

- Per-tenant `API_KEY` / `API_SECRET` header pair, sent on every request.
- Tenant resolution: `config.portal.tenants[i]` returns `{id, key, secret, database, externalId}`. The index `i` is threaded through every controller/service/utility.
- `EXTERNAL_IDS` (per-tenant RFC) is used by `ProviderIdResolver` to look up portal providers and persist their ID back to `APVENO`.

**SageConnect dashboard**

- Single `SAGECONNECT_API_KEY` enforced by `requireApiKey` middleware on `/api/payments` and `/api/pos`.
- Server-side `<meta name="x-app-key">` injection by `serveHtmlWithKey()` (`src/server.js:122`) — operators never paste the key. The same key identifies this installation to the license server.

**License server**

- Same `SAGECONNECT_API_KEY` as client identifier.
- `HMAC_SECRET` shared with the server for response signing.

## Monitoring & Observability

**Error tracking**

- None external (no Sentry, no Datadog, no Rollbar).
- The on-disk log directory is the audit trail.

**Logs**

- Application logs: winston via `logGenerator(LOG_FILE, level, message)` to `logs/sageconnect/YYYY-MM-DD/[Process].log`. File handle cached per `(date, fileName)` to bound FD usage under always-on.
- `[TIMEOUT]` entries are routed cross-cutting (ChildProcess.log + CronScheduler.log + ForResponse.log + caller-specific log) with mandatory keys `step`, `tenant`, `url`, `durationMs`, `err`.
- `[ADMIN-EMAIL]` entries record outbound admin alerts (`AdminEmailSender.sendAdminAlert`) per caller.
- Servy stdout/stderr in production live in the install directory, rotated to `C:\Logs\sageconnect\servy\YYYY-MM-DD\` by `Rotate-SageConnectLogs.ps1` (PR #20).

**Dashboard**

- `/logs.html` exposes the per-date per-process log directory.
- `/schedule.html` shows cron schedule, last/next run, and the live "Operación en curso" card (5 s polling + 1 s heartbeat ticker).
- `/api/operations/status` is the JSON feed the card polls.
- `/api/system/health` is the synthetic health probe used by Servy and the deploy checklist.

**Notifications**

- Email via `nodemailer` (`MAIL_TRANSPORT=smtp` or `gmail`). Sent to `MAILING_NOTICES` (and `MAILING_CC`) for operational events, and to `LICENSE_ADMIN_EMAIL` for license + child-process-timeout events.
- Email dispatch is **only** triggered for child-process timeouts (Phase 19 D-15: avoids inbox flood from transient axios timeouts).
- `node-notifier` desktop notifications are no-ops in production (Servy has no desktop session) but remain in code for local-dev use.

## CI/CD & Deployment

- **Hosting:** self-hosted Windows Server, port 3030.
- **CI workflow:** `.github/workflows/obfuscate-deploy.yml`.
  - Triggers on push to `master` or `feat/always-on-service`, plus manual `workflow_dispatch`.
  - Node 18 runner (obfuscation only; runtime is Node 22.15.0).
  - Steps: `npm ci` → `node scripts/obfuscate.js` → commit `dist/` → force-push to `FReptar0/sageconnect-dist`.
  - **No tests, no linting, no security scanning** run in CI.
- **Secret:** `OBFUSCATED_REPO_TOKEN` (Personal Access Token with repo permissions on the dist repo).
- **Production install:** Servy via `scripts/install-service.ps1`. Full procedure in [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md).

## Environment Configuration

All required variables live in a **single `.env`** at the repo root. The pre-v1.1 split (`.env.credentials.database`, `.env.credentials.focaltec`, `.env.credentials.mailing`, `.env.path`) is retired — `scripts/migrate-env.js` ships for one-time consolidation on legacy installs.

Canonical template with inline comments: [`.env.example`](../../.env.example). Quick reference of required keys grouped by section:

| Section | Required variables |
|---|---|
| Database | `DB_USER`, `DB_PASSWORD`, `SERVER`, `DATABASE` |
| Portal | `URL`, `TENANT_ID`, `API_KEY`, `API_SECRET`, `DATABASES`, `EXTERNAL_IDS` |
| Paths | `DOWNLOADS_PATH`, `PROVIDERS_PATH`, `LOG_PATH` |
| App | `IMPORT_CFDIS_ROUTE`, `ARG`, `NOMBRE`, `RFC`, `REGIMEN`, `TIMEZONE`, all 7 `DEFAULT_ADDRESS_*`, `ADDRESS_IDENTIFIERS_SKIP` |
| License | `LICENSE_API_URL`, `HMAC_SECRET`, `LICENSE_ADMIN_EMAIL` |

Optional sections:

| Section | Optional variables |
|---|---|
| Mailing | `MAIL_TRANSPORT` selector + transport-specific keys (SMTP: `eFrom`, `ePass`, `eServer`, `ePuerto`, `eSSL`, `MAILING_NOTICES`, `MAILING_CC`; Gmail: `CLIENT_ID`, `SECRET_CLIENT`, `REFRESH_TOKEN`, `REDIRECT_URI`) |
| Security | `SAGECONNECT_API_KEY` (recommended — disables `requireApiKey` if absent) |
| Schedule | `CRON_SCHEDULE`, `OPERATION_DELAY_MS`, `LOCK_TIMEOUT_MS`, `CHILD_PROCESS_TIMEOUT_MS`, `STEP_TIMEOUT_MS`, `PORTAL_HTTP_TIMEOUT_MS` |

**Secrets storage**

- Local `.env` is gitignored.
- Production `.env` lives on the server at the install directory (`E:\sageconnect-dist\.env` at Capstone on `ZCL-RDS-02`).
- CI uses `OBFUSCATED_REPO_TOKEN` as a GitHub Actions secret. No other secrets are passed through CI.

## Webhooks & Callbacks

- **Incoming:** none. The service does not expose webhook endpoints. The dashboard API is polled, not pushed.
- **Outgoing:**
  - Email alerts on cron-cycle completion, error conditions, license events, child-process timeouts.
  - Force-push to the dist repo on every CI build (counts as an outbound callback in spirit).

## Data Flow

```
Cron tick (*/15 * * * *)
   ↓
LicenseValidator.checkValid() ─► skip if INVALID/ERROR
   ↓
OperationManager.acquireLock('background-cycle', LOCK_TIMEOUT_MS)
   ↓
forResponse() — for each tenant i:
   ├─ buildProvidersXML(i)        → Focaltec providers API → write XML for Sage
   ├─ downloadCFDI(i)             → Focaltec CFDIs API → spawn ImportaFacturasFocaltec.exe
   ├─ checkPayments(i)            → Sage SQL → identify pending payments
   ├─ uploadPayments(i)           → POST payment batch to Focaltec
   ├─ createPurchaseOrders(i)     → Sage SQL → POST new POs to Focaltec
   ├─ processOrderChanges(i)      → poll Focaltec → mutate Sage
   └─ closePurchaseOrders(i)      → mark Sage POs closed → POST closure to Focaltec
   ↓
OperationManager.releaseLock() (or lock:timeout auto-release after 14 min)
   ↓
Optional: sendAdminAlert (child-process timeout only) or sendMail (operational notice)
```

---

*Integration audit: 2026-03-12 (initial), refreshed 2026-05-12 (post-v2.3).*
