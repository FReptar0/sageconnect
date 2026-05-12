# Onboarding — your first day on SageConnect

This is the day-1 walk-through for a new developer. Follow it in order; it ends with you having a passing test run and the dashboard open in a browser. If something fails, jump to the troubleshooting table at the bottom.

## 0. Before you start

Confirm you have:

- **Node.js 22.15.0** (`node --version`). Older versions may work for `npm test` but not for `npm start`. There is no `.nvmrc`; install the right version manually.
- **npm** (`npm --version`, ships with Node).
- **Git**.
- Access to a SQL Server with credentials for at least one Sage 300 database — this is **mandatory** for `npm start`. Without it, the service boots until the first SQL query and then errors.
- (Optional but recommended) Network reachability to `https://api-sandbox.portaldeproveedores.mx` for a sandbox tenant.

If you don't have SQL or portal access yet, you can still do steps 1–4 (clone, install, tests). The full boot in step 5 will require the credentials.

## 1. Clone and install

```bash
git clone https://github.com/FReptar0/sageconnect.git
cd sageconnect
npm install
```

Expected: `node_modules/` populates without errors. A handful of `deprecated` warnings from transitive dependencies is normal.

## 2. Configure `.env`

```bash
cp .env.example .env
```

Open `.env` in your editor and fill in:

- **DATABASE** — `DB_USER`, `DB_PASSWORD`, `SERVER`, `DATABASE`.
- **PORTAL** — `URL`, `TENANT_ID`, `API_KEY`, `API_SECRET`, `DATABASES`, `EXTERNAL_IDS`. For a sandbox tenant ask the maintainer; comma-separate values if you have multiple tenants.
- **PATHS** — leave the defaults (`./downloads`, `./downloads/providers`, `./logs`) unless you have a reason to change them.
- **APP** — `IMPORT_CFDIS_ROUTE`, `ARG`, `NOMBRE`, `RFC`, `REGIMEN`, `TIMEZONE`, all 7 `DEFAULT_ADDRESS_*`, `ADDRESS_IDENTIFIERS_SKIP`. On macOS / Linux for dev only, `IMPORT_CFDIS_ROUTE` can be a non-existent Windows path — the cron tick will fail loudly when it tries to spawn the binary, but the service will start.
- **LICENSE** — `LICENSE_API_URL`, `HMAC_SECRET`, `LICENSE_ADMIN_EMAIL`. Without a valid license endpoint, `npm start` exits at boot. Talk to the maintainer about a dev/staging license token.
- **SECURITY** — set `SAGECONNECT_API_KEY` to any non-empty string. The dashboard middleware will accept whatever you pick. Leaving it blank disables `requireApiKey` but you'll see a `[CONFIG WARN]` at startup.
- **MAILING** — leave `MAIL_TRANSPORT` blank to skip mailing entirely. The service runs fine without email.
- **SCHEDULE** — leave defaults. You can shorten `CRON_SCHEDULE` to `*/2 * * * *` if you want faster cycle for local debugging.

## 3. Validate config

```bash
node -e "require('./src/config')"
```

Expected: no output. If config validation fails, you'll see `[CONFIG ERROR] Missing required environment variables:` followed by the list. Fill those in and re-run.

The Claude Code slash command `/env-check` wraps this with a nicer summary.

## 4. Run the tests

```bash
npm test
```

Expected: ~200 tests run; **~7 pre-existing failures** in `PaymentReconciliation.test.js`, `TransformTime.test.js`, `no-process-exit.test.js`, `enforcement-wiring.test.js` are normal baseline noise. They predate v2.3 and are documented in [`.planning/codebase/TESTING.md`](../.planning/codebase/TESTING.md). Any *additional* failures point at an environment problem (typically a Node version mismatch or a missing `.env` key).

The Claude Code slash command `/test` wraps this and helps separate new failures from baseline.

## 5. Boot the service locally

```bash
npm run dev
```

Expected output, in order:

```
[LICENSE] Valid -- expires 2027-...
El servidor se inició correctamente en el puerto 3030
[CRON] Scheduler initialized -- background cycle runs on schedule
```

Then visit:

- `http://localhost:3030/` — redirects to `/schedule.html`.
- `http://localhost:3030/api/system/health` — should return `{"status":"ok",...}`.

If you set `CRON_SCHEDULE=*/2 * * * *` you'll see the first cycle fire within two minutes; otherwise the default `*/15` waits up to 15 min. The dashboard's "Operación en curso" card is the visual confirmation that the cycle is running.

## 6. Make your first change

Read [`CLAUDE.md`](../CLAUDE.md) — especially §3 (always-on constraint) and §6 (pitfalls). Then open a feature branch:

```bash
git checkout -b feat/your-first-change
```

Touch the code you want to change. Run `/test` (or `npm test`) after each non-trivial step. When you're happy, follow the PR workflow in [`CONTRIBUTING.md`](../CONTRIBUTING.md) § 6.

## 7. Working with Claude Code

See [`CLAUDE_CODE.md`](CLAUDE_CODE.md) for the full guide. Quick-start:

- `CLAUDE.md` at the repo root is auto-loaded every session — it carries the always-on rules and the file:line refs to the critical modules.
- Slash commands available: `/test`, `/env-check`, `/diagnose`, `/deploy-checklist`.
- Hooks: `SessionStart` (npm install on fresh checkouts) and `Stop` (reminder when you have uncommitted/unpushed changes). Both live in `.claude/hooks/`. Disable by editing `.claude/settings.json` or overriding in `.claude/settings.local.json`.

## Troubleshooting (if X fails)

| Symptom | Most likely cause | Where to look |
|---------|-------------------|---------------|
| `[CONFIG ERROR] Missing required environment variables` | A required key is missing from `.env`. | The error message names them. Cross-reference [`.env.example`](../.env.example). |
| `[LICENSE] Startup blocked -- license inactive` | `LICENSE_API_URL` unreachable, `HMAC_SECRET` wrong, or the license itself is invalid. | Ping the URL from `curl`. Verify `HMAC_SECRET` with the maintainer. |
| `Error connecting to SQL Server` | `SERVER` unreachable or `DB_USER` / `DB_PASSWORD` wrong. | `telnet $SERVER 1433`, verify credentials in SSMS. |
| Tests fail with `Cannot find module 'X'` | `node_modules` is stale. | `rm -rf node_modules package-lock.json && npm install`. |
| Tests fail in `*.test.js` files you didn't touch | Pre-existing baseline failure, not your bug. | Check [`.planning/codebase/TESTING.md`](../.planning/codebase/TESTING.md) for the documented set. |
| `EADDRINUSE :::3030` | Another `npm start` or `nodemon` is still running. | `lsof -i :3030` (mac/Linux) or `netstat -ano \| findstr :3030` (Windows), then kill it. |
| Cron tick fails with `spawn ENOENT ImportaFacturasFocaltec.exe` | Running on macOS/Linux without the Windows binary. | Expected for non-Windows dev; the rest of the cycle still runs after the failure logs. |
| Dashboard `/schedule.html` shows "Licencia inactiva" red banner | License state is INVALID or ERROR. | Same as the `[LICENSE]` startup error — check the validator config. |
| `[CONFIG WARN] SAGECONNECT_API_KEY not set` and `requireApiKey` blocks you | Self-imposed — set the key in `.env` or accept the warning. | `.env` `SECURITY` section. |

## What to read next

In order, depending on what you're about to work on:

1. [`CLAUDE.md`](../CLAUDE.md) — read entirely; it's the daily-reference.
2. [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — single-page architecture.
3. [`.planning/codebase/ARCHITECTURE.md`](../.planning/codebase/ARCHITECTURE.md) — full architecture, especially § Always-On Patterns.
4. [`.planning/codebase/CONCERNS.md`](../.planning/codebase/CONCERNS.md) — tech debt, fragile areas, things to be careful around.
5. [`.planning/forensics/report-20260427-220000.md`](../.planning/forensics/report-20260427-220000.md) — the always-on failure cascade. Recommended reading before touching `OperationManager`, `CronScheduler`, `background.js`, or any module that retains state.
6. [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) — only when you're shipping. Don't deploy without reading it.
