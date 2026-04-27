---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Scheduler Lock Recovery
status: in-progress
stopped_at: Phase 17 Plan 03 complete; ready to execute Plan 04 (UI card + polling + schedule.html bug fix)
last_updated: "2026-04-27T19:11:03Z"
last_activity: 2026-04-27 — Plan 17-03 complete (background.js 7-step instrumentation + CronScheduler startChildProcess wrap; 17 cron-scheduler tests pass)
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 4
  completed_plans: 3
  percent: 75
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-24)

**Core value:** La integración Sage-Portal debe ser confiable, mantenible, y operable: servicio continuo con interfaz web para operaciones y monitoreo en tiempo real.
**Current focus:** v2.3 Scheduler Lock Recovery — Phase 17 Observability nearly complete (3/4 plans done; only UI card remains)

## Current Position

Phase: 17 — Observability & Diagnostics (in-progress)
Plan: 3/4 complete (17-01, 17-02, 17-03 done; 17-04 pending)
Status: Ready to execute Plan 17-04 (UI card + polling + schedule.html bug fix)
Last activity: 2026-04-27 — Plan 17-03 complete; 17 cron-scheduler tests pass; commits 4bfcc70 + 9b109f5 + 98d41f5

Progress: [████████░░] 75%

### Phase 17 Plan Layout

| Wave | Plan | Files | Autonomous | Reqs | Status |
|------|------|-------|------------|------|--------|
| 1 | 17-01 | OperationManager.js + tests | yes | OBS-03 | ✓ done (4c1367d, a804422, 132a316) |
| 2 | 17-02 | operations-routes.js + tests | yes | OBS-04 | ✓ done (7ce3412, cbadb59) |
| 2 | 17-03 | background.js + CronScheduler.js + tests | yes | OBS-02, OBS-05 | ✓ done (4bfcc70, 9b109f5, 98d41f5) |
| 3 | 17-04 | shared.js + schedule.html (UI card + polling + bug fix) | no (manual checkpoint) | OBS-01, OBS-02 | pending |

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
- [v2.3 Plan 17-01]: stepProgress vive en this.locks slot (no Map separado) — hereda releaseLock cleanup automáticamente
- [v2.3 Plan 17-01]: startStep/endStep son no-op si el lock no existe — defensa contra race con releaseLock
- [v2.3 Plan 17-01]: endStep itera backwards (LIFO) para resolver retries concurrentes en orden
- [v2.3 Plan 17-01]: Sin Winston/logger en startStep/endStep para no inflar logs (se logea sólo en sites de error del caller)
- [v2.3 Plan 17-02]: operations-routes.js es thin pass-through — OperationManager es dueño de la shape, el route handler no transforma
- [v2.3 Plan 17-02]: Task 1 commit como `docs(17-02)` (no `feat`) — runtime path byte-equivalent, sólo JSDoc/comments cambian
- [v2.3 Plan 17-02]: Bug fix de schedule.html:589 (operations.find on a map) NO se hace acá — pertenece a Plan 17-04 con el card UI
- [v2.3 Plan 17-02]: Test de Array.isArray===false + Object.keys es regression guard explícito contra el patrón del bug schedule.html:589 a nivel API
- [v2.3 Plan 17-02]: SSE endpoint (/:operationId/stream) byte-identical post-edit — verificado por 3 tests SSE supervivientes
- [v2.3 Plan 17-03]: Block-scoped `{ const __step; let __stepError; try/catch/finally }` por step evita colisiones de const entre los 7 hermanos del mismo for-loop iteration
- [v2.3 Plan 17-03]: Inner catch captura+re-throw es obligatorio (no try/finally puro) — el catch escribe el mensaje de error al stepProgress entry vía endStep, después re-throw para que el OUTER tenant catch maneje el continue
- [v2.3 Plan 17-03]: tenant=null literal (no 'global', no 'null' string) para startChildProcess — match con la wire shape locked en Plan 17-02
- [v2.3 Plan 17-03]: Task 2 commit BEFORE Task 3 (production code antes que mock) — produce un broken-tests state visible en git como artefacto educativo de que la mock extension es REQUERIDA, no opcional
- [v2.3 Plan 17-03]: Verification scripts (scripts/verify-bg-instrumentation.js, scripts/verify-cron-instrumentation.js) commitidos como regression guards permanentes (no throwaway), encoden el contrato estructural (exactamente 7 startStep/7 endStep en background.js, exactamente 1 en CronScheduler con tenant=null)

### Pending Todos

- Fix uploadPayments 7-day lookback (PortalPaymentController.js:70) — prevents missed payments when auto-cycle skips a day
- Support partial payment completion — handle incomplete uploads and split payments (multi-PY for same invoice)
- Bug producción `EMFILE: too many open files` al servir `404.html` — file descriptor leak; abrir como nuevo phase/milestone (no en alcance v2.3)

### Blockers/Concerns

- No Sage DB access locally: SQL query changes can only be validated structurally
- No repro local del bug: requiere prod (ZCL-RDS-02) o simulación con mocks
- Servy como Windows service no tiene sesión de escritorio: child-process GUI puede colgarse

## Session Continuity

Last session: 2026-04-27T19:11:03Z
Stopped at: Phase 17 Plan 03 complete (background.js + CronScheduler.js step instrumentation; runtime now populates the stepProgress wire shape Plan 17-02 locked)
Resume file: .planning/milestones/v2.3-phases/17-observability-diagnostics/17-04-PLAN.md (when written) — UI card + polling + schedule.html bug fix
