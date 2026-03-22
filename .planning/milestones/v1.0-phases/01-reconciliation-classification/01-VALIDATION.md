---
phase: 1
slug: reconciliation-classification
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npx jest tests/PaymentReconciliation.test.js -x` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest tests/PaymentReconciliation.test.js -x`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | RSOL-01 | unit | `npx jest tests/PaymentReconciliation.test.js -t "auto-resolve" -x` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | RSOL-02 | unit | `npx jest tests/PaymentReconciliation.test.js -t "reclassify" -x` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | PROV-01 | unit | `npx jest tests/PaymentReconciliation.test.js -t "mismatch" -x` | ❌ W0 | ⬜ pending |
| 01-01-04 | 01 | 1 | PROV-02 | unit | `npx jest tests/PaymentReconciliation.test.js -t "mismatch" -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/PaymentReconciliation.test.js` — test stubs for RSOL-01, RSOL-02, PROV-01, PROV-02
- [ ] Mocks for `resolveProviderIdByExternalId`, `getProviderByExternalId`, `runQuery`, `getPendingToPayInvoices`
- [ ] Extract classification logic from `main()` into testable exported function

*Note: The classification logic is inside an unexported `main()` function. Extraction into a testable function is required for Wave 0.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Auto-resolution writes to Sage APVENO | RSOL-01 | No Sage DB access locally | Verify SQL structure in unit test; actual DB write verified in integration environment |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
