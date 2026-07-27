# Roadmap: SageConnect

## Milestones

- ✅ **v1.0 Payment Reconciliation Fixes** — Phases 1-2 (shipped 2026-03-22)
- ✅ **v1.1 Env Unification** — Phases 3-5 (shipped 2026-03-23)
- ✅ **v2.0 Always-On Service** — Phases 6-10 (shipped 2026-03-25)
- ✅ **v2.1 License Validation** — Phases 11-14 (shipped 2026-03-25)
- ✅ **v2.2 OC Status UI** — Phases 15-16 (shipped 2026-04-09)
- ✅ **v2.3 Scheduler Lock Recovery** — Phases 17-19 (shipped 2026-04-29)
- 📋 **v2.4 Retry policies** — Phases 20-21 (in progress)

## Phases

- [ ] **Phase 20: Cron retry policy + EOM notification** — Replace `MAX(Fecha)=today` filter with configurable scope (current_month default, env override to rolling N-day), add exponential backoff derived from existing fesa.* rows, and ship end-of-month operator email
- [ ] **Phase 20.1: Retry policy correction** — Gap-closure of Phase 20 to match the 2026-05-20 client meeting + 2026-06-11 team refinements before deploy. Q1: default retry scope → rolling 30-day window (`last_n_days`/30). Q2: replace geometric backoff with fixed, document-type-differentiated retry intervals (payments 30 min, POs 240 min), both env-configurable. Q3 alerts + cross-system retry-detection query deferred to a later amendment (pending Santiago session).
- [ ] **Phase 20.2: Retry code vs. real schema** — Correct three defects found by the 2026-07-27 production schema read (`fesa.INFORMATION_SCHEMA.COLUMNS`): the payment cron and EOM queries reference `lastUpdate`/`responseAPI` columns that do not exist on `fesaPagosFocaltec`, and the OC `lastErrorAt` round-trip is skewed 360 min by the tedious `useUTC` default. Code-only; the `ALTER TABLE` needed to restore the PO interval is explicitly deferred.
- [ ] **Phase 21: Partial payment completion policy** — Define and implement `PARTIAL_PAYMENT_POLICY` env (atomic | resume | idempotent) gated on Focaltec sandbox dedupe confirmation

<details>
<summary>✅ v2.3 Scheduler Lock Recovery (Phases 17-19) — SHIPPED 2026-04-29</summary>

- [x] Phase 17: Observability & Diagnostics (4/4 plans) — completed 2026-04-27
- [x] Phase 18: Auto-release & Manual Override (3/3 plans) — completed 2026-04-28
- [x] Phase 19: Root Cause Timeouts (3/3 plans) — completed 2026-04-29

See [`milestones/v2.3-ROADMAP.md`](milestones/v2.3-ROADMAP.md) for full phase details, key decisions, and outcomes.

</details>

<details>
<summary>✅ v2.2 OC Status UI (Phases 15-16) — SHIPPED 2026-04-09</summary>

- [x] Phase 15: PUT /api/pos/status endpoint (1/1 plan)
- [x] Phase 16: pos.html "Cambiar Estado OC" UI (1/1 plan)

See `.planning/MILESTONES.md` for accomplishments.

</details>

<details>
<summary>✅ v2.1 License Validation (Phases 11-14) — SHIPPED 2026-03-25</summary>

- [x] Phase 11: LicenseValidator service (2/2 plans)
- [x] Phase 12: Enforcement (startup + cron + middleware) (2/2 plans)
- [x] Phase 13: Web UI surface (license banner + expiry badge) (1/1 plan)
- [x] Phase 14: Admin email + DNS bypass (1/1 plan)

See `.planning/MILESTONES.md` for accomplishments.

</details>

<details>
<summary>✅ v2.0 Always-On Service (Phases 6-10) — SHIPPED 2026-03-25</summary>

- [x] Phase 6: ResultEnvelope unified contract + scripts refactor (4/4 plans)
- [x] Phase 7: SQL pool singleton + USE [database] (2/2 plans)
- [x] Phase 8: REST API + node-cron scheduler + SSE progress (5/5 plans)
- [x] Phase 9: Web UI operativa (4 pages) (3/3 plans)
- [x] Phase 10: Servy Windows Service + legacy removal (2/2 plans)

See `.planning/MILESTONES.md` for accomplishments.

</details>

<details>
<summary>✅ v1.1 Env Unification (Phases 3-5) — SHIPPED 2026-03-23</summary>

- [x] Phase 3: Centralized config loader (2/2 plans)
- [x] Phase 4: Migrate 31 source modules to centralized require (2/2 plans)
- [x] Phase 5: Regression verification suite (2/2 plans)

See `.planning/MILESTONES.md` for accomplishments.

</details>

<details>
<summary>✅ v1.0 Payment Reconciliation Fixes (Phases 1-2) — SHIPPED 2026-03-22</summary>

- [x] Phase 1: Foundation extraction + TDD setup (2/2 plans)
- [x] Phase 2: PROVIDER MISMATCH + missing UUIDs + batch guard (2/2 plans)

See `.planning/MILESTONES.md` for accomplishments.

</details>

## Phase Details

### Phase 20: Cron retry policy + EOM notification
**Goal**: Operators stop losing PO/payment uploads when authorization isn't on cron tick day, and get a monthly view of what's still pending. Replace the `MAX(Autoriza_OC_detalle.Fecha) = CAST(GETDATE() AS DATE)` filter in both the PO uploader (`src/controller/PortalOC_Creator.js`) and the payment uploader (`src/controller/PortalPaymentController.js`) with a configurable scope (`current_month` default, env-overridable to rolling N-day window) plus exponential-backoff retry derived from existing rows in `fesa.dbo.fesaOCFocaltec` / `fesa.dbo.fesaPagosFocaltec` (no schema change). Add the end-of-month operator email to `MAILING_NOTICES` (CC `MAILING_CC`) with HTML tables of pending POs + pagos, gated by an `EOM_NOTIFICATION_ENABLED` kill-switch and a per-month sentinel file.
**Depends on**: Nothing (first phase of v2.4; master branch)
**Worktree branch**: `feat/phase-20-cron-retry-policy`
**Requirements**: RETRY-01, RETRY-02, RETRY-03, RETRY-04, RETRY-05, RETRY-06, RETRY-07, EOM-01, EOM-02, EOM-03, EOM-04, EOM-05, EOM-06 (13 REQs)
**Closes**: GH #21, GH #22
**Success Criteria** (what must be TRUE):
  1. A PO authorized any day within the current calendar month (not just today) is selected by the cron WHERE clause on the next tick, and the same holds for payments — verifiable by querying `fesaOCFocaltec` / `fesaPagosFocaltec` and observing new rows for previously-orphaned authorizations on the first post-deploy cron tick.
  2. Operator can run `node src/scripts/po-cron-diagnostic.js <poNumber>` against a PO that has prior ERROR rows and the verdict reports backoff state (attempt count, last attempt time, next-eligible time) instead of just the date filter; verdict for a PO inside its backoff window reads "deferred — next eligible at <timestamp>".
  3. A PO or payment with a `status='POSTED'` row in `fesa.*` is never re-selected by the new WHERE clause, even when its authorization date falls inside the retry scope — verifiable by inspecting `fesa.dbo.fesaOCFocaltec` / `fesa.dbo.fesaPagosFocaltec` after a cron tick: no duplicate POSTED row appears for the same `idFocaltec`.
  4. Setting `RETRY_SCOPE=last_n_days` with `RETRY_LOOKBACK_DAYS=7` restricts the cron WHERE to the last 7 days; setting `RETRY_SCOPE=current_month` (default) restores month scope — both reflected in the next-tick log line `[CRON] retry-scope=... window=...`. Range guards in `src/config.js` reject `RETRY_BACKOFF_INITIAL_MIN`, `RETRY_BACKOFF_MULTIPLIER`, `RETRY_BACKOFF_MAX_MIN` outside sane bounds with a fail-fast `[CONFIG ERROR]`.
  5. On the last calendar day of the month after `EOM_NOTIFICATION_HOUR` (default 18), the first cron tick sends one HTML email per category (POs / pagos) to `MAILING_NOTICES` with CC `MAILING_CC` (not to `LICENSE_ADMIN_EMAIL`); subsequent ticks that same month are no-ops because `logs/eom-{YYYY-MM}-{pos|payments}.sent` exists. Setting `EOM_NOTIFICATION_ENABLED=false` skips the entire EOM gate before any computation.
**Plans**: 9 plans across 3 waves. Progress: 1/9 complete (20-01 config foundation — config.retry + config.eom + 7 range guards).

### Phase 20.1: Retry policy correction
**Goal**: Correct Phase 20's retry policy so the (still-undeployed) behavior matches what was agreed with the client on 2026-05-20 and refined by the team on 2026-06-11 — before any deploy. **This SPEC scope = Q1 + Q2 only.** **Q1**: flip the default `RETRY_SCOPE` from `current_month` to `last_n_days` with `RETRY_LOOKBACK_DAYS=30` (rolling 30-day window, so POs authorized near month-end aren't orphaned at the calendar rollover). **Q2**: replace the geometric backoff (`computeBackoffWaitMinutes` in `src/utils/RetryPolicy.js`) with a **fixed, document-type-differentiated retry interval** — payments every `RETRY_INTERVAL_PAYMENT_MIN` (default 30, range [10,60]), POs every `RETRY_INTERVAL_PO_MIN` (default 240), both env-adjustable without redeploy — and remove `RETRY_BACKOFF_INITIAL_MIN/MULTIPLIER/MAX_MIN` + their range guards. No schema change; the cron SQL WHERE (scope + POSTED-dedupe) is unchanged — only the JS post-filter eligibility math changes in both controllers.
**Amends / supersedes** (Phase 20 REQs written against the pre-meeting interpretation): RETRY-03 (default value flips to `last_n_days`/30), RETRY-04 (superseded — fixed interval, not backoff), RETRY-05 (superseded — interval env vars, not backoff env vars), RETRY-07 (diagnostic relabel backoff→retry-interval). Q1/Q4 build + POSTED-dedupe + OUTER APPLY stay as-is.
**Depends on**: Phase 20 (built code; `master` ~45 commits ahead of `origin/master`, undeployed).
**Deferred to a later amendment of this SPEC (NOT in this scope)**: Q3 differentiated alerts (immediate PO alert + biweekly payment report), the separate cross-system (Sage + portal) retry-detection query, manual sync button — pending the Santiago working session.
**Worktree branch**: n/a (sequential on `master` checkout; `workflow.use_worktrees=false`).
**Requirements**: RETRY-C1..C6 (defined in `20.1-SPEC.md`) — corrections that amend/supersede the Phase 20 REQs above.
**Success Criteria** (what must be TRUE — detailed acceptance in `20.1-SPEC.md`):
  1. With no env overrides, `config.retry.scope === 'last_n_days'` and `config.retry.lookbackDays === 30`, and `buildScopeWhere` emits the rolling-30-day fragment; `RETRY_SCOPE=current_month` still restores month scope (option retained — only the default changed).
  2. `src/utils/RetryPolicy.js` exposes a fixed-interval helper (no `errorCount` input) that returns the payment interval for payments and the PO interval for POs; geometric `computeBackoffWaitMinutes` and the `RETRY_BACKOFF_*` env vars + guards no longer exist.
  3. A payment with a prior ERROR row is retry-eligible once `(now − lastErrorAt) ≥ RETRY_INTERVAL_PAYMENT_MIN`; a PO once `≥ RETRY_INTERVAL_PO_MIN` — proven by the rewritten `RetryPolicy.test.js` + both `*.cron-where.test.js` suites (no geometric-curve assertions remain).
  4. `src/config.js` range-guards reject `RETRY_INTERVAL_PAYMENT_MIN` outside [10,60] and `RETRY_INTERVAL_PO_MIN` outside [30,1440] with fail-fast `[CONFIG ERROR]`.
  5. `node src/scripts/po-cron-diagnostic.js <poNumber>` section 6 reports `lastErrorAt`, `retryIntervalMin`, `nextEligibleAt` (no `backoffWaitMin`); `[BACKOFF*]` log labels renamed to `[RETRY*]`.
  6. `npm test` baseline holds (~7 pre-existing failures) with no NEW failures from the correction.
**Plans**: 3 plans in 2 waves
- [x] 20.1-01-PLAN.md (wave 1) — Fixed-interval foundation: RetryPolicy helper (getRetryIntervalMinutes + computeRetryEligibility, geometric removed) + config.retry.interval envs/guards + [CONFIG WARN] on obsolete backoff vars + RETRY_SCOPE default flip to last_n_days + .env.example + RetryPolicy.test.js rewrite [RETRY-C1, C2, C3, C6]
- [x] 20.1-02-PLAN.md (wave 2) — Both cron controllers' JS post-filter migrated to the interval helper (PO 240 / payment 30) + [BACKOFF*]→[RETRY*] labels + four-case cron-where suites (incl. first-attempt) + full npm test baseline [RETRY-C4, C2, C6]
- [x] 20.1-03-PLAN.md (wave 2) — Operator-script caller-audit tail: po-cron-diagnostic.js Section 6 relabel + retry-month-pos.js / retry-month-payments.js migrated off computeBackoffWaitMinutes/config.retry.backoff + RETRY-C7 preview-dedupe mirror + both retry-month Jest suites migrated [RETRY-C5, C2, C3, C7]

### Phase 20.2: Retry code vs. real schema
**Goal**: Make the Phase 20 / 20.1 retry code valid against the **actual** production schema, read on 2026-07-27 via `fesa.INFORMATION_SCHEMA.COLUMNS`. The authoritative column lists are `fesaOCFocaltec` (`idFocaltec nchar, ocSage nchar, status nchar, lastUpdate date, createdAt date, responseAPI nvarchar, idDatabase nchar`) and `fesaPagosFocaltec` (**only** `idCia nchar, NoPagoSage char, status nchar, idFocaltec nchar`). Three defects follow, none of which has ever surfaced because Phase 20 was never deployed:
  - **CR-05 (deploy blocker)** — `buildErrorStatsApply` emits `MAX(lastUpdate)` against `fesaPagosFocaltec`, a column that does not exist. SQL Server raises `Invalid column name 'lastUpdate'`; the `.catch()` at `src/controller/PortalPaymentController.js:103` swallows it and returns `{ recordset: [] }`, so the payment cron would silently process **zero payments every tick, forever** — no crash, only a log line.
  - **CR-05b** — the EOM query at `src/background.js:495-497` references `responseAPI` and `ORDER BY lastUpdate` on the same table; its `try/catch` at L398 logs a warn and continues, so the payments end-of-month email would always read "Sin pendientes".
  - **CR-01** — `lastUpdate` is written server-local via `GETDATE()` but read back as UTC (`tedious@18.6.1` defaults `useUTC: true`; `src/utils/SQLServerConnection.js` never overrides it). Measured offset on `ZCL-SQL-01`: **-360 min**, which exceeds both retry intervals, so `[RETRY-DEFER]` can never fire.
**Depends on**: Phase 20.1 (executed on `feat/reintentos`, 15 commits, unpushed).
**Explicitly deferred (NOT in this scope)**: **CR-04** — `lastUpdate` and `createdAt` are both typed `date`, so no time-of-day exists for OC errors and the 240-min PO interval cannot work without an `ALTER TABLE`; deferred pending measurement of whether RETRY-C7 alone stops the portal hammering. **CR-03** — nothing writes `status='ERROR'` for payments and the table has no column to hold an error time or message; needs a design decision, complicated by the payment dedupe having no status filter. **CANCELLED (18) / OPEN (5)** rows that the RETRY-C7 dedupe does not cover.
**Worktree branch**: n/a (sequential on `feat/reintentos`; `workflow.use_worktrees=false`).
**Requirements**: defined in `20.2-SPEC.md`.
**Success Criteria** (what must be TRUE — detailed acceptance in `20.2-SPEC.md`):
  1. No SQL emitted by `src/` references a column absent from the real schema — in particular, nothing selects `lastUpdate` or `responseAPI` from `fesa.dbo.fesaPagosFocaltec`.
  2. The payment cron query executes without error and processes the payments it finds, instead of failing into the empty-recordset fallback.
  3. The retry elapsed-time comparison no longer mixes the Node clock with a SQL Server timestamp, so a `-360` server offset cannot make every row look eligible.
  4. `npm test` baseline holds with no NEW failures.

### Phase 21: Partial payment completion policy
**Goal**: Decide and implement what happens when a multi-CFDI payment fails partway through upload, so operators stop seeing inconsistent partial state in the portal vs. the control table. Introduce `PARTIAL_PAYMENT_POLICY` env with three valid values — `atomic` (mark entire payment ERROR + surface to operator), `resume` (retry only the unfinished CFDIs), `idempotent` (re-POST the whole payment relying on portal dedupe by `external_id`). The default is set in `.env.example` based on the engineering verification of portal dedupe semantics in the sandbox (PARTIAL-02), which is part of the phase and blocks `/gsd-plan-phase`.
**Depends on**: Phase 20 — `RETRY_SCOPE` env semantics must be locked first (Phase 21 shares the same retry/backoff infrastructure for re-attempt scheduling), and Phase 21's SPEC requires the Focaltec sandbox transcript before the plan stage.
**Worktree branch**: `feat/phase-21-partial-payment-completion`
**Requirements**: PARTIAL-01, PARTIAL-02, PARTIAL-03 (3 REQs)
**Closes**: GH #23
**Success Criteria** (what must be TRUE):
  1. Engineering attaches a portal sandbox transcript (request/response evidence) to the phase's SPEC.md proving how the portal handles a duplicate `external_id` POST — without this evidence the phase cannot leave `/gsd-spec-phase` for `/gsd-plan-phase` (HANDOFF.md §7 double-verification rule applied at phase boundary).
  2. Setting `PARTIAL_PAYMENT_POLICY=atomic` causes a multi-CFDI payment upload that fails on CFDI N to roll the entire payment to `status='ERROR'` in `fesaPagosFocaltec` (no `POSTED` rows for the partially-uploaded CFDIs); setting `PARTIAL_PAYMENT_POLICY=resume` retries only the CFDIs that did not yet reach POSTED; setting `PARTIAL_PAYMENT_POLICY=idempotent` re-POSTs the whole payment and the portal-confirmed dedupe behavior prevents duplicates — each branch verifiable by inspecting `fesaPagosFocaltec` rows after a deliberately-failed upload (no schema change required, per the v2.4 constraint).
  3. `.env.example` contains `PARTIAL_PAYMENT_POLICY=<chosen-default>` with an inline comment referencing the SPEC sandbox evidence link, and `src/config.js` rejects any value outside the three-element enum at startup with a fail-fast `[CONFIG ERROR]`.
**Plans**: TBD

## Progress

| Phase                         | Milestone | Plans Complete | Status   | Completed  |
| ----------------------------- | --------- | -------------- | -------- | ---------- |
| 1. Foundation extraction      | v1.0      | 2/2            | Complete | 2026-03-22 |
| 2. PROVIDER MISMATCH + guards | v1.0      | 2/2            | Complete | 2026-03-22 |
| 3. Config loader              | v1.1      | 2/2            | Complete | 2026-03-23 |
| 4. Module migration           | v1.1      | 2/2            | Complete | 2026-03-23 |
| 5. Regression suite           | v1.1      | 2/2            | Complete | 2026-03-23 |
| 6. ResultEnvelope             | v2.0      | 4/4            | Complete | 2026-03-25 |
| 7. SQL pool singleton         | v2.0      | 2/2            | Complete | 2026-03-25 |
| 8. REST API + scheduler       | v2.0      | 5/5            | Complete | 2026-03-25 |
| 9. Web UI                     | v2.0      | 3/3            | Complete | 2026-03-25 |
| 10. Servy + legacy removal    | v2.0      | 2/2            | Complete | 2026-03-25 |
| 11. LicenseValidator          | v2.1      | 2/2            | Complete | 2026-03-25 |
| 12. Enforcement               | v2.1      | 2/2            | Complete | 2026-03-25 |
| 13. License UI                | v2.1      | 1/1            | Complete | 2026-03-25 |
| 14. Admin email + DNS bypass  | v2.1      | 1/1            | Complete | 2026-03-25 |
| 15. PUT /api/pos/status       | v2.2      | 1/1            | Complete | 2026-04-09 |
| 16. pos.html UI               | v2.2      | 1/1            | Complete | 2026-04-09 |
| 17. Observability             | v2.3      | 4/4            | Complete | 2026-04-27 |
| 18. Auto-release + override   | v2.3      | 3/3            | Complete | 2026-04-28 |
| 19. Root Cause Timeouts       | v2.3      | 3/3            | Complete | 2026-04-29 |
| 20. Cron retry + EOM email    | v2.4      | 8/9 | In Progress|  |
| 21. Partial payment policy    | v2.4      | 0/0            | Pending  | —          |
