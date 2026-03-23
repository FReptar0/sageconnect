# Requirements: SageConnect v2.0

**Defined:** 2026-03-23
**Core Value:** Servicio always-on con interfaz web operativa para pagos y POs en tiempo real.

## v2.0 Requirements

Requirements for always-on service milestone. Each maps to roadmap phases.

### Infrastructure

- [x] **INFRA-01**: Scripts return structured data objects instead of only console.log output
- [x] **INFRA-02**: All process.exit() calls removed or guarded from always-on code paths
- [x] **INFRA-03**: Shared SQL connection pool (singleton) replacing per-query pool creation/destruction
- [ ] **INFRA-04**: node-cron v4 scheduler replaces Windows Task Scheduler with noOverlap guard
- [ ] **INFRA-05**: Background process loop refactored from "run once and exit" to "scheduled recurring job"

### API -- Payments

- [x] **PAY-01**: POST /api/payments/reconciliation runs payment reconciliation with tenant/date/batch filters
- [x] **PAY-02**: GET /api/payments/uuid-diagnostic returns UUID diagnostic for specific PY document numbers
- [x] **PAY-03**: POST /api/payments/uuid-repair/scan scans for repairable UUIDs
- [x] **PAY-04**: POST /api/payments/uuid-repair/repair applies UUID repairs (dry-run by default)
- [x] **PAY-05**: POST /api/payments/uuid-repair/upload uploads repaired payments to portal
- [x] **PAY-06**: POST /api/payments/generate generates payment JSON and optionally posts to portal
- [x] **PAY-07**: GET /api/payments/cfdis fetches CFDI Type P invoices from portal

### API -- Purchase Orders

- [x] **PO-01**: GET /api/pos/diagnostic returns comprehensive PO diagnostic
- [x] **PO-02**: GET /api/pos/query validates specific POs without posting (dry-run)
- [x] **PO-03**: POST /api/pos/upload posts POs to Portal de Proveedores
- [x] **PO-04**: PUT /api/pos/update updates PO in portal (dry-run by default)
- [x] **PO-05**: GET /api/pos/address-diagnostic returns address configuration diagnostic
- [x] **PO-06**: GET /api/pos/payment-form-diagnostic returns CFDI payment form diagnostic
- [x] **PO-07**: POST /api/pos/upload-authorized uploads today's authorized POs
- [x] **PO-08**: POST /api/pos/lifecycle manages PO lifecycle (analyze/process/tenant modes)

### API -- System

- [ ] **SYS-01**: GET /api/schedule returns all scheduled tasks with next run times
- [ ] **SYS-02**: POST /api/schedule/:taskId/trigger manually triggers a scheduled task
- [ ] **SYS-03**: GET /api/schedule/history returns last N executions per task
- [ ] **SYS-04**: GET /api/operations/status returns which operations are currently running
- [ ] **SYS-05**: GET /api/operations/:operationId/stream SSE endpoint for real-time operation progress

### Security

- [x] **SEC-01**: helmet middleware for HTTP security headers
- [x] **SEC-02**: cors middleware configured for internal network
- [x] **SEC-03**: express-rate-limit on write endpoints
- [x] **SEC-04**: API key middleware for destructive operations (POST/PUT/DELETE)

### Web UI

- [ ] **UI-01**: Payment audit view with reconciliation report showing 5 categories
- [ ] **UI-02**: Payment status table with filtering (uploaded/pending/failed)
- [ ] **UI-03**: Payment detail drill-down (invoices per payment)
- [ ] **UI-04**: PO status overview table (posted/error/pending)
- [ ] **UI-05**: PO diagnostic lookup from web (single PO search)
- [ ] **UI-06**: Today's authorized POs list
- [ ] **UI-07**: Schedule dashboard with next runs, last results, manual trigger buttons
- [ ] **UI-08**: Tenant switcher dropdown in navbar

### Deployment

- [ ] **DEPLOY-01**: Servy configuration/script to register SageConnect as native Windows Service
- [ ] **DEPLOY-02**: Remove AutoShutdownService (after cron + Servy proven stable)
- [ ] **DEPLOY-03**: Remove AUTO_TERMINATE flag and RunSageconnect.bat

## v3.0 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Operations

- **ADV-01**: UUID repair workflow UI (3-stage guided pipeline: scan -> repair -> upload)
- **ADV-02**: Cross-entity diagnostic (payment -> invoices -> PO -> portal trace)
- **ADV-03**: Batch operation progress with per-item SSE status
- **ADV-04**: Schedule pause/resume during Sage maintenance windows

### Carry-over

- **CARRY-01**: Eliminar columna RFC residual de la query de conciliacion (CONS-01)
- **CARRY-02**: Auto-resolucion de UUIDs faltantes en flujo de conciliacion (CONS-02)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Authentication/authorization | Internal tool on local network; auth adds complexity with zero security value |
| Direct database editing from UI | SQL injection risk; Sage 300 data integrity depends on business logic |
| Multi-environment support (dev/staging/prod) | Single deployment target; no staging exists |
| SPA framework (React/Vue/Angular) | Team uses vanilla JS + Bootstrap; build tooling overhead not justified |
| WebSocket/Socket.io | Over-engineered for one-way progress updates; SSE is sufficient |
| Persistent job queue (Redis/MongoDB) | No Redis/MongoDB in infrastructure; in-memory scheduling is sufficient |
| GraphQL API | Only internal consumers; REST is simpler |
| Internationalization | Team and users are Spanish-speaking; app already uses Spanish |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 6 | Complete |
| INFRA-02 | Phase 6 | Complete |
| INFRA-03 | Phase 6 | Complete |
| INFRA-04 | Phase 8 | Pending |
| INFRA-05 | Phase 8 | Pending |
| PAY-01 | Phase 7 | Complete |
| PAY-02 | Phase 7 | Complete |
| PAY-03 | Phase 7 | Complete |
| PAY-04 | Phase 7 | Complete |
| PAY-05 | Phase 7 | Complete |
| PAY-06 | Phase 7 | Complete |
| PAY-07 | Phase 7 | Complete |
| PO-01 | Phase 7 | Complete |
| PO-02 | Phase 7 | Complete |
| PO-03 | Phase 7 | Complete |
| PO-04 | Phase 7 | Complete |
| PO-05 | Phase 7 | Complete |
| PO-06 | Phase 7 | Complete |
| PO-07 | Phase 7 | Complete |
| PO-08 | Phase 7 | Complete |
| SYS-01 | Phase 8 | Pending |
| SYS-02 | Phase 8 | Pending |
| SYS-03 | Phase 8 | Pending |
| SYS-04 | Phase 8 | Pending |
| SYS-05 | Phase 8 | Pending |
| SEC-01 | Phase 7 | Complete |
| SEC-02 | Phase 7 | Complete |
| SEC-03 | Phase 7 | Complete |
| SEC-04 | Phase 7 | Complete |
| UI-01 | Phase 9 | Pending |
| UI-02 | Phase 9 | Pending |
| UI-03 | Phase 9 | Pending |
| UI-04 | Phase 9 | Pending |
| UI-05 | Phase 9 | Pending |
| UI-06 | Phase 9 | Pending |
| UI-07 | Phase 9 | Pending |
| UI-08 | Phase 9 | Pending |
| DEPLOY-01 | Phase 10 | Pending |
| DEPLOY-02 | Phase 10 | Pending |
| DEPLOY-03 | Phase 10 | Pending |

**Coverage:**
- v2.0 requirements: 40 total
- Mapped to phases: 40
- Unmapped: 0

---
*Requirements defined: 2026-03-23*
*Last updated: 2026-03-23 after roadmap creation*
