---
status: testing
phase: 20-cron-retry-policy-eom-notification
source: [20-01-SUMMARY.md, 20-02-SUMMARY.md, 20-03-SUMMARY.md, 20-04-SUMMARY.md, 20-05-SUMMARY.md, 20-06-SUMMARY.md, 20-07-SUMMARY.md, 20-08-SUMMARY.md, 20-09-SUMMARY.md, 20-GAP-SUMMARY.md]
started: "2026-05-15T00:00:00Z"
updated: "2026-05-15T00:00:00Z"
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 1
name: Service boot with new Phase 20 config
expected: |
  Run `node -e "require('./src/config')"` (or `npm start`). The service boots
  with no `[CONFIG ERROR]`. The 7 new env vars resolve to the customer-locked
  defaults: config.retry.scope='current_month', lookbackDays=30,
  backoff.initialMin=15, backoff.multiplier=2, backoff.maxMin=1440,
  config.eom.notificationHour=18, config.eom.notificationEnabled=true.
awaiting: user response

## Tests

### 1. Service boot with new Phase 20 config
expected: Run `node -e "require('./src/config')"` or `npm start` — boots with no [CONFIG ERROR]; the 7 new env vars resolve to customer-locked defaults (retry.scope=current_month, lookbackDays=30, backoff 15/2/1440, eom hour=18, enabled=true).
result: [pending]

### 2. Config range guards reject invalid values
expected: Boot with a bad value (e.g. `RETRY_SCOPE=invalid`, or `RETRY_BACKOFF_INITIAL_MIN=0`, or `EOM_NOTIFICATION_HOUR=24`). The process exits with code 1 and prints `[CONFIG ERROR]` naming the offending env var. Defaults still apply when vars are unset.
result: [pending]

### 3. .env.example documents the 7 Phase 20 env vars
expected: Open `.env.example`. There is a Phase 20 section listing all 7 new vars (RETRY_SCOPE, RETRY_LOOKBACK_DAYS, RETRY_BACKOFF_INITIAL_MIN, RETRY_BACKOFF_MULTIPLIER, RETRY_BACKOFF_MAX_MIN, EOM_NOTIFICATION_HOUR, EOM_NOTIFICATION_ENABLED) at the customer-locked defaults, with a note referencing the 2026-05-15 customer confirmation.
result: [pending]

### 4. retry-month operator scripts run (dry-run default)
expected: Run `node src/scripts/retry-month-pos.js` and `node src/scripts/retry-month-payments.js`. Each runs in `--dry-run` mode by default (no `--apply`), prints an aligned table of POs/payments the new cron WOULD process, and writes a log file. No upload happens, no INSERT/UPDATE in fesa.* — log lines carry the `[DRY-RUN]` prefix. (Needs Sage DB access — mark blocked if running locally without it.)
result: [pending]

### 5. po-cron-diagnostic.js shows backoff state + new verdict
expected: Run `node src/scripts/po-cron-diagnostic.js PO0083449` (or any PO). Output includes the updated Section 4 (new cron WHERE replica) and a new Section 6 "Estado de backoff" reporting errorCount, lastErrorAt, backoffWaitMin, nextEligibleAt. The verdict follows the 5-priority order (POSTED / in-backoff / out-of-backoff / never-tried / out-of-scope). Script stays read-only. (Needs Sage DB access — mark blocked if running locally without it.)
result: [pending]

### 6. Test suite at documented baseline
expected: Run `npm test`. Result is 6 failed suites / 7 failed tests (the documented CLAUDE.md §6 #3 pre-existing baseline — PaymentReconciliation, TransformTime, no-process-exit, enforcement-wiring etc.) and ~466 passed including the ~48 new Phase 20 tests. No NEW failure introduced by Phase 20.
result: [pending]

### 7. PO cron picks up current-month authorizations (prod)
expected: After deploy, a PO authorized any day in the current calendar month — not just today — is selected by the cron WHERE on the next tick. The PO0083449-class orphan (authorized earlier in the month, previously skipped) gets uploaded without a manual `po-upload.js` run. Verify via `fesaOCFocaltec` rows + the `[CRON] retry-scope=...` log line. (Prod-only — needs a real cron tick against the Sage DB.)
result: [pending]

### 8. Payment cron WHERE + AUDTDATE fix select rows (prod)
expected: After deploy, the payment uploader's new WHERE runs without a SQL error. The AUDTDATE scope filter (gap-fix: `CONVERT(Date, CONVERT(VARCHAR(8), P.AUDTDATE))`) correctly selects payments authorized in the current month — no `Conversion of int to date out-of-range` error, no silently-empty recordset. (Prod-only — the highest-risk item; needs live Sage 300 schema confirmation per 20-VERIFICATION.md human-verification item 1.)
result: [pending]

### 9. End-of-month email + kill-switch (prod)
expected: On the last calendar day of the month after EOM_NOTIFICATION_HOUR (18:00), the first cron tick sends 2 HTML emails (POs / Pagos pendientes) to MAILING_NOTICES with MAILING_CC; sentinels `logs/eom-{YYYY-MM}-{pos,payments}.sent` are written; later ticks that month do not resend. Setting `EOM_NOTIFICATION_ENABLED=false` skips the gate entirely (`[EOM-SKIP] reason=enabled-false` in EomNotification.log). (Prod-only — time-gated to month-end + needs SMTP.)
result: [pending]

## Summary

total: 9
passed: 0
issues: 0
pending: 9
skipped: 0

## Gaps

[none yet]
