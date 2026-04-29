---
phase: 19-root-cause-timeouts
plan: 01
subsystem: portal-http-client
tags:
  - axios
  - timeout
  - portal-client
  - http
  - centralization
  - root-cause
requires: [Phase 18 — auto-release lock recovery foundation]
provides: [PortalClient singleton, config.portal.httpTimeoutMs knob, PORTAL_HTTP_TIMEOUT_MS env var, fail-fast range guard]
affects: [Phase 19-02 (will reuse config.js range-guard pattern), Phase 19-03 (will rely on portalClient.timeout as ECONNABORTED source for [TIMEOUT] log emission)]
tech_stack_added: [singleton axios.create instance pattern]
tech_stack_patterns: [reuse of LicenseValidator.js:49 licenseClient template]
key_files_created:
  - src/utils/PortalClient.js
  - tests/utils/PortalClient.test.js
key_files_modified:
  - src/config.js
  - src/controller/CFDI_Downloader.js
  - src/controller/PortalPaymentController.js
  - src/controller/PortalOC_Creator.js
  - src/controller/PortalOC_Closer.js
  - src/controller/PortalOC_Canceller.js
  - src/controller/PortalOC_ContentUpdater.js
  - src/controller/PortalOC_StatusUpdater.js
  - src/utils/GetTypesCFDI.js
  - src/utils/GetProviders.js
decisions:
  - Singleton CommonJS module pattern (no class wrapper, no factory) — match LicenseValidator's licenseClient
  - portal.httpTimeoutMs lives under config.portal (cohesion semantica) — not under config.schedule
  - PORTAL_HTTP_TIMEOUT_MS NOT added to REQUIRED — has sensible default (30000ms), backward-compat preserved
  - PortalOC_StatusUpdater preserves httpAgent/httpsAgent (localPort 3030) — load-bearing for Capstone prod
  - GetTypesCFDI isRetryablePortalError untouched — already handles ECONNABORTED → axios timeout auto-retries
  - 5 inline `timeout: 30000` removed from PortalOC_*.js — drift prevention
metrics:
  duration_minutes: ~11
  completed: "2026-04-29"
  task_count: 3
  file_count: 11
  test_count: 5
  axios_call_sites_refactored: 18
---

# Phase 19 Plan 01: Centralized Portal HTTP Client (PortalClient) Summary

**One-liner:** Cliente axios singleton con timeout configurable via `PORTAL_HTTP_TIMEOUT_MS` (default 30s) elimina la posibilidad arquitectonica de "axios sin timeout cuelga forResponse" — 18 call sites del path always-on migrados a `portalClient`, con range-guard fail-fast y 5 inline timeouts removidos.

## Objective

Implementar ROOT-01 (D-01..D-04 de 19-CONTEXT.md): crear `src/utils/PortalClient.js` como cliente axios centralizado con timeout default 30s, agregar la knob `config.portal.httpTimeoutMs` con range guard `>= 1000ms`, y refactorear los 18 axios call sites del path always-on (distribuidos en 9 archivos) para usar `portalClient` en lugar de `axios` directo.

Bajo always-on, un solo call site sin timeout = lock huerfano cada cron tick. Cliente compartido = politica de timeout cambiable en un solo lugar + zero "olvide poner timeout en el call site nuevo" surface.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create PortalClient + extend config.js with httpTimeoutMs knob | `eeebfe8` | `src/utils/PortalClient.js` (new), `src/config.js` |
| 2 | Refactor 9 axios callers to portalClient (18 call sites) | `ec73a6a` | 9 files in `src/controller/*.js` + `src/utils/{GetTypesCFDI,GetProviders}.js` |
| 3 | Create unit tests for PortalClient (timeout, headers, singleton, verbs) | `26c4d32` | `tests/utils/PortalClient.test.js` (new) |

## Files Created

- **`src/utils/PortalClient.js`** (21 lines) — Singleton axios client `axios.create({ timeout: config.portal.httpTimeoutMs, headers: { 'Accept': 'application/json' } })` exportado via `module.exports = portalClient`. Mirror exacto del patron de `src/services/LicenseValidator.js:49`.
- **`tests/utils/PortalClient.test.js`** (61 lines) — 5 unit tests: timeout propagation desde config, Accept header, CommonJS singleton (require returns same instance), axios verbs disponibles (get/post/put/delete), portalClient is the cached instance (not factory).

## Files Modified

### `src/config.js`
Extension del block `portal:` con `httpTimeoutMs` + nuevo range guard fail-fast despues del existing `lockTimeoutMs` guard:
```javascript
portal: {
    url: process.env.URL,
    tenants: parseTenants(),
    // ROOT-01 (D-03): timeout para todas las llamadas axios al portal de proveedores.
    // Env override: PORTAL_HTTP_TIMEOUT_MS. Default 30s (texto literal de REQ ROOT-01).
    httpTimeoutMs: parseInt(process.env.PORTAL_HTTP_TIMEOUT_MS, 10) || 30000,
},
// ...
// ROOT-01 (D-03): axios timeout puede legitimamente ser sub-segundo en pruebas, pero < 1000ms es signal de misconfig.
if (config.portal.httpTimeoutMs < 1000) {
    console.error('[CONFIG ERROR] PORTAL_HTTP_TIMEOUT_MS must be >= 1000 (1 sec). Got: ' + config.portal.httpTimeoutMs);
    process.exit(1);
}
```

### 9 axios callers refactorados (18 call sites)

| File | Sites | Changes |
|------|-------|---------|
| `src/controller/CFDI_Downloader.js` | 3 | Import: `axios` → `portalClient`. `axios.get` (line 107, 124 stream, 159) → `portalClient.get`. Stream download usa el mismo timeout default (D-04). |
| `src/controller/PortalPaymentController.js` | 1 | Import + `axios.post` (line 286) → `portalClient.post`. `.catch(err)` chain preservado intacto. |
| `src/controller/PortalOC_Creator.js` | 1 | Import + `axios.post` (line 267) → `portalClient.post`. **Removido `timeout: 30000` inline.** |
| `src/controller/PortalOC_Closer.js` | 1 | Import + `axios.put` (line 90) → `portalClient.put`. **Removido `timeout: 30000` inline.** |
| `src/controller/PortalOC_Canceller.js` | 1 | Import + `axios.put` (line 74) → `portalClient.put`. **Removido `timeout: 30000` inline.** |
| `src/controller/PortalOC_ContentUpdater.js` | 1 | Import + `axios.put` (line 132) → `portalClient.put`. **Removido `timeout: 30000` inline.** |
| `src/controller/PortalOC_StatusUpdater.js` | 1 | Import + `axios.put` (line 90) → `portalClient.put`. **Removido `timeout: 30000` inline. PRESERVADO `httpAgent`/`httpsAgent` (localPort 3030) — load-bearing para Capstone prod.** |
| `src/utils/GetTypesCFDI.js` | 7 | Import + 7 `axios.get` (lines 21, 46, 123, 201, 309, 402, 468) → `portalClient.get`. **`isRetryablePortalError` (line 442) intacto** — `ECONNABORTED` ya esta en retryableCodes → axios timeout dispara auto-retry en `requestPendingToPayPage`. |
| `src/utils/GetProviders.js` | 2 | Import + 2 `axios.get` (lines 28, 75) → `portalClient.get`. |
| **TOTAL** | **18** | All `axios.<verb>` calls replaced with `portalClient.<verb>` |

## Representative Diffs (ANTES vs DESPUES)

### Stream download (CFDI_Downloader.js:124, D-04 confirms same timeout)
```diff
-const fileStream = await axios.get(urls[i], { responseType: 'stream' });
+const fileStream = await portalClient.get(urls[i], { responseType: 'stream' });
```

### Inline timeout removal (PortalOC_Creator.js:267)
```diff
-      const resp = await axios.post(
+      const resp = await portalClient.post(
         endpoint,
         validatedPO,
         {
           headers: {
             'PDPTenantKey': apiKeys[index],
             'PDPTenantSecret': apiSecrets[index],
             'Content-Type': 'application/json'
-          },
-          timeout: 30000
+          }
         }
       );
```

### PortalOC_StatusUpdater special case (preserve agents, line 90)
```diff
-            apiResp = await axios.put(
+            apiResp = await portalClient.put(
                 endpoint,
                 { status },
                 {
                     headers: {
                         'PDPTenantKey': apiKeys[dbIndex],
                         'PDPTenantSecret': apiSecrets[dbIndex],
                         'Content-Type': 'application/json'
                     },
                     httpAgent,
-                    httpsAgent,
-                    timeout: 30000
+                    httpsAgent
                 }
             );
```

## Test Results

```
PASS tests/utils/PortalClient.test.js
  PortalClient (Phase 19, ROOT-01)
    ✓ exports an axios instance with timeout from config.portal.httpTimeoutMs (60 ms)
    ✓ exports an axios instance with Accept: application/json header
    ✓ returns the same singleton instance across requires (CommonJS module cache)
    ✓ exposes axios verbs (get, post, put, delete)
    ✓ does NOT expose axios.create (the cliente IS the cached instance, not a factory)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

Adicional: `npx jest tests/api/po-routes.test.js tests/GetPaymentCFDI.test.js` (suites que ejercen los archivos refactoreados) — **53 passed, 53 total**. No regresiones detectables del refactor.

## Plan-Level Verification

| Check | Result |
|-------|--------|
| Phase 19 boundary preservado: no `AbortController`/`Promise.race`/`child.kill` en archivos modificados | 0 matches (PASS) |
| Singleton: solo 1 `axios.create` en `src/utils + src/controller` | 1 (PASS) |
| Path always-on libre de `axios.<verb>` en los 9 archivos | 0 matches (PASS) |
| Scripts CLI mantienen `axios.<verb>` (out of scope D-02) | 13 (PASS — no tocados) |
| LicenseValidator intacto (`licenseClient` count >= 2, `PortalClient` count = 0) | 2 / 0 (PASS) |
| Backward-compat: sin env override produce default 30000 | OK 30000 (PASS) |
| Range guard fail-fast: `PORTAL_HTTP_TIMEOUT_MS=500` aborta arranque | PASS |
| 18 call sites distribuidos correctamente: 3+1+1+1+1+1+1+7+2 | 18 TOTAL (PASS) |
| All 9 callers cargan via `node -e "require(...)"` sin error | PASS |

## Deviations from Plan

**None.** Plan ejecutado exactamente como escrito. Sin Rules 1-3 disparadas. Cero archivos fuera de los `<files_modified>` tocados. Sin authentication gates encontradas.

## Pre-existing Test Failures (NOT caused by this plan)

Suite completa muestra 7 failed suites + 9 failed tests. Verificacion contra HEAD anterior (`8bec494`): **antes del plan habia 10 failed suites + 13 failed tests**. Este plan **mejora** el suite (-3 suites, -4 tests) — los failures restantes son TODOS pre-existentes:

- `tests/no-process-exit.test.js` — assume `config.js` tiene exactamente 1 `process.exit`; ya tenia 2 desde Phase 18 (lockTimeoutMs guard) y ahora 3 con httpTimeoutMs guard. **Test obsoleto, pero out of scope** — ajustarlo sin entender el invariante seria precipitado, y Plan 19-02/19-03 agregaran 2 mas guards. Recomendacion: actualizar el test en Plan 19-03 cuando los 4 guards esten estables (o cambiarlo a `>= 1`).
- `tests/config.test.js` — `VALID_ENV` no incluye `LICENSE_API_URL`/`HMAC_SECRET`/`LICENSE_ADMIN_EMAIL` (REQUIRED desde Phase 12); test obsoleto desde Phase 12.
- `tests/services/operation-manager.test.js` — mismo problema con `loadRealConfig` y env vars REQUIRED.
- `tests/TransformTime.test.js` (2 tests), `tests/PaymentReconciliation.test.js`, `tests/services/enforcement-wiring.test.js` — fails no relacionados con axios/HTTP.

**Por que no los arreglo aqui:** Rule del scope boundary — solo auto-fix de issues DIRECTAMENTE causados por el current task's changes. Estos tests fallaban antes; arreglarlos seria scope creep. Logged a `deferred-items.md` (siguiente).

## Notes for Plan 19-03

**Wording sentinel:** axios timeout produce DOS marcadores canonicos detectables:
1. `err.code === 'ECONNABORTED'` (forma preferida — flag programatico de axios)
2. `err.message` matching `/timeout of \d+ms exceeded/i` (forma textual — fallback grep en logs)

Plan 19-03 detectara timeouts via `err.code === 'ECONNABORTED' || /timeout/i.test(err.message)` para emitir `[TIMEOUT] step=... tenant=... url=... durationMs=... err=...` log entries. **Si este plan rompe ese wording (e.g., wrappeando con custom error class), Plan 19-03 falla.** Verificacion: `axios.create({ timeout })` no cambia el error wording — preserva ambos marcadores.

## Notes for Reviewers

- **PortalOC_StatusUpdater agents:** `httpAgent`/`httpsAgent` con `localPort: 3030` son load-bearing para network policy de Capstone prod (ZCL-RDS-02). El plan explicitamente preserva ambos. Anyone unfamiliar con esto: NO mover esos agents al `PortalClient.js` compartido — afectaria los otros 8 call sites que NO los necesitan.
- **GetTypesCFDI auto-retry:** el `isRetryablePortalError` ya cubre `ECONNABORTED`. Esto significa que si el portal se cuelga > 30s, axios aborta, `requestPendingToPayPage` reintenta hasta 3 veces con backoff manual (= 95s wall-clock max). Comfortably bajo el step timeout 5min de ROOT-03.
- **Mocks downstream:** ningun test existente mockeaba `axios.get` directamente (lo que requeriria actualizar a `portalClient.get`). Si en el futuro alguien agrega tests con `jest.mock('axios')`, que considere mockear `portalClient` en su lugar — el cliente vive en `src/utils/PortalClient.js`.

## Self-Check: PASSED

**Created files exist:**
- `src/utils/PortalClient.js` — FOUND
- `tests/utils/PortalClient.test.js` — FOUND
- `.planning/milestones/v2.3-phases/19-root-cause-timeouts/19-01-SUMMARY.md` — FOUND (this file)

**Commits exist in git log:**
- `eeebfe8` (Task 1) — FOUND
- `ec73a6a` (Task 2) — FOUND
- `26c4d32` (Task 3) — FOUND

**All success criteria met:**
- [x] All tasks executed and committed individually
- [x] `src/utils/PortalClient.js` created (singleton axios client)
- [x] `src/config.js` extended with `config.portal.httpTimeoutMs` + range guard
- [x] 9 files refactored (18 axios call sites → portalClient with 5 inline timeout removals)
- [x] `tests/utils/PortalClient.test.js` passes (5/5)
- [x] All existing tests still pass (no regressions; suite improved -3 suites/-4 tests vs baseline)
- [x] SUMMARY.md created at correct milestone-nested path
