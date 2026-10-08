---
gsd_state_version: 1.0
milestone: null
milestone_name: (TBD)
status: planning
stopped_at: Phase 24 context gathered
last_updated: "2026-10-08T17:31:15.948Z"
progress:
  total_phases: 3
  completed_phases: 1
  total_plans: 8
  completed_plans: 4
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-29 after v2.3 milestone)

**Core value:** La integración Sage-Portal debe ser confiable, mantenible, y operable: servicio continuo con interfaz web para operaciones y monitoreo en tiempo real.
**Current focus:** Fase 24 — paginar la descarga de CFDIs (tope de 200) en `feat/paginar-descarga-cfdi`. SPEC y CONTEXT listos; siguiente: `/gsd-plan-phase 24`.

## Current Position

Phase: 24 (paginar-descarga-cfdi) — SPEC (15 requisitos: `813c966`, `02f1f34`) y CONTEXT (`aead972`) listos
Plan: sin planes todavía — siguiente: `/gsd-plan-phase 24`
Status: Ready to plan — fase 24 con requisitos y decisiones de implementación fijados; la fase 23 ya está en `master` (PR #27, `dde4bd0`)
Siguiente decision: `/gsd-plan-phase 24`. `master` sigue congelado hasta que prod tenga el build del botón (`0785a9a`); esta corrección sale después, como build aparte.

## Deferred Items

Items acknowledged and deferred at milestone close on 2026-04-29:

| Category | Item | Status |
|----------|------|--------|
| todo | 2026-04-16-fix-uploadpayments-lookback-to-prevent-missed-payments | pending — pre-existing, unrelated to v2.3 scope |
| todo | 2026-04-16-support-partial-payment-completion-for-incomplete-uploads | pending — pre-existing, unrelated to v2.3 scope |

**Quick Tasks Completed (pre-v2.3-deploy fixes):**

| Quick ID | Description | Date | Commits | Notes |
|----------|-------------|------|---------|-------|
| 260502-i7l | validate XML providers + error reports | 2026-05-02 | 7bb2f63, aaa733e, 43d4fde | path-b chosen — extracted sendAdminAlert + findLastOpenStep to src/utils/AdminEmailSender.js with callerLogFile param (closes PATTERNS.md §S-6 3rd-use trigger). Closed 2 blind spots in XML proveedores flow: (1) GetProviders re-throw on portal error, (2) buildProvidersXML try/catch + post-write validation. 9 new tests, 0 regressions. |
| 260513-ket | drop PORHSTAT from po-cron-diagnostic POPORH1 lookup | 2026-05-13 | 14637bf | closes GH issue #24 — `PORHSTAT` no existe en COPDAT schema; prod run 2026-05-12 emitió `Invalid column name`; safeRun lo enmascaró pero `existsInPOPORH1` quedaba `null` en vez de `true`. Fix: 3 líneas removidas (verdict initializer, columna del SELECT, lectura) + ajuste de coma. Diff: `1 insertion, 4 deletions`. 0 tests tocados (no había cobertura del script). Branch: `fix/po-cron-diagnostic-porhstat`. |
| 260730-gcz | página de ejecución manual simplificada para Memo | 2026-07-30 | 58d5b41 | rama `feat/boton-ejecucion` (desde prod). Nueva `public/ejecucion.html` (card última/próxima ejecución + botón "▶ Ejecutar proceso ahora") + 1 línea en `src/server.js` para servirla. Reutiliza el endpoint `/api/schedule/background-cycle/trigger` existente; sin logs/historial/force-release. `npm test` en baseline §6 (6 suites / 7 tests de 426, cero nuevas). Pendiente: merge a master + exponer vía Bastion (Jorge/Alan) para el operador Memo. |
| 260730-lki | el botón de ejecución refleja el estado real de sincronización | 2026-07-30 | 9a1c211 | continuación de `260730-gcz` en la misma rama. El botón sólo se deshabilitaba durante su propio POST, así que el operador lo veía habilitado con el cron ya corriendo → click → 409 confuso. Ahora `public/ejecucion.html` hace poll a `GET /api/operations/status` cada 3.5s y refleja el estado real: si existe `operations['background-cycle']` (venga del cron o de un disparo manual de cualquiera) → deshabilitado + "Sincronizando...". Acceso directo al mapa, nunca `.find()` (bug D-04 Fase 17). Fail-safe: cualquier fallo del poll re-habilita, nunca traba el botón. Bandera `triggerInFlight` para la carrera con el POST. `fetch` directo en vez de `apiCall()` para no encadenar toasts cada 3.5s (ver follow-up "apiCall toast suppression" abajo). `setInterval` liberado en `beforeunload` (CLAUDE.md §3). 1 archivo, +168/−3, cero backend. `npm test` en baseline §6. Pendiente: validación con evidencia en `zcl-rds-test` (Santiago/Memo) + merge a master. |

**Non-blocking follow-ups from v2.3 (recommendations, not REQs):**

- AbortController retrofit completo — defer hasta evidencia operacional muestre necesidad concreta. Phantom continuation NARROWED a step-level only es la forma actual.
- `apiCall` toast suppression para force-release call site (Plan 18-03 minor follow-up; UI-SPEC L123 prescribe "no toast — inline only" pero shared.js helper fires generic toast on every failed fetch)
- Otros 8 axios callsites enrichment con `[TIMEOUT]` log entries (Plan 19-03 enriqueció solo PortalPaymentController.js como ejemplo cross-cutting)
- `scripts/obfuscate.js` allowlist → blocklist refactor (PR #20 retrospective)
- ~~`sendAdminAlert` + `findLastOpenStep` extraction a `src/utils/AdminEmailSender.js`~~ ✓ resolved 2026-05-02 via quick-260502-i7l (3rd-use trigger fired; both helpers extracted with callerLogFile param preserving log routing)

## Decisions

Decisiones tomadas durante la ejecución (las de diseño viven en `23-CONTEXT.md`; aquí solo las que cambiaron o se fijaron al ejecutar):

| Fecha | Plan | Decisión |
|-------|------|----------|
| 2026-08-31 | 23-01 | **D-16 revisada** — los casos de REQ-23-01..04 viven en el archivo NUEVO `tests/api/schedule-trigger-import.test.js`, no dentro de `tests/api/schedule-routes.test.js`. Los mocks nuevos (`AdminEmailSender`, `childProcessTimeoutMs`, `startStep`/`endStep`) son hoisted y aplican a todo el archivo, así que habrían cambiado el entorno de sus 4 tests actuales del trigger. Archivo propio ⇒ REQ-23-06 cierto por construcción. |
| 2026-08-31 | 23-01 | **D-01 confirmada en ejecución** — el bloque del importador se duplica entre `CronScheduler.js` y `schedule-routes.js`; NO se extrae. Contador PATTERNS.md §S-6 queda en 2 de 3. La duplicación quedó blindada con 3 aserciones nuevas sobre el fuente en `timeout-logging.test.js`. |
| 2026-08-31 | 23-01 | **Literal `'background-cycle'` en `startStep`/`endStep`**, no la variable `taskId` — esa clave es la del LOCK (invariante), no el parámetro de la request. Mantiene paridad byte a byte con el cron y sobrevive si un endpoint futuro acepta otros nombres de tarea sobre el mismo lock. |
| 2026-08-31 | 23-01 | **Cero recursos always-on nuevos** (CLAUDE.md §3): sin `setInterval`, `setTimeout`, listener, `Map`/`Set` de módulo ni `spawn` propio. Invariante de timeouts §9 intacta. |
| 2026-08-31 | 23-02 | **La derivación del paso abierto lleva una guarda por entrada que `findLastOpenStep` no tiene** — `src/utils/AdminEmailSender.js:73-79` lanzaría ante una entrada `null` porque del lado del servidor el arreglo lo construye `OperationManager` y siempre está bien formado. En el navegador el arreglo llega por la red, así que la reimplementación agrega `steps[i] &&`. D-13 ("nunca se lanza") pesa más que la paridad literal con el helper. |
| 2026-08-31 | 23-02 | **El estado se calcula una sola vez en `desired` y las tres ramas de innerHTML ramifican sobre él**, en vez de ramificar sobre `running`/`importing` por separado. La guarda de idempotencia (D-06) y el pintado quedan leyendo la MISMA variable: es imposible que diverjan y que el `dataset.uiState` diga una cosa y el botón muestre otra. |
| 2026-08-31 | 23-02 | **El optimista de `ejecutar()` pasa `applyButtonState(true, false)`** — un ciclo recién disparado está en el primer paso, nunca importando. Si por lo que fuera lo estuviera, el siguiente tick del poll (≤3.5s) corrige. Nunca se adivina `importing` desde el cliente. |
| 2026-08-31 | 23-04 | **La guarda de propiedad vive en el llamador, no en `releaseLock`** — `git diff src/services/OperationManager.js` vacío. Cambiar la firma o el comportamiento de una utilidad compartida es el pitfall #2 de CLAUDE.md §6 (el PR #16 rompió 7 llamadores). `ownsLock()` compara el `operationId` del slot vigente antes de `releaseLock`, `startStep` y `endStep`. |
| 2026-08-31 | 23-04 | **`ownsLock()` es estricto (el slot debe existir Y ser propio)** — omitir `releaseLock` cuando el slot no existe es un no-op inofensivo; el peligro sólo aparece cuando existe y es ajeno. El caso (j) de regresión fija que la guarda no puede trabar el candado: una guarda demasiado estricta devolvería 409 hasta el próximo reinicio del servicio. |
| 2026-08-31 | 23-04 | **El mock de `OperationManager` pasa a modelar la propiedad del slot** — antes declaraba `acquireLock → true` con `getRunningOperations() → {}`, un estado que el módulo real no puede producir, y por eso CR-01 fue invisible para los 6 tests. Cambió sólo el andamiaje; ninguna assertion original se tocó. |
| 2026-08-31 | 23-04 | **Prueba negativa obligatoria antes de dar por bueno un test de regresión** — con `ownsLock()` neutralizado, (g)/(h)/(i) truenan y los 6 casos originales siguen verdes; con el bloque del importador comentado, las 3 aserciones de paridad truenan. Un test que no puede fallar no prueba nada: así se coló WR-02. |
| 2026-08-31 | 23-04 | **`CronScheduler.js` editado SÓLO en comentarios** (relajación acotada de REQ-23-06, registrada en la enmienda del SPEC) — dejar escrito en el archivo que `startChildProcess` es cron-only, después de que la fase 23 lo volvió falso, era peor que el diff vacío. Ni una línea ejecutable cambió. |

## Blockers/Concerns

- No Sage DB access locally: SQL query changes can only be validated structurally
- No repro local del bug-class always-on: requiere prod (ZCL-RDS-02) o simulación con mocks
- Servy como Windows service no tiene sesión de escritorio: child-process GUI puede colgarse (mitigado por Plan 19-02 kill cascade en v2.3)

## Session Continuity

Last session: 2026-10-08T17:31:15.944Z
Session result (23-03): Plan 23-03 CERRADO — la fase 23 queda completa. El 01-sep se verificaron REQ-23-01 (el boton invoca al importador; 3 reproducciones, evidencia en `ChildProcess.log` con marcas de hora imposibles para el cron, que solo corre a las 03:01) y REQ-23-08 (`IMPORT_CFDIS_ROUTE` apunta al `.exe` directo, sin wrapper `.bat`, asi que la trampa de EINVAL en Node 22 no aplica). REQ-23-05 y REQ-23-09 quedaron bloqueados porque el `.exe` abortaba al arrancar con `GetParam, Faltan especificar los parametros de la seccion [CORREOAP]`: `Para=` estaba vacio en `E:\Sage\Sage300\Macros\COPDAT.ini` de zcl-rds-test — archivo de Sage 300, no de SageConnect, roto desde el 13-ene-2026. **Resuelto por la autora del importador**; con eso los dos requisitos se cerraron el 07-sep por confirmacion directa del operador: el tercer estado del boton ("Importando comprobantes a Sage...") ya se ve —no era un fallo de UI, el paso duraba 2 s contra un poll de 3.5 s— y la factura aparece en Cuentas por Pagar de Sage. Tambien se corrigio en el `.env` del servidor de test un desajuste de carpetas real (SageConnect escribia en `E:\sageconnect-dist\downloads`, el `.exe` lee `D:\XMLSFOCALTEC\`); prod ya tenia ambas variables apuntando a la carpeta del importador. **Hallazgo abierto y ahora mas urgente:** el `.exe` devuelve exit code 0 aunque falle, asi que ni el cron ni el boton detectan una importacion rota — tampoco en produccion; el `Para=` invisible durante siete meses mide el costo. Merece fase propia. Cero cambios de codigo en este plan.

Session result (23-04): Plan 23-04 ejecutado completo en `feat/boton-ejecucion` (3 tareas, 3 commits atómicos: `5f47a8e` fix, `7598f34` test, `59406f9` test). Cierra el **blocker CR-01** de la revisión de código: `releaseLock` borra el slot y cancela su watchdog sin comparar el `operationId`, así que la cadena manual —que al encadenar el importador pasa de ~13 a ~23 min contra un candado de 14— terminaba liberando el candado del cron, cancelándole el watchdog, dejando el estado en idle y habilitando un tercer ciclo concurrente. Ahora `ownsLock()` protege `releaseLock`, `startStep` y `endStep`; la omisión deja una entrada `[LOCK]` warn en `ScheduleRoutes.log` (la única señal operativa que existirá si esto pasa en producción); y un `.catch` terminal impide que un throw tardío quede como `unhandledRejection` (Node 22 tumbaría el servicio). Tests: 5 casos nuevos que ejercitan el `OperationManager` REAL vía `jest.resetModules` + `jest.unmock` (los 6 previos lo mockean entero — por eso CR-01 pasó desapercibido), incluidos el camino feliz y el orden `startChildProcess → releaseLock`. REQ-23-11: `stripComments` hace que las aserciones de paridad ya no pasen sobre código comentado (se demostró en ambos sentidos). Además se corrigieron los dos comentarios que la fase volvió falsos: `CronScheduler.js` (sólo comentarios, ni una línea ejecutable) y el del literal `'background-cycle'` (WR-06). `npm test` en baseline §6: mismas 6 suites / 7 tests, total 435 → 441 por los 6 casos nuevos. `git diff` vacío para `OperationManager.js`, `background.js` y `config.js`. Sesión con `SAGECONNECT_HOOKS_BYPASS=1`; grep de redacción corrido a mano antes de los 3 commits, limpio. **Siguiente:** 23-03 (verificación end-to-end en `zcl-rds-test`) y el merge a `master`, que era lo que CR-01 bloqueaba.

Session result (23-02): Plan 23-02 ejecutado completo en `feat/boton-ejecucion` (2 tareas, 2 commits atómicos: `e746211` feat, `2b4ae1f` feat). `public/ejecucion.html` — único archivo tocado — pasa de dos estados de botón a tres: `applyButtonState(running, importing)` y un `'importing'` en `btn.dataset.uiState` que pinta "Importando comprobantes a Sage..." mientras la última entrada abierta de `stepProgress` sea `startChildProcess`. El dato ya viajaba en el poll de `GET /api/operations/status`; el plan 23-01 es el que hace que esa entrada exista en la ruta manual. Cero backend, cero endpoints, cero recursos always-on nuevos (se reusa el `setInterval` que ya se libera en `beforeunload`). T-LKI-01 preservada: el nombre del paso se COMPARA contra el literal, nunca se interpola. Los cuatro caminos de fail-safe pasan `applyButtonState(false, false)` — el botón nunca queda trabado. Verificación: simulación en Node que extrae el código VERBATIM del archivo y lo corre contra 12 shapes (incluidos los degradados: `stepProgress` ausente, vacío, no-array, `null`, objeto, todo cerrado, entrada `null`, entrada sin `step`) — 12/12 OK, ninguno lanza; `node --check` del script; `npm test` idéntico al baseline §6 (6 suites / 7 tests, 427 de 435). Sesión con `SAGECONNECT_HOOKS_BYPASS=1`, chequeos manuales sustitutos documentados en el SUMMARY.

Session result (23-01): Plan 23-01 ejecutado completo en `feat/boton-ejecucion` (3 tareas, 3 commits atómicos: `185e8f2` feat, `75e7140` test, `c0e99e7` test). El disparo manual (`POST /api/schedule/background-cycle/trigger`) ya encadena `startChildProcess()` después de `forResponse()` dentro del lock `background-cycle` existente, con instrumentación `startStep`/`endStep`, detección del sentinel `/Child process timeout/` y `sendAdminAlert` con el mismo asunto que el cron (log ruteado a `ScheduleRoutes.log`, D-06). Bloque duplicado a propósito (D-01) y blindado con 3 aserciones nuevas sobre el fuente en `timeout-logging.test.js`. Archivo de test nuevo `tests/api/schedule-trigger-import.test.js` con los 6 casos de D-17 (D-16 revisada: archivo propio en vez de editar `schedule-routes.test.js`, para dejar REQ-23-06 cierto por construcción). `npm test` idéntico al baseline §6 — 6 suites / 7 tests fallando, cero nuevas; 427 pasan de 435 (+9 nuevos). `src/services/CronScheduler.js`, `src/background.js` y `src/config.js` sin tocar. Sesión corrida con `SAGECONNECT_HOOKS_BYPASS=1`; los 5 hooks apagados se sustituyeron por chequeos manuales documentados en el SUMMARY (grep de redacción HANDOFF §1 antes de cada commit — limpio en los 3).
Stopped at: Phase 24 context gathered
Resume next: fase 24 lista para planear: leer `24-SPEC.md` y `24-CONTEXT.md` en `.planning/phases/24-paginar-descarga-cfdi/` y correr `/gsd-plan-phase 24`. La rama sale de `origin/master` (`dde4bd0`), nunca de `master` local (trae la fase 20 sin publicar).
