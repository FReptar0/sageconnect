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

## `OPEN` semantics — RESOLVED 2026-07-27

Answered by Yahir and confirmed in code: **`OPEN` means the OC is open *in the portal*, i.e. it
already exists there.** It must therefore be excluded from the dedupe — re-uploading gives a 409,
the exact loop RETRY-C7 exists to stop.

Proof: `src/controller/PortalOC_StatusUpdater.js:117-124` (the `PUT /api/pos/status` endpoint
added in v2.2, driven from `pos.html`) writes the portal status straight into the control table
with `WHERE ... AND idFocaltec IS NOT NULL` — it only touches rows for OCs that already carry a
portal ID. An `OPEN` row is therefore, by construction, an OC that reached the portal and whose
status an operator set back to OPEN from the dashboard.

## Root cause — the column mixes two vocabularies

This is why the dedupe has now been wrong twice, and it matters more than the individual fix:

| Vocabulary | Written by | Values |
|---|---|---|
| Integration state | the cron uploader (`PortalOC_Creator`) | `POSTED`, `ERROR` |
| Portal state | `PortalOC_StatusUpdater`, `PortalOC_Closer`, `PortalOC_Canceller` | `OPEN`, `CLOSED`, `CANCELLED`, `GENERATED` |

The portal enum is declared in four places: `PortalOC_StatusUpdater.js:16`,
`PortalOC_StatusService.js:25`, `src/models/PurchaseOrder.js:91`, `src/routes/schemas/po-schemas.js:95`.

Enumerating `IN ('CLOSED','POSTED')` lists *instances* of the intent instead of expressing it.
The actual intent is singular: **"do not re-upload an OC that already reached the portal."** The
only status meaning "it did not reach the portal" is `ERROR`; every other value means it did.

**Recommended predicate: `AND status <> 'ERROR'`** — covers today's 23 orphaned rows plus
`GENERATED` (0 rows today, but a valid portal status that will appear eventually), and cannot
drift again as the portal vocabulary grows.

**Honest trade-off to weigh before applying it:** if a status ever appears that genuinely means
"did not reach the portal", `<> 'ERROR'` would wrongly exclude it and that OC would never upload
— a silent failure, which is this codebase's documented enemy (CLAUDE.md §3). An explicit `IN`
list fails the other way: a noisy, visible 409. The list has nonetheless proven twice that nobody
keeps it complete, which is why the recommendation still stands.

## Payments — not affected

`fesa.dbo.fesaPagosFocaltec` uses an entirely different vocabulary (`PAID 2678`, `PARTIAL 27`,
`SYNCED 3`, `REVERTED 2`) with no `OPEN`/`CLOSED`/`CANCELLED` at all, and its dedupe
(`P.DOCNBR NOT IN (SELECT NoPagoSage …)`) has no status filter, so this class of problem does not
apply there. No change needed on the payment side.

## Why this has no home yet

Surfaced as **E-1** by the Phase 20.1 verifier (`20.1-VERIFICATION.md`) and as **CR-02** by the
code review (`20.1-REVIEW.md`). Phase 20.2's ROADMAP entry lists it under *"Explicitly deferred
(NOT in this scope)"*, so no phase is currently scheduled to fix it. This todo exists so it is
not lost.

## Solution

1. ~~Ask what `OPEN` means~~ — **done, see above.** Both `CANCELLED` and `OPEN` mean the OC
   reached the portal and must be excluded.
2. Apply `AND status <> 'ERROR'` in **both** places that carry RETRY-C7 —
   `PortalOC_Creator.js:186` (the cron) and `retry-month-pos.js:109` (the dry-run preview) —
   keeping them identical so preview/apply parity holds.
3. Consider whether `po-cron-diagnostic.js:181` should mirror it too — see `D-ITEM-01` in
   `.planning/phases/20.1-retry-policy-correction/deferred-items.md`, which is the same
   replica-drift problem for the CLOSED case.
4. Update the cron-where SQL-shape assertions in
   `tests/controller/PortalOC_Creator.cron-where.test.js` to match.

Low risk — a static string-literal list, read-only SQL, no operator input crosses into it.
