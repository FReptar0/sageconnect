# CLAUDE.md — SageConnect

This file is loaded automatically by Claude Code at the start of every session in this repo. Keep it short; link out for depth.

## 0. Production-safety policy (READ FIRST)

This codebase ships obfuscated builds to production. There is no staging environment that exercises the real Sage 300 ↔ Focaltec integration; there is no rollback that doesn't impact the customer; there is no easy path — only the path that doesn't compromise the customer's payment data. Treat every change as production-bound.

**Engagement rules — do not deviate without the user's explicit consent:**

1. **Ask before every non-trivial action.** Default mode is "pause and confirm" — not "act and report". A non-trivial action is any of:
   - `Edit` or `Write` on `src/**`, `tests/**`, `.env*`, `package.json`, `scripts/**`, `.github/**`, `.claude/**`, `CLAUDE.md`, `HANDOFF.md`.
   - Any `Bash` beyond the read-only allowlist in `.claude/settings.json` (anything that mutates the filesystem, the git state, the database, or the network).
   - Any `git commit`, `git push`, `git reset --hard`, `git rebase`, `git stash`, branch creation or deletion.
   - Spawning a sub-agent, opening a worktree, or invoking a Skill that writes files.
   - Anything that touches the dist repo or the production server.
2. **State what you're about to do, in one sentence, before the tool call.** If the user hasn't agreed, do not proceed.
3. **Never assume completion.** When investigating payment / CFDI / PO state, verify **both** the Focaltec portal **and** the local control table (`fesa.dbo.fesaPagosFocaltec` or analogous) before declaring anything "resuelto". See [`HANDOFF.md`](HANDOFF.md) § 7 for the worked example.
4. **Best practices over speed.** This codebase has documented pitfalls (§ 6 below) and an always-on regime (§ 3) that punish shortcuts within hours of deploy. If the cleanest path takes three steps, propose three steps; don't collapse to one.
5. **GSD is mandatory for non-trivial work.** See § 12 below. A bug fix can be a quick task; anything larger goes through `/gsd-spec-phase` → `/gsd-discuss-phase` → `/gsd-plan-phase` → `/gsd-execute-phase`.
6. **Read [`HANDOFF.md`](HANDOFF.md) before your first commit.** It carries non-derivable rules: no third-party names, license-server language discipline (HANDOFF.md § 2), production paths, `.planning/` tracking, commit hygiene. Re-read § 1 and § 4 before every commit.

If the user asks for autonomy (`"adelante sin preguntarme"`, `--yolo`, plan mode approval), the autonomy applies only to the scope explicitly named in that exchange. It does not carry across turns and does not extend to operations outside the named scope.

## 1. What this is

SageConnect is an always-on Windows Service that integrates **Sage 300 ERP** with **portaldeproveedores.mx** (Focaltec). It downloads CFDIs (Mexican electronic invoices), reconciles payments, manages purchase-order lifecycle, and exposes an operational web dashboard. Runs as the `SageConnect` Windows service via [Servy](https://github.com/servy-dev/servy) with an internal `node-cron` scheduler (every 15 min by default).

Full project context: `.planning/PROJECT.md`. Current state and last activity: `.planning/STATE.md`.

## 2. Current state

- **Version:** v2.3 (shipped 2026-04-29). Milestone history in `.planning/MILESTONES.md`.
- **Runtime:** Node.js 22.15.0 on Windows Server, Servy-managed, port 3030.
- **Licensing:** Service validates against the SageConnect License Server (HMAC-SHA256, anti-replay, 3-state cache). Startup fails fast if the license is invalid.
- **API surface:** 17 REST endpoints (7 payment + 9 PO + force-release) + 6 system endpoints (health, tenants, license, schedule, history, operations). Mount table at `src/routes/routes.js`.
- **Dashboard:** 4 HTML pages (`/schedule.html`, `/payments.html`, `/pos.html`, `/logs.html`), API key injected server-side via `<meta name="x-app-key">` — operators never paste it.
- **Defense-in-depth timeouts:** axios (30s) < step (5m) < child (10m) < lock (14m). Breaking this order = bug.

## 3. Always-on constraint (READ THIS BEFORE WRITING CODE)

**The service never exits between cron ticks.** Every primitive that retains state — file descriptors, listeners, pools, timers, module-scope caches — must explicitly bound its lifetime. The batch-era assumption that "the process will exit and clean up" is **always wrong** here.

Concrete patterns established in the codebase (and the bugs they fix):

| Pattern | File | What it solves |
|---------|------|----------------|
| Winston logger cache keyed by `${date}\|${fileName}` | `src/utils/LogGenerator.js` | EMFILE: every `logGenerator()` call used to create a new File transport without closing it. |
| Singleton SQL pool + always-prepend `USE [DB]` | `src/utils/SQLServerConnection.js` | Pool reuse across DBs retained prior `USE` state and silently routed queries to the wrong DB. |
| Singleton axios client with 30s timeout | `src/utils/PortalClient.js` | 18 axios call sites in 9 files now share one timeout policy. |
| Auto-release timer + `lock:timeout` event | `src/services/OperationManager.js` | Stuck locks orphaned by phantom continuation auto-clear after 14 min. |
| `Promise.race` step wrapper | `src/utils/duration.js` `withStepTimeout()` | Per-step 5-min budget in `forResponse`. |
| Child-process kill cascade SIGTERM → 30s grace → `taskkill /F /T` | `src/background.js` `startChildProcess()` | Servy has no desktop session — child GUIs hang invisibly without OS-level kill. |

Worked example of what happens when you forget: `.planning/forensics/report-20260427-220000.md` (5 always-on bugs in 1h56m post-deploy). Background context for the constraint itself: `.planning/codebase/ARCHITECTURE.md` § "Always-On Patterns".

**Rule of thumb for any new code:** before adding a `setInterval`, `setTimeout`, EventEmitter listener, module-scope `Map`/`Set`, or `child_process.spawn`, write down how it gets cleaned up. If you can't say, it leaks.

## 4. Essential commands

| Command | What it does |
|---------|--------------|
| `npm test` | Run Jest suite (~200 tests). Some pre-existing failures are tolerated — see §6. |
| `npm start` | Boot the full service (web + cron + license validation) on port 3030. |
| `npm run dev` | Same, under `nodemon`, auto-reload on changes. |
| `npm run background-only` | Run only `src/background.js` (no Express). Useful for testing cron logic in isolation. |
| `npm run obfuscate` | Build obfuscated `dist/` (normally done by CI, not locally — see §10). |
| `node -e "require('./src/config')"` | Validate `.env` loads. Exits 1 with `[CONFIG ERROR]` if anything required is missing. |

Slash commands: `/test`, `/env-check`, `/diagnose`, `/deploy-checklist` (defined in `.claude/commands/`).

## 5. Conventions (skim, then read `.planning/codebase/CONVENTIONS.md`)

- **Indentation:** 4 spaces. No ESLint/Prettier configured — code review is the quality gate.
- **Module system:** CommonJS only (`require` / `module.exports`). No ESM.
- **Config access:** `const config = require('./config')` everywhere. **Never** call `dotenv.config()` directly — `src/config.js` is the single entry point and it fail-fasts on missing vars.
- **Logging:** `logGenerator(LOG_FILE, 'info'|'warn'|'error', message)`. Define `const LOG_FILE = 'ModuleName'` at module top. **Do not** use bare `console.log` for anything that needs to survive a restart — winston files are the audit trail.
- **Tenant threading:** all multi-tenant code accepts a tenant index `i` and reads `config.portal.tenants[i].{id,key,secret,database,externalId}`.

## 6. Pitfalls (the three most expensive)

1. **SQL injection via template literals.** Pattern is established codebase-wide (`runQuery(\`SELECT * FROM x WHERE id = '${id}'\`)`). Don't add new sites; when you touch existing ones, parameterize if possible. Full list of vulnerable files: `.planning/codebase/CONCERNS.md` § Tech Debt.
2. **`runQuery(query, db = config.database.database)` implicit default.** PR #16 changed this default and broke 7 callers that depended on the old literal `'FESA'`; PR #19 fixed them. When the target DB is not the default (`config.database.database`, the Sage 300 DB), **pass `db` explicitly**. Audit before any signature change to shared utils.
3. **Pre-existing failing tests.** ~7 tests fail before you touch anything: `PaymentReconciliation`, `TransformTime`, `no-process-exit` (range guard count), `enforcement-wiring`. Treat them as baseline noise; `npm test` should report the same set after your change. If a *new* failure appears, that's your bug.

## 7. Where to put new code

| Need | Location | Pattern |
|------|----------|---------|
| Business workflow orchestration | `src/controller/[Feature]Controller.js` | Functions accept tenant index `i`, return Promise. |
| Cross-cutting service | `src/services/[Feature]Service.js` | Module exports object; singleton-like (initialized at module load). |
| Shared helper | `src/utils/[Helper].js` | Pure functions where possible. |
| One-shot diagnostic / repair | `src/scripts/[verb-noun].js` | Operator runs via `node src/scripts/<file>.js`. Returns `ResultEnvelope`. |
| REST endpoint | `src/routes/[area]-routes.js` (existing 6 areas: dashboard, system, schedule, operations, payment, po) | Mounted in `src/routes/routes.js` with `requireLicense` + optional `requireApiKey`. |
| Joi schema | `src/routes/schemas/` or `src/models/PurchaseOrder.js` | `validate(schema)` middleware. |
| Test | `tests/` mirror of source | `[Module].test.js`, Jest. |

## 8. Critical files (file:line refs)

- `src/index.js:10` — Async IIFE entry: `validate({startup:true})` → `startServer(3030)` → `initScheduler()`.
- `src/config.js:36` — `validate()` checks `REQUIRED` env vars and exits 1 on missing. Four range guards at L186-208 (lock/http/child/step timeouts).
- `src/server.js:122` — `serveHtmlWithKey()` injects `<meta x-app-key>` server-side. Wired routes at L143-146.
- `src/server.js:39` — Global `/api` rate limit (2000 / 15 min). Write limiter (10 / min) at L58.
- `src/background.js:28` — `forResponse(options)`: orchestrates the 7 steps per tenant. Each step wrapped in `withStepTimeout()`.
- `src/services/CronScheduler.js:55` — `initScheduler()` registers the cron task and `lock:timeout` listener.
- `src/services/OperationManager.js` — Concurrency lock + `stepProgress` array slot + `lock:timeout` EventEmitter.
- `src/services/LicenseValidator.js` — HMAC validation, 3-state cache, DNS bypass detection.
- `src/utils/SQLServerConnection.js` — Singleton mssql pool + `runQuery(query, database = config.database.database)`.
- `src/utils/PortalClient.js` — Singleton `axios.create({timeout: 30000})`.
- `src/utils/duration.js` — `withStepTimeout(promise, ms, context)` Promise.race wrapper; sentinel string `'Step timeout'` is **load-bearing** (regex-detected in log routing).
- `src/utils/AdminEmailSender.js` — `sendAdminAlert(subject, html, callerLogFile)` — extracted via PATTERNS.md §S-6 3rd-use trigger (quick 260502-i7l).
- `src/routes/routes.js` — Top-level mount: unlicensed (dashboard, system) → licensed (schedule, operations) → licensed + API key (payments, pos).

## 9. Defense-in-depth invariant (do not break)

```
axios (30s)  <  probe budget (2m)  <  step (5m)  <  child (10m)  <  lock (14m)
```

- `PORTAL_HTTP_TIMEOUT_MS` (default 30s) — aborts individual HTTP requests.
- `PORTAL_PROBE_BUDGET_MS` (default 2m) — per-tick elapsed-time budget for the portal existence probe in `createPurchaseOrders`; paired with `PORTAL_PROBE_MAX_PER_TICK` (default 50). Added in Phase 20.4.
- `STEP_TIMEOUT_MS` (default 5m) — wraps each of the 7 forResponse steps in `Promise.race`.
- `CHILD_PROCESS_TIMEOUT_MS` (default 10m) — triggers SIGTERM → 30s grace → `taskkill /F /T` on `ImportaFacturasFocaltec.exe`.
- `LOCK_TIMEOUT_MS` (default 14m = ~93% of 15-min cron cadence) — auto-release on `OperationManager` lock, emits `lock:timeout`.

Every tier has a **floor** guard at startup — values below the minimum exit 1. The probe budget additionally has two **relational** guards, the only ones in the file: it must be `> PORTAL_HTTP_TIMEOUT_MS` (below one axios timeout the probe collapses to a single OC per tick) and `<= 50% of STEP_TIMEOUT_MS`. They live in the guard block that runs from the `LOCK_TIMEOUT_MS` check to the end of `src/config.js` — deliberately not cited by line number, because the block grows and a stale range is how this section came to omit an entire tier.

**What the budget does and does not promise** (corrected in Phase 20.4 after the code review): it bounds how much *probing* one tick performs. It does **not** bound the step — `STEP_TIMEOUT_MS` remains the outer bound. An OC already admitted past the budget check can still overshoot by its own tail: GET 30s + POST 30s + the 180s `requestTimeout` at `src/utils/SQLServerConnection.js:18`. Reserving that tail would force the budget to ≤ 60s, which throttles a healthy portal to ~2 probes per tick — worse than the problem it solves. The arithmetic lives in exactly one place, the relational guard's comment in `src/config.js`; do not restate it elsewhere.

If you change any tier, verify the others still bound it strictly. Phase 19 RETROSPECTIVE has the rationale; Phase 20.4's `20.4-REVIEW.md` has the worked failure cases.

## 10. Workflow & deploy

- **Active branch:** `master`. Feature work in `feat/<short-desc>`, hotfixes in `hotfix/<short-desc>`. PR into `master`.
- **CI:** `.github/workflows/obfuscate-deploy.yml` triggers on push to `master` (or `feat/always-on-service`). Runs `npm ci` → `node scripts/obfuscate.js` → force-pushes `dist/` to `FReptar0/sageconnect-dist`. No tests, no linting in CI (run `npm test` locally before merging).
- **Production deploy:** the obfuscated repo is what's installed at `E:\sageconnect-dist\` on the Windows server (`ZCL-RDS-02` for the Capstone deployment). Operator does `git fetch && git reset --hard origin/master` against the **dist** repo — never `git pull`, because the dist is force-pushed by CI. Full procedure: `docs/DEPLOYMENT.md`. Operational identifiers (paths, server names, COPDAT immutable DB): `HANDOFF.md` § 5.
- **Never run** `node scripts/obfuscate.js` manually for a real deploy — the GitHub Action is the source of truth.

## 11. Pointers (for depth)

| Topic | File |
|-------|------|
| **Non-derivable rules (read once before first commit)** | **`HANDOFF.md`** |
| Vision, scope, key decisions (147 entries) | `.planning/PROJECT.md` |
| Current cycle / what's open | `.planning/STATE.md` |
| Milestone history | `.planning/MILESTONES.md` |
| Layered architecture + always-on patterns | `.planning/codebase/ARCHITECTURE.md` |
| Tech debt, security risks, fragile areas | `.planning/codebase/CONCERNS.md` |
| Naming, formatting, logging, error-handling style | `.planning/codebase/CONVENTIONS.md` |
| Test patterns and known-failing suites | `.planning/codebase/TESTING.md` |
| Worked example of always-on failure cascade | `.planning/forensics/report-20260427-220000.md` |
| Production deploy (Servy on Windows) | `docs/DEPLOYMENT.md` |
| Operator runbook | `docs/OPERATIONS.md` |
| Day-1 onboarding for new devs | `docs/ONBOARDING.md` |
| How to work with Claude Code in this repo | `docs/CLAUDE_CODE.md` |
| Single-page architecture view | `docs/ARCHITECTURE.md` |

## 12. GSD is mandatory for non-trivial work

This codebase uses **GSD** (Get Shit Done) — a planning skill suite that turns every non-trivial change into a tracked phase under `.planning/phases/<NN>-<slug>/`. The skill provides `/gsd-spec-phase`, `/gsd-discuss-phase`, `/gsd-plan-phase`, `/gsd-execute-phase`, `/gsd-verify-work`, and others (see `/gsd-help`). The existing `.planning/` tree is the institutional memory of every prior phase and milestone.

**When to use GSD:**

| Change size | Path |
|---|---|
| Typo, comment, doc tweak | Direct edit + commit. No GSD. |
| Single-file bug fix with obvious diff | `/gsd-quick` or direct edit; commit message references the bug. No formal phase needed. |
| Anything else — multi-file change, new feature, new env var, schema change, refactor, new dependency, security work, new endpoint | **Required:** `/gsd-spec-phase` → `/gsd-discuss-phase` → `/gsd-plan-phase` → `/gsd-execute-phase`. Phase artifacts land in `.planning/phases/<NN>-<slug>/`. |

**Why mandatory:** the always-on regime, the SQL injection pattern density, the implicit-default trap in `runQuery`, and the obfuscation-to-prod pipeline mean small mistakes have outsized blast radius. The GSD spec/discuss/plan loop catches assumptions before they reach production. The 2026-04-27 forensic report (5 always-on bugs in 1h56m) is the canonical example of what skipping the plan costs.

**What this looks like in practice:**

1. The user describes the change.
2. You invoke `/gsd-spec-phase` to produce `SPEC.md` (falsifiable requirements). Confirm with the user.
3. `/gsd-discuss-phase` for any gray areas. Confirm.
4. `/gsd-plan-phase` for `PLAN.md` (file list, task graph, verification steps). Confirm.
5. `/gsd-execute-phase` to ship it with atomic commits.
6. `/gsd-verify-work` to validate UAT criteria.

Bypass only with explicit user instruction (`"esto es trivial, hazlo directo"`) and only for changes that fit the top two rows of the table above. The pre-Edit/Write hook (`.claude/hooks/pre-edit-gsd-guard.sh`) blocks edits to `src/**` when no active phase exists; bypass via `SAGECONNECT_HOOKS_BYPASS=1` (and only after the user agrees).

---
*Maintained for any human or AI agent picking up this codebase. Keep terse; link out for depth.*
