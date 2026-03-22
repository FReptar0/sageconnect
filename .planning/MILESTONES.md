# Milestones

## v1.0 Payment Reconciliation Fixes (Shipped: 2026-03-22)

**Phases completed:** 2 phases, 4 plans, 7 tasks
**Files:** 708 LOC production + 712 LOC tests (1,420 total)
**Tests:** 24 passing (6 requirements covered)
**Git range:** `267bdc1` → `f0b08b6`

**Key accomplishments:**
- Extracted `classifyPayments` and `uploadBatch` as testable exported functions (TDD pattern)
- Auto-resolución de PROVIDERID faltante vía `getProviderByExternalId` en el mismo ciclo de conciliación
- Validación de `provider_id` mismatch con nueva categoría PROVIDER MISMATCH y detalle por factura
- Guard de batch vacío para prevenir requests innecesarios al API del portal
- Detección de pagos faltantes en response batch con tracking por `respondedIds` Set
- Suite TDD completa: 24 tests cubriendo PROV-01, PROV-02, RSOL-01, RSOL-02, BTCH-01, BTCH-02

**Tech debt:**
- `runQuery(insertSql)` en `uploadBatch` omite argumento `db` — funcional por nombre SQL de 3 partes, pero inconsistente

---

