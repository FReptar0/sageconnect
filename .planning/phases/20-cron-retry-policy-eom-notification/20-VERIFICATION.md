---
phase: 20-cron-retry-policy-eom-notification
verified: 2026-05-15T00:00:00Z
status: gaps_found
score: 12/13 REQs MET, 4/5 success criteria MET
overrides_applied: 0
gaps:
  - truth: "SC4 — RETRY_SCOPE/window change is reflected in a next-tick log line `[CRON] retry-scope=... window=...`"
    status: partial
    reason: "ROADMAP Success Criterion 4 explicitly requires the scope/window to be observable in a per-tick log line `[CRON] retry-scope=... window=...`. No such line exists anywhere in src/. The controllers emit `[BACKOFF] tenant=... candidates=... deferred=... processing=...` but never log the active scope or the resolved date window. An operator changing RETRY_SCOPE cannot confirm the change took effect from the cron log — only indirectly via row counts. SPEC RETRY-01/02 acceptance does not mention this line; only the ROADMAP contract does."
    artifacts:
      - path: "src/controller/PortalOC_Creator.js"
        issue: "No `[CRON] retry-scope=... window=...` log line emitted before/at the cron query."
      - path: "src/controller/PortalPaymentController.js"
        issue: "No `[CRON] retry-scope=... window=...` log line emitted before/at the cron query."
    missing:
      - "Add a per-tick log line at the start of createPurchaseOrders / uploadPayments (or in forResponse) of the form `[CRON] retry-scope=${config.retry.scope} window=<resolved-window>` so operators can confirm a RETRY_SCOPE change from the log per ROADMAP SC4."
human_verification:
  - test: "Payment scope SQL semantics — run the rewritten PortalPaymentController cron query against the live Sage 300 DB and confirm a payment whose AUDTDATE is the 1st of the current month is returned."
    expected: "buildScopeWhere produces `P.AUDTDATE >= DATEFROMPARTS(...) AND P.AUDTDATE < DATEADD(month,1,...)`. AUDTDATE is a Sage integer date in YYYYMMDD form; the right-hand side is a SQL `date`. SQL Server implicit date->int conversion yields day-count, not YYYYMMDD — the comparison could silently exclude all rows. Must be confirmed against real data."
    why_human: "Integration tests mock runQuery and cannot catch SQL implicit-conversion semantics; needs the live Sage 300 schema."
  - test: "First post-deploy cron tick — operator runs git fetch && git reset --hard && npm ci --omit=dev && servy-cli restart, then inspects logs."
    expected: "No [CONFIG ERROR] at startup; PortalOC_Creator.log shows the new WHERE shape; previously-orphaned authorizations (e.g. PO0083449) get fresh fesaOCFocaltec rows."
    why_human: "Requires the production Windows server and the real Sage 300 / Focaltec integration; cannot be exercised statically."
  - test: "Real EOM email on the last calendar day of the month after 18:00."
    expected: "Two HTML emails (POs / pagos) land in MAILING_NOTICES with CC MAILING_CC; sentinels logs/eom-YYYY-MM-{pos,payments}.sent created with success:true; subsequent ticks are no-ops."
    why_human: "Time-gated to the last day of month; SMTP delivery and clock cannot be exercised statically (unit/integration tests cover the gate logic with injected clock)."
---

# Phase 20: Cron retry policy + EOM notification — Verification Report

**Phase Goal:** Operators stop losing PO/payment uploads when authorization isn't on cron tick day, and get a monthly view of what's still pending. Replace the `MAX(Autoriza_OC_detalle.Fecha) = CAST(GETDATE() AS DATE)` filter in both uploaders with a configurable scope + exponential-backoff retry derived from existing fesa.* rows (no schema change), plus an end-of-month operator email.

**Verified:** 2026-05-15
**Status:** gaps_found (1 partial gap — non-blocking observability shortfall)
**Re-verification:** No — initial verification

## Goal Achievement

### Success Criteria (ROADMAP contract)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | PO/payment authorized any day in current month is selected by cron WHERE | ✓ VERIFIED | `PortalOC_Creator.js:181` and `PortalPaymentController.js:71` both call `buildScopeWhere(config.retry, ...)`; `RetryPolicy.js:78-81` emits sargable `DATEFROMPARTS(...) ... DATEADD(month,1,...)` for `current_month`. Old `= CAST(GETDATE() AS DATE)` filter removed (grep: 0 matches). |
| 2 | `po-cron-diagnostic.js` reports backoff state (attempts, last attempt, next eligible) | ✓ VERIFIED | `po-cron-diagnostic.js:224-278` — Section 6 computes `errorCount`, `lastErrorAt`, `backoffWaitMin`, `nextEligibleAt`; 5-priority verdict at L262-278 includes "Esperando backoff hasta ${nextEligibleAt}". |
| 3 | POSTED row never re-selected by new WHERE | ✓ VERIFIED | `PortalOC_Creator.js:182-187` adds `AND NOT EXISTS (... status='POSTED')` to the WHERE; the redundant in-loop POSTED check removed (grep "ya procesada": 0 matches). Payments retain `P.DOCNBR NOT IN (...)` dedupe (`PortalPaymentController.js:72-77`). |
| 4 | RETRY_SCOPE/window env-switchable, reflected in `[CRON] retry-scope=... window=...` log line; range guards reject bad backoff values | ⚠️ PARTIAL | Env-switching + range guards VERIFIED (`config.js:198-284`, all four bad-value probes exit 1). **The required `[CRON] retry-scope=... window=...` log line does NOT exist** — grep across `src/` returns 0 matches. See Gaps. |
| 5 | EOM email on last day after EOM_NOTIFICATION_HOUR, sentinel idempotency, kill-switch | ✓ VERIFIED | `background.js:45-66` EOM gate at top of forResponse, kill-switch short-circuit at L45; `dispatchEomIfDue` L373-441 — per-category sentinels, sends to MAILING_NOTICES (not admin); `EomNotification.js:57-88` `shouldDispatchEom` gate. |

**Score:** 4/5 success criteria fully met; SC4 partial (env-switching works, observability log line missing).

### Requirements Coverage (13 REQs)

| REQ | Description | Status | Evidence |
|-----|-------------|--------|----------|
| RETRY-01 | PO scope filter rewrite | ✓ MET | `PortalOC_Creator.js:181` `buildScopeWhere`; `RetryPolicy.js:73-88` sargable both branches. |
| RETRY-02 | Payment scope filter rewrite | ✓ MET | `PortalPaymentController.js:71` `buildScopeWhere(config.retry,{dateField:'P.AUDTDATE'})`; 60-min filter preserved L86-99. (See human-verification note on AUDTDATE int/date semantics.) |
| RETRY-03 | Scope env vars + range guards | ✓ MET | `config.js:198,200` `config.retry.{scope,lookbackDays}`; guards L245-254. Probe `RETRY_SCOPE=invalid` → exit 1 with `[CONFIG ERROR] RETRY_SCOPE inválido`. |
| RETRY-04 | Exponential backoff filter | ✓ MET | `RetryPolicy.js:28-49` `computeBackoffWaitMinutes` (curve 0/15/30/60/120…1440); JS post-filter `PortalOC_Creator.js:204-229`, `PortalPaymentController.js:112-136`. OUTER APPLY error-stats `RetryPolicy.js:118-129`. |
| RETRY-05 | Backoff env vars + range guards | ✓ MET | `config.js:203-207` `config.retry.backoff.{initialMin,multiplier,maxMin}`; guards L256-272. Probes `INITIAL_MIN=0`, `LOOKBACK_DAYS=400` → exit 1. RetryPolicy reads from `config.retry.backoff`. |
| RETRY-06 | POSTED dedupe in WHERE | ✓ MET | `PortalOC_Creator.js:182-187` WHERE-level `NOT EXISTS POSTED`; in-loop check removed. |
| RETRY-07 | Diagnostic script verdict update | ✓ MET | `po-cron-diagnostic.js` Section 4 in-place (L158-189, same helpers as cron), Section 6 backoff state (L224-254), 5-priority verdict (L262-278). |
| EOM-01 | EOM trigger window | ✓ MET | `EomNotification.js:57-88` `shouldDispatchEom` — last-day + hour + sentinel-absent; gate in `background.js:381`. |
| EOM-02 | EOM recipients (MAILING_NOTICES, not admin) | ✓ MET | `EmailSender.js:69-100` `sendOperatorReport` → `notices.join(',')` + CC `mailing.cc`; admin not in to/cc. `EmailSender.test.js` passes. |
| EOM-03 | EOM email content (2 tables + links) | ✓ MET | `EomNotification.js:103-156` `buildEomEmailHtml` — h1, table, "Sin pendientes" branch, footer links; `tests/fixtures/eom-email-sample.html` snapshot test passes. |
| EOM-04 | EOM idempotency (sentinel always written) | ✓ MET | `background.js:431-439` sentinel written in all paths (success/fail); SMTP-fail fallback `sendAdminAlert` L424-428; `writeSentinelAtomically` `EomNotification.js:171-179` (tmp + rename). `eom-dispatch.test.js` passes. |
| EOM-05 | EOM kill-switch | ✓ MET | `background.js:45` `if (!config.eom.notificationEnabled)` short-circuits before any query/file check; `shouldDispatchEom` re-checks at `EomNotification.js:62`. |
| EOM-06 | EmailSender extension (new export, no dup transport) | ✓ MET | `EmailSender.js:100` `module.exports = { sendMail, sendOperatorReport }`; `sendOperatorReport` accepts `callerLogFile`. |

**12/13 REQs fully MET. RETRY-03 is MET for env-switching; the ROADMAP SC4 observability log line is a separate gap (see below).**

### Constraint Compliance

| Constraint | Status | Evidence |
|-----------|--------|----------|
| No schema change to fesa.* tables | ✓ PASS | grep `CREATE TABLE\|ALTER TABLE` on fesaOC/fesaPagos → 0. All backoff state derived via `COUNT(*)` / `MAX(lastUpdate)`. |
| CLAUDE.md §3 always-on (no unbounded timer/listener/Map) | ✓ PASS | `RetryPolicy.js` + `EomNotification.js` are pure/stateless; no `setInterval`/`setTimeout`/`new Map`/listeners. EOM gate runs inside existing tick. Sentinels are bounded files. |
| CLAUDE.md §6 #1 (no new parameterized-query sites) | ✓ PASS | New WHERE fragments use template-literal interpolation of range-guarded envs / controlled tenant DBs — pattern preserved. |
| CLAUDE.md §6 #2 (explicit db arg on runQuery) | ✓ PASS | `PortalOC_Creator.js:195` `runQuery(sql, databases[index])`; `PortalPaymentController.js:103` `runQuery(..., database[index])`; `background.js:394` `runQuery(sql, tenantDb)`. Cross-DB fesa.* refs are fully-qualified `fesa.dbo.*`. |
| CLAUDE.md §9 defense-in-depth invariant | ✓ PASS | EOM dispatch wrapped in `withStepTimeout(dispatchEomIfDue(...), config.schedule.stepTimeoutMs, 'step=eomDispatch')` (`background.js:50-54`). No timeout tier changed. |
| HANDOFF.md §1 (no third-party names) | ✓ PASS | `grep -rniE 'tersoft' src/ tests/` → 0 matches in code. Matches in `.planning/phases/20-*` are the literal grep-assertion strings inside plan/spec docs, not third-party names. |
| Customer-locked .env.example defaults | ✓ PASS | `.env.example:107-138` — RETRY_SCOPE=current_month, RETRY_LOOKBACK_DAYS=30, RETRY_BACKOFF_INITIAL_MIN=15, RETRY_BACKOFF_MULTIPLIER=2, RETRY_BACKOFF_MAX_MIN=1440, EOM_NOTIFICATION_HOUR=18, EOM_NOTIFICATION_ENABLED=true — verbatim. |

### Decision Coverage (spot-check of 16 D-NN)

| Decision | Status | Evidence |
|----------|--------|----------|
| D-01 (JS backoff post-filter, single source) | ✓ | `computeBackoffWaitMinutes` called from both controllers + diagnostic; no SQL-side backoff math. |
| D-02 (OUTER APPLY error-stats) | ✓ | `buildErrorStatsApply` `RetryPolicy.js:118-129`; used in both controllers. |
| D-03 (POSTED dedupe in WHERE, loop check removed) | ✓ | `PortalOC_Creator.js:182-187`; in-loop check removed. |
| D-09 (EOM data query hardcoded current_month) | ✓ | `background.js:444-472` `buildEomDataQuery` uses fixed current-month MAX(Fecha) range, ignores `config.retry.scope`. |
| D-10 (empty "Sin pendientes" still sends) | ✓ | `EomNotification.js:125-126`; `background.js:405-406` builds + sends regardless of row count. |
| D-13 (exact `[BACKOFF-DEFER]`/`[BACKOFF]` formats) | ✓ | `PortalOC_Creator.js:225,229`; `PortalPaymentController.js:132,136` — match the locked format. |
| D-16 (clock injection) | ✓ | `shouldDispatchEom(now, ...)` takes `now` as first arg; `background.js:51` passes `date`. |

No dropped decisions detected — the plan-phase decision-coverage gate override in STATE.md is not contradicted by the code.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All Phase 20 source syntactically valid | `node -c` on 8 files | All OK | ✓ PASS |
| Config loads with defaults | `node -e "require('./src/config')"` | exit 0 | ✓ PASS |
| RETRY_SCOPE=invalid rejected | `RETRY_SCOPE=invalid node -e require config` | exit 1, `[CONFIG ERROR] RETRY_SCOPE inválido` | ✓ PASS |
| RETRY_BACKOFF_INITIAL_MIN=0 rejected | env probe | exit 1 | ✓ PASS |
| RETRY_LOOKBACK_DAYS=400 rejected | env probe | exit 1 | ✓ PASS |
| EOM_NOTIFICATION_HOUR=25 rejected | env probe | exit 1 | ✓ PASS |

### Test Integrity

| Metric | Result |
|--------|--------|
| Full suite | 6 failed suites / 7 failed tests / 466 passed (474 total) |
| Baseline (CLAUDE.md §6 #3) | ~6 failed suites / 7 failed tests expected |
| New Phase 20 suites | 8 suites, 48 passed + 1 skipped — ALL PASS (RetryPolicy, EomNotification, PortalOC_Creator.cron-where, PortalPaymentController.cron-where, eom-dispatch, EmailSender, retry-month-pos, retry-month-payments) |
| Regressions introduced | NONE |

`config.test.js` and `operation-manager.test.js` fail with "Jest worker child process exceptions" — root cause is an unmocked real `process.exit(1)` in `src/config.js` validate(). **Confirmed pre-existing:** checking out the pre-Phase-20 `src/config.js` (commit 14896d6) reproduces the identical failure. This is the `no-process-exit` family of the documented baseline (CLAUDE.md §6 #3), not a Phase 20 regression. `TransformTime` and `PaymentReconciliation` failures are also baseline.

### Anti-Patterns Found

None blocking. No debt markers (TBD/FIXME/XXX) without follow-up references in Phase 20 files. No stub returns or empty handlers in new code.

### Gaps Summary

One non-blocking gap: ROADMAP Success Criterion 4 explicitly names a per-tick log line `[CRON] retry-scope=... window=...` as the observable signal that a RETRY_SCOPE change took effect. The implementation delivers the env-switching and range guards (the substantive behavior) but emits no such log line — operators can only infer the active scope indirectly from `[BACKOFF]` row counts. The SPEC's RETRY-01/02/03 acceptance clauses do not require this line, so all 13 REQs are MET; the gap is strictly against the ROADMAP contract wording. Low-effort fix: one `logGenerator` line at the start of each cron uploader.

Three items routed to human/UAT verification (prod-only): the AUDTDATE int-vs-date SQL implicit-conversion semantics in the payment scope filter, the first post-deploy cron tick, and the real last-day-of-month EOM email send.

## Overall Phase Verdict

**PASS-WITH-NOTES.** All 13 locked REQs are MET, all constraints satisfied, no schema change, no test regressions, 48 new tests passing. The phase goal — operators no longer lose uploads authorized off-tick-day, backoff derived from existing rows, EOM visibility — is achieved in the codebase. The single gap (missing `[CRON] retry-scope=... window=...` log line) is a ROADMAP-contract observability shortfall, not a functional defect; it should be closed before sign-off but does not block the goal. One SQL-semantics item (payment AUDTDATE scope comparison) warrants confirmation against the live Sage 300 DB during UAT.

---

_Verified: 2026-05-15_
_Verifier: Claude (gsd-verifier)_
