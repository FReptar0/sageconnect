# SAGECONNECT

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/FReptar0/sageconnect)

**SAGECONNECT** is an always-on integration service between the **SAGE 300** ERP and the **portaldeproveedores.mx** API (Focaltec). It automates supplier registration, CFDI download, payment reconciliation, and purchase-order lifecycle management, and ships an operational web dashboard for monitoring and manual recovery. The current release (v2.3) runs as a Windows Service via [Servy](https://github.com/servy-dev/servy) with an internal `node-cron` scheduler (every 15 min by default), license-gated startup, and defense-in-depth timeouts (axios → step → child → lock).

> For a single-page architecture view: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
> To get a new developer productive on day one: [`docs/ONBOARDING.md`](docs/ONBOARDING.md).
> To work on this codebase with Claude Code: [`CLAUDE.md`](CLAUDE.md) and [`docs/CLAUDE_CODE.md`](docs/CLAUDE_CODE.md).

---

## Architecture at a glance

```
              ┌────────────────────────────────────────────────────────┐
              │  Servy (Windows Service "SageConnect")                 │
              │  ┌──────────────────────────────────────────────────┐  │
              │  │  Node.js 22.15  (single process, always-on)      │  │
              │  │                                                  │  │
              │  │   ┌──────────────┐    ┌──────────────────────┐   │  │
              │  │   │ Express :3030│    │ node-cron */15 * * * │   │  │
              │  │   │ /schedule    │    │ → forResponse()      │   │  │
              │  │   │ /payments    │    │   buildProviders     │   │  │
              │  │   │ /pos         │    │   downloadCFDI       │   │  │
              │  │   │ /logs        │    │   checkPayments      │   │  │
              │  │   │ /api/*       │    │   uploadPayments     │   │  │
              │  │   └──────┬───────┘    │   createPOs          │   │  │
              │  │          │            │   processChanges     │   │  │
              │  │          │            │   closePOs           │   │  │
              │  │          │            └──────┬───────────────┘   │  │
              │  │          ▼                   ▼                   │  │
              │  │   ┌──────────────────────────────────────────┐   │  │
              │  │   │  src/utils — singletons                  │   │  │
              │  │   │   • SQLServerConnection (mssql pool)     │   │  │
              │  │   │   • PortalClient (axios timeout=30s)     │   │  │
              │  │   │   • LogGenerator (winston cache)         │   │  │
              │  │   └──────┬─────────────────────┬─────────────┘   │  │
              │  │          │                     │                 │  │
              │  └──────────┼─────────────────────┼─────────────────┘  │
              └─────────────┼─────────────────────┼────────────────────┘
                            ▼                     ▼
                ┌──────────────────────┐   ┌─────────────────────────┐
                │  SQL Server          │   │  portaldeproveedores.mx │
                │  Sage 300 DB + FESA  │   │  Focaltec REST API      │
                └──────────────────────┘   └─────────────────────────┘
                                                      ▲
                                                      │ HMAC license check
                                                      │
                                            ┌──────────────────────┐
                                            │ SageConnect License  │
                                            │ Server (Vercel)      │
                                            └──────────────────────┘
```

Defense-in-depth timeouts (enforced at startup by `src/config.js` range guards):

```
axios (30s)  <  step (5m)  <  child (10m)  <  lock (14m)
```

Full architecture: [`.planning/codebase/ARCHITECTURE.md`](.planning/codebase/ARCHITECTURE.md). Always-on patterns and the bugs they fix: same file, section "Always-On Patterns (added 2026-04-27)".

---

## Required programs

- **Node.js 22.15.0** (LTS). Production server runs `node --version` → `v22.15.0`. Older versions may work for `npm test` but are not supported in production.
- **npm** (ships with Node).
- **Git**.
- **SQL Server** instance reachable from the dev/prod machine, with credentials for the Sage 300 database(s).
- **Servy** (Windows only) for production install. Not needed for local development.

---

## Installation

```bash
git clone https://github.com/FReptar0/sageconnect
cd sageconnect
npm install
```

For production deployment on Windows Server (Servy + service install), follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — do not run the steps below in production.

---

## Configuration Setup

All configuration lives in a **single `.env` file** at the repo root (unified since v1.1). It is read once at startup through `src/config.js`, which fail-fasts on any missing required variable.

### 1. Copy the example

```bash
cp .env.example .env
```

### 2. Edit `.env`

The file is organized by section. The mandatory groups are **DATABASE**, **PORTAL**, **PATHS**, **APP**, and **LICENSE**. **MAILING**, **SECURITY** (`SAGECONNECT_API_KEY`), and **SCHEDULE** (timeout overrides) are optional.

### 3. Validate

```bash
node -e "require('./src/config')"
```

If any required variable is missing the process exits 1 with `[CONFIG ERROR]: Missing required environment variables` and a list. There is also a Claude Code slash command `/env-check` that wraps this validation.

> :warning: Never commit `.env`. Only `.env.example` belongs in git.

> :information_source: **Migrating from v1.0 (5 separate `.env*` files)?** Run `node scripts/migrate-env.js` once on the server. It consolidates the legacy files into the unified `.env`, applies renames (`USER` → `DB_USER`, `PATH` → `DOWNLOADS_PATH`), backs up originals to `.env.legacy/`, and exits. After that, the script is no longer needed.

---

## Environment Variables

The tables below cover the most-edited variables. See [`.env.example`](.env.example) for the full template with inline comments.

### Database

| Variable | Description | Example |
| :---: | :---: | :---: |
| `DB_USER` | SQL Server username | `your_db_user` |
| `DB_PASSWORD` | SQL Server password | `your_db_password` |
| `SERVER` | SQL Server hostname | `your_sql_server_host` |
| `DATABASE` | Default database name | `YOUR_DATABASE_NAME` |

> `DB_USER` / `DB_PASSWORD` were renamed from `USER` / `PASSWORD` in v1.1 to avoid collision with OS env vars. The Sage 300 database name is set via `DATABASE`; per-tenant overrides live in `DATABASES` (Portal section).

### Portal (Focaltec)

| Variable | Description | Example |
| :---: | :---: | :---: |
| `URL` | Portal API base URL | `https://api.portaldeproveedores.mx` |
| `TENANT_ID` | Tenant IDs (comma-separated for multi-tenant) | `tenant1,tenant2` |
| `API_KEY` | API keys (same index as `TENANT_ID`) | `key1,key2` |
| `API_SECRET` | API secrets (same index) | `secret1,secret2` |
| `DATABASES` | Sage DB per tenant (same index) | `DB1,DB2` |
| `EXTERNAL_IDS` | RFCs per tenant (same index) | `RFC1,RFC2` |
| `PORTAL_HTTP_TIMEOUT_MS` (optional) | axios timeout for the portal client. Default `30000`. Min `1000`. | `30000` |

> All multi-tenant arrays must align by position. The first `API_KEY` belongs to the first `TENANT_ID`, etc.

### Mailing (optional)

Email is fully optional. If `MAIL_TRANSPORT` is empty, the mailing section is skipped at config build. `MAIL_TRANSPORT=smtp` uses `eFrom` / `ePass` / `eServer` / `ePuerto` / `eSSL` / `MAILING_NOTICES` / `MAILING_CC`. `MAIL_TRANSPORT=gmail` uses `CLIENT_ID` / `SECRET_CLIENT` / `REFRESH_TOKEN` / `REDIRECT_URI`. See `.env.example` for the full set and the Gmail OAuth flow.

### Paths

| Variable | Description | Example |
| :---: | :---: | :---: |
| `DOWNLOADS_PATH` | Where CFDI files land | `./downloads` |
| `PROVIDERS_PATH` | Provider XML staging | `./downloads/providers` |
| `LOG_PATH` | Base for date-stamped logs | `./logs` |

### App

| Variable | Description |
| :---: | :---: |
| `IMPORT_CFDIS_ROUTE` | Path to `ImportaFacturasFocaltec.exe` (Sage import binary). |
| `ARG` | Sage 300 DB name passed to the import binary. |
| `NOMBRE`, `RFC`, `REGIMEN` | Company identity for invoice headers. |
| `TIMEZONE` | IANA TZ identifier (e.g. `America/Mexico_City`). Used by `node-cron` and `TimezoneHelper`. |
| `DEFAULT_ADDRESS_*` | Fallback fields used when Sage ICLOC has no address row. |
| `ADDRESS_IDENTIFIERS_SKIP` | Location IDs to exclude (comma-separated). |

### Security & Schedule

| Variable | Description |
| :---: | :---: |
| `SAGECONNECT_API_KEY` (optional but recommended) | Dual-purpose: enables dashboard `requireApiKey` middleware **and** identifies this client to the license server. The dashboard receives it via server-side `<meta name="x-app-key">` injection — operators never paste it. Leaving it unset disables API key protection (`[CONFIG WARN]` at startup). |
| `CRON_SCHEDULE` (optional) | Cron expression for the background cycle. Default `*/15 * * * *`. |
| `OPERATION_DELAY_MS` (optional) | Inter-step delay inside `forResponse`. Default `5000`. |
| `LOCK_TIMEOUT_MS` (optional) | OperationManager lock auto-release. Default `840000` (14 min). Min `60000`. |
| `CHILD_PROCESS_TIMEOUT_MS` (optional) | SIGTERM-then-`taskkill` cascade for the CFDI import binary. Default `600000` (10 min). Min `60000`. |
| `STEP_TIMEOUT_MS` (optional) | Per-step `Promise.race` budget inside `forResponse`. Default `300000` (5 min). Min `30000`. |

### License

| Variable | Description |
| :---: | :---: |
| `LICENSE_API_URL` | SageConnect License Server endpoint. |
| `HMAC_SECRET` | Shared secret for response signature verification. |
| `LICENSE_ADMIN_EMAIL` | Admin recipient for license alerts (revocation, child-process timeouts). |

The service runs `validate({startup: true})` at boot and exits 1 if the license is unreachable or invalid. See [`SECURITY.md`](SECURITY.md) § License Validation for the full model.

---

## Preserving local environment files

The `.env` file is not tracked by git (see `.gitignore`). If you need to keep an existing local copy across `git pull`/`git merge`, the standard trick is:

```bash
git update-index --skip-worktree .env
```

---

## Running locally

| Command | What it does |
|---------|--------------|
| `npm test` | Run the Jest suite (~200 tests). A handful of pre-existing failures are tolerated — see [`.planning/codebase/TESTING.md`](.planning/codebase/TESTING.md). |
| `npm start` | Boot the full service (Express + cron + license validation) on port 3030. |
| `npm run dev` | Same, under `nodemon`. |
| `npm run background-only` | Run only the cron / `forResponse` orchestration, no Express. |

---

## Web Dashboard

Once `npm start` is running, visit `http://localhost:3030/`. The root redirects to `/schedule.html`.

| Page | Purpose |
|------|---------|
| `/schedule.html` | Home. Cron schedule, last/next run, "Operación en curso" card with 5s polling + 1s heartbeat ticker, manual "Ejecutar Ahora" and "Forzar liberación" (when stuck). |
| `/payments.html` | Payment reconciliation audit, drill-down on the 5 classification categories. |
| `/pos.html` | Purchase-order diagnostics, "Cambiar Estado OC" (Abierta/Cerrada/Cancelada/Generada). |
| `/logs.html` | Per-date, per-process log viewer (winston files surfaced via the dashboard API). |

Each page receives the dashboard API key via a server-injected `<meta name="x-app-key">` tag (see `src/server.js` `serveHtmlWithKey()`). Operators do not configure anything in the browser.

---

## API Endpoints

The HTTP layer mounts six route files under one router (`src/routes/routes.js`):

| Mount | License-gated? | API key required? | What it covers |
|-------|----------------|-------------------|----------------|
| `/` (dashboard pages) | No | No | Static HTML + server-injected meta key. |
| `/api/system` | No | No | Health, tenants list, license status, system probes. |
| `/api/schedule` | Yes | No | Cron schedule, manual trigger, history, force-release. |
| `/api/operations` | Yes | No | Live operation status (the dashboard polls this every 5s). |
| `/api/payments` | Yes | Yes (`x-api-key`) | Payment reconciliation read/write endpoints. |
| `/api/pos` | Yes | Yes (`x-api-key`) | Purchase-order read/write endpoints. |

The current shape is 17 REST endpoints (7 payment + 9 PO + force-release) plus 6 system endpoints. For the full spec see [`src/routes/routes.js`](src/routes/routes.js) and the individual `*-routes.js` files; the upstream Focaltec spec extract lives at [`.planning/codebase/API-SPEC.md`](.planning/codebase/API-SPEC.md).

---

## License (the service license, not the source code license)

The running service requires a valid license from the **SageConnect License Server**. Without one, `npm start` exits at boot:

```
[LICENSE] Startup blocked -- license inactive
```

Required `.env` keys: `LICENSE_API_URL`, `HMAC_SECRET`, `LICENSE_ADMIN_EMAIL`. The validator uses HMAC-SHA256 over the response, enforces 5-minute timestamp freshness (anti-replay), maintains a three-state cache (VALID / INVALID / ERROR, 24 h TTL), and detects DNS bypass via `dns.resolve4()`. License revocations and child-process timeouts dispatch alerts to `LICENSE_ADMIN_EMAIL`.

Source-code license / EULA — see [`LICENSE.md`](LICENSE.md), [`EULA-en.md`](EULA-en.md) (English, controlling), [`EULA-es.md`](EULA-es.md) (Spanish courtesy).

---

## Deployment

Production runs on Windows Server with Servy as the service manager. The full procedure — installing Servy, running `scripts/install-service.ps1` as Administrator, verifying the health endpoint, rolling back, troubleshooting — lives in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). For the operator-facing day-to-day (logs, restart, when to call the dev), see [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

Obfuscation is automated: pushing to `master` triggers `.github/workflows/obfuscate-deploy.yml`, which runs `node scripts/obfuscate.js` and force-pushes the obfuscated output to the separate distribution repo `FReptar0/sageconnect-dist`. Do not run `npm run obfuscate` manually for a real deploy — the GitHub Action is the source of truth.

---

## Onboarding

If this is your first day on the project, start at [`docs/ONBOARDING.md`](docs/ONBOARDING.md). It walks you through clone → `.env` → `npm install` → `npm test` → first dashboard render, with the standard "if X fails, look here" troubleshooting table.

---

## Working with Claude Code

This repo is set up for development with [Claude Code](https://docs.claude.com/en/docs/claude-code/):

- [`CLAUDE.md`](CLAUDE.md) — auto-loaded memory: always-on constraint, conventions, pitfalls, critical files, defense-in-depth invariant.
- [`.claude/settings.json`](.claude/settings.json) — committed hooks (`SessionStart`, `Stop`) and a conservative permissions allowlist. Personal overrides go in `.claude/settings.local.json` (gitignored).
- [`.claude/commands/`](.claude/commands/) — slash commands: `/test`, `/env-check`, `/diagnose`, `/deploy-checklist`.
- [`docs/CLAUDE_CODE.md`](docs/CLAUDE_CODE.md) — how to use Claude Code productively in this codebase (hooks, commands, subagents, best practices observed).

---

## Contributing & security

- Contributing model, branch naming, PR checklist: [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Security policy, supported versions, vulnerability reporting: [`SECURITY.md`](SECURITY.md).
- Code of conduct: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

For private security disclosures, email <hi@fernandomemije.dev> — do not open a public issue.
