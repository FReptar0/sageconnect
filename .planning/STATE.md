---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Always-On Service
status: completed
stopped_at: Completed 10-01-PLAN.md -- all v2.0 plans done
last_updated: "2026-03-25T17:38:38.012Z"
last_activity: 2026-03-24 -- Completed 10-01 legacy lifecycle removal (all v2.0 plans done)
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 16
  completed_plans: 16
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-23)

**Core value:** La integracion Sage-Portal debe ser confiable, mantenible, y operable: servicio continuo con interfaz web para operaciones y monitoreo en tiempo real.
**Current focus:** v2.0 Always-On Service -- Phase 10 in progress

## Current Position

Phase: 10 of 10 (Servy Cutover + Retirement)
Plan: 2 of 2 complete
Status: Complete
Last activity: 2026-03-24 -- Completed 10-01 legacy lifecycle removal (all v2.0 plans done)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 24 (v1.0: 4, v1.1: 6, v2.0: 14)
- Average duration: --
- Total execution time: --

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1-5 (v1.0+v1.1) | 10 | -- | -- |
| 6 (infra-foundation) | 4/4 | 44min | 11min |
| 7 (rest-api-security) | 3/3 | 20min | 7min |
| 8 (scheduler-real-time) | 3/3 | 11min | 4min |
| 9 (operational-web-ui) | 4/4 | 39min | 10min |
| Phase 09 P03 | 4min | 2 tasks | 3 files |
| Phase 10 P02 | 2min | 1 tasks | 2 files |
| Phase 10 P01 | 8min | 2 tasks | 25 files |

## Accumulated Context

### Decisions

- [v2.0 Init]: Servy replaces PM2 as Windows Service manager (PM2 has wmic bug on Win Server 2025)
- [v2.0 Init]: node-cron v4 for internal scheduling, replacing Windows Task Scheduler
- [v2.0 Init]: Scripts are source of truth -- expose as API, don't rewrite
- [v2.0 Init]: No auth on web UI -- internal network use only
- [v2.0 Roadmap]: 5 phases derived: Infra -> API+Security -> Scheduler+SSE -> Web UI -> Servy Cutover
- [v2.0 Roadmap]: AutoShutdownService removal sequenced as last action (Pitfall 3)
- [06-01]: Pool error listener logs but does not exit/rethrow -- always-on stability
- [06-01]: USE [database] comparison uses config.database.database, not hardcoded 'FESA'
- [Phase 06]: PortalOC_StatusUpdater refactored to return ResultEnvelope with require.main CLI guard for backward compatibility
- [Phase 06]: background.js returns control to index.js instead of calling process.exit -- index.js owns server lifecycle
- [Phase 06]: routes.js shutdown endpoint returns 403 in always-on mode with Servy guidance
- [Phase 06]: AutoShutdownService uses setShutdownHandler callback instead of direct process.exit
- [06-03]: Dual-output pattern: console output preserved alongside envelope returns for backward CLI compatibility
- [06-03]: searchPOInFESA internal caller updated to use envelope.data, keeping both function exports consistent
- [06-03]: PaymentReconciliation test assertions updated from result.categories to result.data.categories
- [06-04]: Options parameter pattern: exported functions accept options={} instead of positional args for API readiness
- [06-04]: CLI arg parsing fully separated from business logic in all 5 hard scripts
- [06-04]: Envelope contract test covers all 14 modules (65 structural tests)
- [07-01]: SAGECONNECT_API_KEY is optional -- missing key warns but does not crash the app
- [07-01]: Helmet CSP disabled for dashboard inline scripts
- [07-01]: draft-7 standard headers for rate limiting (ratelimit + ratelimit-policy)
- [07-01]: Test app builder pattern avoids config.js process.exit during security tests
- [07-02]: Inline writeLimiter in payment-routes.js to avoid circular dep with server.js
- [07-02]: runReconciliation returns category counts (not full arrays) for lightweight API responses
- [07-02]: dryRun=true default on all destructive payment endpoints for production safety
- [Phase 07]: Local writeLimiter in po-routes.js to avoid circular dependency with server.js
- [Phase 07]: dryRun defaults to true via Joi schema on PUT /update for destructive endpoint safety
- [Phase 07]: Mock express-rate-limit in tests to prevent write limiter from blocking test suite
- [08-01]: OperationManager extends EventEmitter for progress:operationId SSE pattern
- [08-01]: Ring buffer uses array shift (max 100) for simplicity over circular buffer
- [08-01]: _reset() method on singleton for test isolation
- [08-02]: noOverlap + acquireLock belt-and-suspenders overlap prevention for cron cycles
- [08-02]: forResponse uses options={} parameter pattern for backward-compatible progress emission
- [08-02]: index.js autoTerminate branching: true=legacy run-once, false=cron scheduler always-on
- [08-03]: Lazy CronScheduler require with try/catch handles Wave 2 parallel execution gracefully
- [08-03]: SSE endpoint uses direct res.write (no asyncHandler/sendResult) with heartbeat + auto-cleanup
- [08-03]: Schedule/operations routes mounted without global requireApiKey -- POST trigger applies it internally
- [08-03]: triggerSchema Joi validation restricts manual trigger to known task IDs only (background-cycle)
- [09-01]: Tenant switcher uses localStorage key sageconnect_tenant with index-based selection
- [09-01]: Root (/) redirects to /schedule.html as the new home page
- [09-01]: Local formatDateTimeLocal in logs.html avoids collision with shared.js formatDateTime
- [Phase 09]: Timeline uses step deduplication via Set to prevent duplicate entries from rapid SSE events
- [Phase 09]: Trigger button disables during running state to prevent double-trigger
- [Phase 09]: onTenantChange is no-op on schedule page since schedule data is global, not per-tenant
- [09-04]: Lifecycle analyze requires ponumber -- status overview cards show placeholders, populated by individual analysis
- [09-04]: upload-authorized is destructive POST -- never auto-called on load, requires explicit confirmation
- [09-04]: dryRun: false explicitly sent on Update PO confirm to override server-side default
- [Phase 09-03]: Early-return paths in reconciliation return counts (not empty arrays) in categories for consistent frontend shape
- [Phase 09-03]: Category cards use toggle behavior: click active card to clear filter
- [Phase 09-03]: Bootstrap Collapse events for chevron rotation on expandable payment table rows
- [Phase 10]: [10-02]: Used servy-cli instead of PowerShell module import for portability across install configurations
- [Phase 10]: [10-02]: Script accepts parameterized defaults (InstallDir, NodePath, ServiceName, Port) for flexibility across environments
- [Phase 10]: [10-02]: Deployment documentation written in Spanish as team language
- [Phase 10]: [10-01]: index.js reduced from 39 lines to 14: startServer + initScheduler only, no mode switching
- [Phase 10]: [10-01]: config.js keeps process.exit(1) in validate() for fail-fast on missing env vars
- [Phase 10]: [10-01]: obfuscate.js COPY_FILES updated: removed RunSageconnect.bat, added scripts/install-service.ps1

### Pending Todos

None.

### Blockers/Concerns

- No Sage DB access locally: SQL query changes can only be validated structurally
- Servy production server environment (service account, firewall, paths) not yet verified

## Session Continuity

Last session: 2026-03-24T18:51:20.000Z
Stopped at: Completed 10-01-PLAN.md -- all v2.0 plans done
Resume file: None
