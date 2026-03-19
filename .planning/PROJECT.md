# SageConnect — Payment Reconciliation Fixes

## What This Is

SageConnect es un sistema de integración entre Sage 300 ERP y Portal de Proveedores (portaldeproveedores.mx) que automatiza la gestión de CFDIs, pagos, y órdenes de compra. Este proyecto se enfoca en corregir gaps funcionales y de robustez en el flujo de conciliación de pagos (`payment-reconciliation.js`) y su consistencia con el flujo principal de subida de pagos (`PortalPaymentController.js`).

## Core Value

Los pagos conciliados deben ser correctos antes de subirse al portal: proveedor validado, datos completos, y errores trazables. Un pago subido con proveedor incorrecto o un error silenciado causa problemas operativos difíciles de revertir.

## Requirements

### Validated

- ✓ Resolución de PROVIDERID por `external_id` en flujo principal (`PortalPaymentController.js`) — existing
- ✓ Auto-resolución de UUIDs faltantes vía portal (`UuidResolver.js`) — existing
- ✓ Script de conciliación con clasificación en 4 categorías (READY, MISSING PROVIDERID, MISSING UUID, NOT IN PORTAL) — existing
- ✓ Subida batch al portal con registro en control table (`fesaPagosFocaltec`) — existing
- ✓ Búsqueda de proveedor por `externalId` con validación de match único (`getProviderByExternalId`) — existing

### Active

- [ ] Validar que `provider_id` del CFDI en portal coincida con `PROVIDERID` de Sage antes de marcar pago como READY
- [ ] Auto-resolver PROVIDERID faltante por `externalId` en el flujo de conciliación (como ya se hace en flujo principal)
- [ ] Verificar que todos los pagos enviados en batch tengan un resultado correspondiente en el response del API
- [ ] No enviar batch vacío cuando `categories.ready.length === 0` con flag `--upload`

### Out of Scope

- SQL injection en CLI args (`--py`, `--from`) — script ejecutado localmente por equipo técnico con acceso admin a BD, riesgo irrelevante
- Refactoring general del codebase — solo se corrigen los gaps del flujo de pagos
- Cambios al flujo principal (`PortalPaymentController.js`) — ya funciona correctamente
- Eliminación de columna RFC residual en query de conciliación — funcional, no impacta comportamiento

## Context

- **Rama activa:** `fix/missing-payments` (9 commits adelante de `master`)
- **Cambio reciente clave:** La resolución de PROVIDERID migró de RFC a `external_id` (commit `215b2e0`)
- **API spec disponible:** `.planning/codebase/API-SPEC.md` (extraída del Swagger sandbox)
- **Batch response:** La spec del API NO garantiza que `results.length === payments.length`; cada resultado tiene `error_code` individual para fallos parciales
- **PROVIDERID en APVENO:** Almacena el `id` interno del portal (MongoDB ObjectId, ej: `67c8cc3d44c84041d85f9d3d`)
- **`metadata.provider_id` en CFDIs:** Es el mismo ID interno PDP — permite validación directa contra PROVIDERID de Sage
- **Ambiente de pruebas:** Credenciales sandbox en `reports/.env.credentials.focaltec.backup`; sin acceso a BD Sage en máquina local, solo lado consumo API

## Constraints

- **Sin BD Sage local:** Los cambios en `payment-reconciliation.js` solo pueden probarse del lado API portal; queries SQL se validan por estructura, no por ejecución
- **Consistencia:** El script de conciliación debe seguir los mismos patrones que `PortalPaymentController.js` para resolución de PROVIDERID
- **Backward-compatible:** Los flags CLI existentes (`--upload`, `--batch`, `--from`, `--py`, `--index`) deben seguir funcionando igual

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Usar `external_id` en vez de RFC para resolver PROVIDERID | RFC puede tener duplicados (ej: XEXX010101000 para extranjeros); external_id es único por vendor | ✓ Good |
| No corregir SQL injection en CLI args | Solo equipo técnico con acceso admin ejecuta el script; riesgo irrelevante | — Pending |
| Validar provider_id antes de marcar READY | Un mismatch significaría subir pago a proveedor incorrecto en portal | — Pending |

---
*Last updated: 2026-03-12 after initialization*
