---
gsd_state_version: 1.0
milestone: v2.1
milestone_name: License Validation
status: defining_requirements
stopped_at: null
last_updated: "2026-03-25"
last_activity: 2026-03-25 -- Milestone v2.1 started
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-25)

**Core value:** La integración Sage-Portal debe ser confiable, mantenible, y operable: servicio continuo con interfaz web para operaciones y monitoreo en tiempo real.
**Current focus:** v2.1 License Validation — Defining requirements

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-25 — Milestone v2.1 started

## Accumulated Context

### Decisions

- [v2.1 Init]: License validation against external Vercel server (sageconnect-license)
- [v2.1 Init]: HMAC-signed responses to prevent DNS/MITM bypass on client servers
- [v2.1 Init]: Fail-fast on startup if license invalid (like config.js pattern)
- [v2.1 Init]: Periodic re-validation every cron cycle
- [v2.1 Init]: "Licencia inactiva" banner on web UI + block all operations

### Pending Todos

None.

### Blockers/Concerns

- No Sage DB access locally: SQL query changes can only be validated structurally
- License server must be deployed and accessible before integration testing

## Session Continuity

Last session: 2026-03-25
Stopped at: Defining requirements for v2.1
Resume file: None
