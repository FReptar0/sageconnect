---
phase: 02-batch-upload-robustness
plan: 01
subsystem: payments
tags: [batch-upload, tdd, refactoring, jest]

# Dependency graph
requires:
  - phase: 01-reconciliation-classification
    provides: classifyPayments extraction pattern and test infrastructure
provides:
  - Exported uploadBatch function for independent testability
  - TDD RED tests defining BTCH-01 (missing result detection) and BTCH-02 (empty batch guard) contracts
  - Test fixtures (makeUploadOptions, makeCategories, makeReadyEntry) for upload testing
affects: [02-batch-upload-robustness]

# Tech tracking
tech-stack:
  added: []
  patterns: [function extraction for testability, TDD RED-before-implementation]

key-files:
  created: []
  modified:
    - src/scripts/payment-reconciliation.js
    - tests/PaymentReconciliation.test.js

key-decisions:
  - "uploadBatch receives categories and config as explicit parameters (same pattern as classifyPayments)"
  - "Upload hint in report mode already guarded by ready.length > 0 -- no change needed for BTCH-02 baseline"

patterns-established:
  - "Function extraction: move inline logic into exported async function with injected dependencies"
  - "TDD fixture builders: makeUploadOptions, makeCategories, makeReadyEntry for upload test scenarios"

requirements-completed: [BTCH-01, BTCH-02]

# Metrics
duration: 4min
completed: 2026-03-12
---

# Phase 2 Plan 01: Extract uploadBatch and TDD RED Tests Summary

**Extracted uploadBatch from main() for independent testability and wrote 13 failing/baseline TDD tests defining BTCH-01 (missing result detection) and BTCH-02 (empty batch guard) behavior contracts**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-12T18:46:11Z
- **Completed:** 2026-03-12T18:50:33Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extracted upload section (lines 462-586) from main() into standalone exported uploadBatch() function with explicit parameter injection
- main() now delegates to uploadBatch() -- behavior identical, zero regression on 11 Phase 1 tests
- 13 new tests added (8 RED failing, 5 GREEN baseline) defining exact behavior contracts for Plan 02 implementation
- Test fixtures (makeUploadOptions, makeCategories, makeReadyEntry) established for reuse in Plan 02

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract uploadBatch function from main()** - `578d534` (feat)
2. **Task 2: Write failing tests for BTCH-01 and BTCH-02** - `1bfb6a8` (test)

## Files Created/Modified
- `src/scripts/payment-reconciliation.js` - Extracted uploadBatch function, updated module.exports to export both classifyPayments and uploadBatch
- `tests/PaymentReconciliation.test.js` - Added uploadBatch import, axios import, 3 fixture helpers, 13 new test cases across 4 describe blocks

## Decisions Made
- uploadBatch receives categories object and a destructured config object with all upload-related parameters (shouldUpload, batchLimit, index, logFileName, tenantIds, apiKeys, apiSecrets, database, URL) -- avoids coupling to module-scope CLI variables
- Upload hint suppression in report mode when ready.length is 0 already works correctly in existing code (guarded by `if (categories.ready.length > 0)`) -- confirmed as GREEN baseline test
- Tests for "no missing when all results present" and "no missing scan on full failure" pass against current code as expected GREEN baselines

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- uploadBatch is exported and independently testable via mocked axios, runQuery, logGenerator
- 8 failing tests define the exact contracts for Plan 02 (GREEN phase):
  - BTCH-02: empty batch guard (2 RED: axios.post not called, logGenerator info message)
  - BTCH-01: missing result detection (4 RED: single missing, multiple missing, logGenerator warn, null item handling)
  - BTCH-01: updated summary format (2 RED: Sent line, Missing line)
- All Phase 1 tests remain GREEN as regression baseline

---
*Phase: 02-batch-upload-robustness*
*Completed: 2026-03-12*
