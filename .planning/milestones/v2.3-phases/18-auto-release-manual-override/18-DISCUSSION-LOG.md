# Phase 18: Auto-release & Manual Override - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 18-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-28
**Phase:** 18-auto-release-manual-override
**Areas discussed:** Mecanismo del timer auto-release, Semántica del auto-release, Confirmación UI + visibilidad del botón, Endpoint design + paridad de email

---

## Mecanismo del timer auto-release

### Q1: ¿Dónde vive el setTimeout que dispara el auto-release tras LOCK_TIMEOUT_MS?

| Option | Description | Selected |
|--------|-------------|----------|
| Encapsulado en OperationManager (Recommended) | acquireLock arranca timer, releaseLock cancela. lock+timer son una sola unidad atómica | ✓ |
| En los callers (CronScheduler + schedule-routes) | Cada caller wrappea su propio setTimeout. OperationManager queda puro pero lógica duplicada | |
| Híbrido: hook callback en acquireLock | acquireLock acepta { onTimeout } callback. Manager arranca timer pero caller decide qué hacer | |

**User's choice:** Encapsulado en OperationManager
**Notes:** Decisión motivada por el riesgo always-on — un timer no-cleared filtra referencias indefinidamente. Encapsulación elimina ese bug class.

### Q2: Cuando el timer dispara dentro de OperationManager, ¿dónde vive la lógica de 'post-timeout' (addHistory + email + log)?

| Option | Description | Selected |
|--------|-------------|----------|
| EventEmitter (Recommended) | Emite evento 'lock:timeout', listener en CronScheduler hace addHistory + sendMail. OperationManager queda puro | ✓ |
| Inline en OperationManager | Manager llama directo addHistory + sendMail. Más lineal pero importa EmailSender (fuga de responsabilidad) | |
| Callback param en acquireLock | Cada caller pasa closure con qué hacer en timeout. Máxima flexibilidad pero duplica lógica | |

**User's choice:** EventEmitter
**Notes:** Continuación arquitectónica del patrón emitProgress de Phase 17.

---

## Semántica del auto-release

### Q3: Cuando timer dispara, ¿qué hacemos con el work en vuelo (axios cuelga, child process colgado, etc.)?

| Option | Description | Selected |
|--------|-------------|----------|
| Solo lock release — Phase 18 'lock-only' (Recommended) | Solo libera lock + emite evento. Promise original sigue corriendo, su .then es no-op. Phantom continuation aceptado | ✓ |
| Abortar work activo via AbortController | Lock release + abort axios + kill child. Pisa scope de Phase 19 (ROOT-01/02/03) | |
| Lock release + flag 'aborted' + suppress phantom history | Lock release + flag para que .then no llame addHistory. Complica callers, deja basura en memory | |

**User's choice:** Solo lock release
**Notes:** Phase 18 = lock recovery. Phase 19 = work prevention. Separación granular para rollback.

### Q4: ¿Qué metadata se guarda en la entry de history que registra el timeout (REC-02)?

| Option | Description | Selected |
|--------|-------------|----------|
| Mínimo + step donde se coló (Recommended) | summary del REQ + stuckOnStep + stuckOnTenant derivados del último open entry de stepProgress. Útil para diagnóstico inmediato | ✓ |
| Mínimo (sin step) | Solo el summary literal del REC-02. Operador tiene que ir a logs para diagnosticar | |
| Extendido con stepProgress completo | Snapshot completo del array. Pierde uniformidad de shape, infla ring buffer | |

**User's choice:** Mínimo + step donde se coló
**Notes:** Aprovecha la observability de Phase 17 sin inflar el shape.

---

## Confirmación UI + visibilidad del botón

### Q5: ¿Patrón de confirmación al hacer click en 'Forzar liberación'?

| Option | Description | Selected |
|--------|-------------|----------|
| Bootstrap modal (Recommended) | <div class="modal"> con título, body explicativo, botones Cancelar/Confirmar. Consistente con resto del UI | ✓ |
| confirm() nativo | window.confirm() simple pero feo, bloquea event loop, no permite copy custom | |
| Botón de dos pasos sin modal | Primer click revela botón rojo, segundo click ejecuta. Sin modal pero rompe consistencia | |

**User's choice:** Bootstrap modal
**Notes:** Consistente con modals existentes en payments.html.

### Q6: ¿Cuándo se muestra el botón 'Forzar liberación' dentro del card 'Operación en curso'?

| Option | Description | Selected |
|--------|-------------|----------|
| Siempre visible cuando hay lock activo (Recommended) | Botón aparece junto con el card. Auto-release a 14m + modal son los safeguards reales | ✓ |
| Solo después de threshold (>5m de duración) | Lógica client-side basada en startedAt; puede desincronizar con server clock | |
| Solo si último heartbeat es 'viejo' (>3m sin avance) | Más preciso pero algunos steps tardan naturalmente (uploadPayments) — riesgo de falsos positivos | |

**User's choice:** Siempre visible cuando hay lock activo
**Notes:** Simple, predecible, sin lógica de threshold que pueda fallar.

---

## Endpoint design + paridad de email

### Q7: ¿Shape del request/response del POST /api/schedule/:taskId/force-release?

| Option | Description | Selected |
|--------|-------------|----------|
| Body opcional {reason} + 200 con released:bool (Recommended) | reason max 200 chars Joi-validado. Idempotente: doble-click retorna 200+released:false, no 404 | ✓ |
| Body vacío + 200/404 | REST puro. Doble-click = 404 que parece error. Sin reason en audit | |
| Body {reason, operatorName} + 200/409 | Máxima auditoría. operatorName es falsificable (solo x-api-key compartida) | |

**User's choice:** Body opcional {reason} + 200 con released:bool
**Notes:** Idempotencia evita confusión cuando el sistema se recupera solo entre clicks.

### Q8: REC-02 pide email al admin en auto-release. REC-05 solo menciona audit log para force-release. ¿Enviamos email también en force-release?

| Option | Description | Selected |
|--------|-------------|----------|
| Sí, ambos disparan email (Recommended) | Severidad operativa equivalente. Subjects distintos para identificar causa | ✓ |
| Solo auto-release (REC-02 al pie de la letra) | Cumple requirement literal. History entries solas en ring buffer pueden borrarse | |
| Force-release con flag opcional ?notify=true | Operador decide caso por caso. Agrega complejidad UI y deja decisión en operador | |

**User's choice:** Sí, ambos disparan email
**Notes:** REC-05 extendido más allá del literal del requirement — paridad de visibilidad entre paths.

---

## Claude's Discretion

Durante la discusión NO se invocó "you decide" explícitamente, pero el usuario delegó a Claude:
- Naming exacto de helpers (`formatDurationMin` ubicación)
- HTML/CSS exacto del modal y del botón dentro del card
- Cómo se loguea en Winston cada evento (info/warn/error)
- Si `_fireTimeout` es método privado (`#fireTimeout`) o regular underscore-prefixed
- Naming exacto de campos del schema Joi para body opcional
- Tests específicos a escribir

## Deferred Ideas

- Operator identity tracking (sin auth de usuario es falsificable)
- Retry policy del email post-timeout
- Persistencia de history a disco
- Métricas de duración por step para tendencias
- Aborto del work activo via AbortController (Phase 19)
