---
phase: 6
slug: infrastructure-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-23
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npx jest --testPathPattern=tests/ --no-coverage` |
| **Full suite command** | `npx jest --no-coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --testPathPattern=tests/ --no-coverage`
- **After every plan wave:** Run `npx jest --no-coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | INFRA-03 | unit | `npx jest tests/SQLServerConnection.test.js -x` | Yes (placeholder) | ⬜ pending |
| 06-02-01 | 02 | 2 | INFRA-02 | unit (static) | `npx jest tests/no-process-exit.test.js -x` | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 3 | INFRA-01 | unit | `npx jest tests/envelope-contract.test.js -x` | ❌ W0 | ⬜ pending |
| 06-03-02 | 03 | 3 | INFRA-01 | unit | `npx jest tests/helpers/result-envelope.test.js -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/envelope-contract.test.js` — validates every exported script function returns correct envelope shape
- [ ] `tests/no-process-exit.test.js` — static analysis: grep src/ for process.exit outside require.main guards and config.js
- [ ] `tests/SQLServerConnection.test.js` — rewrite existing placeholder: mock mssql, verify singleton, USE [database], error listener
- [ ] `tests/helpers/result-envelope.test.js` — unit tests for createResult/successResult/errorResult helpers

*Existing infrastructure partially covers: SQLServerConnection.test.js exists but is a placeholder.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pool auto-reconnect on connection drop | INFRA-03 | Requires killing SQL Server connection mid-query | Kill SQL Server connection, verify pool reconnects and next query succeeds |
| CLI backward compatibility | INFRA-01 | Requires running scripts with actual args | Run `node src/scripts/po-diagnostic.js 123 COPDAT` and verify console output unchanged |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
