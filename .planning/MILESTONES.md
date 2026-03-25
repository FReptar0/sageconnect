# Milestones

## v2.0 Always-On Service (Shipped: 2026-03-25)

**Phases completed:** 5 phases, 16 plans
**Files:** 117 files changed, 20,560 insertions, 1,074 deletions
**Git range:** `fe2cd63` → `e273659`

**Key accomplishments:**
- Singleton SQL connection pool with USE [database] switching + ResultEnvelope unified response contract across all 14 modules
- 15 REST API endpoints (7 payment + 8 PO) with helmet, CORS, rate-limit, API key auth (SAGECONNECT_API_KEY)
- Internal node-cron v4 scheduler replacing Windows Task Scheduler with noOverlap, OperationManager concurrency locks, SSE progress streaming
- 4 operational web pages: schedule dashboard (home), payment audit (5-category cards + drill-down), PO management (diagnostic search + actions), logs (migrated)
- Servy Windows Service setup with auto-start, crash recovery, log rotation + Spanish deployment guide
- Complete legacy removal: AutoShutdownService, AUTO_TERMINATE, RunSageconnect.bat, --web-only all gone
- 200+ tests across the codebase

**Tech debt:**
- 3 pre-existing test failures (TransformTime x2, PaymentReconciliation x1) carried from v1.1

---

## v1.1 Env Unification (Shipped: 2026-03-23)

**Phases completed:** 3 phases, 6 plans, 7 tasks
**Files:** 830 LOC new (config.js 156 + config tests 444 + regression tests 230) + 31 modules migrated
**Tests:** 108 total (104 pass, 3 pre-existing, 1 skipped integration)
**Git range:** `fb1d8a4` → `62ddfd4`

**Key accomplishments:**
- Centralized config loader (`src/config.js`) with fail-fast validation and structured sections (database, portal, mailing, paths, app)
- Unified 5 scattered `.env` files into single `.env` with section comments
- Multi-tenant portal config exposed as array of tenant objects (not parallel arrays)
- Mailing transport selector (`MAIL_TRANSPORT=smtp|gmail`) for easy switching
- Migrated 31 source modules from 25+ independent `dotenv.config()` calls to centralized `require('../config')`
- Fixed OS env var collisions: `USER`→`DB_USER`, `PATH`→`DOWNLOADS_PATH`
- Regression verification: 25 module-load tests + dotenv scan confirming zero leakage

**Tech debt (resolved during audit):**
- PATH→DOWNLOADS_PATH rename (fixed before shipping)

**Remaining tech debt:**
- `EnhancedPaymentSync.test.js` has unmocked `require('../src/config')` (excluded from Jest)
- 3 pre-existing test failures should be `test.skip`'d (TransformTime 2/3, PaymentReconciliation 1/24)

---

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

