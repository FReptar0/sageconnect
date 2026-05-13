# SageConnect

## What This Is

SageConnect es un servicio always-on de integración entre Sage 300 ERP y Portal de Proveedores (portaldeproveedores.mx). Automatiza la gestión de CFDIs, pagos, y órdenes de compra, expone una interfaz web operativa para auditoría de pagos, gestión de POs, diagnósticos, y monitoreo de scheduling. Deployado como Windows Service via Servy con scheduling interno (node-cron).

## Core Value

La integración Sage-Portal debe ser confiable, mantenible, y operable: servicio continuo con interfaz web para operaciones y monitoreo en tiempo real.

## Current State (post v2.3)

- **Service:** Always-on via Servy Windows Service, node-cron v4 internal scheduler (every 15 min)
- **License:** LicenseValidator validates against external server (sageconnect-license on Vercel) with HMAC-SHA256, anti-replay, three-state cache (24h TTL)
- **Enforcement:** Startup fail-fast, cron guard, Express middleware (503), DNS bypass detection
- **API:** 17 REST endpoints (7 payment + 9 PO + 1 force-release) + 6 system endpoints (health, tenants, license, schedule, history, operations)
- **Web UI:** 4 pages + license banner + expiry badge + OC status change form + "Operación en curso" card with 5s polling + 1s heartbeat ticker + Forzar liberación modal
- **Config:** `src/config.js` with fail-fast validation, 36+ env vars (added LOCK_TIMEOUT_MS, PORTAL_HTTP_TIMEOUT_MS, CHILD_PROCESS_TIMEOUT_MS, STEP_TIMEOUT_MS) — 4 range guards + validate = 5 process.exit guards
- **Scheduler hardening:** OperationManager.stepProgress + auto-release timer (lock:timeout EventEmitter) + force-release endpoint (idempotent) + PortalClient singleton (axios timeout 30s) + startChildProcess kill cascade (SIGTERM → 30s grace → taskkill /F /T) + per-step Promise.race via withStepTimeout helper. Defense-in-depth: axios (30s) < step (5m) < child (10m) < lock (14m).
- **Logging:** Unified `[TIMEOUT] step=... tenant=... url=... durationMs=... err=...` cross-cutting format routed per source (ChildProcess.log + CronScheduler.log + ForResponse.log + caller-specific). Email alerts ONLY for child-process timeouts (avoids inbox flood).
- **Scripts:** All 13 scripts + PortalOC_StatusUpdater return ResultEnvelope
- **SQL:** Singleton connection pool with USE [database] switching, auto-reconnect
- **Tests:** 200+ across the codebase; 48/48 Phase 19 tests passing; 6 pre-existing failed suites carried from v2.0/v2.1
- **Legacy removed:** AutoShutdownService, AUTO_TERMINATE, RunSageconnect.bat, --web-only all gone

## Requirements

### Validated

- ✓ Resolución de PROVIDERID por `external_id` en flujo principal — existing
- ✓ Auto-resolución de UUIDs faltantes vía portal (`UuidResolver.js`) — existing
- ✓ Script de conciliación con clasificación en 5 categorías — v1.0
- ✓ Subida batch al portal con registro en control table — existing
- ✓ Validación de `provider_id` del CFDI contra PROVIDERID de Sage — v1.0
- ✓ Auto-resolución de PROVIDERID faltante en flujo de conciliación — v1.0
- ✓ Verificación de completitud de resultados en batch response — v1.0
- ✓ Guard de batch vacío en modo --upload — v1.0
- ✓ Config loader centralizado con validación fail-fast — v1.1
- ✓ Unificación de 5 archivos .env en uno solo — v1.1
- ✓ Migración de 25+ llamadas dotenv a require centralizado — v1.1
- ✓ Limpieza de archivos .env.example redundantes — v1.1
- ✓ Regresión verificada post-migración — v1.1
- ✓ Scripts retornan datos estructurados (ResultEnvelope) — v2.0
- ✓ process.exit eliminado de rutas always-on — v2.0
- ✓ SQL pool singleton con auto-reconnect — v2.0
- ✓ 15 REST API endpoints (pagos + POs) con seguridad — v2.0
- ✓ node-cron scheduler interno con noOverlap — v2.0
- ✓ SSE progress streaming para operaciones — v2.0
- ✓ Web UI operativa (pagos, POs, schedule, logs) — v2.0
- ✓ Servy Windows Service con deployment guide — v2.0
- ✓ Legacy removal (AutoShutdown, AUTO_TERMINATE, bat) — v2.0

- ✓ LicenseValidator con HMAC-SHA256, timestamp freshness, retry+backoff — v2.1
- ✓ Enforcement: startup fail-fast, cron guard, Express middleware 503 — v2.1
- ✓ DNS bypass detection via dns.resolve4() — v2.1
- ✓ Banner "Licencia inactiva" + expiry countdown badge en web UI — v2.1
- ✓ Admin email (LICENSE_ADMIN_EMAIL) on failure/revocation — v2.1

- ✓ PUT /api/pos/status endpoint with Joi validation (statusUpdateSchema) — v2.2
- ✓ OC status change UI form in pos.html ("Cambiar Estado OC") with Spanish labels — v2.2

- ✓ OperationManager.stepProgress + startStep/endStep API + GET /api/operations/status enriched wire shape — v2.3 (OBS-03, OBS-04, OBS-05)
- ✓ "Operación en curso" Bootstrap card with 5s polling + 1s heartbeat ticker en schedule.html — v2.3 (OBS-01, OBS-02)
- ✓ Auto-release timer en OperationManager.acquireLock con LOCK_TIMEOUT_MS env (default 14 min) + lock:timeout EventEmitter event + listener (audit history + admin email + warn log) — v2.3 (REC-01, REC-02)
- ✓ POST /api/schedule/:taskId/force-release idempotent endpoint (always 200, released:true|false discriminator) — v2.3 (REC-04, REC-05)
- ✓ Forzar liberación button + Bootstrap modal con state machine + escapeHtml + Cancelar focus override — v2.3 (REC-03)
- ✓ PortalClient singleton (axios.create con httpTimeoutMs default 30s) cubriendo 18 axios call sites en 9 files — v2.3 (ROOT-01)
- ✓ startChildProcess kill cascade (SIGTERM → 30s grace → taskkill /F /T tree-kill) con CHILD_PROCESS_TIMEOUT_MS env (default 10 min) — v2.3 (ROOT-02)
- ✓ Per-step Promise.race via withStepTimeout helper en src/utils/duration.js, STEP_TIMEOUT_MS env (default 5 min) cubriendo 7 forResponse step blocks — v2.3 (ROOT-03)
- ✓ Unified `[TIMEOUT]` log routing cross-cutting (ChildProcess + CronScheduler + ForResponse + caller-specific); email dispatch SOLO para child-process timeouts — v2.3 (ROOT-04)

### Active (v2.4 Retry policies — milestone in scoping)

- [ ] **RETRY-01:** Cron picks up PO whose latest authorization is within the current month (replaces the today-only filter).
- [ ] **RETRY-02:** Cron picks up payment whose latest authorization is within the current month (replaces fixed lookback window).
- [ ] **RETRY-03:** Operator can switch retry scope from "current month" to rolling N-day window via env (`RETRY_SCOPE` + `RETRY_LOOKBACK_DAYS`).
- [ ] **RETRY-04:** Failed upload retries follow exponential backoff (15min → 30min → 1h → 2h → ... capped at 24h), derived from existing fesa.* ERROR rows — no schema change.
- [ ] **RETRY-05:** Last calendar day of the month after `EOM_NOTIFICATION_HOUR`, the service emails MAILING_NOTICES (CC: MAILING_CC) with one consolidated table of pending POs + pagos.
- [ ] **RETRY-06:** End-of-month email is sent at most once per category per month via flat-file sentinel (`logs/eom-{YYYY-MM}-{pos|payments}.sent`).
- [ ] **RETRY-07:** Operator can disable EOM notification via `EOM_NOTIFICATION_ENABLED` env (default `true`).
- [ ] **RETRY-08:** Cron's new WHERE never re-uploads a PO/pago that already has a `POSTED` row in fesa.* (avoid duplicates).
- [ ] **PARTIAL-01:** Partial CFDI upload within a payment follows policy chosen via `PARTIAL_PAYMENT_POLICY` env (atomic | resume | idempotent).
- [ ] **PARTIAL-02:** Engineering confirms Focaltec dedupe semantics on `external_id` via sandbox before locking the default PARTIAL_PAYMENT_POLICY.
- [ ] **PARTIAL-03:** Default PARTIAL_PAYMENT_POLICY value is documented in `.env.example` based on the Focaltec confirmation outcome.

## Current Milestone: v2.4 Retry policies

**Goal:** Eliminar el bug clase del filtro `MAX(Fecha)=hoy` (cron salta POs/pagos huérfanos), introducir retry con backoff exponencial derivado de filas existentes en `fesa.*` (sin schema change), notificación de fin de mes a operadores, y política configurable para subida parcial de pagos.

**Target features:**

- Cron retry policy con scope mes-corriente (default) + override a ventana móvil por env
- Backoff exponencial duplicado con cap de 24h, estado derivado del control table existente
- Email de fin de mes a `MAILING_NOTICES` con CC a `MAILING_CC` (HTML con tablas POs + pagos pendientes, links a dashboard)
- Política de subida parcial de pagos (atomic | resume | idempotent) configurable por env, default a definir tras confirmación Focaltec sandbox

**Issues cerrados:**

- [#21 Cron skips POs whose latest authorization date is not today](https://github.com/FReptar0/sageconnect/issues/21) — bug, question
- [#22 Define payment retry / lookback policy (uploadPayments)](https://github.com/FReptar0/sageconnect/issues/22) — question
- [#23 Define partial payment completion policy](https://github.com/FReptar0/sageconnect/issues/23) — question

**Phase layout:** 20 (cron retry, closes #21 + #22) y 21 (partial payment, closes #23). Worktrees concurrentes; Phase 21 bloquea en `RETRY_SCOPE` locked + respuesta Focaltec sandbox.

**Constraint clave:** sin cambios al schema de `fesa.dbo.fesaOCFocaltec` ni `fesa.dbo.fesaPagosFocaltec`. El patrón "una fila por intento" (visible en `PortalOC_Creator.js:248-329`) ya provee todo el estado necesario para derivar el backoff.

## Recently Shipped: v2.3 Scheduler Lock Recovery (2026-04-29)

**Outcome:** El bug HTTP 409 permanente en "Ejecutar Ahora" eliminado end-to-end con tres capas: visibility (Phase 17 — observability stack) + recovery (Phase 18 — auto-release timer + manual force-release UI/API) + prevention (Phase 19 — axios/child/step timeouts). Defense-in-depth invariant verificado runtime: axios (30s) < step (5m) < child (10m) < lock (14m). Ver `.planning/milestones/v2.3-ROADMAP.md` para detalle.

### Out of Scope

- SQL injection en CLI args — script ejecutado localmente por equipo técnico
- Migración a queries parametrizadas — patrón establecido en todo el codebase
- Migración a YAML config — .env es el estándar Node.js

## Context

- **Rama activa:** `feat/always-on-service`
- **Config pattern:** `const config = require('../config')` → `config.section.property`
- **Multi-tenant:** `config.portal.tenants[index].id/key/secret/database/externalId`
- **Mailing:** `MAIL_TRANSPORT=smtp|gmail` selector en .env
- **License server:** sageconnect-license en Vercel (https://sageconnect-license.vercel.app) — gestión remota de API keys para clientes

## Constraints

- **Sin BD Sage local:** Queries SQL se validan por estructura, no por ejecución
- **Windows Server:** Servy para service management, Node.js v22.15.0
- **Obfuscated production:** javascript-obfuscator para dist, deploy en repo separado

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Usar `external_id` en vez de RFC para PROVIDERID | RFC puede tener duplicados; external_id es único | ✓ Good |
| Validar provider_id antes de marcar READY | Mismatch = pago a proveedor incorrecto | ✓ Good |
| Missing results no en fesaPagosFocaltec | Permite reenvío automático; API retorna duplicado | ✓ Good |
| Single .env + config loader (no YAML) | Zero dependencias nuevas, Node.js estándar | ✓ Good |
| Fail-fast validation con process.exit(1) | Previene fallos silenciosos por config incompleta | ✓ Good |
| Renombrar USER→DB_USER, PATH→DOWNLOADS_PATH | dotenv no sobreescribe vars del OS | ✓ Good |
| Multi-tenant como array de objetos | Más limpio, agrupa datos por tenant | ✓ Good |
| Mailing opcional en validación | No todos los deployments usan email | ✓ Good |
| Servy en vez de PM2 para Windows Service | PM2 tiene bugs wmic en Win Server 2025 | ✓ Good |
| node-cron v4 para scheduling interno | Reemplaza Task Scheduler, noOverlap guard | ✓ Good |
| Scripts como base para API endpoints | Lógica ya probada, exponer sin reescribir | ✓ Good |
| SAGECONNECT_API_KEY (no API_KEY) | Evita colisión con portal tenant keys | ✓ Good |
| Singleton SQL pool + USE [database] | Zero cambios en 25+ callers de runQuery | ✓ Good |
| ResultEnvelope unificado | Contrato consistente para API layer | ✓ Good |
| HMAC-signed license validation | Previene bypass DNS/MITM en servidores de clientes | ✓ Good |
| Fail-fast en startup si licencia invalida | Sin licencia = sistema no opera | ✓ Good |
| Three-state model (VALID/INVALID/ERROR) | Network errors no bloquean clientes que pagan | ✓ Good |
| dns.resolve4() para bypass detection | Defense-in-depth contra hosts file redirect | ✓ Good |
| LICENSE_ADMIN_EMAIL separado de MAILING_NOTICES | Admin Tersoft != operaciones del cliente | ✓ Good |
| poNumber (no ocSage) como campo API público | Consistente con los 8 endpoints PO existentes | ✓ Good |
| PortalOC_StatusUpdater sobre PortalOC_StatusService | StatusUpdater retorna ResultEnvelope, compatible con sendResult | ✓ Good |
| tenantIndex sin database override para status update | Simplifica UI, operadores no necesitan saber nombres de BD | ✓ Good |
| Labels español en dropdown con valores inglés al API | Operadores ven "Cancelada", API envía "CANCELLED" | ✓ Good |
| stepProgress como array (no Map) en lock slots | LIFO endStep iteration + releaseLock cleanup gratis (v2.3) | ✓ Good |
| Polling-first UI hydration + SSE feed solo timeline existente | Mid-cycle reload reliable; card survives reload sin SSE (v2.3) | ✓ Good |
| LOCK_TIMEOUT_MS default 14 min (93% de 15 min cron cadence) | Margen contra falsos positivos sin permitir backlog (v2.3) | ✓ Good |
| Listener registration inside initScheduler() body (no module load) | Prevents listener accumulation under hot-reload + jest.isolateModules (v2.3) | ✓ Good |
| Force-release endpoint idempotent (always 200, released:true\|false) | Operator double-click no 404; sigue mismo flujo (v2.3) | ✓ Good |
| Cancelar focus override (no Confirmar) en modal destructivo | T-18-03-08 mitigación accidental Enter-confirm (v2.3) | ✓ Good |
| escapeHtml() inline en schedule.html (no shared.js) | Defense-in-depth contra polling-data tampering XSS (v2.3) | ✓ Good |
| PortalClient singleton (no class wrapper, no factory) | Mirror de LicenseValidator.licenseClient pattern; 18 sites unificados (v2.3) | ✓ Good |
| httpAgent/httpsAgent preservados en PortalOC_StatusUpdater | localPort 3030 LOAD-BEARING para Capstone prod ZCL-RDS-02 (v2.3) | ✓ Good |
| taskkill /F /T /PID shell-out (no in-process kill) | /T flag tree-kill helpers spawneados; /F sin prompt (v2.3) | ✓ Good |
| 30s grace hardcoded entre SIGTERM y taskkill (no env knob) | Implementation detail, no operational policy (v2.3 D-05) | ✓ Good |
| ONLY child timeouts dispatch admin email | Evita inbox flood + alert fatigue de transient axios timeouts (v2.3 D-15) | ✓ Good |
| withStepTimeout helper hides Promise.race (no direct in background.js) | Phase 19 boundary keeps wrapper hidden (v2.3) | ✓ Good |
| Wording sentinels LOAD-BEARING ('Child process timeout', 'Step timeout') | Regex detection gates email dispatch + log routing (v2.3) | ✓ Good |
| sendAdminAlert + findLastOpenStep INLINE en CronScheduler + schedule-routes | PATTERNS.md §S-6 inline-twice antes de extraer; refactor pendiente al 3rd use (v2.3) | ✓ Good (resolved 2026-05-02 via quick-260502-i7l: extracted to src/utils/AdminEmailSender.js with callerLogFile param to preserve log routing per call-site) |
| Re-throw portal errors en getProviders (drop notifier swallow) | Servy no tiene sesión escritorio — notifier.notify era no-op invisible; re-throw permite caller distinguir error vs empty (quick 260502-i7l) | ✓ Good |
| Post-write validation en buildProvidersXML (size + `<Proveedor>` match + writeFileSync error capture) | Defense-in-depth contra disk errors silenciosos pre-deploy Capstone; cubre 3 paths: error portal / size <= 200 / writeFileSync rejection (quick 260502-i7l) | ✓ Good |
| sendAdminAlert extraído a src/utils/AdminEmailSender.js con callerLogFile param | 3rd use site (Providers_Downloader.js) triggered PATTERNS.md §S-6 refactor-just-in-time; param preserva [ADMIN-EMAIL] log routing por caller (CronScheduler.log, ScheduleRoutes.log, Providers_Downloader.log) (quick 260502-i7l) | ✓ Good |
| AbortController retrofit completo deferred | Phantom continuation NARROWED a step-level only es la forma actual; defer hasta evidencia operacional (v2.3 D-10) | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-13 — v2.4 milestone "Retry policies" scoping started (Phases 20-21 planned, closes GH #21, #22, #23). v2.3 shipped 2026-04-29.*
