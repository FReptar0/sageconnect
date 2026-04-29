# Phase 19: Root Cause Timeouts - Pattern Map

**Mapped:** 2026-04-29
**Files analyzed:** 17 (1 nuevo backend + 9 modificados backend + 5 tests + 1 config + 1 helper opcional)
**Analogs found:** 17 / 17 (todos los archivos tienen al menos un analog fuerte en el codebase tras Phase 18)

> **Read order para el planner:** primero `## File Classification` para tener el panorama de los 4 grupos ROOT-XX. Luego cada `## ROOT-XX` agrupa los archivos relevantes con su analog y excerpt concreto. Convenciones cross-cutting (logging, fail-fast, mocks, anti-patterns Phase 18 que NO debemos arrastrar) viven en `## §S Critical Conventions`.

> **Phase 19 boundary recordatorio (D-03 in 18-CONTEXT.md):** Phase 18 toleró "phantom continuation" porque NO podía abortar work HTTP en vuelo. Phase 19 es el lifting explícito de esa restricción para HTTP via ROOT-01 (axios timeout 30s = abort real de la red). Para steps individuales (ROOT-03) la phantom continuation se mantiene; el axios timeout es la red de seguridad real, no el Promise.race.

---

## File Classification

| New / Modified File | ROOT | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|------|-----------|----------------|---------------|
| `src/utils/PortalClient.js` (CREATE) | ROOT-01 | utility / cached HTTP client (singleton) | request-response (HTTP) | `src/services/LicenseValidator.js:49` (`licenseClient = axios.create({ timeout, headers })`) | exact (gemelo del licenseClient) |
| `src/controller/CFDI_Downloader.js` (modify) | ROOT-01 | controller / 3 axios sites | request-response + streaming | self — líneas 107, 124, 159 | exact (refactor in-place) |
| `src/controller/PortalPaymentController.js` (modify) | ROOT-01 | controller / 1 axios.post | request-response | self — línea 286 | exact |
| `src/controller/PortalOC_Creator.js` (modify) | ROOT-01 | controller / 1 axios.post | request-response | self — línea 267 (ya tiene `timeout: 30000` inline) | exact |
| `src/controller/PortalOC_Closer.js` (modify) | ROOT-01 | controller / 1 axios.put | request-response | self — línea 90 (ya tiene `timeout: 30000` inline) | exact |
| `src/controller/PortalOC_Canceller.js` (modify) | ROOT-01 | controller / 1 axios.put | request-response | self — línea 74 (ya tiene `timeout: 30000` inline) | exact |
| `src/controller/PortalOC_ContentUpdater.js` (modify) | ROOT-01 | controller / 1 axios.put | request-response | self — línea 132 (ya tiene `timeout: 30000` inline) | exact |
| `src/controller/PortalOC_StatusUpdater.js` (modify) | ROOT-01 | controller / 1 axios.put | request-response | self — línea 90 (ya tiene `timeout: 30000` inline + `httpAgent`/`httpsAgent`) | exact con caveat (preservar agents) |
| `src/utils/GetTypesCFDI.js` (modify) | ROOT-01 | utility / 7 axios.get sites | request-response | self — líneas 21, 46, 123, 201, 309, 402, 468 | exact |
| `src/utils/GetProviders.js` (modify) | ROOT-01 | utility / 2 axios.get sites | request-response | self — líneas 28, 75 | exact |
| `src/background.js` `startChildProcess` (modify) | ROOT-02 | service / spawn + Promise constructor | event-driven (close/error/data) | self — `startChildProcess` actual at lines 279-360 | exact (extender con setTimeout + kill cascade dentro del Promise) |
| `src/background.js` `forResponse` (modify) | ROOT-03 | service / per-tenant orchestrator | sequential async + tenant-catch boundary | self — los 7 bloques `{ const __step; ... await stepFn(i); ... endStep }` ya instrumentados por Phase 17 D-11 | exact (Promise.race wrapper around `await stepFn(i)`) |
| `src/services/CronScheduler.js` (modify) | ROOT-02 + ROOT-04 | service / step instrumentation + email dispatch | event-driven (existing `lock:timeout` listener at line 209) | self — `findLastOpenStep` at line 78, `sendAdminAlert` at line 46-70, listener body at lines 209-251 | exact (extender pattern Phase 18) |
| `src/utils/duration.js` (optional modify) | ROOT-03 | utility / pure function | request-response (sync) | self — `formatDurationMin(durationMs)` at lines 18-32 | exact (agregar `withStepTimeout(promiseFn, ms, label)` siguiendo el mismo file) |
| `src/config.js` (modify) | ROOT-01/02/03 | config loader | initialization + fail-fast | self — `lockTimeoutMs` at line 169 + range guard at lines 174-177 | exact (3 nuevas knobs siguiendo el mismo patrón) |
| `tests/utils/PortalClient.test.js` (CREATE) | ROOT-01 | unit test | function-call assertion | `tests/utils/log-generator.test.js` + Phase 18 OperationManager.timer.test.js mock pattern | role-match (combinar) |
| `tests/services/background.startChildProcess.timeout.test.js` (CREATE) | ROOT-02 | unit test (jest fake timers + spawn mock) | event-driven mock | `tests/services/OperationManager.timer.test.js:37-46` (`jest.useFakeTimers` + `_reset` reuse) + `tests/services/cron-scheduler.test.js:14-22` (mock spawn-like task) | role-match (combinar) |
| `tests/services/background.forResponse.stepTimeout.test.js` (CREATE) | ROOT-03 | unit test (Promise.race + tenant-catch) | sequential async + error throw | `tests/services/cron-scheduler.test.js` (mock layout para forResponse) + `tests/services/OperationManager.timer.test.js` (advanceTimersByTime pattern) | role-match (compone dos analogs) |
| `tests/services/CronScheduler.timeout-listener.test.js` (extend) | ROOT-02 | unit test (extension) | event-driven assertions | self — el archivo ya existe (Plan 18-01); agregar test cases para child-timeout email vs axios/step no email | exact (extension) |
| `tests/integration/timeout-logging.test.js` (CREATE) | ROOT-04 | integration / log-content assertion | mock log destination + emit timeouts | `tests/utils/log-generator.test.js` (LogGenerator wrapper assertions) + Phase 18 timeout-listener test (event emit + side-effect verify) | role-match (carpeta `tests/integration/` no existe — crearla) |

**Match-quality legend:**
- **exact** = copiar la estructura verbatim, cambiar solo nombres / números.
- **role-match** = mismo role/data flow, pero el archivo nuevo extiende o compone el analog en lugar de clonarlo.

**Observación crítica sobre los 4 PortalOC_*.js (`Creator`, `Closer`, `Canceller`, `ContentUpdater`, `StatusUpdater`):** los 5 ya pasan `timeout: 30000` inline en sus axios calls. El refactor a `portalClient` es esencialmente **borrar el `timeout: 30000`** del options object y dejar que `portalClient.create({ timeout: ... })` lo provea centralizadamente. Esto es estructural, no funcional — el comportamiento neto es idéntico hoy si `PORTAL_HTTP_TIMEOUT_MS=30000`. Si en el futuro se cambia el default, los 5 controladores heredan automáticamente. **Anti-pattern a evitar:** dejar `timeout: 30000` Y migrar a `portalClient.put(...)` — los dos timeouts no se suman ni anulan; axios usa el del config del cliente si el del request no se pasa, así que es ruido visual.

---

## ROOT-01 — Centralized axios client + 10 site refactor

### 1.1. `src/utils/PortalClient.js` (CREATE)

**Analog:** `src/services/LicenseValidator.js:49` (`licenseClient = axios.create({ timeout: HTTP_TIMEOUT_MS, headers: { 'Accept': 'application/json' } })`).

**Imports y módulo (estructura completa propuesta):**
```javascript
// src/utils/PortalClient.js (NEW)
const axios = require('axios');
const config = require('../config');

/**
 * Cliente HTTP centralizado para el portal de proveedores Focaltec.
 * Aplica un timeout default desde config.portal.httpTimeoutMs (env PORTAL_HTTP_TIMEOUT_MS, default 30s).
 *
 * Razón de existir (ROOT-01 / D-01): bajo always-on, axios sin timeout = lock huérfano cada cron tick.
 * Cliente compartido elimina la posibilidad de "olvidé poner timeout en el call site nuevo".
 *
 * Match exacto al patrón de src/services/LicenseValidator.js:49 (licenseClient).
 * Diferencias intencionales: usa config.portal.httpTimeoutMs en lugar de constante hardcoded;
 * el LicenseValidator tiene timeout 10s dedicado, el portal del cliente acepta 30s default.
 */
const portalClient = axios.create({
    timeout: config.portal.httpTimeoutMs,
    headers: { 'Accept': 'application/json' },
});

module.exports = portalClient;
```

**Convenciones a seguir:**
- Singleton cacheado a nivel de módulo (CommonJS: `require()` returns same object across requires). Coincide con `licenseClient` que también es módulo-level singleton.
- **NO** poner auth headers globales (`PDPTenantKey`/`PDPTenantSecret`) — auth headers son per-tenant via `apiKeys[index]` / `apiSecrets[index]` en cada call site, los cuales se preservan tal cual al cambiar `axios.get(...)` → `portalClient.get(...)` (mismo segundo argumento).
- **NO** poner `baseURL` — los call sites construyen `urlBase(index)` localmente con tenant id; es más simple dejarlos como están y solo cambiar el verbo.

**Anti-patterns a evitar:**
- **NO** crear una nueva instancia por call site (`axios.create({ timeout })` en cada controlador): rompe la centralización y reintroduce el problema del "olvidé poner timeout". El planner valida en review que `axios.create` solo aparezca una vez — en `PortalClient.js`.
- **NO** wrappear con `class PortalClient { ... }` u otros indireccionamientos: el codebase usa singletons por module-level `module.exports = something` (ver `licenseClient` mismo). Mantener simplicidad.
- **NO** mezclar `LICENSE_HTTP_TIMEOUT` con `PORTAL_HTTP_TIMEOUT_MS` — son dos clientes con timeouts independientes (10s vs 30s) por razones operacionales distintas (license validation == fast fail; portal calls == acepta páginas grandes).

---

### 1.2. `src/controller/CFDI_Downloader.js` (modify, 3 axios sites)

**Analog (interno):** las 3 sitios ya están en el archivo — líneas 107, 124, 159.

**Imports actuales (línea 1-9, debe modificarse):**
```javascript
// src/controller/CFDI_Downloader.js:1-9
const { getTypeE, getTypeI } = require('../utils/GetTypesCFDI');
const axios = require('axios');                                  // ← REMOVE
const config = require('../config');
const fs = require('fs');
const path = require('path');
const { runQuery } = require('../utils/SQLServerConnection');
const parser = require('xml2js').parseString;
const xmlBuilder = require('xml2js').Builder;
const { logGenerator } = require('../utils/LogGenerator');
```

**Patrón a seguir para los imports:** reemplazar `const axios = require('axios');` por `const portalClient = require('../utils/PortalClient');`. El import es relativo desde `src/controller/` a `src/utils/` → `'../utils/PortalClient'` (consistente con `'../utils/LogGenerator'` ya presente en línea 9).

**Site 1 — línea 107 (axios.get headers — fetch CFDI files index):**
```javascript
// src/controller/CFDI_Downloader.js:107-112 (current)
const response = await axios.get(`${urlBase(index)}/cfdis/${cfdiData[i].cfdiId}/files`, {
    headers: {
        'PDPTenantKey': apiKey,
        'PDPTenantSecret': apiSecret,
    },
});
```

**Patrón a seguir:** cambiar `axios.get` por `portalClient.get`. El segundo argumento (objeto con `headers`) queda IGUAL — el timeout del cliente se aplica automáticamente sin necesidad de inyectarlo aquí.
```javascript
// after refactor
const response = await portalClient.get(`${urlBase(index)}/cfdis/${cfdiData[i].cfdiId}/files`, {
    headers: {
        'PDPTenantKey': apiKey,
        'PDPTenantSecret': apiSecret,
    },
});
```

**Site 2 — línea 124 (axios.get stream — D-04 explícitamente confirma mismo timeout):**
```javascript
// src/controller/CFDI_Downloader.js:124 (current)
const fileStream = await axios.get(urls[i], { responseType: 'stream' });
```

**Patrón a seguir:** `portalClient.get(urls[i], { responseType: 'stream' })`. D-04 reconfirma que el stream usa el mismo `PORTAL_HTTP_TIMEOUT_MS = 30s`. ROOT-03 step-level timeout (5 min) es la red de seguridad si un stream tarda > 30s legítimamente. **NO crear** un `streamClient` separado ni pasar `timeout: undefined` para "deshabilitar" — D-04 explícitamente los rechaza.

**Site 3 — línea 159 (axios.get providers — auth headers idénticos):**
```javascript
// src/controller/CFDI_Downloader.js:159-164 (current)
const response = await axios.get(`${urlBase(index)}/providers/${dataCfdi.providerId}`, {
    headers: {
        'PDPTenantKey': apiKey,
        'PDPTenantSecret': apiSecret
    }
});
```

**Patrón a seguir:** sustituir `axios.get` por `portalClient.get`. Sin más cambios.

**Convenciones:**
- Preservar el `try/catch` existente alrededor de cada call (no hay aquí en `CFDI_Downloader` — los errores se propagan al caller `forResponse` y el tenant-catch los atrapa).
- ROOT-04 D-14 dice que el `[TIMEOUT]` log entry para axios timeouts vive en el LOG_FILE del caller — i.e., `'CFDI_Downloader'`. **El planner agrega un `try/catch` mínimo solo si decide capturar el axios timeout localmente y log un `[TIMEOUT]` entry**, en lugar de dejar que el throw fluya al caller. Recomendación del mapper: dejar que fluya — el caller (`forResponse`) tiene el step name + tenant context que es necesario para el log entry completo (D-16: `step + tenant + url + durationMs`). Capturar localmente requeriría redundar context.

**Anti-pattern a evitar:**
- **NO** mantener `const axios = require('axios');` "por si acaso" — en este archivo las 3 sites son los únicos consumers de axios. Removerlo deja el archivo limpio. Si en el futuro alguien necesita axios sin timeout, tiene que requerir explícitamente, lo cual fuerza review.

---

### 1.3. `src/controller/PortalPaymentController.js` (modify, 1 axios.post)

**Site único — línea 286 (`axios.post` payment payload + `.catch(err => ...)`):**
```javascript
// src/controller/PortalPaymentController.js:286-295 (current)
const resp = await axios.post(endpoint, payload, {
    headers: {
        'PDPTenantKey': apiKeys[index],
        'PDPTenantSecret': apiSecrets[index],
        'Content-Type': 'application/json'
    }
}).catch(err => {
    logGenerator(logFileName, 'error', `Error POST payment: ${err.message}`);
    return err.response || { status: 500, data: err.message };
});
```

**Patrón a seguir:** `axios.post` → `portalClient.post`. El `.catch` chain se preserva 100% — si el axios timeout dispara, `err.message` será `'timeout of 30000ms exceeded'` (forma canónica de axios) y el log line existente lo captura. Para ROOT-04 D-13 / D-16, el planner puede ENRIQUECER el log:
```javascript
.catch(err => {
    const isTimeout = err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
    if (isTimeout) {
        logGenerator(logFileName, 'error',
            `[TIMEOUT] step=uploadPayments tenant=${tenantIds[index]} url=${endpoint} durationMs=${config.portal.httpTimeoutMs} err=${err.message}`);
    } else {
        logGenerator(logFileName, 'error', `Error POST payment: ${err.message}`);
    }
    return err.response || { status: 500, data: err.message };
});
```

**Imports a modificar (líneas 1-8, primera línea con axios = línea 6):**
```javascript
// src/controller/PortalPaymentController.js:1-8
const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { getCurrentDateCompact } = require('../utils/TimezoneHelper');
const { resolveProviderIdByExternalId } = require('../services/ProviderIdResolver');
const { resolveUuidByFolio } = require('../services/UuidResolver');
const axios = require('axios');                                   // ← REMOVE
const notifier = require('node-notifier');
const config = require('../config');
```

**Patrón a seguir:** reemplazar línea 6 con `const portalClient = require('../utils/PortalClient');`.

**Anti-pattern a evitar:**
- **NO** intentar detectar timeout via `err.response === undefined` solamente — axios mete `err.code` (`ECONNABORTED`) y `err.isAxiosError === true`. La forma robusta es `err.code === 'ECONNABORTED' || /timeout/i.test(err.message)`.

---

### 1.4. `src/controller/PortalOC_Creator.js` (modify, 1 axios.post)

**Site único — línea 267 (`axios.post` con `timeout: 30000` inline):**
```javascript
// src/controller/PortalOC_Creator.js:267-278 (current)
const resp = await axios.post(
    endpoint,
    validatedPO,
    {
        headers: {
            'PDPTenantKey': apiKeys[index],
            'PDPTenantSecret': apiSecrets[index],
            'Content-Type': 'application/json'
        },
        timeout: 30000                                            // ← REMOVE (cliente lo aplica)
    }
);
```

**Patrón a seguir:**
1. Cambiar `axios.post` → `portalClient.post`.
2. **REMOVER** `timeout: 30000` del options object — el cliente lo aplica desde `config.portal.httpTimeoutMs`. Dejarlo no rompe nada (axios usa el override del request si lo pasas) pero crea ruido visual y reabre la posibilidad de drift (alguien sube `httpTimeoutMs` a 60s pero este controller queda en 30s hardcoded).

**Imports (líneas 1-2):**
```javascript
// src/controller/PortalOC_Creator.js:1-2 (current)
const axios = require('axios');                                   // ← REPLACE
const config = require('../config');
```

**Patrón a seguir:** reemplazar línea 1 con `const portalClient = require('../utils/PortalClient');`.

**Caveat:** este patrón aplica IDÉNTICO a `PortalOC_Closer.js:90`, `PortalOC_Canceller.js:74`, y `PortalOC_ContentUpdater.js:132` — todos tienen `timeout: 30000` inline. El refactor es: cambiar el verbo + remover el `timeout: 30000`. Lock-step.

---

### 1.5. `src/controller/PortalOC_StatusUpdater.js` (modify, 1 axios.put — CASO ESPECIAL)

**Site único — línea 90 (`axios.put` con `timeout: 30000` Y `httpAgent`/`httpsAgent`):**
```javascript
// src/controller/PortalOC_StatusUpdater.js:90-103 (current)
apiResp = await axios.put(
    endpoint,
    { status },
    {
        headers: {
            'PDPTenantKey': apiKeys[dbIndex],
            'PDPTenantSecret': apiSecrets[dbIndex],
            'Content-Type': 'application/json'
        },
        httpAgent,                                                 // ← PRESERVAR (línea 23: localPort 3030 + keepAlive)
        httpsAgent,                                                // ← PRESERVAR
        timeout: 30000                                             // ← REMOVE
    }
);
```

**Imports (líneas 1-9):**
```javascript
// src/controller/PortalOC_StatusUpdater.js:1-9 (current)
const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { successResult, errorResult } = require('../utils/ResultEnvelope');
const axios = require('axios');                                   // ← REPLACE
const http = require('http');
const https = require('https');
const config = require('../config');
```

**Patrón a seguir:**
1. Línea 6 `const axios = require('axios');` → `const portalClient = require('../utils/PortalClient');`.
2. **PRESERVAR `httpAgent`/`httpsAgent`** en el options object — son `localPort: 3030` + `keepAlive: true` (líneas 19-24), no son timeouts; pasan al request individual. axios soporta merge de agents desde el call site con el cliente cacheado (los agents del request override agents del cliente).
3. **REMOVER `timeout: 30000`**.
4. Si el planner decide que también este `localPort 3030` debería ir al cliente: **NO**. Los agents son específicos a este controller (Capstone request to ZCL-RDS-02 require source port 3030 para network policy) — moverlos al cliente compartido afecta ALL otros call sites que NO los necesitan.

**Convención crítica (anti-regresión):**
- El `httpAgent`/`httpsAgent` con `localPort: 3030` es **load-bearing** para producción de Capstone. NO TOCAR. El plan debe explicitar "preservar agents".

---

### 1.6. `src/utils/GetTypesCFDI.js` (modify, 7 axios.get sites)

**Sites (todos `axios.get` con header auth idénticos):**
- Línea 21 (getTypeP — paged search PAYMENT_CFDI)
- Línea 46 (getTypeP — single payment fetch by id)
- Línea 123 (getTypeI — paged search INVOICE PENDING_TO_PAY)
- Línea 201 (getTypeIToSend — paged search INVOICE TO_SEND)
- Línea 309 (getTypeE — paged search CREDIT_NOTE)
- Línea 402 (getCfdisByProvider — paged search filtered by provider)
- Línea 468 (`requestPendingToPayPage` — RETRY LOOP `axios.get` con backoff manual; CASO ESPECIAL)

**Patrón canónico (líneas 21-32 — el resto siguen la misma forma):**
```javascript
// src/utils/GetTypesCFDI.js:21-32 (current)
const response = await axios.get(
    urlBase(index) +
    `?from=${dateFrom}-01` +
    `&documentTypes=CFDI` +
    `&offset=0&pageSize=0` +
    `&cfdiType=PAYMENT_CFDI`,
    {
        headers: {
            'PDPTenantKey': apiKeys[index],
            'PDPTenantSecret': apiSecrets[index]
        }
    }
);
```

**Patrón a seguir:** cambiar las 7 ocurrencias de `axios.get` por `portalClient.get`. Headers + URLs preservados. Ningún site tiene `timeout` inline en este archivo, así que no hay nada que remover.

**Imports (líneas 1-5):**
```javascript
// src/utils/GetTypesCFDI.js:1-5 (current)
const config = require('../config');
const axios = require('axios');                                   // ← REPLACE
const { getOneMonthAgoString } = require('./TimezoneHelper');
const { runQuery } = require('./SQLServerConnection');
const { logGenerator } = require('./LogGenerator');
```

**Patrón a seguir:** reemplazar línea 2 con `const portalClient = require('./PortalClient');` (mismo dir, no necesita `../utils/`).

**Caso especial — línea 468 (`requestPendingToPayPage` — retry loop):**
```javascript
// src/utils/GetTypesCFDI.js:453-487 (resumen — retry con backoff manual + isRetryablePortalError)
async function requestPendingToPayPage(index, offset, pageSize, from, to, logFileName) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // ... build query ...
            return await axios.get(urlBase(index) + query, {
                headers: { 'PDPTenantKey': ..., 'PDPTenantSecret': ... }
            });
        } catch (error) {
            const canRetry = attempt < maxAttempts && isRetryablePortalError(error);
            if (!canRetry) throw error;
            // ... backoff ...
        }
    }
}
```

**Patrón a seguir:** simplemente cambiar `axios.get` → `portalClient.get`. La función `isRetryablePortalError` ya considera `'ECONNABORTED'` y `'ETIMEDOUT'` como retryables (línea 442) — esto es serendipia: ROOT-01 axios timeout dispara `err.code = 'ECONNABORTED'`, así que el retry loop existente **automáticamente** reintenta hasta 3 veces ante timeouts. **No tocar** el array `retryableCodes` — ya cubre el caso. Ver línea 442:

```javascript
// src/utils/GetTypesCFDI.js:441-446 (current — DO NOT MODIFY)
function isRetryablePortalError(error) {
    const retryableStatus = [429, 502, 503, 504];
    const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN'];
    const status = error?.response?.status;
    const code = error?.code;
    return retryableStatus.includes(status) || retryableCodes.includes(code);
}
```

**Convención:** `requestPendingToPayPage` con timeout 30s + 3 retries con backoff = 30s + 1.5s + 30s + 3s + 30s = ~95s wall-clock máximo en el peor caso. Esto cabe BAJO el step timeout de 5 min (ROOT-03), así que no hay conflicto.

**Anti-pattern a evitar:**
- **NO** convertir el retry loop a un `Promise.all` o `Promise.race` — la naturaleza secuencial con backoff es intencional (rate-limit friendly). Solo cambiar el verbo.

---

### 1.7. `src/utils/GetProviders.js` (modify, 2 axios.get sites)

**Sites:** línea 28 (`getProviders` — list paged) y línea 75 (`getProviderByExternalId` — single lookup).

**Patrón canónico (línea 28-37):**
```javascript
// src/utils/GetProviders.js:28-37 (current)
const response = await axios.get(
    urlBase(index) +
    `?statusExpedient=ACCEPTED&expedientAcceptedFrom=${today}&expedientAcceptedTo=${today}&status=ENABLED&pageSize=-1`,
    {
        headers: {
            'PDPTenantKey': apiKeys[index],
            'PDPTenantSecret': apiSecrets[index]
        }
    }
);
```

**Patrón a seguir:** `axios.get` → `portalClient.get`. Idem línea 75.

**Imports (líneas 1-5):**
```javascript
// src/utils/GetProviders.js:1-5 (current)
const notifier = require('node-notifier');
const config = require('../config');
const axios = require('axios');                                   // ← REPLACE
const { getCurrentDateString } = require('./TimezoneHelper');
const { logGenerator } = require('./LogGenerator');
```

**Patrón a seguir:** línea 3 → `const portalClient = require('./PortalClient');`.

---

## ROOT-02 — Child process kill cascade

### 2.1. `src/background.js` `startChildProcess` (modify, lines 279-360)

**Analog (interno):** la función `startChildProcess` actual es Promise-wrapped — el patrón de "agregar timer dentro del Promise constructor" es exactamente lo que hizo Plan 18-01 cuando agregó `setTimeout(_fireTimeout, lockTimeoutMs)` dentro de `acquireLock` (`OperationManager.js:52`). El blast radius mínimo es replicar ese patrón aquí.

**Estructura existente que DEBE preservarse (líneas 279-360 — visión completa):**
```javascript
// src/background.js:279-360 (current — resumen de listeners + final-blocks)
function startChildProcess() {
    return new Promise((resolve, reject) => {
        const logFileName = 'ChildProcess';

        // ... INFO logs ...

        if (config.app.importRoute && config.app.arg) {
            const childProcess = spawn(config.app.importRoute, [config.app.arg]);
            logGenerator(logFileName, 'info', `[INFO] Child process iniciado con PID: ${childProcess.pid}`);

            childProcess.stdout.on('data', (data) => { /* ... */ });
            childProcess.stderr.on('data', (data) => { /* ... */ });

            childProcess.on('close', (code) => {
                if (code === 0) {
                    // ... success log ...
                    resolve(code);
                } else {
                    // ... error log ...
                    reject(new Error(`Child process failed with code ${code}`));
                }
                global.childProcessComplete = true;
            });

            childProcess.on('error', (error) => {
                // ... error log ...
                reject(error);
            });
        } else {
            // ... config missing path: sendMail + resolve(null) ...
        }
    });
}
```

**Patrón a seguir (D-06 explícito):** agregar `killTimer + graceTimer + hasSettled flag` DENTRO del Promise constructor, sin tocar la firma. Los listeners `close`/`error` deben hacer `clearTimeout(killTimer)` Y `clearTimeout(graceTimer)` antes de settle.
```javascript
// src/background.js:279-360 (REFACTORED — pseudocode following D-06 + S-3)
const { spawn, exec } = require('child_process');                 // ← extend imports (exec is new)
const { formatDurationMin } = require('./utils/duration');        // ← extend imports

function startChildProcess() {
    return new Promise((resolve, reject) => {
        const logFileName = 'ChildProcess';
        let hasSettled = false;
        let killTimer = null;
        let graceTimer = null;
        const settle = (fn) => {
            if (hasSettled) return;
            hasSettled = true;
            if (killTimer) clearTimeout(killTimer);
            if (graceTimer) clearTimeout(graceTimer);
            fn();
        };

        // ... existing INFO logs ...

        if (config.app.importRoute && config.app.arg) {
            const childProcess = spawn(config.app.importRoute, [config.app.arg]);
            logGenerator(logFileName, 'info', `[INFO] Child process iniciado con PID: ${childProcess.pid}`);

            // ROOT-02 / D-05 / D-06: timeout + SIGTERM + 30s grace + taskkill /F /T fallback
            killTimer = setTimeout(() => {
                const durationMs = config.schedule.childProcessTimeoutMs;
                const durationLabel = formatDurationMin(durationMs);
                logGenerator(logFileName, 'error',
                    `[TIMEOUT] step=startChildProcess tenant=global pid=${childProcess.pid} ` +
                    `durationMs=${durationMs} action=SIGTERM`);

                childProcess.kill();    // SIGTERM (Unix) / mapped exit signal (Windows via Node)

                // 30s grace period — hardcoded, NOT env-configurable (D-05 specifics).
                graceTimer = setTimeout(() => {
                    if (childProcess.exitCode === null) {
                        logGenerator(logFileName, 'error',
                            `[TIMEOUT] step=startChildProcess pid=${childProcess.pid} action=taskkill /F /T`);
                        // /T: tree kill (matches PowerShell Stop-Process -Force semantics)
                        // /F: force without prompt
                        // PID is integer-typed by Node — no shell injection risk.
                        exec(`taskkill /F /T /PID ${childProcess.pid}`, (err) => {
                            if (err) {
                                logGenerator(logFileName, 'warn',
                                    `[TIMEOUT] taskkill exec failed: ${err.message}`);
                            }
                        });
                    }
                }, 30000);    // hardcoded grace per D-05

                settle(() => reject(new Error(
                    `Child process timeout after ${durationLabel} — killed (PID was ${childProcess.pid})`
                )));
            }, config.schedule.childProcessTimeoutMs);

            // EXISTING listeners (preservados — agregar settle wrapper):
            childProcess.stdout.on('data', (data) => { /* unchanged */ });
            childProcess.stderr.on('data', (data) => { /* unchanged: incluye sendMail existente */ });

            childProcess.on('close', (code) => {
                // ... existing logs preserved ...
                settle(() => code === 0
                    ? resolve(code)
                    : reject(new Error(`Child process failed with code ${code}`))
                );
                global.childProcessComplete = true;
            });

            childProcess.on('error', (error) => {
                // ... existing logs preserved ...
                settle(() => reject(error));
            });
        } else {
            // existing path unchanged — no timer needed because resolve(null) is sync
            // ... sendMail + resolve(null) ...
        }
    });
}
```

**Convenciones críticas:**
1. **`hasSettled` flag** — Plan 18-01 mostró el patrón equivalente con `if (hasFired) return;` en `_fireTimeout` para evitar double-emit. Aquí evita double-settle si `close` dispara DURANTE el grace period del kill (proceso terminó por su cuenta entre SIGTERM y taskkill).
2. **`clearTimeout` en `settle`** — sin esto, después de un `close` exitoso el `killTimer` seguiría armado y dispararía un `kill()` sobre un PID ya finalizado (no rompe nada en Windows pero es ruido). Mismo principio que `releaseLock` en OperationManager:63 que clava `clearTimeout(slot.timeoutHandle)` antes del `delete`.
3. **`exec` import** — `child_process` ya está en línea 1. Cambiar a `const { spawn, exec } = require('child_process');`. No agregar shelljs ni execa.
4. **Grace period 30s hardcoded** — D-05 explícitamente lo deja como hardcoded para no inflar la superficie de configuración. Si el comportamiento operacional muestra que 30s es insuficiente, ajustar in-place; **NO** agregar `CHILD_PROCESS_GRACE_MS` env var en Phase 19.
5. **Reject error string** — el formato `Child process timeout after ${durationLabel} — killed` es load-bearing: el listener `lock:timeout`-like en CronScheduler (ROOT-04 D-15) detecta este error mediante `error?.message?.includes('Child process timeout')` para decidir si dispara `sendAdminAlert`. Cambiar el wording rompe la detección.
6. **`/F /T` taskkill flags** — D-05 specifics line 87 confirma que `/T` mata el árbol (helpers spawneados por el exe) y `/F` fuerza sin prompt. NO usar solo `taskkill /PID` — el exe puede haber spawneado helpers que mantienen handles abiertos. Match con `Stop-Process -Force` que usa el PowerShell de Servy.

**Anti-patterns a evitar:**
- **NO** poner el setTimeout fuera del Promise constructor (necesita acceso a `childProcess` y `settle`).
- **NO** usar `process.kill(pid, 'SIGKILL')` directo (Windows lo mapea pero sin tree-kill — perdés la semántica de `/T`).
- **NO** introducir `AbortController` / `child.unref()` — D-03 explícitamente dice que el blast radius mínimo es timer + flag.
- **NO** awaitear el `exec(taskkill, ...)` — es fire-and-forget; el reject ya disparó al callback de la kill action y el next cron tick limpia. Awaitearlo bloquearía el reject.
- **NO** desactivar el `setTimeout` con `.unref()` — el Promise queda pendiente y necesita el timer activo. Si el caller (CronScheduler) ya rejected el Promise por el `lock:timeout` event de Phase 18, el Promise se resuelve igualmente vía `settle`; no es problema de unref.

---

### 2.2. `src/services/CronScheduler.js` (modify — extender listener para detectar child timeout)

**Analog (interno):** el listener actual `operationManager.on('lock:timeout', async (...) => { ... })` at lines 209-251 (Phase 18 D-08).

**Estructura existente (líneas 209-251):**
```javascript
// src/services/CronScheduler.js:209-251 (current — Phase 18 D-08)
operationManager.on('lock:timeout', async ({ operationType, operationId, startedAt, stepProgress, durationMs }) => {
    const lastOpenStep = findLastOpenStep(stepProgress);
    const stuckOnStep = lastOpenStep ? lastOpenStep.step : null;
    const stuckOnTenant = lastOpenStep ? (lastOpenStep.tenant || null) : null;
    const durationLabel = formatDurationMin(durationMs);

    operationManager.addHistory({ /* ... */ });
    logGenerator(LOG_FILE, 'warn', `[TIMEOUT] Auto-released lock ${operationType} after ${durationLabel} ...`);
    const subject = `[SageConnect] Auto-timeout: lock ${operationType} liberado después de ${durationLabel}`;
    const html = `<h2>Auto-timeout en SageConnect</h2>...`;
    await sendAdminAlert(subject, html);
});
```

**Patrón a seguir (ROOT-02 caller-side — el step `startChildProcess` ya está instrumentado en `CronScheduler.js:147-154` con startStep/endStep + try/catch):**

El error de `startChildProcess` timeout (con mensaje `'Child process timeout after Xm — killed'`) fluye:
1. `await startChildProcess()` rechaza
2. `catch (scpErr)` (línea 149) atrapa
3. `__scpError = scpErr.message` se setea
4. `throw scpErr` re-lanza
5. `endStep('background-cycle', 'startChildProcess', null, { error: __scpError })` registra el error en stepProgress
6. El outer `catch (error)` (línea 157) atrapa, setea `success = false`, `errors = [error.message]`
7. `addHistory` registra el cycle como fallido (línea 165-175)

**ROOT-02 D-15 + ROOT-04 D-14 requieren agregar:** después del `catch (scpErr)` (líneas 149-151), si el error es un child timeout, disparar `sendAdminAlert` Y un log con `[TIMEOUT]` prefix en `'ChildProcess'` log file. Patrón concreto:

```javascript
// src/services/CronScheduler.js:147-154 (REFACTORED — extend the existing block)
let __scpError = null;
try {
    operationManager.startStep('background-cycle', 'startChildProcess', null);
    await startChildProcess();
} catch (scpErr) {
    __scpError = scpErr.message || String(scpErr);

    // ROOT-02 / D-15: detect child process timeout and dispatch admin email
    const isChildTimeout = /Child process timeout/.test(__scpError);
    if (isChildTimeout) {
        // Extra log entry to ChildProcess.log AND CronScheduler.log per D-14
        logGenerator('ChildProcess', 'error',
            `[TIMEOUT] step=startChildProcess tenant=global durationMs=${config.schedule.childProcessTimeoutMs} ` +
            `err=${__scpError}`);
        logGenerator(LOG_FILE, 'error',
            `[TIMEOUT] step=startChildProcess operationId=${operationId} ` +
            `durationMs=${config.schedule.childProcessTimeoutMs} action=admin-email-dispatched`);

        // Admin email — fire-and-forget. sendAdminAlert wraps try/catch, never throws.
        const durationLabel = formatDurationMin(config.schedule.childProcessTimeoutMs);
        const subject = `[SageConnect] Child process timeout: ImportaFacturasFocaltec.exe killed después de ${durationLabel}`;
        const html = (
            `<h2>Child process timeout en SageConnect</h2>` +
            `<p>El proceso hijo <code>ImportaFacturasFocaltec.exe</code> excedió el límite ` +
            `de <strong>${durationLabel}</strong> y fue forzosamente terminado.</p>` +
            `<table border="1" cellpadding="6" cellspacing="0">` +
            `<tr><th align="left">step</th><td>startChildProcess</td></tr>` +
            `<tr><th align="left">operationId</th><td><code>${operationId}</code></td></tr>` +
            `<tr><th align="left">duration</th><td>${durationLabel}</td></tr>` +
            `<tr><th align="left">importRoute</th><td><code>${config.app.importRoute}</code></td></tr>` +
            `<tr><th align="left">error</th><td>${__scpError}</td></tr>` +
            `</table>` +
            `<p><small>Company: ${config.app.company || 'Unknown'} | Time: ${new Date().toISOString()}</small></p>`
        );
        sendAdminAlert(subject, html).catch(() => { /* sendAdminAlert ya swallow */ });
    }

    throw scpErr;       // re-throw — preserva el flujo Phase 17 / outer catch
} finally {
    operationManager.endStep('background-cycle', 'startChildProcess', null, { error: __scpError });
}
```

**Convenciones:**
- **Detección por substring** — `/Child process timeout/.test(...)` es robusta porque el string proviene del error literal en `background.js`. Si el planner cambia ese wording, debe sincronizar este regex. **NO** intentar detectar por `err.code` (no se setea) o por instance check (es un `Error` plain).
- **Doble log entry** — D-14 explícitamente dice "ROOT-02 child timeout → `'ChildProcess'` log Y `'CronScheduler'` log" (paridad con `endStep` que ya escribe a `'CronScheduler'`).
- **`sendAdminAlert` reuse** — Phase 18 D-08 helper (líneas 46-70). NO replicar el bloque nodemailer aquí; reutilizar literalmente.
- **`.catch(() => {})` defensivo** — `sendAdminAlert` ya tiene try/catch interno. El `.catch(() => {})` adicional es belt-and-suspenders contra una rejection inesperada (Phase 18 patrón S-6 punto 3).
- **`throw scpErr`** — debe preservarse al final del catch para mantener el flujo de Phase 17 (outer catch line 157 + addHistory entrada para el cycle).
- **`finally { endStep }`** — el endStep DEBE seguir disparando, sí o sí, para que stepProgress refleje el estado final. La detección + email entran ANTES del throw, dentro del catch.

**Anti-patterns a evitar:**
- **NO** awaitear `sendAdminAlert(...)` — sería bloquear el throw que cierra el cycle. Match con Phase 18 que también usa fire-and-forget para emails desde paths no-críticos.
- **NO** usar regex sobre `err.code` o `err.name` — el error es un `Error` plain, no instancia custom.
- **NO** crear un nuevo error type (`ChildTimeoutError`) — invasivo, sin valor agregado para Phase 19. Si milestone futuro lo requiere, refactor en ese momento.

---

## ROOT-03 — Per-step Promise.race in forResponse

### 3.1. `src/background.js` `forResponse` (modify — wrap each `await stepFn(i)` with Promise.race)

**Analog (interno):** los 7 bloques `{ const __step; let __stepError; try { startStep + emitProgress + await stepFn(i) } catch { ...; throw stepErr; } finally { endStep } }` ya instrumentados por Phase 17 D-11. Phase 19 D-12 agrega un wrapper Promise.race ALREDEDOR del `await stepFn(i)` solamente, dejando el try/catch/throw/finally intacto.

**Estructura existente (uno de los 7 — línea 39-65, todos siguen idéntica forma):**
```javascript
// src/background.js:39-65 (current — Phase 17 D-11 instrumentation)
{
    const __step = 'buildProviders';
    let __stepError = null;
    try {
        if (emitter && operationId) {
            emitter.startStep('background-cycle', __step, tenantIds[i]);
            emitter.emitProgress(operationId, { /* ... */ });
        }
        logGenerator(logFileName, 'info', `[START] Iniciando buildProvidersXML para el índice ${i}`);
        await buildProvidersXML(i);                                 // ← ROOT-03 D-12: wrap THIS line
        logGenerator(logFileName, 'info', `[COMPLETE] buildProvidersXML completado para el índice ${i}`);
    } catch (stepErr) {
        __stepError = stepErr.message || String(stepErr);
        throw stepErr;                                              // re-throw to existing tenant-catch at line 243
    } finally {
        if (emitter && operationId) {
            emitter.endStep('background-cycle', __step, tenantIds[i], { error: __stepError });
        }
    }
}
```

**Patrón a seguir (D-10 explícito):**
```javascript
// src/background.js (REFACTORED — example for buildProviders, copy across all 7 steps)
{
    const __step = 'buildProviders';
    let __stepError = null;
    try {
        if (emitter && operationId) {
            emitter.startStep('background-cycle', __step, tenantIds[i]);
            emitter.emitProgress(operationId, { /* ... */ });
        }
        logGenerator(logFileName, 'info', `[START] Iniciando buildProvidersXML para el índice ${i}`);

        // ROOT-03 / D-10: per-step timeout via Promise.race.
        // Phantom continuation aceptada (D-10) — la promise original sigue corriendo en background;
        // ROOT-01 axios timeout (30s) aborta HTTP requests colgados. Step timeout es la cota superior.
        const stepTimeoutMs = config.schedule.stepTimeoutMs;
        const stepTimeoutPromise = new Promise((_, reject) =>
            setTimeout(
                () => reject(new Error(`Step timeout after ${formatDurationMin(stepTimeoutMs)} — step=${__step} tenant=${tenantIds[i]}`)),
                stepTimeoutMs
            )
        );
        await Promise.race([buildProvidersXML(i), stepTimeoutPromise]);

        logGenerator(logFileName, 'info', `[COMPLETE] buildProvidersXML completado para el índice ${i}`);
    } catch (stepErr) {
        __stepError = stepErr.message || String(stepErr);
        // ROOT-04 D-13: log [TIMEOUT] entry IF this was a step timeout (else logs as normal step error)
        if (/Step timeout/.test(__stepError)) {
            logGenerator(logFileName, 'error',
                `[TIMEOUT] step=${__step} tenant=${tenantIds[i]} ` +
                `durationMs=${config.schedule.stepTimeoutMs} err=${__stepError}`);
        }
        throw stepErr;                                              // re-throw to tenant-catch (D-09)
    } finally {
        if (emitter && operationId) {
            emitter.endStep('background-cycle', __step, tenantIds[i], { error: __stepError });
        }
    }
}
```

**Imports a extender (línea 12):**
```javascript
// src/background.js:1-13 (current)
const { spawn } = require('child_process');                       // ← extend to: const { spawn, exec } = require('child_process'); (ROOT-02)
const { checkPayments } = require('./controller/SagePaymentController');
const { uploadPayments } = require('./controller/PortalPaymentController');
const { downloadCFDI } = require('./controller/CFDI_Downloader');
const { createPurchaseOrders } = require('./controller/PortalOC_Creator');
const { closePurchaseOrders } = require('./controller/PortalOC_Closer');
const { processOrderChanges } = require('./controller/PortalOC_LifecycleManager');
const { buildProvidersXML } = require('./controller/Providers_Downloader');
const { sendMail } = require('./utils/EmailSender');
const { logGenerator } = require('./utils/LogGenerator');
const { getCurrentDate } = require('./utils/TimezoneHelper');
const config = require('./config');
const notifier = require('node-notifier');
```

**Patrón a seguir:** agregar `const { formatDurationMin } = require('./utils/duration');` (siguiendo el patrón de `CronScheduler.js:22`). Si el planner extrae a `withStepTimeout(...)` helper en duration.js, importar `withStepTimeout` también.

**Helper opcional (`src/utils/duration.js` — extend):**
Si el planner decide extraer el inline Promise.race a un helper reutilizable (Claude's Discretion):
```javascript
// src/utils/duration.js (extension — ADD function)
/**
 * Race a promise against a step timeout. Rejects with a labeled Error if `ms` elapses
 * before the promise settles. Accepts phantom continuation (the wrapped promise keeps
 * running in background even after rejection — see Phase 19 D-10 for tolerance reasoning).
 *
 * @param {Promise<T>|() => Promise<T>} promiseOrFn - Either a Promise or a function returning one.
 * @param {number} ms - Timeout in milliseconds.
 * @param {string} label - Human-readable step label included in the error message.
 * @returns {Promise<T>}
 */
function withStepTimeout(promiseOrFn, ms, label) {
    const promise = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
            () => reject(new Error(`Step timeout after ${formatDurationMin(ms)} — ${label}`)),
            ms
        )
    );
    return Promise.race([promise, timeoutPromise]);
}

module.exports = { formatDurationMin, withStepTimeout };
```

Y en `background.js`:
```javascript
await withStepTimeout(buildProvidersXML(i), config.schedule.stepTimeoutMs, `step=${__step} tenant=${tenantIds[i]}`);
```

**Recomendación del mapper:** extraer a `withStepTimeout` — es 5 líneas en `duration.js`, hace los 7 bloques de `forResponse` un one-liner cada uno, y mantiene `duration.js` como el lugar canónico para utilities relacionadas a duración/timing. **NO** crear `src/utils/promiseTimeout.js` separado (over-engineering).

**Convenciones críticas:**
- **Phantom continuation aceptada (D-10)** — el `setTimeout` del stepTimeoutPromise NO se cancela explícitamente cuando `stepFn(i)` resuelve primero; Node lo limpia cuando el Promise se garbage collecta. Si en producción always-on se observa "timer accumulation" (warning del event loop), la mitigación es agregar `.unref()` al setTimeout. Defer (línea 178 de CONTEXT).
- **Tenant-catch boundary preservado (D-09)** — el `throw stepErr` propaga al tenant-catch de `background.js:243`. CERO código nuevo de control flow.
- **NO incluye `startChildProcess`** (D-12 explícito) — `startChildProcess` tiene su propio timeout 10 min via ROOT-02. Doble timeout = race entre los dos = step timeout 5min dispararía primero y dejaría child huérfano.
- **NO envolver el `await new Promise(resolve => setTimeout(resolve, delay))`** entre steps (línea 66) — es delay intencional, no work item.
- **Error message formato** — el regex `/Step timeout/` en el catch detecta step timeouts vs otros errors. Si el wording cambia, sincronizar el log. Match con el patrón de `Child process timeout` para detectar child timeouts.

**Anti-patterns a evitar:**
- **NO** introducir `AbortController` / `signal: AbortSignal` propagation a los 10 controllers/utils — D-10 explícitamente lo defer hasta que evidencia operacional muestre que la phantom continuation causa problemas (resource leaks, FD leaks, memoria). Phase 19 mantiene blast radius mínimo.
- **NO** envolver el bloque entero `{ const __step; ... }` con Promise.race — solo el `await stepFn(i)` interno. La estructura externa (try/catch/finally + endStep) DEBE seguir corriendo aún cuando el step timeout dispare, para que stepProgress se cierre correctamente.
- **NO** duplicar el `formatDurationMin` import si ya viene del withStepTimeout helper — un solo `require` arriba.
- **NO** usar `Promise.race` con un array de 3+ promises — el patrón es estrictamente `[stepFn(i), stepTimeoutPromise]`. Agregar un tercer "abort signal" aquí sería el AbortController retrofit que D-10 difiere.

---

## ROOT-04 — Logging + email distribution

### 4.1. `src/services/CronScheduler.js` (continuación — log routing)

**Ya cubierto en §2.2 + §1.x.** Recap de las decisiones de routing:

| Timeout source | Log file destino | Email? | Detección |
|----------------|------------------|--------|-----------|
| ROOT-01 axios timeout | `LOG_FILE` del caller (e.g., `'CFDI_Downloader'`, `'GetTypesCFDI'`, `'PortalPaymentController'`) | NO (D-15) | `err.code === 'ECONNABORTED' \|\| /timeout/i.test(err.message)` |
| ROOT-02 child timeout | `'ChildProcess'` log + `'CronScheduler'` log (D-14 paridad) | SÍ (`sendAdminAlert`) | `/Child process timeout/.test(err.message)` en CronScheduler.js catch |
| ROOT-03 step timeout | `'ForResponse'` log (file name del caller) | NO (D-15) | `/Step timeout/.test(err.message)` en background.js catch |

### 4.2. Plain text format (D-13)

**Patrón de log entry (D-16 mandatory keys: `step`, `tenant`, `url`, `durationMs`):**
```javascript
logGenerator(LOG_FILE, 'error',
    `[TIMEOUT] step=${stepName} tenant=${tenantId ?? 'global'} url=${url ?? 'n/a'} durationMs=${durationMs}`);
```

**Analog directo:** Phase 18 listener at `CronScheduler.js:229-232`:
```javascript
// src/services/CronScheduler.js:229-232 (current — Phase 18 [TIMEOUT] line)
logGenerator(LOG_FILE, 'warn',
    `[TIMEOUT] Auto-released lock ${operationType} after ${durationLabel} -- ` +
    `operationId=${operationId}, stuckOnStep=${stuckOnStep || '(none)'}, stuckOnTenant=${stuckOnTenant || '(none)'}`
);
```

**Patrón a seguir:** mismo prefix `[TIMEOUT]`, mismo separator `key=value`, plain ASCII. Operadores grepean `grep "\[TIMEOUT\]" logs/sageconnect/*/*.log` y obtienen un view de todos los timeouts del milestone (los de Phase 18 lock-timeout + los de Phase 19 axios/child/step).

**Anti-patterns a evitar:**
- **NO** JSON estructurado: el codebase no usa logs estructurados (deferred Phase 19 line 358).
- **NO** metadata Winston via segundo argumento: el wrapper `logGenerator` no soporta el meta arg hoy (verificar antes de introducirlo).
- **NO** stack traces en el log line: D-16 los excluye (los stacks de timeout apuntan al timer, no al call site origen, dando información poco útil).
- **NO** crear un log file `'Timeouts.log'` centralizado — D-14 explícitamente lo rechaza ("rompería el patrón").

### 4.3. `sendAdminAlert` reuse (D-15 — solo child timeout)

**Helper inline en `src/services/CronScheduler.js:46-70`** (Phase 18 D-08 — DOCUMENTADO en CONTEXT.md line 39):
```javascript
// src/services/CronScheduler.js:46-70 (current — Phase 18 helper, REUSE for ROOT-02)
async function sendAdminAlert(subject, html) {
    try {
        const transportConfig = {
            host: config.mailing.server,
            port: config.mailing.port,
            secure: config.mailing.ssl,
        };
        if (config.mailing.password) {
            transportConfig.auth = {
                user: config.mailing.from,
                pass: config.mailing.password,
            };
        }
        const transport = nodemailer.createTransport(transportConfig);
        await transport.sendMail({
            from: config.mailing.from,
            to: config.license.adminEmail,
            subject,
            html,
        });
        logGenerator(LOG_FILE, 'info', '[ADMIN-EMAIL] Sent to ' + config.license.adminEmail + ': ' + subject);
    } catch (err) {
        logGenerator(LOG_FILE, 'warn', '[ADMIN-EMAIL] Failed to send timeout alert: ' + err.message);
    }
}
```

**Convenciones (heredadas de Phase 18 PATTERNS S-6):**
1. Recipient = `config.license.adminEmail` (NO `config.mailing.notices`).
2. Subject prefix `'[SageConnect] '` literal.
3. try/catch swallow — falla del email JAMÁS bloquea la recovery.
4. `html` body include todos los keys de D-16 (`step`, `tenant`, `pid`, `duration`, `importRoute`).

**Anti-patterns a evitar:**
- **NO** crear `sendChildTimeoutAlert` separado — el helper actual recibe `(subject, html)` arbitrarios; cualquier subject + body funciona.
- **NO** mover `sendAdminAlert` a `src/utils/AdminEmailSender.js` en Phase 19 — Phase 18 PATTERNS line 549 explícitamente recomendó "inline para Phase 18, refactor cuando aparezcan más admin-email events". Phase 19 SOLO agrega 1 nuevo subject (child timeout) — sigue siendo 2 sites total. Defer la extracción.

---

## ROOT-X (cross-cutting) — `src/config.js` (modify, 3 nuevas knobs)

**Analog (interno):** `lockTimeoutMs` at line 169 + range guard at lines 174-177 (Phase 18 D-01).

**Estructura existente del schedule block (líneas 165-170):**
```javascript
// src/config.js:165-170 (current)
schedule: {
    cronExpression: process.env.CRON_SCHEDULE || '*/15 * * * *',
    operationDelayMs: parseInt(process.env.OPERATION_DELAY_MS, 10) || 5000,
    // REC-01 (D-01): auto-release timeout for OperationManager locks. Env override: LOCK_TIMEOUT_MS. Default 14 min (~93% of 15 min cron cadence).
    lockTimeoutMs: parseInt(process.env.LOCK_TIMEOUT_MS, 10) || 14 * 60 * 1000,
},
```

**Range guard existente (líneas 173-177):**
```javascript
// src/config.js:173-177 (current — exact template para los 3 nuevos guards)
// REC-01 (D-01): defensive bound — values < 60000 ms (1 min) almost certainly indicate misconfiguration.
if (config.schedule.lockTimeoutMs < 60000) {
    console.error('[CONFIG ERROR] LOCK_TIMEOUT_MS must be >= 60000 (1 min). Got: ' + config.schedule.lockTimeoutMs);
    process.exit(1);
}
```

**Patrón a seguir (3 nuevas knobs siguiendo el mismo molde):**
```javascript
// src/config.js (REFACTORED — extend schedule block)
const config = {
    // ... existing sections ...

    portal: {
        url: process.env.URL,
        tenants: parseTenants(),
        // ROOT-01 (D-03): timeout para todas las llamadas axios al portal de proveedores.
        // Env override: PORTAL_HTTP_TIMEOUT_MS. Default 30s (texto literal de REQ ROOT-01).
        httpTimeoutMs: parseInt(process.env.PORTAL_HTTP_TIMEOUT_MS, 10) || 30000,
    },

    // ... existing sections ...

    schedule: {
        cronExpression: process.env.CRON_SCHEDULE || '*/15 * * * *',
        operationDelayMs: parseInt(process.env.OPERATION_DELAY_MS, 10) || 5000,
        lockTimeoutMs: parseInt(process.env.LOCK_TIMEOUT_MS, 10) || 14 * 60 * 1000,
        // ROOT-02 (D-07): timeout para el child process ImportaFacturasFocaltec.exe.
        // Env override: CHILD_PROCESS_TIMEOUT_MS. Default 10 min (texto literal de REQ ROOT-02).
        childProcessTimeoutMs: parseInt(process.env.CHILD_PROCESS_TIMEOUT_MS, 10) || 10 * 60 * 1000,
        // ROOT-03 (D-11): per-step timeout para los 7 steps de forResponse.
        // Env override: STEP_TIMEOUT_MS. Default 5 min (texto literal de REQ ROOT-03).
        stepTimeoutMs: parseInt(process.env.STEP_TIMEOUT_MS, 10) || 5 * 60 * 1000,
    },
};

// EXISTING guard (preserved):
if (config.schedule.lockTimeoutMs < 60000) {
    console.error('[CONFIG ERROR] LOCK_TIMEOUT_MS must be >= 60000 (1 min). Got: ' + config.schedule.lockTimeoutMs);
    process.exit(1);
}

// ROOT-01 (D-03): axios timeout puede legítimamente ser sub-segundo en pruebas, pero < 1000ms es signal de misconfig.
if (config.portal.httpTimeoutMs < 1000) {
    console.error('[CONFIG ERROR] PORTAL_HTTP_TIMEOUT_MS must be >= 1000 (1 sec). Got: ' + config.portal.httpTimeoutMs);
    process.exit(1);
}

// ROOT-02 (D-07): mínimo 1 min para evitar misconfigs catastróficas.
if (config.schedule.childProcessTimeoutMs < 60000) {
    console.error('[CONFIG ERROR] CHILD_PROCESS_TIMEOUT_MS must be >= 60000 (1 min). Got: ' + config.schedule.childProcessTimeoutMs);
    process.exit(1);
}

// ROOT-03 (D-11): mínimo 30s para evitar timeouts triviales que disparen falso positivo.
if (config.schedule.stepTimeoutMs < 30000) {
    console.error('[CONFIG ERROR] STEP_TIMEOUT_MS must be >= 30000 (30 sec). Got: ' + config.schedule.stepTimeoutMs);
    process.exit(1);
}
```

**Convenciones críticas:**
1. **Mínimos por env var** (D-03, D-07, D-11):
   - `PORTAL_HTTP_TIMEOUT_MS` ≥ 1000 (1s — axios puede ser sub-segundo legítimamente, pero < 1s es misconfig)
   - `CHILD_PROCESS_TIMEOUT_MS` ≥ 60000 (1 min — el exe necesita arrancar)
   - `STEP_TIMEOUT_MS` ≥ 30000 (30s — un step típico tiene 1-3 axios calls + DB; <30s es trivial)
2. **Defaults match literal con REQs** — D-03/D-07/D-11 enfatizan no anticipar producción.
3. **`portal.httpTimeoutMs` vive bajo `portal:` block, no `schedule:`** — cohesión semántica (es del portal, no del scheduler). Match con `portal.url` y `portal.tenants`.
4. **Los 3 timeouts NO van a `REQUIRED`** — tienen defaults sensatos. Agregarlos a `REQUIRED` rompería backward-compat de toda `.env` en producción.
5. **Range guards después del `const config = {...}`** — consistente con el guard existente at line 174.
6. **`process.exit(1)` en lugar de `throw`** — consistente con `validate()` at line 55.

**Anti-patterns a evitar:**
- **NO** poner las 3 knobs en una sub-section `timeouts: { http: ..., child: ..., step: ... }` — rompería compat con la convención `config.section.knob` existente y requeriría cambios estructurales en multiple call sites. CONTEXT explícitamente confirma: `config.portal.httpTimeoutMs`, `config.schedule.childProcessTimeoutMs`, `config.schedule.stepTimeoutMs`.
- **NO** unificar los 3 guards en un loop genérico (`[{key, min, label}].forEach(...)`) — el guard existente es plain inline; agregar abstraction layer es over-engineering para 3 sites.
- **NO** validar maximums (e.g., "step timeout no debe exceder lock timeout") — D-11 lo deja como "constraint operacional, no validation"; el lock auto-release de Phase 18 cubre el caso patológico. Documentar en runbook si aplica.
- **NO** introducir `dotenv-safe` o `joi` para config validation — el codebase usa raw `process.env` parse + `validate()` plain function. Mantener simplicidad.

---

## Test Pattern Assignments

### T.1. `tests/utils/PortalClient.test.js` (CREATE)

**Analog:** `tests/utils/log-generator.test.js` (helper testing pattern) + `tests/services/OperationManager.timer.test.js:18-22` (config mock pattern).

**Estructura propuesta:**
```javascript
// tests/utils/PortalClient.test.js (NEW)
const { describe, test, expect } = require('@jest/globals');

// Mock config.js antes de cualquier require
jest.mock('../../src/config', () => ({
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs' },
    schedule: { lockTimeoutMs: 60000, cronExpression: '*/15 * * * *', operationDelayMs: 5000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
    portal: { url: 'http://test', tenants: [], httpTimeoutMs: 12345 },  // ← non-default value to verify it propagates
}));

describe('PortalClient (Phase 19, ROOT-01)', () => {
    test('exports an axios instance with timeout from config.portal.httpTimeoutMs', () => {
        const portalClient = require('../../src/utils/PortalClient');
        expect(portalClient.defaults.timeout).toBe(12345);
    });

    test('exports an axios instance with Accept: application/json header', () => {
        const portalClient = require('../../src/utils/PortalClient');
        expect(portalClient.defaults.headers.Accept).toBe('application/json');
    });

    test('returns the same singleton instance across requires (cached)', () => {
        const a = require('../../src/utils/PortalClient');
        const b = require('../../src/utils/PortalClient');
        expect(a).toBe(b);
    });

    test('exposes axios verbs (get, post, put, delete)', () => {
        const portalClient = require('../../src/utils/PortalClient');
        expect(typeof portalClient.get).toBe('function');
        expect(typeof portalClient.post).toBe('function');
        expect(typeof portalClient.put).toBe('function');
        expect(typeof portalClient.delete).toBe('function');
    });
});
```

**Convenciones (Phase 18 patterns S-9 — Test mocks for config validation bypass):** mockear `src/config` ANTES de cualquier require para evitar `process.exit(1)` desde `validate()`.

---

### T.2. `tests/services/background.startChildProcess.timeout.test.js` (CREATE)

**Analog:** `tests/services/OperationManager.timer.test.js:37-46` (`jest.useFakeTimers()` + `_reset` reuse) + `tests/services/cron-scheduler.test.js:14-22` (mock task pattern).

**Estructura propuesta — challenge: mockear `child_process.spawn` Y `exec`:**
```javascript
// tests/services/background.startChildProcess.timeout.test.js (NEW)
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const { EventEmitter } = require('events');

// Mock config (siguiendo S-9)
jest.mock('../../src/config', () => ({
    schedule: { childProcessTimeoutMs: 1000, stepTimeoutMs: 300000, operationDelayMs: 5000, lockTimeoutMs: 60000 },
    app: { importRoute: 'C:\\fake\\ImportaFacturasFocaltec.exe', arg: 'arg', timezone: 'America/Mexico_City', company: 'TestCo' },
    portal: { tenants: [], httpTimeoutMs: 30000 },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', password: '' },
    license: { adminEmail: 'admin@test.com' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs' },
}));

// Mock child_process — fake spawn returns an EventEmitter we control
let fakeChild;
const mockSpawn = jest.fn(() => fakeChild);
const mockExec = jest.fn();
jest.mock('child_process', () => ({
    spawn: mockSpawn,
    exec: mockExec,
}));

// Mock LogGenerator
const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

// Mock other deps that background.js requires
jest.mock('../../src/utils/EmailSender', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
jest.mock('node-notifier', () => ({ notify: jest.fn() }));
jest.mock('../../src/utils/TimezoneHelper', () => ({ getCurrentDate: () => new Date('2026-04-29T00:00:00Z') }));
// Stubs for downstream controllers (forResponse not exercised here)
jest.mock('../../src/controller/SagePaymentController', () => ({ checkPayments: jest.fn() }));
jest.mock('../../src/controller/PortalPaymentController', () => ({ uploadPayments: jest.fn() }));
jest.mock('../../src/controller/CFDI_Downloader', () => ({ downloadCFDI: jest.fn() }));
jest.mock('../../src/controller/PortalOC_Creator', () => ({ createPurchaseOrders: jest.fn() }));
jest.mock('../../src/controller/PortalOC_Closer', () => ({ closePurchaseOrders: jest.fn() }));
jest.mock('../../src/controller/PortalOC_LifecycleManager', () => ({ processOrderChanges: jest.fn() }));
jest.mock('../../src/controller/Providers_Downloader', () => ({ buildProvidersXML: jest.fn() }));

describe('startChildProcess timeout (Phase 19, ROOT-02)', () => {
    let startChildProcess;

    beforeEach(() => {
        jest.useFakeTimers();
        mockSpawn.mockClear();
        mockExec.mockClear();
        mockLogGenerator.mockClear();
        // fakeChild is a fresh EventEmitter per test, with stdout/stderr sub-emitters and exitCode field
        fakeChild = new EventEmitter();
        fakeChild.stdout = new EventEmitter();
        fakeChild.stderr = new EventEmitter();
        fakeChild.kill = jest.fn();
        fakeChild.pid = 9999;
        fakeChild.exitCode = null;        // simulate "still running"

        jest.isolateModules(() => {
            ({ startChildProcess } = require('../../src/background'));
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('rejects with timeout error after childProcessTimeoutMs', async () => {
        const promise = startChildProcess();
        jest.advanceTimersByTime(1001);   // > 1000 ms config
        await expect(promise).rejects.toThrow(/Child process timeout after/);
    });

    test('calls child.kill() (SIGTERM) when timeout fires', async () => {
        const promise = startChildProcess();
        promise.catch(() => {});           // suppress unhandled
        jest.advanceTimersByTime(1001);
        expect(fakeChild.kill).toHaveBeenCalled();
    });

    test('calls taskkill /F /T /PID after 30s grace period if exitCode still null', async () => {
        const promise = startChildProcess();
        promise.catch(() => {});
        jest.advanceTimersByTime(1001);    // primary timeout fires kill()
        jest.advanceTimersByTime(30001);   // grace expires
        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('taskkill /F /T /PID 9999'),
            expect.any(Function)
        );
    });

    test('does NOT call taskkill if process closes during grace period', async () => {
        const promise = startChildProcess();
        promise.catch(() => {});
        jest.advanceTimersByTime(1001);
        // Simulate process closing during grace
        fakeChild.exitCode = 1;
        fakeChild.emit('close', 1);
        jest.advanceTimersByTime(30001);
        expect(mockExec).not.toHaveBeenCalled();
    });

    test('clears killTimer on close (no fire-after-resolve)', async () => {
        const promise = startChildProcess();
        // Simulate clean close before timeout
        setImmediate(() => {
            fakeChild.exitCode = 0;
            fakeChild.emit('close', 0);
        });
        jest.advanceTimersByTime(50);
        await jest.runAllTicks();
        await expect(promise).resolves.toBe(0);

        // Now advance past timeout — kill MUST NOT fire
        jest.advanceTimersByTime(2000);
        expect(fakeChild.kill).not.toHaveBeenCalled();
    });

    test('hasSettled prevents double-settle on close-during-grace race', async () => {
        const events = [];
        const promise = startChildProcess().catch((err) => events.push({ type: 'reject', err })).then((v) => events.push({ type: 'resolve', v }));
        jest.advanceTimersByTime(1001);    // kill fires + timer schedules taskkill
        // Simulate clean close DURING grace period
        fakeChild.exitCode = 0;
        fakeChild.emit('close', 0);
        await jest.runAllTicks();
        // Promise must have settled exactly once (reject from timeout, since it fired first)
        expect(events.filter((e) => e.type === 'reject').length).toBeLessThanOrEqual(1);
    });

    test('logs [TIMEOUT] entry on ChildProcess log when timeout fires', async () => {
        const promise = startChildProcess();
        promise.catch(() => {});
        jest.advanceTimersByTime(1001);
        const timeoutLog = mockLogGenerator.mock.calls.find(
            (c) => c[0] === 'ChildProcess' && /\[TIMEOUT\]/.test(c[2])
        );
        expect(timeoutLog).toBeDefined();
        expect(timeoutLog[2]).toContain('startChildProcess');
        expect(timeoutLog[2]).toContain('pid=9999');
    });
});
```

**Convenciones críticas:**
- **`jest.useFakeTimers()` + `advanceTimersByTime(N)`** — patrón heredado de `OperationManager.timer.test.js:39-46`. Los tests corren sincrónicos.
- **`fakeChild` como `EventEmitter`** — el `spawn` real retorna un ChildProcess que EXTIENDE EventEmitter; mockearlo con un `new EventEmitter()` + sub-emitters para `stdout`/`stderr` + `kill` jest.fn + `pid` + `exitCode` es la forma idiomática.
- **`exitCode` mutation simula process state** — `null` = running, número = exited.
- **`promise.catch(() => {})`** dentro de tests que esperan rejection — evita `UnhandledPromiseRejectionWarning` cuando los timers todavía no han avanzado lo suficiente para settle.
- **`jest.isolateModules` para fresh load** — Phase 18 pattern (cron-scheduler.test.js:91-94).

**Anti-patterns a evitar:**
- **NO** usar `setTimeout` real con valores cortos (e.g., 50ms) — produce flaky tests y depende del scheduler. Fake timers garantizan determinismo.
- **NO** mockear todo `src/background` — solo necesitamos exercise `startChildProcess`. Los demás exports (`forResponse`, `startBackgroundProcesses`) NO son necesarios pero tampoco rompen.

---

### T.3. `tests/services/background.forResponse.stepTimeout.test.js` (CREATE)

**Analog:** `tests/services/cron-scheduler.test.js` (mock layout para forResponse downstream) + `tests/services/OperationManager.timer.test.js:171-185` (advanceTimersByTime + assertions de stepProgress).

**Estructura propuesta — challenge: mockear ONE controller para que cuelgue, verificar tenant skip:**
```javascript
// tests/services/background.forResponse.stepTimeout.test.js (NEW — esquema)
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

jest.mock('../../src/config', () => ({
    schedule: { stepTimeoutMs: 1000, operationDelayMs: 0, childProcessTimeoutMs: 600000, lockTimeoutMs: 60000, cronExpression: '*/15 * * * *' },
    portal: { url: 'http://test', tenants: [{ id: 'T1' }, { id: 'T2' }], httpTimeoutMs: 30000 },
    app: { timezone: 'America/Mexico_City', importRoute: 'fake', arg: 'arg' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test' },
    license: { adminEmail: 'admin@test.com' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs' },
}));

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

// Mock the step controller (any one of the 7) to hang indefinitely
const hangingPromise = new Promise(() => {});  // never resolves
jest.mock('../../src/controller/Providers_Downloader', () => ({
    buildProvidersXML: jest.fn(() => hangingPromise),
}));
jest.mock('../../src/controller/CFDI_Downloader', () => ({ downloadCFDI: jest.fn().mockResolvedValue() }));
jest.mock('../../src/controller/SagePaymentController', () => ({ checkPayments: jest.fn().mockResolvedValue() }));
jest.mock('../../src/controller/PortalPaymentController', () => ({ uploadPayments: jest.fn().mockResolvedValue() }));
jest.mock('../../src/controller/PortalOC_Creator', () => ({ createPurchaseOrders: jest.fn().mockResolvedValue() }));
jest.mock('../../src/controller/PortalOC_Closer', () => ({ closePurchaseOrders: jest.fn().mockResolvedValue() }));
jest.mock('../../src/controller/PortalOC_LifecycleManager', () => ({ processOrderChanges: jest.fn().mockResolvedValue() }));
jest.mock('../../src/utils/EmailSender', () => ({ sendMail: jest.fn() }));
jest.mock('node-notifier', () => ({ notify: jest.fn() }));
jest.mock('child_process', () => ({ spawn: jest.fn(), exec: jest.fn() }));

describe('forResponse step timeout (Phase 19, ROOT-03)', () => {
    let forResponse;
    let mockEmitter;

    beforeEach(() => {
        jest.useFakeTimers();
        mockLogGenerator.mockClear();
        mockEmitter = {
            startStep: jest.fn(),
            endStep: jest.fn(),
            emitProgress: jest.fn(),
        };

        jest.isolateModules(() => {
            ({ forResponse } = require('../../src/background'));
        });
    });

    afterEach(() => { jest.useRealTimers(); });

    test('Promise.race rejects after STEP_TIMEOUT_MS when step hangs', async () => {
        const promise = forResponse({ operationId: 'op-test', emitter: mockEmitter });
        jest.advanceTimersByTime(1001);
        await jest.runAllTicks();
        // The step throws; tenant-catch swallows; loop moves on
        await expect(promise).resolves.toBeUndefined();
    });

    test('tenant-catch atrapa step timeout; siguiente tenant continúa', async () => {
        const promise = forResponse({ operationId: 'op-test', emitter: mockEmitter });
        jest.advanceTimersByTime(1001);
        await jest.runAllTicks();
        await promise;

        // Tenant T1 se interrumpió en buildProviders; tenant T2 corre normalmente
        const mockBuild = require('../../src/controller/Providers_Downloader').buildProvidersXML;
        expect(mockBuild).toHaveBeenCalledTimes(2);    // T1 + T2 ambos invocados (T1 timeout, T2 corrió OK con stub)

        const mockDownload = require('../../src/controller/CFDI_Downloader').downloadCFDI;
        // T1 NO ejecutó downloadCFDI (timeout en buildProviders interrumpió cascade)
        // T2 SÍ ejecutó downloadCFDI (started fresh)
        expect(mockDownload.mock.calls.some((c) => c[0] === 1)).toBe(true);  // T2 (index 1)
    });

    test('endStep registra error con [TIMEOUT] message on stepProgress', async () => {
        const promise = forResponse({ operationId: 'op-test', emitter: mockEmitter });
        jest.advanceTimersByTime(1001);
        await jest.runAllTicks();
        await promise;

        const buildEndStep = mockEmitter.endStep.mock.calls.find((c) => c[1] === 'buildProviders');
        expect(buildEndStep).toBeDefined();
        expect(buildEndStep[3]).toEqual({ error: expect.stringMatching(/Step timeout after/) });
    });

    test('logs [TIMEOUT] entry to ForResponse log on step timeout', async () => {
        const promise = forResponse({ operationId: 'op-test', emitter: mockEmitter });
        jest.advanceTimersByTime(1001);
        await jest.runAllTicks();
        await promise;

        const timeoutLog = mockLogGenerator.mock.calls.find(
            (c) => c[0] === 'ForResponse' && /\[TIMEOUT\]/.test(c[2])
        );
        expect(timeoutLog).toBeDefined();
        expect(timeoutLog[2]).toContain('step=buildProviders');
        expect(timeoutLog[2]).toContain('tenant=T1');
    });
});
```

**Convenciones:**
- **`hangingPromise = new Promise(() => {})`** — nunca resuelve, simula step colgado. Pattern simple sin needing flushPromises gymnastics.
- **`jest.runAllTicks()` después de `advanceTimersByTime`** — permite que rejection promises propaguen al catch handler.
- **Mock `tenants: [T1, T2]`** — verifica que tenant-catch boundary funciona (T1 falla, T2 sigue).

**Anti-patterns a evitar:**
- **NO** intentar mockear con `Promise.reject(new Error('timeout'))` directamente — eso prueba el catch handler pero no el Promise.race wiring.
- **NO** usar real timers con `setTimeout(..., 1100)` — flaky en CI lento.

---

### T.4. `tests/services/CronScheduler.timeout-listener.test.js` (extend, archivo existe)

**Patrón:** el archivo existe (Phase 18 Plan 18-01). Phase 19 agrega tests para:
1. Child timeout dispara `sendAdminAlert` con subject `[SageConnect] Child process timeout: ...`.
2. Axios timeout (simulado via mock de `lock:timeout` con un cycle que falló por axios) NO dispara email.
3. Step timeout (simulado via cycle finished_at presente con error `Step timeout`) NO dispara email.

**Convención (D-15 explícito):** solo child-timeout dispara email; los otros NO. El test debe verificar que `mockNodemailerSendMail` se llama UNA vez con subject específico de child timeout, y CERO veces con subjects de axios/step timeouts.

```javascript
// tests/services/CronScheduler.timeout-listener.test.js (EXTEND)
test('child timeout dispatches sendAdminAlert with [SageConnect] Child process timeout subject', async () => {
    CronScheduler.initScheduler();
    // Trigger via the cron callback path — the listener for axios/step has no path for emit
    // Instead, verify CronScheduler.js's startChildProcess catch handler in isolation OR
    // verify integration via a direct emit of a synthetic 'lock:timeout' that includes the child error
    // (This is a planner decision — the CronScheduler-level child-timeout email is dispatched
    // INSIDE the cron callback, not from the lock:timeout listener.)
    // Suggested: extract a separate dispatchChildTimeoutAlert helper for testability.
});

test('axios timeout does NOT dispatch sendAdminAlert (D-15)', async () => {
    // No path-level test possible here — assert via integration test below
});
```

**Recomendación:** este test es secundario; el comportamiento se verifica más naturalmente con `tests/integration/timeout-logging.test.js` (T.5). El planner puede saltarlo o limitarlo a "no `lock:timeout` event listener triggers child-timeout email".

---

### T.5. `tests/integration/timeout-logging.test.js` (CREATE — nueva carpeta)

**Analog:** no hay precedente directo de "tests/integration/" — Phase 19 introduce la carpeta. El analog conceptual es `tests/utils/log-generator.test.js` (verifica el wrapper Winston).

**Patrón propuesto:**
```javascript
// tests/integration/timeout-logging.test.js (NEW)
// Integration: verifica que cada path de timeout (axios / child / step) genere
// un `[TIMEOUT]` entry en su LOG_FILE correspondiente con todos los keys de D-16.
const { describe, test, expect, beforeEach } = require('@jest/globals');

// Mocks (compartidos con T.2/T.3) — config + LogGenerator + child_process + portalClient
// ... (idéntico setup) ...

describe('Timeout logging integration (Phase 19, ROOT-04)', () => {
    test('axios timeout → [TIMEOUT] entry in caller LOG_FILE with step+tenant+url+durationMs', async () => {
        // Mock portalClient para que rechace con err.code='ECONNABORTED'
        // Invocar el caller (e.g., CFDI_Downloader.downloadCFDI)
        // Verificar mockLogGenerator se llamó con LOG_FILE='CFDI_Downloader' y mensaje conteniendo [TIMEOUT] step= tenant= url= durationMs=
    });

    test('child timeout → [TIMEOUT] entry in ChildProcess.log AND CronScheduler.log + admin email', async () => {
        // Setup desde T.2 (fakeChild + advance timers)
        // Verify TWO log calls — ChildProcess + CronScheduler
        // Verify mockNodemailerSendMail called ONCE with [SageConnect] Child process timeout subject
    });

    test('step timeout → [TIMEOUT] entry in ForResponse.log, NO email', async () => {
        // Setup desde T.3 (hanging step)
        // Verify mockLogGenerator with LOG_FILE='ForResponse' [TIMEOUT]
        // Verify mockNodemailerSendMail NOT called (D-15)
    });
});
```

**Convenciones:**
- **Carpeta nueva `tests/integration/`** — el planner debe crear la carpeta. Match con el patrón existente `tests/services/`, `tests/utils/`, `tests/api/`.
- **Suite naming** — match con la convención `<scenario>-<aspecto>.test.js` (ej: `timeout-logging.test.js`, `force-release.test.js`).

---

## §S Critical Conventions

### §S-1. Phase 19 boundary: "phantom continuation" se NARROW, no se carga wholesale

**Source:** Phase 18 D-03 + Phase 19 D-10 + REQ ROOT-01.

Phase 18 toleró "phantom continuation" porque NO tenía mecanismo para abortar work HTTP / child process en vuelo. Phase 19 introduce abort REAL para HTTP (axios timeout = `err.code === 'ECONNABORTED'`) y child process (kill cascade). Solo el step-level Promise.race retiene la phantom continuation, porque los promises ya creados no son cancelables sin AbortController retrofit (deferred).

**Apply to:** todo el wording de PATTERNS.md y cualquier doc downstream. **NO** copiar literal el "phantom continuation OK" de Phase 18 — Phase 19 lo narrow a step-level only.

### §S-2. Lazy timeoutHandle is internal; getRunningOperations strips it

**Source:** `src/services/OperationManager.js:170-177` (Phase 18 collateral fix `061b7c5`).

```javascript
// src/services/OperationManager.js:170-177
getRunningOperations() {
    const result = {};
    for (const [operationType, slot] of this.locks) {
        const { timeoutHandle, ...serializableSlot } = slot;        // strip the timer
        result[operationType] = serializableSlot;
    }
    return result;
}
```

**Apply to:** ningún cambio para Phase 19, pero el planner debe saber que la convención es "el timer es interno, JAMÁS surface en API/JSON". Si Phase 19 agrega un nuevo timer (kill timer en startChildProcess), DEBE vivir como variable local en el closure del Promise — no como propiedad de un objeto que pueda ser serializado.

### §S-3. ResultEnvelope NO aplica aquí (Phase 19 NO toca rutas Express)

**Source:** Phase 18 patterns S-2.

Phase 19 NO modifica rutas Express. El `forResponse` y `startChildProcess` son funciones internas. El error path es throw → tenant-catch → endStep + log → next tenant. No hay HTTP response shaping.

**Apply to:** anti-pattern — NO importar `ResultEnvelope` ni en `background.js` ni en los controllers. Errores se propagan via throw, no via `errorResult()` envelope.

### §S-4. Logging convention `[PREFIX] key=value` plain ASCII

**Source:** Phase 18 ya estableció `[ADMIN-EMAIL]`, `[OVERLAP]`, `[TIMEOUT]`, `[FORCE-RELEASE-NOOP]`.

**Apply to:** Phase 19 sigue extendiendo `[TIMEOUT]` para axios / child / step paths. Format: `[TIMEOUT] step=<name> tenant=<id|global> url=<url|n/a> durationMs=<num>`. ASCII puro, grepeable, sin escape de caracteres especiales.

### §S-5. Detección de timeouts via regex sobre err.message (no err.code)

**Source:** `src/services/CronScheduler.js:209` (lock:timeout payload con campos directos) — pero para Phase 19, los errors son `Error` plain con messages distintivas.

| Source | Detección | Wording exacto del error |
|--------|-----------|--------------------------|
| ROOT-01 axios | `err.code === 'ECONNABORTED' \|\| /timeout/i.test(err.message)` | axios usa `'timeout of <N>ms exceeded'` |
| ROOT-02 child | `/Child process timeout/.test(err.message)` | manual: `'Child process timeout after Xm — killed (PID was ...)'` |
| ROOT-03 step | `/Step timeout/.test(err.message)` | manual: `'Step timeout after Xm — step=<name> tenant=<id>'` |

**Convención:** los wordings son load-bearing — cambios deben sincronizarse en TODOS los detection sites simultáneamente. El planner DEBE incluir una sección "wording sentinel" en el plan describiendo este invariante.

### §S-6. Test pattern — `jest.useFakeTimers()` + `_reset` + `jest.isolateModules`

**Source:** `tests/services/OperationManager.timer.test.js:37-46` + `tests/services/cron-scheduler.test.js:91-94`.

```javascript
beforeEach(() => {
    jest.useFakeTimers();
    operationManager._reset();
    jest.isolateModules(() => {
        ({ startChildProcess } = require('../../src/background'));
    });
});

afterEach(() => {
    operationManager._reset();
    jest.useRealTimers();
});
```

**Apply to:** todos los nuevos test files (`PortalClient.test.js`, `background.startChildProcess.timeout.test.js`, `background.forResponse.stepTimeout.test.js`, `timeout-logging.test.js`). PortalClient no necesita timers porque solo verifica config propagation.

**Convención S-9 (heredada):** mockear `src/config` antes de cualquier require para evitar `process.exit(1)` desde `validate()`.

### §S-7. NO introducir dependencies nuevas

**Source:** STACK.md — codebase usa axios, mssql, winston, joi, nodemailer, node-cron, child_process estándar.

**Apply to:** Phase 19 SOLO usa lo que YA está en `package.json`:
- `axios` (existente — versión 1.7.7) — usado tanto para `portalClient` como para los call sites individuales (que importan portalClient en vez de axios directo).
- `child_process.spawn` + `child_process.exec` (Node.js built-in) — el `exec` ya no requiere `npm install`.
- Funciones puras nuevas en `src/utils/duration.js` (`withStepTimeout`) — solo built-ins.

**Anti-pattern a evitar:** introducir `p-timeout`, `axios-retry`, `execa`, `cross-spawn`, etc. Cada uno aporta marginalmente y agrega obfuscation surface (recordar: producción usa código obfuscado).

### §S-8. Email del child timeout NO replica EmailSender

**Source:** Phase 18 PATTERNS S-6 línea 1316-1333.

`sendAdminAlert` (helper inline en `CronScheduler.js:46-70`) usa `nodemailer.createTransport` directo, no `EmailSender.sendMail`. Razón: `EmailSender.sendMail` rutea a `config.mailing.notices` (operator mailbox) — child timeout va a `config.license.adminEmail` (admin mailbox).

**Apply to:** el child timeout email Y el axios/step timeout (si en el futuro se agregan, lo cual D-15 actualmente prohíbe) deben usar `sendAdminAlert`, no `sendMail`. Phase 19 ya cumple (D-08 en Phase 18 estableció el helper).

**Anti-pattern a evitar:** crear nuevo helper `sendChildTimeoutMail` paralelo. Reusar `sendAdminAlert(subject, html)` literal.

### §S-9. NO acumular timers / NO leak listener registrations

**Source:** Phase 18 PATTERNS S-1 (lazy-load + initScheduler timing — listener-registration trap) + Phase 18 collateral fix `061b7c5`.

**Apply to:** los nuevos timers de ROOT-02 (kill timer + grace timer) viven en el closure del Promise constructor. Cuando el Promise settle (resolve o reject), el closure es candidato a GC y los timers se limpian. PERO: `setTimeout` mantiene una referencia activa hasta que dispara o se hace `clearTimeout`. Por eso `settle` debe `clearTimeout(killTimer)` Y `clearTimeout(graceTimer)` ANTES de invocar resolve/reject.

**Para ROOT-03 step timeout:** el timer del stepTimeoutPromise NO se cancela explícitamente cuando `stepFn(i)` resuelve primero (D-10 — phantom continuation aceptada). Si bajo always-on los timers acumulados generan warnings de event loop, la mitigación es `.unref()` o un `clearTimeout` en `.then()`. Defer.

**Anti-pattern a evitar:** registrar el listener `operationManager.on('lock:timeout', ...)` en módulo top-level — Phase 18 PATTERNS S-1 lo prohíbe. Phase 19 NO toca ese listener; el child-timeout dispatch se hace dentro del catch del step `startChildProcess` en el cron callback (que también se ejecuta una sola vez al boot, dentro de `initScheduler`).

### §S-10. Boundary que Phase 18 NO cruzó (D-03 in 18-CONTEXT.md) — Phase 19 lifts these

| Phase 18 NO hizo | Phase 19 SÍ hace | Donde |
|------------------|------------------|-------|
| AbortController | NO (deferred) | — |
| `axios.timeout` | SÍ | `PortalClient.js` cliente cacheado (ROOT-01) |
| SIGKILL del child | SÍ (via `taskkill /F /T`) | `background.js startChildProcess` (ROOT-02) |
| `Promise.race` para steps | SÍ (con phantom continuation aceptada) | `background.js forResponse` (ROOT-03) |

**Apply to:** el plan downstream debe ser EXPLICITO sobre qué se está habilitando. NO arrastrar wholesale el "phantom continuation OK" de Phase 18 (S-1 reiterates).

---

## No Analog Found

**Ninguno crítico.** Cada archivo de Phase 19 tiene un analog fuerte gracias a la base de Phase 18:

1. **`PortalClient.js`** — gemelo de `LicenseValidator.licenseClient` (líneas 49-52).
2. **`startChildProcess` timer cascade** — gemelo de `OperationManager.acquireLock` timer (línea 52) + `releaseLock` clearTimeout (línea 65-67).
3. **`forResponse` Promise.race wrapper** — extensión del bloque step instrumentation de Phase 17 D-11 (sin cambios estructurales).
4. **3 nuevas knobs en `config.js`** — gemelo de `lockTimeoutMs` knob + range guard (líneas 169-177).
5. **`sendAdminAlert` para child timeout** — reuse exacto del helper Phase 18 D-08 (`CronScheduler.js:46-70`).
6. **Tests con `jest.useFakeTimers`** — extensión de `OperationManager.timer.test.js`.
7. **`tests/integration/`** carpeta nueva — única "no analog" estructural; convención simple (mismo `*.test.js` style).

Lo único que el planner NO encuentra precedente directo es:
- **Mocking `child_process.spawn` returning an EventEmitter** — el codebase no tiene tests de child_process previos. La pattern propuesta en T.2 (mockear con `new EventEmitter()` + sub-emitters + `kill` jest.fn) es estándar Jest, no requiere consultar fuera del codebase.

---

## Metadata

**Analog search scope (read in this session):**
- `src/services/LicenseValidator.js` (full — 405 lines; cliente axios reference)
- `src/services/CronScheduler.js` (full — 278 lines; listener + sendAdminAlert + findLastOpenStep)
- `src/services/OperationManager.js` (lines 1-200; timer encapsulation reference)
- `src/background.js` (full — 422 lines; forResponse 7 steps + startChildProcess Promise constructor)
- `src/config.js` (full — 184 lines; schedule block + range guard)
- `src/utils/duration.js` (full — 35 lines; formatDurationMin)
- `src/controller/CFDI_Downloader.js` (full — 328 lines; 3 axios sites)
- `src/controller/PortalPaymentController.js` (líneas 1-30, 270-310; 1 axios.post site)
- `src/controller/PortalOC_Creator.js` (líneas 1-27, 240-290; 1 axios.post site con timeout inline)
- `src/controller/PortalOC_Closer.js` (líneas 1-25, 70-110; 1 axios.put site con timeout inline)
- `src/controller/PortalOC_Canceller.js` (líneas 60-95; 1 axios.put site con timeout inline)
- `src/controller/PortalOC_ContentUpdater.js` (líneas 115-155; 1 axios.put site con timeout inline)
- `src/controller/PortalOC_StatusUpdater.js` (líneas 1-110; 1 axios.put site con timeout + httpAgent/httpsAgent)
- `src/utils/GetTypesCFDI.js` (líneas 1-220, 280-490; 7 axios.get sites)
- `src/utils/GetProviders.js` (full — 113 lines; 2 axios.get sites)
- `tests/services/OperationManager.timer.test.js` (full — 197 lines; jest fake timers reference)
- `tests/services/CronScheduler.timeout-listener.test.js` (full — 270 lines; EventEmitter mock pattern)
- `tests/services/cron-scheduler.test.js` (lines 1-100; mock layout + isolateModules pattern)

**Files scanned via Grep (signature/pattern lookups):** ~10 across `src/controller/`, `src/utils/`, `src/services/`, `tests/services/`.

**Pattern extraction date:** 2026-04-29.
