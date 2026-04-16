---
created: 2026-04-16T14:48:22.382Z
title: Support partial payment completion for incomplete uploads
area: api
files:
  - src/controller/PortalPaymentController.js
  - src/scripts/payment-reconciliation.js
---

## Problem

When a payment is uploaded to the portal but not all its invoices are present (provider hasn't uploaded them yet), the payment is registered as partial. Later, when the missing invoices appear in the portal, there is no automatic mechanism to complete the payment.

Real cases from 2026-04-15 investigation: 12 payments in PENDING_PAYMENT_CFDI status with incomplete invoice counts (e.g., PY0060654 with 9/28 invoices, PY0060822 with 1/65, PY0060686 with 11/19). These require manual intervention.

Additionally, split payments across multiple PY documents (e.g., invoice 3417 paid 50% via PY0061276 and 50% via PY0062112) are not handled -- the system sees PY0061276 in control table and skips PY0062112.

## Solution

TBD - Needs design. Possible approaches:
1. Reconciliation mode that detects PENDING_PAYMENT_CFDI payments and re-sends with complete invoice list
2. Script to update existing portal payments with newly available invoices
3. Handle multi-PY payments for same invoice (split payment scenario)

Client (Capstone Copper/Memo) approved marking partial invoices as paid directly without waiting for provider upload. This could be an interim manual process while automation is built.
