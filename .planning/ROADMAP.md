# Roadmap: SageConnect

## Milestones

- v1.0 Payment Reconciliation Fixes (Phases 1-2) -- shipped 2026-03-22
- v1.1 Env Unification (Phases 3-5) -- shipped 2026-03-23
- v2.0 Always-On Service (Phases 6-10) -- shipped 2026-03-25
- v2.1 License Validation (Phases 11-14) -- shipped 2026-03-25
- **v2.2 OC Status UI (Phases 15-16)** -- in progress

## Phases

- [ ] **Phase 15: OC Status API Endpoint** - PUT /api/pos/status with Joi validation and error handling
- [ ] **Phase 16: OC Status UI Form** - HTML form with status dropdown, confirmation dialog, and toast feedback

## Phase Details

### Phase 15: OC Status API Endpoint
**Goal**: Operators can update an OC's status via a validated REST API call
**Depends on**: Nothing (builds on existing PortalOC_StatusUpdater and po-routes infrastructure)
**Requirements**: API-01, API-02
**Success Criteria** (what must be TRUE):
  1. Operator can send PUT /api/pos/status with ocSage, status, and tenantIndex and receive a success response with the update result
  2. API rejects requests with missing fields (ocSage, status, tenantIndex) returning 400 with a clear error message per field
  3. API rejects invalid status values (anything other than OPEN, CLOSED, CANCELLED, GENERATED) returning 400 with the list of valid values
  4. API returns appropriate error response when the underlying PortalOC_StatusService fails (e.g., DB error, OC not found)
**Plans:** 1 plan

Plans:
- [ ] 15-01-PLAN.md — Schema, route handler, and tests for PUT /api/pos/status

### Phase 16: OC Status UI Form
**Goal**: Operators can change an OC's status from the PO management page without leaving the browser
**Depends on**: Phase 15
**Requirements**: UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. Operator can enter an OC number, select a tenant, and choose a target status (OPEN/CLOSED/CANCELLED/GENERATED) from a form section in pos.html
  2. After clicking the submit button, operator sees a confirmation dialog showing the OC number and target status before the request is sent
  3. On successful status update, operator sees a green toast notification with the result message
  4. On failed status update, operator sees a red toast notification with the error detail
  5. The form resets or remains ready for the next operation after feedback is shown
**Plans**: TBD

Plans:
- [ ] 16-01: TBD

## Progress

**Execution Order:** 15 -> 16

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 15. OC Status API Endpoint | v2.2 | 0/1 | Not started | - |
| 16. OC Status UI Form | v2.2 | 0/? | Not started | - |
