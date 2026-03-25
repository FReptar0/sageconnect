---
phase: 9
slug: operational-web-ui
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-24
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 + supertest (API), manual visual (HTML) |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npx jest tests/api/ --no-coverage` |
| **Full suite command** | `npx jest --no-coverage` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Verify HTML files load via `node -c` + route check
- **After every plan wave:** Run `npx jest --no-coverage`
- **Before `/gsd:verify-work`:** Full suite must be green + manual visual check
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-T1 | 01 | 1 | UI-08 | syntax + route | `node -e "require('./src/server')"` | Existing | pending |
| 09-02-T1 | 02 | 2 | UI-07 | syntax | `node -c public/schedule.html 2>/dev/null; test -f public/schedule.html` | Created | pending |
| 09-03-T1 | 03 | 2 | UI-01..03 | syntax | `test -f public/payments.html` | Created | pending |
| 09-04-T1 | 04 | 2 | UI-04..06 | syntax | `test -f public/pos.html` | Created | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

- [ ] Shared layout template / sidebar component pattern established (Plan 01)
- [ ] Shared JS module for API calls and tenant state (Plan 01)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Payment audit view renders 5 category cards | UI-01 | Visual rendering | Open /payments.html, verify 5 cards displayed with counts |
| Expandable row shows invoices | UI-03 | DOM interaction | Click a payment row, verify sub-table expands inline |
| PO diagnostic search works | UI-05 | User interaction | Type PO number in search bar, verify results appear |
| SSE timeline updates live | UI-07 | Real-time visual | Trigger cron, watch timeline steps appear with checkmarks |
| Tenant switcher persists | UI-08 | Cross-page state | Switch tenant, navigate to different page, verify tenant persisted |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
