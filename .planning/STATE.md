---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Scheduler Lock Recovery
status: roadmap
stopped_at: Roadmap created
last_updated: "2026-04-24T20:45:00.000Z"
last_activity: 2026-04-24 — Created ROADMAP.md (3 phases, 14 REQs)
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-24)

**Core value:** La integración Sage-Portal debe ser confiable, mantenible, y operable: servicio continuo con interfaz web para operaciones y monitoreo en tiempo real.
**Current focus:** v2.3 Scheduler Lock Recovery — diagnosticar y arreglar bug "Ejecutar Ahora" 409 permanente

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-04-24 — Milestone v2.3 started

Progress: [░░░░░░░░░░] 0%

## Accumulated Context

### Decisions

- [v2.3 Init]: Bug se manifiesta como HTTP 409 permanente en `POST /api/schedule/background-cycle/trigger`, causado por lock huérfano en `OperationManager.locks`
- [v2.3 Init]: Hipótesis principal — `axios` al portal sin timeout cuelga `forResponse`, `finally` nunca corre
- [v2.3 Init]: Alcance confirmado con usuario — 3 phases (observability, recovery, root cause fix)
- [v2.3 Init]: Root cause fix incluye 3 timeouts: axios portal calls, startChildProcess, per-step Promise.race

### Pending Todos

- Fix uploadPayments 7-day lookback (PortalPaymentController.js:70) — prevents missed payments when auto-cycle skips a day
- Support partial payment completion — handle incomplete uploads and split payments (multi-PY for same invoice)

### Blockers/Concerns

- No Sage DB access locally: SQL query changes can only be validated structurally
- No repro local del bug: requiere prod (ZCL-RDS-02) o simulación con mocks
- Servy como Windows service no tiene sesión de escritorio: child-process GUI puede colgarse

## Session Continuity

Last session: 2026-04-24T20:32:00.000Z
Stopped at: Defining requirements
Resume file: None
