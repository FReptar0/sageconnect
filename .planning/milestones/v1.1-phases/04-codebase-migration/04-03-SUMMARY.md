---
phase: 04-codebase-migration
plan: 03
subsystem: config
tags: [dotenv, config-loader, env-migration, cleanup]

# Dependency graph
requires:
  - phase: 04-01
    provides: "centralized config loader (src/config.js) and core module migration pattern"
  - phase: 03-02
    provides: "unified .env file with all variables consolidated"
provides:
  - "Zero dotenv.config() calls in entire codebase (except config loader itself)"
  - "Zero redundant .env.*.example files"
  - "All scripts and tests use centralized config loader"
affects: [05-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scripts use require('../config') for config access"
    - "Tests use require('../src/config') or jest.mock('../src/config')"
    - "config.portal.tenants.map(t => t.property) replaces manual split arrays"
    - "config.app.defaultAddress.* replaces DEFAULT_ADDRESS_* env vars"
    - "config.app.addressIdentifiersSkip replaces ADDRESS_IDENTIFIERS_SKIP.split()"

key-files:
  created: []
  modified:
    - "src/scripts/get-payment-cfdis.js"
    - "src/scripts/payment-reconciliation.js"
    - "src/scripts/payment-uuid-diagnostic.js"
    - "src/scripts/payment-uuid-repair.js"
    - "src/scripts/po-address-diagnostic.js"
    - "src/scripts/po-payment-form-diagnostic.js"
    - "src/scripts/po-query.js"
    - "src/scripts/po-update.js"
    - "src/scripts/po-upload.js"
    - "src/scripts/portal-payments-generator.js"
    - "src/scripts/upload-authorized-pos.js"
    - "tests/EnhancedPaymentSync.test.js"
    - "tests/GetPaymentCFDI.test.js"
    - "tests/EmailSender.test.js"
    - "tests/PaymentReconciliation.test.js"

key-decisions:
  - "Scripts use require('../config') not require('../../config') -- plan specified wrong path depth"
  - "PaymentReconciliation.test.js mocks '../src/config' with full config shape instead of mocking dotenv"
  - "EmailSender.test.js needs no config require since EmailSender loads config internally"
  - "Module-level URL constants added in scripts that reference config.portal.url to preserve existing template string patterns"

patterns-established:
  - "jest.mock('../src/config', () => ({...})) for test config isolation"
  - "config.app.addressIdentifiersSkip is already a split array -- use .filter() not .split().map()"

requirements-completed: [CONF-03, UNIF-03]

# Metrics
duration: 7min
completed: 2026-03-23
---

# Phase 4 Plan 3: Scripts & Tests Migration Summary

**Complete dotenv elimination from scripts and tests with redundant .env example cleanup**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-23T04:15:44Z
- **Completed:** 2026-03-23T04:23:00Z
- **Tasks:** 2
- **Files modified:** 20 (11 scripts + 4 tests + 5 deleted example files)

## Accomplishments
- Migrated all 11 script files from dotenv to centralized config loader
- Migrated all 4 test files from dotenv imports/mocks to config module pattern
- Deleted 5 redundant .env.*.example files (UNIF-03 complete)
- Zero dotenv references remain in entire codebase except config loader and its tests
- CONF-03 and UNIF-03 requirements fully satisfied

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate scripts to config loader** - `fb85e0f` (feat)
2. **Auto-fix: Correct config require path** - `25402f6` (fix)
3. **Task 2: Migrate test files and delete .env examples** - `681d7b4` (feat)

## Files Created/Modified
- `src/scripts/get-payment-cfdis.js` - Portal-only script, dotenv replaced with config.portal
- `src/scripts/payment-reconciliation.js` - Portal-only script, dotenv replaced with config.portal
- `src/scripts/payment-uuid-diagnostic.js` - Portal-only script, uses config.portal.tenants for databases
- `src/scripts/payment-uuid-repair.js` - Portal-only script, dotenv replaced with config.portal
- `src/scripts/po-address-diagnostic.js` - App-config script, uses config.app.defaultAddress
- `src/scripts/po-payment-form-diagnostic.js` - Portal-only script, uses config.portal for databases
- `src/scripts/po-query.js` - Portal+app script, uses config.portal + config.app.defaultAddress
- `src/scripts/po-update.js` - Portal+app script, uses config.portal + config.app.defaultAddress
- `src/scripts/po-upload.js` - Portal+app script, uses config.portal + config.app.defaultAddress
- `src/scripts/portal-payments-generator.js` - Portal-only script, dotenv replaced with config.portal
- `src/scripts/upload-authorized-pos.js` - Portal-only script, dotenv replaced with config.portal
- `tests/EnhancedPaymentSync.test.js` - Replaced dotenv with require('../src/config')
- `tests/GetPaymentCFDI.test.js` - Replaced dotenv with require('../src/config')
- `tests/EmailSender.test.js` - Removed dotenv import (EmailSender loads own config)
- `tests/PaymentReconciliation.test.js` - Replaced jest.mock('dotenv') with jest.mock('../src/config')
- `.env.credentials.database.example` - DELETED
- `.env.credentials.focaltec.example` - DELETED
- `.env.credentials.mailing.example` - DELETED
- `.env.path.example` - DELETED
- `dist/.env.example` - DELETED

## Decisions Made
- Plan specified `require('../../config')` for scripts, but that resolves to project root. Corrected to `require('../config')` which correctly resolves to `src/config.js`
- PaymentReconciliation.test.js mock provides full config shape (portal, database, mailing, paths, app) to prevent any property access errors
- EmailSender.test.js only needed removal of the dotenv line -- EmailSender already loads config internally since 04-01
- Scripts that used the global `URL` variable now define `const URL = config.portal.url` to preserve existing template string patterns without rewriting every usage

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected config require path in all 11 scripts**
- **Found during:** Task 2 (PaymentReconciliation.test.js verification)
- **Issue:** Plan specified `require('../../config')` but from `src/scripts/`, `../../config` resolves to project root `config.js` which doesn't exist. The correct path from `src/scripts/` to `src/config.js` is `../config`.
- **Fix:** Changed all 11 scripts from `require('../../config')` to `require('../config')`
- **Files modified:** All 11 script files in src/scripts/
- **Verification:** PaymentReconciliation.test.js passes 23/24 tests (1 pre-existing failure unrelated to migration)
- **Committed in:** `25402f6`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential for correctness -- wrong path would cause runtime crashes. No scope creep.

## Issues Encountered
- PaymentReconciliation.test.js has 1 pre-existing test failure ("should handle result.item being null/undefined") -- the test expects PY-001 to be MISSING when result.item is null, but the code's `fallbackExternalId` logic correctly resolves the ID from `toUpload[i]`. This is a test expectation bug, not related to our migration.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CONF-03 fully satisfied: zero dotenv.config() calls in the entire codebase except inside src/config.js
- UNIF-03 fully satisfied: no redundant .env.*.example files remain; only the unified .env.example exists
- Phase 4 plan 03 is complete. Combined with 04-01 (core modules) and 04-02 (controllers), the entire codebase is unified on the centralized config loader
- Ready for Phase 5 verification/cleanup

## Self-Check: PASSED

- [x] 04-03-SUMMARY.md exists
- [x] Commit fb85e0f (Task 1) exists
- [x] Commit 25402f6 (path fix) exists
- [x] Commit 681d7b4 (Task 2) exists
- [x] Zero dotenv references in scripts/tests (excluding config.test.js)
- [x] Zero .env.*.example files remain
- [x] Unified .env.example exists

---
*Phase: 04-codebase-migration*
*Completed: 2026-03-23*
