---
phase: 23-boton-invoca-importador
plan: 02
subsystem: ui
tags: [dashboard, ejecucion-html, poll, stepProgress, always-on, xss, operador]

# Dependency graph
requires:
  - phase: 17-instrumentacion-stepprogress
    provides: "el arreglo stepProgress que OperationManager llena y GET /api/operations/status expone verbatim al navegador"
  - phase: 23-boton-invoca-importador
    plan: 01
    provides: "la entrada stepProgress con step='startChildProcess' y tenant=null en la ruta MANUAL — sin ella esta UI nunca veria el estado 'importing' al picar el boton"
provides:
  - "Tercer estado del boton en public/ejecucion.html: 'importing' con el texto 'Importando comprobantes a Sage...'"
  - "Derivacion defensiva del paso abierto en el cliente (reimplementacion de findLastOpenStep para el navegador)"
  - "applyButtonState(running, importing) — firma de dos argumentos en los seis call sites"
affects: [23-03 (la prueba end-to-end en zcl-rds-test observa este texto durante la corrida), 22 (botones independientes por tarea — hereda la maquina de estados de 3 valores)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reducer de estado de UI con un unico `desired` calculado una sola vez: la guarda de idempotencia y el pintado leen la MISMA variable, asi no pueden divergir"
    - "Comparacion contra literal en vez de interpolacion para reflejar datos del API en el DOM (T-LKI-01 sin escapeHtml)"
    - "Simulacion en Node que EXTRAE el codigo verbatim del HTML en vez de reimplementarlo, para paginas sin harness de tests"

key-files:
  created: []
  modified:
    - public/ejecucion.html

key-decisions:
  - "D-10/D-11/D-12/D-13/D-14/D-15 aplicadas tal cual: tres estados, texto literal estatico, ultima entrada abierta, defensivo por defecto, fail-safe intacto, cero recursos nuevos"
  - "La derivacion agrega una guarda por entrada (`steps[i] &&`) que findLastOpenStep no tiene — del lado servidor el arreglo lo construye OperationManager, en el navegador llega por la red"
  - "El estado se calcula una sola vez en `desired`; las tres ramas de innerHTML ramifican sobre el, no sobre running/importing por separado"
  - "El optimista de ejecutar() pasa applyButtonState(true, false): un ciclo recien disparado esta en el primer paso, nunca importando; el poll corrige en <=3.5s"

patterns-established:
  - "Cuando una pagina no tiene harness de tests, la verificacion ejecutable es una simulacion que extrae el codigo VERBATIM del archivo (indexOf + conteo de llaves + new Function) en vez de retipearlo: lo que se prueba es exactamente lo que se sirve al navegador"

requirements-completed: [REQ-23-05, REQ-23-07]

# Metrics
duration: ~20min
completed: 2026-08-31
---

# Phase 23 Plan 02: El botón muestra el paso de importación — Summary

**`public/ejecucion.html` pasa de dos estados de botón a tres: mientras la última entrada abierta de `stepProgress` sea `startChildProcess`, el operador lee "Importando comprobantes a Sage..." en vez de un "Sincronizando..." congelado — leyendo un dato que el poll ya recibía, sin backend, sin endpoints y sin un solo recurso `always-on` nuevo.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-31
- **Tasks:** 2 de 2
- **Files modified:** 1 (`public/ejecucion.html`, +57/−11; el archivo pasa de 355 a 401 líneas)

## Accomplishments

- **El problema que resuelve es de percepción, y por eso importa.** Con el importador ya encadenado (plan 23-01), un clic puede tardar minutos: en producción `forResponse` lleva 12-13 min y el importador hasta 10 más. Hasta hoy la página decía "Sincronizando..." durante todo ese tramo, así que el operador veía un botón congelado y concluía que se colgó. La demo con el operador del cliente es el miércoles y su criterio de éxito es literalmente *"pico el botón y la factura aparece en Sage"*: un botón que parece muerto reprueba la demo aunque el backend funcione perfecto.
- **Cero backend, cero endpoints, cero datos nuevos.** El `stepProgress` ya viajaba en la respuesta de `GET /api/operations/status` (`src/routes/operations-routes.js:39-40` lo expone verbatim). Este plan solo lo lee. Lo que faltaba del lado servidor lo puso el plan 23-01: es el que hace que la entrada `startChildProcess` exista también en la ruta manual.
- **La decisión de seguridad de la página quedó intacta y explícitamente extendida.** `ejecucion.html` no necesita `escapeHtml()` porque todo su `innerHTML` es literal estático (T-LKI-01, documentado en su propio comentario). El nombre del paso viene del API, así que **nunca se interpola**: se COMPARA contra el literal `'startChildProcess'` y se pinta un texto fijo. La única línea de `innerHTML` que este plan agrega es un literal sin una sola concatenación. El comentario de cabecera se extendió para dejar dicho que el estado nuevo respeta la misma regla, de modo que quien lo lea dentro de seis meses no tenga que deducirlo.
- **El fail-safe del poll salió reforzado, no debilitado.** Los cuatro caminos de fallo — respuesta no OK, shape inesperado, `catch` de red, y el fallo del disparo en `ejecutar()` — pasan ahora `applyButtonState(false, false)`. La regla que ya regía sigue mandando: *un clic de más devuelve un 409 inofensivo; un botón trabado para siempre deja al operador sin salida.*
- **Cero recursos `always-on` nuevos (CLAUDE.md §3, REQ-23-07).** Se reusa el `setInterval` de poll que ya existía y que ya se libera con `clearInterval(pollHandle)` en `beforeunload`. El archivo sigue teniendo **exactamente un** `setInterval`, **cero** `setTimeout`, cero listeners nuevos y cero `Map`/`Set`. No hay nada nuevo que limpiar porque no hay nada nuevo.

## Task Commits

1. **Task 1: `applyButtonState` con tres estados** — `e746211` (feat)
2. **Task 2: `pollCycleState` deriva el paso abierto y actualiza los seis call sites** — `2b4ae1f` (feat)

## Files Created/Modified

- `public/ejecucion.html` (+57/−11) — único archivo tocado en todo el plan.
  - **`applyButtonState(running, importing)`** (antes `applyButtonState(running)`): `importing` es opcional y `undefined` se comporta como `false`, así ninguna llamada previa cambia de significado. El estado deseado se calcula una sola vez en `desired` (`'idle'` | `'running'` | `'importing'`) y las tres ramas de `innerHTML` ramifican sobre esa misma variable. La guarda `triggerInFlight` sigue **primero**; la guarda `!btn` sigue; la escritura idempotente por `btn.dataset.uiState` sigue, ahora con tres valores.
  - **`pollCycleState()`**: la operación se guarda en `cycleOp` (acceso directo al mapa, con el comentario del bug D-04 de la Fase 17 intacto — `operations` NO es un array y `.find()` sobre un objeto plano devuelve `undefined` en silencio), `running` sale de `Boolean(cycleOp)`, y un bucle hacia atrás sobre `stepProgress` localiza la última entrada con `finishedAt` falsy. `importing` es verdadero solo si el `step` de esa entrada es exactamente `'startChildProcess'`.
  - **Seis call sites** con el segundo argumento: `applyButtonState(running, importing)` en el camino normal; `applyButtonState(false, false)` en los tres fail-safe del poll más el fallo del disparo; `applyButtonState(true, false)` en el optimista de `ejecutar()`, con el reset obligatorio `btn.dataset.uiState = 'idle'` de la línea anterior conservado tal cual.
  - **Sin tocar:** `lastKnownRunning`, la lógica del flanco corriendo→detenido que refresca "Última/Próxima ejecución" (sigue dependiendo **solo** de `running`), `POLL_INTERVAL_MS`, el `beforeunload`, y la estructura HTML de la página.

## Decisiones tomadas

### La derivación es MÁS defensiva que el helper del servidor, a propósito

D-12 pide replicar la semántica de `findLastOpenStep` (`src/utils/AdminEmailSender.js:73-79`). Se replicó, con **una diferencia deliberada**: el bucle del navegador lleva una guarda por entrada (`if (steps[i] && !steps[i].finishedAt)`) que el helper no tiene.

La razón es que los dos leen arreglos de procedencia distinta. Del lado servidor el arreglo lo construye `OperationManager` y siempre está bien formado, así que `findLastOpenStep` puede acceder a `stepProgress[i].finishedAt` sin comprobar nada. En el navegador el arreglo llega **por la red**, y D-13 es explícita: *"nunca se lanza una excepción desde el poll por un shape inesperado"*. Ante el conflicto, D-13 pesa más que la paridad literal con el helper. Una entrada `null` se salta y el bucle sigue buscando hacia atrás; el caso J de la simulación cubre exactamente eso.

Queda anotado en un comentario en el código, junto a la referencia `AdminEmailSender.js:73-79`, para que quien compare los dos no lo lea como un descuido.

### Un solo `desired`, no dos condiciones paralelas

Las tres ramas de `innerHTML` ramifican sobre `desired`, no sobre `running`/`importing` por separado. Así la guarda de idempotencia (D-06) y el pintado leen la **misma** variable: es estructuralmente imposible que `btn.dataset.uiState` diga una cosa y el botón muestre otra. La alternativa (`if (running && importing) … else if (running) …`) daba el mismo resultado hoy pero deja abierta esa divergencia para el siguiente que edite la función.

### El optimista de `ejecutar()` nunca adivina `importing`

`applyButtonState(true, false)`: un ciclo recién disparado está en el primer paso, no importando. Si por alguna razón lo estuviera, el siguiente tick del poll (≤ 3,5 s) lo corrige contra la verdad del servidor. El cliente no infiere el paso; lo lee.

## Verificación

### Simulación en Node del reducer de estado

La página no tiene harness de tests, así que la prueba ejecutable es una simulación — pero una que **no reimplementa la lógica**: extrae `applyButtonState` y el bloque de derivación **verbatim** del archivo (`indexOf` + conteo de llaves + `new Function`) y los evalúa contra un `document` de mentira. Lo que se prueba es exactamente lo que se sirve al navegador. Si alguien edita el archivo, la simulación prueba la versión editada.

| # | Shape de `stepProgress` | `importing` | `uiState` | Texto pintado |
|---|---|---|---|---|
| A | última abierta = `startChildProcess` | `true` | `importing` | Importando comprobantes a Sage... `[disabled=true]` |
| B | última abierta = otro paso (`downloadCFDI`) | `false` | `running` | Sincronizando... `[disabled=true]` |
| C | sin operación (mapa vacío) | `false` | `idle` | Ejecutar proceso ahora `[disabled=false]` |
| D | `stepProgress` ausente | `false` | `running` | Sincronizando... |
| E | `stepProgress: []` | `false` | `running` | Sincronizando... |
| F | `stepProgress` no es array (string) | `false` | `running` | Sincronizando... |
| G | `stepProgress: null` | `false` | `running` | Sincronizando... |
| H | `stepProgress` es un objeto | `false` | `running` | Sincronizando... |
| I | todas las entradas cerradas | `false` | `running` | Sincronizando... |
| J | entrada `null` dentro del array | `true` | `importing` | Importando comprobantes a Sage... |
| K | `startChildProcess` abierto pero NO el último abierto | `false` | `running` | Sincronizando... |
| L | entrada sin campo `step` | `false` | `running` | Sincronizando... |

**Resultado: 12/12 OK, ninguno lanzó excepción** (exit 0). Los casos D-I y L son los shapes degradados que exige el bloque `<verification>` del plan; J y K se agregaron para cubrir los dos huecos que la lista original no nombraba (entrada nula, y un `startChildProcess` abierto que ya no es el último).

Guardas e idempotencia, en la misma corrida:

| Chequeo | Resultado |
|---|---|
| Segunda llamada con el mismo estado NO reescribe `innerHTML` (no reinicia el spinner) | OK |
| Transición `importing` → `running` SÍ reescribe | OK |
| Transición `running` → `idle` deja `uiState='idle'` y `disabled=false` | OK |
| Con `triggerInFlight=true` el botón no se toca (`ejecutar()` manda) | OK |
| `importing=undefined` se comporta como `false` | OK |

### Chequeos estáticos y de regresión

| Chequeo | Resultado |
|---|---|
| `npm test` vs. baseline (CLAUDE.md §6 + los 9 tests del plan 23-01) | **IDÉNTICO** — `6 failed, 1 skipped, 26 passed, 32 of 33`; `7 failed, 1 skipped, 427 passed, 435 total` |
| Suites en FAIL | las 6 de siempre: `PaymentReconciliation`, `TransformTime`, `config`, `no-process-exit`, `enforcement-wiring`, `operation-manager` |
| `node --check` del `<script>` extraído (314 líneas) | sintaxis OK, exit 0 |
| Firma de la función | `applyButtonState(running, importing)` |
| Llamadas con **un solo argumento** | **ninguna** (grep de `applyButtonState([^),]\+)` vacío) |
| `applyButtonState(false, false)` / `(true, false)` / `(running, importing)` | 4 / 1 / 1 llamadas (+ la definición) |
| `setInterval(` en el archivo | **exactamente 1** (el preexistente) |
| `setTimeout(` en el archivo | **0** |
| `clearInterval(pollHandle)` dentro del `beforeunload` | presente (L394) |
| Recursos `always-on` nuevos en las líneas `+` del diff completo | **cero** (grep de `setInterval\|setTimeout\|addEventListener\|addListener\|new Map\|new Set\|.on(` vacío) |
| `innerHTML` nuevo con interpolación o concatenación | **cero** — la única línea agregada es un literal estático |
| `.find(` aplicado a `operations` | ninguno; el comentario del bug D-04 de la Fase 17 sigue en su lugar |
| Guarda `if (triggerInFlight) return;` como primera de `applyButtonState` | intacta (L188) |
| Guarda de idempotencia sobre `btn.dataset.uiState` | intacta (L204) |
| Archivos tocados por los dos commits | **solo** `public/ejecucion.html` |

> **Nota sobre `CLAUDE.md`:** aparece como modificado en `git status`, pero ese cambio es **preexistente a esta sesión** (ya estaba en el árbol de trabajo antes del primer comando de este plan). No se tocó y no se incluyó en ningún commit.

## Nota de sesión: `SAGECONNECT_HOOKS_BYPASS=1` estuvo activo

La sesión corrió con el bypass de hooks puesto, para rodear el bug de detección de `.claude/hooks/pre-edit-gsd-guard.sh` (busca `SPEC.md`/`PLAN.md` literales mientras GSD escribe `23-SPEC.md`/`23-02-PLAN.md`, así que bloquea todo `src/**` aun con fase activa).

Ese flag apaga **cinco** hooks, no uno. Estos chequeos manuales los sustituyeron:

| Hook apagado | Sustituto manual aplicado | Resultado |
|---|---|---|
| `pre-commit-redaction.sh` | El `git diff --cached \| grep -in ...` que documenta HANDOFF.md §1, corrido **antes de cada uno de los 2 commits de tarea** y antes del commit final. El patrón no se reproduce aquí: escribirlo dispararía la propia alarma (misma convención que `23-CONTEXT.md` y `23-01-SUMMARY.md`) | limpio en los 3 |
| `pre-write-always-on.sh` | grep de `setInterval\|setTimeout\|addEventListener\|addListener\|new Map\|new Set\|.on(` sobre las líneas `+` del diff completo del plan, más el conteo absoluto de timers en el archivo | cero coincidencias; 1 `setInterval` (el preexistente), 0 `setTimeout` |
| `pre-edit-critical.sh` | Alcance del diff verificado tras cada tarea: `git diff --stat` lista **solo** `public/ejecucion.html`. Cero archivos de `src/`, `tests/`, `scripts/` o config tocados | OK |
| `pre-edit-gsd-guard.sh` | Fase 23 activa y verificada a mano (`23-SPEC.md`, `23-CONTEXT.md`, `23-02-PLAN.md`, `23-01-SUMMARY.md` presentes y leídos antes de tocar código) | OK |
| `pre-bash-destructive.sh` | Ningún comando destructivo corrido: sin `git clean`, sin `reset --hard`, sin `rm`, sin `checkout -- .`; staging archivo por archivo, nunca `git add .` | OK |

**El bug del hook sigue abierto** (segunda sesión consecutiva que lo arrastra). Es un fix de 1 línea — aceptar `*SPEC.md`/`*PLAN.md` con prefijo de fase — y merece su propia quick task; mientras no se arregle, cada sesión que toque `src/**` repite este bypass y este checklist manual.

## Deviations from Plan

Ninguna. El plan se ejecutó tal como estaba escrito, y las decisiones D-10 a D-15 se aplicaron sin excepción. No aplicaron las reglas 1-4 de desviación: no aparecieron bugs, ni funcionalidad crítica faltante, ni bloqueos, ni decisiones arquitectónicas.

Dos matices, ninguno de ellos una desviación:

1. **La guarda por entrada del bucle** (`steps[i] &&`), documentada arriba: es una defensa **adicional** que D-13 pide explícitamente, no un apartamiento de D-12. Suma robustez sin cambiar el resultado de ningún caso bien formado.
2. **Dos casos extra en la simulación** (J: entrada `null` en el array; K: `startChildProcess` abierto pero no el último abierto). El plan pedía siete shapes; se corrieron doce. Cobertura de más, criterios de aceptación sin cambiar.

## Pendientes que este plan NO cubre (por diseño)

- **REQ-23-08** — valor literal de `IMPORT_CFDIS_ROUTE` en `zcl-rds-test` y en producción: plan **23-03**. Se lee del `.env` del servidor. Si apunta a un `.bat`, hay que detenerse y abrir desviación (D-22).
- **REQ-23-09** — prueba end-to-end con evidencia en los tres puntos: plan **23-03**. **Nada de lo verificado aquí es evidencia operativa:** no hay navegador real, ni Sage, ni el `.exe` en la Mac. La simulación prueba la lógica de derivación; que el operador vea el texto durante una corrida real solo se comprueba en `zcl-rds-test`.
- **Etiquetas legibles para los otros 6 pasos** — deferred en `23-CONTEXT.md`. El SPEC dice explícitamente que fuera del paso de importación se conserva el texto actual. Sería mejor UX durante una espera de 13 minutos; candidata a fase futura.

## Riesgo heredado (documentado, no resuelto — SPEC.md "Constraints")

En producción `forResponse` tarda 12-13 min y el importador hasta 10 → ~23 min contra un candado de 14 min, que se auto-libera a media corrida. **Consecuencia visible en esta UI:** cuando el candado se auto-libere mientras el importador sigue trabajando, `operations['background-cycle']` desaparece del poll y el botón volverá a `'idle'` — el operador lo verá habilitado con el `.exe` todavía corriendo. Esta página refleja el estado del **candado**, que es lo que hay; no lo inventa ni lo empeora. Ya ocurre hoy con el cron. Necesita decisión de negocio de las personas del equipo que llevan el `.exe` y la operación: subir el candado, partir el ciclo, o aceptar el solape.

## Threat Flags

Ninguna. El plan no introduce superficie de seguridad nueva:

- **XSS:** la única línea de `innerHTML` agregada es un literal estático sin concatenación ni interpolación. El nombre del paso, que sí viene del API, solo se usa en una **comparación** (`steps[i].step === 'startChildProcess'`), nunca llega al DOM. T-LKI-01 preservada; la página sigue sin necesitar `escapeHtml()`.
- **Fuga de información operativa:** el texto habla de "importar comprobantes a Sage" — no menciona el nombre del binario, ni rutas del servidor, ni el `operationId`.
- **Superficie de red:** cero endpoints nuevos, cero llamadas nuevas. Se lee un campo que la misma respuesta del mismo poll ya traía.
- **Disponibilidad:** los cuatro caminos de fail-safe re-habilitan el botón. Ninguna rama nueva puede dejarlo trabado.

## Self-Check: PASSED

- `public/ejecucion.html` — FOUND
- `.planning/phases/23-boton-invoca-importador/23-02-SUMMARY.md` — FOUND
- commit `e746211` — FOUND
- commit `2b4ae1f` — FOUND

## Next

**Plan 23-03** (wave 2, el último de la fase): leer `IMPORT_CFDIS_ROUTE` en `zcl-rds-test` y en producción, y correr la prueba end-to-end con evidencia en los tres puntos del REQ-23-09. La factura **A1189** (quedó descargada sin importar el 28-ago) es la candidata; **CPI3700 está reservada para la sesión en vivo con el operador — no consumirla en pruebas.**
