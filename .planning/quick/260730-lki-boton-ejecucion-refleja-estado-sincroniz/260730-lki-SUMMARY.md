---
quick_id: 260730-lki
slug: boton-ejecucion-refleja-estado-sincroniz
status: complete
branch: feat/boton-ejecucion
code_commit: 9a1c211
date: 2026-07-30
requirements: [QT-260730-LKI-01]
---

# Quick Task 260730-lki — El botón de ejecución refleja el estado real de sincronización — SUMMARY

## Resultado: COMPLETA ✓

Task 1 (código) implementada con todos sus gates de `<verify>` en verde. Task 2 (`checkpoint:human-verify` bloqueante) aprobada por el usuario el 2026-07-30; el commit se hizo sólo después de esa señal.

**Commit de código:** `9a1c211` — `feat(ui): reflejar estado real de sincronizacion en el boton de ejecucion`. Un solo archivo en el stage (`public/ejecucion.html`), **sin** trailer `Co-Authored-By` (HANDOFF §8, verificado post-commit: 0 ocurrencias), en `feat/boton-ejecucion`. Sin push, sin merge, sin ramas nuevas.

## Qué se implementó (Task 1)

`public/ejecucion.html` — **un solo archivo, sólo el bloque `script` inline**. Cero cambios en `src/**`, cero tests, cero dependencias, cero otros HTML.

El botón dejaba de estar deshabilitado en cuanto terminaba su propio POST, así que el operador lo veía habilitado mientras el cron de 15 minutos ya corría un ciclo: hacía click, recibía un 409 confuso y no tenía forma de saber cuándo reintentar. Ahora la página consulta `GET /api/operations/status` cada 3.5 s y el botón es un indicador honesto del estado del servicio.

Piezas nuevas:

- **Estado de módulo**: `POLL_INTERVAL_MS = 3500` (D-01), `pollHandle`, `triggerInFlight` (D-04), `lastKnownRunning` (D-07), con comentario de bloque que documenta el porqué de cada una y cómo se libera el timer (CLAUDE.md §3).
- **`applyButtonState(running)`**: única dueña del botón fuera de `ejecutar()`. `return` inmediato si `triggerInFlight` (D-04); guarda de idempotencia vía `btn.dataset.uiState` para no reiniciar la animación del spinner cada 3.5 s (D-06); `innerHTML` 100 % estático, nunca interpola datos del API (T-LKI-01).
- **`pollCycleState()`**: `fetch` directo en vez de `apiCall()` (D-02) para no encadenar toasts "Error de red" cada 3.5 s al caerse la conexión. Acceso **directo al mapa** `json.data.operations['background-cycle']` con comentario citando el bug D-04 de la Fase 17 — nunca `.find()`. Fail-safe D-03: excepción, `!res.ok` o shape inválido → `console.warn` + `lastKnownRunning = null` + botón habilitado, sin toast y sin re-lanzar. Detección de flanco `true → false` → `loadStatus()` (D-07).
- **`ejecutar()` modificado**: `triggerInFlight = true` como primera línea; `startedOk` en las dos ramas con ciclo vivo (éxito con `operationId` y 409); `finally` reescrito con estado optimista (D-05) + el **reseteo obligatorio de `btn.dataset.uiState`** antes de `applyButtonState()` (si no, el label "Iniciando..." queda congelado por la guarda D-06) + `loadStatus()` + `pollCycleState()` inmediato. El flujo del POST y los mensajes de `#msg` se conservan intactos.
- **`DOMContentLoaded`**: llamada inicial a `pollCycleState()` (cubre abrir la página con un ciclo ya corriendo) + `pollHandle = setInterval(...)`.
- **Cleanup**: listener de `beforeunload` con `clearInterval(pollHandle)`, replicando `public/schedule.html:917-930`.

D-08 respetado: el label visible nuevo es `Sincronizando...` con **tres puntos ASCII** (los acentos sólo aparecen en comentarios, que ya los tenían).

## Verificación (gates de la Task 1 — todos PASAN)

| Gate | Resultado |
|------|-----------|
| Sintaxis del JS inline (`vm.Script`) | `SYNTAX OK (1 inline block)` |
| `grep -c "operations\['background-cycle'\]"` | `1` |
| Cero `operations.find` | `OK: sin .find() sobre el mapa operations` |
| `clearInterval(pollHandle)` + `beforeunload` | `OK: timer cleanup presente` |
| Label ASCII (`Sincronizando...`, cero `Sincronizando…`) | `OK: label ASCII` |
| Sólo `public/ejecucion.html` modificado bajo control de versiones | `OK: solo public/ejecucion.html modificado` |
| `npm test` | **6 suites falladas / 7 tests fallados de 426** (418 passed, 1 skipped) — baseline exacto de CLAUDE.md §6: `PaymentReconciliation`, `TransformTime`, `no-process-exit`, `enforcement-wiring`, `config`, `operation-manager`. **Cero fallas nuevas.** |

`git diff --stat`: `public/ejecucion.html | 171 +++- ` → 1 archivo, 168 inserciones, 3 eliminaciones.

## Gates post-commit (Task 2)

| Gate | Resultado |
|------|-----------|
| `git show --stat HEAD` lista exactamente 1 archivo | `public/ejecucion.html` — OK |
| `git log -1 --format=%B \| grep -c "Co-Authored-By"` | `0` — OK |
| Rama | `feat/boton-ejecucion` — OK, sin push |

## Pendiente (fuera del alcance de esta quick task)

1. **Validación funcional en `zcl-rds-test` con Santiago/Memo, con evidencia/screenshots** — los 6 escenarios del bloque `<how-to-verify>` del PLAN: botón deshabilitado cuando corre el cron; deshabilitado durante ejecución manual; click mientras corre → 409 con mensaje claro; solape manual + cron → el cron se salta con `[OVERLAP]` en el log; fail-safe si falla el status; re-habilitación automática al terminar el ciclo.
2. **Merge a `master`** (y por tanto el deploy obfuscado a producción) — lo decide el usuario, en ventana segura y con OK del lead. Junto con los 2 commits previos de `260730-gcz` (`58d5b41`, `27f16bf`), la rama queda con 4 commits sin pushear.
3. **Siguiente en la lista (NO es esta tarea):** botón de "compras" independiente (proveedores + órdenes de compra sin correr todo el ciclo) — toca `src/background.js` + endpoint nuevo, va por FASE GSD completa.

## Observaciones menores (no bloqueantes)

- `setInterval` con función `async`: si un poll tardara más de 3.5 s los ticks se solapan y una respuesta fuera de orden podría alternar el estado un instante. Mismo comportamiento que el poll de 5 s de `public/schedule.html`; el endpoint lee un mapa en memoria de `OperationManager` sin I/O ni DB, así que el riesgo es teórico.
- En la rama de fallo, `btn.dataset.uiState = null` deja el atributo como la cadena `"null"` hasta que `applyButtonState(false)` lo corrige a `idle` en la misma vuelta. Cosmético, sin efecto funcional (la guarda de idempotencia compara contra `'idle'` / `'running'`).

## Desviaciones del plan

Ninguna. Task 1 se ejecutó exactamente como está escrita, con las decisiones D-01…D-09 aplicadas sin reinterpretarlas.

## Known Stubs

Ninguno.
