# HANDOFF.md — non-negotiable rules for whoever picks up this codebase

This file exists because the previous maintainer is stepping away and these rules used to live in their personal Claude Code memory. They are not derivable from the code, the commit history, or the planning docs alone. **Read this once before your first change. Re-read sections 1 and 4 before every commit.**

Companion docs:

- [`CLAUDE.md`](CLAUDE.md) — auto-loaded technical memory (always-on constraint, pitfalls, file:line refs).
- [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — day-1 setup.
- [`docs/CLAUDE_CODE.md`](docs/CLAUDE_CODE.md) — how to work with Claude Code in this repo.
- [`.planning/PROJECT.md`](.planning/PROJECT.md) — scope, decisions, milestones.

---

## 1. Legal & brand — never name the prior integrator in committed artifacts

The license relationship is bilateral **Fernando Rodríguez Memije (Licensor) ↔ Licensee**. The prior employer / external integrator (sometimes referred to in conversation as "Tersoft" or "the integrator") has **no role** in the contract structure, no role in the IP chain, and no role in any committed file.

**Rule:** never write that company's name — or any prior integrator / channel partner — anywhere in this repo. This applies to:

- Shipping artifacts: `EULA-en.md`, `EULA-es.md`, `LICENSE.md`, `SECURITY.md`, `CONTRIBUTING.md`, `README.md`, `AVISO_PRIVACIDAD.md`, `package.json`, `.env.example`, anything under `src/`, `scripts/`, `public/`, `docs/`.
- Planning artifacts: everything under `.planning/`. The source repo is private but could be subpoenaed or shared with legal counsel later — the discipline is to never write the name down anywhere in the repo.
- Commit messages and PR titles.

**Substitutes to use:** "el integrador", "the integrator", "external integrator", "[third party]", "prior employer", "channel partner".

**Why this matters:** Mentioning the prior integrator in legal docs (as part of "el Licenciante" structure or otherwise) could be construed as recognition of a contractual relationship and weaken the bilateral Licensor↔Licensee structure of the EULA. Fernando is the sole IP owner (LFDA Art. 30 — no written cession exists).

**Before every commit**, grep the diff:

```bash
git diff --cached | grep -in "tersoft\|prior employer\|integrator " || echo "OK"
```

The pre-commit redaction hook at `.claude/hooks/pre-commit-redaction.sh` catches this automatically, but never rely on the hook alone.

---

## 2. License server — never expose its purpose in client-facing code

The Vercel-hosted **SageConnect License Server** (`https://sageconnect-license.vercel.app`) is a remote kill-switch. Toggle a client's key to inactive and that customer's installation stops working at the next license check.

**Rule:** never use the words "kill switch", "remote control", "bloqueo remoto", or the literal hostname `sageconnect-license.vercel.app` in any file a customer could read. Also never put real admin emails (e.g. `admin@<integrator-domain>`) in `.env.example`, source comments, dashboard UI strings, or commit messages.

**Use instead:** "license validation service", "service notifications", neutral placeholder URLs like `https://your-license-server.example.com`, neutral placeholder emails like `admin@example.com`.

This applies even though `SAGECONNECT_API_KEY` is dual-purpose (dashboard auth + license-server client identifier) and is technically visible to the operator on their own server — the value is OK to expose, but the system's *purpose* as a kill switch is not.

**Why this matters:** customers are deployed on their own infrastructure where the prior maintainer has no physical control. Revealing the kill-switch purpose makes it easier for a non-paying customer to bypass it (block the domain, fork the validator code, patch out the check). Keep the language operational and neutral.

License server stack reference (separate repo, not this one):

- Repo: `sageconnect-license` (Next.js 16.2.1, Drizzle ORM, Neon Postgres free tier, Vercel free tier, `jose` for JWT, `bcryptjs`).
- Validate endpoint: `GET /api/validate?key=<sc_live_...>` returns HMAC-signed JSON.
- Admin dashboard at `/admin/dashboard` for key management (toggle active/inactive, rotate).
- Shared secret: `HMAC_SECRET` (this repo and the license server must match).
- Key format: `sc_live_<random>`; only the SHA-256 hash is stored server-side; the plain key is shown once to the admin at creation.
- `bcrypt` hashes in `.env` need `$` escaping for `dotenv`, but the Vercel dashboard handles `$` literally — keep that in mind when rotating the admin password.

---

## 3. Deployment discipline — automated obfuscation, force-pushed dist, reset-only updates

The deploy flow has three rules that are easy to violate:

**3a. The GitHub Action is the source of truth for obfuscation.** Every push to source `master` triggers `.github/workflows/obfuscate-deploy.yml`, which runs `node scripts/obfuscate.js` and force-pushes the obfuscated output to `FReptar0/sageconnect-dist`. **Never** run `node scripts/obfuscate.js` manually for a real deploy. The Action exists so human error can't produce a mismatched build.

**3b. The production server uses `git reset --hard`, not `git pull`.** The dist repo is **force-pushed** every time, so `git pull --ff-only` fails (non-fast-forward) and `git pull` (merge) creates local merge commits that the next force-push clobbers. The procedure is:

```powershell
cd E:\sageconnect-dist
git fetch origin master
git reset --hard origin/master
npm ci --omit=dev
Restart-Service SageConnect
```

A diagnostic `git log origin/master --oneline -5` after the fetch tells you what commit you're about to land on. `git log HEAD..origin/master` is unreliable because of the force-pushed history.

**3c. Rollback is also `git reset --hard <previous-sha>`** against the dist repo — not "revert to RunSageconnect.bat" and not "checkout a tag in the source repo". The legacy bat-file rollback referenced in older docs is obsolete since v2.0. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) § "Rollback (v2.3)".

---

## 4. `.planning/` stays tracked in this repo

`.planning/` is intentionally tracked in `FReptar0/sageconnect` (the private source repo). The `.gitignore` line `!.planning/**` is a deliberate negation override — keep it. The directory is the GSD workflow's home and the institutional memory of every decision made on this codebase.

**Rule:**

- Do **not** propose moving `.planning/` to `.gitignore`.
- Do **not** run `git rm -r --cached .planning/`.
- If a specific file inside `.planning/` has a problem (e.g. contains the prior integrator's name — see § 1), edit that one file. Don't untrack the whole tree.

`.planning/` is already excluded from the obfuscated dist build by `scripts/obfuscate.js` COPY_AS_IS, so it never reaches the customer.

**Cautionary tale (2026-05-02):** The combination `git stash --keep-index` + `git rm -r --cached .planning/` + `git stash pop` caused local files to be lost despite `--cached`. Conflict resolution during the stash pop dropped most of `.planning/` from disk. Recovery required `git reset --hard HEAD~1`. **Avoid this pattern entirely.** If you insist on untracking, do it as a single direct commit without stash juggling — and don't.

---

## 5. Production facts (Capstone Copper, current customer)

These are the operational identifiers in active production. Most are immutable and several have caused confusion when forgotten.

| Resource | Value |
|---|---|
| App server | `ZCL-RDS-02` (Windows Server, Servy + Node 22.15.0) |
| Install path | `E:\sageconnect-dist\` (the dist repo lives here; the v1.x `E:\sageconnect\` path does **not** exist in prod) |
| `.env` location | `E:\sageconnect-dist\.env` |
| Servy logs | `E:\sageconnect-dist\logs\servy-stdout.log` and `servy-stderr.log` (active); rotated files use mid-fix `.YYYYMMDD_HHMMSS.log` regex `\.\d{8}_\d{6}\.log$`. |
| App (winston) logs | `E:\sageconnect-dist\logs\sageconnect\YYYY-MM-DD\` |
| Long-term log archive | `C:\Logs\sageconnect\servy\YYYY-MM-DD\` |
| Log rotation script (prod) | `C:\Scripts\Rotate-SageConnectLogs.ps1` (staged outside the dist repo to survive `git reset --hard`) |
| SQL Server | `ZCL-SQL-01` (separate machine) |
| Sage 300 DB name | **`COPDAT`** — set by Sage itself, immutable, cannot be renamed |
| Control DB | `FESA` (multi-tenant default; per-tenant overrides come from `DATABASES` env var) |
| SQL login | `sage` (mapped as `dbo` in COPDAT) |
| Single-tenant config (current) | `DATABASES=COPDAT`, `TENANT_ID=t7e92ajx4dm77k` |

**Special rule about `COPDAT`:** `Invalid object name` errors on Sage tables (`APBTA`, `POPORH1`, `APVENO`, `BKACCT`, `APTCR`, …) are **never** caused by the DB name being wrong. Investigate schema, permissions (`HAS_PERMS_BY_NAME`), `USE [DB]` context leakage, or table prefix instead. `COPDAT` doesn't change.

---

## 6. No direct SQL access in production — and no local DB to test against

The maintainer has filesystem + service-control access to `ZCL-RDS-02` via Servy, but **no DBA tool** (no SSMS, no `sqlcmd`, no DBeaver) on prod. There is **also no local instance** of `COPDAT`, `FESA`, or `Autorizaciones_electronicas` anywhere — the customer's DBs live on `ZCL-RDS-02` and nowhere else, and there is no staging that mirrors them. The practical consequence is that **any code which calls `runQuery()` can only be exercised on prod**: there is no `npm test`-equivalent loop for SQL-touching code, and there is no "run it locally first to make sure it works" step.

Every SQL investigation has to ship as a Node.js script, and the validation loop is the deploy loop.

**Rule:** for any SQL diagnostic or repair work, write a script under `src/scripts/<topic>-{diagnostic,repair,query}.js` following the established pattern:

- Use `runQuery(query, database)` from `src/utils/SQLServerConnection.js` — it handles the singleton pool, the always-prepend `USE [database]`, and timeouts.
- Wrap the result in `successResult` / `errorResult` from `src/utils/ResultEnvelope.js`.
- Make the script executable with `node src/scripts/<name>.js [args...]`. Accept CLI args, do not embed parameters.
- Format output with `console.table()` so it can be pasted back as plain text.
- Don't `process.exit()` for non-fatal conditions (always-on regime).
- Don't write a `.sql` file or instruct the operator to run queries manually.

The script then rides the same obfuscation/deploy pipeline as the rest of the code; the operator runs it on prod as `node src/scripts/<name>.js` (the path is the same in source and dist because the obfuscator preserves the layout for `src/scripts/`).

**Validation loop for SQL-touching code (no shortcuts):**

1. Locally: `node -c <script>` (syntax) and a source-grep for the read-only invariant (`grep -nE 'INSERT |UPDATE |DELETE FROM' <script>` returns 0 matches for diagnostics).
2. Commit on a feature branch or `master` per § 3.
3. `git push origin master` → GitHub Action obfuscates → force-pushes to `sageconnect-dist`.
4. Operator on `ZCL-RDS-02`: `cd E:\sageconnect-dist && git fetch && git reset --hard origin/master` (never `git pull` — dist is force-pushed; per `feedback_prod_deploy_uses_reset` memory).
5. Operator runs `node src/scripts/<name>.js <args>` and pastes the `console.table()` output back.
6. Either confirm the hypothesis and open the follow-up phase, or iterate the diagnostic.

There is no "skip step 3 and try it locally" — the script will fail at `runQuery()` because there is no DB to connect to. Plan the diagnostic loop around push-to-prod as the default test rig, and design each script so a partial failure leaves the system unchanged (read-only by default, every mutation behind an explicit `--apply` style flag and a separate phase).

Template script with the `safeRun()` resilience pattern: `src/scripts/diagnose-sage-tables.js` (8 read-only checks against the Sage schema, each wrapped so one failure doesn't abort the rest). Reference cron-replication diagnostic: `src/scripts/po-cron-diagnostic.js` (added by quick task 260512-7ea — explains why the cron skips POs without touching state).

---

## 7. Behavioral rule: never declare "done" without verifying both sides

When investigating or repairing payment / CFDI / PO state, the system has two sources of truth — the Focaltec portal and the local control table (`fesa.dbo.fesaPagosFocaltec` or analogous). **A document or comment claiming an item is resolved is not evidence.** Both sides must be checked.

**Rule:** for every payment / CFDI / PO reported as "resuelto", "subido", "cerrado":

1. Query the portal directly (via the existing controller helpers or a diagnostic script) and confirm the state matches the claim.
2. Query the control table and confirm the row exists with the expected status.
3. Only after both confirm, communicate the result.

**Why this matters:** during a prior remediation cycle, PY0062112 was assumed resolved based on a "XML insertado" comment in the document. The control table didn't have the row. The follow-up email reported the wrong status. Production payment data is unforgiving — assumptions cost money.

Never paraphrase a portal/DB state from memory or from prior conversation context — re-run the query.

---

## 8. Commit hygiene

**Co-Authored-By trailer.** Add `Co-Authored-By: Claude Opus <noreply@anthropic.com>` (or appropriate model) **only on documentation commits** (`docs:`, `chore:` for planning files). **Never on code commits** (`feat:`, `fix:`, `test:`, `refactor:`). Code commits should look like they came from the developer.

This applies when invoking GSD executor agents too — pass the rule explicitly in the agent prompt so it doesn't accidentally tag a code commit.

**Conventional commits.** Match the existing style in `git log`:

```
feat(<scope>): <imperative subject>
fix(<scope>): ...
docs(<scope>): ...
chore(<scope>): ...
test(<scope>): ...
refactor(<scope>): ...
```

**Commit message body.** Explain the *why*, not the *what* (the diff already shows what). For code commits, call out:

- New `setInterval`/`setTimeout`/listener/child process and how it gets cleaned up.
- New shared-helper signature changes and how callers were audited.
- New env vars (must also land in `.env.example`).

---

## 9. Forward direction (future maintainer planning notes)

A few intentions the previous maintainer recorded but didn't ship. Treat as context, not a roadmap commitment.

**`ImportaFacturasFocaltec.exe` replacement.** The `.exe` is a C# black box (source not in this repo) spawned by `background.js` to import CFDI XML into Sage 300 via the COM API. It communicates only through stdout/stderr/exit codes, which is the root cause of several visibility gaps in the always-on era.

Sage 300 has had a REST Web API since v2017.1 (`http://<server>/Sage300WebApi/v1.0/-/<CompanyID>/`) that supports `POST AP/APInvoiceBatches` and the Payment Batches endpoints. This could replace the `.exe` entirely from Node.js with standard HTTP/JSON, eliminating the Servy-no-desktop-session pain, the kill-cascade gymnastics, and the black-box error model. Direct SQL `INSERT` is **not safe** (bypasses Sage's business logic, risks data corruption). The `edge-js`/COM bridge is over-engineered for this purpose.

When this work is planned, frame it as Web API integration, not as "fixing the exe". The teammate who built the exe justified it because the COM API required C#; that's true for COM, but the Web API path is cleaner and was likely not considered at the time.

---

## 10. Where to get more depth

- Always-on regime, defense-in-depth invariant, critical files w/ line refs → [`CLAUDE.md`](CLAUDE.md).
- Architecture (single-page) → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Full version → [`.planning/codebase/ARCHITECTURE.md`](.planning/codebase/ARCHITECTURE.md).
- Tech debt, fragile areas → [`.planning/codebase/CONCERNS.md`](.planning/codebase/CONCERNS.md).
- Day-1 onboarding → [`docs/ONBOARDING.md`](docs/ONBOARDING.md).
- Operator runbook → [`docs/OPERATIONS.md`](docs/OPERATIONS.md).
- Deployment → [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
- Always-on failure case study → [`.planning/forensics/report-20260427-220000.md`](.planning/forensics/report-20260427-220000.md).
- Project history and 147 logged decisions → [`.planning/PROJECT.md`](.planning/PROJECT.md).

---

*If you find yourself reading this and realizing the rule no longer applies (a customer is fine with being named, the kill-switch model has been replaced, etc.), update the rule in this file and commit the change explicitly. Silent erosion of these rules is how the maintainer-before-you got burned.*
