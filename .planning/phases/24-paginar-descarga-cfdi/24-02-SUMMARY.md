---
phase: 24-paginar-descarga-cfdi
plan: 02
subsystem: api
tags: [portal, paginacion, filtro-sage, sql-en-bloque, getTypesCFDI, jest, paridad, inyeccion-sql, always-on, prueba-negativa]

# Dependency graph
requires:
  - phase: 24-paginar-descarga-cfdi
    provides: "24-01: fetchCfdiPages, listingBudgetMs, valorLog, idLog, CYCLE_MAX_PAGES y el modelo del portal y de la base (tests/helpers/getTypesCfdiFakes.js)"
  - phase: 23-boton-invoca-importador
    provides: "las practicas de 23-04: prueba negativa obligatoria y mocks que modelan el estado real"
provides:
  - "filterNotInSage(index, items, kind, consulta): filtro 'ya esta en Sage' en bloque, interno; misma decision que el filtro por factura con 2 x ceil(U/200) + R consultas en serie"
  - "getTypeI y getTypeE paginadas sobre fetchCfdiPages (pageSize=200, hideValidations=true, presupuesto del ciclo) y filtradas en bloque"
  - "Lista blanca UUID_REGEX / RFC_REGEX antes de SQL; registro [FILTRO-SAGE] (resumen y linea por factura solo para a-descargar y anomalias)"
  - "tests/utils/GetTypesCFDI.filtro.test.js: F-01 a F-18 (21 pruebas con las variantes de describe.each)"
affects: [24-03 (compuerta local), 24-04 (zcl-rds-test: las consultas en bloque contra el esquema real de Sage)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Filtro en bloque con literales validados por lista blanca dentro de runQuery (sin parametros de mssql) y cruce en JS recortado y en mayusculas"
    - "Errores aislados por consulta: un bloque o un RFC que falla aparta solo a sus facturas, que no se descargan sin verificar"
    - "Oraculo congelado de la decision anterior, evaluado con intercalacion CI y CS, como ancla de paridad"

key-files:
  created:
    - tests/utils/GetTypesCFDI.filtro.test.js
  modified:
    - src/utils/GetTypesCFDI.js

key-decisions:
  - "La suite F-01..F-18 se escribio y corrio antes del commit feat de la Tarea 1 (los commits siguen siendo uno por tarea y en el orden del plan): un error del filtro se habria corregido antes del commit en vez de dejar un fix(24) aparte. No hizo falta: 21 de 21 a la primera"
  - "Un UUID o un RFC que no es texto cuenta como ausente (uuid-ausente / rfc-ausente), la misma regla para los dos campos, como dice el plan para el UUID"
  - "El mensaje de error se registra con valorLog(err?.message ?? err): un throw que no sea Error tampoco rompe la linea"
  - "No se corrio state.begin-phase al empezar la ola: la fase ya estaba en curso desde 24-01 y la herramienta reescribe el texto a mano de STATE.md (trampa del status derivado); STATE se actualiza al cierre, como en 24-01"
  - "El script local de redaccion tambien revisa el mensaje de cada commit (HANDOFF.md §1 cubre los mensajes) y muestra solo el numero de patron, no la etiqueta del hook"

patterns-established:
  - "Cuando el plan separa feat y test, escribir la suite antes del commit feat: el feat llega a la historia ya probado"
  - "La prueba negativa se revisa por la razon de cada fallo (aqui: 16 fallos de asercion, 0 TypeError/ReferenceError/SyntaxError)"

requirements-completed: [REQ-24-01, REQ-24-02, REQ-24-05, REQ-24-06, REQ-24-07, REQ-24-08, REQ-24-09, REQ-24-10, REQ-24-11, REQ-24-14, REQ-24-15]

# Metrics
duration: 10min
completed: 2026-10-09
---

# Phase 24 Plan 02: Filtro en bloque y getTypeI/getTypeE paginadas — Summary

**`getTypeI` y `getTypeE` ya bajan todas las páginas que reporta el portal y las filtran contra Sage en bloque (`filterNotInSage`): una consulta por RFC distinto y una por cada 200 UUID en CxP y en OC/NC, en vez de 3 por factura. Deciden lo mismo que hoy con intercalación CI y CS, validan con lista blanca antes de SQL, aíslan los errores por bloque y escriben un registro que sólo crece con lo que se descarga. 18 casos nuevos (21 pruebas); 16 fallan contra `origin/master`.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-10-09T16:25:33Z
- **Completed:** 2026-10-09T16:36:00Z
- **Tasks:** 3
- **Files modified:** 2 (1 modificado en `src/`, 1 creado en `tests/`)

## Accomplishments

- **Paginación completa (REQ-24-01, 02, 14):** `getTypeI` y `getTypeE` obtienen sus páginas de `fetchCfdiPages`. Con `total=450` hacen 3 peticiones (`offset` 0/200/400, `pageSize=200`) con `hideValidations=true`; `getTypeE` sigue sin `stage`. `pageSize=0` sólo queda en `getTypeP` y `getTypeIToSend`.
- **Página fallida o presupuesto agotado (REQ-24-05, 06, D-02):** las dos funciones filtran lo recibido. Escriben `[INFO] No hay CFDI de tipo I/E` sólo si el listado terminó de verdad; si falló la primera página, la causa queda en la línea `[PAGINACION]` warn.
- **Misma decisión, en bloque (REQ-24-07, 08, D-12, 13, 16):** paridad con CI y CS contra un oráculo congelado de la decisión por factura de hoy. El oráculo trae trampas de `ERRENTRY`, `OPTFIELD`, espacios finales, mayúsculas y la tabla que no corresponde. F-08 midió **exactamente 8 consultas** para 450 facturas con 2 RFC: 2 a `fesaParam`, 3 a `APIBHO` y 3 a `POINVHO`. Todas llevan la base explícita (`FESA` o la del tenant) y van en serie (`maxInFlight = 1`).
- **Lista blanca y errores aislados (REQ-24-09, 10, D-14, 15):**
  - Ninguna cadena del portal llega al SQL sin pasar su regex.
  - Un item malformado sólo se aparta a sí mismo; con el código anterior, un item sin receptor vaciaba toda la consulta.
  - Un bloque de CxP, de OC/NC o un RFC que falla aparta sólo a sus facturas.
  - Una factura apartada por un bloque de CxP con error no se consulta en OC.
- **Registro (REQ-24-11, D-18, 19, 20):**
  - Una línea `[FILTRO-SAGE]` de resumen con cinco contadores que suman `recibidas`.
  - Una línea por factura sólo para `a-descargar`, `sin-rfc`, `invalida` y `error-sql`; las que ya están en Sage sólo suman al contador.
  - Los valores crudos inválidos van escapados.
  - Ya no hay `console.log` por factura. `getTypeI` conserva 3 `console.log` y `getTypeE` 1, ninguno con UUID.
- **Alcance (REQ-24-15):** `getTypeIToSend`, `module.exports`, `src/config.js` y `.env.example` quedan idénticos a `origin/master`, y el diff de `getTypeP` sólo agrega líneas. Fuera de `.planning/`, la rama cambia exactamente los 4 archivos previstos.

## Task Commits

1. **Tarea 1: Filtro en bloque y getTypeI/getTypeE sobre la paginación** — `acd731b` (feat)
2. **Tarea 2: Suite del filtro F-01 a F-18** — `f9e19af` (test)
3. **Tarea 3: Prueba negativa y regresión** — sin commit (sólo verificación; no hizo falta ninguna corrección)

**Plan metadata:** el commit `docs(24-02)` de este SUMMARY; `STATE.md` y `ROADMAP.md` van en un `docs(state)` aparte.

## Files Created/Modified

- `src/utils/GetTypesCFDI.js`:
  - Constantes nuevas: `SQL_BLOCK_SIZE`, más `UUID_REGEX` y `RFC_REGEX` (sin bandera `g`).
  - `filterNotInSage`, interna y no exportada.
  - `getTypeI` y `getTypeE` reescritas sobre `fetchCfdiPages` + `filterNotInSage`, con su `[START]`, `dateFrom` y catch externo intactos.
- `tests/utils/GetTypesCFDI.filtro.test.js`:
  - F-01 a F-18 con el mismo preámbulo de mocks, temporizadores falsos y `settle()` que la suite de paginación.
  - Auxiliares locales: `filtro`, `resumen`, `porFactura`, `erroresDeBloque`, `sqls` y `consola`.
  - El oráculo de paridad y una copia de `stripComments`.

## Pre-vuelo, bypass y chequeos manuales

- **Pre-vuelo (regla 4):** `[ "${SAGECONNECT_HOOKS_BYPASS:-0}" = "1" ] && echo BYPASS-ACTIVO || echo BYPASS-AUSENTE` → `BYPASS-ACTIVO`.
- **OK de Yahir:** arrancó la sesión con `SAGECONNECT_HOOKS_BYPASS=1`, que según el handoff de la fase es su OK para la ejecución. En la sesión eligió además "ejecutar las 3 tareas seguidas", con commits locales y sin push.
- Chequeos manuales que sustituyeron a los hooks apagados:

| Hook apagado | Sustituto manual |
|---|---|
| `pre-edit-gsd-guard.sh` | Fase GSD 24 con SPEC, CONTEXT y PLAN verificados; ediciones sólo dentro del alcance del plan (un archivo de `src/`, uno de `tests/`). |
| `pre-commit-redaction.sh` | Antes de cada commit, un script local, fuera del repo, que lee en el momento los patrones del propio repo:<br>• el patrón de HANDOFF.md §1 sobre `git diff --cached`<br>• los 4 patrones del arreglo `PATTERNS` del hook sobre el diff preparado (con sus mismas exclusiones) y sobre los nombres preparados<br>• ambos, también sobre el mensaje del commit<br>Resultado `REDACCION-LIMPIA` y `MENSAJE-LIMPIO` en `acd731b` y `f9e19af`; se repite antes de los commits de documentación. |
| `pre-write-always-on.sh` y `pre-edit-critical.sh` | Revisión always-on por grep/awk sobre las líneas agregadas:<br>• ningún `setInterval`, `.on(`, `spawn` ni `setTimeout(` nuevo (`setTimeout(` sólo en `sleep`)<br>• ningún `Map`/`Set` de módulo (los del filtro son locales a la llamada)<br>• regex sin bandera `g`<br>Ediciones por partes con Edit; la suite nueva con Write por ser un archivo nuevo. |
| `pre-bash-destructive.sh` | No se usó stash, `reset --hard`, rebase, `rm -rf` ni push. La prueba negativa usó `git show origin/master:... >` y `git checkout HEAD --`. El CSV de `npm test` se borró por partes (`rm` + `rmdir`) después de revisarlo: datos `PY-001` del mock. |

## Prueba negativa (D-25)

Se corrió con los dos commits hechos y `src`/`tests` limpios. Pasos: `git show origin/master:src/utils/GetTypesCFDI.js > src/utils/GetTypesCFDI.js`, luego la suite (`--verbose` y `--json` al scratchpad), luego `git checkout HEAD -- src/utils/GetTypesCFDI.js`, todo en el mismo comando.

Resultado contra el código viejo: **16 ✕ y 5 ✓, exactamente la clasificación esperada**. Después, `git status --porcelain -- src tests` quedó vacío, `git diff HEAD --quiet` salió 0 y las dos suites volvieron a 46/46.

| ID | Variante | Contra `origin/master` | Esperado | Por qué falla (primera aserción) |
|---|---|---|---|---|
| F-01 | — | ✕ | ✕ | 1 petición `offset=0&pageSize=0` en vez de las 3 URLs paginadas |
| F-02 | — | ✕ | ✕ | ídem para `CREDIT_NOTE` |
| F-03 | — | ✕ | ✕ | devuelve 200 en vez de las 400 recibidas |
| F-04 | getTypeI | ✕ | ✕ | 1 petición en vez de 2 |
| F-04 | getTypeE | ✕ | ✕ | 1 petición en vez de 2 |
| F-05 | CI | ✓ | ✓ (ancla) | — |
| F-05 | CS | ✓ | ✓ (ancla) | — |
| F-06 | CI | ✓ | ✓ (ancla) | — |
| F-06 | CS | ✓ | ✓ (ancla) | — |
| F-07 | — | ✕ | ✕ | ninguna consulta con `IN (` |
| F-08 | — | ✕ | ✕ | devuelve 200 de 450 (no pagina) |
| F-09 | — | ✕ | ✕ | devuelve 2 items de más: el UUID con `OR 1=1` y el que trae el salto de línea |
| F-10 | — | ✕ | ✕ | devuelve `[]`: el item sin receptor vacía toda la consulta |
| F-11 | — | ✕ | ✕ | devuelve 199 de las primeras 200 |
| F-12 | — | ✕ | ✕ | devuelve 19 en vez de 10 |
| F-13 | — | ✕ | ✕ | devuelve 9 en vez de `[]` |
| F-14 | — | ✕ | ✕ | no existe la línea `[PAGINACION]` de getTypeI |
| F-15 | — | ✕ | ✕ | escribe UUID en consola |
| F-16 | — | ✕ | ✕ | `pageSize=0` en 5 funciones (también getTypeI, getTypeE y getCfdisByProvider) |
| F-17 | — | ✓ | ✓ (ancla) | — |
| F-18 | — | ✕ | ✕ | devuelve la factura: el `=` con espacio inicial no la encuentra en CxP |

Las 16 fallas son de aserción, de comportamiento: 0 `TypeError`, 0 `ReferenceError` y 0 `SyntaxError`. Las 5 anclas pasan contra el código viejo, así que el oráculo y el modelo reflejan la decisión de hoy.

## `npm test` final contra la línea base

```
FAIL tests/PaymentReconciliation.test.js
FAIL tests/TransformTime.test.js
FAIL tests/config.test.js
FAIL tests/no-process-exit.test.js
FAIL tests/services/enforcement-wiring.test.js
FAIL tests/services/operation-manager.test.js
Test Suites: 6 failed, 1 skipped, 28 passed, 34 of 35 total
Tests:       7 failed, 1 skipped, 479 passed, 487 total
  ● BTCH-01: Missing result detection › should handle result.item being null/undefined
  ● CronScheduler license guard › proceeds normally when isValid() returns true
  ● minutesToMilliseconds › throws an error when input is 0
  ● minutesToMilliseconds › throws an error when input is negative
  ● process.exit compliance › all scripts in src/scripts/ have require.main === module guard
  ● process.exit compliance › index.js has zero process.exit calls
  ● process.exit compliance › no process.exit in src/ files except config.js and files with require.main guards
```

Mismas 6 suites con FAIL y los mismos 7 tests que la línea base de 24-01. La única diferencia es la suite nueva en verde: 458 + 21 = 479 y 466 + 21 = 487. Coincide con la línea que anticipaba el plan (`6 failed, 1 skipped, 28 passed, 34 of 35 total`).

## Decisions Made

Las de `key-decisions`. Ninguna cambia el producto ni el alcance.

## Deviations from Plan

Ninguna de alcance ni de diseño (0 auto-fixes de las reglas 1-3). Diferencias de procedimiento, sin impacto:

1. **La suite se escribió antes del commit `feat`.** Ver `key-decisions`. Los dos commits siguen siendo atómicos, uno por tarea y en el orden del plan.
2. **Prueba negativa con `--verbose` y `--json`.** Fue una sola corrida, con la salida `--json` en el scratchpad para distinguir las variantes CI/CS de F-05/F-06 y las de F-04. El `grep -E '✓|✕'` del plan pierde el nombre del `describe`.
3. **`npm test` corrido una sola vez.** La salida completa se guardó en el scratchpad y de ahí salieron las dos listas del plan, igual que en 24-01.
4. **Aserciones más estrictas que el mínimo:**
   - F-01 compara las 3 URLs completas y las cabeceras.
   - F-08 exige, además de `<= 8`, el desglose exacto: 2 a `fesaParam`, 3 a `APIBHO` y 3 a `POINVHO`.
   - F-09 revisa que no haya saltos de línea crudos en todas las llamadas a `logGenerator`, no sólo en las de un archivo.
   - F-11 a F-13 exigen que la línea de error sea `error` y única.

**Total deviations:** 0 auto-fixed. **Impact on plan:** ninguno.

## Issues Encountered

None. El paso `update_requirements` del flujo no aplica: el proyecto no tiene `.planning/REQUIREMENTS.md`, porque los REQ-24 viven en `24-SPEC.md`. El `verify.key-links` previo a la ola marcó los 4 enlaces como "Source file not found": sus `from` son nombres de función, no archivos, y los cuatro son de esta misma ola. Quedaron verificados por los criterios de aceptación: `consulta: 'getTypeI'`, `consulta: 'getTypeE'`, `filterNotInSage(index` y `O.[VALUE] IN (`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **24-03 (compuerta local) lista para ejecutarse.** Ya no queda código por escribir en la fase: 24-03 sólo verifica (regresión, alcance de 4 archivos, higiene de commits, prueba negativa consolidada y evidencia de los 19 criterios del SPEC).
- **Lo que sólo puede probar 24-04 (zcl-rds-test):**
  - que las consultas en bloque (`SELECT DISTINCT O.[VALUE] AS U ... IN (...)`) corren contra el esquema real de Sage;
  - las líneas `[PAGINACION]`/`[FILTRO-SAGE]` reales;
  - la duración de downloadCFDI;
  - la addenda con `hideValidations=true`.
  No hay base local (HANDOFF.md §6).
- Rama local sin upstream; nada publicado; `master` sin tocar.
- Siguiente: `/clear` (o sesión nueva arrancada con `SAGECONNECT_HOOKS_BYPASS=1 claude`) y `/gsd-execute-phase 24 --wave 3 --interactive`.

## Self-Check: PASSED

- FOUND: `src/utils/GetTypesCFDI.js`, `tests/utils/GetTypesCFDI.filtro.test.js`
- FOUND: `acd731b`, `f9e19af`
- Los criterios de aceptación de las 3 tareas y la `<verification>` del plan se re-ejecutaron sobre el estado final: 19 de 19 pasan, más `config.js`/`.env.example` sin diff y la revisión always-on limpia.

---
*Phase: 24-paginar-descarga-cfdi*
*Completed: 2026-10-09*
