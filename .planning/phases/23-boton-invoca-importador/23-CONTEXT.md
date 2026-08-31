# Phase 23: El botón de ejecución invoca el importador de comprobantes - Context

**Gathered:** 2026-08-31
**Status:** Ready for planning

<domain>
## Phase Boundary

El disparo manual (`POST /api/schedule/background-cycle/trigger`) encadena `startChildProcess()` después de `forResponse()` dentro del mismo lock `background-cycle`, con la misma instrumentación, el mismo manejo de timeout y el mismo correo de alerta que ya tiene el cron. La página `public/ejecucion.html` muestra cuándo está corriendo ese paso. No se toca `forResponse`, no se toca el cron, no se crea ningún endpoint ni candado nuevo.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**9 requirements are locked.** See `23-SPEC.md` for full requirements, boundaries, and acceptance criteria.

Downstream agents MUST read `23-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
- Encadenar `startChildProcess()` al disparo manual, dentro del lock `background-cycle` existente.
- Instrumentación `startStep`/`endStep` del paso `startChildProcess` en la ruta manual.
- Detección del sentinel `/Child process timeout/` + despacho de `sendAdminAlert` en la ruta manual.
- Historial (`addHistory`) y liberación del lock cubriendo también el fallo del importador.
- Texto de estado del paso de importación en `public/ejecucion.html`, leyendo el `stepProgress` que el poll ya trae.
- Registro del valor de `IMPORT_CFDIS_ROUTE` en `zcl-rds-test` y en producción.
- Prueba end-to-end con evidencia en `zcl-rds-test`.

**Out of scope (from SPEC.md):**
- Fase 22 (botones independientes por tarea) — fase aparte.
- Fases 20 / 20.3 (reintentos) — rama `feat/reintentos`.
- Arreglar el desbordamiento del candado de 14 min — riesgo pre-existente del cron; requiere decisión de Santiago + Hortensia.
- Alinear `DOWNLOADS_PATH` con la ruta interna del `.exe` — depende de confirmación de Hortensia.
- Modificar `ImportaFacturasFocaltec.exe` — no es código de este repo.
- Endpoint o candado separado para el importador — descartado; la decisión acordada es paridad.
- Las 4 preguntas sin responder del `.exe` — la cascada de terminación forzada ya las mitiga.
- Exposición vía Bastion — infraestructura, no código.

</spec_lock>

<decisions>
## Implementation Decisions

### Invocación y encadenamiento (`src/routes/schedule-routes.js`)

- **D-01 — El bloque del importador se DUPLICA, no se extrae. Decisión forzada, no de estilo.**
  Cuatro tests existentes leen el **código fuente** de `CronScheduler.js` y exigen que el bloque viva ahí literalmente:
  - `tests/integration/timeout-logging.test.js:84-92` — el fuente debe contener el asunto `[SageConnect] Child process timeout: ImportaFacturasFocaltec.exe killed`, el regex `/Child process timeout/` y `sendAdminAlert(subject`.
  - `tests/integration/timeout-logging.test.js:95-99` — el fuente debe contener `[TIMEOUT] step=startChildProcess … action=admin-email-dispatched`.
  - `tests/services/CronScheduler.timeout-listener.test.js:288` — el regex de detección debe estar en `CronScheduler.js`.
  - `tests/services/CronScheduler.timeout-listener.test.js:297-303` — `sendAdminAlert(subject, html)` debe estar en `CronScheduler.js`.

  Extraer el bloque a un helper compartido rompe los cuatro, y REQ-6 prohíbe editar sus assertions. La duplicación además **coincide con la convención del repo** (PATTERNS.md §S-6: extraer en el 3.º uso, no en el 2.º) y tiene precedente exacto: `sendAdminAlert` vivió inline en estos mismos dos archivos (Plan 18-01 y 18-02) hasta que apareció el 3.er sitio y se extrajo a `src/utils/AdminEmailSender.js`. El contador de §S-6 para este bloque queda en **2 de 3**.

- **D-02 — Encadenamiento por `.then()` intermedio, no por una cadena nueva.** La forma final del handler (`schedule-routes.js:154`):

  ```
  forResponse({ operationId, emitter: operationManager })
      .then(async () => { /* bloque del importador */ })   ← ÚNICO agregado
      .then(() => addHistory({ success: true, ... }))
      .catch((err) => addHistory({ success: false, errors: [err.message], ... }))
      .finally(() => operationManager.releaseLock(taskId));
  ```

  Consecuencias, todas deseadas y todas paritarias con el cron:
  - Si `forResponse` rechaza → el importador **no** corre (igual que el `try` del cron, donde `await forResponse()` salta al `catch` externo).
  - Si el importador rechaza → cae al `.catch` existente → `addHistory` con `success:false` y el mensaje del error. **REQ-4 se cumple sin escribir código nuevo de manejo de error.**
  - `releaseLock` sigue en el `.finally` → se ejecuta pase lo que pase. El candado nunca queda trabado.

- **D-03 — Cero imports nuevos salvo uno.** `schedule-routes.js` **ya importa** todo lo que el bloque necesita: `config` (L22), `operationManager` (L21), `logGenerator` (L25), `formatDurationMin` (L26), y un wrapper local `sendAdminAlert(subject, html)` en L74-76 que inyecta `LOG_FILE`. El único cambio de imports es agregar `startChildProcess` al destructure existente `const { forResponse } = require('../background')`.

- **D-04 — El bloque replica el del cron (`CronScheduler.js:100-150`) campo por campo:** `startStep('background-cycle','startChildProcess', null)` antes del `await`; `catch` que captura `__scpError`, evalúa `/Child process timeout/.test(__scpError)`, escribe el log `[TIMEOUT] step=startChildProcess operationId=… durationMs=… action=admin-email-dispatched`, despacha `sendAdminAlert(subject, html).catch(() => {})` fire-and-forget y hace `throw scpErr`; `finally` con `endStep('background-cycle','startChildProcess', null, { error: __scpError })`. Único campo que cambia: el `operationId` del disparo manual.

- **D-05 — Mismo asunto de correo, sin sufijos ni variantes.** `[SageConnect] Child process timeout: ImportaFacturasFocaltec.exe killed después de ${label}`. Los filtros de correo del admin siguen funcionando. Quién lo disparó se distingue por el log de origen (D-06), no por el asunto.

- **D-06 — Los logs del camino manual van a `ScheduleRoutes.log`, no a `CronScheduler.log`.** Es automático: el wrapper local de L74-76 pasa `LOG_FILE = 'ScheduleRoutes'` a `_sendAdminAlertImpl`. Es exactamente el contrato que documenta la cabecera de `src/utils/AdminEmailSender.js` (el parámetro `callerLogFile` existe para preservar el ruteo por archivo). Beneficio gratis: un operador que hace grep de `[TIMEOUT]` sabe por el archivo si el timeout vino del cron o del botón.

- **D-07 — NO se emite `emitProgress` para el paso del importador.** El cron tampoco lo hace: solo `startStep`/`endStep`. Paridad exacta significa la misma instrumentación, ni más ni menos. Agregar un `emitProgress` sería una divergencia.

### Enforcement de la paridad (el antídoto contra el drift)

- **D-08 — Test de aserción sobre el fuente de `schedule-routes.js`, en el mismo archivo y el mismo estilo que los que ya protegen al cron.** Se agregan casos al bloque `describe('ROOT-02: ...')` de `tests/integration/timeout-logging.test.js` que exigen que `src/routes/schedule-routes.js` contenga: el regex `/Child process timeout/`, el asunto `[SageConnect] Child process timeout: ImportaFacturasFocaltec.exe killed`, `sendAdminAlert(subject`, y `[TIMEOUT] step=startChildProcess … action=admin-email-dispatched`.

  Esto es lo que convierte la duplicación de D-01 de "propensa a divergir" en "paralela y verificada". Es el mecanismo propio del repo para fijar invariantes entre archivos, no un invento de esta fase.

- **D-09 — Comentario cruzado en ambos archivos**, señalando que el bloque está duplicado a propósito, por qué (D-01), y que el contador de §S-6 va en 2/3. Quien toque uno sabe que debe tocar el otro, y el test de D-08 lo obliga.

### UI (`public/ejecucion.html`)

- **D-10 — `applyButtonState(running)` pasa a `applyButtonState(running, importing)` con tres estados** en `btn.dataset.uiState`: `'idle'` | `'running'` | `'importing'`. Se preserva la escritura idempotente (no reescribir el innerHTML si el estado no cambió, para no reiniciar la animación del spinner cada 3.5 s) y se preserva el guard `triggerInFlight`.

- **D-11 — El texto nuevo es un STRING LITERAL ESTÁTICO.** La página tiene la decisión T-LKI-01 documentada en su propio comentario: *"Todo el innerHTML es STRING ESTÁTICO: nunca se interpola nada que venga de la respuesta del API"*. El nombre del paso llega del API, así que **nunca se interpola**: se compara contra el literal `'startChildProcess'` y se pinta un texto fijo. Sin `escapeHtml`, sin interpolación, sin superficie de inyección nueva.

- **D-12 — Detección del paso = última entrada de `stepProgress` con `finishedAt` falsy**, replicando la semántica de `findLastOpenStep` de `src/utils/AdminEmailSender.js` (el navegador no puede hacer `require` del módulo Node, así que se reimplementa como bucle de 5 líneas hacia atrás). Verificado que el dato ya viaja: `OperationManager.getRunningOperations()` devuelve `stepProgress` y `GET /api/operations/status` lo expone verbatim (`src/routes/operations-routes.js:39-40`).

- **D-13 — Defensivo por defecto.** Si `operations['background-cycle']` no existe, si `stepProgress` falta, si no es un array, o si toda entrada está cerrada → `importing = false`. Nunca se lanza una excepción desde el poll por un shape inesperado.

- **D-14 — El fail-safe actual se preserva intacto.** Cualquier fallo del poll (respuesta no OK, shape raro, excepción de red) → `applyButtonState(false, false)` → botón habilitado. La regla vigente sigue mandando: *un click de más devuelve un 409 inofensivo; un botón trabado para siempre deja al operador sin salida.*

- **D-15 — Cero recursos nuevos (CLAUDE.md §3).** Se reusa el `setInterval` de poll que ya existe y que ya se libera en `beforeunload`. No se agrega ningún timer, listener ni Map. §3 se satisface sin nada que limpiar.

### Tests

- **D-16 — `tests/api/schedule-routes.test.js` es el archivo anfitrión** de los casos de REQ-1 a REQ-4. Ya construye una app de prueba con todas las dependencias mockeadas. El mock de background (`jest.mock('../../src/background', () => ({ forResponse: … }))`) se extiende con `startChildProcess: jest.fn().mockResolvedValue(0)` — una línea.

- **D-17 — Casos a cubrir:**
  (a) `startChildProcess` llamado **exactamente 1 vez** por POST, y **después** de `forResponse`;
  (b) `startStep`/`endStep` invocados con `('background-cycle', 'startChildProcess', null)`;
  (c) rechazo con `'Child process timeout after 10m'` → `sendAdminAlert` **1 vez**;
  (d) rechazo con otro texto → `sendAdminAlert` **0 veces** (negación explícita, igual que los casos D-15 del cron);
  (e) rechazo → `addHistory` con `success:false` y el mensaje, y `releaseLock` llamado 1 vez;
  (f) regresión: `forResponse` que rechaza → `startChildProcess` **0 veces**.

- **D-18 — `src/utils/AdminEmailSender` debe mockearse en ese archivo de test** (hoy no lo está, porque el trigger no despachaba correos). Sin el mock, el caso (c) intentaría abrir una conexión SMTP real. El planner debe verificar si conviene mockear el módulo completo o solo `nodemailer`, siguiendo lo que ya hace `tests/services/CronScheduler.timeout-listener.test.js:71`.

- **D-19 — Ningún test existente cambia sus assertions.** Si alguno falla, el cambio está mal — no el test. `npm test` debe reportar exactamente el mismo conjunto de fallas del baseline §6 (6 suites / 7 tests de 426).

### Convivencia con la fase 22

- **D-20 — La fase 23 se construye sobre el código ACTUAL, con dependencia cero de la fase 22.** La 22 está planeada pero no ejecutada (0/4 planes), su diseño cambió a botones independientes y bajó de prioridad; va a necesitar replanificación de todos modos. La 23 no espera a `runSteps`/`STEP_REGISTRY` ni los presupone.
- **D-21 — Huella mínima en los archivos compartidos** (`schedule-routes.js`, `ejecucion.html`) para que la replanificación de la 22 siga siendo barata. Nota de compatibilidad: si algún día se ejecuta la 22 con `forResponse = runSteps(ALL_STEP_KEYS)`, la cadena `.then()` de D-02 sigue siendo válida sin tocarla, porque solo depende de que `forResponse` devuelva una promesa.

### Verificación operativa

- **D-22 — Leer `IMPORT_CFDIS_ROUTE` del `.env` del servidor ANTES de la prueba end-to-end**, en `zcl-rds-test` y en producción. Si apunta a un `.bat`, **detenerse y abrir desviación**: Node 22 rechaza `spawn` de `.bat`/`.cmd` sin `shell: true` y lanza `EINVAL` (mitigación de CVE-2024-27980). Como el cron sí funciona en producción, lo esperado es que apunte al `.exe` directo — pero se confirma, no se asume.
- **D-23 — La evidencia end-to-end se recoge en los tres puntos del REQ-9** y no se da por buena con menos: (a) el XML sale de la carpeta de descargas; (b) `ChildProcess.log` con `[INFO] Iniciando proceso de importación - ROUTE: …, ARG: …` y `[CLOSE] … código 0`; (c) la factura visible en Sage. CLAUDE.md §3 es explícito: verificar ambos lados antes de declarar nada resuelto.

### Claude's Discretion

El usuario delegó explícitamente las decisiones técnicas ("tú toma las decisiones técnicas, siempre buscando que no falle"). Quedan a criterio del planner/executor, dentro de las decisiones de arriba:

- Nombres exactos de variables locales del bloque duplicado (se sugiere conservar `__scpError` por simetría con el cron y para que el grep cruzado sea trivial).
- Si el bloque del importador va inline en el `.then()` o en una función local nombrada dentro del mismo archivo — ambas cumplen D-01 (el fuente de `schedule-routes.js` contiene el texto) y D-08.
- Redacción exacta del texto de importación en la UI (se sugiere `Importando comprobantes a Sage...` con el mismo spinner).
- Reparto en planes/waves.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos bloqueados
- `.planning/phases/23-boton-invoca-importador/23-SPEC.md` — Requisitos, boundaries y acceptance criteria locked. MUST read before planning.

### El cambio principal
- `src/routes/schedule-routes.js` §L133-192 — el handler del trigger manual. §L74-76 wrapper local de `sendAdminAlert`. §L21-30 imports ya disponibles.
- `src/services/CronScheduler.js` §L100-150 — **el bloque a replicar campo por campo**: `startStep` → `await startChildProcess()` → detección del sentinel → log `[TIMEOUT]` → `sendAdminAlert` → `throw` → `endStep` en `finally`.
- `src/background.js` §L332-471 — `startChildProcess()`: `spawn(importRoute, [arg])`, la cascada de terminación forzada y el sentinel `'Child process timeout'` en el `reject`. §L296 — el `catch` por tenant que hace que `forResponse` prácticamente nunca rechace.

### Tests que restringen el diseño (leer ANTES de proponer una extracción)
- `tests/integration/timeout-logging.test.js` §L72-101 — aserciones sobre el **fuente** de `CronScheduler.js`. Es el archivo donde se agregan las de D-08.
- `tests/services/CronScheduler.timeout-listener.test.js` §L278-305 — aserciones sobre el fuente + §L71 patrón de mock de `nodemailer`.
- `tests/api/schedule-routes.test.js` §L1-120 — setup de mocks; §L231-278 casos del trigger.
- `tests/services/cron-scheduler.test.js` §L182-295 — casos de `startStep`/`endStep` del cron; sirven de plantilla para los del botón.

### Instrumentación y estado
- `src/services/OperationManager.js` §L94-140 — `startStep`/`endStep`; §L160-177 `getRunningOperations()` (devuelve `stepProgress`); `addHistory`.
- `src/routes/operations-routes.js` §L35-40 — `GET /status`; confirma que `stepProgress` llega al navegador.
- `src/utils/AdminEmailSender.js` — `sendAdminAlert(subject, html, callerLogFile)` y `findLastOpenStep(stepProgress)`. Su cabecera documenta la convención §S-6 y el contrato de ruteo de logs.

### UI
- `public/ejecucion.html` §L160-270 — `applyButtonState`, `pollCycleState`, el fail-safe, `triggerInFlight`, el `beforeunload`, y el comentario de T-LKI-01 (innerHTML estático).

### Reglas del proyecto (obligatorias)
- `CLAUDE.md` §1 (política de seguridad en producción), §3 (always-on), §5 (convenciones), §6 (baseline de tests), §9 (invariante de timeouts).
- `HANDOFF.md` §1 — **nunca escribir el nombre del integrador previo en ningún archivo del repo**, `.planning/` incluido. Antes de cada commit, correr el `git diff --cached | grep -in ...` que esa misma sección documenta (el patrón vive ahí; no se replica aquí para no disparar la propia alarma).

### Contexto de la fase adyacente
- `.planning/phases/22-botones-ejecucion-por-tarea/22-CONTEXT.md` — decisiones de la fase 22 (planeada, no ejecutada). Relevante solo para D-20/D-21: no crear dependencia.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `startChildProcess()` (`src/background.js:332`) — se invoca tal cual, sin modificarlo. Ya trae timeout, cascada de terminación, logs a `ChildProcess.log` y el sentinel del `reject`.
- Wrapper local `sendAdminAlert(subject, html)` (`schedule-routes.js:74`) — ya inyecta `LOG_FILE='ScheduleRoutes'`; el bloque duplicado lo llama igual que el cron llama al suyo.
- `formatDurationMin`, `config.schedule.childProcessTimeoutMs`, `logGenerator`, `operationManager` — todos ya importados en `schedule-routes.js`.
- `applyButtonState` / `pollCycleState` / `triggerInFlight` / `beforeunload` (`ejecucion.html`) — la máquina de estados del botón se extiende de 2 a 3 estados; nada se reescribe.
- El `setInterval` de poll ya existente — se reusa; no se agrega ningún timer.

### Established Patterns
- **Aserciones sobre el código fuente** para fijar invariantes que cruzan archivos (`timeout-logging.test.js`). Es el mecanismo del repo para justo el problema que crea D-01.
- **`callerLogFile`** — cada llamador pasa su propio `LOG_FILE` para que las entradas `[ADMIN-EMAIL]` / `[TIMEOUT]` aparezcan en su archivo.
- **innerHTML estático en `ejecucion.html`** (T-LKI-01) — nunca se interpola nada que venga del API.
- **Lock compartido `background-cycle`** para toda ejecución (cron, manual, futura por-tarea).
- **Fail-safe del poll** — ante la duda, botón habilitado.

### Integration Points
- `src/routes/schedule-routes.js` — un `.then()` intermedio en el handler del trigger + `startChildProcess` en el destructure del require.
- `public/ejecucion.html` — `applyButtonState` con 2.º parámetro + cálculo de `importing` en `pollCycleState`.
- `tests/api/schedule-routes.test.js` — mock extendido + 6 casos nuevos.
- `tests/integration/timeout-logging.test.js` — aserciones de paridad sobre el fuente.

</code_context>

<specifics>
## Specific Ideas

- La demo con el operador del cliente es el **miércoles**. El criterio de éxito de esa demo es literalmente "pico el botón y la factura aparece en Sage" — por eso REQ-9 exige el ensayo previo en `zcl-rds-test` con evidencia, no solo tests verdes.
- El paso puede tardar **minutos** en producción (`forResponse` 12-13 min + importador hasta 10). Por eso el texto de importación en la UI no es cosmético: sin él, el operador ve un botón congelado y concluye que se colgó.
- La factura **A1189** (Saúl Reyes Salas, PO0081859) quedó descargada y sin importar en `zcl-rds-test` el 28-ago; es la candidata natural para el ensayo del REQ-9. La factura **CPI3700** (MXP Constructora Parroquia, PO0081894) está **reservada** para la sesión en vivo con el operador — no consumirla en pruebas.

</specifics>

<deferred>
## Deferred Ideas

- **Etiquetas legibles para los 7 pasos en la UI** (no solo el del importador) — sería mejor UX durante una espera de 13 minutos, pero el SPEC dice explícitamente "el resto del tiempo conserva el texto actual". Fuera de alcance; candidata a fase futura o a quick task.
- **Extraer el bloque del importador a un helper compartido** — cuando aparezca un 3.er sitio de uso (PATTERNS.md §S-6). Requerirá actualizar las 4 aserciones sobre el fuente descritas en D-01, así que es un cambio con costo propio: hacerlo deliberadamente, no de paso.
- **Desbordamiento del candado de 14 min** (`forResponse` 12-13 min + importador 10 min ≈ 23 min contra un candado de 14) — riesgo pre-existente que ya corre hoy en el cron. Necesita decisión de negocio de Santiago + Hortensia: ¿subir el candado, partir el ciclo, o aceptar el solape?
- **Alinear `DOWNLOADS_PATH` con la ruta interna del `.exe`** — bloqueado hasta que Hortensia confirme de qué carpeta lee el programa. El ensayo del REQ-9 lo destapa si no coinciden.
- **`getTypeIToSend` es código muerto** (`GetTypesCFDI.js:195`, nadie la llama) — limpieza, no de esta fase.
- **`downloadCFDI` no espera a que terminen las descargas** (`CFDI_Downloader.js:120-146`) — hallazgo de gravedad media, ajeno al botón. Relevante como riesgo del ensayo: el `[COMPLETE]` del log puede escribirse antes de que el XML esté completo en disco. Si el ensayo del REQ-9 falla de forma intermitente, mirar aquí primero.

</deferred>

---

*Phase: 23-boton-invoca-importador*
*Context gathered: 2026-08-31*
