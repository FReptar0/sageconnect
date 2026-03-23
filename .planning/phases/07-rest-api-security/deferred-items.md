# Deferred Items - Phase 07

## Pre-existing Test Failures (out of scope)

1. **TransformTime.test.js** - `minutesToMilliseconds` does not throw on 0 or negative input. Test expectations don't match implementation.
2. **PaymentReconciliation.test.js** - `BTCH-01: Missing result detection` test expects console.warn call that doesn't occur. Likely stale test from a refactor.
3. **Full-suite timeout** - supertest-based tests (security.test.js, po-routes.test.js, payment-routes.test.js) occasionally timeout at 5s when running all 14 suites in parallel. Pass individually. Consider increasing jest timeout or running API tests with `--runInBand`.

*Logged during: 07-03 plan execution*
*Date: 2026-03-23*
