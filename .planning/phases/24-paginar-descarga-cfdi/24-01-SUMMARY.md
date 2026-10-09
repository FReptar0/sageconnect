---
phase: 24-paginar-descarga-cfdi
plan: 01
subsystem: api
tags: [portal, paginacion, getTypesCFDI, jest, fake-timers, always-on, prueba-negativa]

# Dependency graph
requires:
  - phase: 19-root-cause-timeouts
    provides: "PortalClient (axios singleton, 30 s) y stepTimeoutMs (5 min), base del presupuesto de listado"
  - phase: 23-boton-invoca-importador
    provides: "las practicas de 23-04: prueba negativa obligatoria y mocks que modelan el estado real"
provides:
  - "fetchCfdiPages(index, query, opts): unica paginacion de GetTypesCFDI.js (cortes, dedupe, presupuesto, linea [PAGINACION]); nunca lanza"
  - "requestCfdiPage(index, url, ctx): reintento 3 x (intento * 1500 ms) que revisa el presupuesto antes de cada intento y de cada espera"
  - "getPendingToPayInvoices sobre fetchCfdiPages con su contrato 'todo o nada' y su URL intactos"
  - "getCfdisByProvider paginada con providerId, hideValidations=true y presupuesto; providerId vacio => [] sin consultar"
  - "Linea [PAGINACION] de getTypeP (sin paginar)"
  - "tests/helpers/getTypesCfdiFakes.js: modelo del portal y de la base de Sage, compartido con 24-02"
  - "tests/utils/GetTypesCFDI.paginacion.test.js: P-01 a P-25"
affects: [24-02 (filtro en bloque y getTypeI/getTypeE sobre fetchCfdiPages), 24-03 (compuerta local), 24-04 (zcl-rds-test)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Una sola funcion de paginacion que nunca lanza y devuelve la causa del corte; cada llamador decide (parcial vs todo o nada)"
    - "Presupuesto de tiempo derivado de stepTimeoutMs y leido en cada llamada, revisado antes de cada pagina y antes de cada espera"
    - "Modelo de portal con el tope real (pageSize invalido => 200) y reloj falso adelantado por el propio modelo"

key-files:
  created:
    - tests/helpers/getTypesCfdiFakes.js
    - tests/utils/GetTypesCFDI.paginacion.test.js
  modified:
    - src/utils/GetTypesCFDI.js

key-decisions:
  - "Ejecucion en linea (/gsd-execute-phase 24 --wave 1 --interactive) en vez de un ejecutor en worktree: workflow.use_worktrees no esta configurado (default true) y un worktree nuevo no trae node_modules, que el plan necesita para npm test y npx jest"
  - "getPendingToPayInvoices conserva textos de [START], [INFO] y [ERROR]; solo cambia la linea de reintento (ahora [PAGINACION-INTENTO]). Los scripts consumen el arreglo, no el log"
  - "Sin UUID, la clave de dedupe es el id del portal cuando es truthy, igual que el codigo anterior (uuid || id)"
  - "logPaginationSummary trata total undefined como desconocido (defensivo; ningun llamador lo pasa hoy)"
  - "Grep de redaccion con un script local que lee en el momento el patron de HANDOFF.md §1 y el arreglo PATTERNS del hook, sin copiarlos a ningun archivo"

patterns-established:
  - "La prueba negativa se revisa por la RAZON de cada fallo, no solo por el conteo: P-24 falla solo por la linea de log, con el resultado identico al de hoy"

requirements-completed: [REQ-24-02, REQ-24-03, REQ-24-04, REQ-24-05, REQ-24-06, REQ-24-11, REQ-24-12, REQ-24-13, REQ-24-14, REQ-24-15]

# Metrics
duration: 13min
completed: 2026-10-09
---

# Phase 24 Plan 01: Paginación compartida — Summary

**`getCfdisByProvider` y `getPendingToPayInvoices` ya leen todas las páginas que reporta el portal mediante una sola función (`fetchCfdiPages`) que corta por página vacía, sin avance, total o tope de 50, reintenta 429/5xx/red y respeta un presupuesto del 25 % de `stepTimeoutMs`; `getTypeP` deja su línea de corte; 25 pruebas nuevas, 20 de ellas fallan contra el código de `origin/master`.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-10-09T15:42:04Z
- **Completed:** 2026-10-09T15:55:11Z
- **Tasks:** 3
- **Files modified:** 3 (1 modificado en `src/`, 2 creados en `tests/`)

## Accomplishments

- Una sola paginación (REQ-24-02) con los cortes de D-04 en su orden, sin regla de página corta (D-05), dedupe por UUID normalizado (D-07), páginas en serie y tope (D-08), reintento heredado (D-09) y presupuesto leído por llamada (D-10). Nunca lanza (D-02).
- `getPendingToPayInvoices` con el contrato de hoy demostrado: P-19 a P-22 pasan contra el código viejo y contra el nuevo (REQ-24-03).
- `getCfdisByProvider` encuentra las facturas de un proveedor aunque estén debajo de la posición 200: manda `providerId` codificado y `hideValidations=true`, devuelve lo recibido ante una página fallida o el presupuesto agotado, y con `providerId` vacío no hace ninguna petición (D-31).
- Línea `[PAGINACION]` de formato fijo por consulta (D-17), `info`/`warn` según recibidas contra `total`, y la de `getTypeP` sin tocar su lógica (D-21: el diff de `getTypeP` sólo agrega líneas y conserva sus 9 `console.log`).

## Task Commits

1. **Tarea 1: Línea base y modelos de prueba** — `55ad054` (test)
2. **Tarea 2: Paginación compartida** — `e9bb4a4` (feat)
3. **Tarea 3: Suite P-01 a P-25, prueba negativa y regresión** — `b791b1a` (test)

**Plan metadata:** el commit `docs(24-01)` de este SUMMARY; `STATE.md` y `ROADMAP.md` van en un `docs(state)` aparte.

## Files Created/Modified

- `src/utils/GetTypesCFDI.js` — constantes de paginación; `listingBudgetMs`, `parseTotal`, `valorLog`, `idLog`, `logPaginationSummary`, `requestCfdiPage` y `fetchCfdiPages` (internos); `getPendingToPayInvoices` y `getCfdisByProvider` sobre `fetchCfdiPages`; línea de `getTypeP`. Se eliminó `requestPendingToPayPage` (sustituida por `requestCfdiPage`). `getTypeI`, `getTypeE`, `getTypeIToSend`, `isRetryablePortalError`, `sleep` y `module.exports` idénticos a `origin/master`.
- `tests/helpers/getTypesCfdiFakes.js` — `createPortal` (tope real de 200, `offset`, `total`, fallos por intento, demoras con reloj falso, `providerId`, `stats.maxInFlight`) y `createSageDb` (CI/CS, espacios finales, `ERRENTRY`/`OPTFIELD`, base por tabla, `{ recordset }`), más `makeUuid`, `makeItem(s)`, `httpError`, `netError`, `sqlEquals`, `logLines` y las tres regex de formato.
- `tests/utils/GetTypesCFDI.paginacion.test.js` — P-01 a P-25 con el patrón S-9, temporizadores falsos y `settle()`.

## Pre-vuelo, bypass y chequeos manuales

- **Pre-vuelo (Parte 0):** `[ "${SAGECONNECT_HOOKS_BYPASS:-0}" = "1" ] && echo BYPASS-ACTIVO || echo BYPASS-AUSENTE` → `BYPASS-ACTIVO`.
- La sesión la arrancó Yahir con `SAGECONNECT_HOOKS_BYPASS=1` (su OK para la ejecución, según el handoff de la fase) y en la sesión dio OK explícito para ejecutar toda la ola 1, sin push.
- Chequeos manuales que sustituyeron a los hooks apagados:

| Hook apagado | Sustituto manual |
|---|---|
| `pre-edit-gsd-guard.sh` | Fase GSD 24 con SPEC, CONTEXT y PLAN verificados; ediciones sólo dentro del alcance del plan. |
| `pre-commit-redaction.sh` | Antes de cada commit, un script local aplicó el patrón de HANDOFF.md §1 a `git diff --cached` y los 4 patrones del arreglo `PATTERNS` del hook (leídos del hook en el momento) al diff preparado, con las mismas exclusiones, y a los nombres preparados. Resultado `REDACCION-LIMPIA` en los commits de código y de documentación. |
| `pre-write-always-on.sh` y `pre-edit-critical.sh` | Revisión de always-on por grep/awk: `setTimeout(` sólo en `sleep`; ningún `Map`/`Set`/caché de módulo; ningún `setInterval`, listener ni `spawn` en el diff; constantes sólo primitivas; `config.schedule` leído por llamada. Ediciones por partes con Edit, no con Write. |
| `pre-bash-destructive.sh` | No se usó stash, reset --hard, rebase, `rm -rf` ni push. La prueba negativa usó `git show origin/master:... >` y `git checkout HEAD --`; el CSV de `npm test` se borró por partes (`rm` + `rmdir`), dos veces. |

## Línea base de `npm test` (Tarea 1, antes de tocar `src/`)

Igual a la que midió el planner el 08-oct:

```
FAIL tests/PaymentReconciliation.test.js
FAIL tests/TransformTime.test.js
FAIL tests/config.test.js
FAIL tests/no-process-exit.test.js
FAIL tests/services/enforcement-wiring.test.js
FAIL tests/services/operation-manager.test.js
Test Suites: 6 failed, 1 skipped, 26 passed, 32 of 33 total
Tests:       7 failed, 1 skipped, 433 passed, 441 total
  ● BTCH-01: Missing result detection › should handle result.item being null/undefined
  ● CronScheduler license guard › proceeds normally when isValid() returns true
  ● minutesToMilliseconds › throws an error when input is 0
  ● minutesToMilliseconds › throws an error when input is negative
  ● process.exit compliance › all scripts in src/scripts/ have require.main === module guard
  ● process.exit compliance › index.js has zero process.exit calls
  ● process.exit compliance › no process.exit in src/ files except config.js and files with require.main guards
```

## Prueba negativa (D-25)

Con los tres commits hechos y `src`/`tests` limpios: `git show origin/master:src/utils/GetTypesCFDI.js > src/utils/GetTypesCFDI.js`, la suite, y `git checkout HEAD -- src/utils/GetTypesCFDI.js`. Resultado contra el código viejo: **20 ✕ y 5 ✓, exactamente la clasificación esperada**. Después: `git status --porcelain -- src tests` vacío, el archivo igual a `HEAD` y la suite otra vez en 25/25.

| ID | Contra `origin/master` | Esperado |
|---|---|---|
| P-01 | ✓ | ✓ (ancla) |
| P-02 | ✕ | ✕ |
| P-03 | ✕ | ✕ |
| P-04 | ✕ | ✕ |
| P-05 | ✕ | ✕ |
| P-06 | ✕ | ✕ |
| P-07 | ✕ | ✕ |
| P-08 | ✕ | ✕ |
| P-09 | ✕ | ✕ |
| P-10 | ✕ | ✕ |
| P-11 | ✕ | ✕ |
| P-12 | ✕ | ✕ |
| P-13 | ✕ | ✕ |
| P-14 | ✕ | ✕ |
| P-15 | ✕ | ✕ |
| P-16 | ✕ | ✕ |
| P-17 | ✕ | ✕ |
| P-18 | ✕ | ✕ |
| P-19 | ✓ | ✓ (ancla) |
| P-20 | ✓ | ✓ (ancla) |
| P-21 | ✓ | ✓ (ancla) |
| P-22 | ✓ | ✓ (ancla) |
| P-23 | ✕ | ✕ |
| P-24 | ✕ | ✕ |
| P-25 | ✕ | ✕ |

Se revisó además la razón de los fallos (ningún `TypeError`, `ReferenceError` ni `SyntaxError` en la corrida): P-03 recibe 100 en vez de 150 (el tope de 200), P-05 consulta el portal con `providerId` vacío, P-15 hace 1 llamada en vez de 3 (no reintenta) y P-24 devuelve el mismo resultado que hoy y falla sólo por la línea `[PAGINACION]` que no existe.

## `npm test` final contra la línea base

```
Test Suites: 6 failed, 1 skipped, 27 passed, 33 of 34 total
Tests:       7 failed, 1 skipped, 458 passed, 466 total
```

Mismas 6 suites con FAIL y los mismos 7 tests (diff vacío contra la línea base); la única diferencia es la suite nueva en verde (433 + 25 = 458, 441 + 25 = 466).

## Decisions Made

Las de `key-decisions`. Ninguna cambia el producto ni el alcance.

## Deviations from Plan

Ninguna de alcance ni de diseño (0 auto-fixes de las reglas 1-3). Diferencias de procedimiento, sin impacto:

1. **Ejecución en línea, no en worktree** — ver `key-decisions`. Mismo árbol, mismos commits atómicos.
2. **Línea base con un solo `npm test`** — la salida completa se guardó en el scratchpad de la sesión (fuera del repo) y de ahí salieron las dos listas del plan, en vez de correr `npm test` dos veces y guardar en `${TMPDIR}`. Mismo contenido.
3. **Modelo de la base un poco más fiel que el texto del plan** — `ERRENTRY = 0` y `OPTFIELD = 'FOLIOCFD'` se detectan con regex tolerante a espacios, y `sqlEquals` quita sólo espacios finales (no tabuladores), como el `=` de SQL Server. Las consultas actuales usan exactamente `ERRENTRY = 0`, así que el resultado es el mismo.
4. **Aserciones más estrictas que el mínimo** — P-02 compara las tres URLs completas; P-07 exige que se conserve el mismo objeto de la primera página; P-12 compara el texto exacto de las dos líneas `[PAGINACION-INTENTO]`; P-18 agrega la contraprueba con el default (3 páginas, `corte=completo`).

**Total deviations:** 0 auto-fixed. **Impact on plan:** ninguno.

## Issues Encountered

None. El paso `update_requirements` del flujo no aplica: el proyecto no tiene `.planning/REQUIREMENTS.md` (los REQ-24 viven en `24-SPEC.md`).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **24-02 lista para ejecutarse** sobre contratos fijos: `fetchCfdiPages(index, query, opts)`, `requestCfdiPage`, `logPaginationSummary`, `listingBudgetMs`, `parseTotal`, `valorLog`, `idLog`, las constantes de módulo, y del auxiliar `createSageDb` (claves `rfcs`/`cxp`/`oc`/`nc` en `failOn`) y las regex `FILTRO_RESUMEN_LINE`/`FILTRO_FACTURA_LINE`. El modelo de la base ya se probó contra el oráculo de paridad de F-05 (CI y CS dan las listas esperadas).
- **A propósito sigue igual hasta 24-02:** `getTypeI` y `getTypeE` con `pageSize=0` y el filtro por factura. REQ-24-01, 07, 08, 09 y 10, y la parte de REQ-24-02, 05, 06, 11 y 14 que toca a esas dos funciones, se cierran en 24-02; los IDs de `requirements-completed` se copiaron tal cual del frontmatter del plan.
- Rama local sin upstream; nada publicado; `master` sin tocar.
- Siguiente: `/clear` (o sesión nueva arrancada con `SAGECONNECT_HOOKS_BYPASS=1 claude`) y `/gsd-execute-phase 24 --wave 2`.

## Self-Check: PASSED

- FOUND: `src/utils/GetTypesCFDI.js`, `tests/helpers/getTypesCfdiFakes.js`, `tests/utils/GetTypesCFDI.paginacion.test.js`
- FOUND: `55ad054`, `e9bb4a4`, `b791b1a`
- Criterios de aceptación de las 3 tareas y `<verification>` del plan re-ejecutados sobre el estado final: todos pasan.

---
*Phase: 24-paginar-descarga-cfdi*
*Completed: 2026-10-09*
