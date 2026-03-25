# SageConnect

## What This Is

SageConnect es un servicio always-on de integración entre Sage 300 ERP y Portal de Proveedores (portaldeproveedores.mx). Automatiza la gestión de CFDIs, pagos, y órdenes de compra, expone una interfaz web operativa para auditoría de pagos, gestión de POs, diagnósticos, y monitoreo de scheduling. Deployado como Windows Service via Servy con scheduling interno (node-cron).

## Core Value

La integración Sage-Portal debe ser confiable, mantenible, y operable: servicio continuo con interfaz web para operaciones y monitoreo en tiempo real.

## Current State (post v2.0)

- **Service:** Always-on via Servy Windows Service, node-cron v4 internal scheduler (every 15 min)
- **API:** 15 REST endpoints (7 payment + 8 PO) + 5 system endpoints, secured with helmet/cors/rate-limit/API key
- **Web UI:** 4 pages — schedule dashboard (home), payment audit, PO management, logs. Sidebar + tenant switcher.
- **Config:** `src/config.js` with fail-fast validation, 30+ env vars including SAGECONNECT_API_KEY, CRON_SCHEDULE, OPERATION_DELAY_MS
- **Scripts:** All 13 scripts + PortalOC_StatusUpdater return ResultEnvelope `{ success, data, errors, summary, meta }`
- **SQL:** Singleton connection pool with USE [database] switching, auto-reconnect
- **Tests:** 200+ across the codebase
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

### Active

(None — pending v2.1 milestone definition)

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

---
*Last updated: 2026-03-25 after v2.0 milestone*
