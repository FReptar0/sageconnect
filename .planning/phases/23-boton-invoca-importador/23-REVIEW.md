---
phase: 23-boton-invoca-importador
reviewed: 2026-08-31T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/routes/schedule-routes.js
  - public/ejecucion.html
  - tests/api/schedule-trigger-import.test.js
  - tests/integration/timeout-logging.test.js
findings:
  critical: 1
  warning: 8
  info: 2
  total: 11
status: issues_found
---

# Fase 23: Reporte de Code Review

**Reviewed:** 2026-08-31
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

La fase encadena `startChildProcess()` después de `forResponse()` en el handler del disparo
manual, con instrumentación `startStep`/`endStep`, detección del sentinel `/Child process timeout/`
y despacho de `sendAdminAlert`, más un tercer estado en el botón de `public/ejecucion.html`.

**Lo que sí está bien y quedó verificado en esta revisión:**

- La cadena de promesas es correcta en el eje que el plan pidió mirar: `addHistory` se invoca
  **exactamente una vez** en las cuatro combinaciones (`forResponse` resuelve/rechaza ×
  `startChildProcess` resuelve/rechaza), y `releaseLock` corre siempre desde el `.finally()`.
  Ningún error se traga en silencio: el `throw scpErr` de L224 desemboca en el `.catch()` de L240.
- Cero recursos nuevos sin límite de vida. No hay `setInterval`, `setTimeout`, listener ni
  `Map`/`Set` de módulo agregado en ninguno de los 4 archivos. CLAUDE.md §3 se cumple.
- La invariante de timeouts (§9) no se toca; `src/config.js` no aparece en el diff.
- `npm test` corrido en esta revisión: **6 suites / 7 tests fallando de 435** — idéntico al
  baseline documentado (6 suites / 7 tests de 426, +9 tests nuevos). `git diff --numstat`
  confirma **0 líneas eliminadas** en `tests/integration/timeout-logging.test.js`: REQ-23-06
  se cumple.
- La derivación de `importing` en `pollCycleState()` **no puede lanzar** ante una respuesta
  malformada u hostil: `operations` no-objeto, `stepProgress` ausente/no-array, entradas `null`
  y `finishedAt` falsy están todas cubiertas por guardas. El botón no puede quedar deshabilitado
  para siempre: los tres caminos de fallo del poll llaman `applyButtonState(false, false)` y
  `ejecutar()` siempre libera `triggerInFlight` en su `finally`.

**La preocupación principal está en otro lado.** El cambio alarga el trabajo que corre **dentro
del lock `background-cycle`** de ~13 min a ~23 min (números del propio SPEC), es decir, ahora
excede **siempre** el auto-release de 14 min. El SPEC declara ese desbordamiento fuera de alcance
como "riesgo preexistente que no se agrava". Esa evaluación es incompleta: la consecuencia real
no es sólo que el candado se auto-libere, sino que el `.finally()` de la cadena vieja termina
**liberando el candado de OTRA operación** minutos después. Eso es CR-01 y es un bloqueante.

Sobre la pregunta explícita del plan — *¿es suficiente la mitigación de las aserciones sobre el
fuente?* — **no**. Se demostró experimentalmente que las 7 aserciones nuevas pasan sobre un bloque
**completamente comentado** (WR-02), y el comentario recíproco que exigía D-09 nunca se escribió:
`src/services/CronScheduler.js:102` sigue afirmando *"startChildProcess is cron-only (manual
trigger does NOT call it)"*, que ahora es falso (WR-03).

---

## Critical Issues

### CR-01: El `.finally()` libera el lock sin verificar de quién es — puede liberar el candado de otra operación

**File:** `src/routes/schedule-routes.js:251-253` (contexto: `:142`, `:174-227`)

**Issue:**

`operationManager.releaseLock(taskId)` borra el slot `background-cycle` **sin comparar el
`operationId`**. Confirmado en `src/services/OperationManager.js:63-69`: `releaseLock` hace
`this.locks.delete(operationType)` y además `clearTimeout(slot.timeoutHandle)` — mata el watchdog
del dueño actual, sea quien sea.

Antes de esta fase la cadena manual duraba lo que `forResponse` (12-13 min en producción según el
SPEC) y terminaba **justo por debajo** del auto-release de 14 min, así que la carrera casi nunca se
abría. Al encadenar el importador (hasta 10 min más) la cadena manual dura ~23 min y **siempre**
sobrevive a su propio candado. La secuencia, con `LOCK_TIMEOUT_MS` = 14 min (`src/config.js:172`) y
cron cada 15 min:

| t | Evento |
|---|---|
| 0 min | Operador pica el botón. `acquireLock('background-cycle', A)` (L142). Watchdog armado para t=14. |
| 13 min | `forResponse` resuelve. `startStep(...)` (L182) + `await startChildProcess()` (L183). |
| 14 min | `_fireTimeout` → `releaseLock` → emite `lock:timeout`. `CronScheduler.js:205` mete history `'Timeout'` y manda correo. **Candado libre; el importador A sigue vivo.** |
| 15 min | Tick del cron → `acquireLock('background-cycle', B)` **tiene éxito** → arranca un ciclo completo concurrente. |
| ~23 min | El importador A termina. La cadena A corre `.then(addHistory success:true)` y luego `.finally(releaseLock('background-cycle'))` → **borra el slot de B y cancela el watchdog de B.** |

A partir de ahí:

1. **El ciclo B queda sin watchdog.** Si B se cuelga, se cuelga para siempre: su `timeoutHandle`
   fue cancelado por una cadena ajena. Es exactamente el modo de fallo que la fase 18 (REC-01)
   introdujo el auto-release para eliminar.
2. **`GET /api/operations/status` reporta idle** aunque B esté a mitad de camino → `ejecucion.html`
   rehabilita el botón → un clic arranca un ciclo C **totalmente concurrente con B**. No es sólo el
   importador (que Hortensia confirmó seguro ante concurrencia): son los 7 pasos de `forResponse`
   subiendo pagos y OCs al portal y escribiendo en las tablas de control del mismo tenant.
3. **Corrupción de `stepProgress`.** Con el slot de B activo, el `endStep('background-cycle',
   'startChildProcess', null, ...)` de L226 de la cadena A cierra la entrada abierta de **B**
   (`OperationManager.endStep` busca por `step`+`tenant` en el slot vigente, sin mirar el dueño).
   El `stuckOnStep` del correo de auto-timeout y el estado del botón quedan mintiendo.
4. **Cascada.** El `.finally()` de B libera después el candado de C, y así sucesivamente.

Nada de esto lo detectan los tests: `tests/api/schedule-trigger-import.test.js:73-89` mockea
`OperationManager` completo, así que la semántica real del lock no se ejercita.

Es cierto que el patrón (releaseLock incondicional en el `finally`) ya existe en
`CronScheduler.js:164`. Lo nuevo de esta fase es que (a) la ruta manual pasa de "casi nunca" a
"siempre" desbordar su candado, y (b) aparece la interleaving cron ↔ manual, que antes no existía
porque sólo el cron duraba más de 14 min.

**Fix:** guarda de propiedad local, sin tocar la firma de ninguna utilidad compartida (evita el
pitfall #2 de CLAUDE.md §6). Aplica el mismo criterio a `startStep`/`endStep`:

```js
        // Snapshot de propiedad — el slot puede haber sido reciclado por el
        // auto-release de 14 min + un tick del cron mientras el importador corría.
        const ownsLock = () => {
            const current = operationManager.getRunningOperations()[taskId];
            return Boolean(current) && current.operationId === operationId;
        };

        forResponse({ operationId, emitter: operationManager })
            .then(async () => {
                let __scpError = null;
                const instrument = ownsLock();   // si ya no es nuestro, no escribimos en el ajeno
                try {
                    if (instrument) {
                        operationManager.startStep('background-cycle', 'startChildProcess', null);
                    }
                    await startChildProcess();
                } catch (scpErr) {
                    // ... sin cambios ...
                    throw scpErr;
                } finally {
                    if (instrument && ownsLock()) {
                        operationManager.endStep('background-cycle', 'startChildProcess', null, { error: __scpError });
                    }
                }
            })
            // ... .then / .catch sin cambios ...
            .finally(() => {
                if (ownsLock()) {
                    operationManager.releaseLock(taskId);
                } else {
                    logGenerator(LOG_FILE, 'warn',
                        `[LOCK] releaseLock(${taskId}) omitido: el slot ya no pertenece a ${operationId} ` +
                        `(auto-release + reciclado). Evitado liberar el candado de otra operación.`);
                }
            });
```

Si se aplica esta guarda, **hay que aplicar la misma a `CronScheduler.js:164`** o el cron seguirá
robándole el candado a la ruta manual (la paridad de D-01 obliga a tocar los dos lados).

**Alternativa a evaluar con Santiago:** dado que el desbordamiento del candado ya no es hipotético
sino sistemático en la ruta manual, subir `LOCK_TIMEOUT_MS` por encima de
`stepTimeout × pasos + childProcessTimeout` — pero eso rompe la invariante de §9 respecto de la
cadencia de 15 min y requiere la decisión que el SPEC dejó fuera de alcance. La guarda de
propiedad es la mitigación que **no** requiere esa decisión y elimina el peor efecto.

---

## Warnings

### WR-01: La cadena de promesas no tiene `.catch()` terminal — una excepción en el `.catch`/`.finally` mata el servicio

**File:** `src/routes/schedule-routes.js:154-253`

**Issue:** La cadena termina en `.finally()`. Un `throw` dentro del handler de L240-250 (por
ejemplo `err.message` si `err` llegara nulo) o dentro del `.finally()` produce una promesa
rechazada **sin handler**. En Node 22 el modo por defecto de `--unhandled-rejections` es `throw`:
se convierte en excepción no capturada y, como no hay ningún `process.on('unhandledRejection')` ni
`uncaughtException` en todo `src/` (verificado por grep), **el proceso muere**. En un servicio
always-on gestionado por Servy eso significa reinicio a mitad de ciclo, con el lock y los archivos
XML en estado intermedio.

La probabilidad hoy es baja (todos los rechazos observados son `Error`), pero la fase agrega un
sitio de `throw` nuevo dentro de la cadena (L224) y el costo del seguro es una línea.

**Fix:**

```js
            .finally(() => {
                operationManager.releaseLock(taskId);
            })
            .catch((fatal) => {
                // Red final: nada debe escapar como unhandledRejection — Node 22
                // por defecto tumba el proceso y el servicio es always-on (CLAUDE.md §3).
                logGenerator(LOG_FILE, 'error',
                    `[FATAL] Excepción no manejada en la cadena del disparo manual ` +
                    `operationId=${operationId}: ${fatal && fatal.message ? fatal.message : String(fatal)}`);
            });
```

### WR-02: Las aserciones de paridad no comprueban paridad — pasan sobre un bloque totalmente comentado

**File:** `tests/integration/timeout-logging.test.js:119-146`

**Issue:** Los tres casos nuevos son `regex.test(fileContents)` sobre el texto crudo de
`src/routes/schedule-routes.js`. Comprobado experimentalmente en esta revisión: si se comentan
**todas** las líneas 154-253 (la cadena entera, incluido `await startChildProcess()`), las **7**
aserciones siguen pasando, porque `// operationManager.startStep('background-cycle',
'startChildProcess', null);` sigue casando con el regex.

Además, ninguna de las aserciones **compara los dos archivos entre sí**. Verifican presencia de 7
subcadenas en `schedule-routes.js` y, por separado, presencia de subcadenas en `CronScheduler.js`.
Cualquier divergencia fuera de esas 7 subcadenas pasa en verde: cambiar `throw scpErr` por un
`swallow`, quitar el `finally { endStep }`, añadir `stuckOnStep` al cuerpo del correo en un lado
solamente, cambiar el `{ error: __scpError }` — todo eso son verdes hoy.

El archivo `tests/api/schedule-trigger-import.test.js` sí atraparía la desaparición del bloque
(cubre el comportamiento), así que el riesgo residual es **divergencia silenciosa**, no eliminación.
Pero eso es exactamente lo que D-08 dice prevenir.

**Fix:** comparar los dos bloques normalizados en vez de buscar subcadenas:

```js
        test('el bloque del importador es idéntico en CronScheduler.js y schedule-routes.js (Fase 23 D-01/D-08)', () => {
            const fs = require('fs');
            // Marcadores explícitos alrededor del bloque en AMBOS archivos:
            //   // >>> IMPORTER-BLOCK-BEGIN
            //   // <<< IMPORTER-BLOCK-END
            const extract = (path) => {
                const src = fs.readFileSync(path, 'utf8');
                const m = src.match(/IMPORTER-BLOCK-BEGIN([\s\S]*?)IMPORTER-BLOCK-END/);
                expect(m).not.toBeNull();          // falla si alguien borra el bloque o los marcadores
                return m[1]
                    .split('\n')
                    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))   // fuera comentarios: el código es lo que importa
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .join('\n');
            };
            expect(extract('src/routes/schedule-routes.js'))
                .toBe(extract('src/services/CronScheduler.js'));
        });
```

Filtrar los comentarios cierra además el agujero de "comentar el bloque lo deja en verde".

### WR-03: El comentario recíproco que exigía D-09 no existe, y el que hay en `CronScheduler.js` dice lo contrario de la realidad

**File:** `src/routes/schedule-routes.js:162-172` (mitigación) ⟷ `src/services/CronScheduler.js:102`

**Issue:** D-09 pedía comentario cruzado **en ambos archivos**. Sólo se escribió el de
`schedule-routes.js`. Peor: `src/services/CronScheduler.js:102` sigue diciendo

```js
                // Phase 17 (D-12): startChildProcess is cron-only (manual trigger does NOT call it).
```

que **ahora es falso**. Un mantenedor que abra `CronScheduler.js` para tocar el bloque del
importador leerá literalmente que la ruta manual no lo llama, y no sabrá que hay una copia que
debe actualizar. Como la otra mitad de la red (WR-02) tampoco compara los archivos, la duplicación
queda sin ninguna defensa efectiva contra el drift.

**Fix:** sustituir el comentario obsoleto por el recíproco:

```js
                // Fase 17 (D-12) SUPERADA por la Fase 23: startChildProcess YA NO es cron-only.
                // RÉPLICA DELIBERADA — este bloque está duplicado byte a byte en
                // src/routes/schedule-routes.js (ruta manual). Quien toque un lado DEBE tocar el otro.
                // Motivo de la duplicación y contador PATTERNS.md §S-6 (2/3):
                // .planning/phases/23-boton-invoca-importador/23-CONTEXT.md D-01.
```

### WR-04: `msg.innerHTML` interpola `err.message` — la página sí mete datos de respuesta en el DOM

**File:** `public/ejecucion.html:350` (comentario contradicho en `:176-184`)

**Issue:** El comentario del archivo — que **este diff amplía y reafirma** — declara: *"Todo el
innerHTML es STRING ESTÁTICO: nunca se interpola nada que venga de la respuesta del API
(T-LKI-01), por eso esta página no necesita `escapeHtml()`"*. Es falso en la misma página:

```js
                msg.innerHTML = '<div class="alert alert-danger mb-0">Error al iniciar el proceso: ' + err.message + '</div>';
```

`err` proviene de `apiCall()` (`public/js/shared.js:88-94`), que relanza tanto los fallos de red
como los de `res.json()`. En V8, un `res.json()` sobre un cuerpo no-JSON produce un mensaje que
**incluye un prefijo del cuerpo de la respuesta** (`Unexpected token '<', "<html>\n<he"... is not
valid JSON`). Basta con que un proxy inverso, IIS/ARR o una página de error 502 devuelva HTML para
que ese fragmento acabe en el DOM sin escapar.

La explotabilidad es marginal (mismo origen, prefijo truncado a ~10 caracteres), pero el defecto
real es la **falsedad del invariante documentado**: la línea 350 es preexistente, y esta fase
reafirmó por escrito una regla que el archivo no cumple. El siguiente que agregue un estado
confiando en "esta página no necesita escapeHtml()" tendrá razón para equivocarse.

**Fix:** usar `textContent` para la parte variable, o acotar la afirmación del comentario a
`applyButtonState`:

```js
                msg.innerHTML = '<div class="alert alert-danger mb-0"></div>';
                msg.firstChild.textContent = 'Error al iniciar el proceso: ' + err.message;
```

### WR-05: `public/ejecucion.html` no tiene ninguna cobertura automatizada

**File:** `public/ejecucion.html:186-218`, `:232-312`

**Issue:** `ls tests/` y `grep -rl ejecucion tests/` confirman **cero** tests para esta página. La
máquina de tres estados y la derivación de `importing` son lógica pura, perfectamente testeable, y
son código nuevo que va directo a producción por el pipeline de ofuscación sin staging que ejercite
el flujo real. Los casos que hoy nadie prueba y que un refactor rompería en silencio:

- `stepProgress` con una entrada abierta que **no** es `startChildProcess` → `importing` debe ser
  `false` (hoy el bucle rompe en la primera entrada abierta encontrada desde el final; si un paso de
  `forResponse` quedó abierto por un error de tenant, al cerrar el importador el botón vuelve a
  "Sincronizando..." — comportamiento correcto pero no fijado por ningún test).
- La guarda de idempotencia `btn.dataset.uiState === desired` en la transición `running →
  importing → running`.
- El reset obligatorio de `btn.dataset.uiState` en el `finally` de `ejecutar()` (:363).

**Fix:** extraer la derivación a una función pura exportable y cubrirla:

```js
// public/js/cycle-state.js  (cargado por <script>, con module.exports opcional para Jest)
function deriveImporting(cycleOp) {
    const steps = cycleOp && cycleOp.stepProgress;
    if (!Array.isArray(steps)) return false;
    for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i] && !steps[i].finishedAt) return steps[i].step === 'startChildProcess';
    }
    return false;
}
if (typeof module !== 'undefined') module.exports = { deriveImporting };
```

### WR-06: El comentario sobre el literal `'background-cycle'` vs `taskId` justifica lo contrario de lo que hace el código

**File:** `src/routes/schedule-routes.js:176-181`

**Issue:** El comentario afirma que usar el literal *"sobrevive si un endpoint futuro acepta otros
nombres de tarea sobre el mismo lock compartido"*. Es incorrecto: el mismo handler usa la
**variable** `taskId` en `acquireLock(taskId, operationId)` (L142), en `releaseLock(taskId)` (L252)
y en `addHistory({ taskId })` (L232). Si mañana `triggerSchema`
(`src/routes/schemas/schedule-schemas.js:14-16`, hoy fijo a `'background-cycle'`) aceptara otro
valor, `acquireLock` crearía un slot bajo **ese otro nombre** y el `startStep('background-cycle',
...)` hardcodeado escribiría en un slot inexistente (no-op silencioso) o, peor, en el slot de un
ciclo ajeno. El literal no "sobrevive": rompe.

La paridad byte a byte con el cron es una razón válida para el literal; la razón inventada sobre
endpoints futuros es la que hay que borrar antes de que alguien la use como permiso.

**Fix:**

```js
                    // Literal 'background-cycle' a propósito, NO la variable taskId: mantiene la
                    // paridad byte a byte con src/services/CronScheduler.js (D-01/D-08).
                    // OJO: acquireLock/releaseLock/addHistory de este handler SÍ usan taskId. Hoy
                    // coinciden porque triggerSchema fija taskId a 'background-cycle'. Si algún día
                    // se admiten otros taskId, este literal deja de apuntar al slot correcto y hay
                    // que revisarlo junto con el cron.
```

### WR-07: Sin cobertura del camino feliz: nadie prueba `addHistory({ success: true })` ni el orden `startChildProcess → releaseLock`

**File:** `tests/api/schedule-trigger-import.test.js:236-249`

**Issue:** El criterio de aceptación de REQ-23-01 dice textualmente *"y que `releaseLock` se ejecuta
después de que esa promesa se asienta"*. Ningún test lo afirma. El caso (a) sólo mira
`startChildProcess`; el caso (e) mira `releaseLock` **sólo en el camino de fallo**. Consecuencia:
un refactor que moviera `releaseLock` al primer `.then()` — liberando el candado **antes** de correr
el importador, que es justo el bug que la fase existe para no cometer — dejaría (a), (b), (c), (d) y
(f) en verde.

**Fix:** añadir al caso (a):

```js
        expect(mockOperationManager.addHistory).toHaveBeenCalledTimes(1);
        const entry = mockOperationManager.addHistory.mock.calls[0][0];
        expect(entry.success).toBe(true);
        expect(entry.errors).toEqual([]);

        expect(mockOperationManager.releaseLock).toHaveBeenCalledTimes(1);
        // El candado se suelta DESPUÉS del importador — el corazón de REQ-23-01
        expect(mockBackground.startChildProcess.mock.invocationCallOrder[0])
            .toBeLessThan(mockOperationManager.releaseLock.mock.invocationCallOrder[0]);
        expect(mockOperationManager.addHistory.mock.invocationCallOrder[0])
            .toBeLessThan(mockOperationManager.releaseLock.mock.invocationCallOrder[0]);
```

### WR-08: `drainChain(3)` es una heurística de temporización, no una espera del asentamiento real

**File:** `tests/api/schedule-trigger-import.test.js:208-212`

**Issue:** `drainChain` cede el event loop tres veces (`3` es un número mágico sin justificar) y
después asume que la cadena terminó. Hoy funciona porque todos los mocks resuelven de forma
síncrona, pero el contrato es frágil en dos direcciones:

1. Si algún eslabón agenda un macrotask real (un `setTimeout`, un `await sendAdminAlert` con
   transporte de verdad, un `child_process` real), las aserciones corren **antes** de que la cadena
   se asiente y el test falla de forma intermitente.
2. Peor: la app se construye una sola vez en `beforeAll` y los mocks se limpian en `beforeEach`. Una
   cadena que no alcance a asentarse en el test N deposita sus llamadas a `addHistory`/`releaseLock`
   en los contadores del test N+1, rompiendo los `toHaveBeenCalledTimes(1)` con un fallo que apunta
   al test equivocado.

**Fix:** esperar por condición en vez de por número de ticks:

```js
/** Espera activa acotada — se asienta cuando la condición se cumple, no tras N ticks arbitrarios. */
async function waitFor(condition, { timeoutMs = 1000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error('waitFor: la cadena no se asentó a tiempo');
        await new Promise((resolve) => setImmediate(resolve));
    }
}

// uso:
await waitFor(() => mockOperationManager.releaseLock.mock.calls.length > 0);
```

Añadir además `afterEach(async () => { await waitFor(() => mockOperationManager.releaseLock.mock.calls.length > 0); })`
para garantizar que ninguna cadena cruza la frontera entre tests.

---

## Info

### IN-01: REQ-23-08 y REQ-23-09 siguen abiertos — el plan 23-03 no se ha ejecutado

**File:** `.planning/phases/23-boton-invoca-importador/` (existen `23-01-SUMMARY.md` y
`23-02-SUMMARY.md`; no existe `23-03-SUMMARY.md`)

**Issue:** No es un defecto del código, es una compuerta de despliegue. Dos criterios de aceptación
bloqueantes siguen sin evidencia:

- **REQ-23-08 / D-22:** falta leer el valor literal de `IMPORT_CFDIS_ROUTE` en `zcl-rds-test` y en
  producción. Si apunta a un `.bat` o `.cmd`, `spawn` sin `shell: true`
  (`src/background.js:361`) lanza `EINVAL` en Node 22 (mitigación de CVE-2024-27980), y esta fase
  convierte ese fallo en una ruta activa que antes no se ejercitaba desde el botón.
- **REQ-23-09 / D-23:** falta la prueba end-to-end con los tres puntos de evidencia. Los tests
  verdes de esta revisión no prueben nada operativo: todo corre con mocks.

**Fix:** ejecutar el plan 23-03 antes del merge a `master` (que dispara el pipeline de ofuscación a
producción).

### IN-02: Duplicación de ~55 líneas entre `schedule-routes.js` y `CronScheduler.js` — reconocida y trazada

**File:** `src/routes/schedule-routes.js:174-227` ⟷ `src/services/CronScheduler.js:106-152`

**Issue:** Registrado aquí para que el siguiente revisor no lo vuelva a litigar. La duplicación es
deliberada (D-01), está causada por cuatro tests que afirman sobre el fuente de `CronScheduler.js`,
y el contador de PATTERNS.md §S-6 queda en 2/3. Se verificó que las referencias cruzadas de línea
del comentario (`timeout-logging.test.js:84-99` y
`CronScheduler.timeout-listener.test.js:288-303`) **siguen apuntando al código correcto** después de
las 45 líneas agregadas.

**Fix:** ninguna acción en esta fase. Al aparecer el tercer sitio, extraer a
`src/utils/ImporterStep.js` y reescribir los cuatro tests de fuente como tests de comportamiento.
Mientras tanto, WR-02 y WR-03 son lo que hace que la duplicación sea sostenible; sin ellos, no lo es.

---

_Reviewed: 2026-08-31_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
