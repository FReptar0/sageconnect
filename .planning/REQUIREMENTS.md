# v2.3 Scheduler Lock Recovery — Requirements

**Milestone goal:** Eliminar el bug donde el botón "Ejecutar Ahora" en `schedule.html` retorna permanentemente 409 "ya en ejecución" por locks huérfanos en `OperationManager`, con observability para diagnosticar, recovery para operadores, y fixes de raíz para prevenir el cuelgue.

**Reported:** 2026-04-24, producción (ZCL-RDS-02, Capstone Copper / COPDAT).

## v2.3 Requirements

### Observability (OBS)

- [x] **OBS-01**: Operador puede ver en `schedule.html` qué locks están actualmente held, con `operationType`, `operationId`, y `startedAt` (hace cuánto). _(Completado en Plan 17-04: card "Operación en curso" con polling 5s + truncated operationId + tooltip ISO completo)_
- [x] **OBS-02**: Operador puede ver el último heartbeat timestamp por step del ciclo (buildProvidersXML, downloadCFDI, checkPayments, uploadPayments, createPurchaseOrders, processOrderChanges, closePurchaseOrders, startChildProcess). _(Backend instrumentation completado en Plan 17-03; UI surfacing completado en Plan 17-04 con heartbeat ticker 1s + label "Step actual: ... · heartbeat hace Xs")_
- [x] **OBS-03**: `OperationManager.acquireLock` registra `stepProgress` (timestamps por step) accesibles vía `getRunningOperations()`. _(Completado en Plan 17-01)_
- [x] **OBS-04**: Endpoint `GET /api/operations/status` retorna locks activos + `startedAt` + `stepProgress` para diagnóstico sin UI. _(Completado en Plan 17-02)_
- [x] **OBS-05**: Cada step de `forResponse` emite un evento de progreso con timestamp al `OperationManager` (reutiliza `emitProgress` existente pero persiste el último). _(Completado en Plan 17-03)_

### Recovery (REC)

- [x] **REC-01**: Lock `background-cycle` se auto-libera después de N minutos (configurable via env `LOCK_TIMEOUT_MS`, default 14 minutos ≈ 93% de la cadencia cron de 15 min). _(Completado en Plan 18-01: timer encapsulado en OperationManager.acquireLock con `setTimeout(_fireTimeout, lockTimeoutMs)` + `clearTimeout` en releaseLock; config knob `config.schedule.lockTimeoutMs` con env override `LOCK_TIMEOUT_MS` y validación `< 60000ms`. Commits 671c7ad + 2d1bbb5)_
- [x] **REC-02**: Cuando un lock se auto-libera por timeout, el evento se registra en `addHistory` con `success: false` y `summary: "Timeout — lock forzosamente liberado después de Xm"` + se envía email al `LICENSE_ADMIN_EMAIL`. _(Completado en Plan 18-01: listener registrado dentro de `initScheduler()` que escucha `lock:timeout` event y dispara addHistory + admin email + warn log con prefix `[TIMEOUT]`. Commits 7ba4534 + 53506fb)_
- [x] **REC-03**: Operador puede hacer click en botón "Forzar liberación" en `schedule.html` cuando el lock esté held. Muestra confirmación bilingüe antes de ejecutar. _(Completado en Plan 18-03: `#btn-force-release` (`btn-sm btn-outline-danger` + `fa-unlock-alt`) inside the existing card header, Bootstrap 5.3 `#forceReleaseModal` mounted before `</body>` with full ARIA contract + Spanish-only copy verbatim from 18-UI-SPEC.md, three event listeners inside `DOMContentLoaded` (`show.bs.modal` repopulates context from `activeOpSnapshot` + clears stale error; `shown.bs.modal` overrides Bootstrap default focus to land on Cancelar — destructive-confirmation safeguard against accidental Enter-confirms; click on Confirmar invokes `submitForceRelease`). State machine: idle → loading (disable both buttons + spinner + `Liberando...`) → on `released:true` close modal + optimistic `hideActiveOperationCard()` + no toast | on `released:false` close modal + warning toast `'El lock ya se había liberado'` + hide card | on 4xx/5xx/network keep modal open + inline `alert-danger` with `escapeHtml(err.message)` + re-enable buttons. `escapeHtml()` applied at every dynamic-value injection point (T-18-03-01..03 mitigation). Verified via chrome-devtools MCP browser automation: 6/6 active rows PASS, row 7 (admin email parity) N/A — no local SMTP, covered by Plan 18-02 nodemailer mocks. Commits c6d5b0e + d46778c. Plan 18-01 collateral fix `061b7c5` shipped during verification — 46/46 tests across affected suites.)_
- [x] **REC-04**: Endpoint `POST /api/schedule/:taskId/force-release` libera el lock especificado. Requiere `x-api-key` + `writeLimiter`. Retorna `ResultEnvelope` con `{released: boolean, previousLock: {...}}`. _(Completado en Plan 18-02: handler idempotente — siempre 200, `data.released:true|false` discriminator. Middleware order `requireApiKey → validate(params) → validate(body) → writeLimiter → asyncHandler`. Snapshot-before-release ordering captura `previousLock {operationId, startedAt, durationMs, stuckOnStep, stuckOnTenant}`. Commit bf34398)_
- [x] **REC-05**: Force-release genera entrada en `addHistory` con `success: false`, `summary: "Lock forzado manualmente por operador"`, para dejar auditoría. _(Completado en Plan 18-02: handler llama `addHistory({errors:['ManualForceRelease'], summary:'Lock forzado manualmente por operador (motivo: <reason>)? — duración <Xm Ys>', stuckOnStep, stuckOnTenant})`. Path idempotente NO añade history para evitar polución. Email parity con D-08: subject `'[SageConnect] Liberación manual: lock <op> forzado por operador'` vía inline `sendAdminAlert`. Commit bf34398)_

### Root Cause Prevention (ROOT)

- [ ] **ROOT-01**: Todas las llamadas `axios.get/post` al portal de proveedores tienen `timeout` explícito (default 30s, configurable via env `PORTAL_HTTP_TIMEOUT_MS`).
- [x] **ROOT-02**: `startChildProcess` mata el proceso hijo (`ImportaFacturasFocaltec.exe`) si no termina en N minutos (default 10 min, configurable via env `CHILD_PROCESS_TIMEOUT_MS`), rejecta el Promise con error descriptivo.
- [ ] **ROOT-03**: Cada step de `forResponse` tiene per-step timeout vía `Promise.race` (default 5 min por step, configurable via env `STEP_TIMEOUT_MS`). Timeout en un step no aborta los siguientes — se loggea y continúa con el siguiente tenant.
- [ ] **ROOT-04**: Cuando un timeout (ROOT-01/02/03) dispara, el error se loggea a `CronScheduler.log` y `ForResponse.log` con contexto (step, tenant, URL, duración).

### Traceability

| REQ-ID | Phase | Phase Name | Notes |
|--------|-------|------------|-------|
| OBS-01 | 17 | Observability & Diagnostics | UI card — ✓ done (Plan 17-04, commits 53104ef + 831ee36 + 3d8b822) |
| OBS-02 | 17 | Observability & Diagnostics | Step heartbeat UI — backend instrumented in Plan 17-03 (4bfcc70 + 9b109f5); UI surfacing ✓ done in Plan 17-04 (53104ef + 831ee36 + 3d8b822) |
| OBS-03 | 17 | Observability & Diagnostics | OperationManager extension — ✓ done (Plan 17-01, commits 4c1367d + a804422) |
| OBS-04 | 17 | Observability & Diagnostics | API endpoint — ✓ done (Plan 17-02, commits 7ce3412 + cbadb59) |
| OBS-05 | 17 | Observability & Diagnostics | background.js instrumentation — ✓ done (Plan 17-03, commits 4bfcc70 + 9b109f5 + 98d41f5) |
| REC-01 | 18 | Auto-release & Manual Override | Auto-timeout — ✓ done (Plan 18-01, commits 671c7ad + 2d1bbb5) |
| REC-02 | 18 | Auto-release & Manual Override | Audit log + email — ✓ done (Plan 18-01, commits 7ba4534 + 53506fb) |
| REC-03 | 18 | Auto-release & Manual Override | UI button — ✓ done (Plan 18-03, commits c6d5b0e + d46778c) |
| REC-04 | 18 | Auto-release & Manual Override | API endpoint — ✓ done (Plan 18-02, commit bf34398) |
| REC-05 | 18 | Auto-release & Manual Override | Audit entry — ✓ done (Plan 18-02, commit bf34398) |
| ROOT-01 | 19 | Root Cause Timeouts | axios timeout |
| ROOT-02 | 19 | Root Cause Timeouts | child process timeout — ✓ done (Plan 19-02, commits ed6438d + 25bc329 + 59972bb + 012b6ad + f40fe29 + c0d5735) |
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
