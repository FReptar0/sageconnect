# Phase 19: Root Cause Timeouts - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Prevenir que el `background-cycle` se cuelgue agregando timeouts explícitos en las tres fuentes de hangs identificadas en el análisis de raíz del bug "Ejecutar Ahora 409 permanente":

1. **Axios al portal de proveedores** (ROOT-01) — todos los `axios.get/post/put` del path always-on tienen timeout default 30s, configurable via env `PORTAL_HTTP_TIMEOUT_MS`.
2. **Child process del importador** (ROOT-02) — `startChildProcess` en `src/background.js` mata `ImportaFacturasFocaltec.exe` si no termina en 10 min default, configurable via env `CHILD_PROCESS_TIMEOUT_MS`.
3. **Per-step en `forResponse`** (ROOT-03) — cada uno de los 7 steps por tenant tiene timeout default 5 min via `Promise.race`, configurable via env `STEP_TIMEOUT_MS`.

Plus logging estructurado de cada timeout (ROOT-04) con contexto (step, tenant, URL, duración) en los logs por dominio existentes.

**Esta phase REEMPLAZA la "phantom continuation" tolerada en Phase 18 D-03** con verdaderas semánticas de aborto: el axios timeout fija un brake real en HTTP requests colgadas, el child kill mata procesos huérfanos bajo Servy, y el per-step Promise.race pone una cota superior a steps individuales del ciclo. Combinados con el lock auto-release de Phase 18, el sistema ahora se recupera ANTES de que el lock se trabe (prevention) en lugar de DESPUÉS (recovery).

**Phase 19 NO** introduce AbortController retrofit en controllers, ni modifica los 13+ scripts CLI en `src/scripts/*` (no acquiren locks, fuera del scope del bug 409). Tampoco toca el flujo de manual-trigger (`schedule-routes.js:129` ya no se llama directo a forResponse — usa el cron path mismo desde Plan 17-04). El alcance es estrictamente el path always-on del background-cycle.

</domain>

<decisions>
## Implementation Decisions

### ROOT-01 — Axios timeout (path always-on)

#### D-01: Cliente centralizado en `src/utils/PortalClient.js`

Crear nuevo archivo `src/utils/PortalClient.js` que exporta un cliente axios pre-configurado:

```js
const axios = require('axios');
const config = require('../config');

const portalClient = axios.create({
    timeout: config.portal.httpTimeoutMs,
    headers: { 'Accept': 'application/json' },
});

module.exports = portalClient;
```

Match exacto al patrón de `src/services/LicenseValidator.js:49` (`licenseClient = axios.create({ timeout: HTTP_TIMEOUT_MS })`). Refactor de los 10 call sites del path always-on para reemplazar `axios.get/post/put` con `portalClient.get/post/put`. Política de timeout unificada cambiable en un solo lugar.

**Justificación always-on:** un cliente compartido elimina la posibilidad de "olvidé poner timeout en el call site nuevo". Bajo always-on, el costo de un solo axios sin timeout es un lock huérfano cada cron tick — el patrón centralizado previene esa regresión a nivel arquitectónico.

#### D-02: Alcance del refactor — solo path always-on

10 call sites a modificar:
- `src/controller/CFDI_Downloader.js` — 3 sites (líneas 107, 124, 159)
- `src/controller/PortalPaymentController.js` — 1 site (línea 286)
- `src/controller/PortalOC_Creator.js` — 1 site (línea 267)
- `src/controller/PortalOC_Closer.js` — 1 site (línea 90)
- `src/controller/PortalOC_Canceller.js` — 1 site (línea 74)
- `src/controller/PortalOC_ContentUpdater.js` — 1 site (línea 132)
- `src/controller/PortalOC_StatusUpdater.js` — 1 site (línea 90)
- `src/utils/GetTypesCFDI.js` — 7 sites (líneas 21, 46, 123, 201, 309, 402, 468)
- `src/utils/GetProviders.js` — 2 sites (líneas 28, 75)

(Total efectivo: 18 axios calls, distribuidos en 9 archivos.)

**Out of scope para Phase 19:** los 13+ axios sites en `src/scripts/*` (CLI manual: `payment-uuid-repair`, `portal-payments-generator`, `mark-payment-invoices-paid`, `payment-status-check`, `po-upload`, `po-update`, `payment-reconciliation`, `upload-authorized-pos`, `upload-single-payment`, `get-payment-cfdis`). Los scripts CLI no acquiren lock — fuera del scope del bug 409 que motivó la milestone v2.3. Si en futuras milestones surge necesidad, el patrón centralizado los habilita sin cambios estructurales.

`src/services/PortalOC_StatusService.js:69` y `src/services/LicenseValidator.js:49` quedan intactos: el primero es legacy reemplazado por StatusUpdater (ver memory `feedback_team_context`), el segundo ya tiene su propio cliente axios con timeout dedicado (HTTP_TIMEOUT_MS).

#### D-03: Default `PORTAL_HTTP_TIMEOUT_MS = 30000` (30s)

Match literal con el texto de REQ ROOT-01. Override via env `PORTAL_HTTP_TIMEOUT_MS` si en producción resulta agresivo. Validación fail-fast en `config.js`: valor debe ser número positivo > 1000ms (similar al guard de `LOCK_TIMEOUT_MS` que rechaza < 60000ms; ROOT-01 acepta valores menores porque axios timeout puede legítimamente ser sub-segundo en pruebas).

Lectura via `config.portal.httpTimeoutMs` siguiendo el pattern de `config.schedule.lockTimeoutMs` (`parseInt(process.env.PORTAL_HTTP_TIMEOUT_MS, 10) || 30000`).

#### D-04: Stream download (`CFDI_Downloader.js:124`) usa el mismo timeout

`portalClient.get(url, { responseType: 'stream' })` con el mismo `PORTAL_HTTP_TIMEOUT_MS = 30s`. Un solo knob de configuración, simplicidad operacional. ROOT-03 step-level timeout (5 min) cubre como red de seguridad si el stream tarda legítimamente más que 30s en condiciones reales. Si en producción se observa que stream downloads grandes regularmente exceden 30s, el override via env permite ajustar sin redeploy.

### ROOT-02 — Child process kill (background.js)

#### D-05: SIGTERM + 30s grace + `taskkill /F /T` fallback

Mecanismo de kill en cascada para `ImportaFacturasFocaltec.exe`:

1. `childProcess.kill()` (SIGTERM en Unix; en Windows, Node lo mapea internamente a un exit signal).
2. Esperar grace period **30s** (`GRACE_PERIOD_MS = 30000`, hardcoded — no env knob para no inflar la superficie de configuración).
3. Si `childProcess.exitCode === null` después de 30s, ejecutar `taskkill /F /T /PID <pid>` via `child_process.exec`.

Da chance al exe de cerrar limpio (releases file handles, flushes buffers) antes del kill duro. Defense-in-depth contra helpers spawneados por el exe (`/T` mata el árbol entero — match con la semántica de `Stop-Process -Force` que usa el PowerShell de Servy en `scripts/Rotate-SageConnectLogs.ps1`).

#### D-06: Arquitectura — `setTimeout(kill, ...)` dentro del Promise constructor

```js
function startChildProcess() {
    return new Promise((resolve, reject) => {
        let hasSettled = false;
        const settle = (fn) => {
            if (hasSettled) return;
            hasSettled = true;
            fn();
        };

        const childProcess = spawn(config.app.importRoute, [config.app.arg]);

        const killTimer = setTimeout(() => {
            childProcess.kill(); // SIGTERM
            const graceTimer = setTimeout(() => {
                if (childProcess.exitCode === null) {
                    exec(`taskkill /F /T /PID ${childProcess.pid}`);
                }
            }, 30000);
            settle(() => reject(new Error(`Child process timeout after ${formatDurationMin(config.schedule.childProcessTimeoutMs)} — killed`)));
        }, config.schedule.childProcessTimeoutMs);

        childProcess.on('close', (code) => {
            clearTimeout(killTimer);
            settle(() => code === 0 ? resolve(code) : reject(new Error(`Child process failed with code ${code}`)));
        });
        childProcess.on('error', (error) => {
            clearTimeout(killTimer);
            settle(() => reject(error));
        });
        // (existing stdout/stderr listeners preserved)
    });
}
```

**Justificación:**
- Timer DENTRO del Promise constructor — mantiene la firma actual `Promise<code|null>` sin requerir refactor del caller (`CronScheduler.js:80` paso `startChildProcess`).
- `clearTimeout(killTimer)` en listeners `close`/`error` previene fire-after-resolve.
- Flag `hasSettled` evita double-settle: si `close` dispara durante el grace period del kill, no rejecta dos veces.
- Reusa `formatDurationMin` de `src/utils/duration.js` (Plan 18-01).

No se usa Promise.race afuera (cambio estructural mayor en CronScheduler.js) ni AbortController (refactor de signature). El timer + flag es minimal blast radius.

#### D-07: Default `CHILD_PROCESS_TIMEOUT_MS = 600000` (10 min)

Match literal con el texto de REQ ROOT-02. Effective ≈ 10m 30s incluyendo el grace period — comfortably bajo los 14 min del lock auto-release de Phase 18, garantizando que el child kill dispare ANTES que el lock release. Override via env. Validación fail-fast: > 60000ms (mínimo 1 min para evitar misconfigs).

Lectura via `config.schedule.childProcessTimeoutMs` siguiendo el pattern existente.

#### D-08: Reject con error descriptivo tras kill

```js
reject(new Error(`Child process timeout after ${formatDurationMin(config.schedule.childProcessTimeoutMs)} — killed`));
```

Caller (`CronScheduler.js` paso `startChildProcess`) atrapa en el `try/catch/finally` del step y registra:
- `emitter.endStep('background-cycle', 'startChildProcess', null, { error: err.message })` (Phase 17 D-12).
- `logGenerator('ChildProcess', 'error', '[TIMEOUT] step=startChildProcess durationMs=...')` (ROOT-04 D-13).
- Email al admin via `sendAdminAlert(...)` (ROOT-04 D-15 — único timeout que dispara email).

`hasSettled` protege contra double-settle si el `close` listener dispara durante grace period (proceso terminó por su cuenta entre el SIGTERM y el taskkill — no debe rechazar dos veces).

### ROOT-03 — Per-step timeout (forResponse)

#### D-09: Boundary — skip al siguiente tenant

Step timeout → throw → propaga al tenant-catch existente en `background.js:145` → break al siguiente tenant. **Cero código nuevo de control flow.** Match con el boundary de error handling actual: cualquier error en un step ya hace skip al siguiente tenant; agregar timeout no cambia esa semántica.

Interpretación de la REQ ROOT-03 ("no aborta los siguientes — continúa con el siguiente tenant"): "los siguientes" se refiere a tenants, no steps. Los steps posteriores del mismo tenant se saltan porque pueden depender del estado del paso colgado (e.g., `checkPayments` después de un `downloadCFDI` colgado podría operar sobre estado parcial). Skip-tenant es la elección segura.

#### D-10: Promise.race solo — phantom continuation tolerada

```js
const stepTimeoutMs = config.schedule.stepTimeoutMs;
const stepTimeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Step timeout after ${formatDurationMin(stepTimeoutMs)}`)), stepTimeoutMs)
);
await Promise.race([stepFn(i), stepTimeoutPromise]);
```

**Phantom continuation aceptada:** si el step timeout dispara, el `Promise.race` rechaza pero la promesa original sigue corriendo en background. Igual tolerancia que Phase 18 D-03. Mitigación real:
- ROOT-01 axios timeout (30s) corta HTTP requests colgadas — el work HTTP en vuelo SÍ se aborta vía la red de seguridad de axios.
- El siguiente cron tick (15 min) trae un nuevo cycle limpio.
- El lock auto-release de Phase 18 (14 min) cubre el caso patológico donde la phantom promise nunca termine.

**No se introduce AbortController:** el refactor para pasar `signal: AbortSignal` a los 10 controllers/utils es invasivo (signature changes) y aporta marginalmente sobre el axios timeout. Defer hasta que evidencia operacional muestre que la phantom continuation causa problemas concretos (resource accumulation, memory leaks). Phase 19 mantiene blast radius mínimo.

**timer cleanup:** el `setTimeout` del stepTimeoutPromise NO se cancela explícitamente cuando `stepFn(i)` resuelve primero — Node lo limpia cuando el Promise se garbage collecta. Si esto causa "timer leaks" detectables bajo always-on, la mitigación es agregar `clearTimeout` explícito en un `.then(()=> clearTimeout(handle))` o switching a `unref()`.

#### D-11: Default `STEP_TIMEOUT_MS = 300000` (5 min)

Match literal con el texto de REQ ROOT-03. Cubre un step con hasta ~10 axios calls en serie con timeout 30s c/u (10 × 30s = 5 min). Override via env. Validación fail-fast: > 30000ms (30s mínimo para evitar timeouts triviales que disparen falso positivo en cada cycle).

Lectura via `config.schedule.stepTimeoutMs`.

**Constraint operacional (no validation, solo doc):** `STEP_TIMEOUT_MS × numSteps × numTenants` debería caber bajo `LOCK_TIMEOUT_MS` (14 min). Con defaults: 5min × 7 steps × 1 tenant = 35 min — excede los 14 min porque el caso patológico es "todos los steps llegan al límite". En la práctica, los timeouts disparan secuencialmente y el lock auto-release los cubre. Documentar este edge case en CONCERNS.md / runbook si aplica.

#### D-12: Alcance — solo los 7 steps de tenant en `forResponse`

Steps con timeout: `buildProvidersXML`, `downloadCFDI`, `checkPayments`, `uploadPayments`, `createPurchaseOrders`, `processOrderChanges`, `closePurchaseOrders`. Match exacto con la instrumentación de Phase 17 D-11 (cada step ya está envuelto en bloque `{ const __step; let __stepError; try { ... } catch { ...; throw stepErr; } finally { endStep } }` — agregar Promise.race es agregar un wrapper más alrededor del `await stepFn(i)`).

**NO incluye `startChildProcess`** (cubierto por ROOT-02 con su propio timer dedicado de 10 min). Doble timeout = race entre el step timeout 5 min y el child timeout 10 min — el step timeout dispararía primero y dejaría el child huérfano. Confuso operacionalmente. Por eso `startChildProcess` queda exclusivamente bajo ROOT-02.

El delay de 5s entre steps (`config.schedule.operationDelayMs`) tampoco se envuelve — es una pausa intencional, no un work item.

### ROOT-04 — Logging + email

#### D-13: Plain text con prefijo `[TIMEOUT]`

```js
logGenerator(LOG_FILE, 'error', `[TIMEOUT] step=${step} tenant=${tenant ?? 'global'} url=${url ?? 'n/a'} durationMs=${durationMs}`);
```

Match con el patrón de Phase 18 (`[ADMIN-EMAIL]`, `[OVERLAP]`, `[FORCE-RELEASE-NOOP]`, `[TIMEOUT]` ya usado por Plan 18-01 listener). Plain ASCII, zero deps, grepeable: operadores corren `grep "\[TIMEOUT\]" logs/CronScheduler-*.log` para inspección rápida.

No JSON estructurado (codebase no usa logs estructurados; introducirlo aquí sería inconsistencia). No metadata Winston (LogGenerator wrapper no soporta el segundo arg hoy — verificar antes de plan).

#### D-14: Logs distribuidos a archivos por dominio

- ROOT-01 axios timeout disparado dentro de un controller/util → log del caller usa su `LOG_FILE` constant existente:
  - `CFDI_Downloader.js` → `'CFDI_Downloader'` log
  - `GetTypesCFDI.js` → `'GetTypesCFDI'` log
  - etc.
- ROOT-02 child timeout → `logGenerator('ChildProcess', 'error', '[TIMEOUT] ...')` Y `logGenerator('CronScheduler', 'error', '[TIMEOUT] step=startChildProcess ...')` (paridad con `endStep` que también va a CronScheduler.log).
- ROOT-03 step timeout → `logGenerator('ForResponse', 'error', '[TIMEOUT] step=... tenant=... durationMs=...')`.

Match con el patrón actual de logs por dominio. Cada `LOG_FILE` constant ya está definido en cada archivo. No se crea un `Timeouts.log` centralizado (rompería el patrón).

#### D-15: Email al admin solo en child timeout (ROOT-02)

`sendAdminAlert(subject, html)` (helper inline en `CronScheduler.js:46-70`, Phase 18 D-08) se invoca **solo** cuando ROOT-02 dispara el kill del child process. Subject y body siguiendo el patrón de Phase 18:

```
Subject: [SageConnect] Child process timeout: ImportaFacturasFocaltec.exe killed después de Xm
Body: HTML con PID, duración, ruta del exe, timestamp
```

**axios timeouts (ROOT-01) y step timeouts (ROOT-03) NO disparan email.** Razones:
- Frecuencia esperada: en condiciones de red transitorias, un blip puede generar 5-10 axios timeouts en un cycle. Email por cada uno = inbox flood + alert fatigue del admin.
- Severidad relativa: un axios timeout es un "tenant fail this cycle, recovers next cycle". Un step timeout es similar. Un child timeout es "el importador colgado bajo Servy" — es exactamente el escenario que motivó el milestone v2.3.
- Visibilidad alternativa: los logs distribuidos cubren la inspección post-mortem; el dashboard de schedule.html (Phase 17) muestra heartbeats en tiempo real.

No se implementa "email agregado por cycle" — añade buffer + flush hook complejos. Si en producción se observa que axios/step timeouts merecen visibilidad email, considerar una phase futura con buffer.

`sendAdminAlert` ya swallows email failures (`try/catch + warn log`) — consistente con Phase 18 (email no debe bloquear recovery flow).

#### D-16: Contexto del log entry — step + tenant + URL + duration

Match con lo que la REQ ROOT-04 literalmente pide. Mínimo necesario para diagnosticar y reproducir:
- `step`: nombre del step (`downloadCFDI`, `uploadPayments`, etc., o `startChildProcess` para ROOT-02).
- `tenant`: tenant id, o `'global'` si null (startChildProcess es global).
- `url`: la URL del axios call, o `'n/a'` si no aplica (e.g., child process timeout).
- `durationMs`: tiempo desde inicio del step/call hasta el dispatch del timeout.

`operationId` y `cycleStartedAt` quedan en Claude's Discretion del planner — útiles para correlacionar timeouts con la entry de history del cycle, pero agregan 2 campos extra por log line. Si el planner los considera valor agregado bajo o fácil de capturar, OK; si requieren refactor de la firma, defer.

Stack traces NO se incluyen — los stacks de timeout en `setTimeout`/Promise.race apuntan al timer, no al call site origen, dando información poco útil.

### Claude's Discretion

- Naming exacto del helper que envuelve `Promise.race` para steps (sugerencia: agregar `withStepTimeout(promiseFn, ms, label)` a `src/utils/duration.js` para reutilización; o inline en `background.js`).
- Ubicación del cliente `portalClient` — `src/utils/PortalClient.js` propuesto, pero `src/services/` también es defendible (LicenseValidator está en services). El planner decide según el patrón que mejor encaje.
- Validación fail-fast de los nuevos env vars en `config.js` — los rangos sugeridos son razonables (axios > 1000ms, child > 60000ms, step > 30000ms) pero el planner puede ajustarlos.
- Si el `setTimeout` del stepTimeoutPromise debe usar `unref()` para no mantener el event loop alivo cuando todos los steps terminaron.
- Tests: unit tests para PortalClient (timeout config), unit tests para startChildProcess timeout (jest fake timers + spy en kill/exec), unit tests para Promise.race step timeout, integration test que verifica un timeout dispara endStep + log + email-only-for-child.
- Si los emails de ROOT-02 reusan exacto el patrón HTML de Phase 18 lock-timeout email (consistencia visual) o tienen su propio template.

### Folded Todos

Ninguno. STATE.md menciona "Refactor `scripts/obfuscate.js` allowlist → blocklist" y "uploadPayments 7-day lookback" — ambos son fuera del scope de Phase 19 (timeouts). El allowlist refactor podría ser bundled en un pre-merge cleanup pero no pertenece a ROOT-XX.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & Requirements (locked)
- `.planning/ROADMAP.md` §Phase 19 — Success criteria líneas 71-89 (4 escenarios verificables: portal no responde → axios aborta 30s, child colgado → kill 10 min, logs muestran context, ciclo normal sin regresiones)
- `.planning/REQUIREMENTS.md` §Root Cause Prevention — ROOT-01..ROOT-04 con texto literal de cada REQ + traceability table que fija la mappear cada REQ a Phase 19

### Backend (a modificar)
- `src/utils/PortalClient.js` — **NUEVO** archivo, exporta `portalClient = axios.create({ timeout: config.portal.httpTimeoutMs, headers })`. Patrón referencia: `src/services/LicenseValidator.js:49`
- `src/controller/CFDI_Downloader.js` — refactor 3 axios.get sites (líneas 107, 124 stream, 159) a portalClient
- `src/controller/PortalPaymentController.js` — refactor 1 axios.post site (línea 286)
- `src/controller/PortalOC_Creator.js` — refactor 1 axios.post site (línea 267)
- `src/controller/PortalOC_Closer.js` — refactor 1 axios.put site (línea 90)
- `src/controller/PortalOC_Canceller.js` — refactor 1 axios.put site (línea 74)
- `src/controller/PortalOC_ContentUpdater.js` — refactor 1 axios.put site (línea 132)
- `src/controller/PortalOC_StatusUpdater.js` — refactor 1 axios.put site (línea 90)
- `src/utils/GetTypesCFDI.js` — refactor 7 axios.get sites (líneas 21, 46, 123, 201, 309, 402, 468)
- `src/utils/GetProviders.js` — refactor 2 axios.get sites (líneas 28, 75)
- `src/background.js` — agregar `setTimeout + kill + clearTimeout + hasSettled` en `startChildProcess` (línea 280); envolver cada uno de los 7 step `await stepFn(i)` en `Promise.race` con `stepTimeoutPromise`
- `src/services/CronScheduler.js` — listener de step `startChildProcess` actualiza `endStep + logGenerator('[TIMEOUT]', 'ChildProcess')` + dispara `sendAdminAlert` cuando el child timeout dispara (reusa helper inline existente, Phase 18 D-08)
- `src/utils/duration.js` — opcionalmente agregar `withStepTimeout(promiseFn, ms, label)` helper si el planner decide extraer del inline
- `src/config.js` — agregar `config.portal.httpTimeoutMs` (default 30000, env `PORTAL_HTTP_TIMEOUT_MS`), `config.schedule.childProcessTimeoutMs` (default 600000, env `CHILD_PROCESS_TIMEOUT_MS`), `config.schedule.stepTimeoutMs` (default 300000, env `STEP_TIMEOUT_MS`); validación fail-fast en cada uno

### Tests (a crear)
- `tests/utils/PortalClient.test.js` — verifica timeout config aplicado, headers presentes, instancia cacheada (no re-create por call)
- `tests/services/background.startChildProcess.timeout.test.js` — jest fake timers + spy en `child_process.spawn` mock; verifica setTimeout arma → kill SIGTERM → grace 30s → exec taskkill → reject con error timeout. Idempotente con close listener.
- `tests/services/background.forResponse.stepTimeout.test.js` — Promise.race rechaza después de STEP_TIMEOUT_MS; tenant-catch atrapa; siguiente tenant continúa; endStep registra error
- `tests/services/CronScheduler.timeout-listener.test.js` — extender existente: child timeout dispara sendAdminAlert; axios/step timeouts NO disparan email
- `tests/integration/timeout-logging.test.js` — un timeout en cada path (axios mock + child mock + step mock) genera entries `[TIMEOUT]` en sus respectivos LOG_FILE con context completo

### Phase 17/18 (referencia, no modificar)
- `.planning/milestones/v2.3-phases/17-observability-diagnostics/17-CONTEXT.md` D-11 — instrumentación per-step ya implementada (`{ const __step; let __stepError; try { ... } catch { ...; throw stepErr; } finally { endStep } }`); ROOT-03 envuelve el `await stepFn(i)` interno con Promise.race sin tocar la estructura externa
- `.planning/milestones/v2.3-phases/18-auto-release-manual-override/18-CONTEXT.md` D-03 — phantom continuation tolerada; ROOT-01 axios timeout es la mitigación real para el work HTTP en vuelo
- `.planning/milestones/v2.3-phases/18-auto-release-manual-override/18-CONTEXT.md` D-08 — `sendAdminAlert(subject, html)` helper inline en `CronScheduler.js:46-70` reusable para ROOT-02 child timeout email

### Codebase intel (referencia)
- `.planning/codebase/CONVENTIONS.md` — patrones de require centralizado, async/await, error handling
- `.planning/codebase/ARCHITECTURE.md` §Always-On Patterns — contexto sobre por qué timeouts encapsulados son la decisión correcta bajo always-on
- `.planning/codebase/CONCERNS.md` §Always-On Cutover Debt — Phase 19 atiende explícitamente la deuda de "axios sin timeout cuelga forResponse" que el documento ya señalaba
- `.planning/codebase/STACK.md` — Node 22 + axios v1, child_process spawn estándar, ningún wrapper especial

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`axios.create({ timeout })` pattern** (`src/services/LicenseValidator.js:49`) — referencia exacta del cliente centralizado. `licenseClient` ya cachea timeout + headers; `portalClient` sigue el mismo molde.
- **`logGenerator(LOG_FILE, level, msg)`** (`src/utils/LogGenerator.js`) — wrapper Winston existente; `[TIMEOUT]` entries siguen el patrón `[PREFIX] key=value key=value` ya establecido por Phase 18 (`[ADMIN-EMAIL]`, `[OVERLAP]`, `[TIMEOUT]`).
- **`sendAdminAlert(subject, html)`** (`src/services/CronScheduler.js:46-70`, Phase 18 D-08) — helper inline reusable directo para ROOT-02 child timeout email. Path swallows errors + warn log, consistente con Phase 19 D-15.
- **`formatDurationMin(ms)`** (`src/utils/duration.js`, Plan 18-01) — formatea durations a `'10m'` / `'10m 30s'` para subjects/bodies de email. Reusable directo.
- **`config.schedule.lockTimeoutMs` pattern** (`src/config.js:169`) — template para los nuevos env vars: `parseInt(process.env.X, 10) || DEFAULT` + validación fail-fast (`if (config.schedule.X < MIN) { console.error(...); process.exit(1); }`).
- **Phase 17 step instrumentation** (`src/background.js:39-65, 68-94, ...`) — los 7 steps ya están envueltos en `{ const __step; let __stepError; try { startStep + emitProgress + await stepFn(i) } catch { ...; throw stepErr; } finally { endStep } }`. ROOT-03 agrega `Promise.race` solo alrededor del `await stepFn(i)` — el resto queda intacto.
- **Phase 17 startChildProcess instrumentation** (`src/services/CronScheduler.js`, paso `startChildProcess`) — ya hay `startStep + endStep` con `tenant: null`. ROOT-02 timeout error fluye al `endStep` con `error: err.message` por la propagación natural del reject.

### Established Patterns

- **Cliente axios centralizado** — LicenseValidator es el precedente; PortalClient sigue exacto. Headers incluyen `Accept: application/json` por default; los call sites individuales agregan auth headers con `tenants[i].key`/`secret` como hoy.
- **`config.section.knob`** — agrupar timeouts: `config.portal.httpTimeoutMs` (porque es del portal), `config.schedule.childProcessTimeoutMs` y `config.schedule.stepTimeoutMs` (porque son del scheduler/cron). Match con `config.schedule.lockTimeoutMs` y `config.schedule.operationDelayMs` ya existentes.
- **Validación fail-fast en config.js** — `if (value < MIN) { console.error(...); process.exit(1); }`. Cada env var nuevo lo hace con su propio mínimo razonable.
- **Promise wrapping para work async** (`startChildProcess` ya está wrappeado en Promise constructor) — agregar timer + kill DENTRO del Promise mantiene la firma. Pattern consistent con cómo `startChildProcess` ya maneja close/error listeners.
- **Tenant-catch boundary** (`src/background.js:145`) — `try { ... 7 steps con throws ... } catch (e) { logGenerator + continue al siguiente tenant }`. ROOT-03 step timeout es solo "una excepción más" que cae en este boundary, sin nuevo control flow.
- **`[TIMEOUT]` log prefix** ya usado por Plan 18-01 listener — Phase 19 lo extiende a más sites con la misma key=value structure.

### Integration Points

- **`portalClient` consumido por:** los 9 archivos a refactorear. Cada uno cambia `const axios = require('axios')` → `const portalClient = require('../utils/PortalClient')` (relative path varía). Tests existentes que mockean axios pueden seguir funcionando si mockean `axios.create` (devuelve mock con .get/.post/.put). Si mockean directo `axios.get`, requieren actualizar a `portalClient.get`.
- **ROOT-02 timer** vive enteramente dentro del Promise constructor de `startChildProcess` — el caller (CronScheduler.js paso `startChildProcess`) no necesita cambios. El error fluye al `try/catch/finally` existente que ya hace endStep + log.
- **ROOT-03 stepTimeoutPromise** se construye DENTRO del bloque `{ const __step; ... }` por cada step en `forResponse`. Promise.race wrappea el `await stepFn(i)` actual. Cero cambios en la estructura externa de los bloques (Phase 17 D-11 instrumentation queda byte-equivalent en estructura).
- **Email path para ROOT-02** — listener de step timeout en CronScheduler.js detecta `error?.message?.includes('Child process timeout')` y dispara `sendAdminAlert`. Match con el patrón del listener `lock:timeout` de Plan 18-01 (mismo `try/catch + warn log` defensivo alrededor del send).

</code_context>

<specifics>
## Specific Ideas

- **Defaults pre-aprobados:** `PORTAL_HTTP_TIMEOUT_MS=30000`, `CHILD_PROCESS_TIMEOUT_MS=600000`, `STEP_TIMEOUT_MS=300000` — match literal con el texto de las REQs. Override via env si la observación de producción indica que son agresivos. Ningún ajuste pre-emptivo.
- **Subject del email child timeout:** `[SageConnect] Child process timeout: ImportaFacturasFocaltec.exe killed después de <duración>` — formato consistente con los subjects de Phase 18 (auto-timeout, liberación manual). Pre-grep ready.
- **Body del email:** PID del child, duración antes del kill, ruta del exe (`config.app.importRoute`), timestamp ISO. Sin links porque no hay URL relevante (el exe corre local).
- **Grace period 30s del kill** — hardcoded en background.js, sin env knob. Razón: es un detalle de implementación del kill graceful, no una política operacional. Si en producción se observa que 30s es insuficiente para que el exe cierre limpio, ajustar in-place.
- **`taskkill /F /T /PID` shell-out** — usar `child_process.exec` (callback-based o promisified). El `/T` es crítico para matar el árbol completo si el exe spawnó helpers. `/F` fuerza el kill sin prompt. Sin shell injection risk porque `<pid>` es un integer numérico generado por Node.
- **Test de timeouts sin esperar 30s real** — `jest.useFakeTimers()` + `jest.advanceTimersByTime(30001)`. Pattern ya establecido en `tests/services/OperationManager.timer.test.js` (Plan 18-01).

</specifics>

<deferred>
## Deferred Ideas

- **AbortController retrofit completo** — refactor de los 10 controllers/utils para aceptar `signal: AbortSignal` y propagar el abort desde forResponse cuando el step timeout dispara. Elimina phantom continuation completa pero requiere signature changes invasivos. Defer hasta que evidencia operacional muestre que la phantom continuation causa problemas concretos (resource accumulation, memory leaks, FD leaks bajo always-on).
- **Timeouts en los 13+ scripts CLI de `src/scripts/*`** — los scripts no acquiren lock; fuera del scope del bug 409 que motivó v2.3. El cliente `portalClient` está disponible para reuso si en futuras milestones se decide extender el patrón a CLI.
- **Email agregado por cycle** — buffer de timeouts dentro de un cycle, flush al final con summary. Reduce ruido de email parity completa pero añade complejidad (buffer + flush hook). Defer hasta que se observe demanda explícita.
- **Logs estructurados (JSON)** — codebase no usa structured logging hoy; introducirlo en Phase 19 sería inconsistencia. Defer a una phase de logging refactor si surge necesidad de Splunk/ELK.
- **Operator identity en force-release/timeout events** — defer hasta que haya auth de usuario real (no roadmap actual). Listed en Phase 18 deferred.
- **Métricas de duración por step para tendencias** — listado en REQUIREMENTS.md Future Requirements. Phase 19 implementa la red de seguridad; las métricas históricas son feature separada.
- **Per-step `unref()` en setTimeout del Promise.race** — si bajo always-on los timers acumulados de Promise.race generan warnings de event loop, agregar `.unref()` al setTimeout. Defer hasta que se observe el problema (Plan 18-01 timer pattern no requirió unref).
- **Streaming download timeout dedicado (`PORTAL_DOWNLOAD_TIMEOUT_MS`)** — D-04 decidió usar el timeout unificado. Si en producción se observa que stream downloads grandes regularmente exceden 30s, agregar el env separado en una phase futura sin cambios estructurales.

</deferred>

---

*Phase: 19-root-cause-timeouts*
*Context gathered: 2026-04-28*
