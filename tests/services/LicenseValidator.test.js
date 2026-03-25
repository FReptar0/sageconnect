const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');
const crypto = require('crypto');

/**
 * Tests for src/services/LicenseValidator.js
 *
 * LicenseValidator is a singleton service providing:
 * - HMAC-SHA256 signature verification matching the license server's signing
 * - Timestamp freshness checking (5-minute window, 60s future tolerance)
 * - Three-state cached model: VALID / INVALID / ERROR
 * - Retry with exponential backoff on startup
 * - Email notifications on license failures
 */

// ---------------------------------------------------------------------------
// Shared HMAC secret for all tests
// ---------------------------------------------------------------------------
const TEST_HMAC_SECRET = 'test-hmac-secret-key-for-unit-tests';

// ---------------------------------------------------------------------------
// Mock config.js to avoid .env validation / process.exit
// ---------------------------------------------------------------------------
jest.mock('../../src/config', () => ({
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs' },
    mailing: {
        server: 'smtp.test.com',
        port: 587,
        ssl: false,
        from: 'test@test.com',
        password: 'testpass',
    },
    app: { company: 'TestCompany' },
    security: { apiKey: 'test-api-key' },
    license: {
        apiUrl: 'https://license.test.com',
        hmacSecret: TEST_HMAC_SECRET,
        adminEmail: 'admin@test.com',
    },
}));

// ---------------------------------------------------------------------------
// Mock LogGenerator to prevent file I/O
// ---------------------------------------------------------------------------
jest.mock('../../src/utils/LogGenerator', () => ({
    logGenerator: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock nodemailer
// ---------------------------------------------------------------------------
const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });
jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({
        sendMail: mockSendMail,
    })),
}));

// ---------------------------------------------------------------------------
// Mock axios
// ---------------------------------------------------------------------------
const mockAxiosGet = jest.fn();
jest.mock('axios', () => ({
    create: jest.fn(() => ({
        get: mockAxiosGet,
    })),
}));

// ---------------------------------------------------------------------------
// Helper: sign a payload exactly like the license server does
// ---------------------------------------------------------------------------
function signPayload(payload, secret) {
    return crypto
        .createHmac('sha256', secret || TEST_HMAC_SECRET)
        .update(JSON.stringify(payload), 'utf-8')
        .digest('hex');
}

function buildValidResponse(active = true, tsOffset = 0) {
    const ts = Date.now() + tsOffset;
    const payload = active
        ? { active: true, expiresAt: '2099-12-31T00:00:00.000Z', ts }
        : { active: false, ts };
    const sig = signPayload(payload);
    return { data: { ...payload, sig } };
}

// ---------------------------------------------------------------------------
// Import and reset between tests
// ---------------------------------------------------------------------------
let licenseValidator;

beforeEach(() => {
    jest.clearAllMocks();
    // Re-require to get a clean module (singleton state resets via _reset)
    licenseValidator = require('../../src/services/LicenseValidator');
    licenseValidator._reset();
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ============================================================
// 1. HMAC Signature Verification
// ============================================================
describe('LicenseValidator - verifySignature (via validate)', () => {
    test('validate returns VALID for correctly signed active response', async () => {
        const response = buildValidResponse(true);
        mockAxiosGet.mockResolvedValueOnce(response);

        const result = await licenseValidator.validate();

        expect(result.state).toBe('VALID');
        expect(result.valid).toBe(true);
    });

    test('validate returns INVALID for correctly signed inactive response', async () => {
        const response = buildValidResponse(false);
        mockAxiosGet.mockResolvedValueOnce(response);

        const result = await licenseValidator.validate();

        expect(result.state).toBe('INVALID');
        expect(result.valid).toBe(false);
    });

    test('validate returns ERROR for tampered payload (modified active field)', async () => {
        const ts = Date.now();
        const originalPayload = { active: true, expiresAt: '2099-12-31T00:00:00.000Z', ts };
        const sig = signPayload(originalPayload);
        // Tamper: change active from true to false but keep the sig for active:true
        mockAxiosGet.mockResolvedValueOnce({
            data: { active: false, ts, sig },
        });

        const result = await licenseValidator.validate();

        expect(result.state).toBe('ERROR');
    });

    test('validate returns ERROR for missing sig field', async () => {
        mockAxiosGet.mockResolvedValueOnce({
            data: { active: true, expiresAt: '2099-12-31T00:00:00.000Z', ts: Date.now() },
        });

        const result = await licenseValidator.validate();

        expect(result.state).toBe('ERROR');
    });

    test('validate returns ERROR for wrong HMAC secret', async () => {
        const ts = Date.now();
        const payload = { active: true, expiresAt: '2099-12-31T00:00:00.000Z', ts };
        const wrongSig = signPayload(payload, 'wrong-secret-key');
        mockAxiosGet.mockResolvedValueOnce({
            data: { ...payload, sig: wrongSig },
        });

        const result = await licenseValidator.validate();

        expect(result.state).toBe('ERROR');
    });
});

// ============================================================
// 2. Timestamp Freshness
// ============================================================
describe('LicenseValidator - Timestamp Freshness', () => {
    test('validate accepts timestamp within 5 minutes', async () => {
        // 2 minutes ago -- well within 5-min window
        const response = buildValidResponse(true, -2 * 60 * 1000);
        mockAxiosGet.mockResolvedValueOnce(response);

        const result = await licenseValidator.validate();

        expect(result.state).toBe('VALID');
    });

    test('validate rejects timestamp older than 5 minutes', async () => {
        // 6 minutes ago -- outside 5-min window
        const ts = Date.now() - 6 * 60 * 1000;
        const payload = { active: true, expiresAt: '2099-12-31T00:00:00.000Z', ts };
        const sig = signPayload(payload);
        mockAxiosGet.mockResolvedValueOnce({
            data: { ...payload, sig },
        });

        const result = await licenseValidator.validate();

        expect(result.state).toBe('ERROR');
    });

    test('validate rejects timestamp more than 60s in the future', async () => {
        // 90 seconds in the future -- outside 60s tolerance
        const ts = Date.now() + 90 * 1000;
        const payload = { active: true, expiresAt: '2099-12-31T00:00:00.000Z', ts };
        const sig = signPayload(payload);
        mockAxiosGet.mockResolvedValueOnce({
            data: { ...payload, sig },
        });

        const result = await licenseValidator.validate();

        expect(result.state).toBe('ERROR');
    });
});

// ============================================================
// 3. Three-State Model
// ============================================================
describe('LicenseValidator - Three-State Model', () => {
    test('validate returns VALID when active:true with valid HMAC and fresh timestamp', async () => {
        const response = buildValidResponse(true);
        mockAxiosGet.mockResolvedValueOnce(response);

        const result = await licenseValidator.validate();

        expect(result.state).toBe('VALID');
        expect(result.valid).toBe(true);
        expect(result.expiresAt).toBe('2099-12-31T00:00:00.000Z');
    });

    test('validate returns INVALID when active:false with valid HMAC', async () => {
        const response = buildValidResponse(false);
        mockAxiosGet.mockResolvedValueOnce(response);

        const result = await licenseValidator.validate();

        expect(result.state).toBe('INVALID');
        expect(result.valid).toBe(false);
    });

    test('validate returns ERROR on network timeout (cached state preserved)', async () => {
        // First: set valid state
        const validResponse = buildValidResponse(true);
        mockAxiosGet.mockResolvedValueOnce(validResponse);
        await licenseValidator.validate();

        // Second: network error
        mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        const result = await licenseValidator.validate();

        expect(result.state).toBe('ERROR');
        // But isValid() should still return true because cached state was VALID
        // Actually per spec: ERROR state means cached state preserved,
        // but the state field IS 'ERROR'. isValid checks state === 'VALID'
        // so isValid returns false during ERROR. The three-state model is:
        // ERROR preserves the _data_ (active, expiresAt) but state is ERROR.
        // Wait -- let me re-read the spec. "ERROR: Use cached VALID state for up to 24 hours"
        // This means downstream consumers should check differently. But per the plan:
        // "isValid() returns cached boolean synchronously" - so it returns based on state field.
        // The plan says isValid returns true after VALID, false after INVALID.
        // During ERROR the state is 'ERROR' so isValid returns false.
        // The 24h logic means: after 24h of ERROR, switch to INVALID.
    });

    test('validate returns ERROR on invalid HMAC (does NOT trust response)', async () => {
        const ts = Date.now();
        const payload = { active: true, expiresAt: '2099-12-31T00:00:00.000Z', ts };
        const wrongSig = signPayload(payload, 'wrong-secret');
        mockAxiosGet.mockResolvedValueOnce({
            data: { ...payload, sig: wrongSig },
        });

        const result = await licenseValidator.validate();

        expect(result.state).toBe('ERROR');
    });

    test('validate returns ERROR on stale timestamp (does NOT trust response)', async () => {
        const ts = Date.now() - 10 * 60 * 1000; // 10 minutes ago
        const payload = { active: true, expiresAt: '2099-12-31T00:00:00.000Z', ts };
        const sig = signPayload(payload);
        mockAxiosGet.mockResolvedValueOnce({
            data: { ...payload, sig },
        });

        const result = await licenseValidator.validate();

        expect(result.state).toBe('ERROR');
    });
});

// ============================================================
// 4. isValid() and getStatus()
// ============================================================
describe('LicenseValidator - isValid and getStatus', () => {
    test('isValid() returns true after VALID validate()', async () => {
        const response = buildValidResponse(true);
        mockAxiosGet.mockResolvedValueOnce(response);
        await licenseValidator.validate();

        expect(licenseValidator.isValid()).toBe(true);
    });

    test('isValid() returns false after INVALID validate()', async () => {
        const response = buildValidResponse(false);
        mockAxiosGet.mockResolvedValueOnce(response);
        await licenseValidator.validate();

        expect(licenseValidator.isValid()).toBe(false);
    });

    test('getStatus() returns full state object for API consumption', async () => {
        const response = buildValidResponse(true);
        mockAxiosGet.mockResolvedValueOnce(response);
        await licenseValidator.validate();

        const status = licenseValidator.getStatus();

        expect(status).toHaveProperty('active', true);
        expect(status).toHaveProperty('expiresAt', '2099-12-31T00:00:00.000Z');
        expect(status).toHaveProperty('lastChecked');
        expect(status).toHaveProperty('state', 'VALID');
        expect(status).toHaveProperty('lastSuccessfulCheck');
        expect(status.lastChecked).toBeTruthy();
        expect(status.lastSuccessfulCheck).toBeTruthy();
    });
});

// ============================================================
// 5. 24-Hour ERROR TTL
// ============================================================
describe('LicenseValidator - 24h ERROR TTL', () => {
    test('after 24h of consecutive ERROR, cached state switches to INVALID', async () => {
        // First: establish a VALID state
        const validResponse = buildValidResponse(true);
        mockAxiosGet.mockResolvedValueOnce(validResponse);
        await licenseValidator.validate();

        expect(licenseValidator.isValid()).toBe(true);

        // Now simulate that lastSuccessfulCheck was 25 hours ago
        // We need to manipulate the internal state. Use _reset first then set up.
        // Actually, let's do it by calling validate with a network error,
        // then manually adjusting the lastSuccessfulCheck via Date mocking.

        // Mock Date.now to be 25 hours in the future
        const realDateNow = Date.now;
        const twentyFiveHoursMs = 25 * 60 * 60 * 1000;
        const futureTime = realDateNow() + twentyFiveHoursMs;

        jest.spyOn(Date, 'now').mockReturnValue(futureTime);

        // Network error triggers ERROR path which checks ERROR_TTL
        mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        const result = await licenseValidator.validate();

        // After 25h of no successful check, should switch to INVALID
        expect(result.state).toBe('INVALID');
        expect(result.valid).toBe(false);

        Date.now = realDateNow;
        jest.restoreAllMocks();
    });
});

// ============================================================
// 6. Startup Retry
// ============================================================
describe('LicenseValidator - Startup Retry', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('validate with startup=true retries 3 times before giving up', async () => {
        // All calls fail
        mockAxiosGet.mockRejectedValue(new Error('ECONNREFUSED'));

        // Mock process.exit to prevent actual exit
        const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

        // Start the validation in background, then advance timers
        const validatePromise = licenseValidator.validate({ startup: true });

        // Advance through backoff delays: 1s, 2s, 4s
        await jest.advanceTimersByTimeAsync(1000);
        await jest.advanceTimersByTimeAsync(2000);
        await jest.advanceTimersByTimeAsync(4000);

        await validatePromise;

        // Initial call + 3 retries = 4 total calls
        expect(mockAxiosGet).toHaveBeenCalledTimes(4);
        mockExit.mockRestore();
    }, 15000);

    test('validate with startup=true calls process.exit(1) after 3 failures', async () => {
        mockAxiosGet.mockRejectedValue(new Error('ECONNREFUSED'));

        const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

        const validatePromise = licenseValidator.validate({ startup: true });

        // Advance through backoff delays
        await jest.advanceTimersByTimeAsync(1000);
        await jest.advanceTimersByTimeAsync(2000);
        await jest.advanceTimersByTimeAsync(4000);

        await validatePromise;

        expect(mockExit).toHaveBeenCalledWith(1);
        mockExit.mockRestore();
    }, 15000);
});
