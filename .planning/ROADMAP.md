# Roadmap: SageConnect

## Milestones

- v1.0 Payment Reconciliation Fixes -- Phases 1-2 (shipped 2026-03-22)
- v1.1 Env Unification -- Phases 3-5 (shipped 2026-03-23)
- v2.0 Always-On Service -- Phases 6-10 (in progress)

## Phases

<details>
<summary>v1.0 Payment Reconciliation Fixes (Phases 1-2) -- SHIPPED 2026-03-22</summary>

- [x] Phase 1: Reconciliation Classification (2/2 plans)
- [x] Phase 2: Batch Upload Robustness (2/2 plans)

See: `.planning/milestones/v1.0-ROADMAP.md` for full details.

</details>

<details>
<summary>v1.1 Env Unification (Phases 3-5) -- SHIPPED 2026-03-23</summary>

- [x] Phase 3: Config Loader Foundation (2/2 plans)
- [x] Phase 4: Codebase Migration (3/3 plans)
- [x] Phase 5: Regression Verification (1/1 plan)

See: `.planning/milestones/v1.1-ROADMAP.md` for full details.

</details>

### v2.0 Always-On Service

**Milestone Goal:** Transform SageConnect from batch runner (every 15 min) to always-on service with REST API, internal scheduling, and operational web UI for payments and POs.

- [ ] **Phase 6: Infrastructure Foundation** - Refactor scripts to return structured data, eliminate process.exit, create shared SQL pool
- [ ] **Phase 7: REST API + Security** - Expose all 15 payment/PO scripts as secured REST endpoints with validation
- [ ] **Phase 8: Scheduler + Real-Time Layer** - Internal node-cron scheduling with SSE progress streams and operation concurrency control
- [ ] **Phase 9: Operational Web UI** - Payment audit, PO management, schedule dashboard, and tenant switcher views
- [ ] **Phase 10: Servy Cutover + Retirement** - Register as Windows Service via Servy, remove AutoShutdownService and Task Scheduler dependency

## Phase Details

### Phase 6: Infrastructure Foundation
**Goal**: All 13 scripts return structured data objects, the process can run indefinitely without crashing, and SQL connections are pooled efficiently
**Depends on**: Phase 5 (v1.1 complete)
**Requirements**: INFRA-01, INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):
  1. Every script's exported function returns a structured result object (not undefined) when called programmatically
  2. No code path in the always-on process calls process.exit() -- the server stays running after any script completes or fails
  3. A single SQL connection pool is created at startup and reused across all script executions (no per-query pool creation/destruction)
  4. Existing CLI behavior (console output, exit codes) is preserved unchanged for backward compatibility
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD
- [ ] 06-03: TBD

### Phase 7: REST API + Security
**Goal**: Operations team can trigger any payment or PO operation via HTTP request with proper validation, rate limiting, and API key protection
**Depends on**: Phase 6
**Requirements**: PAY-01, PAY-02, PAY-03, PAY-04, PAY-05, PAY-06, PAY-07, PO-01, PO-02, PO-03, PO-04, PO-05, PO-06, PO-07, PO-08, SEC-01, SEC-02, SEC-03, SEC-04
**Success Criteria** (what must be TRUE):
  1. All 7 payment endpoints return structured JSON responses with correct HTTP status codes when called via curl/Postman
  2. All 8 PO endpoints return structured JSON responses with correct HTTP status codes when called via curl/Postman
  3. Destructive endpoints (POST/PUT) require a valid API key in x-api-key header and return 401 without it
  4. Write endpoints are rate-limited, and all responses include security headers (helmet)
  5. Invalid inputs (bad tenant index, missing required params) return structured 400 errors with validation details (Joi)
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD
- [ ] 07-03: TBD

### Phase 8: Scheduler + Real-Time Layer
**Goal**: SageConnect runs scheduled jobs internally via node-cron (replacing Windows Task Scheduler) with real-time progress streaming and concurrency protection
**Depends on**: Phase 7
**Requirements**: INFRA-04, INFRA-05, SYS-01, SYS-02, SYS-03, SYS-04, SYS-05
**Success Criteria** (what must be TRUE):
  1. Background processes run on a cron schedule (every 15 min) without overlap -- a second trigger while one is running is safely rejected
  2. GET /api/schedule returns all scheduled tasks with their next run times and last execution results
  3. POST /api/schedule/:taskId/trigger manually fires a scheduled task and returns 409 if that task is already running
  4. Long-running operations stream real-time progress updates via SSE to connected clients
  5. GET /api/operations/status shows which operations are currently in-flight
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

### Phase 9: Operational Web UI
**Goal**: Operations team can audit payments, manage POs, monitor schedules, and switch tenants entirely from the browser -- no SSH/RDP/CLI needed for daily operations
**Depends on**: Phase 8
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08
**Success Criteria** (what must be TRUE):
  1. Payment audit view displays reconciliation results in 5 categories with filtering by status (uploaded/pending/failed) and drill-down to individual invoices
  2. PO management view shows status overview (posted/error/pending), single-PO diagnostic lookup, and today's authorized POs list
  3. Schedule dashboard displays next run times, last results per task, and manual trigger buttons that fire the corresponding API endpoint
  4. Tenant switcher in navbar changes the active tenant context across all views without page reload
  5. Real-time progress indicators update via SSE when long-running operations are in progress
**Plans**: TBD

Plans:
- [ ] 09-01: TBD
- [ ] 09-02: TBD
- [ ] 09-03: TBD

### Phase 10: Servy Cutover + Retirement
**Goal**: SageConnect runs as a native Windows Service managed by Servy, auto-starting on reboot, with all legacy process lifecycle artifacts removed
**Depends on**: Phase 9
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03
**Success Criteria** (what must be TRUE):
  1. SageConnect is registered as a Windows Service via Servy and starts automatically on server reboot
  2. AutoShutdownService is removed from the codebase and the service runs continuously without self-termination
  3. AUTO_TERMINATE flag, RunSageconnect.bat, and Windows Task Scheduler entries are removed/disabled
  4. The service remains stable (no crashes, no port conflicts, no memory leaks) for 24+ hours of continuous operation
**Plans**: TBD

Plans:
- [ ] 10-01: TBD
- [ ] 10-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 6 -> 7 -> 8 -> 9 -> 10

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Reconciliation Classification | v1.0 | 2/2 | Complete | 2026-03-22 |
| 2. Batch Upload Robustness | v1.0 | 2/2 | Complete | 2026-03-22 |
| 3. Config Loader Foundation | v1.1 | 2/2 | Complete | 2026-03-23 |
| 4. Codebase Migration | v1.1 | 3/3 | Complete | 2026-03-23 |
| 5. Regression Verification | v1.1 | 1/1 | Complete | 2026-03-23 |
| 6. Infrastructure Foundation | v2.0 | 0/? | Not started | - |
| 7. REST API + Security | v2.0 | 0/? | Not started | - |
| 8. Scheduler + Real-Time Layer | v2.0 | 0/? | Not started | - |
| 9. Operational Web UI | v2.0 | 0/? | Not started | - |
| 10. Servy Cutover + Retirement | v2.0 | 0/? | Not started | - |
