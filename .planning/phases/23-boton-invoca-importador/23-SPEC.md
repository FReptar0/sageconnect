# Phase 23: El botón de ejecución invoca el importador de comprobantes — Specification

**Created:** 2026-08-31
**Ambiguity score:** 0.09 (gate: ≤ 0.20)
**Requirements:** 9 locked
**Branch:** feat/boton-ejecucion

## Goal

El disparo manual (`POST /api/schedule/background-cycle/trigger`) encadena `startChildProcess()` después de `forResponse()` **dentro del mismo lock `background-cycle`**, con paridad exacta con el cron, de modo que un clic en "Ejecutar proceso ahora" complete la cadena Portal → XML → `ImportaFacturasFocaltec.exe COPDAT` → Sage, y la página muestre cuándo está corriendo ese paso.

## Background

**El hueco (verificado en código):**

| Ruta | Descarga el XML | Importa a Sage |
|---|---|---|
| Cron — `src/services/CronScheduler.js:100-109` | ✅ `await forResponse()` | ✅ `startStep(...)` + `await startChildProcess()` |
| **Botón** — `src/routes/schedule-routes.js:154` | ✅ `forResponse({operationId, emitter})` | ❌ **nunca se invoca** |

La invocación real vive en `src/background.js:362`: `spawn(config.app.importRoute, [config.app.arg])` = `ImportaFacturasFocaltec.exe COPDAT`.

**Consecuencia observada (prueba del 28-ago en `zcl-rds-test`):** el botón completó los 7 pasos en 70 segundos sin errores, pero la factura A1189 se descargó y **se quedó en `downloads\`**. Nunca llegó a Sage porque nadie invocó el `.exe`.

**Origen de la decisión — reunión 31-ago-2026** (Yahir + Hortensia + Santiago; notas en `data/meetings/reunion-ejecutable.md`). Decisión acordada: *"El botón de importación manual utilizará la lógica de llamada del programa existente, incluyendo el parámetro de ID de base de datos requerido, para asegurar consistencia con el proceso establecido."* Hortensia, autora del `.exe`: *"Mandas llamar como ya se estaba llamando... no te compliques la vida."*

**Corrección al pendiente de la reunión.** El pendiente decía *"revisar el archivo .bat que hizo Fer y replicar esa llamada"*. **Ese `.bat` no existe como wrapper del importador**: no hay ningún `.bat` en el repo, y el único documentado es `RunSageconnect.bat`, el lanzador de SageConnect v1.x eliminado en v2.0 (`docs/DEPLOYMENT.md:8`, `.planning/PROJECT.md:24`). La invocación que Fer dejó ya está en el código y lleva corriendo en producción cada 15 minutos desde v2.0. No hay archivo externo que replicar — solo falta llamarla desde la ruta manual.

**Por qué NO era una salvaguarda deliberada.** La decisión D-12 de la fase 17 (`17-CONTEXT.md:137`) solo **constata** que `startChildProcess` se invoca desde el cron y no desde el trigger manual, para decidir dónde poner la instrumentación. Es una observación, no una prohibición. No hay razón técnica documentada para la exclusión: quedó así porque el botón se construyó reutilizando el endpoint existente.

**Lo que Hortensia confirmó del `.exe` (desbloquea el diseño):**

- **Concurrencia:** sin riesgo de duplicidad. Valida documento por documento contra Sage — primero todos, luego uno por uno. Si el documento ya existe, no lo procesa y lo mueve. Es seguro invocarlo fuera de su horario y aunque se traslape con el ciclo de 15 min.
- **Archivos:** lee la carpeta de descarga de XML (ruta configurada dentro del programa), valida y **mueve** los procesados a otra carpeta.
- **Bitácora:** genera logs propios separados para proveedores y para XML de facturas, más bitácora de correos enviados (solo cuando hay error).

**Sin responder (no bloquean):** duración típica, códigos de salida, si abre ventana sin sesión de escritorio, si requiere usuario firmado en Sage. La cascada de terminación forzada de `src/background.js:368-402` (SIGTERM → 30 s de gracia → kill del árbol de procesos) ya las mitiga.

**Comportamiento de error de `forResponse` (verificado):** el `catch` por tenant (`src/background.js:296`) registra y continúa con el siguiente tenant — `forResponse` prácticamente nunca rechaza. El importador correrá aunque un paso truene, igual que hoy en el cron, e importará los XML que sí bajaron. Es el comportamiento deseado.

## Requirements

1. **Invocación del importador desde el disparo manual**: la ruta manual llama `startChildProcess()` después de `forResponse()`, dentro del mismo lock.
   - Current: `src/routes/schedule-routes.js:154` solo invoca `forResponse({operationId, emitter})`; `startChildProcess` nunca corre por esa ruta.
   - Target: al resolver `forResponse`, el disparo manual invoca `startChildProcess()` **antes** de `addHistory` y **antes** de `releaseLock('background-cycle')`, sin adquirir ningún lock adicional.
   - Acceptance: test con `startChildProcess` mockeado verifica que un POST a `/api/schedule/background-cycle/trigger` lo llama **exactamente 1 vez**, y que `releaseLock` se ejecuta después de que esa promesa se asienta.

2. **Instrumentación `stepProgress` paritaria (8 entradas)**: el paso del importador aparece en el progreso del disparo manual igual que en el del cron.
   - Current: el cron registra `startStep('background-cycle','startChildProcess',null)` y `endStep(...)` en `finally`; el disparo manual produce solo las 7 entradas por tenant que emite `forResponse`.
   - Target: el disparo manual registra el mismo par `startStep`/`endStep` para `startChildProcess` con `tenant = null`, con el `endStep` en un `finally` que recibe `{ error: __scpError }`.
   - Acceptance: `GET /api/operations/status` durante un disparo manual devuelve una entrada de `stepProgress` con `step: 'startChildProcess'` y `tenant: null`; al terminar el paso, esa entrada tiene `finishedAt` no nulo.

3. **Alerta al admin en timeout del importador (paridad D-15)**: el correo se dispara venga del cron o del botón.
   - Current: solo `CronScheduler.js` detecta el sentinel `/Child process timeout/` y despacha `sendAdminAlert`.
   - Target: el disparo manual aplica la misma detección por sentinel y el mismo despacho de `sendAdminAlert`, con el `operationId` del disparo manual en el cuerpo.
   - Acceptance: test que hace rechazar `startChildProcess` con `new Error('Child process timeout after 10m ...')` verifica que `sendAdminAlert` se llamó **1 vez**; con un error de otro texto, **0 veces**.

4. **El fallo del importador no traba el lock ni pierde el historial**: cualquier error del `.exe` termina en historial y libera el candado.
   - Current: el `.catch(addHistory fail)` y el `.finally(releaseLock)` del disparo manual solo cubren `forResponse`.
   - Target: si `startChildProcess` falla o hace timeout, la entrada de historial queda `success: false` con el mensaje del error, y `releaseLock('background-cycle')` se ejecuta igual.
   - Acceptance: test con `startChildProcess` rechazando → `addHistory` recibe `success: false` y `errors` con el mensaje; `releaseLock` llamado **1 vez**; tras terminar, `GET /api/operations/status` ya no lista `background-cycle`.

5. **La página muestra el paso de importación**: el operador ve que el sistema sigue trabajando durante la importación.
   - Current: `public/ejecucion.html` muestra solo "Sincronizando..." mientras exista el lock; no lee `stepProgress` de la respuesta del poll (que ya la trae).
   - Target: mientras la última entrada abierta de `stepProgress` sea `startChildProcess`, la página muestra un texto explícito de importación a Sage; el resto del tiempo conserva el texto actual. Sin endpoint nuevo ni cambio de backend.
   - Acceptance: con una respuesta simulada de `/api/operations/status` cuya última entrada abierta de `stepProgress` sea `startChildProcess`, la página muestra el texto de importación; sin esa entrada, muestra "Sincronizando...". Si el poll falla, el botón se re-habilita (fail-safe actual intacto).

6. **El cron y el baseline de tests no cambian** — REQUISITO CRÍTICO NO NEGOCIABLE.
   - Current: el cron corre los 7 pasos y luego el importador; `npm test` en baseline §6 (6 suites / 7 tests de 426 fallando).
   - Target: el comportamiento del cron queda idéntico; ningún test existente cambia sus expectativas para acomodar el cambio.
   - Acceptance: `npm test` reporta el mismo conjunto de fallas que antes del cambio; `tests/services/cron-scheduler.test.js` y `tests/services/CronScheduler.timeout-listener.test.js` pasan sin editar sus assertions.

7. **Disciplina always-on preservada (CLAUDE.md §3 y §9)**: ningún recurso nuevo sin límite de vida, ningún rango de timeout alterado.
   - Current: la invariante `axios 30s < paso 5m < hijo 10m < candado 14m` está protegida por los range-guards de `src/config.js:186-208`; los timers de la UI se liberan en `beforeunload`.
   - Target: ningún `setInterval`/`setTimeout`/listener/Map nuevo sin su limpieza declarada; sin cambios en los rangos de timeout ni en los range-guards.
   - Acceptance: revisión de código confirma cero recursos nuevos sin limpieza, y `git diff` no toca `src/config.js:186-208`.

8. **Verificación de la invocación real en el servidor**: queda documentado a qué apunta `IMPORT_CFDIS_ROUTE` en cada entorno.
   - Current: no está confirmado el valor literal en `zcl-rds-test` ni en producción; la reunión mencionó un `.bat` que no existe en el repo.
   - Target: el valor literal de ambos `.env` queda registrado, indicando si apunta a `.exe` o a `.bat`.
   - Acceptance: los dos valores quedan anotados en el SUMMARY de la fase. Si alguno apunta a un `.bat`, se abre desviación antes de cerrar la fase (Node 22 exige `shell: true` en `spawn` para `.bat`/`.cmd`; sin él lanza `EINVAL`).

9. **Prueba end-to-end en `zcl-rds-test` con evidencia**: la fase no cierra hasta que una factura llegue a Sage por un clic real.
   - Current: la prueba del 28-ago completó los 7 pasos pero la factura se quedó en `downloads\`; nunca se verificó la llegada a Sage por la vía manual.
   - Target: un clic real en `zcl-rds-test` baja el XML, ejecuta el importador y deja la factura registrada en Sage.
   - Acceptance: evidencia en los tres puntos — (a) el XML sale de `downloads\`; (b) `ChildProcess.log` contiene `[INFO] Iniciando proceso de importación - ROUTE: ..., ARG: ...` y `[CLOSE] ... código 0`; (c) la factura visible en Sage. Captura guardada para el control de cambios.

## Boundaries

**In scope:**
- Encadenar `startChildProcess()` al disparo manual, dentro del lock `background-cycle` existente.
- Instrumentación `startStep`/`endStep` del paso `startChildProcess` en la ruta manual.
- Detección del sentinel `/Child process timeout/` + despacho de `sendAdminAlert` en la ruta manual.
- Historial (`addHistory`) y liberación del lock cubriendo también el fallo del importador.
- Texto de estado del paso de importación en `public/ejecucion.html`, leyendo el `stepProgress` que el poll ya trae.
- Registro del valor de `IMPORT_CFDIS_ROUTE` en `zcl-rds-test` y en producción.
- Prueba end-to-end con evidencia en `zcl-rds-test`.

**Out of scope:**
- **Fase 22 — botones independientes por tarea** — fase aparte, ya especificada y planeada; bajó de prioridad y su diseño cambió a botones independientes.
- **Fases 20 / 20.3 — reintentos** — otra línea de trabajo, vive en la rama `feat/reintentos`.
- **Arreglar el desbordamiento del candado de 14 min** — riesgo pre-existente del cron (`HANDOFF-SESION-28ago-importador.md` §5 hallazgo #4). Esta fase lleva la ruta manual a la **misma** condición que ya tiene el cron; no la empeora ni la crea. Requiere decisión de Santiago + Hortensia sobre qué hacer cuando el ciclo rebase el candado.
- **Alinear `DOWNLOADS_PATH` con la ruta interna del `.exe`** (hallazgo #3) — depende de que Hortensia confirme de qué ruta lee el programa; si no coincidieran, la prueba end-to-end del REQ-9 lo destapa.
- **Modificar `ImportaFacturasFocaltec.exe`** — no es código de este repo; lo desarrolló Hortensia y vive fuera del proyecto.
- **Endpoint o candado separado para el importador** — descartado explícitamente: la decisión acordada es paridad con el cron y un solo botón.
- **Las 4 preguntas sin responder del `.exe`** (duración, códigos de salida, modo silencioso, usuario Sage) — no bloquean; la cascada de terminación forzada ya las mitiga.
- **Exposición vía Bastion para Memo** — es infraestructura (Jorge/Alan), no código.

## Constraints

- **CLAUDE.md §3 (always-on):** el servicio no sale entre ticks. Todo recurso con estado declara cómo se libera.
- **CLAUDE.md §9 (invariante):** `axios 30s < paso 5m < hijo 10m < candado 14m`. No se modifica ningún tramo. **Riesgo aceptado y trazado:** en producción `forResponse` tarda 12-13 min y el importador hasta 10 → ~23 min contra un candado de 14. El candado se auto-libera a media corrida. Esto **ya ocurre hoy en el cron**; esta fase lo hereda para la ruta manual sin agravarlo. Se documenta, no se resuelve aquí.
- **CLAUDE.md §6 (baseline):** `npm test` debe quedar en el baseline — 6 suites / 7 tests de 426. Una falla nueva es un bug del cambio.
- **Sentinels load-bearing:** el texto `'Child process timeout'` (`src/background.js`) se detecta por regex para despachar el correo; el texto `'Step timeout'` (`src/utils/duration.js`) se detecta para el ruteo de logs. Ninguno se puede reformular.
- **Convenciones del repo:** CommonJS, indentación de 4 espacios, `logGenerator(LOG_FILE, ...)`, `const config = require('./config')`.
- **Rama:** `feat/boton-ejecucion`. El hook `pre-edit-gsd-guard` exige fase activa para editar `src/**`.
- **Sin entorno local que ejerza la integración real:** no hay Sage ni el `.exe` en la Mac. Los tests son con mocks; la verdad operativa solo se obtiene en `zcl-rds-test` (de ahí el REQ-9).

## Acceptance Criteria

- [ ] Un POST a `/api/schedule/background-cycle/trigger` invoca `startChildProcess()` exactamente 1 vez, después de `forResponse` y antes de `releaseLock`.
- [ ] El disparo manual no adquiere ningún lock adicional al `background-cycle` que ya toma.
- [ ] `GET /api/operations/status` durante un disparo manual muestra la entrada `stepProgress` con `step: 'startChildProcess'` y `tenant: null`, y esa entrada cierra con `finishedAt` no nulo.
- [ ] Un rechazo de `startChildProcess` con el texto `Child process timeout` despacha `sendAdminAlert` 1 vez; con otro texto, 0 veces.
- [ ] Si `startChildProcess` falla, el historial queda `success: false` con el mensaje del error y el lock se libera igual.
- [ ] Mientras corre el paso `startChildProcess`, `ejecucion.html` muestra el texto de importación a Sage; fuera de ese paso muestra "Sincronizando...".
- [ ] Si el poll de `/api/operations/status` falla, el botón se re-habilita y no se traba.
- [ ] El cron sigue ejecutando los 7 pasos y el importador exactamente igual que antes.
- [ ] `npm test` en baseline §6 — mismo conjunto de fallas, ninguna nueva.
- [ ] Cero `setInterval`/`setTimeout`/listener nuevo sin su limpieza; `src/config.js:186-208` sin cambios.
- [ ] El valor literal de `IMPORT_CFDIS_ROUTE` en `zcl-rds-test` y en producción queda registrado en el SUMMARY de la fase.
- [ ] Prueba end-to-end en `zcl-rds-test`: el XML sale de `downloads\`, `ChildProcess.log` muestra `[INFO] Iniciando...` + `[CLOSE] ... código 0`, y la factura aparece en Sage. Con captura.

## Ambiguity Report

| Dimension           | Score | Min   | Status | Notes                                                                    |
|---------------------|-------|-------|--------|--------------------------------------------------------------------------|
| Goal Clarity        | 0.93  | 0.75  | ✓      | Objetivo concreto y verificable: paridad exacta con `CronScheduler.js:100-109` |
| Boundary Clarity    | 0.92  | 0.70  | ✓      | 8 exclusiones explícitas, cada una con su razón                          |
| Constraint Clarity  | 0.88  | 0.65  | ✓      | §3/§6/§9 + sentinels load-bearing; el candado de 14 min queda como riesgo aceptado y trazado |
| Acceptance Criteria | 0.88  | 0.70  | ✓      | 12 criterios pass/fail, incluida la verificación end-to-end con evidencia |
| **Ambiguity**       | 0.09  | ≤0.20 | ✓      | Diseño decidido por el usuario; las 3 preguntas abiertas se cerraron en la ronda 1 |

Status: ✓ = met minimum

## Interview Log

| Round | Perspective     | Question summary                                           | Decision locked                                                                 |
|-------|-----------------|------------------------------------------------------------|---------------------------------------------------------------------------------|
| 0     | Usuario (pre)   | ¿Cómo debe llamar el botón al importador?                  | **Paridad con el cron** — mismo lock `background-cycle`, un solo botón; NO endpoint ni candado separado |
| 0     | Usuario (pre)   | ¿Milestone v2.4 o fase suelta?                             | **Fase 23 sola, ya** — la demo con Memo es el miércoles; v2.4 se abre después    |
| 1     | Researcher      | ¿Qué debe ver el operador durante la importación?          | **Mostrar el paso** — `ejecucion.html` lee `stepProgress` del poll existente y muestra el texto de importación |
| 1     | Failure Analyst | ¿El disparo manual también manda el correo de timeout?     | **Sí, paridad total** — misma detección por sentinel, mismo `sendAdminAlert`, sin bifurcar código |
| 1     | Boundary Keeper | ¿Qué tiene que pasar para dar la fase por terminada?       | **Prueba end-to-end en `zcl-rds-test` con evidencia** — la factura tiene que aparecer en Sage (CLAUDE.md §3: nunca asumir completitud) |

**Resuelto durante el scouting (no requirió pregunta):** `forResponse` traga los errores por tenant y continúa (`src/background.js:296`), así que el importador correrá aunque un paso falle — igual que hoy en el cron, e importará los XML que sí bajaron.

---

*Phase: 23-boton-invoca-importador*
*Spec created: 2026-08-31*
*Next step: /gsd-discuss-phase 23 — decisiones de implementación (cómo construir lo especificado arriba)*
