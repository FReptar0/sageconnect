# v2.3 Scheduler Lock Recovery — Roadmap

**Milestone goal:** Eliminar el bug "Ejecutar Ahora" HTTP 409 permanente via observability, recovery, y root-cause fixes.

**Phases:** 3 | **Requirements:** 14 | **Phase numbering:** continues from v2.2 (starts at 17)

## Progress

| Phase | Plans | Completed | Status |
|-------|-------|-----------|--------|
| 17 — Observability & Diagnostics | 4 | 2 | in-progress (17-01, 17-02 done) |
| 18 — Auto-release & Manual Override | TBD | 0 | pending |
| 19 — Root Cause Timeouts | TBD | 0 | pending |

## Phase Overview

| # | Phase | Goal | Requirements | Dependencies |
|---|-------|------|--------------|--------------|
| 17 | Observability & Diagnostics | Exponer el estado de locks y heartbeats del ciclo en UI + API | OBS-01, OBS-02, OBS-03, OBS-04, OBS-05 | — |
| 18 | Auto-release & Manual Override | Recuperación automática (timeout) y manual (botón + endpoint) | REC-01, REC-02, REC-03, REC-04, REC-05 | Phase 17 (OperationManager extensions) |
| 19 | Root Cause Timeouts | Prevenir cuelgues con timeouts en axios, child process, y per-step | ROOT-01, ROOT-02, ROOT-03, ROOT-04 | — (independiente; se beneficia de logging de 17) |

## Phase Details

### Phase 17: Observability & Diagnostics

**Goal:** Dar al operador visibilidad en tiempo real del estado de locks y de cuál step del ciclo está corriendo (o colgado), tanto en UI como vía endpoint.

**Requirements mapped:**
- **OBS-01** — Ver locks held en `schedule.html` con `operationType`, `operationId`, `startedAt`
- **OBS-02** — Ver último heartbeat timestamp por step del ciclo
- **OBS-03** — `OperationManager` expone `stepProgress` por operación
- **OBS-04** — `GET /api/operations/status` retorna locks enriquecidos
- **OBS-05** — Cada step de `forResponse` emite evento de progreso persistido

**Success criteria:**
1. Operador abre `/schedule.html` durante un ciclo activo y ve card "Operación en curso" con `operationType`, `operationId` (truncado), tiempo transcurrido, y step actual.
2. El mismo operador ve timestamp del último heartbeat de ese step (ej. "downloadCFDI — hace 45s").
3. `curl -H "x-api-key: X" GET /api/operations/status` retorna JSON con `operations: { background-cycle: { operationId, startedAt, stepProgress: [{step, startedAt, finishedAt?}] } }`.
4. Cuando el ciclo progresa entre steps, el UI refleja el cambio sin reload manual (polling cada 5s o SSE).

---

### Phase 18: Auto-release & Manual Override

**Goal:** Dar al operador (y al sistema) maneras de recuperarse de un lock huérfano sin reiniciar el servicio.

**Requirements mapped:**
- **REC-01** — Lock auto-release después de `LOCK_TIMEOUT_MS` (default 14 min)
- **REC-02** — Auto-release registra history + email a `LICENSE_ADMIN_EMAIL`
- **REC-03** — Botón "Forzar liberación" en `schedule.html` con confirmación
- **REC-04** — `POST /api/schedule/:taskId/force-release` endpoint
- **REC-05** — Force-release registra history de auditoría

**Dependencies:** Phase 17 (usa `stepProgress` y `getRunningOperations()` enriquecido).

**Success criteria:**
1. Simular lock stuck (test con lock held manualmente) → después de 14 min el lock se libera automáticamente y aparece nueva entrada en historial con `success: false` y summary "Timeout — lock forzosamente liberado".
2. Operador clickea "Forzar liberación" en UI, confirma diálogo, y el lock desaparece del estado activo en la siguiente poll.
3. `curl -H "x-api-key: X" POST /api/schedule/background-cycle/force-release` retorna 200 con `{data: {released: true, previousLock: {...}}}`.
4. Después de force-release, el botón "Ejecutar Ahora" permite disparar un nuevo ciclo sin 409.
5. Email al `LICENSE_ADMIN_EMAIL` incluye contexto: operationId, startedAt, duración, step activo al momento del timeout.

---

### Phase 19: Root Cause Timeouts

**Goal:** Prevenir que el lock se trabe en primer lugar, agregando timeouts explícitos a las tres fuentes de cuelgue identificadas: axios al portal, child process del importador, y per-step en el ciclo.

**Requirements mapped:**
- **ROOT-01** — Timeout en todas las llamadas axios al portal (default 30s)
- **ROOT-02** — Timeout en `startChildProcess` (default 10 min)
- **ROOT-03** — Per-step timeout vía `Promise.race` en `forResponse` (default 5 min)
- **ROOT-04** — Timeouts logueados con contexto

**Dependencies:** Independiente. Se beneficia de logging de Phase 17 pero no lo requiere.

**Success criteria:**
1. Simular portal endpoint que no responde (netsh / firewall rule durante test) → llamada axios aborta después de ~30s con error `ECONNABORTED` o `timeout`, el step falla limpio y el ciclo continúa con el siguiente tenant.
2. Simular `ImportaFacturasFocaltec.exe` colgado → `startChildProcess` mata el proceso a los 10 min y el Promise rechaza con error descriptivo.
3. En logs de `ForResponse.log`, cada timeout muestra: step name, tenant, URL (si axios), y duración antes del timeout.
4. Un ciclo completo corre en condiciones normales sin que ningún timeout dispare (no regresiones de performance).
5. Env vars `PORTAL_HTTP_TIMEOUT_MS`, `CHILD_PROCESS_TIMEOUT_MS`, `STEP_TIMEOUT_MS` son opcionales con defaults sensatos si no se setean.

---

## Coverage Validation

| REQ-ID | Phase | Status |
|--------|-------|--------|
| OBS-01 | 17 | ✓ mapped |
| OBS-02 | 17 | ✓ mapped |
| OBS-03 | 17 | ✓ mapped |
| OBS-04 | 17 | ✓ mapped |
| OBS-05 | 17 | ✓ mapped |
| REC-01 | 18 | ✓ mapped |
| REC-02 | 18 | ✓ mapped |
| REC-03 | 18 | ✓ mapped |
| REC-04 | 18 | ✓ mapped |
| REC-05 | 18 | ✓ mapped |
| ROOT-01 | 19 | ✓ mapped |
| ROOT-02 | 19 | ✓ mapped |
| ROOT-03 | 19 | ✓ mapped |
| ROOT-04 | 19 | ✓ mapped |

**Coverage:** 14/14 (100%) — todos los REQs mapeados a una phase única.
