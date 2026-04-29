# v2.3 Scheduler Lock Recovery — Roadmap

**Milestone goal:** Eliminar el bug "Ejecutar Ahora" HTTP 409 permanente via observability, recovery, y root-cause fixes.

**Phases:** 3 | **Requirements:** 14 | **Phase numbering:** continues from v2.2 (starts at 17)

## Progress

| Phase | Plans | Completed | Status |
|-------|-------|-----------|--------|
| 17 — Observability & Diagnostics | 4 | 4 | ✓ Complete (17-01, 17-02, 17-03, 17-04 all done) |
| 18 — Auto-release & Manual Override | 3 | 3 | ✓ Complete (18-01, 18-02, 18-03 all done) |
| 19 — Root Cause Timeouts | 3 | 1 | in progress (19-01 ✓ done; 19-02, 19-03 pending) |

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

**Plans:** 3 plans
- [x] 18-01-PLAN.md — Backend timer (acquireLock/releaseLock encapsulation), lock:timeout event, listener (addHistory + admin email + log), config knob, helper, tests. Wave 1. Covers REC-01, REC-02. **✓ done 2026-04-28** (commits 671c7ad, 1f8f142, 2d1bbb5, 7ba4534, 53506fb, 8d2bb5b — see [18-01-SUMMARY.md](milestones/v2.3-phases/18-auto-release-manual-override/18-01-SUMMARY.md)).
- [x] 18-02-PLAN.md — Backend POST /:taskId/force-release endpoint (idempotent ResultEnvelope, audit history, parity admin email), Joi schemas, integration tests. Wave 2 (depends on 18-01 helper + email pattern). Covers REC-04, REC-05. **✓ done 2026-04-28** (commits ef1cb3f, 0ab91d7, bf34398 — see [18-02-SUMMARY.md](milestones/v2.3-phases/18-auto-release-manual-override/18-02-SUMMARY.md)).
- [x] 18-03-PLAN.md — Frontend button + Bootstrap modal in schedule.html, state machine, optimistic UI hide, focus management, XSS-safe context line. Wave 3 (depends on 18-02 endpoint contract). Covers REC-03. NOT autonomous (ends with human-verify checkpoint against UI-SPEC.md). **✓ done 2026-04-28** (commits c6d5b0e, d46778c — chrome-devtools MCP browser-automated verification PASSED 6/6 active rows; row 7 N/A — see [18-03-SUMMARY.md](milestones/v2.3-phases/18-auto-release-manual-override/18-03-SUMMARY.md)). Plan 18-01 collateral fix `061b7c5` (`fix(18-01): exclude timeoutHandle from getRunningOperations`) shipped during verification — 46/46 tests across affected suites.

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

**Plans:** 3 plans
- [ ] 19-01-PLAN.md — Centralized PortalClient (axios.create with config-driven timeout) + 9 file refactor (18 axios call sites in path always-on) + config knob `portal.httpTimeoutMs` (default 30s, range guard >= 1000ms) + tests for cliente. Wave 1. Covers ROOT-01.
- [ ] 19-02-PLAN.md — Backend startChildProcess kill cascade (setTimeout + SIGTERM + 30s grace + taskkill /F /T fallback + hasSettled flag) + CronScheduler dispatch sendAdminAlert + dual log [TIMEOUT] when wording sentinel `Child process timeout` matches + config knob `schedule.childProcessTimeoutMs` (default 10 min, range guard >= 60000ms) + tests with jest fake timers + spawn EventEmitter mock. Wave 1 (orthogonal a 19-01, no file overlap excepto config.js distinct sections). Covers ROOT-02.
- [ ] 19-03-PLAN.md — Per-step Promise.race wrapper via `withStepTimeout` helper en `src/utils/duration.js` + envuelve los 7 `await stepFn(i)` calls in forResponse + log [TIMEOUT] cuando wording sentinel `Step timeout` matches + config knob `schedule.stepTimeoutMs` (default 5 min, range guard >= 30000ms) + enrichment de UN axios callsite ejemplo (PortalPaymentController) con [TIMEOUT] cuando ECONNABORTED + integration tests para log routing per timeout source. Wave 2 (depends_on 19-01 + 19-02). Covers ROOT-03 + ROOT-04.

---

## Coverage Validation

| REQ-ID | Phase | Status |
|--------|-------|--------|
| OBS-01 | 17 | ✓ mapped |
| OBS-02 | 17 | ✓ mapped |
| OBS-03 | 17 | ✓ mapped |
| OBS-04 | 17 | ✓ mapped |
| OBS-05 | 17 | ✓ mapped |
| REC-01 | 18 | ✓ done (Plan 18-01, commits 671c7ad + 2d1bbb5) |
| REC-02 | 18 | ✓ done (Plan 18-01, commits 53506fb) |
| REC-03 | 18 | ✓ done (Plan 18-03, commits c6d5b0e + d46778c) |
| REC-04 | 18 | ✓ done (Plan 18-02, commit bf34398) |
| REC-05 | 18 | ✓ done (Plan 18-02, commit bf34398) |
| ROOT-01 | 19 | ✓ mapped |
| ROOT-02 | 19 | ✓ mapped |
| ROOT-03 | 19 | ✓ mapped |
| ROOT-04 | 19 | ✓ mapped |

**Coverage:** 14/14 (100%) — todos los REQs mapeados a una phase única.
