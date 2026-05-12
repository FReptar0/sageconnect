# Security Policy

## Overview

SAGECONNECT is a financial integration system that handles sensitive ERP data, multi-tenant Focaltec API credentials, and license validation against an external HMAC-signed service. This document covers the supported versions, the environment-variable model, the security-relevant runtime constraints, and how to report a vulnerability.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.3.x   | :white_check_mark: |
| < 2.3   | :x:                |

The 2.3 milestone (Scheduler Lock Recovery) shipped on 2026-04-29 with full defense-in-depth timeout coverage and 17/17 STRIDE threats closed. Older versions did not have the auto-release timer, the singleton `PortalClient`, the child-process kill cascade, or the unified `[TIMEOUT]` log routing — security patches are not backported.

## Security Considerations

### Sensitive Data Handled

SAGECONNECT processes:

- Sage 300 ERP database credentials and direct SQL access.
- Multi-tenant API keys and secrets for `portaldeproveedores.mx`.
- CFDI (electronic invoice) documents and payment records.
- Supplier and vendor data, including RFCs and provider IDs.
- A license-server identifier and HMAC shared secret.

### Environment Variable Security

All configuration lives in a **single `.env`** file at the repo root (since v1.1). The legacy split (`.env.credentials.database`, `.env.credentials.focaltec`, `.env.credentials.mailing`, `.env.path`) was retired in v1.1 — only the unified `.env` is supported now. See [`.env.example`](.env.example) for the canonical template with inline section comments.

**Critical Practices**

1. Never commit `.env` to version control (it is in `.gitignore`).
2. To preserve a server-local `.env` across `git pull` / `git reset --hard`, run `git update-index --skip-worktree .env`.
3. Restrict file-system permissions on the production `.env` (Windows ACLs: read/write only for the service account running `SageConnect`).
4. Rotate API keys, database passwords, and the license `HMAC_SECRET` on a regular cadence and after any suspected exposure.

### Configuration Validation

`src/config.js` enforces a fail-fast contract at process startup:

- Required variables (`DB_*`, portal credentials, paths, license keys, address defaults) are validated. Missing or empty values cause `process.exit(1)` with a `[CONFIG ERROR]` listing.
- Numeric range guards reject misconfigured timeouts (`LOCK_TIMEOUT_MS`, `PORTAL_HTTP_TIMEOUT_MS`, `CHILD_PROCESS_TIMEOUT_MS`, `STEP_TIMEOUT_MS`) — a value below the documented minimum exits 1 rather than allowing the defense-in-depth invariant to be silently broken.
- `SAGECONNECT_API_KEY` is optional but warns when absent (`[CONFIG WARN]`). Leaving it unset disables the `requireApiKey` middleware on `/api/payments` and `/api/pos`; only acceptable for local development.

### Database Security

- Singleton mssql pool with `trustServerCertificate: true` (the prod Sage 300 servers ship with self-signed certs — TLS is on, validation is off).
- `runQuery(query, database)` always prepends `USE [database]` to defeat pool-context leakage observed in production (PR #16). The `database` parameter defaults to `config.database.database`; callers that target a different DB must pass it explicitly (PR #19 closed 7 latent regressions).
- SQL queries use template-literal interpolation in many places (`.planning/codebase/CONCERNS.md` § Tech Debt). This is a documented pre-existing risk; new code should use parameterized requests where feasible.
- The diagnostic scripts in `src/scripts/` are read-only by convention; the few that write (`payment-uuid-repair`, `mark-payment-invoices-paid`) are run manually by the operator after explicit confirmation.

### API Security

- All Focaltec calls go through the singleton `PortalClient` (`src/utils/PortalClient.js`) with a hard 30 s timeout (`PORTAL_HTTP_TIMEOUT_MS`).
- Per-tenant credentials are injected as headers (`PDPTenantKey`, `PDPTenantSecret`) — never logged, never sent in URLs.
- Express adds `helmet` (security headers, CSP disabled for inline dashboard scripts), CORS (allow-list of methods + the `x-api-key` header only), and `express-rate-limit` (global 2000 req/15 min, write-endpoint 10 req/min).
- Dashboard authentication: `SAGECONNECT_API_KEY` is dual-purpose — it gates the dashboard XHR via `requireApiKey` middleware **and** identifies this installation to the license server. The browser receives it through a server-side `<meta name="x-app-key">` injection (`src/server.js` `serveHtmlWithKey()`); operators never paste it, and it never appears in URLs or logs.

### License Validation

The service requires a valid license at boot:

- `LicenseValidator.validate({startup: true})` runs in `src/index.js` before the server or scheduler start. Failure exits the process with `[LICENSE] Startup blocked`.
- Validation flow: POST to `LICENSE_API_URL` with the `SAGECONNECT_API_KEY` as client identifier → verify HMAC-SHA256 signature with `HMAC_SECRET` → enforce 5-minute timestamp freshness (anti-replay) → cache the result for 24 h in a three-state model (VALID / INVALID / ERROR).
- Defense-in-depth: `dns.resolve4()` short-circuits when the configured license host resolves to a loopback or private range, defeating naive hosts-file redirection.
- Operational events (validation failure, mid-cycle revocation) dispatch an email to `LICENSE_ADMIN_EMAIL` so the administrator notices even if the dashboard is closed.

### Multi-Tenant Architecture

- Tenant index `i` is threaded through every controller / service / utility call; downstream code reads `config.portal.tenants[i].{id,key,secret,database,externalId}`.
- Cross-tenant data access is prevented structurally: there is no shared state between tenants in `forResponse()` iterations beyond config and singletons. SQL queries always carry an explicit DB target.
- Each tenant's API key/secret is isolated — losing one tenant's credentials does not expose others.

## Deployment Security

### Production Environment

Production runs as the `SageConnect` Windows service via [Servy](https://github.com/servy-dev/servy). Full deployment and rollback procedure: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Operator runbook: [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

Hardening notes:

- Run the service under a dedicated Windows account with the minimum permissions needed (read/write on the install dir, read/write on the log directories, network access to the Sage SQL server + the Focaltec portal + the license server).
- The obfuscated production code ships in a separate repo (`FReptar0/sageconnect-dist`) via the `obfuscate-deploy.yml` GitHub Action; the source repo and the obfuscated repo do not share git history. Deploys on the server use `git fetch && git reset --hard origin/master` against the dist repo.
- Servy auto-restart policy: 5 attempts max with 30 s graceful stop, then the service stops and waits for human intervention (prevents pathological restart loops from masking a config error).
- Servy stdout/stderr live in the install directory; the application's winston logs live in `logs/sageconnect/YYYY-MM-DD/`. Both are rotated by `scripts/Rotate-SageConnectLogs.ps1` (PR #20) to keep file handles bounded under always-on.

### Always-On Constraints

The service does not exit between cron ticks. This is the dominant security-relevant runtime property: anything that retains state across cycles is a potential vector if not carefully bounded.

- File descriptors: the winston logger caches transports per `(date, fileName)` and recycles them at midnight — see `src/utils/LogGenerator.js`.
- Database connections: singleton pool with explicit `USE [DB]` per query (`src/utils/SQLServerConnection.js`).
- HTTP clients: singleton `axios.create({timeout: 30000})` (`src/utils/PortalClient.js`).
- Operation locks: auto-release on `setTimeout(LOCK_TIMEOUT_MS)` with a `lock:timeout` EventEmitter event and an audit-log trail.
- Child processes: SIGTERM → 30 s grace → `taskkill /F /T` to defeat hung GUI dialogs (Servy has no desktop session).

A worked example of what happens when these guards are missing — five latent always-on bugs surfaced in 1 h 56 m post-deploy, including an `EMFILE` crash loop — is in [`.planning/forensics/report-20260427-220000.md`](.planning/forensics/report-20260427-220000.md). New contributors should read it before touching long-running primitives.

## Logging & Monitoring

- All application events go through `logGenerator(LOG_FILE, level, message)` from `src/utils/LogGenerator.js`, written to `logs/sageconnect/YYYY-MM-DD/<ProcessName>.log`.
- `[TIMEOUT]` log entries are routed cross-cutting (ChildProcess.log + CronScheduler.log + ForResponse.log + caller-specific) with mandatory keys `step`, `tenant`, `url`, `durationMs`, `err`.
- Email dispatch (`LICENSE_ADMIN_EMAIL`) fires only for child-process timeouts and license revocation — by design (Phase 19 D-15: avoids inbox flood from transient axios timeouts).
- Failed authentication attempts on the dashboard middleware return `401` with no info leakage; rate limiting (10 req/min for writes) further bounds abuse surface.
- No external error-tracking service is wired in (no Sentry / Datadog). The audit trail is the on-disk log directory.

## Vulnerability Reporting

If you discover a security issue:

1. **Do not** open a public GitHub issue.
2. Email <hi@fernandomemije.dev> with details (steps to reproduce, affected version, impact assessment).
3. Allow reasonable time for investigation before any disclosure.

### Response Timeline

- **Initial response:** within 48 hours.
- **Investigation:** within 7 days.
- **Fix development:** within 30 days, depending on severity.
- **Public disclosure:** after the fix is deployed and users have been notified.

## Compliance Considerations

Because the system processes Mexican fiscal data (CFDIs, RFCs, payment supplements):

- Retention: log files are kept on disk indefinitely by default; operators should size disk and rotate per their internal policy.
- Auditability: the dashboard exposes `/api/schedule` history and `/api/operations` status so every cron run is traceable post-hoc.
- Encryption at rest is the responsibility of the operator (Windows BitLocker / disk-level encryption on the prod box) — the application does not encrypt its own files.

## Security Contacts

- **Maintainer:** Fernando Rodríguez Memije.
- **Email (security and business contact):** <hi@fernandomemije.dev>.

For more on the licensing model, see [`LICENSE.md`](LICENSE.md), [`EULA-en.md`](EULA-en.md) (controlling English version), and [`EULA-es.md`](EULA-es.md) (Spanish courtesy translation). This policy evolves as the threat landscape changes — refer to the latest version in the repository.
