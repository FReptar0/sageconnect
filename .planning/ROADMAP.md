# Roadmap: SageConnect Payment Reconciliation Fixes

## Overview

This roadmap fixes two distinct gaps in `payment-reconciliation.js`: first, the reconciliation classification logic that determines which payments are ready for upload (provider validation and auto-resolution), and second, the batch upload logic that sends payments to the portal (edge case handling). Both phases modify the same script but touch independent code paths.

## Phases

**Phase Numbering:**
- Integer phases (1, 2): Planned milestone work
- Decimal phases (1.1, etc.): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Reconciliation Classification** - Auto-resolve missing PROVIDERID and validate provider_id match before marking payments READY
- [ ] **Phase 2: Batch Upload Robustness** - Verify batch results completeness and prevent empty batch requests

## Phase Details

### Phase 1: Reconciliation Classification
**Goal**: Payments are correctly classified by provider: missing PROVIDERIDs are auto-resolved, and provider_id mismatches are caught before a payment reaches READY TO UPLOAD
**Depends on**: Nothing (first phase)
**Requirements**: PROV-01, PROV-02, RSOL-01, RSOL-02
**Success Criteria** (what must be TRUE):
  1. A payment with missing PROVIDERID in Sage is automatically resolved via `getProviderByExternalId` using the payment's IDVEND, and if a unique match is found, the payment is reclassified from MISSING PROVIDERID to READY TO UPLOAD in the same run
  2. A payment where `metadata.provider_id` from the portal CFDI does not match the Sage PROVIDERID is classified as PROVIDER MISMATCH (not READY TO UPLOAD), with the expected vs found IDs reported
  3. A payment where `metadata.provider_id` matches the Sage PROVIDERID continues to be classified as READY TO UPLOAD (no regression)
  4. A payment where PROVIDERID cannot be auto-resolved (no match or multiple matches) remains classified as MISSING PROVIDERID with appropriate messaging
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Extract classifyPayments function and create failing TDD tests
- [x] 01-02-PLAN.md — Implement auto-resolution, mismatch validation, and report updates

### Phase 2: Batch Upload Robustness
**Goal**: The batch upload path handles edge cases safely: no empty batch requests are sent, and every payment sent is accounted for in the response
**Depends on**: Phase 1
**Requirements**: BTCH-01, BTCH-02
**Success Criteria** (what must be TRUE):
  1. When `--upload` flag is used and `categories.ready` is empty, no batch API request is made and the user sees a clear message that there are no payments to upload
  2. After a batch upload, every `external_id` sent in the request has a corresponding entry in the `results` array; any payment missing from results is reported as MISSING RESULT with its external_id
  3. Existing `--upload` behavior for non-empty batches continues to work correctly (no regression in the happy path)
**Plans**: TBD

Plans:
- [ ] 02-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Reconciliation Classification | 2/2 | Complete | 2026-03-12 |
| 2. Batch Upload Robustness | 0/? | Not started | - |
