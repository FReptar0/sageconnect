# Phase 18: Auto-release & Manual Override - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Dar al operador (y al sistema) maneras de recuperarse de un lock huérfano de `OperationManager` sin reiniciar el servicio:

1. **Auto-release** del lock cuando una operación excede `LOCK_TIMEOUT_MS` (default 14 min ≈ 93% de la cadencia cron de 15 min).
2. **Force-release manual** vía botón en `schedule.html` + endpoint `POST /api/schedule/:taskId/force-release`.
3. **Auditoría** de ambos eventos (auto y manual) en `OperationManager.addHistory` + email al `LICENSE_ADMIN_EMAIL`.

Esta phase **NO** aborta el work en vuelo — el axios cuelga sigue colgado y el child process colgado sigue corriendo. Solo libera el lock para que el siguiente cron tick / manual trigger pueda adquirirlo. La prevención de cuelgues (timeouts en axios, child kill, per-step Promise.race) es **Phase 19**.

Phase 18 es un safety net. Si los locks ya no se traban (post hotfixes 2026-04-27), Phase 18 no se nota. Si vuelven a trabarse, en lugar de paralizar el sistema, se recupera automáticamente y el operador tiene un botón para acelerar la recuperación.

</domain>

<decisions>
## Implementation Decisions

### D-01: Timer encapsulado en OperationManager (REC-01)

`acquireLock(operationType, operationId)` arranca un `setTimeout(LOCK_TIMEOUT_MS)` y guarda el handle del timer dentro del lock slot:

```js
this.locks.set(operationType, {
    operationId,
    startedAt: new Date().toISOString(),
    stepProgress: [],
    timeoutHandle: setTimeout(() => this._fireTimeout(operationType), LOCK_TIMEOUT_MS),
});
```

`releaseLock(operationType)` cancela el timer (`clearTimeout(slot.timeoutHandle)`) ANTES de hacer `this.locks.delete(operationType)`. Esto previene fire-after-release.

**Justificación always-on:** lock + timer son una sola unidad atómica, imposible olvidar limpiar el timer en algún path de error de un caller. El timer ref vive dentro del slot, se libera con el slot. Bajo always-on, un timer no-cleared filtra referencias indefinidamente — la encapsulación elimina ese bug class entero.

`LOCK_TIMEOUT_MS` se lee del config (`config.schedule.lockTimeoutMs`, default 14*60*1000, configurable vía env `LOCK_TIMEOUT_MS`).

### D-02: EventEmitter pattern para post-timeout work (REC-02)

Cuando el timer dispara, `OperationManager._fireTimeout(operationType)`:
1. Lee snapshot del slot (operationId, startedAt, stepProgress, durationMs).
2. Llama internamente a `releaseLock(operationType)` (cancela su propio timer ya disparado y limpia el slot).
3. Emite evento `lock:timeout` con el snapshot: `this.emit('lock:timeout', { operationType, operationId, startedAt, stepProgress, durationMs })`.

`OperationManager` permanece puro — solo señaliza que un timeout ocurrió, no sabe de email ni history.

**Listener:** registrado al boot del scheduler (`CronScheduler.start()` o equivalente), un solo listener handler maneja todos los `operationType`:

```js
operationManager.on('lock:timeout', ({ operationType, operationId, startedAt, stepProgress, durationMs }) => {
    // 1. addHistory entry (D-04)
    // 2. sendMail al admin (D-08)
    // 3. logGenerator a CronScheduler.log
});
```

Mismo patrón que `emitProgress` / `progress:{operationId}` ya usado en Phase 17 (continuidad arquitectónica).

### D-03: Phase 18 es "lock release only" — no aborta work (REC-01)

Cuando el timer dispara, **solo se libera el lock**. La promise original (`forResponse`, `startChildProcess`, axios pendiente) sigue corriendo en background.

Aceptamos el "phantom continuation":
- Si la promise eventualmente termina, su `.then` llama `releaseLock(operationType)` — no-op porque `Map.delete` ya no encuentra la key.
- Si la promise estaba en CronScheduler.js, su `.then/.catch` llama `addHistory` con `success=true/false`. Esa entry queda DESPUÉS de la entry de timeout en el ring buffer. Es informativa: "el work eventualmente terminó" (útil para forense).

**Aborto real del work activo (axios timeout, child process kill, per-step Promise.race) es alcance de Phase 19** (ROOT-01, ROOT-02, ROOT-03). No lo hacemos aquí porque:
1. Inflar Phase 18 deja Phase 19 vacía.
2. AbortController requiere reescribir todos los call sites de axios — es un refactor estructural separado.
3. La separación lock-recovery (Phase 18) vs work-prevention (Phase 19) facilita rollback granular si alguno introduce regresiones.

### D-04: Metadata del history entry de timeout (REC-02)

Estructura del entry agregado por el listener de `lock:timeout`:

```js
operationManager.addHistory({
    taskId: operationType,                    // 'background-cycle'
    operationId,
    startedAt,                                // del slot
    finishedAt: new Date().toISOString(),
    success: false,
    errors: ['Timeout'],
    summary: `Timeout — lock forzosamente liberado después de ${formatDurationMin(durationMs)}`,
    stuckOnStep: lastOpenStep?.step ?? null,    // último entry sin finishedAt
    stuckOnTenant: lastOpenStep?.tenant ?? null,
});
```

`stuckOnStep` y `stuckOnTenant` se derivan iterando `stepProgress` desde el final hasta encontrar el primer entry sin `finishedAt`. Esto le da al operador un punto de partida para diagnosticar sin abrir SSH.

`formatDurationMin` es helper nuevo (puede vivir en `src/utils/TimezoneHelper.js` o uno nuevo `src/utils/duration.js`) que retorna "14m" / "14m 32s" según corresponda.

### D-05: Confirmación UI con Bootstrap modal (REC-03)

Al click en botón "Forzar liberación", se abre un `<div class="modal">` de Bootstrap 5.3 (instanciado vía `new bootstrap.Modal()`):

- **Título:** "Forzar liberación de lock"
- **Body:**
  - Línea 1: "¿Liberar el lock `background-cycle` actualmente en curso?"
  - Línea 2 (si hay datos): "Operación `<operationId truncado>`, iniciada hace <formatRelative>. Step actual: `<stuckOnStep>` (<tenant>)."
  - Línea 3 (warning): "Esta acción cancelará el ciclo en curso y disparará un email al administrador. El siguiente cron tick podrá ejecutar normalmente."
- **Botones:** "Cancelar" (secundario) / "Confirmar liberación" (rojo)
- **Idioma:** Solo español (consistente con el resto del UI). No bilingual.

Pattern consistente con modals que ya existen en `payments.html` y otras páginas.

### D-06: Botón siempre visible cuando hay lock activo (REC-03)

El botón "Forzar liberación" se renderiza dentro del card "Operación en curso" (Phase 17 D-07) y se muestra junto con el resto del contenido del card — apenas el polling 5s detecta lock activo, el botón aparece.

Sin threshold de duración, sin threshold de heartbeat. Razones:
- El auto-release a 14m + el modal de confirmación son los safeguards reales contra panic-clicks.
- Threshold-based logic en cliente puede desincronizar con server clock (tiempo del browser ≠ server).
- Más simple y predecible: "si veo el card, veo el botón".

**Posicionamiento dentro del card:** Claude's Discretion — sugerencia: alineado a la derecha del header, mismo nivel que el badge animado, con `btn-sm btn-outline-danger` para que no compita visualmente con el contenido principal.

### D-07: Endpoint design (REC-04)

```
POST /api/schedule/:taskId/force-release
Headers: x-api-key required, writeLimiter applied
Body (opcional): { reason?: string }   // max 200 chars, validado con Joi
```

**Response 200 (siempre 200, idempotente):**

```json
// Caso 1: había lock activo, se liberó
{
    "success": true,
    "data": {
        "released": true,
        "previousLock": {
            "operationId": "abc12345-...",
            "startedAt": "2026-04-27T18:14:32.000Z",
            "durationMs": 542000,
            "stuckOnStep": "downloadCFDI",
            "stuckOnTenant": "capstone"
        }
    },
    "errors": [],
    "summary": "Lock background-cycle liberado",
    "meta": { ... }
}

// Caso 2: no había lock activo (doble-click después de auto-release)
{
    "success": true,
    "data": { "released": false, "previousLock": null },
    "errors": [],
    "summary": "Sin lock activo para liberar",
    "meta": { ... }
}
```

**Idempotencia:** doble-click después de auto-release retorna 200 + `released: false`, no 404. Esto evita que el modal muestre error confuso al operador cuando el sistema ya se recuperó solo entre clicks.

**Validación:** schema Joi nuevo en `src/routes/schemas/schedule-schemas.js`:
- `params.taskId`: string requerido, debe estar en lista de operationTypes válidos (`['background-cycle', ...]`).
- `body.reason`: string opcional, max 200 chars.

**Implementación:** sigue el patrón de `POST /:taskId/trigger` ya existente en `schedule-routes.js` — `requireApiKey + validate + writeLimiter + asyncHandler + ResultEnvelope`.

### D-08: Email en ambos paths de release (REC-02 + paridad para REC-05)

Tanto auto-release como force-release disparan `sendMail` al `LICENSE_ADMIN_EMAIL` (vía `EmailSender.sendMail`). Severidad operativa equivalente — alguien (o el timeout) rompió un ciclo en curso, el admin debe enterarse.

**Subjects distintos** para identificar la causa:
- Auto-release: `"[SageConnect] Auto-timeout: lock <operationType> liberado después de <duración>"`
- Force-release: `"[SageConnect] Liberación manual: lock <operationType> forzado por operador"`

**Body** incluye: operationId, startedAt, duración, stuckOnStep+tenant, y (para force-release) el `reason` si se pasó.

**REC-05 lo extiende:** la traza original solo pedía addHistory, pero email da paridad de visibilidad entre paths automático y manual. Si force-release se vuelve frecuente en producción, el admin se entera y puede investigar la causa raíz.

### Claude's Discretion

- Naming exacto del helper `formatDurationMin` y dónde vive (`src/utils/duration.js` nuevo o agregar a `TimezoneHelper.js`).
- HTML/CSS exacto del modal y posicionamiento del botón dentro del card existente.
- Cómo se loguea cada evento en Winston (sugerencia: `info` para auto-release exitoso, `warn` para force-release manual, `error` solo si el listener mismo falla).
- Si `_fireTimeout` es método privado (`#fireTimeout`) o regular underscore-prefixed.
- Naming exacto de campos del schema Joi para el body opcional.
- Tests: unit tests para timer arranca/cancela en acquireLock/releaseLock, lock:timeout evento se emite con shape correcto, endpoint retorna shape correcto en ambos casos (lock activo y sin lock), middleware orden correcto.

### Folded Todos

Ninguno — STATE.md tiene 2 todos generales que no aplican a Phase 18: el de uploadPayments 7-day lookback (PortalPaymentController) y partial payment completion. Ambos son scope de futuras phases o ajustes de PortalPaymentController, no del scheduler.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & Requirements (locked)
- `.planning/ROADMAP.md` — Phase 18 success criteria (líneas 44-63)
- `.planning/REQUIREMENTS.md` §Recovery — REC-01..REC-05 con texto literal de cada REQ

### Backend (a modificar)
- `src/services/OperationManager.js` — extender `acquireLock`/`releaseLock` con timer ref en slot, agregar método interno `_fireTimeout`, agregar evento `lock:timeout`
- `src/services/CronScheduler.js` — agregar listener `operationManager.on('lock:timeout', ...)` al boot del scheduler con addHistory + sendMail + log
- `src/routes/schedule-routes.js` — agregar handler `POST /:taskId/force-release` siguiendo patrón de `POST /:taskId/trigger`
- `src/routes/schemas/schedule-schemas.js` — agregar schema Joi para `forceReleaseSchema` (params + body opcional)
- `src/utils/EmailSender.js` — reutilizar `sendMail`; posiblemente extender el shape de `data` para subject custom (hoy hardcodeado a `${idCia} - ${data.h1}`)
- `src/config.js` — agregar `schedule.lockTimeoutMs` con default `14 * 60 * 1000` y env override `LOCK_TIMEOUT_MS`

### Frontend (a modificar)
- `public/schedule.html` — agregar botón "Forzar liberación" dentro del card "Operación en curso" (creado en Phase 17), agregar HTML del modal de confirmación (instanciado vía `new bootstrap.Modal`), agregar JS handler que llama al endpoint y refresca el card via polling
- `public/js/shared.js` — sin cambios mayores (reutilizar `formatRelative`, `apiCall`, `resolveApiKey`); posiblemente agregar `formatDurationMin` si se decide ponerlo aquí

### Tests (a crear)
- `tests/OperationManager.timer.test.js` — timer arranca en acquireLock, se cancela en releaseLock, se dispara después de LOCK_TIMEOUT_MS, evento `lock:timeout` se emite con shape correcto
- `tests/api/schedule-force-release.test.js` — endpoint con/sin lock activo, body opcional, validación, ResultEnvelope shape, idempotencia
- `tests/CronScheduler.timeout-listener.test.js` — listener registrado, addHistory + sendMail llamados con shape correcto cuando dispara `lock:timeout`

### Phase 17 (referencia, no modificar)
- `.planning/milestones/v2.3-phases/17-observability-diagnostics/17-CONTEXT.md` — D-01 (stepProgress shape), D-04 (response shape de `/api/operations/status`), D-05 (polling 5s + SSE pattern), D-07 (card "Operación en curso" layout)
- Phase 17 completó la base (`stepProgress`, card, polling, helpers); Phase 18 agrega el botón + endpoint + timer encima

### Codebase intel (referencia)
- `.planning/codebase/CONVENTIONS.md` — patrones de Express routing, ResultEnvelope, asyncHandler, validate middleware
- `.planning/codebase/ARCHITECTURE.md` §Always-On Patterns — contexto sobre por qué timer encapsulado es la decisión correcta
- `.planning/codebase/CONCERNS.md` §Always-On Cutover Debt — Phase 18 es exactamente el tipo de phase que CONCERNS.md advierte que toca primitivas long-lived; lecciones aprendidas aplican

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`OperationManager`** (`src/services/OperationManager.js`) — singleton EventEmitter ya usado para `progress:{operationId}`. Agregar evento `lock:timeout` extiende el patrón existente. Map de locks ya tiene la forma `{operationId, startedAt, stepProgress}` — agregar `timeoutHandle` es campo nuevo en el mismo slot.
- **`addHistory`** (OperationManager:145) — ring buffer 100 ya implementado; entry shape ya soporta arbitrary fields, agregar `stuckOnStep`/`stuckOnTenant` no rompe consumers existentes (solo `getHistory` los lee y no los filtra).
- **`sendMail`** (`src/utils/EmailSender.js`) — patrón existente con `data: {h1, p, status, message, position}`; subject está hardcodeado a `${idCia} - ${data.h1}`. Phase 18 puede pasar h1 directo como "Auto-timeout" / "Liberación manual" sin tocar EmailSender. Si necesitamos custom subject, extender shape en sendMail con `{subject?: string}` opcional.
- **`writeLimiter`** (`src/routes/schedule-routes.js:35`) — definido inline en schedule-routes.js (no en server.js para evitar circular dep); reutilizable directamente para el nuevo endpoint.
- **`requireApiKey + validate + asyncHandler + ResultEnvelope`** — middleware stack estándar; `POST /:taskId/trigger` (línea 108) es el template exacto a seguir para `POST /:taskId/force-release`.
- **Bootstrap 5.3 Modal** — patrón ya usado en otras páginas; se instancia con `const modal = new bootstrap.Modal('#forceReleaseModal'); modal.show()`. No hay framework JS — vanilla.

### Established Patterns

- **EventEmitter para side effects:** OperationManager emite `progress:{id}` para SSE; agregar `lock:timeout` es continuación natural. Listeners registrados al startup, no per-request.
- **Lazy-load de CronScheduler** (schedule-routes.js:27): patrón defensivo de Plan 02; el listener de `lock:timeout` debe registrarse en `CronScheduler.start()` o inicialización equivalente, NO en module load (para que el lazy-load no rompa).
- **Config con fail-fast** (`src/config.js`): agregar `schedule.lockTimeoutMs` sigue el patrón existente (lee env, valida número positivo, default sensato).
- **Polling-first UI hydration** (Phase 17 D-05): el polling 5s ya existe — el botón "Forzar liberación" se beneficia automáticamente; después del POST, el siguiente poll oculta el card y el modal cierra.
- **Joi schemas en `src/routes/schemas/`**: ya hay `triggerSchema`; agregar `forceReleaseSchema` al mismo archivo.

### Integration Points

- **Listener de `lock:timeout`:** debe registrarse en un solo lugar al startup. Candidato más natural: dentro de `CronScheduler.start()` antes del `cron.schedule(...)`. Requiere import explícito o uso del singleton ya importado.
- **Botón en card "Operación en curso":** card ya existe en `schedule.html` (Phase 17). Botón se inserta en el header del card-body, accionado por handler que llama a `apiCall('/api/schedule/background-cycle/force-release', { method: 'POST', body: { reason: '' } })`.
- **Modal HTML:** se agrega al final de `schedule.html` antes del `</body>` (patrón Bootstrap), separado del card para que la instanciación sea limpia.

</code_context>

<specifics>
## Specific Ideas

- **Defaults explícitos en CONTEXT:** `LOCK_TIMEOUT_MS = 14 * 60 * 1000` (14 min, 93% de cron 15 min). El requirement REC-01 lo especifica.
- **Subject del email "Auto-timeout":** `[SageConnect] Auto-timeout: lock <operationType> liberado después de <duración>` — formato consistente con LicenseValidator emails que ya existen en el sistema.
- **Mensaje del summary en history:** `Timeout — lock forzosamente liberado después de Xm` — copy literal del REC-02.
- **Mensaje del summary force-release:** `Lock forzado manualmente por operador` — copy literal del REC-05.
- **Config validation:** `lockTimeoutMs` debe ser positivo y > 60000 (1 min) para evitar configs accidentalmente agresivos. Fail-fast en config.js si está fuera de rango.

</specifics>

<deferred>
## Deferred Ideas

- **Operator identity tracking:** REC-04 podría capturar quién hizo force-release (operatorName en body), pero sin auth de usuario (solo x-api-key compartida) sería falsificable. Defer hasta que haya auth de usuario real (no roadmap actual).
- **Retry policy del email post-timeout:** si sendMail falla, no reintentar dentro de Phase 18 (solo log). Si esto se vuelve problema en prod, agregar retry queue como phase futura.
- **Persistencia de history a disco:** ring buffer en memoria; si el servicio reinicia se pierden las entries. Defer (REQUIREMENTS.md §Out of Scope explícitamente dice "los locks son estado volátil; restart del service es recovery válido").
- **Métricas de duración por step para tendencias:** REQUIREMENTS.md §Future Requirements; no para Phase 18.
- **Aborto del work activo (AbortController, child kill):** alcance de Phase 19 — explícitamente fuera de Phase 18.

</deferred>

---

*Phase: 18-auto-release-manual-override*
*Context gathered: 2026-04-28*
