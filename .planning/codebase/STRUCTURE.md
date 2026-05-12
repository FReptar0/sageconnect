# Codebase Structure

**Analysis Date:** 2026-03-12 (initial), refreshed 2026-05-12 (post-v2.3)

## Directory Layout

```
sageconnect/
├── src/                          # Application source
│   ├── index.js                  # Entry: license validate → server → cron
│   ├── server.js                 # Express setup (helmet, CORS, rate-limit, meta key injection)
│   ├── background.js             # forResponse orchestration (7 steps per tenant)
│   ├── config.js                 # Single env-var loader with fail-fast + range guards
│   ├── controller/               # High-level business workflows (10 files)
│   ├── services/                 # Cross-cutting services (8 files)
│   ├── utils/                    # Shared utilities (14 files)
│   ├── middleware/               # Express middleware (5 files)
│   ├── models/                   # Joi schemas
│   ├── routes/                   # 6 route files + schemas/ subdir
│   └── scripts/                  # One-shot diagnostic / repair scripts (18 files)
├── public/                       # Static dashboard
│   ├── schedule.html             # Home — cron status, live operation card
│   ├── payments.html             # Payment reconciliation audit
│   ├── pos.html                  # PO management + "Cambiar Estado OC"
│   ├── logs.html                 # Per-date, per-process log viewer
│   ├── 404.html                  # Error page
│   ├── js/                       # shared.js + page-specific scripts
│   └── img/                      # Dashboard assets
├── tests/                        # Jest suite (~200 tests)
│   ├── api/                      # HTTP endpoint tests + html-key-injection
│   ├── controller/               # Controller-layer tests
│   ├── services/                 # Service-layer tests
│   ├── utils/                    # Utility-layer tests
│   ├── integration/              # Cross-module flows
│   └── helpers/                  # Shared mocks/fixtures
├── docs/                         # Operator and developer-facing docs
│   ├── DEPLOYMENT.md             # Servy install / rollback procedure
│   ├── OPERATIONS.md             # Operator runbook
│   ├── ARCHITECTURE.md           # Single-page architecture view
│   ├── ONBOARDING.md             # Day-1 dev flow
│   └── CLAUDE_CODE.md            # Working with Claude Code in this repo
├── scripts/                      # Build / install tooling (PowerShell + Node)
│   ├── install-service.ps1       # Servy service registration (Administrator)
│   ├── Rotate-SageConnectLogs.ps1 # Log rotation under always-on
│   ├── obfuscate.js              # CI-driven obfuscation (do not run manually)
│   ├── migrate-env.js            # One-time v1.0 → v1.1 .env consolidation
│   ├── simulate-stuck-lock.js    # Test harness for lock auto-release
│   └── verify-*.js               # CI verification scripts
├── reports/                      # Generated reports (gitignored)
├── .planning/                    # GSD planning artifacts (kept in repo)
│   ├── PROJECT.md, STATE.md, MILESTONES.md, ROADMAP.md, RETROSPECTIVE.md
│   ├── codebase/                 # This file + ARCHITECTURE / CONCERNS / STACK / etc.
│   ├── milestones/               # Archived milestone roadmaps + requirements
│   ├── forensics/                # Post-incident reports
│   ├── research/                 # Research artifacts feeding decisions
│   ├── quick/                    # Quick-task scratch
│   └── todos/                    # Captured ideas
├── .claude/                      # Claude Code per-repo configuration
│   ├── settings.json             # Committed: hooks + permissions baseline
│   ├── hooks/                    # SessionStart + Stop shell hooks
│   └── commands/                 # Slash commands (/test, /env-check, /diagnose, /deploy-checklist)
├── .github/workflows/
│   └── obfuscate-deploy.yml      # Push master → obfuscate → force-push to dist repo
├── .env                          # Single unified config (gitignored)
├── .env.example                  # Canonical template — every required var documented inline
├── .env.legacy/                  # Backups created by migrate-env.js (if v1.0 was migrated)
├── package.json                  # Dependencies + scripts
├── jest.config.js
├── babel.config.js
├── CLAUDE.md                     # Auto-loaded memory for Claude Code
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CODE_OF_CONDUCT.md
├── EULA-en.md / EULA-es.md / LICENSE.md / AVISO_PRIVACIDAD.md
└── PAYMENT-RECONCILIATION.md
```

> The pre-v1.1 `.env.credentials.database`, `.env.credentials.focaltec`, `.env.credentials.mailing`, and `.env.path` files are no longer used. `scripts/migrate-env.js` still ships for operators who need to consolidate a legacy install.

## Directory Purposes

### `src/controller/` — business workflows (10 files)

Each controller owns one cross-system workflow and is called per-tenant by `background.js`.

- `CFDI_Downloader.js` — fetch electronic invoices from the Focaltec portal.
- `SagePaymentController.js` — validate payments against the Sage 300 database.
- `PortalPaymentController.js` — upload verified payments to the portal.
- `PortalOC_Creator.js` — create purchase orders in the portal from Sage data.
- `PortalOC_LifecycleManager.js` — orchestrate status + content updates for existing POs.
- `PortalOC_Closer.js` — mark completed POs closed in the portal.
- `PortalOC_Canceller.js` — cancel POs in the portal.
- `PortalOC_StatusUpdater.js` — single-PO status mutation (drives the UI form).
- `PortalOC_ContentUpdater.js` — line-item and address mutations on existing POs.
- `Providers_Downloader.js` — download providers + build XML for Sage import.

### `src/services/` — cross-cutting services (8 files)

- `CronScheduler.js` — `node-cron` wrapper; registers the recurring background cycle and the `lock:timeout` listener.
- `LicenseValidator.js` — HMAC-SHA256 validation against the license server, 3-state cache (VALID/INVALID/ERROR), DNS bypass detection, admin email alerts.
- `OperationManager.js` — concurrency lock with `stepProgress` array slot, auto-release timer (`LOCK_TIMEOUT_MS`), and `lock:timeout` EventEmitter.
- `LogDashboardService.js` — aggregate log files into the dashboard view.
- `ProviderIdResolver.js` — map vendor IDs to portal provider IDs and persist to `APVENO`.
- `UuidResolver.js` — resolve invoice UUIDs and persist to `APIBHO`.
- `PortalOC_PayloadBuilder.js` — assemble + Joi-validate purchase-order payloads.
- `PortalOC_StatusService.js` — query and format portal order status responses.

*Removed in v2.0:* `AutoShutdownService.js` (always-on regime makes auto-shutdown a misfeature).

### `src/utils/` — shared helpers (14 files)

- `SQLServerConnection.js` — singleton mssql pool + always-prepend `USE [DB]`. Default DB resolves at call time from `config.database.database`.
- `PortalClient.js` — singleton `axios.create({timeout: PORTAL_HTTP_TIMEOUT_MS})`. Used by 18 axios call sites in 9 files.
- `LogGenerator.js` — winston transport cache keyed by `(date, fileName)` to bound FD usage.
- `AdminEmailSender.js` — `sendAdminAlert(subject, html, callerLogFile)` + `findLastOpenStep`. Extracted at the third use site (quick task 260502-i7l).
- `EmailSender.js` — SMTP / Gmail OAuth transport selector.
- `duration.js` — `withStepTimeout(promise, ms, ctx)` Promise.race wrapper + `formatDurationMin`. Sentinel string `'Step timeout'` is load-bearing in log routing.
- `ResultEnvelope.js` — `successResult` / `errorResult` builders for the unified API response shape.
- `TimezoneHelper.js` — IANA TZ-aware date helpers, falls back to local time on invalid zone.
- `TransformTime.js` — time unit conversion.
- `GetTypesCFDI.js`, `GetProviders.js`, `CsvWriter.js`, `OC_GroupOrdersByNumber.js`, `parseExternPurchaseOrders.js` — domain-specific helpers.

### `src/middleware/` — Express middleware (5 files)

- `api-key.js` — `requireApiKey` enforcement on `/api/payments` and `/api/pos`.
- `require-license.js` — `requireLicense` returns 503 when license state is INVALID/ERROR.
- `validate.js` — Joi schema validator factory.
- `async-handler.js` — promise-to-next adapter for async route handlers.
- `send-result.js` — uniform `ResultEnvelope` responder.

### `src/routes/` — 6 route files + schemas

- `routes.js` — top-level router; mounts the 6 modules with the correct middleware chain.
- `dashboard-routes.js` — static dashboard support endpoints (unlicensed).
- `system-routes.js` — `/api/system/{health,tenants,license,...}` (unlicensed).
- `schedule-routes.js` — `/api/schedule/*` (licensed, no API key).
- `operations-routes.js` — `/api/operations/*` (licensed, no API key — polled by dashboard).
- `payment-routes.js` — `/api/payments/*` (licensed + API key).
- `po-routes.js` — `/api/pos/*` (licensed + API key).
- `schemas/` — Joi request schemas for payment and PO endpoints.

### `src/scripts/` — 18 one-shot scripts

Diagnostic / repair tools run manually by the operator. Convention: each returns a `ResultEnvelope`, no auto-exit, read-only by default. Categories:

- **Payment** — `payment-reconciliation.js`, `payment-status-check.js`, `payment-uuid-diagnostic.js`, `payment-uuid-repair.js`, `pending-payments-diagnostic.js`, `get-payment-cfdis.js`, `mark-payment-invoices-paid.js`, `upload-single-payment.js`, `portal-payments-generator.js`.
- **Purchase Order** — `po-diagnostic.js`, `po-address-diagnostic.js`, `po-payment-form-diagnostic.js`, `po-query.js`, `po-update.js`, `po-upload.js`, `upload-authorized-pos.js`, `test-order-lifecycle.js`.
- **Sage tables** — `diagnose-sage-tables.js` (8 `safeRun()` checks, template for read-only investigation under no-prod-SQL-access constraint).

### `public/` — static dashboard

Each HTML page is served via `serveHtmlWithKey()` (`src/server.js:122`), which injects `<meta name="x-app-key">` server-side. The dashboard JS (`public/js/shared.js`) reads via `resolveApiKey()` (meta first, localStorage fallback) and sends as `x-api-key` on every `apiCall()`.

### `tests/` — Jest suite

Mirrors `src/` plus an `api/`, `integration/`, and `helpers/` layout. Coverage is uneven — see [`.planning/codebase/CONCERNS.md`](CONCERNS.md) § Test Coverage Gaps. Pre-existing failing suites listed in [`.planning/codebase/TESTING.md`](TESTING.md) — do not "fix" them as a side effect of unrelated work.

## Key File Locations

**Entry points**

- `src/index.js` — license validate → start server → start cron.
- `src/background.js` — `forResponse` orchestration (also runnable standalone via `npm run background-only`).

**Config and singletons**

- `src/config.js` — single env loader with `validate()` + 4 range guards.
- `src/utils/SQLServerConnection.js` — mssql pool.
- `src/utils/PortalClient.js` — axios singleton.
- `src/utils/LogGenerator.js` — winston cache.

**Critical orchestration**

- `src/services/CronScheduler.js` — `initScheduler()`.
- `src/services/OperationManager.js` — concurrency lock + `lock:timeout`.
- `src/services/LicenseValidator.js` — HMAC validation cache.
- `src/background.js` — per-tenant 7-step loop.

## Naming Conventions

Quick reference (full version in [`.planning/codebase/CONVENTIONS.md`](CONVENTIONS.md)):

- **Controllers / services / models:** `PascalCase` filenames (`PortalOC_Creator.js`, `LicenseValidator.js`, `PurchaseOrder.js`).
- **Utilities:** `camelCase` or `PascalCase` depending on whether the file exports a function or a class-like singleton (`duration.js` vs `SQLServerConnection.js`).
- **Scripts:** `kebab-case` action-object (`payment-reconciliation.js`, `diagnose-sage-tables.js`).
- **Routes:** `kebab-case` area suffix `-routes.js`.
- **Tests:** `[Module].test.js` mirroring the source location.

## Where to Add New Code

| Adding... | Goes in | Notes |
|---|---|---|
| Cross-system workflow | `src/controller/[Feature]Controller.js` | Per-tenant entry function; returns Promise. |
| Cross-cutting service | `src/services/[Name]Service.js` (or just `[Name].js`) | Singleton-shaped. Initialize at module load. |
| Shared helper | `src/utils/[Helper].js` | Prefer pure functions. |
| One-shot script | `src/scripts/[verb-noun].js` | Return `ResultEnvelope`; don't `process.exit()`. |
| REST endpoint | Extend the appropriate `src/routes/*-routes.js` | Add schema to `src/routes/schemas/` if it accepts a body. |
| Joi schema | `src/routes/schemas/` for routes, `src/models/` for cross-cutting | Used via the `validate(schema)` middleware. |
| Test | `tests/<mirror-of-source>` | Jest; match the naming `[Module].test.js`. |

## Special Directories

- `logs/` — runtime winston output, structured `logs/sageconnect/YYYY-MM-DD/[Process].log`. Gitignored.
- `.planning/` — GSD workflow artifacts. **Tracked in the source repo** (excluded from dist).
- `dist/` — obfuscated output from `scripts/obfuscate.js`. Gitignored.
- `node_modules/`, `coverage/`, `*.log` — standard ignores.

## Removed Legacy

What used to be here and isn't anymore:

- `AutoShutdownService.js` — removed in v2.0 (always-on regime).
- `AUTO_TERMINATE` env var — same.
- `RunSageconnect.bat` — replaced by Servy service (`scripts/install-service.ps1`).
- `--web-only` mode — removed in v2.0.
- 5 split `.env*` files — consolidated to single `.env` in v1.1; `migrate-env.js` retained for one-time migration.

---

*Structure analysis: 2026-03-12 (initial), refreshed 2026-05-12 (post-v2.3).*
