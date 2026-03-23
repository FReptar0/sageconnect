# SageConnect

## What This Is

SageConnect es un sistema de integración entre Sage 300 ERP y Portal de Proveedores (portaldeproveedores.mx) que automatiza la gestión de CFDIs, pagos, y órdenes de compra.

## Core Value

La integración Sage-Portal debe ser confiable, mantenible, y operable: configuración centralizada, datos validados, y errores trazables.

## Current State (post v1.1)

- **Config:** `src/config.js` (156 LOC) — centralized loader with fail-fast validation, multi-tenant parsing, mailing-optional
- **Env:** Single `.env` with 27+ variables, documented `.env.example`, old files archived to `.env.legacy/`
- **Tests:** 108 total (config 27, payment reconciliation 24, regression 25, others 32)
- **Payment reconciliation:** `classifyPayments` + `uploadBatch` exported, 5 categories, auto-resolve PROVIDERID
- **Modules:** 31 source files use `require('../config')` — zero scattered dotenv calls

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

### Active

- [ ] Eliminar columna RFC residual de la query de conciliación (CONS-01)
- [ ] Auto-resolución de UUIDs faltantes en flujo de conciliación (CONS-02)
- [ ] Soporte multi-ambiente sandbox/production vía NODE_ENV (MENV-01)

### Out of Scope

- SQL injection en CLI args — script ejecutado localmente por equipo técnico
- Migración a queries parametrizadas — patrón establecido en todo el codebase
- Migración a YAML config — .env es el estándar Node.js

## Context

- **Rama activa:** `refactor/unify-env-files`
- **Config pattern:** `const config = require('../config')` → `config.section.property`
- **Multi-tenant:** `config.portal.tenants[index].id/key/secret/database/externalId`
- **Mailing:** `MAIL_TRANSPORT=smtp|gmail` selector en .env

## Constraints

- **Sin BD Sage local:** Queries SQL se validan por estructura, no por ejecución
- **Zero nuevas dependencias:** dotenv ya instalado
- **Backward-compatible:** Todos los CLI flags y funcionalidad existente intactos

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Usar `external_id` en vez de RFC para PROVIDERID | RFC puede tener duplicados; external_id es único | ✓ Good |
| Validar provider_id antes de marcar READY | Mismatch = pago a proveedor incorrecto | ✓ Good |
| Missing results no en fesaPagosFocaltec | Permite reenvío automático; API retorna duplicado | ✓ Good |
| Single .env + config loader (no YAML) | Zero dependencias nuevas, Node.js estándar | ✓ Good |
| Fail-fast validation con process.exit(1) | Previene fallos silenciosos por config incompleta | ✓ Good |
| Renombrar USER→DB_USER, PATH→DOWNLOADS_PATH | dotenv no sobreescribe vars del OS | ✓ Good |
| Multi-tenant como array de objetos (no arrays paralelos) | Más limpio, agrupa datos por tenant | ✓ Good |
| Mailing opcional en validación | No todos los deployments usan email | ✓ Good |

---
*Last updated: 2026-03-23 after v1.1 milestone*
