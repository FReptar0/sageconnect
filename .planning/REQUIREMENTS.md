# Requirements: SageConnect

**Defined:** 2026-04-08
**Core Value:** La integración Sage-Portal debe ser confiable, mantenible, y operable: servicio continuo con interfaz web para operaciones y monitoreo en tiempo real.

## v2.2 Requirements

Requirements for OC Status UI milestone. Each maps to roadmap phases.

### API

- [ ] **API-01**: Operator can update a single OC's status via `PUT /api/pos/status` with validated input (ocSage, status, tenantIndex)
- [ ] **API-02**: API rejects invalid status values and missing fields with clear error messages

### UI

- [ ] **UI-01**: Operator can enter an OC number and select a target status (OPEN/CLOSED/CANCELLED/GENERATED) from a form in the PO management page
- [ ] **UI-02**: Operator sees a confirmation dialog before the status change is submitted
- [ ] **UI-03**: Operator receives toast feedback (success or error) after the status update completes

## Future Requirements

### Batch Operations

- **BATCH-01**: Operator can update multiple OCs' status in a single request
- **BATCH-02**: Operator can select multiple OCs from search results for bulk status update

### Status Visibility

- **HIST-01**: Operator can view status change history for a given OC
- **DRY-01**: Operator can preview what a status change would affect before committing

## Out of Scope

| Feature | Reason |
|---------|--------|
| Batch status update | Single OC sufficient for v2.2; batch can be v2.3 |
| Dry-run mode | Straightforward operation, no preview needed |
| Status history view | Not needed for initial release |
| Bulk UI selection | Deferred with batch API |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| API-01 | Pending | Pending |
| API-02 | Pending | Pending |
| UI-01 | Pending | Pending |
| UI-02 | Pending | Pending |
| UI-03 | Pending | Pending |

**Coverage:**
- v2.2 requirements: 5 total
- Mapped to phases: 0
- Unmapped: 5 ⚠️

---
*Requirements defined: 2026-04-08*
*Last updated: 2026-04-08 after initial definition*
