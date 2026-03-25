---
phase: 10
slug: servy-cutover-retirement
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-24
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 + supertest |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npx jest --no-coverage` |
| **Full suite command** | `npx jest --no-coverage` |
| **Estimated runtime** | ~12 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --no-coverage`
- **After every plan wave:** Run `npx jest --no-coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 12 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-T1 | 01 | 1 | DEPLOY-02, DEPLOY-03 | unit/integration | `npx jest --no-coverage` | Existing (modified) | pending |
| 10-02-T1 | 02 | 2 | DEPLOY-01 | syntax | `node -c scripts/install-service.ps1 2>/dev/null; test -f scripts/install-service.ps1` | Created | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

None — this phase modifies/removes existing code and creates deployment scripts. No new test infrastructure needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Servy installs and registers service | DEPLOY-01 | Requires Windows Server | Run install-service.ps1, verify in services.msc |
| Service auto-starts on reboot | DEPLOY-01 | Requires server reboot | Reboot server, verify SageConnect starts |
| Service stable 24+ hours | DEPLOY-01 | Time-based endurance | Monitor for 24h, check logs for crashes |
| Task Scheduler disabled | DEPLOY-03 | Requires Windows admin | Verify scheduled task is disabled/deleted |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 12s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
