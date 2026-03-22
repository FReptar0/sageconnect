# Phase 2: Batch Upload Robustness - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Hacer robusto el path de batch upload en `payment-reconciliation.js`: no enviar batch requests vacíos cuando no hay pagos READY, y verificar que cada pago enviado tenga un resultado correspondiente en el response del API. El flujo de clasificación (Phase 1) y el flujo principal (`PortalPaymentController.js`) están fuera de scope.

</domain>

<decisions>
## Implementation Decisions

### Missing results handling
- Después de procesar el array `results`, iterar `toUpload` para encontrar `external_id`s sin resultado correspondiente
- Pagos sin resultado NO se registran en `fesaPagosFocaltec` — quedan disponibles para reenvío en la siguiente ejecución (el API retorna error de duplicado si ya se procesó)
- Log level: `warn` — es anómalo pero no fatal, el pago será reintentado
- Formato inline: `[WARN] {external_id} MISSING RESULT — not in API response` — mismo nivel de indentación que las líneas [OK] y [ERROR] existentes
- Dual logging: tanto `console.warn` como `logGenerator(logFileName, 'warn', ...)` — consistente con patrón de Phase 1
- Contador propio `missingCount` separado de `errorCount` — missing no es lo mismo que un error del API

### Empty batch guard
- Guard antes de la sección de upload (donde se verifica `shouldUpload`): si `categories.ready.length === 0`, imprimir mensaje info y retornar early
- Mensaje info (no warning): `No payments ready to upload.` — el reporte ya muestra por qué nada está ready
- No se muestra sección UPLOAD COMPLETE — nada fue enviado, nada que resumir
- Dual logging: `console.log` + `logGenerator(logFileName, 'info', ...)` para el evento de empty batch
- En modo REPORT: no mostrar hint `Use --upload to send the N ready payments` cuando `categories.ready.length === 0` — sería engañoso

### Upload summary format
- Nueva línea `Sent: N` como primera línea del summary (permite verificar Success + Errors + Missing = Sent)
- Nueva línea `Missing: N` solo cuando `missingCount > 0`
- Formato final:
  ```
  === UPLOAD COMPLETE ===
    Sent:    5
    Success: 3
    Errors:  1
    Missing: 1
    Remaining: 15 (run again to process next batch)
  ```

### Claude's Discretion
- Implementación exacta del Set/Map para tracking de external_ids respondidos
- Manejo del edge case donde `result.item` es null/undefined (cómo extraer el external_id)
- Orden de las validaciones dentro del upload section

</decisions>

<specifics>
## Specific Ideas

- El API spec NO garantiza que `results.length === payments.length` — cada resultado tiene `error_code` individual para fallos parciales
- El API retorna error de duplicado si se envía un `external_id` que ya existe en el portal — esto actúa como safety net para pagos missing que se reenvían
- El operador técnico necesita poder verificar que Sent = Success + Errors + Missing

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `logGenerator(logFileName, level, message)`: dual logging ya usado en todo el script — reutilizar directamente
- Patrón de `successCount`/`errorCount`: agregar `missingCount` siguiendo la misma convención
- `toUpload` array: ya contiene los pagos enviados — iterar para detectar missing

### Established Patterns
- Procesamiento de resultados por `result.item?.external_id` con `toUpload.find()` — extender para tracking
- Control table insert solo en `error_code === 0` — no cambia, missing results simplemente no llegan a este punto
- CLI flag check: `if (!shouldUpload) { ... return; }` — el empty guard se inserta justo después

### Integration Points
- Líneas ~462-467: donde se verifica `shouldUpload` — insertar empty guard aquí
- Líneas ~526-572: loop de procesamiento de resultados — agregar tracking de external_ids procesados
- Líneas ~581-586: UPLOAD COMPLETE summary — agregar Sent y Missing lines

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-batch-upload-robustness*
*Context gathered: 2026-03-12*
