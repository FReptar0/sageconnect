---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Always-On Service
status: in-progress
stopped_at: Completed 08-03-PLAN.md
last_updated: "2026-03-24T04:00:24Z"
last_activity: 2026-03-24 -- Completed 08-03 Schedule & Operations routes + SSE streaming
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 10
  completed_plans: 10
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-23)

**Core value:** La integracion Sage-Portal debe ser confiable, mantenible, y operable: servicio continuo con interfaz web para operaciones y monitoreo en tiempo real.
**Current focus:** v2.0 Always-On Service -- Phase 8 complete

## Current Position

Phase: 8 of 10 (Scheduler + Real-Time Layer)
Plan: 3 of 3 complete
Status: Phase Complete
Last activity: 2026-03-24 -- Completed 08-03 Schedule & Operations routes + SSE streaming

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 11 (v1.0: 4, v1.1: 6, v2.0: 8)
- Average duration: --
- Total execution time: --

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1-5 (v1.0+v1.1) | 10 | -- | -- |
| 6 (infra-foundation) | 4/4 | 44min | 11min |
| 7 (rest-api-security) | 3/3 | 20min | 7min |
| 8 (scheduler-real-time) | 3/3 | 11min | 4min |

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

### Pending Todos

None.

### Blockers/Concerns

- No Sage DB access locally: SQL query changes can only be validated structurally
- Servy production server environment (service account, firewall, paths) not yet verified

## Session Continuity

Last session: 2026-03-24T04:00:24Z
Stopped at: Completed 08-03-PLAN.md (Phase 8 complete)
Resume file: .planning/phases/09-web-dashboard/09-01-PLAN.md
