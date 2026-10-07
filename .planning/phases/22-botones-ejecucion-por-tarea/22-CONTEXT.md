# Phase 22: Botones de ejecución por tarea - Context

**Gathered:** 2026-08-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Agregar al portal de ejecución manual (`public/ejecucion.html`) la capacidad de ejecutar **una tarea específica** —empezando por **"Compras"** = `buildProvidersXML` → `createPurchaseOrders`— sin correr el ciclo completo de 7 pasos, reusando el lock `background-cycle` para no cruzarse con el cron de 15 min. Se conserva el botón "Ejecutar proceso ahora" (todo el ciclo).

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**6 requirements are locked.** See `22-SPEC.md` for full requirements, boundaries, and acceptance criteria. Downstream agents MUST read `22-SPEC.md` before planning or implementing.

**In scope (from SPEC.md):**
- Mecanismo de orquestación selectiva (subconjunto ordenado de los 7 pasos) en `src/background.js`.
- Botón "Compras" en `public/ejecucion.html` = `buildProvidersXML` → `createPurchaseOrders`.
- Endpoint(s) para disparar una tarea, reusando el lock `background-cycle`.
- Deshabilitar los botones por-tarea durante cualquier ciclo (extensión del #1 existente).

**Out of scope (from SPEC.md):**
- Los otros 3 botones (pagos, facturas, solo-proveedores) — futuros, mismo mecanismo.
- Locks separados por tarea — se usa el lock compartido `background-cycle`.
- Modificar la lógica interna de los pasos — solo se re-orquesta el orden de invocación.
- Reintentos (fases 20–20.3). Exposición vía Bastion (infra, no código).

</spec_lock>

<decisions>
## Implementation Decisions

### Orquestación selectiva (src/background.js)
- **D-01:** Extraer un **registry de pasos** `STEP_REGISTRY` = mapa `stepKey → { label, fn }` con los 7 pasos actuales (`buildProviders`→`buildProvidersXML`, `downloadCFDI`, `checkPayments`, `uploadPayments`, `createPurchaseOrders`, `processOrderChanges`, `closePurchaseOrders`). Las `stepKey` reusan los mismos `__step` labels que hoy están inline en `forResponse`.
- **D-02:** Un **runner genérico** `runSteps(stepKeys, options)` aplica el envoltorio común que hoy está inline por paso en `forResponse`: loop per-tenant, `withStepTimeout(fn(i), config.schedule.stepTimeoutMs, ...)`, logs `[START]`/`[COMPLETE]`, `stepProgress`/emitter, `delay` entre pasos, y el manejo de error por paso (incluida la detección del sentinel `'Step timeout'`). **NO se altera ese envoltorio, solo se parametriza qué pasos corre.**
- **D-03:** `forResponse()` se **re-implementa como `runSteps(ALL_STEP_KEYS, options)`** con `ALL_STEP_KEYS` = los 7 en el orden actual exacto. Comportamiento del ciclo-todo idéntico (mismos pasos, orden, timeouts, logs) — verificado por regresión.
- **D-04:** Mapa `TASK_STEPS`: `'compras' → ['buildProviders','createPurchaseOrders']`. (Extensible: `pagos`→`[checkPayments,uploadPayments]`, `facturas`→`[downloadCFDI]`, `proveedores`→`[buildProviders]`, `full`→`ALL_STEP_KEYS`.) Solo `'compras'` se cablea en esta fase.

### Endpoint + lock (requisito CRÍTICO)
- **D-05:** Nuevo endpoint que dispara una tarea, **reusando el patrón del trigger existente** (`schedule-routes.js:133-192`): valida el nombre de tarea (Joi enum), dispara sin `await`, registra historial en `.then/.catch`, `releaseLock` en `.finally`, responde de inmediato con `operationId`.
- **D-06 (CRÍTICO — no negociable):** El endpoint adquiere el lock con la clave **FIJA `'background-cycle'`** (NO un lock por-nombre-de-tarea). Así "compras", el ciclo-todo y el cron comparten el MISMO lock → 409 si algo corre, `[OVERLAP]` (`CronScheduler.js:68-72`) si el cron llega mientras corre una tarea, y aplica el auto-release a 14 min. Esto satisface el requisito de no cruzarse con el cron. **El nombre de la tarea NO debe usarse como clave de lock.**
- **D-07:** El historial (`addHistory`) se registra con `taskId: 'background-cycle'` + `summary` descriptivo (p.ej. `"Tarea manual: compras (proveedores→OC)"`), para que "Última ejecución" (que lee la última entrada `background-cycle` de `/api/schedule/history`, fix `f3ee5f5`) capte también los disparos por-tarea.

### UI (public/ejecucion.html)
- **D-08:** Agregar botón **"Compras"** junto a "Ejecutar proceso ahora". Dispara el nuevo endpoint con `task=compras`. Reusa el patrón `ejecutar()` existente (spinner "Iniciando...", éxito→operationId, 409→"ya en ejecución").
- **D-09:** El poll a `/api/operations/status` (que ya detecta `operations['background-cycle']`) deshabilita **AMBOS** botones durante cualquier ciclo. Generalizar `applyButtonState(running)` para operar sobre los N botones (no solo `#btn-ejecutar`), preservando el fail-safe (poll falla → re-habilita), la bandera `triggerInFlight` y el estado optimista.
- **D-10:** §3 always-on: **NO** agregar timers nuevos (se reusa el `setInterval` de poll existente, ya liberado en `beforeunload`). Si algún flujo nuevo requiriera un timer, declarar su `clearInterval`.

### Verificación / no romper lo existente
- **D-11:** Tests mínimos: (a) `runSteps(subset)` invoca solo esos pasos en orden (mock de los controllers); (b) **regresión**: `forResponse` sigue invocando los 7 en orden; (c) el endpoint de tarea adquiere el lock `'background-cycle'` y devuelve 409 si ya está tomado. `npm test` en baseline §6 (sin fallas nuevas).

### Claude's Discretion
- Ruta exacta del endpoint (`/api/schedule/task/:task/trigger` vs `/api/schedule/sync/:task/trigger`) — decidir en plan; ambas reusan `requireApiKey` + `writeLimiter` + `validate`.
- Nombres internos exactos (`runSteps`, `STEP_REGISTRY`, `TASK_STEPS`) — orientativos; el executor puede ajustarlos manteniendo el patrón.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos bloqueados
- `.planning/phases/22-botones-ejecucion-por-tarea/22-SPEC.md` — Requisitos, boundaries y acceptance criteria locked. MUST read before planning.

### Orquestador y pasos (núcleo del cambio)
- `src/background.js` — `forResponse()` y los 7 pasos inline con su envoltorio (`withStepTimeout`, logs, `stepProgress`, delays). Es el archivo a refactorizar (D-01/D-02/D-03).
- `src/utils/duration.js` — `withStepTimeout(promise, ms, context)`; sentinel `'Step timeout'` **load-bearing** (regex en el ruteo de logs).

### Lock y concurrencia (requisito crítico)
- `src/services/OperationManager.js` — `acquireLock`/`releaseLock`/`getRunningOperations`/`addHistory`/evento `lock:timeout`. El lock `background-cycle` es la clave compartida.
- `src/services/CronScheduler.js` §L68-72 — cómo el cron se salta con `[OVERLAP]`; L159-172 `addHistory` + `lastRun`.
- `src/routes/schedule-routes.js` §L133-192 — patrón del trigger existente (lock→forResponse→addHistory→releaseLock); §L112-128 endpoint `/history`.

### UI
- `public/ejecucion.html` — botón + `pollCycleState`/`applyButtonState`/`ejecutar` + fix `f3ee5f5` (última ejecución del historial).

### Reglas del proyecto (obligatorias)
- `CLAUDE.md` §3 (always-on: todo timer/listener declara su limpieza), §9 (invariante de timeouts axios<step<child<lock), §6 (pitfalls SQL/runQuery), §5 (convenciones).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `withStepTimeout` (`src/utils/duration.js`): el envoltorio de timeout por paso; `runSteps` lo reusa sin cambios.
- `OperationManager.acquireLock/releaseLock/getRunningOperations` — el mecanismo de lock compartido; el endpoint de tarea lo reusa con clave `'background-cycle'`.
- Patrón del trigger (`schedule-routes.js:133-192`) — copiar su forma (dispara sin await, historial en `.then/.catch`, releaseLock en `.finally`).
- `ejecucion.html`: `pollCycleState`/`applyButtonState`/`ejecutar` + fail-safe + `triggerInFlight` + `beforeunload` cleanup — se generaliza a N botones.

### Established Patterns
- Cada paso es `fn(i)` por tenant (`config.portal.tenants[i]`), envuelto en `withStepTimeout`.
- Lock **compartido** `background-cycle` para toda ejecución (cron/manual/por-tarea) — evita solapes.
- Historial vía `addHistory({ taskId, operationId, startedAt, finishedAt, success, errors, summary })`.

### Integration Points
- `src/background.js` — refactor forResponse → runSteps (+ STEP_REGISTRY, TASK_STEPS, export de runTask/runSteps).
- `src/routes/schedule-routes.js` — nuevo endpoint de tarea + schema Joi.
- `public/ejecucion.html` — nuevo botón "Compras" + generalizar el estado a 2 botones.

</code_context>

<specifics>
## Specific Ideas

- El orden **proveedores → OC** es intencional (una OC falla si el proveedor no está actualizado) — `TASK_STEPS.compras` DEBE listar `buildProviders` antes de `createPurchaseOrders`.
- "Compras" NO incluye `processOrderChanges` ni `closePurchaseOrders` (decisión Yahir 2026-08-03) — esos siguen solo en el ciclo-todo.

</specifics>

<deferred>
## Deferred Ideas

- **Botones de pagos, facturas y solo-proveedores** — futuros; el `TASK_STEPS` ya los deja listos para cablear con el mismo mecanismo. No se implementan en esta fase.
- **Locks por-tarea (granularidad fina)** — descartado: correr una tarea manual en paralelo al cron es justo lo que Santiago quiere evitar. Se usa el lock compartido.
- **Confirmar con Santiago** los 3 defaults (alcance de compras, solo-compras-primero, conservar botón-todo) — resueltos por Yahir; re-confirmar solo si objeta.

</deferred>

---

*Phase: 22-botones-ejecucion-por-tarea*
*Context gathered: 2026-08-03*
