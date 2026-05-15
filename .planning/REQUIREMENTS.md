# Requirements: SageConnect v2.4 Retry policies

**Defined:** 2026-05-13
**Core Value:** La integración Sage-Portal debe ser confiable, mantenible, y operable: servicio continuo con interfaz web para operaciones y monitoreo en tiempo real.

## v2.4 Requirements

Requirements for milestone v2.4 — "Retry policies". Each maps to a roadmap phase (see Traceability below). Closes GitHub issues #21, #22, #23.

### Retry (cron WHERE rewrites + backoff)

- [x] **RETRY-01**: Cron lifts a PO whose latest authorization (`MAX(Autoriza_OC_detalle.Fecha)`) falls within the current calendar month, replacing the today-only filter in `src/controller/PortalOC_Creator.js`.
- [ ] **RETRY-02**: Cron lifts a payment whose latest authorization falls within the current calendar month, replacing the fixed lookback window in the payment uploader (`src/controller/PortalPaymentController.js`).
- [ ] **RETRY-03**: Operator can switch retry scope from "current calendar month" to a rolling N-day window via env vars `RETRY_SCOPE` (values: `current_month` | `last_n_days`) and `RETRY_LOOKBACK_DAYS` (used only when `RETRY_SCOPE=last_n_days`).
- [x] **RETRY-04**: When a PO or payment upload fails, subsequent retries follow exponential backoff (15min → 30min → 1h → 2h → ...) capped at 24h. Backoff state is derived from existing rows in `fesa.dbo.fesaOCFocaltec` / `fesa.dbo.fesaPagosFocaltec` — `COUNT(*) WHERE status='ERROR'` for attempt count, `MAX(lastUpdate) WHERE status='ERROR'` for last attempt time. No schema change.
- [ ] **RETRY-05**: Backoff parameters are configurable via env vars `RETRY_BACKOFF_INITIAL_MIN` (default `15`), `RETRY_BACKOFF_MULTIPLIER` (default `2`), and `RETRY_BACKOFF_MAX_MIN` (default `1440`), with range guards at startup (`src/config.js`).
- [x] **RETRY-06**: Cron's new WHERE never selects a PO or payment that already has a `status='POSTED'` row in fesa.* (avoids duplicate Focaltec submissions).
- [ ] **RETRY-07**: The `po-cron-diagnostic.js` script's verdict logic is updated to reflect the new retry rule — the resumen explains backoff state (attempts so far, next-eligible time) not just the date filter.

### EOM Notification (end-of-month email)

- [x] **EOM-01**: On the last calendar day of the month, the first cron tick at or after `EOM_NOTIFICATION_HOUR` (default `18`) sends a consolidated email listing all POs and pagos in scope that do not yet have a `POSTED` row in fesa.*.
- [x] **EOM-02**: The email is sent to addresses in `MAILING_NOTICES` env (operator mailbox) with `MAILING_CC` as CC. NOT to `LICENSE_ADMIN_EMAIL` (this is operator reporting, not service alerting).
- [x] **EOM-03**: Email body is HTML with two tables (POs / pagos pendientes): item number, tenant, fecha de autorización, attempts count, último error de Focaltec. Footer includes links to `/pos.html` and `/payments.html`.
- [x] **EOM-04**: Idempotency: the email is sent at most once per category (POs / pagos) per calendar month. Sentinel file `logs/eom-{YYYY-MM}-{pos|payments}.sent` is created on first send and checked before subsequent attempts.
- [ ] **EOM-05**: Operator can disable EOM notification entirely via `EOM_NOTIFICATION_ENABLED` env (default `true`). Kill-switch is checked at the cron-tick gate before any computation.
- [x] **EOM-06**: `src/utils/EmailSender.js` is extended (not duplicated) with a new export (e.g. `sendOperatorReport({to, cc, subject, html})`) following PATTERNS.md §S-6 — this is the 3rd operator-mailbox use after `EmailSender.sendMail` and any future caller.

### Partial Payment Completion (multi-CFDI policy)

- [ ] **PARTIAL-01**: When a multi-CFDI payment upload fails partway through (some CFDIs uploaded, others not), the service follows a policy chosen via env `PARTIAL_PAYMENT_POLICY` with three valid values: `atomic` (mark the entire payment ERROR and surface to operator), `resume` (retry only the unfinished CFDIs), `idempotent` (re-POST the whole payment relying on Focaltec dedupe by `external_id`).
- [ ] **PARTIAL-02**: Engineering confirms Focaltec deduplication semantics on `external_id` via the Focaltec sandbox before Phase 21 leaves `/gsd-spec-phase`. The sandbox check produces evidence (request/response transcript) attached to the phase's SPEC.md.
- [ ] **PARTIAL-03**: The default `PARTIAL_PAYMENT_POLICY` value is set in `.env.example` based on the sandbox outcome: `idempotent` if Focaltec dedupes reliably, `atomic` if it does not. A short comment in `.env.example` references the SPEC evidence link.

## Future Requirements (v2.5+)

Deferred to a later milestone. Tracked but not in current roadmap.

### Backlog from v2.3 closure

- **AbortController retrofit completo** — sustituir Promise.race phantom continuation con real abort en wrapped promise. Defer hasta evidencia operacional muestre necesidad concreta.
- **Otros 8 axios callsites enrichment con `[TIMEOUT]` log entries** — Plan 19-03 sentó el ejemplo en PortalPaymentController.js; replicar al resto.
- **`apiCall` toast suppression para force-release call site** — UI-SPEC L123 ya prescribe "no toast — inline only".
- **Dashboard de operaciones con historial detallado por tenant** — visibility post-v2.3 nice-to-have.
- **Alertas proactivas (Slack/email) cuando un cycle excede N min** — operator-facing latency alarms.
- **`scripts/obfuscate.js` allowlist → blocklist refactor** — PR #20 retrospective.

## Out of Scope (v2.4)

Explicitly excluded from this milestone. Documented to prevent scope creep.

| Item | Reason |
|------|--------|
| Schema changes to `fesa.dbo.fesaOCFocaltec` / `fesa.dbo.fesaPagosFocaltec` | User constraint: "hay forma de hacerlo sin cambiar algo en la base de datos?" — yes, derive everything from existing rows. |
| New control table for attempt history | Same — derivable from `COUNT(*) WHERE status='ERROR'` on existing rows. |
| Backfill of pre-cambio orphan POs/pagos as a script | If desired, opens as a v2.5 follow-up. First cron tick post-deploy already lifts everything in current-month scope; that's the implicit backfill. |
| Dashboard UI for retry visibility (attempts column on `/pos.html`, `/payments.html`) | Nice-to-have. Listed under v2.5 backlog (already part of "dashboard histórico por tenant"). |
| REST endpoint for forcing retry of a specific PO/pago | Operator can run existing `po-upload.js` / equivalent payment script. New endpoint = new auth surface; not justified. |
| Real-time notification (Slack/Teams) on retry failure | Email-only (matches existing channel discipline). Slack belongs to v2.5 "alertas proactivas". |
| Changing Focaltec API contract or requesting new endpoints | Out of our control. PARTIAL-02 only verifies existing dedupe semantics. |
| Cron cadence change | Stays every 15 min (CLAUDE.md §3 / §9 defense-in-depth tier). |

## Traceability

Maps each requirement to its roadmap phase. Filled in during ROADMAP creation; column updated through execution.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RETRY-01 | Phase 20 | Complete |
| RETRY-02 | Phase 20 | Pending |
| RETRY-03 | Phase 20 | Pending |
| RETRY-04 | Phase 20 | Complete |
| RETRY-05 | Phase 20 | Pending |
| RETRY-06 | Phase 20 | Complete |
| RETRY-07 | Phase 20 | Pending |
| EOM-01 | Phase 20 | Complete |
| EOM-02 | Phase 20 | Complete |
| EOM-03 | Phase 20 | Complete |
| EOM-04 | Phase 20 | Complete |
| EOM-05 | Phase 20 | Pending |
| EOM-06 | Phase 20 | Complete |
| PARTIAL-01 | Phase 21 | Pending |
| PARTIAL-02 | Phase 21 | Pending |
| PARTIAL-03 | Phase 21 | Pending |

## Cross-references

- **GitHub issues closed by this milestone:** [#21](https://github.com/FReptar0/sageconnect/issues/21) (closes via RETRY-01, RETRY-03..07), [#22](https://github.com/FReptar0/sageconnect/issues/22) (closes via RETRY-02, RETRY-03..07), [#23](https://github.com/FReptar0/sageconnect/issues/23) (closes via PARTIAL-01..03).
- **Quick task referenced:** quick-260512-7ea (po-cron-diagnostic, evidence source) and quick-260513-ket (PORHSTAT fix, prerequisite for accurate verdicts).
- **Constraint sources:** `CLAUDE.md` §0 (production-safety), §3 (always-on), §6 (pitfalls — SQL injection density, `runQuery` default trap), §9 (defense-in-depth invariant); `HANDOFF.md` §1 (redaction), §6 (dry-run default + no local DB), §7 (double verification at portal + control table).
