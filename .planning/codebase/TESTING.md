# Testing Patterns

**Analysis Date:** 2026-03-12

## Test Framework

**Runner:**
- Jest 29.7.0
- Config: `jest.config.js`

**Assertion Library:**
- Jest built-in expect API (`@jest/globals`)

**Run Commands:**
```bash
npm test              # Run all tests matching <rootDir>/tests/**/*.test.js
```

**Test Discovery:**
- Pattern: `tests/**/*.test.js`
- All test files located in `/tests` directory at project root
- Naming convention: `[Feature].test.js` (e.g., `TimezoneHelper.test.js`, `EnhancedPaymentSync.test.js`)

## Test File Organization

**Location:**
- Co-located: Tests in separate `/tests` directory mirroring feature names from `src/`
- Mapping: `src/utils/TimezoneHelper.js` → `tests/TimezoneHelper.test.js`
- Mapping: `src/controller/PortalPaymentController.js` → Test logic in `tests/EnhancedPaymentSync.test.js`

**Naming:**
- Test file: `[FeatureName].test.js`
- Test suite: `describe('Feature description', () => { ... })`
- Test case: `test('should [expected behavior]', () => { ... })`

**Structure:**
```
tests/
├── TimezoneHelper.test.js          # Utility function testing
├── EmailSender.test.js             # Email service testing
├── SQLServerConnection.test.js     # Database connection testing (minimal)
├── TransformTime.test.js           # Time transformation utility
├── EnhancedPaymentSync.test.js     # Integration test with full payment flow
├── GetProviderByExternalId.test.js # Provider lookup testing
├── GetPaymentCFDI.test.js          # Payment CFDI processing
├── ResolveUuidByFolio.test.js      # UUID resolution service
└── [others]                        # Feature-specific tests
```

## Test Structure

**Suite Organization:**
```javascript
describe('TimezoneHelper utility', () => {
    beforeAll(() => {
        // Setup before all tests
        process.env.TIMEZONE = 'America/Mexico_City';
    });

    afterAll(() => {
        // Cleanup after all tests
        delete process.env.TIMEZONE;
    });

    describe('TIMEZONE constant', () => {
        test('should return the configured timezone', () => {
            expect(TIMEZONE).toBe('America/Mexico_City');
        });
    });

    describe('getCurrentDate', () => {
        test('should return a Date object', () => {
            const result = getCurrentDate();
            expect(result).toBeInstanceOf(Date);
        });

        test('should handle invalid timezone gracefully', () => {
            // Test with modified environment
            const result = getCurrentDate();
            expect(result).toBeInstanceOf(Date);
        });
    });
});
```

**Patterns:**
- Setup: `beforeAll()` for environment configuration and module loading
- Teardown: `afterAll()` for cleanup of environment variables and require cache
- Grouped tests: `describe()` blocks organize related test cases
- Each feature has dedicated `describe()` block

## Mocking

**Framework:** Jest's built-in mocking via `require.cache` manipulation

**Patterns:**
```javascript
// Module cache clearing pattern for environment-dependent modules
delete require.cache[require.resolve('../src/utils/TimezoneHelper')];
const { TIMEZONE: fallbackTimezone } = require('../src/utils/TimezoneHelper');

// Environment variable mocking
beforeAll(() => {
    process.env.TIMEZONE = 'America/Mexico_City';
});

afterAll(() => {
    delete process.env.TIMEZONE;
});
```

**Dotenv Credential Loading:**
```javascript
// Load credentials from specific environment file
const credentials = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;

// Extract and split comma-delimited values
const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
```

**What to Mock:**
- Environment variables (via `process.env`)
- Module-level require cache (for timezone-dependent modules)
- External API calls (via axios in integration tests)

**What NOT to Mock:**
- Local utility functions (test real implementation)
- Database queries in isolated unit tests (use test data)
- Date/time functions (allow real execution, check format/validity)

## Fixtures and Factories

**Test Data:**
- Payment data objects constructed inline within test:
```javascript
const data = {
    h1: 'Prueba de envío',
    p: 'Este es un correo de prueba desde Jest.',
    status: 200,
    message: 'OK',
    position: 0,
    idCia: 'TESTCOMP'
};
```

- Query results mocked as recordset objects:
```javascript
const mockResult = {
    recordset: [
        { CNTBTCH: 123, external_id: 'PY0060684', /* ... */ }
    ],
    rowsAffected: [1]
};
```

**Location:**
- Test data defined within test files, no separate fixtures directory
- Large integration tests may construct complex object hierarchies inline
- Environment credentials loaded from `.env.credentials.focaltec` file

**Test Payload Construction:**
From `EnhancedPaymentSync.test.js`:
```javascript
const payload = {
    bank_account_id: sagePayment.bank_account_id,
    cfdis: cfdisArray,
    comments: sagePayment.comments,
    currency: sagePayment.bk_currency,
    external_id: sagePayment.external_id,
    // ... additional fields
};
```

## Coverage

**Requirements:** None enforced (no coverage thresholds configured)

**View Coverage:**
```bash
npm test -- --coverage  # If Jest coverage reporter is configured
# Currently: No coverage reporter configured in jest.config.js
```

**Current State:**
- No coverage configuration in `jest.config.js`
- Tests exist for critical utilities (TimezoneHelper, EmailSender, TransformTime)
- Integration tests present but many are placeholder/minimal (e.g., `SQLServerConnection.test.js`)

## Test Types

**Unit Tests:**
- Scope: Individual utility functions and their edge cases
- Approach: Test with multiple input variations, validate format/structure of output
- Examples: `TimezoneHelper.test.js`, `TransformTime.test.js`
- Isolation: Pure functions tested in isolation with mock environment variables

**Integration Tests:**
- Scope: Full workflows across multiple services
- Approach: Load credentials, test database queries, API calls, and control table updates
- Examples: `EnhancedPaymentSync.test.js` (comprehensive payment workflow test)
- Requires: `.env.credentials.focaltec`, `.env.credentials.mailing` files present

**E2E Tests:**
- Framework: Not used
- Manual testing approach appears to be primary for full-flow validation

## Common Patterns

**Async Testing:**
```javascript
test('should send email successfully with valid data', async () => {
    const result = await sendMail(data);
    expect(Array.isArray(result.accepted)).toBe(true);
    expect(result.accepted.length).toBeGreaterThan(0);
});
```
- Async functions use `async` keyword in test function
- `await` used for promise resolution
- Assertions validate resolved result

**Error Testing:**
```javascript
test('throws an error when input is 0', () => {
    expect(() => minutesToMilliseconds(0)).toThrow("Input cannot be 0");
});

test('throws an error when input is negative', () => {
    expect(() => minutesToMilliseconds(-1)).toThrow("Input cannot be negative");
});
```
- Synchronous error testing via `expect(() => func()).toThrow("message")`
- Error message validated in matcher

**Format Validation:**
```javascript
test('should return date in YYYY-MM-DD format', () => {
    const result = getCurrentDateString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('should return a string of length 10', () => {
    const result = getCurrentDateString();
    expect(result).toHaveLength(10);
});
```
- Regex pattern matching for format validation
- Length assertions for fixed-format strings
- Component validation by parsing and range checking

**Timezone Handling in Tests:**
```javascript
describe('timezone behavior', () => {
    test('should work with different timezones', () => {
        const timezones = [
            { name: 'America/New_York', expectedFormat: /^\d{4}-\d{2}-\d{2}$/ },
            { name: 'Europe/London', expectedFormat: /^\d{4}-\d{2}-\d{2}$/ },
            { name: 'Asia/Tokyo', expectedFormat: /^\d{4}-\d{2}-\d{2}$/ }
        ];

        timezones.forEach(({ name: timezone, expectedFormat }) => {
            const modulePath = require.resolve('../src/utils/TimezoneHelper');
            delete require.cache[modulePath];

            const originalTimezone = process.env.TIMEZONE;
            process.env.TIMEZONE = timezone;

            try {
                const TimezoneHelper = require('../src/utils/TimezoneHelper');
                const result = TimezoneHelper.getCurrentDateString();
                expect(result).toMatch(expectedFormat);
            } finally {
                process.env.TIMEZONE = originalTimezone;
                delete require.cache[modulePath];
            }
        });
    });
});
```
- Module cache clearing before re-requiring
- Environment variable modification and restoration
- Try-finally ensures cleanup even on test failure

**Date Consistency Testing:**
```javascript
test('all functions should use the same base date', () => {
    const currentString = getCurrentDateString();
    const currentCompact = getCurrentDateCompact();
    const currentISO = getCurrentISOString();

    const isoDatePart = currentISO.split('T')[0];

    expect(currentString).toBe(isoDatePart);
    expect(currentCompact).toBe(currentString.replace(/-/g, ''));
});
```
- Multiple format variations tested for consistency
- Parsing and comparison across formats

## Test Execution Notes

**Dependencies:**
- Tests require actual credentials files: `.env.credentials.focaltec`, `.env.credentials.mailing`
- Database connection tests attempt actual SQL Server connections
- Email tests attempt actual SMTP connections
- These should be mocked or skipped in CI/CD pipelines

**Babel Transformation:**
- Jest configured to use Babel for `.js` files transformation
- `babel.config.js` specifies Node.js current version target
- Allows use of modern JavaScript features in tests

**Module Loading Order:**
- Credentials loaded at module level (executed during require)
- Tests should execute credentials-loading code in proper order
- `require.cache` manipulation used to force re-execution of initialization code

---

*Testing analysis: 2026-03-12*
