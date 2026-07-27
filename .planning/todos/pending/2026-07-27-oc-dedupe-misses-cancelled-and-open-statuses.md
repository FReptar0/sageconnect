---
created: 2026-07-27T21:00:00.000Z
title: OC dedupe misses CANCELLED and OPEN statuses
area: api
files:
  - src/controller/PortalOC_Creator.js:186
  - src/scripts/retry-month-pos.js:109
  - src/controller/PortalOC_Canceller.js:100
---

## Problem

RETRY-C7 (Phase 20.1) changed the OC `NOT EXISTS` dedupe from `status = 'POSTED'` to
`status IN ('CLOSED', 'POSTED')`, which correctly stops closed OCs from being re-selected and
409'd. But the 2026-07-27 production read of `fesa.dbo.fesaOCFocaltec` shows **five** statuses,
not two:

| status | rows |
|---|---|
| CLOSED | 4498 |
| ERROR | 3313 |
| POSTED | 1198 |
| **CANCELLED** | **18** |
| **OPEN** | **5** |

`CANCELLED` and `OPEN` match neither side of the new dedupe, so those 23 rows are still
re-selectable by the cron.

**CANCELLED is a confirmed gap.** `src/controller/PortalOC_Canceller.js:100` does
`UPDATE fesa.dbo.fesaOCFocaltec SET status = 'CANCELLED' ... WHERE status = 'POSTED'`, so a
cancelled PO loses its POSTED row. The canceller keys off `POPORL.OQCANCELED`, not
`Autoriza_OC`, so `X.Autorizada` stays 1 and the cron's other WHERE clauses do not exclude it
either. Net effect: a Sage-cancelled PO can be re-uploaded for the whole 30-day retry window —
the same failure shape RETRY-C7 exists to prevent.

**This is NOT a regression from Phase 20.1.** The old `status = 'POSTED'` dedupe also failed to
match a CANCELLED row, so the behavior is identical before and after RETRY-C7. It is a
pre-existing gap that RETRY-C7 simply did not widen far enough.

**`OPEN` semantics are unknown** — the status appears nowhere in `src/`. Do not assume it should
be excluded; ask what writes it and what it means before touching the predicate.

## Why this has no home yet

Surfaced as **E-1** by the Phase 20.1 verifier (`20.1-VERIFICATION.md`) and as **CR-02** by the
code review (`20.1-REVIEW.md`). Phase 20.2's ROADMAP entry lists it under *"Explicitly deferred
(NOT in this scope)"*, so no phase is currently scheduled to fix it. This todo exists so it is
not lost.

## Solution

1. **Ask first**: what writes `status = 'OPEN'`, and does an OPEN row mean the OC already exists
   in the portal? The answer decides whether OPEN belongs in the dedupe list at all.
2. If CANCELLED (and possibly OPEN) should be excluded, extend the predicate in **both** places
   that carry RETRY-C7 — `PortalOC_Creator.js:186` (the cron) and `retry-month-pos.js:109` (the
   dry-run preview) — keeping them identical so preview/apply parity holds.
3. Consider whether `po-cron-diagnostic.js:181` should mirror it too — see `D-ITEM-01` in
   `.planning/phases/20.1-retry-policy-correction/deferred-items.md`, which is the same
   replica-drift problem for the CLOSED case.
4. Update the cron-where SQL-shape assertions in
   `tests/controller/PortalOC_Creator.cron-where.test.js` to match.

Low risk — a static string-literal list, read-only SQL, no operator input crosses into it.
