/**
 * License Enforcement Integration Tests
 *
 * Tests require-license middleware, GET /api/system/license endpoint,
 * and route protection matrix using supertest against minimal Express apps.
 *
 * Strategy: Build dedicated test apps per suite to avoid config.js
 * process.exit() validation. LicenseValidator is mocked with a controllable flag.
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const express = require('express');
const request = require('supertest');

// ---------------------------------------------------------------------------
// Mock LicenseValidator with controllable flag (must be prefixed with "mock")
// ---------------------------------------------------------------------------
let mockIsValid = true;

jest.mock('../../src/services/LicenseValidator', () => ({
    isValid: () => mockIsValid,
    getStatus: () => ({
        active: mockIsValid,
        expiresAt: mockIsValid ? '2099-12-31T00:00:00.000Z' : null,
        lastChecked: '2026-03-25T00:00:00.000Z',
        state: mockIsValid ? 'VALID' : 'INVALID',
        lastSuccessfulCheck: '2026-03-25T00:00:00.000Z',
    }),
    _reset: jest.fn(),
}));

// Mock config to avoid process.exit()
jest.mock('../../src/config', () => ({
    license: { hmacSecret: 'test-hmac-secret-key' },
    security: { apiKey: 'test-api-key-12345' },
    portal: { tenants: [] },
}));

// ---------------------------------------------------------------------------
// Shared test app builder
// ---------------------------------------------------------------------------
function createTestApp() {
    const app = express();
    app.use(express.json());
    return app;
}

// ---------------------------------------------------------------------------
// 1. require-license middleware -- unit tests
// ---------------------------------------------------------------------------
describe('require-license middleware', () => {
    const { requireLicense } = require('../../src/middleware/require-license');

    beforeEach(() => {
        mockIsValid = true;
    });

    test('calls next() when LicenseValidator.isValid() returns true', async () => {
        mockIsValid = true;
        const app = createTestApp();
        app.get('/test', requireLicense, (req, res) => {
            res.json({ success: true, data: { reached: true } });
        });

        const res = await request(app).get('/test');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.reached).toBe(true);
    });

    test('returns 503 with license error when isValid() returns false', async () => {
        mockIsValid = false;
        const app = createTestApp();
        app.get('/test', requireLicense, (req, res) => {
            res.json({ success: true });
        });

        const res = await request(app).get('/test');
        expect(res.status).toBe(503);
        expect(res.body.success).toBe(false);
        expect(res.body.errors).toContain('Licencia inactiva. Contacte a su proveedor.');
        expect(res.body.summary).toBe('License required');
    });
});

// ---------------------------------------------------------------------------
// 2. GET /api/system/license -- endpoint tests
// ---------------------------------------------------------------------------
describe('GET /api/system/license', () => {
    beforeEach(() => {
        mockIsValid = true;
    });

    test('returns 200 with license status fields', async () => {
        mockIsValid = true;
        const app = createTestApp();
        const systemRoutes = require('../../src/routes/system-routes');
        app.use('/api/system', systemRoutes);

        const res = await request(app).get('/api/system/license');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty('active');
        expect(res.body.data).toHaveProperty('expiresAt');
        expect(res.body.data).toHaveProperty('lastChecked');
        expect(res.body.data).toHaveProperty('state');
        expect(res.body.data).toHaveProperty('lastSuccessfulCheck');
        expect(res.body.data).toHaveProperty('hmacConfigured');
    });

    test('is accessible without API key and without license middleware (always public)', async () => {
        mockIsValid = false; // License invalid -- endpoint should still be accessible
        const app = createTestApp();
        const systemRoutes = require('../../src/routes/system-routes');
        app.use('/api/system', systemRoutes);

        const res = await request(app).get('/api/system/license');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.state).toBe('INVALID');
    });

    test('hmacConfigured reflects HMAC_SECRET presence', async () => {
        const app = createTestApp();
        const systemRoutes = require('../../src/routes/system-routes');
        app.use('/api/system', systemRoutes);

        const res = await request(app).get('/api/system/license');
        expect(res.body.data.hmacConfigured).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 3. Route protection matrix -- integration tests
// ---------------------------------------------------------------------------
describe('Route protection matrix', () => {
    const { requireLicense } = require('../../src/middleware/require-license');
    const { errorResult } = require('../../src/utils/ResultEnvelope');
    const crypto = require('crypto');

    const TEST_API_KEY = 'test-api-key-12345';

    function testRequireApiKey(req, res, next) {
        const providedKey = req.headers['x-api-key'];
        if (!providedKey) {
            return res.status(401).json(
                errorResult(['Invalid or missing API key'], 'Unauthorized')
            );
        }
        const configuredBuf = Buffer.from(TEST_API_KEY, 'utf8');
        const providedBuf = Buffer.from(String(providedKey), 'utf8');
        if (configuredBuf.length !== providedBuf.length ||
            !crypto.timingSafeEqual(configuredBuf, providedBuf)) {
            return res.status(401).json(
                errorResult(['Invalid or missing API key'], 'Unauthorized')
            );
        }
        next();
    }

    function buildProtectionApp() {
        const app = createTestApp();

        // Dashboard -- no license, no API key
        app.get('/dashboard', (req, res) => {
            res.json({ success: true, data: { dashboard: true } });
        });

        // System routes -- no license, no API key
        app.get('/api/system/health', (req, res) => {
            res.json({ success: true, data: { status: 'ok' } });
        });
        app.get('/api/system/tenants', (req, res) => {
            res.json({ success: true, data: { tenants: [] } });
        });
        app.get('/api/system/license', (req, res) => {
            res.json({ success: true, data: { state: 'always-accessible' } });
        });

        // Licensed routes (no API key)
        app.get('/api/schedule/status', requireLicense, (req, res) => {
            res.json({ success: true, data: { schedule: true } });
        });
        app.get('/api/operations', requireLicense, (req, res) => {
            res.json({ success: true, data: { operations: true } });
        });

        // Licensed + API key routes
        app.get('/api/payments/reconciliation', requireLicense, testRequireApiKey, (req, res) => {
            res.json({ success: true, data: { payments: true } });
        });
        app.get('/api/pos/status', requireLicense, testRequireApiKey, (req, res) => {
            res.json({ success: true, data: { pos: true } });
        });

        return app;
    }

    beforeEach(() => {
        mockIsValid = true;
    });

    test('protected routes return 503 when license is invalid', async () => {
        mockIsValid = false;
        const app = buildProtectionApp();

        const schedule = await request(app).get('/api/schedule/status');
        expect(schedule.status).toBe(503);
        expect(schedule.body.errors).toContain('Licencia inactiva. Contacte a su proveedor.');

        const operations = await request(app).get('/api/operations');
        expect(operations.status).toBe(503);

        const payments = await request(app)
            .get('/api/payments/reconciliation')
            .set('x-api-key', TEST_API_KEY);
        expect(payments.status).toBe(503);

        const pos = await request(app)
            .get('/api/pos/status')
            .set('x-api-key', TEST_API_KEY);
        expect(pos.status).toBe(503);
    });

    test('unprotected routes remain accessible when license is invalid', async () => {
        mockIsValid = false;
        const app = buildProtectionApp();

        const health = await request(app).get('/api/system/health');
        expect(health.status).toBe(200);

        const tenants = await request(app).get('/api/system/tenants');
        expect(tenants.status).toBe(200);

        const license = await request(app).get('/api/system/license');
        expect(license.status).toBe(200);

        const dashboard = await request(app).get('/dashboard');
        expect(dashboard.status).toBe(200);
    });

    test('requireLicense runs BEFORE requireApiKey (invalid license returns 503, not 401)', async () => {
        mockIsValid = false;
        const app = buildProtectionApp();

        // Send request to payments WITHOUT API key -- should get 503 (license), not 401 (API key)
        const res = await request(app).get('/api/payments/reconciliation');
        expect(res.status).toBe(503);
        expect(res.body.errors).toContain('Licencia inactiva. Contacte a su proveedor.');
        // Verify it's NOT a 401 -- license check came first
        expect(res.status).not.toBe(401);
    });

    test('protected routes pass through when license is valid', async () => {
        mockIsValid = true;
        const app = buildProtectionApp();

        const schedule = await request(app).get('/api/schedule/status');
        expect(schedule.status).toBe(200);
        expect(schedule.body.data.schedule).toBe(true);

        const payments = await request(app)
            .get('/api/payments/reconciliation')
            .set('x-api-key', TEST_API_KEY);
        expect(payments.status).toBe(200);
        expect(payments.body.data.payments).toBe(true);
    });
});
