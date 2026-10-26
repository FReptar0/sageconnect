# Phase 22: Botones de ejecución por tarea — Discussion Log

**Mode:** `--auto` (el usuario es jr y delegó explícitamente las decisiones técnicas; las de negocio se confirmaron aparte en el SPEC). Registro para referencia humana; los agentes downstream leen CONTEXT.md/SPEC.md.

**Gathered:** 2026-08-03

## Áreas y decisiones auto-seleccionadas

| Área | Pregunta | Opción elegida (recomendada) |
|------|----------|------------------------------|
| Orquestación selectiva | ¿Refactor DRY (un runner para todo) vs función paralela duplicando el envoltorio? | **Runner genérico `runSteps(stepKeys)`** + `STEP_REGISTRY`; `forResponse` = `runSteps(ALL_STEP_KEYS)`. Evita duplicar el envoltorio always-on. (D-01/D-02/D-03) |
| Definición de tareas | ¿Cómo se define "qué pasos = compras"? | Mapa `TASK_STEPS`, `compras → [buildProviders, createPurchaseOrders]`; extensible pero solo compras se cablea. (D-04) |
| Endpoint | ¿Endpoint nuevo vs extender el trigger existente? | **Endpoint nuevo de tarea** reusando el patrón del trigger (`schedule-routes.js:133-192`). (D-05) |
| Lock (crítico) | ¿Lock por-tarea vs lock compartido? | **Lock compartido `background-cycle`** (clave fija) — única forma de garantizar que no se cruce con el cron. (D-06) |
| Historial / UI status | ¿Cómo refleja "última ejecución" y el bloqueo? | `taskId='background-cycle'` en historial + poll existente deshabilita ambos botones. (D-07/D-09) |
| UI | ¿Un botón nuevo o rehacer la página? | Botón "Compras" junto al de "todo", reusando `ejecutar()`/poll. (D-08) |
| Timers (§3) | ¿Timer nuevo? | No — reusar el `setInterval` de poll ya existente (liberado en `beforeunload`). (D-10) |

## Decisiones de negocio (confirmadas en el SPEC por Yahir, 2026-08-03)
- "Compras" = solo proveedores + crear OC (sin pasos 6/7).
- Solo el botón "Compras" en esta fase.
- Se conserva el botón "Ejecutar proceso ahora" (todo).

## Deferred
- Botones de pagos/facturas/solo-proveedores (futuros, mismo mecanismo).
- Locks por-tarea (descartado por seguridad always-on).

---

*Phase: 22-botones-ejecucion-por-tarea*
