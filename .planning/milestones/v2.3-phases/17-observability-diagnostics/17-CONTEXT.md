# Phase 17: Observability & Diagnostics - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Exponer al operador, en `schedule.html` y vía `GET /api/operations/status`, dos pedazos de información que hoy son invisibles:

1. **Locks activos** del `OperationManager` con `operationType`, `operationId`, y `startedAt`.
2. **Heartbeat por step** del ciclo de fondo (`forResponse` + `startChildProcess`) — cuándo arrancó cada step, cuándo terminó (o si sigue corriendo).

Esta phase **NO** implementa recuperación (auto-release, force-release botón, force-release endpoint) — eso es Phase 18. **NO** implementa timeouts en axios/childprocess/Promise.race — eso es Phase 19. Sólo expone el estado para que el operador pueda diagnosticar el bug "Ejecutar Ahora 409 permanente" sin abrir SSH al servidor.

</domain>

<decisions>
## Implementation Decisions

### D-01: Estructura de stepProgress (OBS-03, OBS-05)

`OperationManager` mantiene un array `stepProgress` por cada operación activa, independiente del ring buffer de history. Forma de cada entry:

```js
{ step: 'downloadCFDI', tenant: 'capstone', startedAt: '2026-04-27T18:14:32Z', finishedAt: '2026-04-27T18:18:44Z', error: null }
```

- **Almacenamiento:** mapa interno `{[operationType]: {operationId, startedAt, stepProgress: []}}` (extiende `this.locks`).
- **Lifecycle:** `acquireLock` inicializa `stepProgress: []`. `releaseLock` borra el slot completo. No persiste post-release; el ring buffer de history queda igual (sin enriquecer).
- **Multi-tenant:** cada combinación step+tenant es una entry separada. Un ciclo de 3 tenants × 7 steps + `startChildProcess` = 22 entries antes de release.

### D-02: API stepProgress en OperationManager (OBS-03, OBS-05)

Dos métodos nuevos públicos en `OperationManager`, ambos no-op si el lock no existe (defensa contra race condition en cleanup):

```js
startStep(operationType, step, tenant)   // append entry sin finishedAt
endStep(operationType, step, tenant, { error = null } = {})
                                          // setea finishedAt + error en última entry coincidente
```

`emitProgress` queda intocado para no romper SSE existente. `startStep`/`endStep` y `emitProgress` son llamadas separadas — instrumentación verbosa pero responsabilidades claras (persistencia ≠ notificación SSE).

`getRunningOperations()` se actualiza para incluir `stepProgress` en el snapshot retornado.

### D-03: Manejo de errores en endStep (OBS-05)

En `background.js`, cada step queda envuelto en `try { startStep + emitProgress + await stepFn() } finally { endStep(..., { error: caughtMessage || null }) }`. La entry siempre obtiene `finishedAt` aunque el step falle. La UI puede pintar steps con `error != null` en rojo.

El `try/catch` de tenant existente (background.js:145) sigue capturando el error y rompiendo iteración del tenant; nuestro `try/finally` por step es más interno.

### D-04: API response shape (OBS-04)

`GET /api/operations/status` mantiene la forma `{operations: {[operationType]: {...}}}` (mapa keyed por type — coincide con `Object.fromEntries(this.locks)` ya retornado y con el ejemplo del ROADMAP línea 31). Cada entrada incluye:

```json
{
  "operations": {
    "background-cycle": {
      "operationId": "abc12345-...",
      "startedAt": "2026-04-27T18:14:32.000Z",
      "stepProgress": [
        { "step": "buildProviders", "tenant": "capstone", "startedAt": "...", "finishedAt": "..." },
        { "step": "downloadCFDI",   "tenant": "capstone", "startedAt": "..." }
      ]
    }
  }
}
```

**BUG existente a corregir como parte del trabajo:** `public/schedule.html:589` consume el endpoint con `operations.find(op => op.taskId === 'background-cycle')`. Como `operations` es un mapa, `find()` siempre retorna `undefined` → la función `detectRunningOperation()` jamás conecta SSE en un reload mid-cycle. El planner debe corregir el cliente al iterar el mapa, no array.

### D-05: Estrategia de refresco UI (OBS-01, OBS-02)

Patrón **híbrido polling + SSE** para el card nuevo:

- **Polling**: `setInterval(5000)` permanente mientras la página esté abierta. Hace `GET /api/operations/status` y rehidrata el card de "Operación en curso" desde `stepProgress`. Sobrevive reload mid-cycle (resuelve el bug actual).
- **SSE**: cuando el polling detecta un `operationId` activo Y todavía no hay `EventSource` abierto, lo abre. Los eventos `progress`/`error`/`complete` no actualizan el card nuevo (eso lo hace polling), siguen alimentando la timeline existente "Progreso en Tiempo Real" (Phase 9).
- **Cierre**: cuando el polling deja de ver operaciones activas, el card se oculta y EventSource se cierra (el server ya tiene cleanup en `complete`).

Diseño: dos componentes UI **separados** — card nuevo (polling) + timeline existente (SSE). Cero retroceso al patrón Phase 9 para el trigger manual feedback.

### D-06: Cadencia y endpoint de polling (OBS-01, OBS-02)

- Cadencia fija **5s** sin backoff, sin pausas en idle. ~720 req/h por página abierta; el endpoint es read-only y barato.
- Endpoint: el mismo `GET /api/operations/status` ya existente, enriquecido por D-04. Reutilizar sin agregar nueva ruta.

### D-07: Layout y composición del card "Operación en curso" (OBS-01, OBS-02)

- **Posición:** card nuevo (Bootstrap 5.3) entre "Ciclo de Fondo" y "Progreso en Tiempo Real".
- **Visibilidad:** `display:none` cuando no hay operaciones activas. Aparece cuando polling detecta lock.
- **Contenido del body:**
  - Header: badge animado + texto `background-cycle` + operationId truncado.
  - Línea 1: "Iniciada: hace 4m 12s" (relativo en español).
  - Línea 2: "Step actual: downloadCFDI · capstone · heartbeat hace 45s".
  - Cuando `stepProgress` está vacío todavía (justo después de acquireLock antes del primer `startStep`): "Inicializando ciclo…".

### D-08: Step actual y heartbeat (OBS-02)

- "Step actual" = última entry de `stepProgress` sin `finishedAt`. Si todas tienen `finishedAt` (entre tenants en pausa de 5s, o despues del último step), mostrar la última con etiqueta "completado" en lugar de "en curso".
- "Heartbeat" = `Date.now() - new Date(entry.startedAt).getTime()` formateado relativo. Refresca cada **1 segundo en cliente** (sin re-fetch al servidor — sólo recalcula el delta).

### D-09: Formato de timestamps en UI (OBS-01, OBS-02)

- Texto principal en español relativo: "hace 4m 12s", "hace 45s", "hace 2h 15m".
- Tooltip HTML (`title` attribute) con ISO completo: `title="2026-04-27T18:14:32.000Z"`.
- Helper `formatRelative(iso)` reutilizable en `public/js/shared.js` (ya existe `formatDateTime` ahí — agregar al lado).

### D-10: Truncamiento de operationId (OBS-01)

- Mostrar primeros 8 chars del UUID v4 (suficiente para distinguir corridas en una sesión, p.ej. `a1b2c3d4`).
- Tooltip HTML con UUID completo para copiar manualmente desde DevTools si el operador necesita correlacionar con `CronScheduler.log`.
- Sin botón copy-to-clipboard (defer al futuro si surge demanda).

### D-11: Instrumentación en background.js (OBS-05)

`forResponse` queda como hoy en estructura, pero cada step se envuelve:

```js
const step = 'downloadCFDI';
try {
    if (emitter && operationId) {
        emitter.startStep('background-cycle', step, tenantIds[i]);
        emitter.emitProgress(operationId, { type:'progress', operation:'background-cycle', tenant: tenantIds[i], step, message: '...', timestamp: new Date().toISOString() });
    }
    await downloadCFDI(i);
} finally {
    if (emitter && operationId) {
        emitter.endStep('background-cycle', step, tenantIds[i], { error: caughtMessageIfAny });
    }
}
```

Mantiene el patrón existente de "emitter null → instrumentación off" (compatible con `node background.js` directo). El `try/finally` interno no captura el error — lo deja propagar al `try/catch` de tenant existente (línea 145).

### D-12: Instrumentación de startChildProcess (OBS-02)

`startChildProcess` se invoca desde `CronScheduler.js:80` (cron path), NO desde `schedule-routes.js:129` (manual trigger path). Por lo tanto:

- Instrumentar en `CronScheduler.js`: `operationManager.startStep('background-cycle', 'startChildProcess', null)` antes del `await startChildProcess()`, `endStep` en finally.
- El step usa `tenant: null` (es global, no por tenant).
- El manual trigger seguirá teniendo 7 steps en stepProgress; el cron tick tendrá 8 (los 7 × N tenants + startChildProcess).

### D-13: Tests (Claude's Discretion)

- Unit tests para `OperationManager.startStep`/`endStep`/`getRunningOperations` con stepProgress.
- Test de `GET /api/operations/status` que verifica el shape enriquecido con stepProgress.
- Test de instrumentación en `background.js` (mock de `OperationManager` que graba llamadas a startStep/endStep).
- UI tests manuales (no hay framework e2e en el proyecto).

### Claude's Discretion

- Naming exacto de helpers JS en `public/js/shared.js` (`formatRelative`, `humanizeDuration`, etc.).
- HTML/CSS exacto del card nuevo dentro del Bootstrap pattern existente.
- Si el header `OperationManager.js` necesita JSDoc adicional para `stepProgress` API.
- Estructura interna de los nuevos métodos (helper privado `#findActiveStep`, etc.).
- Cómo se loguea startStep/endStep en Winston (probablemente NO, para no inflar logs — sólo usar logs cuando hay error).
- El nombre exacto del card en la UI (sugerencia: "Operación en curso").

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & Requirements (locked)
- `.planning/ROADMAP.md` — Phase 17 success criteria (líneas 17-33)
- `.planning/REQUIREMENTS.md` §Observability — OBS-01..OBS-05 con texto literal de cada REQ

### Backend (a modificar)
- `src/services/OperationManager.js` — agregar `startStep`/`endStep`, extender `acquireLock`/`releaseLock`/`getRunningOperations` para stepProgress
- `src/routes/operations-routes.js:20-27` — `GET /status` retorna stepProgress enriquecido (mantiene shape map)
- `src/services/CronScheduler.js:80` — instrumentar `startChildProcess` con startStep/endStep (no en background.js)
- `src/background.js` (forResponse) — wrappear cada uno de los 7 steps por tenant en try/finally con startStep+endStep
- `src/routes/schedule-routes.js:129` — referencia: muestra cómo el manual trigger invoca `forResponse` sin `startChildProcess`

### Frontend (a modificar)
- `public/schedule.html` — agregar card "Operación en curso", iniciar polling 5s, corregir bug de `operations.find()` (ver D-04)
- `public/js/shared.js` — agregar helper `formatRelative(iso)` reusable

### Codebase intel (referencia, no modificar)
- `.planning/codebase/CONVENTIONS.md` — patrones de Express routing, ResultEnvelope, asyncHandler
- `.planning/codebase/STACK.md` — Bootstrap 5.3, vanilla JS, sin build tooling
- `.planning/milestones/v2.0-phases/08-scheduler-real-time-layer/08-CONTEXT.md` — decisiones originales de OperationManager y SSE
- `.planning/milestones/v2.0-phases/09-operational-web-ui/09-CONTEXT.md` — decisiones del schedule.html original

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`OperationManager.js`** — singleton EventEmitter con Map de locks ya implementado; agregar stepProgress es extensión natural (línea 47 ya almacena `{operationId, startedAt}` por type, sólo agregar el array dentro)
- **`emitProgress`** (OperationManager:81) — sigue funcionando para SSE; D-11 NO lo reemplaza, agrega instrumentación adicional
- **`getRunningOperations`** (OperationManager:89) — retorna `Object.fromEntries(this.locks)`; el cambio es enriquecer cada valor con stepProgress
- **`/api/operations/status`** ya existe — sólo enriquecer la response, no crear ruta
- **`asyncHandler` + `successResult`** (utils/ResultEnvelope) — patrón estándar ya usado
- **`formatDateTime`** en `public/js/shared.js` — patrón de helper que reusaremos para `formatRelative`
- **Bootstrap 5.3 card pattern** ya repetido en schedule.html (3 cards existen) — nuevo card sigue el mismo molde

### Established Patterns
- **CommonJS** en backend (`require`/`module.exports`)
- **Express Router por dominio**: ya existe split system/payments/pos/schedule/operations
- **ResultEnvelope** en todas las API responses
- **Spanish UI labels** consistente con Phase 9
- **API key middleware** sólo en write endpoints (read endpoints como `/status` son públicos dentro de la red)
- **Vanilla JS + fetch** en frontend, sin build tooling (Bootstrap 5.3 + Font Awesome via CDN)

### Integration Points
- `OperationManager` consumido por: `CronScheduler.js`, `schedule-routes.js` (trigger), `operations-routes.js` (status + SSE), tests
- `forResponse` es invocado dos veces: cron path (CronScheduler.js:79) y manual trigger (schedule-routes.js:129) — ambos pasan `emitter: operationManager`
- `startChildProcess` solo se invoca en cron path (D-12)
- `schedule.html` consume: `/api/schedule`, `/api/schedule/history`, `/api/schedule/:taskId/trigger`, `/api/operations/status`, `/api/operations/:operationId/stream`

</code_context>

<specifics>
## Specific Ideas

- El operador típico abre `schedule.html` cuando algo "se ve raro" y necesita decidir si esperar más o forzar release (Phase 18). El card debe responder a esa pregunta sin pensar: ¿hay algo corriendo? ¿desde cuándo? ¿en qué step se quedó? El heartbeat relativo ("hace 45s" vs "hace 8m") es el indicador de "vivo vs colgado" más rápido de leer.
- La instrumentación verbose (3 llamadas: startStep, emitProgress, endStep) en background.js es aceptable porque los 7 steps ya están explícitos en el código actual con `if (emitter && operationId) { emitter.emitProgress(...) }` — sólo agregamos 2 llamadas más en cada bloque. Total ~14 líneas nuevas por step × 7 steps = ~100 líneas; legibles y mecánicas.
- El bug de `operations.find()` en schedule.html:589 explica por qué después del bug 409 reportado, recargar la página NO mostraba la operación stuck — el cliente nunca conectaba SSE para ver heartbeats. Corregir esto es parte del valor de esta phase.
- No queremos persistir stepProgress al historial del ring buffer (D-01): el historial es para "qué pasó", no "qué pasó a detalle de step" — eso vive en logs estructurados de Winston (`CronScheduler.log`, `ForResponse.log`).

</specifics>

<deferred>
## Deferred Ideas

- **Bug producción `EMFILE: too many open files` al servir `404.html`** (mencionado por usuario durante discuss) — file descriptor leak en Express static / Winston / SSE accumulation. Requiere phase aparte (probablemente nuevo milestone "v2.4 Resource Leaks" o phase 20+). NO en alcance de v2.3 (que es scheduler locks). El sintoma es distinto del bug 409 que motivó esta milestone.
- Botón copy-to-clipboard del operationId completo — defer hasta que un operador lo pida.
- Dashboard de métricas históricas (duración promedio por step, tendencia de cuelgues por tenant) — listado en REQUIREMENTS.md "Future Requirements (Deferred)".
- Alertas Slack/email proactivas cuando un cycle excede X min — listado en REQUIREMENTS.md deferred. Phase 18 implementa el email en auto-release; las alertas pre-timeout serían feature separada.
- Persistencia de stepProgress al historial — descartado en D-01.

</deferred>

---

*Phase: 17-observability-diagnostics*
*Context gathered: 2026-04-27*
