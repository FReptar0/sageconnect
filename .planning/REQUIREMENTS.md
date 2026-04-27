# v2.3 Scheduler Lock Recovery — Requirements

**Milestone goal:** Eliminar el bug donde el botón "Ejecutar Ahora" en `schedule.html` retorna permanentemente 409 "ya en ejecución" por locks huérfanos en `OperationManager`, con observability para diagnosticar, recovery para operadores, y fixes de raíz para prevenir el cuelgue.

**Reported:** 2026-04-24, producción (ZCL-RDS-02, Capstone Copper / COPDAT).

## v2.3 Requirements

### Observability (OBS)

- [ ] **OBS-01**: Operador puede ver en `schedule.html` qué locks están actualmente held, con `operationType`, `operationId`, y `startedAt` (hace cuánto).
- [ ] **OBS-02**: Operador puede ver el último heartbeat timestamp por step del ciclo (buildProvidersXML, downloadCFDI, checkPayments, uploadPayments, createPurchaseOrders, processOrderChanges, closePurchaseOrders, startChildProcess).
- [x] **OBS-03**: `OperationManager.acquireLock` registra `stepProgress` (timestamps por step) accesibles vía `getRunningOperations()`. _(Completado en Plan 17-01)_
- [ ] **OBS-04**: Endpoint `GET /api/operations/status` retorna locks activos + `startedAt` + `stepProgress` para diagnóstico sin UI.
- [ ] **OBS-05**: Cada step de `forResponse` emite un evento de progreso con timestamp al `OperationManager` (reutiliza `emitProgress` existente pero persiste el último).

### Recovery (REC)

- [ ] **REC-01**: Lock `background-cycle` se auto-libera después de N minutos (configurable via env `LOCK_TIMEOUT_MS`, default 14 minutos ≈ 93% de la cadencia cron de 15 min).
- [ ] **REC-02**: Cuando un lock se auto-libera por timeout, el evento se registra en `addHistory` con `success: false` y `summary: "Timeout — lock forzosamente liberado después de Xm"` + se envía email al `LICENSE_ADMIN_EMAIL`.
- [ ] **REC-03**: Operador puede hacer click en botón "Forzar liberación" en `schedule.html` cuando el lock esté held. Muestra confirmación bilingüe antes de ejecutar.
- [ ] **REC-04**: Endpoint `POST /api/schedule/:taskId/force-release` libera el lock especificado. Requiere `x-api-key` + `writeLimiter`. Retorna `ResultEnvelope` con `{released: boolean, previousLock: {...}}`.
- [ ] **REC-05**: Force-release genera entrada en `addHistory` con `success: false`, `summary: "Lock forzado manualmente por operador"`, para dejar auditoría.

### Root Cause Prevention (ROOT)

- [ ] **ROOT-01**: Todas las llamadas `axios.get/post` al portal de proveedores tienen `timeout` explícito (default 30s, configurable via env `PORTAL_HTTP_TIMEOUT_MS`).
- [ ] **ROOT-02**: `startChildProcess` mata el proceso hijo (`ImportaFacturasFocaltec.exe`) si no termina en N minutos (default 10 min, configurable via env `CHILD_PROCESS_TIMEOUT_MS`), rejecta el Promise con error descriptivo.
- [ ] **ROOT-03**: Cada step de `forResponse` tiene per-step timeout vía `Promise.race` (default 5 min por step, configurable via env `STEP_TIMEOUT_MS`). Timeout en un step no aborta los siguientes — se loggea y continúa con el siguiente tenant.
- [ ] **ROOT-04**: Cuando un timeout (ROOT-01/02/03) dispara, el error se loggea a `CronScheduler.log` y `ForResponse.log` con contexto (step, tenant, URL, duración).

### Traceability

| REQ-ID | Phase | Phase Name | Notes |
|--------|-------|------------|-------|
| OBS-01 | 17 | Observability & Diagnostics | UI card |
| OBS-02 | 17 | Observability & Diagnostics | Step heartbeat UI |
| OBS-03 | 17 | Observability & Diagnostics | OperationManager extension — ✓ done (Plan 17-01, commits 4c1367d + a804422) |
| OBS-04 | 17 | Observability & Diagnostics | API endpoint |
| OBS-05 | 17 | Observability & Diagnostics | background.js instrumentation |
| REC-01 | 18 | Auto-release & Manual Override | Auto-timeout |
| REC-02 | 18 | Auto-release & Manual Override | Audit log + email |
| REC-03 | 18 | Auto-release & Manual Override | UI button |
| REC-04 | 18 | Auto-release & Manual Override | API endpoint |
| REC-05 | 18 | Auto-release & Manual Override | Audit entry |
| ROOT-01 | 19 | Root Cause Timeouts | axios timeout |
| ROOT-02 | 19 | Root Cause Timeouts | child process timeout |
| ROOT-03 | 19 | Root Cause Timeouts | per-step Promise.race |
| ROOT-04 | 19 | Root Cause Timeouts | Timeout logging |

## Future Requirements (Deferred)

- Dashboard de operaciones con historial detallado por tenant
- Alertas proactivas (Slack/email) cuando un cycle excede N min
- Métricas de duración por step para tendencias

## Out of Scope

- **Reemplazar `ImportaFacturasFocaltec.exe` por API directa a Sage** — milestone futuro separado
- **Replicación/cluster del servicio** — un solo server por cliente por ahora
- **Rate limiting del botón "Ejecutar Ahora"** — ya existe `writeLimiter` genérico; no hace falta limit específico
- **Persistencia de locks a disco** — los locks son estado volátil; restart del service es recovery válido
