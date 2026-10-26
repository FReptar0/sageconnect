---
phase: 23-boton-invoca-importador
plan: 01
subsystem: api
tags: [express, jest, cron, child-process, always-on, importador, sage]

# Dependency graph
requires:
  - phase: 17-instrumentacion-stepprogress
    provides: "startStep/endStep del OperationManager y el slot stepProgress que el paso del importador ocupa"
  - phase: 18-admin-email-sender
    provides: "sendAdminAlert(subject, html, callerLogFile) extraido a src/utils/AdminEmailSender.js y el wrapper local de schedule-routes.js"
  - phase: 19-timeouts-defensa-en-profundidad
    provides: "el sentinel 'Child process timeout', el bloque del cron que se replica, y el patron de aserciones sobre el fuente en timeout-logging.test.js"
provides:
  - "El disparo manual invoca startChildProcess() una vez, despues de forResponse y dentro del lock background-cycle que el handler ya tomaba"
  - "Instrumentacion startStep/endStep del paso startChildProcess en la ruta manual (stepProgress pasa de 7 a 8 entradas)"
  - "Deteccion del sentinel /Child process timeout/ + sendAdminAlert desde el boton, con el log ruteado a ScheduleRoutes.log"
  - "tests/api/schedule-trigger-import.test.js — 6 casos de comportamiento del importador en la ruta manual"
  - "3 aserciones de paridad sobre el fuente de schedule-routes.js dentro del describe ROOT-02 de timeout-logging.test.js"
affects: [23-02 (tercer estado del boton en ejecucion.html), 23-03 (verificacion end-to-end en zcl-rds-test), 22 (botones independientes por tarea)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Duplicacion deliberada + aserciones sobre el fuente como contrato de paridad entre dos archivos"
    - "Archivo de test propio por endpoint cuando los mocks nuevos contaminarian el entorno de tests existentes"

key-files:
  created:
    - tests/api/schedule-trigger-import.test.js
  modified:
    - src/routes/schedule-routes.js
    - tests/integration/timeout-logging.test.js

key-decisions:
  - "D-01 respetada: el bloque del importador se duplica, no se extrae — cuatro tests afirman sobre el fuente de CronScheduler.js y extraerlo los romperia (contador PATTERNS.md S-6 queda en 2 de 3)"
  - "D-02 respetada: encadenamiento por .then() intermedio; el .catch y el .finally preexistentes cumplen REQ-23-04 sin codigo nuevo"
  - "D-16 revisada durante la planificacion: los tests viven en el archivo NUEVO tests/api/schedule-trigger-import.test.js, no en schedule-routes.test.js"
  - "Literal 'background-cycle' en startStep/endStep en vez de la variable taskId: esa clave es la del lock (invariante), no el parametro de la request"
  - "Cero recursos always-on nuevos: sin setInterval, setTimeout, listener, Map/Set de modulo ni spawn propio"

patterns-established:
  - "Contrato de paridad verificado: cuando un bloque se duplica a proposito entre dos archivos, las aserciones sobre el fuente de AMBOS lados convierten la duplicacion en copia verificada en vez de deuda que diverge en silencio"
  - "Aislamiento de mocks por endpoint: un archivo de test nuevo mantiene cierto 'ningun test existente cambia sus assertions' por construccion"

requirements-completed: [REQ-23-01, REQ-23-02, REQ-23-03, REQ-23-04, REQ-23-06, REQ-23-07]

# Metrics
duration: ~25min
completed: 2026-08-31
---

# Phase 23 Plan 01: Encadenar el importador al disparo manual — Summary

**El boton "Ejecutar proceso ahora" ahora invoca `ImportaFacturasFocaltec.exe` con paridad byte a byte con el cron — mismo lock, misma instrumentacion, mismo correo de timeout — y esa paridad quedo fijada por tests que leen el codigo fuente de los dos archivos.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-31T20:25:00Z (aprox.)
- **Completed:** 2026-08-31T20:48:00Z
- **Tasks:** 3 de 3
- **Files modified:** 3 (1 de `src/`, 2 de `tests/`)

## Accomplishments

- **Se cerro el hueco central de la fase.** `src/routes/schedule-routes.js:154` solo llamaba `forResponse()`. Por eso la prueba del 28-ago completo los 7 pasos en 70 segundos y la factura A1189 se quedo en la carpeta de descargas sin llegar a Sage. Ahora un `.then()` intermedio invoca `startChildProcess()` entre `forResponse` y el `addHistory` de exito, dentro del lock `background-cycle` que el handler ya tomaba — sin adquirir ninguno nuevo.
- **Paridad exacta con el cron, no una version aproximada.** El bloque replica `src/services/CronScheduler.js:106-150` campo por campo: `startStep('background-cycle','startChildProcess', null)` antes del `await`, deteccion del sentinel `/Child process timeout/`, log `[TIMEOUT] ... action=admin-email-dispatched`, `sendAdminAlert` fire-and-forget con el MISMO asunto (D-05, para que los filtros de correo del admin sigan funcionando), `throw` para preservar el flujo, y `endStep` en un `finally`. Unica diferencia: el `operationId` del disparo manual, y que el log cae en `ScheduleRoutes.log` en vez de `CronScheduler.log` (D-06) — asi un operador que hace grep de `[TIMEOUT]` sabe por el archivo si el timeout vino del boton o del cron.
- **La duplicacion quedo blindada.** El bloque esta duplicado a proposito (D-01, decision forzada: cuatro tests afirman sobre el fuente de `CronScheduler.js` y extraerlo a un helper los romperia). Los 3 casos nuevos de `timeout-logging.test.js` afirman lo mismo sobre el fuente de `schedule-routes.js`, de modo que tocar un lado y no el otro truena en CI. Comentario cruzado en ambos puntos, con el contador de PATTERNS.md §S-6 explicito en 2 de 3.
- **Cero regresiones.** `npm test` reporta exactamente el mismo conjunto de fallas del baseline §6 — 6 suites / 7 tests. Los 9 tests nuevos suman al total (426 → 435) sin tocar una sola assertion existente.

## Task Commits

1. **Task 1: Encadenar el bloque instrumentado del importador al handler del trigger manual** — `185e8f2` (feat)
2. **Task 2: Tests de comportamiento del importador en la ruta manual** — `75e7140` (test)
3. **Task 3: Aserciones de paridad sobre el fuente de schedule-routes.js** — `c0e99e7` (test)

## Files Created/Modified

- `src/routes/schedule-routes.js` (+75/−1) — `startChildProcess` agregado al destructure del require de background (L25, unico import nuevo del plan); `.then()` intermedio con el bloque instrumentado del importador dentro del handler `POST /:taskId/trigger`.
- `tests/api/schedule-trigger-import.test.js` (+360, nuevo) — 6 casos de comportamiento con app de prueba dedicada y todas las dependencias mockeadas (`background`, `OperationManager`, `AdminEmailSender`, `config`, `CronScheduler`, infra).
- `tests/integration/timeout-logging.test.js` (+45/−0) — 3 casos de paridad sobre el fuente, agregados al describe `ROOT-02` junto a los que ya protegen al cron.

## Decisiones tomadas

### D-16 fue revisada durante la planificacion (trazabilidad exigida por el plan-checker)

**La version original de D-16** (en `23-CONTEXT.md`) nombraba `tests/api/schedule-routes.test.js` como anfitrion de los casos de REQ-23-01 a REQ-23-04, porque ese archivo ya construye una app de prueba con todas las dependencias mockeadas.

**Se cambio al escribir el plan 23-01** a un archivo NUEVO, `tests/api/schedule-trigger-import.test.js`. La razon: los casos nuevos necesitan mocks **a nivel de modulo** que ese archivo hoy no tiene — `../../src/utils/AdminEmailSender`, `schedule.childProcessTimeoutMs` en el mock de config, y `startStep`/`endStep` en el mock de `OperationManager`. Los `jest.mock()` son hoisted y aplican a TODO el archivo, asi que agregarlos habria cambiado el entorno de los 4 tests actuales del trigger. Un archivo propio deja REQ-23-06 (*"ningun test existente cambia sus assertions"*) cierto **por construccion**, y sigue el precedente del repo de un archivo de test por endpoint.

Los 6 casos de D-17 se conservan 1:1, sin recortes. `23-CONTEXT.md` ya trae la decision anotada como *"D-16 (revisada al planificar)"*.

### Otras decisiones de ejecucion

- **Literal `'background-cycle'` en `startStep`/`endStep`, no la variable `taskId`** — esa clave es la del LOCK, que es invariante, no el parametro de la request. `triggerSchema` hoy fija `taskId` a ese mismo valor, asi que coinciden; el literal mantiene la paridad byte a byte con el cron y sobrevive si un endpoint futuro acepta otros nombres de tarea sobre el mismo lock compartido. Queda comentado en el codigo.
- **Sin `emitProgress` para este paso** (D-07) — el cron tampoco lo emite. Paridad significa la misma instrumentacion, ni mas ni menos.
- **Assertion extra no pedida por el plan:** el caso (c) verifica ademas que `sendAdminAlert` recibe `'ScheduleRoutes'` como tercer argumento (`callerLogFile`). Es la unica forma de comprobar D-06 desde un test, y no altera ningun criterio de aceptacion.

## Verificacion

| Chequeo | Resultado |
|---|---|
| `node -e "require('./src/routes/schedule-routes')"` | carga sin error (exit 0) |
| `npx jest tests/api/schedule-trigger-import.test.js` | 6/6 pasan, exit 0 |
| `npx jest tests/integration/timeout-logging.test.js` | 15/15 pasan, exit 0 |
| `npx jest tests/services/cron-scheduler.test.js tests/services/CronScheduler.timeout-listener.test.js` | 34/34 pasan, sin editar sus assertions |
| `npx jest tests/api/schedule-routes.test.js` | pasa; `git diff --stat` no lista el archivo (intacto) |
| `npm test` vs. baseline §6 | **IDENTICO** — 6 suites / 7 tests fallan, las mismas; 427 pasan (418 baseline + 9 nuevos) de 435 |
| `git diff src/config.js` | vacio (REQ-23-07, range-guards intactos) |
| `git diff src/services/CronScheduler.js` | vacio (REQ-23-06) |
| `git diff src/background.js` | vacio (REQ-23-06) |
| `git diff tests/integration/timeout-logging.test.js --numstat` | `45  0` — cero lineas eliminadas |
| Recursos always-on nuevos en el diff | **cero** — grep de `setInterval\|setTimeout\|addListener\|.on(\|new Map\|new Set\|spawn(` sobre las lineas agregadas sale vacio |
| Invariante de timeouts (CLAUDE.md §9) | sin cambios: axios 30s < paso 5m < hijo 10m < candado 14m |
| Stubs / TODO / placeholders en los archivos tocados | ninguno |

**Baseline confirmado byte a byte:** el `diff` entre el listado de suites `FAIL` de antes y el de despues sale vacio. Las 6 son las de siempre: `PaymentReconciliation`, `TransformTime`, `config`, `no-process-exit`, `enforcement-wiring`, `operation-manager`.

## Nota de sesion: `SAGECONNECT_HOOKS_BYPASS=1` estuvo activo

La sesion corrio con el bypass de hooks puesto, para rodear un bug de deteccion de `.claude/hooks/pre-edit-gsd-guard.sh` (busca `SPEC.md`/`PLAN.md` literales mientras GSD escribe `23-SPEC.md`/`23-01-PLAN.md`, asi que bloquea todo `src/**` aun con fase activa). Un intento de ejecucion anterior se detuvo correctamente en ese hook en vez de rodearlo con `sed`.

Ese flag apaga **cinco** hooks, no uno. Estos chequeos manuales los sustituyeron:

| Hook apagado | Sustituto manual aplicado | Resultado |
|---|---|---|
| `pre-commit-redaction.sh` | El `git diff --cached \| grep -in ...` que documenta HANDOFF.md §1, corrido **antes de cada uno de los 3 commits**. El patrón no se reproduce aquí: escribirlo dispararía la propia alarma (misma convención que `23-CONTEXT.md`) | limpio en los 3 |
| `pre-write-always-on.sh` | grep de `setInterval\|setTimeout\|addListener\|.on(\|new Map\|new Set\|spawn(` sobre las lineas `+` del diff | cero coincidencias — el plan no necesito ninguno |
| `pre-edit-critical.sh` | `git diff --stat` de `CronScheduler.js`, `background.js` y `config.js` verificado vacio tras cada tarea (tambien es REQ-23-06) | los 3 intactos |
| `pre-edit-gsd-guard.sh` | fase 23 activa y verificada a mano (`23-SPEC.md`, `23-CONTEXT.md`, `23-01-PLAN.md` presentes y leidos antes de tocar codigo) | OK |
| `pre-bash-destructive.sh` | ningun comando destructivo corrido: sin `git clean`, sin `reset --hard`, sin `rm`, sin `checkout -- .`; staging archivo por archivo, nunca `git add .` | OK |

**El bug del hook sigue abierto.** Es un fix de 1 linea (aceptar `*SPEC.md`/`*PLAN.md` con prefijo de fase) y merece su propia quick task; mientras no se arregle, cada sesion que toque `src/**` va a repetir este bypass y este checklist manual.

## Deviations from Plan

Ninguna. El plan se ejecuto tal como estaba escrito. No aplicaron las reglas 1-4 de desviacion: no aparecieron bugs, ni funcionalidad critica faltante, ni bloqueos, ni decisiones arquitectonicas.

Dos matices, ninguno de ellos una desviacion:

1. **`tests/api/schedule-routes.test.js` mockea `../../src/background` con solo `forResponse`.** Tras el cambio, `startChildProcess` es `undefined` ahi y `operationManager.startStep` tampoco existe en su mock, asi que el bloque nuevo lanza un `TypeError` en esa suite. Ese error cae en el `.catch()` existente de la cadena, termina en `addHistory({success:false})` y se libera el lock — sin rechazo sin manejar y sin afectar ninguna assertion de ese archivo. La suite sigue en PASS. Es exactamente el comportamiento que D-02 predice para un fallo del importador, y es la razon de fondo por la que D-16 se reviso: si esos casos hubieran vivido en ese archivo, habria hecho falta cambiarle los mocks.
2. **Una assertion extra sobre `callerLogFile`** en el caso (c), documentada arriba. Suma cobertura de D-06; no quita ni cambia nada de lo pedido.

## Pendientes que este plan NO cubre (por diseno)

- **REQ-23-05** — tercer estado del boton en `public/ejecucion.html`: plan **23-02**.
- **REQ-23-08** — valor literal de `IMPORT_CFDIS_ROUTE` en `zcl-rds-test` y en produccion: plan **23-03**. Se lee del `.env` del servidor, no del repo. **Si apunta a un `.bat`, hay que detenerse y abrir desviacion** (D-22): Node 22 rechaza `spawn` de `.bat`/`.cmd` sin `shell: true` y lanza `EINVAL` (mitigacion de CVE-2024-27980). Lo esperado es que apunte al `.exe` directo, porque el cron funciona en produccion — pero se confirma, no se asume.
- **REQ-23-09** — prueba end-to-end con evidencia en los tres puntos (el XML sale de la carpeta de descargas, `ChildProcess.log` con `[INFO] Iniciando...` y `[CLOSE] ... codigo 0`, la factura visible en Sage): plan **23-03**. **Los tests verdes de este plan no son evidencia de nada operativo:** no hay Sage ni el `.exe` en la Mac, todo aqui corre con mocks. La verdad operativa solo se obtiene en `zcl-rds-test`.

## Riesgo heredado (documentado, no resuelto — SPEC.md "Constraints")

En produccion `forResponse` tarda 12-13 min y el importador hasta 10 → ~23 min contra un candado de 14 min, que se auto-libera a media corrida. **Esto ya ocurre hoy en el cron**; este plan lleva la ruta manual a la MISMA condicion sin agravarla. Queda fuera de alcance y necesita decision de negocio (subir el candado, partir el ciclo, o aceptar el solape).

## Threat Flags

Ninguna. El plan no introduce superficie de seguridad nueva:

- `startChildProcess()` se llama **sin argumentos** y lee `config.app.importRoute` / `config.app.arg` del `.env`, igual que hoy en el cron. Ningun dato de la request llega al `spawn`, y `src/background.js` no se toco.
- La cadena de middleware del handler no cambio: conserva `requireApiKey` + `validate(triggerSchema,'params')` + `writeLimiter`, bajo `requireLicense`.
- El cuerpo del correo replica exactamente los campos que el cron ya envia al mismo destinatario (`config.license.adminEmail`). Ningun campo nuevo, ningun destinatario nuevo.
- Cero sitios nuevos de SQL, cero interpolacion de datos de la request.

## Self-Check: PASSED

- `src/routes/schedule-routes.js` — FOUND
- `tests/api/schedule-trigger-import.test.js` — FOUND
- `tests/integration/timeout-logging.test.js` — FOUND
- commit `185e8f2` — FOUND
- commit `75e7140` — FOUND
- commit `c0e99e7` — FOUND

## Next

**Plan 23-02** (wave 1, independiente de este): tercer estado del boton en `public/ejecucion.html` — mientras la ultima entrada abierta de `stepProgress` sea `startChildProcess`, mostrar "Importando comprobantes a Sage...". El dato ya viaja: este plan es el que hace que esa entrada exista en la ruta manual.
