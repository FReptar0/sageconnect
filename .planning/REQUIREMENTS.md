# Requirements: SageConnect Payment Reconciliation Fixes

**Defined:** 2026-03-12
**Core Value:** Los pagos conciliados deben ser correctos antes de subirse al portal: proveedor validado, datos completos, y errores trazables.

## v1 Requirements

### Validación de Proveedor

- [ ] **PROV-01**: El script de conciliación valida que `metadata.provider_id` del CFDI en portal coincida con `PROVIDERID` de Sage antes de clasificar un pago como READY TO UPLOAD
- [ ] **PROV-02**: Pagos con mismatch de `provider_id` se clasifican en nueva categoría PROVIDER MISMATCH con detalle del ID esperado vs encontrado

### Auto-resolución

- [ ] **RSOL-01**: El script de conciliación auto-resuelve PROVIDERID faltante usando `getProviderByExternalId` con el `provider_external_id` del pago (campo `IDVEND` de Sage)
- [ ] **RSOL-02**: Si la auto-resolución encuentra match único, el pago se reclasifica de MISSING PROVIDERID a READY TO UPLOAD en el mismo ciclo

### Robustez de Batch Upload

- [ ] **BTCH-01**: El script verifica que cada `external_id` enviado en el batch tenga un resultado correspondiente en `results`; pagos sin resultado se reportan como MISSING RESULT
- [ ] **BTCH-02**: El script no envía request batch cuando `categories.ready.length === 0` con flag `--upload`

## v2 Requirements

### Consistencia

- **CONS-01**: Eliminar columna RFC residual de la query de conciliación y del reporte
- **CONS-02**: Agregar auto-resolución de UUIDs faltantes en el flujo de conciliación (como ya se hace en flujo principal)

## Out of Scope

| Feature | Reason |
|---------|--------|
| SQL injection en CLI args | Script ejecutado localmente por equipo técnico con acceso admin a BD |
| Refactoring general del codebase | Solo se corrigen gaps del flujo de pagos |
| Cambios al flujo principal (PortalPaymentController.js) | Ya funciona correctamente |
| Migración a queries parametrizadas | Patrón establecido en todo el codebase; cambio sistémico fuera de scope |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROV-01 | - | Pending |
| PROV-02 | - | Pending |
| RSOL-01 | - | Pending |
| RSOL-02 | - | Pending |
| BTCH-01 | - | Pending |
| BTCH-02 | - | Pending |

**Coverage:**
- v1 requirements: 6 total
- Mapped to phases: 0
- Unmapped: 6 ⚠️

---
*Requirements defined: 2026-03-12*
*Last updated: 2026-03-12 after initial definition*
