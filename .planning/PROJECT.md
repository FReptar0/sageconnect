# SageConnect

## What This Is

SageConnect es un servicio always-on de integración entre Sage 300 ERP y Portal de Proveedores (portaldeproveedores.mx). Automatiza la gestión de CFDIs, pagos, y órdenes de compra, expone una interfaz web operativa para auditoría de pagos, gestión de POs, diagnósticos, y monitoreo de scheduling. Deployado como Windows Service via Servy con scheduling interno (node-cron).

## Core Value

La integración Sage-Portal debe ser confiable, mantenible, y operable: servicio continuo con interfaz web para operaciones y monitoreo en tiempo real.

## Current State (post v2.2)

- **Service:** Always-on via Servy Windows Service, node-cron v4 internal scheduler (every 15 min)
- **License:** LicenseValidator validates against external server (sageconnect-license on Vercel) with HMAC-SHA256, anti-replay, three-state cache (24h TTL)
- **Enforcement:** Startup fail-fast, cron guard, Express middleware (503), DNS bypass detection
- **API:** 16 REST endpoints (7 payment + 9 PO) + 6 system endpoints (health, tenants, license, schedule, history, operations)
- **Web UI:** 4 pages + license banner + expiry badge + OC status change form (pos.html "Cambiar Estado OC")
- **Config:** `src/config.js` with fail-fast validation, 33+ env vars including LICENSE_API_URL, HMAC_SECRET, LICENSE_ADMIN_EMAIL
- **Scripts:** All 13 scripts + PortalOC_StatusUpdater return ResultEnvelope
- **SQL:** Singleton connection pool with USE [database] switching, auto-reconnect
- **Tests:** 200+ across the codebase (50 in PO routes alone)
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

### Active

**v2.3 Scheduler Lock Recovery** (diagnóstico + fix del bug "Ejecutar Ahora" siempre 409)

- Observability del estado de locks del scheduler en UI + endpoint diagnóstico
- Auto-release de locks por timeout (configurable, default 14 min)
- Manual force-release endpoint + botón UI con confirmación
- Timeout explícito en axios a portal de proveedores
- Timeout en `startChildProcess` (ImportaFacturasFocaltec.exe)
- Per-step timeout en `forResponse` vía Promise.race

## Current Milestone: v2.3 Scheduler Lock Recovery

**Goal:** Eliminar el bug donde el botón "Ejecutar Ahora" en `schedule.html` permanentemente retorna "ya en ejecución" por locks huérfanos en `OperationManager`. Agregar observability, recovery, y prevención de raíz.

**Target features:**
- Diagnóstico en UI del estado actual de locks y último heartbeat por step del ciclo
- Recuperación del operador: timeout auto + botón force-release + endpoint admin
- Prevención de causa raíz: timeouts en axios al portal, en child-process del importador, y per-step en el ciclo

**Key context:**
- Bug reportado 2026-04-24 en producción (server ZCL-RDS-02, cliente Capstone Copper)
- Hipótesis principal: llamadas axios al portal sin `timeout` explícito cuelgan `forResponse` indefinidamente → `finally` nunca corre → lock stuck
- Hipótesis secundaria: `ImportaFacturasFocaltec.exe` cuelga bajo Servy (sin sesión de escritorio)
- No hay repro local (requiere BD Sage)

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
*Last updated: 2026-04-24 — started v2.3 Scheduler Lock Recovery*
