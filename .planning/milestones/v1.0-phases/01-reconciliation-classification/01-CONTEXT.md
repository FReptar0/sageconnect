# Phase 1: Reconciliation Classification - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Corregir la lógica de clasificación en `payment-reconciliation.js`: auto-resolver PROVIDERIDs faltantes usando `getProviderByExternalId` y validar que `metadata.provider_id` del CFDI en portal coincida con el PROVIDERID de Sage antes de marcar un pago como READY TO UPLOAD. Nueva categoría PROVIDER MISMATCH para inconsistencias. El batch upload (Phase 2) y el flujo principal (`PortalPaymentController.js`) están fuera de scope.

</domain>

<decisions>
## Implementation Decisions

### Auto-resolución de PROVIDERID
- Escribir el PROVIDERID resuelto en Sage DB usando `ProviderIdResolver.js` (patrón consistente con `PortalPaymentController.js`)
- Auto-resolver en ambos modos (REPORT y --upload) — la escritura en Sage es beneficiosa siempre
- Después de auto-resolver exitosamente, el pago debe continuar por TODAS las validaciones restantes (UUID, presencia en portal, match de provider_id) — no asumir READY automáticamente
- Persistir el PROVIDERID incluso si después se detecta mismatch — el ID resuelto es correcto según el portal; el mismatch es un problema del CFDI
- Si la auto-resolución falla, reportar con contexto: mostrar el externalId buscado y el motivo del fallo (sin match vs matches múltiples)

### Validación de provider_id (mismatch)
- TODAS las facturas del pago deben tener `metadata.provider_id` coincidente con el PROVIDERID de Sage para ser READY — si una falla, todo el pago va a PROVIDER MISMATCH
- CFDI sin `metadata.provider_id` (null o vacío) se trata como mismatch — no se puede validar, por precaución se bloquea
- Comparación case-insensitive — los ObjectIds son hex y pueden venir con diferente casing entre portal y Sage
- Pagos auto-resueltos que resultan en mismatch se clasifican como PROVIDER MISMATCH (no MISSING PROVIDERID)

### Reporte y logging
- PROVIDER MISMATCH usa formato detallado: external_id, vendor, monto, moneda (como READY), más líneas indentadas por factura con portal_provider_id vs sage_providerid
- Pagos auto-resueltos exitosamente aparecen en la sección READY TO UPLOAD normal con marca [AUTO-FIX]
- SUMMARY incluye nueva línea "Provider mismatch: N" como categoría adicional
- SUMMARY incluye nueva línea "Auto-resolved: N" con conteo de pagos auto-resueltos
- Dual logging: auto-resoluciones como `info` y mismatches como `warn` tanto en consola como en log file (logGenerator)

### Claude's Discretion
- Orden exacto de las validaciones dentro del loop de clasificación
- Formato específico del mensaje de fallo de auto-resolución
- Manejo de errores de red durante la auto-resolución (reintentos, logging)

</decisions>

<specifics>
## Specific Ideas

- El tag [AUTO-FIX] es consistente con el patrón ya usado en `ProviderIdResolver.js`
- El reporte debe ser útil para el operador técnico: suficiente contexto para diagnosticar sin tener que buscar en logs

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ProviderIdResolver.js`: `resolveProviderIdByExternalId(vendorId, providerExternalId, index, db)` — ya hace lookup por externalId + escritura en APVENO. Reutilizable directamente.
- `GetProviders.js`: `getProviderByExternalId(index, providerExternalId)` — query al portal API. Usado por ProviderIdResolver.
- `portalUuidMap` en el script ya almacena `metadata.provider_id` por UUID — disponible para validación sin queries adicionales.

### Established Patterns
- Clasificación por categorías con `continue` después de cada check (`no_providerid`, `no_uuid`, `not_in_portal`, `ready`)
- Dual logging: `console.log/warn/error` + `logGenerator(logFileName, level, message)`
- Error handling: `.catch()` que retorna valor por defecto y logea, sin detener el script
- SQL string interpolation (patrón establecido, no se cambia en este scope)

### Integration Points
- El loop de clasificación en `payment-reconciliation.js:187-283` es donde se inserta la auto-resolución y validación de provider_id
- `categories` object necesita nueva key `provider_mismatch: []`
- La sección de reporte (`payment-reconciliation.js:288-336`) necesita nueva sección para PROVIDER MISMATCH
- El SUMMARY (`payment-reconciliation.js:329-336`) necesita nuevas líneas

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-reconciliation-classification*
*Context gathered: 2026-03-12*
