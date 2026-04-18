---
phase: 8
slug: scheduler-real-time-layer
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-23
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 + supertest |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npx jest tests/services/operation-manager.test.js tests/services/cron-scheduler.test.js tests/api/schedule-routes.test.js tests/api/operations-routes.test.js --no-coverage` |
| **Full suite command** | `npx jest --no-coverage` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest tests/api/ tests/services/ --no-coverage`
- **After every plan wave:** Run `npx jest --no-coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-T1 | 01 | 1 | INFRA-04, SYS-04 | unit (TDD) | `npx jest tests/services/operation-manager.test.js --no-coverage -x` | Created in task | pending |
| 08-02-T1 | 02 | 2 | INFRA-04, INFRA-05 | unit (TDD) | `npx jest tests/services/cron-scheduler.test.js --no-coverage -x` | Created in task | pending |
| 08-02-T2 | 02 | 2 | INFRA-04 | syntax | `node -c src/index.js` | Existing file | pending |
| 08-03-T1 | 03 | 2 | SYS-01..SYS-05 | integration (TDD scaffolds) | `node -c tests/api/schedule-routes.test.js && node -c tests/api/operations-routes.test.js` | Created in task | pending |
| 08-03-T2 | 03 | 2 | SYS-01..SYS-05 | integration (GREEN) | `npx jest tests/api/schedule-routes.test.js tests/api/operations-routes.test.js --no-coverage -x` | Created in T1 | pending |

*Status: pending -- green -- red -- flaky*

---

## Wave 0 Requirements

- [ ] `npm install node-cron` — scheduler dependency (Plan 01, Task 1)
- [ ] `tests/services/operation-manager.test.js` — covers lock/unlock, 409 on collision, progress events (Plan 01, Task 1 TDD)
- [ ] `tests/services/cron-scheduler.test.js` — covers scheduler init, lock lifecycle, history recording (Plan 02, Task 1 TDD)
- [ ] `tests/api/schedule-routes.test.js` — covers /schedule, /schedule/history, /schedule/:taskId/trigger (Plan 03, Task 1 TDD scaffold)
- [ ] `tests/api/operations-routes.test.js` — covers /operations/status, SSE stream (Plan 03, Task 1 TDD scaffold)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cron fires at scheduled interval | INFRA-04 | Time-based behavior | Set CRON_SCHEDULE='*/1 * * * *', wait 1 min, check logs |
| SSE reconnection after network drop | SYS-05 | Network-level behavior | Open SSE stream, kill/restart server, verify reconnect |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
