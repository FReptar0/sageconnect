---
phase: 8
slug: scheduler-real-time-layer
status: draft
nyquist_compliant: false
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
| **Quick run command** | `npx jest tests/api/scheduler.test.js tests/services/OperationManager.test.js --no-coverage` |
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
| 08-01-01 | 01 | 1 | INFRA-04, INFRA-05 | unit | `npx jest tests/services/OperationManager.test.js -x` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | SYS-04, SYS-05 | integration | `npx jest tests/api/scheduler.test.js -x` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 2 | SYS-01, SYS-02, SYS-03 | integration | `npx jest tests/api/scheduler.test.js -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm install node-cron` — scheduler dependency
- [ ] `tests/services/OperationManager.test.js` — covers lock/unlock, 409 on collision, progress events
- [ ] `tests/api/scheduler.test.js` — covers /schedule, /schedule/history, /schedule/:taskId/trigger, /operations/status, SSE stream

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cron fires at scheduled interval | INFRA-04 | Time-based behavior | Set CRON_SCHEDULE='*/1 * * * *', wait 1 min, check logs |
| SSE reconnection after network drop | SYS-05 | Network-level behavior | Open SSE stream, kill/restart server, verify reconnect |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
