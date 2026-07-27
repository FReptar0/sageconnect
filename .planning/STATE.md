---
gsd_state_version: 1.0
milestone: v2.4
milestone_name: Retry policies
status: verifying
stopped_at: Completed 20.1-03-PLAN.md — phase 20.1 fully executed (3/3 plans); next is /gsd-verify-work 20.1
last_updated: "2026-07-27T17:13:35.229Z"
last_activity: 2026-07-27
progress:
  total_phases: 3
  completed_phases: 1
  total_plans: 12
  completed_plans: 12
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-29 after v2.3 milestone)

**Core value:** La integración Sage-Portal debe ser confiable, mantenible, y operable: servicio continuo con interfaz web para operaciones y monitoreo en tiempo real.
**Current focus:** Phase 20.1 — retry-policy-correction

## Current Position

Phase: 20.1 (retry-policy-correction) — EXECUTED (3/3 plans)
Plan: 3 of 3 — complete
Status: Phase complete — ready for verification
Total phases: 21 (Phases 20-21 active this milestone)
Next: `/gsd-verify-work 20.1`. All five callers of the removed `computeBackoffWaitMinutes` are migrated — nothing under `src/` references `computeBackoffWaitMinutes`, `config.retry.backoff`, `backoffWaitMin` or the `in-backoff` token any more, so the two operator-run `retry-month-*` scripts no longer throw. The code is push-safe; per the 2026-07-22 todo-junto directive the actual push + deploy still waits for Q3 (alerts) + the 409/detection query and the August window.
Last activity: 2026-07-27
Test suite after 20.1-03: **6 failed suites / 7 failed tests of 484** — exactly the pre-existing CLAUDE.md §6 baseline (`PaymentReconciliation`, `TransformTime`, `no-process-exit`, `enforcement-wiring` + the `config` / `operation-manager` Jest worker crashes). Baseline restored; 476 passed vs 466 at the pre-phase baseline (+10 tests added by waves 1-3).

## Decisions

Decisions recorded during v2.4 execution (milestone-level history lives in `.planning/PROJECT.md`).

- **20.1-01:** `config.retry.interval.{payment, po}` (30 / 240 min) replaces `config.retry.backoff` — the retry wait is fixed per document type and no longer grows with the attempt count. `getRetryIntervalMinutes` has no error-count parameter at all, so no call site can reintroduce the curve.
- **20.1-01:** Leftover `RETRY_BACKOFF_*` env vars are inert and emit one non-fatal `[CONFIG WARN]` each — never fail-fast on a removed OPTIONAL var. Refusing to boot on this always-on payment service is the April month-end outage shape.
- **20.1-01:** `computeRetryEligibility` fails OPEN (eligible now) on an unusable `intervalMinutes` or unparseable `lastErrorAt`. An over-eager retry is a portal 409 at worst; a permanently deferred row is invisible and unbounded.
- **20.1-01 (expected intermediate state):** Wave 1 removes `computeBackoffWaitMinutes` while its five callers still import it, so four suites (`PortalOC_Creator.cron-where`, `PortalPaymentController.cron-where`, `retry-month-pos`, `retry-month-payments`) are red by construction until wave 2. Do **not** hotfix them outside plans 20.1-02 / 20.1-03.
- **20.1-02:** Both controllers now decide eligibility with a single `computeRetryEligibility` call and the local `errorCount <= 0 => include` short-circuit is **deleted**, not kept as a fast path. Two copies of the first-attempt rule that agree today are two copies that can disagree after the next edit — that drift is exactly what D-01 exists to prevent. `errorCount` survives only as the `attempts=` log field (D-04), logged as `row.errorCount || 0` so it can never render `undefined`.
- **20.1-02:** RETRY-C7 shipped as a **single-line** edit to the `PortalOC_Creator` `NOT EXISTS` dedupe (`status IN ('CLOSED', 'POSTED')`). `grep -rn "status = 'POSTED'" src/` still returns 14 other occurrences — all deliberately untouched. `retry-month-pos.js` carries the preview mirror and belongs to plan 20.1-03; the `background.js` EOM query is out of scope per SPEC RETRY-C7 / CONTEXT D-09.
- **20.1-02:** Both cron-where config mocks keep `scope: 'current_month'` on purpose — the suites assert the `DATEFROMPARTS` SQL shape, which flipping the mock to `last_n_days` would silently void. The default flip is proven one layer down, in `tests/utils/RetryPolicy.test.js`.
- **20.1-02 (test-infra bug, auto-fixed):** `jest.clearAllMocks()` does **not** drain queued `mockResolvedValueOnce` implementations. Both cron-where suites leaked stubs across cases — the RED run caught the first-attempt case grading a leaked empty recordset. Both suites now `mockReset()` the shared `runQuery` / portal mocks in `beforeEach`.
- **20.1-03:** The three operator scripts now call the same `computeRetryEligibility` the cron uses, so the diagnostic's verdict and the month-sweep's classification cannot drift from what the cron actually does (D-01). Both sweeps key the first-attempt branch on `lastErrorAt` (not `errorCount === 0`), matching the helper's own rule; the helper boolean is destructured as `isEligible` because `eligible` is already the accumulator array in both files.
- **20.1-03:** RETRY-C7's second half — the `retry-month-pos.js` dry-run preview dedupe — now reads `status IN ('CLOSED', 'POSTED')`, so the preview matches what `--apply` (`createPurchaseOrders`) processes. `retry-month-payments.js` SQL is byte-identical (`fesaPagosFocaltec` has no CLOSED lifecycle); the 60-min antiquity filter is untouched. 13 `status = 'POSTED'` sites remain across 10 files in `src/` — all deliberately out of scope.
- **20.1-03 (plan defect, corrected during execution):** plan 20.1-03 claimed the retry-month scripts had "no Jest coverage" and that structural greps were the only local gate. Two suites exist (`tests/scripts/retry-month-{pos,payments}.test.js`, added 2026-05-15) and their fixtures encoded the retired 15-min geometric windows. They were migrated with the source in the same commit — a 20-min fixture is now INSIDE both new intervals, so tests and source could not move independently.
- **20.1-03 (out of scope, logged not fixed):** `po-cron-diagnostic.js` section 4 replicates the cron WHERE but still dedupes on `status = 'POSTED'` only, while the real cron now uses `status IN ('CLOSED','POSTED')`. Its `cronWouldMatch` can therefore read `true` for an OC the cron would skip. SPEC RETRY-C7 names only `PortalOC_Creator.js` + the `retry-month-pos.js` preview, so this third site was left alone — see `.planning/phases/20.1-retry-policy-correction/deferred-items.md`.

## Phase 20.1 — 2026-07-22 Santiago session + RETRY-C7 amendment

**Session (2026-07-22, Santiago Peláez):** closed the deferred pieces of Phase 20.1. Transcript: `data/Revision punto sageconnect - 2026_07_22 09_59 CST - Notas de Gemini.md`. Outcomes:

- **Confirmed, no code change:** Q1 rolling-30-day scope; Q2 OC interval 4 h (240 min) as env var; RYASA exclusion stays as-is; LUBRIOR (PO0084794, PO0083854) works correctly (client email was unnecessary); "Provider with external ID does not exist" was a data-entry error (provider code entered instead of external ID).
- **New code change — RETRY-C7 (folded into 20.1):** the OC `NOT EXISTS` dedupe excluded only `POSTED`; a closed OC's `fesaOCFocaltec` row transitions `POSTED → CLOSED` (via `PortalOC_Closer.js`), so the rolling-30-day scope re-selects it → 409 → ERROR. Fix: `status = 'POSTED'` → `status IN ('CLOSED','POSTED')` in `PortalOC_Creator.js` (cron) + `retry-month-pos.js` (preview). Payments and the `background.js` EOM query are unaffected. SPEC + plans 20.1-02 / 20.1-03 amended 2026-07-22 (SPEC Amendment log has the full rationale).
- **Now IN scope for the single deploy (per the 2026-07-22 todo-junto directive — no longer deferred):** (1) Q3 consolidated per-batch failure email incl. control-table `responseAPI` as the error description; (2) cross-system detection query (409/portal-existence hybrid). The 2026-07-22 read-only branch review confirmed **neither exists** — no reusable code in Fernanda's Dec-2025 branches (they check the local control table only; there is **no portal GET for OCs anywhere**). Both need their own spec/plan before the August deploy. **#2 unblocked (2026-07-23):** the repo Focaltec swagger confirms `GET /purchase-orders?external_ids=<ocSage>` + `status` filters exist — no external dependency. (Santiago handles business rules only, not dev; all technical questions are resolved internally. Retry-package business rules are already decided, so nothing is pending with him.)
- **Separate work streams (not 20.1):** manual sync button (own branch), publish localhost via Bastion (Jorge/Alan IT), Fractal article-load query (send to Santiago).
- **Deploy note:** targeted for **after the first week of August 2026** (per Yahir, 2026-07-22) — which falls after the Capstone month-close window (≈ day 25/28 → Aug 3/4), so no conflict. Code (execute + verify 20.1) can be ready now; hold the push + prod deploy for the August window with lead OK. Gates: lead OK + notify Memo + `EOM_NOTIFICATION_ENABLED=false` (the old Phase-20 EOM must stay off until Q3 is built).

**Deploy model (2026-07-22 — Yahir):** **todo junto** — ONE single deploy of the full retry + notification release (Q1 + Q2 + CLOSED + Q3 + 409). NOT Q1+Q2 alone. Because Q3 replaces the old Phase-20 EOM, `EOM_NOTIFICATION_ENABLED=false` is no longer needed. Full status/tracker: `.planning/phases/20.1-retry-policy-correction/20.1-RELEASE-STATUS.md`.

**Status:** Phase complete — ready for verification

## Deferred Items

Items acknowledged and deferred at milestone close on 2026-04-29:

| Category | Item | Status |
|----------|------|--------|
| todo | 2026-04-16-fix-uploadpayments-lookback-to-prevent-missed-payments | absorbed into v2.4 Phase 20 (RETRY-02) |
| todo | 2026-04-16-support-partial-payment-completion-for-incomplete-uploads | absorbed into v2.4 Phase 21 (PARTIAL-01..03) |

**Quick Tasks Completed (pre-v2.3-deploy fixes):**

| Quick ID | Description | Date | Commits | Notes |
|----------|-------------|------|---------|-------|
| 260502-i7l | validate XML providers + error reports | 2026-05-02 | 7bb2f63, aaa733e, 43d4fde | path-b chosen — extracted sendAdminAlert + findLastOpenStep to src/utils/AdminEmailSender.js with callerLogFile param (closes PATTERNS.md §S-6 3rd-use trigger). Closed 2 blind spots in XML proveedores flow: (1) GetProviders re-throw on portal error, (2) buildProvidersXML try/catch + post-write validation. 9 new tests, 0 regressions. |
| 260513-ket | drop PORHSTAT from po-cron-diagnostic POPORH1 lookup | 2026-05-13 | 14637bf | closes GH issue #24 — `PORHSTAT` no existe en COPDAT schema; prod run 2026-05-12 emitió `Invalid column name`; safeRun lo enmascaró pero `existsInPOPORH1` quedaba `null` en vez de `true`. Fix: 3 líneas removidas (verdict initializer, columna del SELECT, lectura) + ajuste de coma. Diff: `1 insertion, 4 deletions`. 0 tests tocados (no había cobertura del script). Branch: `fix/po-cron-diagnostic-porhstat`. |

**Non-blocking follow-ups from v2.3 (recommendations, not REQs):**

- AbortController retrofit completo — defer hasta evidencia operacional muestre necesidad concreta. Phantom continuation NARROWED a step-level only es la forma actual.
- `apiCall` toast suppression para force-release call site (Plan 18-03 minor follow-up; UI-SPEC L123 prescribe "no toast — inline only" pero shared.js helper fires generic toast on every failed fetch)
- Otros 8 axios callsites enrichment con `[TIMEOUT]` log entries (Plan 19-03 enriqueció solo PortalPaymentController.js como ejemplo cross-cutting)
- `scripts/obfuscate.js` allowlist → blocklist refactor (PR #20 retrospective)
- ~~`sendAdminAlert` + `findLastOpenStep` extraction a `src/utils/AdminEmailSender.js`~~ ✓ resolved 2026-05-02 via quick-260502-i7l (3rd-use trigger fired; both helpers extracted with callerLogFile param preserving log routing)

## Blockers/Concerns

- No Sage DB access locally: SQL query changes can only be validated structurally
- No repro local del bug-class always-on: requiere prod (ZCL-RDS-02) o simulación con mocks
- Servy como Windows service no tiene sesión de escritorio: child-process GUI puede colgarse (mitigado por Plan 19-02 kill cascade en v2.3)
- Phase 21 blocked on Focaltec sandbox transcript (PARTIAL-02) before `/gsd-plan-phase 21` — engineering verification step is part of the SPEC gate, not the plan gate
- **Phase 20 plan-phase override (2026-05-15)**: decision-coverage gate (§13a) reported 10/16 D-NN IDs not literally cited in plans (D-01, D-02, D-04, D-06, D-07, D-08, D-13, D-14, D-15, D-16). User selected "Proceed anyway" because plan-checker (iteration 2) explicitly verified each decision is addressed in substance — the gap is a literal-citation mismatch, not a real coverage gap. `/gsd-verify-work 20` should re-confirm decision coverage post-execution; if any D-NN was actually dropped during execution it will surface there.

## Session Continuity

Last session: 2026-07-27T17:02:14.671Z
Session result: `/gsd-complete-milestone v2.3` workflow completed. Pre-close audit found 2 unrelated payment-upload todos → user chose **Acknowledge & defer** (recorded under Deferred Items). Archive files created: `.planning/milestones/v2.3-ROADMAP.md` (full phase details + 17 key decisions + accomplishments + boundary lifting summary) and `.planning/milestones/v2.3-REQUIREMENTS.md` (14/14 REQs marked complete with traceability). MILESTONES.md entry added with stats (3 phases, 10 plans, 89 commits, 6 days, 14 REQs, 17/17 threats). ROADMAP.md reorganized with milestone groupings (collapsible `<details>` sections per milestone). PROJECT.md evolved: 9 v2.3 requirements moved to Validated, "Current Milestone" section replaced with "Recently Shipped" outcome summary, 17 new Key Decisions appended, footer updated. RETROSPECTIVE.md appended with v2.3 milestone section (what worked, what was inefficient, patterns established, key lessons), Cross-Milestone Trends tables updated, Top Lessons extended (3 → 7). STATE.md cleared and reset (decisions log moved to PROJECT.md). Safety commit `9651348 chore: archive v2.3 milestone files`. REQUIREMENTS.md removed via `git rm` (history preserved, fresh for next milestone). Git tag v2.3 created. Branching strategy "none" per init — no branch operations.
Stopped at: Phase 20.1 fully executed — 20.1-03 (operator-script caller-audit tail) complete, `npm test` back to the 6-suite / 7-test pre-existing baseline
Resume next: `/gsd-verify-work 20.1`. Two items are queued for it: (a) the milestone `REQUIREMENTS.md` reconciliation flagged by 20.1-01 (RETRY-04 / RETRY-05 describe the geometric curve and backoff env vars this phase deliberately removed, and `RETRY-C*` IDs are not tracked there); (b) the out-of-scope RETRY-C7 third site logged in `.planning/phases/20.1-retry-policy-correction/deferred-items.md` (`po-cron-diagnostic.js` section-4 cron replica still dedupes on POSTED only). Post-deploy operator checks for the phase: run `node src/scripts/po-cron-diagnostic.js <PO>` and both `retry-month-*` dry-runs on `ZCL-RDS-02` — there is no local Sage DB, so live script output could not be observed here.
Earlier context (Phase 20 execution notes): re-run `/gsd-execute-phase 20` in a session launched with `SAGECONNECT_HOOKS_BYPASS=1` exported. Nothing has executed yet (0 SUMMARY.md files) — execution will start fresh from Wave 1. Two hook issues were handled on 2026-05-15: (1) `pre-edit-gsd-guard.sh` had a real bug — its active-phase detection used literal filenames (`SPEC.md`) and missed numbered artifacts (`20-SPEC.md`); fixed in commit `0ceb4c4` to glob-match. (2) `pre-edit-critical.sh` is friction-by-design (guards 13 load-bearing files); Phase 20 edits 2 of them (`src/config.js` via 20-01, `src/background.js` via 20-07) — user chose to clear it via session-level `SAGECONNECT_HOOKS_BYPASS=1` (covers `pre-edit-critical.sh` + `pre-write-always-on.sh`; `pre-edit-gsd-guard.sh` now passes on its own). `workflow.use_worktrees` was set to `false` because the Agent worktree isolation forked stale at `origin/master` (11 commits behind) and could not see the plan files — the restarted run executes sequentially on the main checkout. To restore worktree parallelism later: push `master` to origin so worktrees fork current, then `gsd-sdk query config-set workflow.use_worktrees true`.
