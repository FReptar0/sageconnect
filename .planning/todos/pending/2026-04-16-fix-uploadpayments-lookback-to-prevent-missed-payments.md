---
created: 2026-04-16T14:48:22.382Z
title: Fix uploadPayments lookback to prevent missed payments
area: api
resolves_phase: 20
files:
  - src/controller/PortalPaymentController.js:70
  - src/scripts/payment-reconciliation.js:545
---

## Problem

`PortalPaymentController.uploadPayments()` uses `P.AUDTDATE >= ${currentDate}` (line 70) which only picks up payments created TODAY. If the automatic process doesn't run on the same day as payment creation (service down, license issue, weekend), those payments are permanently missed by the automatic cycle.

Real incident on 2026-04-15: 18 payments from 2026-04-13 were never uploaded because the automatic process only looked at the current day. Required manual reconciliation script to fix. 63 total payments were identified as PAGO_PENDIENTE_SUBIR by diagnostic.

The reconciliation script (`payment-reconciliation.js`) was patched on master to decouple portal date range from `--from` parameter and use 3-month portal lookback (portal API returns 400 for ranges > ~4 months). But the automatic `uploadPayments()` still has the same-day-only filter.

## Solution

Change `PortalPaymentController.js` line 70 from:
```sql
AND P.AUDTDATE >= ${currentDate}
```
to a 7-day lookback:
```sql
AND P.AUDTDATE >= ${sevenDaysAgo}
```

Safe because the control table (`fesaPagosFocaltec`) already deduplicates -- payments already uploaded won't be re-sent.

Must be part of `feat/always-on-service` deployment since PortalPaymentController is part of the service, not a standalone script. Also port the reconciliation script portal date fix from master to the branch.
