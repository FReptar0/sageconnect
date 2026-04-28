# Phase 18 — Deferred Items

Items discovered during Phase 18 execution that are out-of-scope for the current plan but should be tracked for follow-up work.

## Discovered During Plan 18-01 (2026-04-28)

### 1. Pre-existing failure: `tests/services/operation-manager.test.js` "Config - Schedule Section" tests

**Status:** Pre-existing on master before Phase 18 started.

**Symptom:** When running `npx jest tests/services/operation-manager.test.js`, the 4 tests inside `describe('Config - Schedule Section', ...)` (lines 359-424 of the file) fail with:

```
[CONFIG ERROR] Missing required environment variables:
  - LICENSE_API_URL (license)
  - HMAC_SECRET (license)
  - LICENSE_ADMIN_EMAIL (license)
```

**Root cause:** The `setRequiredEnv()` helper at lines 372-385 does not set the three license env vars (`LICENSE_API_URL`, `HMAC_SECRET`, `LICENSE_ADMIN_EMAIL`) that became required after Plan 11-01 (`feat(11-01): add LICENSE_API_URL and HMAC_SECRET to config with fail-fast validation`, commit `5b4132f`) and Plan 12-01 (`feat(12-01): add LICENSE_ADMIN_EMAIL as required env var`, commit `5a87578`). The `loadRealConfig()` helper at lines 387-397 then calls `require('../../src/config')` which triggers `validate()` and exits.

**Why it's not Plan 18-01's bug:** Verified by `git stash && npx jest tests/services/operation-manager.test.js` on commit `3e7eabc` (Phase 18 entry point) — the 4 failures pre-date Phase 18.

**Fix sketch (out of scope, future plan):** Add these three lines to `setRequiredEnv()`:
```javascript
LICENSE_API_URL: 'https://test.example.com',
HMAC_SECRET: 'test_hmac_secret',
LICENSE_ADMIN_EMAIL: 'admin@test.example.com',
```

**Why it stays deferred:** Per executor scope rules, only auto-fix issues directly caused by the current task's changes. This failure pre-dates the task and modifying it would expand blast radius beyond the plan's `<files>` declaration.

### 2. Pre-existing failure: `tests/services/enforcement-wiring.test.js` — "proceeds normally when isValid() returns true"

**Status:** Pre-existing on master before Phase 18 started.

**Symptom:** The single test at lines 210-217 of `tests/services/enforcement-wiring.test.js`:
```javascript
test('proceeds normally when isValid() returns true', async () => {
    mockIsValid.mockReturnValue(true);
    await cronCallback();
    expect(mockForResponse).toHaveBeenCalled();
    expect(mockStartChildProcess).toHaveBeenCalled();
});
```
fails with `expect(mockStartChildProcess).toHaveBeenCalled()` reporting 0 calls. The console output shows `[LICENSE] Ciclo omitido: licencia inactiva`, suggesting `licenseValidator.isValid()` is being read as `false` despite the mockReturnValue(true) override.

**Root cause:** Likely related to the `jest.clearAllMocks()` call at line 155 in the `beforeEach` of the `'CronScheduler license guard'` describe block, which clears the mock but the `cronCallback` was captured BEFORE the test body's `mockIsValid.mockReturnValue(true)` runs, and the require('crypto').randomUUID spy is rebound on each test causing a re-evaluation issue.

**Why it's not Plan 18-01's bug:** Verified by `git checkout 3e7eabc -- tests/services/enforcement-wiring.test.js && npx jest tests/services/enforcement-wiring.test.js` — the same single failure occurs on the Phase 18 baseline commit.

**Fix sketch (out of scope, future plan):** Investigate the mock-clear ordering between `beforeEach` and the test body — the simplest fix is likely to move the `mockIsValid.mockReturnValue(true)` into the `beforeEach` for that describe block as the default state, with the false-state tests overriding to false explicitly.

**Why it stays deferred:** Pre-dates Phase 18. Plan 18-01's mock-additive change (add `on` + `removeAllListeners` to mockOperationManager) brings the file from 5 broken tests to 1 broken test — a net improvement, but the remaining 1 failure is an independent issue.

