---
phase: 20-cron-retry-policy-eom-notification
plan: 01
subsystem: config
tags: [config, env-vars, range-guards, retry-policy, eom-notification]
dependency_graph:
  requires: []
  provides:
    - "config.retry.{scope, lookbackDays}"
    - "config.retry.backoff.{initialMin, multiplier, maxMin}"
    - "config.eom.{notificationHour, notificationEnabled}"
    - "7 boot-time range guards with [CONFIG ERROR] fail-fast"
  affects:
    - "Wave 2 plans (PortalOC_Creator.js, PortalPaymentController.js, RetryPolicy.js, EomNotification.js) read from config.retry.* / config.eom.*"
tech_stack:
  added: []
  patterns:
    - "parseEnvNumber helper — applies default only on absent/empty env, so explicit 0/NaN reaches the range guard"
    - "range-guard fail-fast at boot (matches v2.3 timeout-guard pattern src/config.js:185-208)"
key_files:
  created: []
  modified:
    - "src/config.js"
    - ".env.example"
decisions:
  - "parseEnvNumber introduced to fix the parseInt(...) || default idiom swallowing explicit 0 (acceptance criteria require RETRY_BACKOFF_INITIAL_MIN=0 and RETRY_LOOKBACK_DAYS=0 to exit 1)"
metrics:
  duration: "~12 min"
  completed: "2026-05-15"
  tasks: 2
  files: 2
---

# Phase 20 Plan 01: Retry policy + EOM notification config foundation Summary

Added 7 customer-locked env vars to `src/config.js` under two new namespaces (`config.retry`, `config.eom`) with boot-time range-guard fail-fast, and documented them in `.env.example`. Wave 1 foundation — no code paths consume these envs yet (Wave 2 wires them into the cron WHERE rewrites and the EOM dispatch path).

## What Was Built

**Task 1 — `src/config.js`** (commit `1ce103f`)
- New `retry` namespace: `scope` (string-enum, default `current_month`), `lookbackDays` (int, default 30), `backoff.{initialMin:15, multiplier:2, maxMin:1440}`.
- New `eom` namespace: `notificationHour` (int, default 18), `notificationEnabled` (boolean, default `true`).
- 7 range-guard blocks appended after the existing 4 v2.3 timeout guards — each `console.error('[CONFIG ERROR] <ENV> ...')` + `process.exit(1)`.
- New `parseEnvNumber(raw, parser, def)` helper (see Deviations).
- Inline comments reference REQ IDs (RETRY-03 / RETRY-05 / EOM-01 / EOM-05) and `D-customer-confirmation`.

**Task 2 — `.env.example`** (commit `a8c5e66`)
- New `# ====== PHASE 20 — Retry policy + EOM notification ======` section appended after the LICENSE section.
- All 7 envs commented-out at customer-locked defaults; customer-confirmation note in the preamble.
- No third-party names (HANDOFF.md §1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `parseInt(...) || default` idiom swallowed explicit `0` and bypassed range guards**
- **Found during:** Task 1 verification.
- **Issue:** The PATTERNS.md locked text used `parseInt(process.env.X, 10) || default`. Because `0` is falsy, setting `RETRY_BACKOFF_INITIAL_MIN=0` or `RETRY_LOOKBACK_DAYS=0` produced the default (15 / 30) instead of reaching the `[1, N]` range guard. The plan's acceptance criteria explicitly require `RETRY_BACKOFF_INITIAL_MIN=0` and `RETRY_LOOKBACK_DAYS=0` to exit 1 with `[CONFIG ERROR]`. Acceptance criteria take precedence over the locked snippet.
- **Fix:** Added a `parseEnvNumber(raw, parser, def)` helper that applies the default only when the env var is absent/empty; an explicitly-set value (including `0` or `abc` → `NaN`) is passed through verbatim so the `Number.isInteger`/`Number.isFinite` range guard rejects it. Applied to all 5 numeric envs. String-enum (`scope`) and boolean (`notificationEnabled`) parsing unchanged.
- **Side benefit:** `EOM_NOTIFICATION_HOUR=0` (midnight, a valid hour) now correctly stays `0` instead of being overridden to `18`.
- **Files modified:** `src/config.js`
- **Commit:** `1ce103f`

## Test Gate Results

- `node -e "require('./src/config')"` with defaults → exit 0; exposes all 7 customer-locked defaults.
- All 8 invalid-value probes exit 1 with `[CONFIG ERROR] <ENV_NAME>` (scope, lookbackDays 0/400, initialMin 0/61, multiplier 0.5, maxMin 30/20000, hour 24).
- Boolean parse: `false`→`false`, `TRUE`→`true`.
- `npm test` → 6 failed suites / 7 failed tests / 418 passed — **unchanged** from the CLAUDE.md §6 #3 baseline. No new failures.

## Notes

- **Grep-count nuance (non-blocking):** Task 1 acceptance lists `grep -nE "config\.eom\b" src/config.js` returning `>= 4 matches`. The eom namespace + guards contain 4 `config.eom` *occurrences* across 3 *lines* (line 275 has two). `grep -n` counts lines (3); `grep -o | wc -l` counts occurrences (4). The EOM guard block is locked verbatim from PATTERNS.md and the functional acceptance criteria all pass — the intent (eom namespace wired + guarded) is fully satisfied.
- No new state-retaining primitives (CLAUDE.md §3) — all scalar config values.
- No new SQL sites (CLAUDE.md §6 #1) — these envs become safe interpolation sources for Wave 2.
- Untracked `sageconnect/2026-03-12/PaymentReconciliation-uploads.csv` appeared during `npm test` — a pre-existing test side-effect unrelated to this plan; left untracked, not committed (out of executor scope).

## Self-Check: PASSED

- `src/config.js` — FOUND, modified, syntax OK.
- `.env.example` — FOUND, modified.
- Commit `1ce103f` — FOUND.
- Commit `a8c5e66` — FOUND.
