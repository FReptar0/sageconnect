# SageConnect — Payment Reconciliation Fixes

## What This Is

SageConnect es un sistema de integración entre Sage 300 ERP y Portal de Proveedores (portaldeproveedores.mx) que automatiza la gestión de CFDIs, pagos, y órdenes de compra. Este proyecto se enfoca en corregir gaps funcionales y de robustez en el flujo de conciliación de pagos (`payment-reconciliation.js`) y su consistencia con el flujo principal de subida de pagos (`PortalPaymentController.js`).

## Core Value

Los pagos conciliados deben ser correctos antes de subirse al portal: proveedor validado, datos completos, y errores trazables. Un pago subido con proveedor incorrecto o un error silenciado causa problemas operativos difíciles de revertir.

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

- [ ] Eliminar columna RFC residual de la query de conciliación y del reporte (CONS-01)
- [ ] Agregar auto-resolución de UUIDs faltantes en el flujo de conciliación (CONS-02)

### Out of Scope

- SQL injection en CLI args (`--py`, `--from`) — script ejecutado localmente por equipo técnico con acceso admin a BD, riesgo irrelevante
- Refactoring general del codebase — solo se corrigen los gaps del flujo de pagos
- Cambios al flujo principal (`PortalPaymentController.js`) — ya funciona correctamente
- Migración a queries parametrizadas — patrón establecido en todo el codebase; cambio sistémico fuera de scope

## Context

- **Rama activa:** `fix/missing-payments`
- **API spec disponible:** `.planning/codebase/API-SPEC.md` (extraída del Swagger sandbox)
- **PROVIDERID en APVENO:** Almacena el `id` interno del portal (MongoDB ObjectId)
- **`metadata.provider_id` en CFDIs:** Es el mismo ID interno PDP — validación directa contra PROVIDERID de Sage
- **Ambiente de pruebas:** Credenciales sandbox en `reports/.env.credentials.focaltec.backup`

## Constraints

- **Sin BD Sage local:** Los cambios solo pueden probarse del lado API portal; queries SQL se validan por estructura
- **Consistencia:** El script de conciliación sigue los mismos patrones que `PortalPaymentController.js`
- **Backward-compatible:** Los flags CLI existentes (`--upload`, `--batch`, `--from`, `--py`, `--index`) siguen funcionando igual

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
*Last updated: 2026-03-22 after v1.0 milestone*
