---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Always-On Service
status: defining_requirements
stopped_at: null
last_updated: "2026-03-23"
last_activity: 2026-03-23 -- Milestone v2.0 started
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-23)

**Core value:** La integración Sage-Portal debe ser confiable, mantenible, y operable: servicio continuo con interfaz web para operaciones y monitoreo en tiempo real.
**Current focus:** v2.0 Always-On Service — Defining requirements

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-23 — Milestone v2.0 started

## Accumulated Context

### Decisions

- [v2.0 Init]: Servy replaces PM2 as Windows Service manager (PM2 has wmic bug on Win Server 2025, no native startup)
- [v2.0 Init]: node-cron for internal scheduling, replacing Windows Task Scheduler 15-min pattern
- [v2.0 Init]: Existing 13 scripts in src/scripts/ are the source of truth for business logic — expose as API, don't rewrite
- [v2.0 Init]: AutoShutdownService and AUTO_TERMINATE to be removed (no longer needed)
- [v2.0 Init]: No auth on web UI — internal network use only

### Pending Todos

None.

### Blockers/Concerns

- No Sage DB access locally: SQL query changes can only be validated structurally
- PaymentReconciliation.test.js has 1 pre-existing test failure unrelated to migration
- TransformTime.test.js has 2 pre-existing test failures (function uses notifier, not throw)

## Session Continuity

Last session: 2026-03-23
Stopped at: Defining requirements for v2.0
Resume file: N/A
