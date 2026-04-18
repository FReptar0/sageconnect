/**
 * Payment Routes Integration Tests
 *
 * Tests all 7 payment endpoints: happy-path responses, validation errors,
 * API key enforcement, and dry-run defaults.
 *
 * Strategy: Build a dedicated test app that mocks all script functions
 * and config.js to avoid needing real env vars or database connections.
 */

const { describe, test, expect, beforeAll, beforeEach, jest: jestObj } = require('@jest/globals');

// ---------------------------------------------------------------------------
// Mock config.js BEFORE any other requires (prevents process.exit on missing env)
// ---------------------------------------------------------------------------
jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://test-portal',
        tenants: [
            { id: 'T1', key: 'k1', secret: 's1', database: 'DB1', externalId: 'E1' },
        ],
    },
    security: { apiKey: 'test-api-key' },
    database: { user: 'u', password: 'p', server: 's', database: 'd' },
    paths: { logs: '/tmp', downloads: '/tmp', providers: '/tmp' },
    app: {
        timezone: 'America/Mexico_City',
        importRoute: '/test',
        arg: 'ARG',
        company: 'Test',
        rfc: 'RFC',
        regimen: 'REG',
        defaultAddress: {
            city: 'C', country: 'MX', identifier: 'I',
            municipality: 'M', state: 'S', street: 'ST', zip: '00000',
        },
        addressIdentifiersSkip: [],
    },
    mailing: {},
}));

// ---------------------------------------------------------------------------
// Mock all script modules
// ---------------------------------------------------------------------------
const mockEnvelope = () => ({
    success: true,
    data: { test: true },
    errors: [],
    summary: 'Test OK',
    meta: { duration: 0, timestamp: new Date().toISOString(), tenant: null },
});

jest.mock('../../src/scripts/payment-reconciliation', () => ({
    classifyPayments: jest.fn(),
    uploadBatch: jest.fn(),
    runReconciliation: jest.fn().mockResolvedValue({
        success: true,
        data: { test: true },
        errors: [],
        summary: 'Test OK',
        meta: { duration: 0, timestamp: new Date().toISOString(), tenant: null },
    }),
}));

jest.mock('../../src/scripts/payment-uuid-diagnostic', () => ({
    diagnosePayment: jest.fn().mockResolvedValue({
        success: true,
        data: { test: true },
        errors: [],
        summary: 'Test OK',
        meta: { duration: 0, timestamp: new Date().toISOString(), tenant: null },
    }),
    getAllFailingPayments: jest.fn(),
}));

jest.mock('../../src/scripts/payment-uuid-repair', () => ({
    scanForRepairableUUIDs: jest.fn().mockResolvedValue({
        success: true,
        data: { test: true },
        errors: [],
        summary: 'Test OK',
        meta: { duration: 0, timestamp: new Date().toISOString(), tenant: null },
    }),
    repairUUIDs: jest.fn().mockResolvedValue({
        success: true,
        data: { test: true },
        errors: [],
        summary: 'Test OK',
        meta: { duration: 0, timestamp: new Date().toISOString(), tenant: null },
    }),
    uploadRepairedPayments: jest.fn().mockResolvedValue({
        success: true,
        data: { test: true },
        errors: [],
        summary: 'Test OK',
        meta: { duration: 0, timestamp: new Date().toISOString(), tenant: null },
    }),
}));

jest.mock('../../src/scripts/portal-payments-generator', () => ({
    generatePayments: jest.fn().mockResolvedValue({
        success: true,
        data: { test: true },
        errors: [],
        summary: 'Test OK',
        meta: { duration: 0, timestamp: new Date().toISOString(), tenant: null },
    }),
}));

jest.mock('../../src/scripts/get-payment-cfdis', () => ({
    getTypePTest: jest.fn().mockResolvedValue({
        success: true,
        data: { test: true },
        errors: [],
        summary: 'Test OK',
        meta: { duration: 0, timestamp: new Date().toISOString(), tenant: null },
    }),
}));

// Mock infrastructure modules that scripts or config may pull in
jest.mock('../../src/utils/SQLServerConnection', () => ({
    runQuery: jest.fn().mockResolvedValue({ recordset: [] }),
}));
jest.mock('../../src/utils/LogGenerator', () => ({
    logGenerator: jest.fn(),
}));
jest.mock('../../src/utils/TimezoneHelper', () => ({
    getCurrentDateCompact: jest.fn().mockReturnValue('20260323'),
    getCurrentDateString: jest.fn().mockReturnValue('2026-03-23'),
}));
jest.mock('../../src/utils/GetTypesCFDI', () => ({
    getPendingToPayInvoices: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/utils/GetProviders', () => ({
    getProviderByExternalId: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../src/services/ProviderIdResolver', () => ({
    resolveProviderIdByExternalId: jest.fn().mockResolvedValue(false),
}));
// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------
const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const { errorResult } = require('../../src/utils/ResultEnvelope');

const TEST_API_KEY = 'test-api-key';

function createPaymentTestApp() {
    const app = express();
    app.use(express.json());

    // Replicate requireApiKey with test key
    function testRequireApiKey(req, res, next) {
        const configuredKey = TEST_API_KEY;
        const providedKey = req.headers['x-api-key'];

        if (!providedKey) {
            return res.status(401).json(
                errorResult(['Invalid or missing API key'], 'Unauthorized')
            );
        }

        const configuredBuf = Buffer.from(configuredKey, 'utf8');
        const providedBuf = Buffer.from(String(providedKey), 'utf8');

        if (configuredBuf.length !== providedBuf.length ||
            !crypto.timingSafeEqual(configuredBuf, providedBuf)) {
            return res.status(401).json(
                errorResult(['Invalid or missing API key'], 'Unauthorized')
            );
        }

        next();
    }

    // Mount payment routes behind API key
    const paymentRoutes = require('../../src/routes/payment-routes');
    app.use('/api/payments', testRequireApiKey, paymentRoutes);

    // Error handler
    app.use((err, req, res, _next) => {
        res.status(500).json(errorResult([err.message], 'Internal server error'));
    });

    return app;
}

// ---------------------------------------------------------------------------
// Get mock references for assertion
// ---------------------------------------------------------------------------
const { runReconciliation } = require('../../src/scripts/payment-reconciliation');
const { diagnosePayment } = require('../../src/scripts/payment-uuid-diagnostic');
const { scanForRepairableUUIDs, repairUUIDs, uploadRepairedPayments } = require('../../src/scripts/payment-uuid-repair');
const { generatePayments } = require('../../src/scripts/portal-payments-generator');
const { getTypePTest } = require('../../src/scripts/get-payment-cfdis');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Payment Routes', () => {
    let app;

    beforeAll(() => {
        app = createPaymentTestApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // Reset mock return values
        runReconciliation.mockResolvedValue(mockEnvelope());
        diagnosePayment.mockResolvedValue(mockEnvelope());
        scanForRepairableUUIDs.mockResolvedValue(mockEnvelope());
        repairUUIDs.mockResolvedValue(mockEnvelope());
        uploadRepairedPayments.mockResolvedValue(mockEnvelope());
        generatePayments.mockResolvedValue(mockEnvelope());
        getTypePTest.mockResolvedValue(mockEnvelope());
    });

    // -----------------------------------------------------------------------
    // POST /api/payments/reconciliation
    // -----------------------------------------------------------------------
    describe('POST /api/payments/reconciliation', () => {
        test('returns 200 envelope with valid body', async () => {
            const res = await request(app)
                .post('/api/payments/reconciliation')
                .set('x-api-key', TEST_API_KEY)
                .send({ tenantIndex: 0, dryRun: true });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.test).toBe(true);
            expect(runReconciliation).toHaveBeenCalledWith(
                expect.objectContaining({ tenantIndex: 0, dryRun: true })
            );
        });

        test('returns 400 with invalid tenantIndex', async () => {
            const res = await request(app)
                .post('/api/payments/reconciliation')
                .set('x-api-key', TEST_API_KEY)
                .send({ tenantIndex: 999 });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.errors.length).toBeGreaterThan(0);
        });

        test('returns 401 without API key', async () => {
            const res = await request(app)
                .post('/api/payments/reconciliation')
                .send({ tenantIndex: 0 });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.errors).toContain('Invalid or missing API key');
        });
    });

    // -----------------------------------------------------------------------
    // GET /api/payments/uuid-diagnostic
    // -----------------------------------------------------------------------
    describe('GET /api/payments/uuid-diagnostic', () => {
        test('returns 200 envelope with valid docNbr', async () => {
            const res = await request(app)
                .get('/api/payments/uuid-diagnostic?docNbr=PY0001')
                .set('x-api-key', TEST_API_KEY);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(diagnosePayment).toHaveBeenCalledWith(
                expect.objectContaining({ docNbr: 'PY0001', tenantIndex: 0 })
            );
        });

        test('returns 400 without required docNbr', async () => {
            const res = await request(app)
                .get('/api/payments/uuid-diagnostic')
                .set('x-api-key', TEST_API_KEY);

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.errors.length).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/payments/uuid-repair/scan
    // -----------------------------------------------------------------------
    describe('POST /api/payments/uuid-repair/scan', () => {
        test('returns 200 envelope with valid body', async () => {
            const res = await request(app)
                .post('/api/payments/uuid-repair/scan')
                .set('x-api-key', TEST_API_KEY)
                .send({ tenantIndex: 0 });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(scanForRepairableUUIDs).toHaveBeenCalledWith(
                expect.objectContaining({ tenantIndex: 0 })
            );
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/payments/uuid-repair/repair
    // -----------------------------------------------------------------------
    describe('POST /api/payments/uuid-repair/repair', () => {
        test('defaults dryRun to true when not provided', async () => {
            const res = await request(app)
                .post('/api/payments/uuid-repair/repair')
                .set('x-api-key', TEST_API_KEY)
                .send({ tenantIndex: 0 });

            expect(res.status).toBe(200);
            expect(repairUUIDs).toHaveBeenCalledWith(
                expect.objectContaining({ tenantIndex: 0, dryRun: true })
            );
        });

        test('returns 200 envelope', async () => {
            const res = await request(app)
                .post('/api/payments/uuid-repair/repair')
                .set('x-api-key', TEST_API_KEY)
                .send({ tenantIndex: 0, dryRun: false });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(repairUUIDs).toHaveBeenCalledWith(
                expect.objectContaining({ dryRun: false })
            );
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/payments/uuid-repair/upload
    // -----------------------------------------------------------------------
    describe('POST /api/payments/uuid-repair/upload', () => {
        test('returns 200 envelope with valid body', async () => {
            const res = await request(app)
                .post('/api/payments/uuid-repair/upload')
                .set('x-api-key', TEST_API_KEY)
                .send({ tenantIndex: 0 });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(uploadRepairedPayments).toHaveBeenCalledWith(
                expect.objectContaining({ tenantIndex: 0 })
            );
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/payments/generate
    // -----------------------------------------------------------------------
    describe('POST /api/payments/generate', () => {
        test('defaults dryRun to true (shouldPost=false) when not provided', async () => {
            const res = await request(app)
                .post('/api/payments/generate')
                .set('x-api-key', TEST_API_KEY)
                .send({ tenantIndex: 0 });

            expect(res.status).toBe(200);
            expect(generatePayments).toHaveBeenCalledWith(
                expect.objectContaining({ shouldPost: false })
            );
        });

        test('passes shouldPost=true when dryRun=false', async () => {
            const res = await request(app)
                .post('/api/payments/generate')
                .set('x-api-key', TEST_API_KEY)
                .send({ tenantIndex: 0, dryRun: false });

            expect(res.status).toBe(200);
            expect(generatePayments).toHaveBeenCalledWith(
                expect.objectContaining({ shouldPost: true })
            );
        });
    });

    // -----------------------------------------------------------------------
    // GET /api/payments/cfdis
    // -----------------------------------------------------------------------
    describe('GET /api/payments/cfdis', () => {
        test('returns 200 envelope with valid tenantIndex', async () => {
            const res = await request(app)
                .get('/api/payments/cfdis?tenantIndex=0')
                .set('x-api-key', TEST_API_KEY);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(getTypePTest).toHaveBeenCalledWith(0);
        });

        test('defaults tenantIndex to 0 when not provided', async () => {
            const res = await request(app)
                .get('/api/payments/cfdis')
                .set('x-api-key', TEST_API_KEY);

            expect(res.status).toBe(200);
            expect(getTypePTest).toHaveBeenCalledWith(0);
        });
    });

    // -----------------------------------------------------------------------
    // Cross-cutting: validation errors on all POST endpoints
    // -----------------------------------------------------------------------
    describe('Validation: all POST endpoints reject invalid tenantIndex', () => {
        const postEndpoints = [
            '/api/payments/reconciliation',
            '/api/payments/uuid-repair/scan',
            '/api/payments/uuid-repair/repair',
            '/api/payments/uuid-repair/upload',
            '/api/payments/generate',
        ];

        test.each(postEndpoints)('%s returns 400 for tenantIndex=-1', async (endpoint) => {
            const res = await request(app)
                .post(endpoint)
                .set('x-api-key', TEST_API_KEY)
                .send({ tenantIndex: -1 });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.errors.length).toBeGreaterThan(0);
        });
    });
});
