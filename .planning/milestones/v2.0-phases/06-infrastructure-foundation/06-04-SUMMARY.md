---
phase: 06-infrastructure-foundation
plan: 04
subsystem: infra
tags: [result-envelope, envelope-returns, script-refactor, process-exit-guard, contract-test]

# Dependency graph
requires:
  - "06-01: ResultEnvelope helper with createResult/successResult/errorResult"
  - "06-02: PortalOC_StatusUpdater refactored with envelope and require.main guard"
  - "06-03: 8 easy scripts returning envelopes with process.exit guards"
provides:
  - "5 hard scripts (no-export) refactored to export named async functions returning envelopes"
  - "payment-uuid-repair exports 3 separate functions per mode (scan/repair/upload)"
  - "test-order-lifecycle exports 3 separate functions per mode (analyze/process/tenant)"
  - "Envelope contract test validating all 14 modules (13 scripts + PortalOC_StatusUpdater)"
  - "INFRA-01 complete: all scripts return structured data objects"
affects: [07-api-security]

# Tech tracking
tech-stack:
  added: []
  patterns: [options-parameter-pattern, envelope-return, cli-arg-separation]

key-files:
  created:
    - tests/envelope-contract.test.js
  modified:
    - src/scripts/payment-uuid-diagnostic.js
    - src/scripts/payment-uuid-repair.js
    - src/scripts/portal-payments-generator.js
    - src/scripts/upload-authorized-pos.js
    - src/scripts/test-order-lifecycle.js

key-decisions:
  - "Options parameter pattern: all exported functions accept options={} object instead of positional args, enabling API layer to pass structured params"
  - "CLI arg parsing fully separated from business logic: exported functions never touch process.argv"
  - "payment-uuid-diagnostic.diagnosePayment accepts {docNbr, tenantIndex} options or plain string for backward compat"
  - "upload-authorized-pos: added missing axios import (pre-existing bug, Rule 1 auto-fix)"

patterns-established:
  - "Options parameter pattern: exported functions take options={} with tenantIndex, database, and script-specific params"
  - "CLI guard IIFE: require.main block wraps async IIFE that parses argv, builds options, calls exported function"
  - "Contract test mocking: mock config.js, SQLServerConnection, axios, LogGenerator to validate structure without DB"

requirements-completed: [INFRA-01]

# Metrics
duration: 11min
completed: 2026-03-23
---

# Phase 6 Plan 4: Function Extraction for 5 No-Export Scripts + Envelope Contract Test Summary

**5 hard scripts refactored to export 11 named async functions returning ResultEnvelopes, plus 65-test contract suite validating all 14 modules**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-23T20:48:22Z
- **Completed:** 2026-03-23T20:59:44Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- All 5 no-export scripts now export named async functions with ResultEnvelope returns
- payment-uuid-repair: modeScan/modeRepair/modeUpload renamed to scanForRepairableUUIDs/repairUUIDs/uploadRepairedPayments with options parameter
- test-order-lifecycle: analyzeOrder/processOrder/processTenant renamed to analyzeOrders/processOrders/testTenant with options parameter
- portal-payments-generator: CLI arg parsing extracted from business logic, renamed testGeneratePaymentJson to generatePayments
- upload-authorized-pos: renamed testQuery to uploadAuthorizedPOs, added missing axios import
- Envelope contract test validates all 14 modules (65 tests) with comprehensive mocking
- Phase 6 INFRA-01 now fully complete: all 13 scripts + 1 controller return structured envelopes

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract and export functions from 5 no-export scripts** - `b4661a1` (feat)
2. **Task 2: Envelope contract test for all 14 modules** - `2ed1cb1` (test)

## Files Created/Modified
- `src/scripts/payment-uuid-diagnostic.js` - diagnosePayment({docNbr, tenantIndex}) returns envelope with header, invoices, diagnosis
- `src/scripts/payment-uuid-repair.js` - scanForRepairableUUIDs/repairUUIDs/uploadRepairedPayments with options param, envelope returns
- `src/scripts/portal-payments-generator.js` - generatePayments({tenantIndex, pyFilter, dateFilter, shouldPost}) returns envelope with stats
- `src/scripts/upload-authorized-pos.js` - uploadAuthorizedPOs({tenantIndex}) returns envelope with sent/skipped/error stats
- `src/scripts/test-order-lifecycle.js` - analyzeOrders/processOrders/testTenant with options param, envelope returns
- `tests/envelope-contract.test.js` - 65 tests validating exports for all 14 modules

## Decisions Made
- Options parameter pattern adopted for all 5 scripts: functions accept `options = {}` instead of positional arguments, making them API-ready
- CLI arg parsing fully separated from business logic: the require.main guard wraps an async IIFE that parses argv, builds an options object, and calls the exported function
- payment-uuid-diagnostic.diagnosePayment accepts either `{docNbr, tenantIndex}` options or a plain string for backward compatibility with getAllFailingPayments
- upload-authorized-pos: the pre-existing missing `axios` import was added (the script used `axios.post` but never required it)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added missing axios import in upload-authorized-pos.js**
- **Found during:** Task 1
- **Issue:** Script used `axios.post()` at line 229 but never imported axios, causing ReferenceError at runtime
- **Fix:** Added `const axios = require('axios')` to the import block
- **Files modified:** src/scripts/upload-authorized-pos.js
- **Verification:** Structural check passes (module loads without error in contract test)
- **Committed in:** b4661a1 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 pre-existing bug)
**Impact on plan:** Essential fix for script correctness. No scope creep.

## Issues Encountered
None - all scripts had existing require.main guards and module.exports from prior 06-02 work, making the refactor lighter than expected (rename exports + add envelope wrapping + extract CLI args).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 6 is now COMPLETE: all 4 plans executed
- INFRA-01 satisfied: all 13 scripts + 1 controller return ResultEnvelope
- INFRA-02 satisfied: all process.exit calls guarded or removed (verified by no-process-exit.test.js)
- INFRA-03 satisfied: singleton SQL pool with USE [database] switching (done in 06-01)
- 190/194 tests pass (3 pre-existing failures in TransformTime + PaymentReconciliation, 1 skipped)
- Ready for Phase 7: API + Security layer can now call any script function and get structured responses

## Self-Check: PASSED

- All 6 files exist on disk
- Task 1 commit verified: b4661a1
- Task 2 commit verified: 2ed1cb1
- Envelope contract test: 65/65 pass
- No-process-exit test: 8/8 pass
- Full suite: 190/194 pass (3 pre-existing failures, 1 skipped)

---
*Phase: 06-infrastructure-foundation*
*Completed: 2026-03-23*
