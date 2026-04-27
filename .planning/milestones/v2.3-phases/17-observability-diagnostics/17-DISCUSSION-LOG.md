# Phase 17: Observability & Diagnostics - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-27
**Phase:** 17-observability-diagnostics
**Areas discussed:** Estructura de stepProgress, Estrategia de refresco UI, Presentación en schedule.html, Instrumentación de stepProgress

---

## Estructura de stepProgress

### Q1: ¿Qué estructura usa stepProgress para representar el progreso del ciclo?

| Option | Description | Selected |
|--------|-------------|----------|
| Array histórico de steps | `stepProgress: [{step, tenant, startedAt, finishedAt?}, ...]` — timeline completo del ciclo en curso | ✓ |
| Current + completed split | `{currentStep, completedSteps[]}` — ergonomía explícita | |
| Último por nombre de step (mapa) | `{[stepName]: {tenant, startedAt}}` — sobrescribe entre tenants | |

**User's choice:** Array histórico de steps
**Notes:** Permite a la UI pintar timeline completo (8 steps × N tenants ≈ 22 entries por ciclo) sin ambigüedad multi-tenant.

### Q2: ¿Cómo se marca finishedAt y cómo se limpia stepProgress entre ciclos?

| Option | Description | Selected |
|--------|-------------|----------|
| API explícita: startStep/endStep | Dos métodos, finishedAt explícito por step | ✓ |
| Sólo startStep + auto-cierre por siguiente | Cierre implícito al iniciar siguiente step | |
| Sólo recordStep, sin finishedAt | UI deduce duraciones | |

**User's choice:** API explícita: startStep/endStep
**Notes:** Da duración por step y código mecánico en background.js (try/finally por step).

### Q3: ¿Qué pasa con stepProgress cuando el lock se libera (ciclo termina)?

| Option | Description | Selected |
|--------|-------------|----------|
| Se borra al releaseLock | stepProgress vive sólo durante el lock | ✓ |
| Se preserva en addHistory al cerrar | Historial gana detalle por step | |
| Se preserva en stepProgress hasta nuevo acquireLock | Permite ver "último ciclo" en UI | |

**User's choice:** Se borra al releaseLock
**Notes:** Separación clara entre "qué corre ahora" vs "historial". Logs estructurados de Winston cubren post-mortem detallado.

### Q4: ¿Qué shape retorna GET /api/operations/status para incluir stepProgress?

| Option | Description | Selected |
|--------|-------------|----------|
| Map keyed por operationType | `operations: {'background-cycle': {...}}` — coincide con código actual | ✓ |
| Array de operations | `operations: [{operationType, ...}]` — más ergonómico para iterar | |

**User's choice:** Map keyed por operationType
**Notes:** Coincide con ROADMAP línea 31 y con el `Object.fromEntries(this.locks)` ya retornado. Bug existente: schedule.html:589 usa `operations.find()` sobre el map (siempre undefined) — debe corregirse.

---

## Estrategia de refresco UI

### Q1: ¿Cómo se mantiene vivo el card de 'Operación en curso' en schedule.html?

| Option | Description | Selected |
|--------|-------------|----------|
| Híbrido: polling + SSE | Polling para detectar y rehidratar; SSE para live | ✓ |
| Polling-first puro (5s) | Drop SSE para este card | |
| SSE con catch-up inicial | Fetch una vez + SSE | |

**User's choice:** Híbrido: polling + SSE
**Notes:** Sobrevive reload mid-cycle (polling) y mantiene la timeline existente (SSE).

### Q2: ¿A qué cadencia pollística y bajo qué condición se hace el polling?

| Option | Description | Selected |
|--------|-------------|----------|
| 5s siempre, incluso idle | setInterval permanente mientras la página esté abierta | ✓ |
| 5s sólo cuando hay operación activa | Polling se inicia/detiene basado en estado | |
| 10s siempre | Cadencia más relajada | |

**User's choice:** 5s siempre, incluso idle
**Notes:** Acorde al ROADMAP success criterion #4 ("polling cada 5s o SSE"). Detecta inicio de cron sin acción del operador.

### Q3: ¿Cómo se relaciona el polling nuevo con la timeline SSE existente en schedule.html?

| Option | Description | Selected |
|--------|-------------|----------|
| Polling alimenta NUEVO card; SSE sigue alimentando timeline existente | Dos componentes UI separados | ✓ |
| Polling reemplaza SSE en este page | Eliminar conexión SSE | |
| Polling se hidrata + SSE sustituye polling cuando conectado | Pausa polling con SSE conectado | |

**User's choice:** Polling alimenta NUEVO card; SSE sigue alimentando timeline existente
**Notes:** Cero retroceso al patrón Phase 9; separación de responsabilidades entre componentes.

---

## Presentación en schedule.html

### Q1: ¿Dónde y cómo se muestra el bloque de 'Operación en curso'?

| Option | Description | Selected |
|--------|-------------|----------|
| Card nuevo arriba del timeline | Nuevo card visible sólo si lock activo | ✓ |
| Enriquecer header del timeline existente | Reusar card existente con metadata | |
| Inline en el card de 'Ciclo de Fondo' | Agregar info al card de cron/Ejecutar Ahora | |

**User's choice:** Card nuevo arriba del timeline
**Notes:** Separa intención: 'qué corre AHORA' vs 'pasos del run actual'. Card oculto en idle.

### Q2: ¿Cómo se muestran los timestamps relativos? ¿Formato y precisión?

| Option | Description | Selected |
|--------|-------------|----------|
| Relative + absolute en hover | "hace 4m 12s" + tooltip ISO | ✓ |
| Sólo relativo en español | Sin tooltip absoluto | |
| Sólo absoluto (HH:MM:SS) | Sin relativo | |

**User's choice:** Relative + absolute en hover
**Notes:** Refresco local cada 1s sin re-fetch al servidor (sólo recalcula delta).

### Q3: ¿Qué representa 'el step actual' cuando el ciclo procesa multi-tenant secuencialmente?

| Option | Description | Selected |
|--------|-------------|----------|
| Último entry sin finishedAt en stepProgress | Si no hay activos, último completado etiquetado | ✓ |
| Máximo startedAt en stepProgress | Confunde steps cerrados como "actuales" | |
| Mostrar TODOS los pendientes lado a lado | Reducible a A en cycle secuencial | |

**User's choice:** Último entry sin finishedAt en stepProgress
**Notes:** Cycle es secuencial, sólo un step in-progress a la vez.

### Q4: ¿Cómo se trunca operationId (UUID v4 de 36 chars) para mostrar?

| Option | Description | Selected |
|--------|-------------|----------|
| Primeros 8 chars + tooltip full | `a1b2c3d4` con title HTML del UUID completo | ✓ |
| Primeros 8 + botón copy | Click-to-copy UX | |
| UUID completo sin truncar | Ruidoso visualmente | |

**User's choice:** Primeros 8 chars + tooltip full
**Notes:** Suficiente para correlacionar con CronScheduler.log; copy via DevTools si hace falta.

---

## Instrumentación de stepProgress

### Q1: ¿Cómo se popula stepProgress dentro de OperationManager?

| Option | Description | Selected |
|--------|-------------|----------|
| Métodos explícitos startStep/endStep + emitProgress separado | 3 llamadas por step en background.js | ✓ |
| Helper wrapAround dentro de OperationManager | `runStep(opId, step, tenant, fn)` | |
| Auto-listener: emitProgress → stepProgress | OperationManager se subscribe a sí mismo | |

**User's choice:** Métodos explícitos startStep/endStep + emitProgress separado
**Notes:** Responsabilidades claras (persistencia ≠ notificación SSE), fácil de testear.

### Q2: ¿Qué pasa si un step tira excepción? ¿endStep se llama o queda sin finishedAt?

| Option | Description | Selected |
|--------|-------------|----------|
| endStep en finally con flag error | Try/finally por step en background.js | ✓ |
| Sólo endStep en path feliz | Step queda "in-progress eterno" si falla | |
| endStep dentro del catch existente de tenant | Aglutina sin per-step granularity | |

**User's choice:** endStep en finally con flag error
**Notes:** UI puede pintar steps con error en rojo. El catch de tenant existente sigue capturando.

### Q3: ¿Cómo se maneja el step extra `startChildProcess` (importador.exe)?

| Option | Description | Selected |
|--------|-------------|----------|
| Tratado como step adicional del ciclo | Instrumentar en CronScheduler.js (no background.js) | ✓ |
| Excluido del stepProgress | Contradice REQ-OBS-02 | |
| Tratado como step pero sin tenant tag | Equivalente a A con tenant=null explícito | |

**User's choice:** Tratado como step adicional del ciclo
**Notes:** Manual trigger seguirá teniendo 7 steps; cron tick tendrá 8. Instrumentación vive en CronScheduler.js:80.

---

## Done check

### Q: ¿Generar CONTEXT.md o explorar más gray areas?

| Option | Description | Selected |
|--------|-------------|----------|
| Generar CONTEXT.md | Las 4 áreas decididas | ✓ |
| Explorar más gray areas | Identificar 2-3 áreas adicionales | |

**User's choice:** Generar CONTEXT.md

---

## Claude's Discretion

- Naming exacto de helpers JS en `public/js/shared.js`
- HTML/CSS exacto del card nuevo dentro del Bootstrap pattern
- JSDoc en `OperationManager.js` para nuevos métodos
- Nombres de helpers privados internos
- Cuándo loguear startStep/endStep en Winston (probablemente sólo en error)

## Deferred Ideas

- **Bug producción `EMFILE: too many open files`** — file descriptor leak; phase aparte (v2.4+)
- Botón copy-to-clipboard de operationId — defer a demanda
- Dashboard de métricas históricas — REQUIREMENTS.md deferred
- Alertas pre-timeout (Slack/email) — REQUIREMENTS.md deferred
- Persistencia de stepProgress al historial — descartado en D-01

## Bugs flagged for planner

- **`public/schedule.html:589`** — `operations.find(op => op.taskId === 'background-cycle')` siempre retorna undefined porque `operations` es un mapa (no array). `detectRunningOperation()` jamás conecta SSE en reload mid-cycle. Corregir como parte del trabajo de actualizar el cliente para consumir el shape enriquecido de D-04.
