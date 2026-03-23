---
phase: 7
slug: rest-api-security
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-23
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 + supertest |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npx jest tests/api/ --no-coverage` |
| **Full suite command** | `npx jest --no-coverage` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest tests/api/ --no-coverage`
- **After every plan wave:** Run `npx jest --no-coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 8 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | SEC-01..04 | integration | `npx jest tests/api/security.test.js -x` | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 2 | PAY-01..07 | integration | `npx jest tests/api/payment-routes.test.js -x` | ❌ W0 | ⬜ pending |
| 07-03-01 | 03 | 2 | PO-01..08 | integration | `npx jest tests/api/po-routes.test.js -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm install --save-dev supertest` — HTTP assertion library
- [ ] `npm install helmet cors express-rate-limit` — security dependencies
- [ ] `tests/api/` directory created
- [ ] `tests/api/security.test.js` — covers SEC-01..SEC-04 (helmet headers, CORS, rate-limit, API key)
- [ ] `tests/api/payment-routes.test.js` — covers PAY-01..PAY-07 (mocked script functions)
- [ ] `tests/api/po-routes.test.js` — covers PO-01..PO-08 (mocked script functions)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Rate limit actual window timing | SEC-03 | Time-based behavior hard to test | Send 11 rapid POST requests, verify 429 response |
| Dashboard still works after helmet | SEC-01 | Visual rendering test | Open http://localhost:3030 and verify dashboard loads |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 8s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
