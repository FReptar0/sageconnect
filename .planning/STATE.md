---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Scheduler Lock Recovery
status: context-gathered
stopped_at: Phase 17 context gathered
last_updated: "2026-04-27T00:00:00.000Z"
last_activity: 2026-04-27 — Phase 17 CONTEXT.md (Observability & Diagnostics) gathered — 4 áreas decididas
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
**Current focus:** v2.3 Scheduler Lock Recovery — Phase 17 Observability ready to plan

## Current Position

Phase: 17 — Observability & Diagnostics (context gathered)
Plan: —
Status: Ready for /gsd-plan-phase 17
Last activity: 2026-04-27 — CONTEXT.md generated with 13 implementation decisions

Progress: [░░░░░░░░░░] 0%

## Accumulated Context

### Decisions

- [v2.3 Init]: Bug se manifiesta como HTTP 409 permanente en `POST /api/schedule/background-cycle/trigger`, causado por lock huérfano en `OperationManager.locks`
- [v2.3 Init]: Hipótesis principal — `axios` al portal sin timeout cuelga `forResponse`, `finally` nunca corre
- [v2.3 Init]: Alcance confirmado con usuario — 3 phases (observability, recovery, root cause fix)
- [v2.3 Init]: Root cause fix incluye 3 timeouts: axios portal calls, startChildProcess, per-step Promise.race
- [v2.3 Phase 17]: stepProgress como array histórico de steps con startStep/endStep explícitos; se borra en releaseLock
- [v2.3 Phase 17]: Refresco UI híbrido — polling 5s siempre + SSE para timeline existente
- [v2.3 Phase 17]: Card nuevo "Operación en curso" arriba del timeline; oculto en idle
- [v2.3 Phase 17]: API mantiene shape de map por operationType (corrigiendo bug en schedule.html:589)
- [v2.3 Phase 17]: startChildProcess instrumentado en CronScheduler.js (no background.js); manual trigger tiene 7 steps, cron tick tiene 8

### Pending Todos

- Fix uploadPayments 7-day lookback (PortalPaymentController.js:70) — prevents missed payments when auto-cycle skips a day
- Support partial payment completion — handle incomplete uploads and split payments (multi-PY for same invoice)
- Bug producción `EMFILE: too many open files` al servir `404.html` — file descriptor leak; abrir como nuevo phase/milestone (no en alcance v2.3)

### Blockers/Concerns

- No Sage DB access locally: SQL query changes can only be validated structurally
- No repro local del bug: requiere prod (ZCL-RDS-02) o simulación con mocks
- Servy como Windows service no tiene sesión de escritorio: child-process GUI puede colgarse

## Session Continuity

Last session: 2026-04-27T00:00:00.000Z
Stopped at: Phase 17 context gathered
Resume file: .planning/milestones/v2.3-phases/17-observability-diagnostics/17-CONTEXT.md
