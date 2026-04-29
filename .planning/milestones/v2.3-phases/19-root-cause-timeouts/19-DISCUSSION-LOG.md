# Phase 19: Root Cause Timeouts - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 19-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-28
**Phase:** 19-root-cause-timeouts
**Areas discussed:** Estrategia de timeout en axios, Mecanismo de kill del child process, Per-step timeout: boundary + aborto real, Logging + email parity con Phase 18

---

## Estrategia de timeout en axios (ROOT-01)

### Q1: Patrón de implementación del timeout en axios

| Option | Description | Selected |
|--------|-------------|----------|
| Cliente centralizado | Crear `src/utils/PortalClient.js` con `axios.create({ timeout, headers })` siguiendo el patrón LicenseValidator. Refactor de los 10 sites del path always-on a `portalClient.get/post/put`. +1 archivo nuevo, blast radius por archivo bajo, política unificada. | ✓ |
| Per-call inline | Agregar `{ timeout: ... }` como tercer arg en cada axios.get/post/put. Zero archivos nuevos pero 33 ediciones distintas (o 10 si solo path always-on). | |
| Híbrido | Cliente centralizado para JSON, per-call para stream download con timeout más generoso. | |

**User's choice:** Cliente centralizado
**Notes:** Match exacto al patrón LicenseValidator; el cliente compartido elimina la posibilidad de "olvidé poner timeout en el call site nuevo" bajo always-on.

### Q2: Qué archivos retrofitear con el nuevo timeout

| Option | Description | Selected |
|--------|-------------|----------|
| Solo path always-on | 10 sites del background-cycle: 7 controllers + 2 utils helpers. Los scripts/ CLI no acquiren lock — fuera del scope del bug 409. | ✓ |
| Always-on + scripts/ | Los 33 axios sites en todo `src/` incluyendo los 13 scripts CLI. Defense-in-depth pero refactor más grande. | |
| Solo controllers | Solo los 8 sites en `src/controller/*` — excluye utils. Compromiso mínimo pero deja una vía de cuelgue activa en GetTypesCFDI. | |

**User's choice:** Solo path always-on
**Notes:** Foco estricto en el bug que motivó la milestone. scripts/ CLI son extensión natural si en futuras milestones surge necesidad — el patrón centralizado los habilita sin cambios estructurales.

### Q3: Default de PORTAL_HTTP_TIMEOUT_MS

| Option | Description | Selected |
|--------|-------------|----------|
| 30s (literal REQUIREMENTS) | 30000 ms — match literal con REQUIREMENTS.md ROOT-01. Override via env si en prod resulta agresivo. | ✓ |
| 60s | 60000 ms — el portal de proveedores ha mostrado lentitud histórica; 60s da margen. Eleva el RTO efectivo. | |
| 45s | 45000 ms — intermedio. Sin precedente directo. | |

**User's choice:** 30s (literal REQUIREMENTS)
**Notes:** Match con el texto de la REQ. Si en prod resulta agresivo, override via env sin redeploy.

### Q4: Stream download (CFDI_Downloader.js:124) merece timeout distinto

| Option | Description | Selected |
|--------|-------------|----------|
| Mismo timeout (30s) | Aplicar el mismo PORTAL_HTTP_TIMEOUT_MS a todos los calls incluyendo streams. Un solo knob. ROOT-03 step-level (5 min) cubre como red de seguridad. | ✓ |
| Timeout más generoso (120s) | Env separado `PORTAL_DOWNLOAD_TIMEOUT_MS` (default 120000 / 2 min). Reconoce que streams pueden ser legítimamente largos. | |
| Sin timeout | Dejar el stream sin timeout explícito. ROOT-03 step-level (5 min) lo cubre. | |

**User's choice:** Mismo timeout (30s)
**Notes:** Simplicidad operacional. Si stream downloads grandes regularmente exceden 30s en prod, el env override permite ajustar; futura phase puede agregar `PORTAL_DOWNLOAD_TIMEOUT_MS` separado sin cambios estructurales.

---

## Mecanismo de kill del child process (ROOT-02)

### Q1: Mecanismo de kill

| Option | Description | Selected |
|--------|-------------|----------|
| SIGTERM + grace + taskkill | `childProcess.kill()` (SIGTERM) → 30s grace → `taskkill /F /T /PID` via exec si todavía corre. Cleanup limpio antes de kill duro. Defense-in-depth contra helpers spawneados. | ✓ |
| kill('SIGKILL') inmediato | Kill duro sin grace. Más simple, pero no permite cleanup limpio (FDs, buffers). | |
| taskkill /F /T directo | Shell-out de entrada. Garantiza process tree kill. Bypass del child_process kill que puede fallar con GUI procs en Windows. | |

**User's choice:** SIGTERM + grace + taskkill
**Notes:** Da chance al exe de cerrar limpio antes del kill duro. /T mata el árbol entero — match con `Stop-Process -Force` de Servy.

### Q2: Arquitectura del kill (timer vs race vs abort)

| Option | Description | Selected |
|--------|-------------|----------|
| setTimeout + kill | Timer dentro del Promise constructor existente. clearTimeout en close/error listeners. Mantiene firma actual. | ✓ |
| Promise.race afuera | Wrap startChildProcess en Promise.race desde caller. Cambio estructural mayor. | |
| AbortController + signal | Pattern moderno alineable con axios v0.22+. Refactor de signature de startChildProcess. | |

**User's choice:** setTimeout + kill
**Notes:** Minimal blast radius. Timer + flag hasSettled es suficiente para evitar double-settle.

### Q3: Default de CHILD_PROCESS_TIMEOUT_MS

| Option | Description | Selected |
|--------|-------------|----------|
| 10 min (literal REQUIREMENTS) | 600000 ms — match literal. Effective ≈ 10m 30s con grace; bajo los 14 min del lock auto-release. | ✓ |
| 20 min | 1200000 ms — más margen para lotes grandes. Riesgo: el lock auto-release dispararía primero. | |
| 12 min (alineado con lock) | 720000 ms — ligeramente bajo los 14 min. Garantiza orden child kill → finally → releaseLock natural. | |

**User's choice:** 10 min (literal REQUIREMENTS)
**Notes:** Match con la REQ. 10m 30s effective queda comfortably bajo 14 min lock auto-release.

### Q4: Cómo settla el Promise tras el kill

| Option | Description | Selected |
|--------|-------------|----------|
| Reject con error timeout | `reject(new Error('Child process timeout after Xm — killed'))`. Caller registra en endStep + log. | ✓ |
| Resolve con null/código especial | Resolve(null) o resolve(-1). Evita unhandled rejections pero pierde stack/context. | |
| Reject + no esperar 'close' | Reject inmediato sin esperar close. Riesgo de Unhandled Promise Rejection. | |

**User's choice:** Reject con error timeout
**Notes:** Semantics claras: timeout = error. Flag hasSettled previene double-settle si close dispara post-kill.

---

## Per-step timeout: boundary + aborto real (ROOT-03)

### Q1: Boundary cuando el step timeout dispara

| Option | Description | Selected |
|--------|-------------|----------|
| Skip al siguiente tenant | throw → tenant-catch existente (background.js:145) → break al siguiente tenant. Cero código nuevo. | ✓ |
| Skip al siguiente step | Log + endStep con error → NO throw, continúa al siguiente step. Riesgo: pasos posteriores pueden depender del estado del paso colgado. | |
| Configurable vía env | `STEP_TIMEOUT_BEHAVIOR=skip-tenant\|skip-step`. Más flexibilidad pero deuda operacional. | |

**User's choice:** Skip al siguiente tenant
**Notes:** Match con boundary actual. Steps posteriores del mismo tenant pueden operar sobre estado parcial — skip-tenant es la elección segura.

### Q2: Promise.race solo o AbortController real

| Option | Description | Selected |
|--------|-------------|----------|
| Promise.race solo (phantom) | Rechaza pero la promesa original sigue corriendo. axios timeout (ROOT-01, 30s) es la red de seguridad real. Blast radius mínimo. | ✓ |
| AbortController real | Refactor de signature en 10 controllers/utils para `signal: AbortSignal`. Elimina phantom completa pero invasivo. | |
| Híbrido (race + axios timeout) | Mismo en práctica que (a) pero documenta explícitamente la red de defensa. | |

**User's choice:** Promise.race solo (phantom)
**Notes:** Phantom continuation tolerada igual que Phase 18 D-03. axios timeout corta HTTP requests colgadas en 30s — es el aborto real. AbortController defer hasta evidencia operacional de problemas concretos.

### Q3: Default de STEP_TIMEOUT_MS

| Option | Description | Selected |
|--------|-------------|----------|
| 5 min (literal REQUIREMENTS) | 300000 ms — match literal. Cubre step con ~10 axios calls en serie con timeout 30s c/u. | ✓ |
| 7 min | 420000 ms — más margen pero excede ratio con lock auto-release de 14 min. | |
| 10 min | 600000 ms — muy generoso, supera ampliamente lock auto-release con N tenants. | |

**User's choice:** 5 min (literal REQUIREMENTS)
**Notes:** Match con la REQ. Override via env. Constraint operacional documentada: STEP_TIMEOUT × numSteps × numTenants debería caber bajo lockTimeoutMs.

### Q4: Qué steps cubrir con timeout

| Option | Description | Selected |
|--------|-------------|----------|
| Los 7 steps de tenant | buildProvidersXML, downloadCFDI, checkPayments, uploadPayments, createPurchaseOrders, processOrderChanges, closePurchaseOrders. NO startChildProcess (cubierto por ROOT-02). | ✓ |
| Los 7 + startChildProcess | Doble timeout: race entre 5 min step y 10 min child kill. Step dispara primero, child queda huérfano. Confuso. | |
| Solo steps con axios | Prácticamente equivalente a (a) — los 7 todos usan axios. Más framing que decisión. | |

**User's choice:** Los 7 steps de tenant
**Notes:** Match exacto con instrumentación Phase 17 D-11. startChildProcess queda bajo ROOT-02 con su timer dedicado.

---

## Logging + email parity con Phase 18 (ROOT-04)

### Q1: Formato del log entry de timeout

| Option | Description | Selected |
|--------|-------------|----------|
| Plain text con [TIMEOUT] prefix | `[TIMEOUT] step=X tenant=Y url=Z durationMs=N`. Match con patrón Phase 18. Operadores grep `\[TIMEOUT\]`. | ✓ |
| JSON estructurado | Mejor para parsing automático pero codebase no usa structured logging hoy. | |
| Plain text + Winston metadata | Mejor de ambos pero requiere verificar que LogGenerator wrapper soporta segundo arg. | |

**User's choice:** Plain text con [TIMEOUT] prefix
**Notes:** Match con [ADMIN-EMAIL], [OVERLAP], [FORCE-RELEASE-NOOP] de Phase 18. Plain ASCII, zero deps, grepeable.

### Q2: A qué archivos van los logs de timeout

| Option | Description | Selected |
|--------|-------------|----------|
| Distribuido (existente) | ROOT-01 → log del caller (ForResponse o controller-specific). ROOT-02 → ChildProcess.log + CronScheduler.log. ROOT-03 → ForResponse.log. Match con patrón por dominio. | ✓ |
| Centralizado en Timeouts.log | Un solo archivo. Operador busca en un solo lugar pero rompe el patrón del proyecto. | |
| Distribuido + replicado en CronScheduler.log | Doble write con prefix [TIMEOUT-AGGREGATE]. Costo: doble write. | |

**User's choice:** Distribuido (existente)
**Notes:** Match con patrón de logs por dominio. Cada LOG_FILE constant ya está definido en cada archivo — refactor mínimo.

### Q3: Email al admin en cada timeout

| Option | Description | Selected |
|--------|-------------|----------|
| Solo en child timeout (ROOT-02) | sendAdminAlert solo cuando child kill dispara (raro y crítico). axios/step timeouts solo logs. | ✓ |
| Email en todos los timeouts | Paridad total con Phase 18. Riesgo: alert fatigue, inbox flood en blips de red. | |
| Solo logs (sin email) | Cero emails. Operador depende del dashboard / tail -f. Pierde señal crítica del child timeout. | |
| Email agregado por cycle | Buffer dentro de cycle, flush al final con summary. Reduce ruido + visibilidad pero más complejo. | |

**User's choice:** Solo en child timeout (ROOT-02)
**Notes:** Child timeout = `ImportaFacturasFocaltec.exe colgado bajo Servy` = exactamente el escenario que motivó la milestone. axios y step timeouts son frecuentes en condiciones transitorias — email por cada uno = ruido. Reusa sendAdminAlert helper inline (Phase 18 D-08).

### Q4: Qué contexto incluir en el log entry

| Option | Description | Selected |
|--------|-------------|----------|
| step + tenant + URL + duration | Lo que la REQ literalmente pide. Mínimo necesario para diagnosticar y reproducir. | ✓ |
| + operationId + cycle startedAt | Útil para correlacionar timeouts con history del cycle. Costo: 2 campos extra. | |
| + stack trace abreviado | Stacks de timeout en setTimeout/Promise.race son poco informativos. | |

**User's choice:** step + tenant + URL + duration
**Notes:** Match exacto con la REQ. operationId/stack quedan en Claude's Discretion del planner si surge necesidad fácil de capturar.

---

## Claude's Discretion

- Naming exacto del helper `withStepTimeout(promiseFn, ms, label)` — agregar a `src/utils/duration.js` o inline en `background.js`.
- Ubicación del cliente `portalClient` — `src/utils/PortalClient.js` propuesto, pero `src/services/` también defendible.
- Validación fail-fast de los nuevos env vars — rangos sugeridos (axios > 1000ms, child > 60000ms, step > 30000ms) ajustables.
- Si el `setTimeout` del stepTimeoutPromise debe usar `unref()` para no mantener event loop alivo.
- Tests: unit tests para PortalClient, startChildProcess timeout, Promise.race step timeout, integration test de timeout-logging.
- Si emails de ROOT-02 reusan template HTML de Phase 18 (consistencia visual) o tienen propio.

## Deferred Ideas

- AbortController retrofit completo de los controllers/utils — defer hasta evidencia operacional de problemas concretos por phantom continuation.
- Timeouts en los 13+ scripts CLI de `src/scripts/*` — fuera del scope del bug 409.
- Email agregado por cycle — defer hasta demanda explícita.
- Logs estructurados (JSON) — defer a una phase de logging refactor si surge necesidad de Splunk/ELK.
- Operator identity tracking — defer hasta auth de usuario real.
- Métricas de duración por step para tendencias — listada en REQUIREMENTS.md Future Requirements.
- Per-step `unref()` en setTimeout — defer hasta que se observe el problema bajo always-on.
- Streaming download timeout dedicado (`PORTAL_DOWNLOAD_TIMEOUT_MS`) — defer hasta observación de stream downloads grandes excediendo 30s en prod.
