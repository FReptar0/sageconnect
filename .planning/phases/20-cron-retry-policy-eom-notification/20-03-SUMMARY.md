---
phase: 20-cron-retry-policy-eom-notification
plan: 03
subsystem: utils
tags: [eom-notification, sentinel, html-email, helpers, tdd]
requires: []
provides:
  - "src/utils/EomNotification.js — shouldDispatchEom, buildEomEmailHtml, writeSentinelAtomically, readSentinelPayload"
  - "tests/fixtures/eom-email-sample.html — deterministic EOM HTML snapshot fixture"
affects:
  - "Wave 2 background.js EOM gate (composes these 4 helpers)"
tech-stack:
  added: []
  patterns:
    - "Clock injection via `now` first arg (D-16) — no jest.useFakeTimers"
    - "Atomic sentinel write: tmp + fs.renameSync (D-07, POSIX atomicity)"
    - "Pure-helper module + fs side effects, stateless (CLAUDE.md §3)"
key-files:
  created:
    - src/utils/EomNotification.js
    - tests/utils/EomNotification.test.js
    - tests/fixtures/eom-email-sample.html
  modified: []
decisions:
  - "Local-time Date semantics for the gate — getDate()/getHours() use runtime TZ, matching production new Date() and operator-timezone gate intent (D-16 option a)"
  - "escapeHtml() applied to all dynamic table-cell data — defense vs T-20-14 HTML injection"
metrics:
  duration: 159s
  completed: 2026-05-15
---

# Phase 20 Plan 03: EOM Notification Helpers Summary

End-of-month operator-email foundation: a stateless `src/utils/EomNotification.js` exporting the clock-injected dispatch gate, a deterministic HTML body builder, and atomic sentinel read/write helpers — fully unit-tested with a snapshot fixture.

## What Was Built

- **`shouldDispatchEom(now, sentinelPath, eomConfig)`** — gate returning `true` only when EOM is enabled, `now` is the last calendar day of its month, the hour meets the threshold, and the sentinel is absent. Kill-switch (`notificationEnabled === false`) short-circuits before any other check (EOM-05). Fail-closed on malformed input.
- **`buildEomEmailHtml(rows, category)`** — deterministic HTML body. Non-empty rows render a 6-column table; empty rows render the literal "Sin pendientes en esta categoría este mes" (D-10). `lastError` truncated to 100 chars; all cell data HTML-escaped. Footer links default to `http://localhost:3030` (config has no `app.baseUrl`).
- **`writeSentinelAtomically(path, payload)`** — `fs.mkdirSync(recursive)` + write `.tmp` + `fs.renameSync` into place (D-07). Throws on rename failure.
- **`readSentinelPayload(path)`** — parsed JSON or `null` on missing/malformed; never throws.
- **`tests/fixtures/eom-email-sample.html`** — byte-identical snapshot fixture (new `tests/fixtures/` directory).
- **`tests/utils/EomNotification.test.js`** — 15 tests: 9 truth-table (8 combos + kill-switch), 4 sentinel I/O (round-trip, missing, malformed, rename re-throw), 2 HTML (snapshot + empty-category).

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | EomNotification.js + snapshot fixture | dd89a8c | src/utils/EomNotification.js, tests/fixtures/eom-email-sample.html |
| 2 | EomNotification test suite | 0cc3ecb | tests/utils/EomNotification.test.js |

## Deviations from Plan

### Verification adjustment (not a code deviation)

The plan's Task 1 `<verify>` probe (line 209) constructs gate dates from UTC ISO strings (`new Date('2026-05-31T18:05:00Z')`). The runtime is UTC-6, so those strings shift to May 31 12:05 local — `getHours()` returns 12, below the threshold 18, and the positive case fails. The plan itself resolves this in Task 2 guidance (lines 310-318): the canonical decision is D-16 **option (a)** — local-time `Date` constructors, because production `background.js` calls `new Date()` (also local-time) and the gate semantics are "last calendar day in the operator's timezone". The probe was re-run with local-time dates (`new Date(2026, 4, 31, 18, 5, 0)`) and passed all 5 branches. No code change was needed — `shouldDispatchEom` correctly uses local-time `getDate()`/`getHours()` as the plan's `<behavior>` block specifies. The test file uses local-time constructors throughout, matching D-16 option (a).

## Verification Results

- `node -c src/utils/EomNotification.js` — syntax OK.
- Gate + sentinel round-trip probe (local-time dates) — "OK gate+sentinel".
- `npx jest tests/utils/EomNotification.test.js` — 15/15 passed.
- `npm test` — 6 failed suites / 7 failed tests — identical to the pre-phase baseline (CLAUDE.md §6 #3). Passed count includes the 15 new tests. No regressions.
- All source assertions pass: 4 exports, 4 functions, tmp+rename pattern, recursive mkdir, empty-category message, zero third-party names, fixture token coverage.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/utils/EomNotification.js
- FOUND: tests/utils/EomNotification.test.js
- FOUND: tests/fixtures/eom-email-sample.html
- FOUND commit: dd89a8c
- FOUND commit: 0cc3ecb
