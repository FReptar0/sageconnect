---
phase: 20-cron-retry-policy-eom-notification
plan: 04
subsystem: email-notification
tags: [email, operator-channel, eom-notification, helper-extension]
requires:
  - "src/utils/EmailSender.js (existing sendMail export)"
  - "src/utils/AdminEmailSender.js (analog shape — sendAdminAlert)"
  - "config.mailing.{notices,cc,from,server,port,ssl,password}"
provides:
  - "EmailSender.sendOperatorReport({subject, html, callerLogFile}) — operator-channel email helper"
affects:
  - "Wave 2 background.js EOM gate (20-08) — will call sendOperatorReport"
tech-stack:
  added: []
  patterns:
    - "callerLogFile log-routing pattern (mirrors AdminEmailSender, quick-260502-i7l)"
    - "SMTP-failure swallow contract (warn log, no throw)"
key-files:
  created: []
  modified:
    - "src/utils/EmailSender.js"
    - "tests/EmailSender.test.js"
decisions:
  - "Copy-paste transportConfig verbatim (CONTEXT §code_context — 2 callers does NOT trigger §S-6 third-use extraction)"
metrics:
  duration: "~8 min"
  completed: "2026-05-15"
  tasks: 2
  files: 2
---

# Phase 20 Plan 04: EmailSender sendOperatorReport Extension Summary

Extended `src/utils/EmailSender.js` with `sendOperatorReport({subject, html, callerLogFile})` — an operator-channel HTML email helper that sends to the full `MAILING_NOTICES` list with `MAILING_CC` as CC, swallows SMTP failures (warn log), and routes `[OPERATOR-EMAIL]` log entries via `callerLogFile`. Mirrors `AdminEmailSender.sendAdminAlert` shape exactly per CONTEXT D-06. This is the Wave 1 foundation the Wave 2 background.js EOM gate (20-08) will call to dispatch end-of-month consolidated emails.

## What Was Built

### Task 1 — sendOperatorReport export (commit 052060f)
- New `async function sendOperatorReport({ subject, html, callerLogFile })` added after `sendMail`, before `module.exports`.
- `logFile = callerLogFile || 'EmailSender'` fallback (same shape as `sendAdminAlert`'s `'AdminEmailSender'` fallback).
- Builds `transportConfig` identically to existing `sendMail` (copy-paste verbatim per CONTEXT — 2 callers, no §S-6 extraction trigger).
- `to = config.mailing.notices.join(',')` — FULL list, NOT `notices[position]` (REQ EOM-02).
- `cc = config.mailing.cc || []`.
- Does NOT touch `config.license.adminEmail` — operator channel only (CONTEXT D-06).
- Success → `logGenerator(logFile, 'info', '[OPERATOR-EMAIL] Sent to ' + to + ': ' + subject)`.
- Failure → `logGenerator(logFile, 'warn', '[OPERATOR-EMAIL] Failed: ' + err.message)` — swallowed, no re-throw (REQ EOM-06).
- `module.exports = { sendMail, sendOperatorReport }`.
- Existing `sendMail` body untouched.

### Task 2 — test coverage (commit 13a3767)
- New `describe('sendOperatorReport')` block with 7 scenarios (a)-(g) covering: both exports present, full MAILING_NOTICES list, MAILING_CC full list, no LICENSE_ADMIN_EMAIL, SMTP-failure swallow, callerLogFile routing + 'EmailSender' fallback, sendMail regression.
- Extended the existing `jest.mock('../src/config')` block with full `mailing` + `license` shape (no removal).
- Added `nodemailer` + `LogGenerator` mocks to enable assertion of transport args + log routing.
- Existing `describe('sendMail util')` block (with `test.skip` integration test) preserved verbatim.

## Verification Results

- `node -c src/utils/EmailSender.js` — syntax OK.
- `node -e "require('./src/utils/EmailSender')"` — exits 0; both `sendMail` and `sendOperatorReport` are functions.
- `npx jest tests/EmailSender.test.js` — 8 passed (7 new + 1 skipped), 0 failed.
- `npm test` — 6 failed suites / 7 failed tests, matching the CLAUDE.md §6 baseline (`PaymentReconciliation`, `TransformTime`, `no-process-exit`, `enforcement-wiring` plus the env-dependent `config`/`po-routes` flakiness). No new failures introduced by this plan.
- `grep -niE "tersoft" src/utils/EmailSender.js tests/EmailSender.test.js` — 0 matches (HANDOFF.md §1 redaction).

### Note on full-suite non-determinism
An initial `npm test` run reported 8 failed suites / 9 failed tests due to a Jest worker child-process crash (`Jest worker encountered 4 child process exceptions`) — an infrastructure flake under parallel workers, unrelated to this change. A re-run produced the expected 6/7 baseline. `tests/EmailSender.test.js` itself passes deterministically in isolation.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/utils/EmailSender.js` — FOUND, contains `sendOperatorReport`.
- `tests/EmailSender.test.js` — FOUND, contains `describe('sendOperatorReport')`.
- Commit 052060f — FOUND.
- Commit 13a3767 — FOUND.
