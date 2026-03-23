---
phase: 02
slug: batch-upload-robustness
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npx jest tests/PaymentReconciliation.test.js -x` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest tests/PaymentReconciliation.test.js -x`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | BTCH-01, BTCH-02 | unit | `npx jest tests/PaymentReconciliation.test.js -t "BTCH" -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New test describe blocks in `tests/PaymentReconciliation.test.js` for BTCH-01 and BTCH-02
- [ ] Mocks for `axios.post` response (success, partial failure, full failure, missing results)
- [ ] Test fixture helpers for batch response objects (similar to `makePaymentHdr`, `makeInvoice`)
- [ ] Extract upload logic into exported function for direct testing (same pattern as Phase 1 `classifyPayments`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Actual API batch response completeness | BTCH-01 | Requires live portal sandbox | Run `--upload` against sandbox with test payments, verify summary output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
