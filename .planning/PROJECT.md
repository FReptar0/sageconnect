# SageConnect

## What This Is

SageConnect es un sistema de integración entre Sage 300 ERP y Portal de Proveedores (portaldeproveedores.mx) que automatiza la gestión de CFDIs, pagos, y órdenes de compra.

## Core Value

La integración Sage-Portal debe ser confiable, mantenible, y operable: configuración centralizada, datos validados, y errores trazables.

## Current Milestone: v1.1 Env Unification

**Goal:** Unificar los 5 archivos .env dispersos en un solo archivo con un config loader centralizado que valide variables requeridas al arranque y exponga configuración estructurada.

**Target features:**
- Config loader centralizado (`src/config.js`) que carga un solo `.env` y exporta objeto estructurado
- Validación fail-fast de variables requeridas al arranque
- Reemplazo de las 25+ llamadas `dotenv.config()` dispersas por `require('./config')`
- Un solo `.env.example` como referencia de todas las variables

## Current State (post v1.0)

- **Script:** `payment-reconciliation.js` — 708 LOC con funciones exportadas `classifyPayments` y `uploadBatch`
- **Tests:** `PaymentReconciliation.test.js` — 712 LOC, 24 tests pasando
- **Categorías:** READY, MISSING PROVIDERID, MISSING UUID, NOT IN PORTAL, PROVIDER MISMATCH (nueva en v1.0)
- **Auto-resolución:** PROVIDERID se resuelve en el mismo ciclo vía `getProviderByExternalId`
- **Batch robustez:** Guard de batch vacío + detección de pagos faltantes en response

## Requirements

### Validated

- ✓ Resolución de PROVIDERID por `external_id` en flujo principal (`PortalPaymentController.js`) — existing
- ✓ Auto-resolución de UUIDs faltantes vía portal (`UuidResolver.js`) — existing
- ✓ Script de conciliación con clasificación en 5 categorías — existing + v1.0
- ✓ Subida batch al portal con registro en control table (`fesaPagosFocaltec`) — existing
- ✓ Búsqueda de proveedor por `externalId` con validación de match único — existing
- ✓ Validación de `provider_id` del CFDI contra PROVIDERID de Sage antes de READY — v1.0
- ✓ Auto-resolución de PROVIDERID faltante en flujo de conciliación — v1.0
- ✓ Verificación de completitud de resultados en batch response — v1.0
- ✓ Guard de batch vacío en modo --upload — v1.0

### Active

- [ ] Unificar 5 archivos .env en un solo archivo
- [ ] Config loader centralizado con validación fail-fast
- [ ] Reemplazar 25+ llamadas dotenv.config() por require centralizado
- [ ] Limpiar archivos .env.example redundantes

### Out of Scope

- SQL injection en CLI args — script ejecutado localmente por equipo técnico
- Migración a queries parametrizadas — patrón establecido en todo el codebase
- Soporte multi-ambiente (sandbox/prod) — solo producción por ahora, estructura permite agregar después
- Migración a YAML — se mantiene .env como estándar Node.js

## Context

- **Rama activa:** `refactor/unify-env-files`
- **Archivos .env actuales:** 5 archivos separados (.env, .env.path, .env.credentials.database, .env.credentials.focaltec, .env.credentials.mailing)
- **Variables totales:** 27 únicas, con 25+ llamadas dotenv.config() independientes
- **Backups en /reports/:** 5 archivos .backup con configuración histórica (se mantienen)
- **Patrón actual:** Cada módulo carga su propio .env; mezcla de `.parsed` y `process.env`

## Constraints

- **Sin BD Sage local:** Queries SQL se validan por estructura, no por ejecución
- **Backward-compatible:** La aplicación debe funcionar igual después de la migración
- **Zero nuevas dependencias:** dotenv ya está instalado; no agregar yaml parsers ni config frameworks
- **Credenciales activas:** No romper la configuración de producción durante la migración

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Usar `external_id` en vez de RFC para resolver PROVIDERID | RFC puede tener duplicados (ej: XEXX010101000 para extranjeros); external_id es único por vendor | ✓ Good |
| No corregir SQL injection en CLI args | Solo equipo técnico con acceso admin ejecuta el script; riesgo irrelevante | ✓ Good |
| Validar provider_id antes de marcar READY | Un mismatch significaría subir pago a proveedor incorrecto en portal | ✓ Good |
| Comparación case-insensitive de provider_id | ObjectIds son hex y pueden venir con diferente casing entre portal y Sage | ✓ Good |
| Missing results no se registran en fesaPagosFocaltec | Permite reenvío automático en siguiente ciclo; API retorna error de duplicado como safety net | ✓ Good |
| Extraer classifyPayments y uploadBatch como funciones exportadas | Patrón TDD: funciones testables independientemente con dependencias inyectables | ✓ Good |

---
*Last updated: 2026-03-22 after v1.1 milestone start*
