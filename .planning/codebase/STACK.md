# Technology Stack

**Analysis Date:** 2026-03-12 (initial), refreshed 2026-05-12 (post-v2.3)

## Languages

- **JavaScript** (Node.js) — backend, services, controllers, utilities, dashboard JS.
- **HTML / CSS** — dashboard pages.
- **SQL** (T-SQL) — direct queries against Sage 300 + FESA SQL Server instances.
- **PowerShell** — production install (`scripts/install-service.ps1`) and log rotation (`scripts/Rotate-SageConnectLogs.ps1`).

## Runtime

- **Node.js** — production runs on 22.15.0 LTS (verified in `docs/DEPLOYMENT.md`). CI obfuscation runner uses Node 18 (`.github/workflows/obfuscate-deploy.yml`); the older runner is acceptable because obfuscation does not exercise runtime semantics. There is no `.nvmrc` file — developers should match production locally.
- **npm** — `package-lock.json` is committed and authoritative.
- **Windows Server** — production host. The CFDI import binary (`ImportaFacturasFocaltec.exe`) is Windows-only; the rest of the codebase is platform-agnostic and runs on macOS/Linux for development.

## Frameworks

**Core HTTP**

- `express@^4.21.1` — web server and routing.
- `helmet@^8.1.0` — security headers (CSP disabled for inline dashboard scripts).
- `cors@^2.8.6` — CORS middleware (allow-list of methods + `x-api-key`).
- `express-rate-limit@^7.5.1` — global 2000/15-min, write-limiter 10/min.

**Scheduling**

- `node-cron@^4.2.1` — internal cron, replaces Windows Task Scheduler. Used inside the always-on process with `noOverlap` and `OperationManager` locks.

**Validation**

- `joi@^17.13.3` — request body and configuration validation.

**Data**

- `mssql@^11.0.1` — SQL Server client. Wrapped by the singleton pool in `src/utils/SQLServerConnection.js`.
- `xml2js@^0.6.2` — CFDI XML parsing.

**HTTP client**

- `axios@^1.7.7` — wrapped by the singleton `PortalClient` (`src/utils/PortalClient.js`) with default 30 s timeout.

**Logging & notification**

- `winston@^3.17.0` — primary logger, file output via `src/utils/LogGenerator.js`.
- `log4js@^6.9.1` — legacy, used in a handful of scripts. Consolidation onto winston is a documented tech-debt item.
- `nodemailer@^6.9.16` — SMTP / Gmail OAuth email transport.
- `node-notifier@^10.0.1` — desktop notifications (kept for local-dev use only; the production Servy service has no desktop session so notifications are no-ops).

**Config**

- `dotenv@^16.4.5` — invoked exactly once inside `src/config.js`. All other code reads from the structured `config` object.

## Testing

- `jest@^29.7.0` — test runner.
- `babel-jest@^29.7.0` — Babel transformer for Jest.
- `supertest@^7.2.2` — HTTP assertions against the Express app in `tests/api/`.

## Build / Dev

- `@babel/core@^7.26.0`, `@babel/preset-env@^7.26.0` — transpile for Jest only; runtime uses Node directly without transpilation.
- `nodemon@^3.1.7` — `npm run dev` watcher.
- `javascript-obfuscator@^5.3.0` — driven by `scripts/obfuscate.js` in CI to produce the dist payload.

No ESLint, Prettier, EditorConfig, TypeScript, or coverage tooling is configured. Code review is the quality gate.

## Configuration

**Environment**

- **Single `.env` file** at the repo root (consolidated in v1.1; the pre-v1.1 split is no longer supported). `src/config.js` is the only entry point — never call `dotenv.config()` from any other file.
- Full template with inline section comments: [`.env.example`](../../.env.example).
- Fail-fast validation: missing required vars exit with `[CONFIG ERROR]`. Out-of-range timeout vars exit with `[CONFIG ERROR] ... must be >= ...`.

**Build / dev configs**

- `babel.config.js` — `@babel/preset-env` targeting current Node.
- `jest.config.js` — uses `babel-jest`; one custom `transform` entry, no `coverageThreshold`.
- `scripts/obfuscate.js` — driven by CI.

## Platform Requirements

**Development**

- Node 22.15.0 (recommended; 18+ works for `npm test`).
- A reachable SQL Server with credentials for at least one Sage 300 DB.
- (Optional) SMTP credentials, or `MAIL_TRANSPORT` left blank to skip the mailing section.
- (Required for full boot) A working license endpoint reachable at `LICENSE_API_URL`. Without it, `npm start` fails at boot — `npm test` and `npm run dev` (for code-only tasks) still work.

**Production**

- Windows Server (the CFDI import binary is Windows-only).
- Servy v7.0+ installed (`winget install servy`).
- Node 22.15.0 LTS.
- Network reachability:
  - Sage SQL Server (port 1433 typical).
  - `portaldeproveedores.mx` over HTTPS.
  - The SageConnect License Server (Vercel-hosted) over HTTPS.
  - SMTP server (if `MAIL_TRANSPORT=smtp`) or Gmail OAuth endpoints (if `MAIL_TRANSPORT=gmail`).
- Service account with read/write on the install directory and the log directories.

## Deployment

**Strategy**

The service runs as a Windows service named `SageConnect`, managed by [Servy](https://github.com/servy-dev/servy). PM2 was used in v1.x but was retired in v2.0 because of `wmic` bugs on Windows Server 2025. The Windows Task Scheduler + `RunSageconnect.bat` model from v1.0 is also gone (always-on regime).

**Pipeline**

1. Developer pushes to `master` (or any branch listed in `.github/workflows/obfuscate-deploy.yml`).
2. CI runs `npm ci` and `node scripts/obfuscate.js`.
3. CI commits `dist/` and **force-pushes** to `FReptar0/sageconnect-dist` (a separate repo, no shared history with this source repo).
4. On the production server, the operator runs `git fetch && git reset --hard origin/master` against the dist repo to consume the new build.
5. `Restart-Service SageConnect` cycles the service; Servy enforces a 30 s graceful stop before terminating.

Full procedure: [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md). Operator-facing runbook: [`docs/OPERATIONS.md`](../../docs/OPERATIONS.md).

**Not containerized.** There is no Dockerfile; the Windows-only child process pins the application to a Windows host.

## Entry Points (npm scripts)

```
"test":              "jest"
"start":             "node src/index.js"
"dev":               "nodemon src/index.js"
"background-only":   "node src/background.js"
"obfuscate":         "node scripts/obfuscate.js"
"obfuscate:push":    "node scripts/obfuscate.js --push"
```

`obfuscate` and `obfuscate:push` are CI-driven — running them manually is discouraged (the GitHub Action is the source of truth for the dist repo).

---

*Stack analysis: 2026-03-12 (initial), refreshed 2026-05-12 (post-v2.3).*
