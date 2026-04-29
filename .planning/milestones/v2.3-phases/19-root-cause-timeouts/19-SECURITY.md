---
phase: 19-root-cause-timeouts
audited: 2026-04-29T20:00:00Z
asvs_level: 1
threats_total: 17
threats_closed: 17
threats_open: 0
mitigate_count: 9
accept_count: 6
na_count: 2
unregistered_flags: 0
status: secured
audit_trail:
  - source: "PLAN 19-01 STRIDE table (5 threats)"
  - source: "PLAN 19-02 STRIDE table (6 threats)"
  - source: "PLAN 19-03 STRIDE table (6 threats)"
  - source: "SUMMARY 19-01 / 19-02 / 19-03 — verified no `## Threat Flags` section emitted"
verifier: gsd-secure-phase auditor
---

# Phase 19 Security Audit: Root Cause Timeouts

**Phase Goal:** Prevenir cuelgues con timeouts en axios al portal, child process del importador, y per-step en `forResponse`. Reemplaza la "phantom continuation" Phase 18 D-03 con abort semantics reales.

**Audit verdict:** **SECURED** — los 17 threats declarados en los 3 STRIDE tables están todos cerrados con evidencia file:line. Cero unregistered flags en SUMMARY.md. Cero gaps de implementación.

---

## Plan 19-01 Threat Verification (5 threats — 3 mitigate / 1 accept / 1 n/a)

| Threat ID | Category | Disposition | Evidence |
|-----------|----------|-------------|----------|
| **T-19-01-01** | DoS — `forResponse` always-on cycle | mitigate | `src/config.js:128` — `httpTimeoutMs: parseInt(process.env.PORTAL_HTTP_TIMEOUT_MS, 10) \|\| 30000`; `src/utils/PortalClient.js:17` — `timeout: config.portal.httpTimeoutMs` propagado al singleton axios. Range guard activa en `src/config.js:192-195`. **CLOSED.** |
| **T-19-01-02** | Info Disclosure — URL en `[TIMEOUT]` logs | accept | `src/controller/PortalPaymentController.js:303-304` loggea URL completa AS-IS sin redaction. URLs incluyen tenant id + query params; auth NO se loggea (auth viaja en headers `PDPTenantKey`/`PDPTenantSecret`, no en URL). Reasoning consistente con código: tenant ids ya se loggean en `[START]/[COMPLETE]` Phase 17 entries. **CLOSED — risk accepted.** |
| **T-19-01-03** | Tampering — env `PORTAL_HTTP_TIMEOUT_MS` misconfig | mitigate | `src/config.js:192-195` — `if (config.portal.httpTimeoutMs < 1000) { console.error(...); process.exit(1); }`. Sigue patrón identico al `lockTimeoutMs` guard Phase 18 (`src/config.js:186-189`). **CLOSED.** |
| **T-19-01-04** | Repudiation — axios timeout sin context | accept | Threat transferido a Plan 19-03 mitigations T-19-03-05; en este plan no se cubre. Phase 19-03 entrega `[TIMEOUT]` log entries con D-16 keys (`src/controller/PortalPaymentController.js:302-305`). **CLOSED — transferred.** |
| **T-19-01-05** | Elevation — n/a | n/a | `src/utils/PortalClient.js:16-19` — `axios.create` con sólo `timeout` + `headers: { Accept: 'application/json' }`. Cero auth headers (`PDPTenantKey`/`PDPTenantSecret`/`Authorization`) globales — auth sigue per-tenant en cada call site (verificado: `grep -nE "PDPTenantKey|PDPTenantSecret|Authorization" PortalClient.js` → 0 matches). **CLOSED — no privilege boundary added.** |

---

## Plan 19-02 Threat Verification (6 threats — 4 mitigate / 1 accept / 1 n/a)

| Threat ID | Category | Disposition | Evidence |
|-----------|----------|-------------|----------|
| **T-19-02-01** | DoS — startChildProcess colgado bajo Servy | mitigate | `src/background.js:368-402` cascade completo: `killTimer = setTimeout(...config.schedule.childProcessTimeoutMs)` (línea 368) → `childProcess.kill()` SIGTERM (línea 377) → `graceTimer = setTimeout(..., 30000)` hardcoded grace (línea 381) → `exec("taskkill /F /T /PID ${childProcess.pid}")` conditional sobre `exitCode === null` (línea 389) → `settle(() => reject(new Error("Child process timeout after ${durationLabel} — killed (PID was ${childProcess.pid})")))` (línea 399-401); `hasSettled` flag en línea 344 con check en `settle` línea 348. **CLOSED.** |
| **T-19-02-02** | Tampering / Shell Injection — `exec('taskkill /F /T /PID <pid>')` | mitigate | `src/background.js:389` — `exec(\`taskkill /F /T /PID ${childProcess.pid}\`, ...)`. PID viene de `childProcess.pid` (integer asignado por Node en spawn al línea 362), NO de input externo. Comment en código documenta surface: `src/background.js:387` "PID is integer-typed by Node — no shell injection risk (T-19-02-02)". Cero ruta de input externo (env, DB, user) llega al template literal. **CLOSED.** |
| **T-19-02-03** | Info Disclosure — Email al admin con PID + importRoute | accept | `src/services/CronScheduler.js:62` — `to: config.license.adminEmail` (NO `config.mailing.notices` operator-facing). Body en líneas 173-184: incluye `step`, `operationId`, `childDurationLabel`, `config.app.importRoute` (path al exe), `config.app.company`, `__scpError` message. **NO incluye:** API keys, tenant secrets, SQL creds, HMAC secret. `importRoute` = path filesystem ya conocido por el admin. **CLOSED — risk accepted.** |
| **T-19-02-04** | DoS / Misconfig — env `CHILD_PROCESS_TIMEOUT_MS=10` | mitigate | `src/config.js:198-201` — `if (config.schedule.childProcessTimeoutMs < 60000) { console.error('[CONFIG ERROR] CHILD_PROCESS_TIMEOUT_MS must be >= 60000 (1 min). Got: ' + config.schedule.childProcessTimeoutMs); process.exit(1); }`. **CLOSED.** |
| **T-19-02-05** | Repudiation — múltiples timeouts sin context | mitigate | `src/background.js:373-375` — `[TIMEOUT] step=startChildProcess tenant=global pid=<pid> durationMs=<ms> action=SIGTERM` en `ChildProcess.log`; línea 383-384 — `[TIMEOUT] step=startChildProcess pid=<pid> action=taskkill /F /T`; `src/services/CronScheduler.js:165-167` — `[TIMEOUT] step=startChildProcess operationId=<id> durationMs=<ms> action=admin-email-dispatched` en `CronScheduler.log` (D-16 keys: step + tenant + url(pid alt) + durationMs). **CLOSED.** |
| **T-19-02-06** | Elevation — n/a | n/a | `src/background.js:362` — `spawn(config.app.importRoute, [config.app.arg])`; línea 389 — `exec(\`taskkill /F /T /PID ${childProcess.pid}\`)`. Cero `sudo`/`runas`/elevation surface (`grep -nE "sudo\|runas\|elevation"` → 0 matches). taskkill corre como mismo Servy account. **CLOSED — no privilege escalation.** |

---

## Plan 19-03 Threat Verification (6 threats — 3 mitigate / 3 accept)

| Threat ID | Category | Disposition | Evidence |
|-----------|----------|-------------|----------|
| **T-19-03-01** | DoS — step individual colgado en forResponse | mitigate | `src/utils/duration.js:56-65` — `withStepTimeout` Promise.race wrapper con default `STEP_TIMEOUT_MS=300000` (5 min). `src/background.js` envuelve los 7 step blocks en líneas 59, 96, 132, 168, 204, 240, 276 (`grep -c "await withStepTimeout(" src/background.js` → 7). **CLOSED.** |
| **T-19-03-02** | Resource Exhaustion / Phantom continuation | accept (D-10) | `src/utils/duration.js:45-48` JSDoc documenta phantom continuation tolerada. **Layered safety nets verificados:** `httpTimeoutMs (30000)` < `stepTimeoutMs (300000)` < `childProcessTimeoutMs (600000)` < `lockTimeoutMs (840000)`. Spot-check: `node -e "..."` confirma `axios < step ? true`, `child < lock ? true`. axios timeout (Plan 19-01 PortalClient) corta HTTP requests colgados ANTES que el step timeout dispare; lock auto-release Phase 18 cubre patológico. **CLOSED — risk accepted with safety net invariants intact.** |
| **T-19-03-03** | Info Disclosure — URL en `[TIMEOUT]` log | accept | `src/background.js:67, 103, 139, 175, 211, 247, 283` — los 7 step `[TIMEOUT]` logs usan `url=n/a` (step level no tiene URL específica). `src/controller/PortalPaymentController.js:303-304` — log entry HTTP usa `url=${endpoint}` AS-IS sin redaction. Análisis idéntico a T-19-01-02: URLs no llevan creds (auth en headers per-tenant). **CLOSED — risk accepted.** |
| **T-19-03-04** | Tampering / Misconfig — env `STEP_TIMEOUT_MS=10` | mitigate | `src/config.js:205-208` — `if (config.schedule.stepTimeoutMs < 30000) { console.error('[CONFIG ERROR] STEP_TIMEOUT_MS must be >= 30000 (30 sec). Got: ' + config.schedule.stepTimeoutMs); process.exit(1); }`. **CLOSED.** |
| **T-19-03-05** | Repudiation — múltiples step timeouts sin rastreo | mitigate | `src/background.js` 7 catch handlers con `if (/Step timeout/.test(__stepError)) { logGenerator(logFileName, 'error', \`[TIMEOUT] step=${__step} tenant=${tenantIds[i]} url=n/a durationMs=${config.schedule.stepTimeoutMs} err=${__stepError}\`); }` en líneas 65-69, 101-105, 137-141, 173-177, 209-213, 245-249, 281-285 — D-16 keys (`step + tenant + url + durationMs`) presentes. `endStep` también captura error en `stepProgress` (Phase 17 instrumentation preservada). **CLOSED.** |
| **T-19-03-06** | Operational — `STEP_TIMEOUT_MS × numSteps × numTenants > LOCK_TIMEOUT_MS` | accept (D-11) | Caso patológico (5min × 7 × 1 = 35min > 14min). **Lock auto-release Phase 18 sigue como safety net:** `src/config.js:172` — `lockTimeoutMs: parseInt(process.env.LOCK_TIMEOUT_MS, 10) \|\| 14 * 60 * 1000` con guard en `src/config.js:186-189`. Spot-check confirma `lockTimeoutMs === 840000` post-Phase-19. NO se valida en config (sería sobre-engineering). **CLOSED — risk accepted with Phase 18 safety net intact.** |

---

## Mitigation Summary by Disposition

### Mitigate (9 threats — all CLOSED with code evidence)
- T-19-01-01 — `axios.create({ timeout })` singleton → 18 callsites
- T-19-01-03 — `httpTimeoutMs < 1000` fail-fast
- T-19-02-01 — kill cascade completo (SIGTERM + grace + taskkill + hasSettled)
- T-19-02-02 — PID integer-typed (no shell injection vector)
- T-19-02-04 — `childProcessTimeoutMs < 60000` fail-fast
- T-19-02-05 — `[TIMEOUT]` logs duales (ChildProcess.log + CronScheduler.log) con D-16 keys
- T-19-03-01 — `withStepTimeout` Promise.race wrapper × 7 steps
- T-19-03-04 — `stepTimeoutMs < 30000` fail-fast
- T-19-03-05 — `[TIMEOUT]` logs en ForResponse.log con D-16 keys

### Accept (6 threats — risk reasoning consistent with implementation)
- T-19-01-02 — URL logging (auth en headers, no en URL — verificado)
- T-19-01-04 — repudiation transferida a 19-03 D-16 logs (entregado)
- T-19-02-03 — admin email body sin secrets (verified: importRoute path solamente)
- T-19-03-02 — phantom continuation acotada por axios timeout < step timeout invariant (verified)
- T-19-03-03 — URL logging idéntico a T-19-01-02
- T-19-03-06 — lock auto-release Phase 18 como safety net (preservado, verified)

### N/A (2 threats — no privilege/auth surface added)
- T-19-01-05 — PortalClient sin auth headers globales (verified: 0 matches en grep)
- T-19-02-06 — taskkill sin elevation (verified: 0 matches por sudo/runas)

---

## Defense-in-Depth Invariant Verification

The Phase 19 mitigation strategy depends on a layered timeout cascade. Verified at runtime:

| Layer | Knob | Default | Source |
|-------|------|---------|--------|
| 1. HTTP work (innermost) | `httpTimeoutMs` | 30s | PortalClient.js:17 |
| 2. Per-step (Promise.race) | `stepTimeoutMs` | 5min | duration.js withStepTimeout |
| 3. Child process kill | `childProcessTimeoutMs` | 10min | background.js:368 |
| 4. Lock auto-release (outermost) | `lockTimeoutMs` | 14min | OperationManager (Phase 18) |

**Invariant:** `httpTimeoutMs (30000) < stepTimeoutMs (300000) < childProcessTimeoutMs (600000) < lockTimeoutMs (840000)`. Verified via runtime spot-check: `node -e "const c = require('./src/config'); console.log(c.portal.httpTimeoutMs < c.schedule.stepTimeoutMs)" → true`. Each layer fires before the next would, ensuring graceful degradation instead of resource accumulation.

---

## Range Guards (5 process.exit in config.js)

`grep -c "process.exit" src/config.js` returns 5:
1. `validate()` — REQUIRED env vars missing (Phase 12 baseline)
2. `lockTimeoutMs < 60000` (Phase 18)
3. `httpTimeoutMs < 1000` (Phase 19-01)
4. `childProcessTimeoutMs < 60000` (Phase 19-02)
5. `stepTimeoutMs < 30000` (Phase 19-03)

All 4 timeout knobs use `parseInt(process.env.X, 10) || DEFAULT` pattern; none in `REQUIRED` array (backward-compat preserved). Misconfigured values fail-fast at module load.

---

## Unregistered Flags

**None.** SUMMARY 19-01, 19-02, 19-03 do NOT contain a `## Threat Flags` section. Executor identified zero new attack surface during implementation that was not in the original threat register.

---

## Audit Trail

| Source | Reference |
|--------|-----------|
| Plan 19-01 STRIDE table (lines 181-188) | 5 threats: T-19-01-01..T-19-01-05 |
| Plan 19-02 STRIDE table (lines 224-235) | 6 threats: T-19-02-01..T-19-02-06 |
| Plan 19-03 STRIDE table (lines 224-233) | 6 threats: T-19-03-01..T-19-03-06 |
| Plan 19-VERIFICATION.md | Section J "Threat models honored — ✓ PASS" confirms 3/3 threat categories pre-validated by verifier |
| SUMMARY 19-01 | No `## Threat Flags` section |
| SUMMARY 19-02 | No `## Threat Flags` section |
| SUMMARY 19-03 | No `## Threat Flags` section |

---

## Phase 19 Security Closure Statement

**Phase 19: Root Cause Timeouts is SECURED.**

- 17/17 threats verified with file:line evidence
- 9 mitigate dispositions — all confirmed in code
- 6 accept dispositions — all reasoning consistent with implementation state
- 2 n/a dispositions — confirmed no new privilege/auth surface
- 0 unregistered flags from SUMMARYs
- 0 implementation gaps requiring escalation
- Defense-in-depth invariant verified at runtime (axios < step < child < lock)
- Phase 18 invariants preserved (lockTimeoutMs guard, sendAdminAlert, formatDurationMin)

No blockers. No escalations. No follow-up security tasks within Phase 19 scope.

_Audited: 2026-04-29_
_Auditor: gsd-secure-phase (Claude)_
