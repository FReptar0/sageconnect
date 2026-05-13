# Contributing to SageConnect

Thank you for your interest in contributing. This guide reflects the **actual** workflow used in the repository today — please prefer it over any historical conventions you may have seen elsewhere.

---

## 1. Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). In summary: be respectful, be collaborative, be patient.

---

## 2. Getting Started

1. **Fork** the repository on GitHub (or clone directly if you have write access).
2. **Clone** your fork:
   ```bash
   git clone https://github.com/<your-username>/sageconnect.git
   cd sageconnect
   ```
3. **Install prerequisites** — Node.js 22.15.0 (LTS), npm, Git. Production also needs Servy on Windows but that's not required for local dev.
4. **Install dependencies** — `npm install`.
5. **Configure** — copy `.env.example` to `.env` and fill in required keys. See [`README.md`](README.md) § Environment Variables and [`docs/ONBOARDING.md`](docs/ONBOARDING.md) for the full first-day flow.
6. **Validate config** — `node -e "require('./src/config')"`. Exits 1 with `[CONFIG ERROR]` if anything required is missing.
7. **Run tests** — `npm test`.

Before opening a PR, also read [`CLAUDE.md`](CLAUDE.md) — the always-on constraint and the pitfalls section save real time.

---

## 3. Branching Model

The repo does **not** use GitFlow. The actual model is closer to trunk-based with feature branches:

- **`master`** — the integration branch. CI obfuscates and force-pushes every push here to `FReptar0/sageconnect-dist`, which is what production deploys consume. Treat `master` as production-bound at all times.
- **`feat/<short-description>`** — feature work. Branch off `master`, PR into `master`.
- **`fix/<short-description>`** — bug fixes (non-urgent). Branch off `master`, PR into `master`.
- **`hotfix/<short-description>`** — urgent production fixes. Same flow as `fix/` in practice; the prefix signals priority during review.
- **`chore/<short-description>`** — refactors, dependency bumps, docs that don't change behavior.

Several historical long-lived branches still exist (`feat/always-on-service`, `merge-web-analytics`) but new work should branch from `master`, not from them. There is no `develop` branch.

Naming examples:
```
feat/oc-status-ui
fix/payment-arg
hotfix/sql-pool-context-leak
chore/log-rotation-script
```

---

## 4. Reporting Issues

Before opening an issue, search existing issues to avoid duplicates.

When reporting a bug, include:

- **Title** — concise and descriptive.
- **Description** — expected vs. actual behavior.
- **Steps to reproduce** — numbered list.
- **Environment** — Node version, OS, whether you're hitting prod or local, relevant `.env` values *redacted*.
- **Logs** — relevant excerpts from `logs/sageconnect/YYYY-MM-DD/`. Strip credentials before posting.
- **Severity** — Blocker / Critical / Major / Minor / Trivial.

Use labels: `bug`, `enhancement`, `question`, `security` (security issues should follow [`SECURITY.md`](SECURITY.md) and be emailed, not posted publicly).

---

## 5. Proposing Features

1. **Search** existing issues / PRs.
2. **Open** an issue describing:
   - The problem you're solving (not just the proposed solution).
   - Proposed approach or API surface.
   - Any constraints — particularly **always-on** implications. New code that adds `setInterval`, `setTimeout`, EventEmitter listeners, module-scope caches, or child processes must explain how the resource is bounded across cycles. See [`CLAUDE.md`](CLAUDE.md) § Always-On Constraint.
3. Wait for triage before opening a PR for non-trivial work, especially anything touching `OperationManager`, `CronScheduler`, `LicenseValidator`, or `background.js` orchestration.

---

## 6. GSD workflow (mandatory for non-trivial work)

This codebase uses **GSD** (Get Shit Done) — a planning skill suite that turns every non-trivial change into a tracked phase under `.planning/phases/<NN>-<slug>/`. The directory is the institutional memory of every decision made on this codebase (47+ phases across 6 milestones at the time of this writing).

**When GSD is required**

| Change size | Process |
|---|---|
| Typo, comment-only edit, doc tweak | Direct edit + commit. No GSD. |
| Single-file fix with an obvious diff | `/gsd-quick` or direct edit. Reference the bug in the commit message. |
| Anything else — multi-file change, new feature, new env var, schema change, refactor, new dependency, security work, new endpoint | **Required.** Open a phase. |

**The phase loop**

1. `/gsd-spec-phase` — produce `SPEC.md` (falsifiable requirements). The user must approve before moving on.
2. `/gsd-discuss-phase` — handle gray areas. Recommended unless the spec is obvious.
3. `/gsd-plan-phase` — produce `PLAN.md` (file list, task graph, verification steps). Goal-backward check ensures the plan reaches the spec.
4. `/gsd-execute-phase` — ship it with atomic commits, one per logical change.
5. `/gsd-verify-work` — validate UAT criteria conversationally.

Other useful commands: `/gsd-help` (full list), `/gsd-progress` (where am I), `/gsd-resume-work` (after a context reset).

**Hook enforcement**

The hook `.claude/hooks/pre-edit-gsd-guard.sh` blocks `Edit` / `Write` / `MultiEdit` on `src/**` files when no active phase exists in `.planning/phases/`. The block message lists the commands above. Bypass with `SAGECONNECT_HOOKS_BYPASS=1` only for genuinely trivial work — and state the rationale to the user first.

**Why mandatory:** the always-on regime, the SQL-injection pattern density, the implicit-default trap in `runQuery`, and the obfuscation-to-prod pipeline mean small mistakes have outsized blast radius. The GSD spec/discuss/plan loop catches assumptions before they reach production. See [`HANDOFF.md`](HANDOFF.md) and the 2026-04-27 forensic report (5 always-on bugs in 1 h 56 m) for the canonical cautionary tale.

---

## 7. Pull Request Workflow

1. **Branch off `master`** (or a feature branch with explicit permission).
2. **Make atomic commits**:
   - One logical change per commit.
   - Imperative, present-tense subjects (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:` prefixes are conventional but not enforced).
   - Reference the issue or phase when applicable.
3. **Rebase** onto the latest `master` before pushing the final commit set:
   ```bash
   git fetch origin
   git checkout feat/your-branch
   git rebase origin/master
   ```
4. **Run tests locally**:
   ```bash
   npm test
   ```
   The Jest suite has ~200 tests with ~7 pre-existing failures (documented in [`.planning/codebase/TESTING.md`](.planning/codebase/TESTING.md)). New failures must not be introduced; pre-existing failures should remain pre-existing unless the PR explicitly fixes them.
5. **Push** your branch:
   ```bash
   git push origin feat/your-branch
   ```
6. **Open a PR against `master`**:
   - Reference the issue if any (`Closes #123`).
   - Describe **what** changed and **why** (the diff already shows what).
   - Call out anything always-on-relevant: new timers, new listeners, new singletons, new env vars, new child processes.
   - Mention any pre-existing tests you had to relax or follow-ups deferred.
7. **Respond to review** by pushing additional commits to the same branch (do not force-push during review unless asked — it disrupts the reviewer's diff position).
8. **Merge** — a maintainer merges once approved. CI then obfuscates `master` and force-pushes the result to `FReptar0/sageconnect-dist`.

---

## 8. Coding Style

The repository does not enforce style through ESLint, Prettier, EditorConfig, or any other automated formatter. Code review is the quality gate. Match the existing surrounding code:

- **Indentation** — 4 spaces. No tabs. No trailing whitespace.
- **Module system** — CommonJS only (`require` / `module.exports`). No ESM, no `import` / `export`.
- **Async** — `async` / `await` everywhere; `try`/`catch` around any external I/O.
- **Naming** — see [`.planning/codebase/CONVENTIONS.md`](.planning/codebase/CONVENTIONS.md). Quick version: `PascalCase` for controllers/services/models, `camelCase` for utilities and functions, `UPPER_SNAKE_CASE` for env-sourced constants, `snake_case` for portal-API payload keys.
- **JSDoc** — write a short JSDoc block for any exported function (`@param`, `@returns`). Internal helpers can be undocumented if the name carries weight.
- **Comments** — default to none. Add one when the *why* is non-obvious (a hidden constraint, a workaround for a specific bug, behavior that would surprise a reader). Do not narrate the *what* — code already does that.
- **Logging** — `logGenerator(LOG_FILE, level, message)`. Never use bare `console.log` for anything that needs to survive a restart.
- **Config** — `const config = require('./config')` once at the top of the module; access via `config.section.property`. Never call `dotenv.config()` directly.

---

## 9. Testing

- Framework: **Jest 29** with `babel-jest` transformer.
- Layout: tests live in `tests/`, roughly mirroring `src/`. Naming: `[Module].test.js`.
- Mocking: small fakes per test; no shared global mock state. See `tests/helpers/` for the few shared utilities.
- Coverage: there is **no enforced coverage threshold**. There is no `npm run lint`, `npm run typecheck`, or coverage report — those scripts do not exist. Focus on adding tests for new behavior; do not retrofit tests across the whole module for a small change.
- Known pre-existing failures (documented in `.planning/codebase/TESTING.md`):
  - `PaymentReconciliation.test.js`
  - `TransformTime.test.js`
  - `no-process-exit.test.js` (the range-guard count assertion)
  - `enforcement-wiring.test.js`
  These predate v2.3 and are tolerated baseline noise. If your change makes one of them suddenly pass, mention it in the PR.

Run only a subset while developing:

```bash
npx jest tests/services/CronScheduler.test.js
npx jest --testNamePattern "lock auto-release"
```

The Claude Code slash command `/test` wraps this convention.

---

## 10. Continuous Integration

CI is intentionally minimal. The single workflow is `.github/workflows/obfuscate-deploy.yml`:

1. Triggered on push to `master` (or `feat/always-on-service`, kept for historical reasons), or manually via `workflow_dispatch`.
2. Sets up Node 18 (for the obfuscator runner — runtime in production is 22.15.0).
3. Runs `npm ci`.
4. Runs `node scripts/obfuscate.js`, producing `dist/`.
5. Commits `dist/` and **force-pushes** the result to `FReptar0/sageconnect-dist` with a synthetic commit message referencing the source SHA.

CI does **not** run tests, linting, security scans, or dependency audits. Verifying the test suite is the contributor's responsibility before merge. The maintainer typically re-runs `npm test` locally before approving non-trivial PRs.

---

## 11. Documentation

Update these alongside code changes when they're affected:

- [`README.md`](README.md) — public-facing overview, env vars, dashboard pages, API mounts.
- [`CLAUDE.md`](CLAUDE.md) — the always-on memory loaded by Claude Code. Keep terse; link out for depth.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Servy install / rollback.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — operator runbook.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — single-page architecture.
- [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — first day flow.
- [`docs/CLAUDE_CODE.md`](docs/CLAUDE_CODE.md) — Claude Code conventions for this repo.
- [`.env.example`](.env.example) — every new env var must land here with a comment.

`.planning/` documents are the GSD workflow artifacts and are maintained by the planning commands; do not edit them by hand unless you understand the GSD model.

---

## 12. Security Vulnerabilities

If you discover a security issue:

1. **Do not** open a public issue.
2. Email <hi@fernandomemije.dev> with details — see [`SECURITY.md`](SECURITY.md) for the full disclosure policy.

---

## 13. License & EULA

This project is licensed under the EULA with Fernando Rodríguez Memije (effective July 22, 2025). By contributing you agree that your contribution is incorporated under the same terms. See [`EULA-en.md`](EULA-en.md) (controlling English version) or [`EULA-es.md`](EULA-es.md) (Spanish courtesy translation).

---

## 14. Questions

- General questions — open an issue with the `question` label.
- Anything private — <hi@fernandomemije.dev>.

---

**Thanks for taking the time to contribute carefully — this codebase runs other people's payment data, and every careful PR is appreciated.**
