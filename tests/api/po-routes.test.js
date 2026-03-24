/**
 * PO Routes Integration Tests
 *
 * Tests all 8 PO endpoints: happy path, validation errors, API key enforcement,
 * dry-run defaults, poNumbers normalization, and lifecycle mode dispatch.
 *
 * Strategy: Build a dedicated test app that mirrors the production Express stack
 * but mocks all PO script functions and config.js to avoid env var requirements.
 */

const { describe, test, expect, beforeAll, beforeEach } = require('@jest/globals');

// ---------------------------------------------------------------------------
// Mock express-rate-limit to avoid write limiter blocking tests
// ---------------------------------------------------------------------------
jest.mock('express-rate-limit', () => ({
    rateLimit: () => (req, res, next) => next(),
}));

// ---------------------------------------------------------------------------
// Mock config.js BEFORE any other imports that transitively require it
// ---------------------------------------------------------------------------
jest.mock('../../src/config', () => ({
    database: { user: 'test', password: 'test', server: 'test', database: 'FESA' },
    portal: {
        url: 'http://test',
        tenants: [
            { id: 'T1', key: 'K1', secret: 'S1', database: 'DB1', externalId: 'E1' },
            { id: 'T2', key: 'K2', secret: 'S2', database: 'DB2', externalId: 'E2' },
        ],
    },
    mailing: {},
    paths: { downloads: '/tmp', providers: '/tmp', logs: '/tmp' },
    app: { timezone: 'UTC' },
    security: { apiKey: 'test-api-key' },
}));

// ---------------------------------------------------------------------------
// Mock all PO script modules
// ---------------------------------------------------------------------------
const mockEnvelope = {
    success: true,
    data: { test: true },
    errors: [],
    summary: 'Test',
    meta: { duration: 0, timestamp: '2026-01-01T00:00:00.000Z', tenant: null },
};

jest.mock('../../src/scripts/po-diagnostic', () => ({
    diagnosticPO: jest.fn().mockResolvedValue(mockEnvelope),
    getAuthorizedPOsToday: jest.fn().mockResolvedValue(mockEnvelope),
}));

jest.mock('../../src/scripts/po-query', () => ({
    testSpecificPurchaseOrders: jest.fn().mockResolvedValue(mockEnvelope),
    runPOQuery: jest.fn(),
}));

jest.mock('../../src/scripts/po-upload', () => ({
    uploadSpecificPurchaseOrders: jest.fn().mockResolvedValue(mockEnvelope),
    runPOUpload: jest.fn(),
}));

jest.mock('../../src/scripts/po-update', () => ({
    testPurchaseOrderUpdate: jest.fn().mockResolvedValue(mockEnvelope),
    searchPOInFESA: jest.fn(),
    retrieveFromSage: jest.fn(),
}));

jest.mock('../../src/scripts/po-address-diagnostic', () => ({
    diagnosticPOAddress: jest.fn().mockResolvedValue(mockEnvelope),
    runAddressTests: jest.fn(),
}));

jest.mock('../../src/scripts/po-payment-form-diagnostic', () => ({
    diagnosticPaymentForm: jest.fn().mockResolvedValue(mockEnvelope),
}));

jest.mock('../../src/scripts/upload-authorized-pos', () => ({
    uploadAuthorizedPOs: jest.fn().mockResolvedValue(mockEnvelope),
}));

jest.mock('../../src/scripts/test-order-lifecycle', () => ({
    analyzeOrders: jest.fn().mockResolvedValue(mockEnvelope),
    processOrders: jest.fn().mockResolvedValue(mockEnvelope),
    testTenant: jest.fn().mockResolvedValue(mockEnvelope),
}));

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------
const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const { errorResult } = require('../../src/utils/ResultEnvelope');

const TEST_API_KEY = 'test-api-key';

function createTestApp() {
    const app = express();
    app.use(express.json());

    // Replicate requireApiKey behavior with the test key
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

    // Mount PO routes behind API key (same as production routes.js)
    const poRoutes = require('../../src/routes/po-routes');
    app.use('/api/pos', testRequireApiKey, poRoutes);

    // Error handler
    app.use((err, req, res, _next) => {
        res.status(500).json(errorResult([err.message], 'Internal server error'));
    });

    return app;
}

// ---------------------------------------------------------------------------
// Import mocked script functions for assertion access
// ---------------------------------------------------------------------------
const { diagnosticPO } = require('../../src/scripts/po-diagnostic');
const { testSpecificPurchaseOrders } = require('../../src/scripts/po-query');
const { uploadSpecificPurchaseOrders } = require('../../src/scripts/po-upload');
const { testPurchaseOrderUpdate } = require('../../src/scripts/po-update');
const { diagnosticPOAddress } = require('../../src/scripts/po-address-diagnostic');
const { diagnosticPaymentForm } = require('../../src/scripts/po-payment-form-diagnostic');
const { uploadAuthorizedPOs } = require('../../src/scripts/upload-authorized-pos');
const { analyzeOrders, processOrders, testTenant } = require('../../src/scripts/test-order-lifecycle');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let app;

beforeAll(() => {
    app = createTestApp();
});

beforeEach(() => {
    jest.clearAllMocks();
    // Restore default mock return values after clearAllMocks
    diagnosticPO.mockResolvedValue(mockEnvelope);
    testSpecificPurchaseOrders.mockResolvedValue(mockEnvelope);
    uploadSpecificPurchaseOrders.mockResolvedValue(mockEnvelope);
    testPurchaseOrderUpdate.mockResolvedValue(mockEnvelope);
    diagnosticPOAddress.mockResolvedValue(mockEnvelope);
    diagnosticPaymentForm.mockResolvedValue(mockEnvelope);
    uploadAuthorizedPOs.mockResolvedValue(mockEnvelope);
    analyzeOrders.mockResolvedValue(mockEnvelope);
    processOrders.mockResolvedValue(mockEnvelope);
    testTenant.mockResolvedValue(mockEnvelope);
});

// ---------------------------------------------------------------------------
// 1. Happy path -- all 8 endpoints with valid params return 200 + envelope
// ---------------------------------------------------------------------------
describe('PO Routes - Happy Path', () => {
    test('GET /api/pos/diagnostic returns 200 envelope', async () => {
        const res = await request(app)
            .get('/api/pos/diagnostic?poNumber=OC001')
            .set('x-api-key', TEST_API_KEY);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({ test: true });
        expect(diagnosticPO).toHaveBeenCalledWith('OC001', 'COPDAT', 'COPDAT');
    });

    test('GET /api/pos/query returns 200 envelope', async () => {
        const res = await request(app)
            .get('/api/pos/query?poNumbers=OC001,OC002')
            .set('x-api-key', TEST_API_KEY);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('POST /api/pos/upload returns 200 envelope', async () => {
        const res = await request(app)
            .post('/api/pos/upload')
            .set('x-api-key', TEST_API_KEY)
            .send({ poNumbers: ['OC001', 'OC002'] });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(uploadSpecificPurchaseOrders).toHaveBeenCalledWith(['OC001', 'OC002'], null, 0);
    });

    test('PUT /api/pos/update returns 200 envelope', async () => {
        const res = await request(app)
            .put('/api/pos/update')
            .set('x-api-key', TEST_API_KEY)
            .send({ poNumber: 'OC001' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('GET /api/pos/address-diagnostic returns 200 envelope', async () => {
        const res = await request(app)
            .get('/api/pos/address-diagnostic?poNumber=OC001')
            .set('x-api-key', TEST_API_KEY);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(diagnosticPOAddress).toHaveBeenCalledWith('OC001', 'COPDAT');
    });

    test('GET /api/pos/payment-form-diagnostic returns 200 envelope', async () => {
        const res = await request(app)
            .get('/api/pos/payment-form-diagnostic?poNumber=OC001')
            .set('x-api-key', TEST_API_KEY);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(diagnosticPaymentForm).toHaveBeenCalledWith('OC001', null);
    });

    test('POST /api/pos/upload-authorized returns 200 envelope', async () => {
        const res = await request(app)
            .post('/api/pos/upload-authorized')
            .set('x-api-key', TEST_API_KEY)
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(uploadAuthorizedPOs).toHaveBeenCalledWith({ tenantIndex: 0 });
    });

    test('POST /api/pos/lifecycle with mode=analyze returns 200 envelope', async () => {
        const res = await request(app)
            .post('/api/pos/lifecycle')
            .set('x-api-key', TEST_API_KEY)
            .send({ mode: 'analyze' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(analyzeOrders).toHaveBeenCalledWith({ tenantIndex: 0, database: null });
    });
});

// ---------------------------------------------------------------------------
// 2. Validation -- missing required params returns 400 with errors array
// ---------------------------------------------------------------------------
describe('PO Routes - Validation Errors', () => {
    test('GET /api/pos/diagnostic without poNumber returns 400', async () => {
        const res = await request(app)
            .get('/api/pos/diagnostic')
            .set('x-api-key', TEST_API_KEY);
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.errors.length).toBeGreaterThan(0);
    });

    test('GET /api/pos/query without poNumbers returns 400', async () => {
        const res = await request(app)
            .get('/api/pos/query')
            .set('x-api-key', TEST_API_KEY);
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('POST /api/pos/upload without poNumbers returns 400', async () => {
        const res = await request(app)
            .post('/api/pos/upload')
            .set('x-api-key', TEST_API_KEY)
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('PUT /api/pos/update without poNumber returns 400', async () => {
        const res = await request(app)
            .put('/api/pos/update')
            .set('x-api-key', TEST_API_KEY)
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('GET /api/pos/address-diagnostic without poNumber returns 400', async () => {
        const res = await request(app)
            .get('/api/pos/address-diagnostic')
            .set('x-api-key', TEST_API_KEY);
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('GET /api/pos/payment-form-diagnostic without poNumber returns 400', async () => {
        const res = await request(app)
            .get('/api/pos/payment-form-diagnostic')
            .set('x-api-key', TEST_API_KEY);
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('POST /api/pos/lifecycle without mode returns 400', async () => {
        const res = await request(app)
            .post('/api/pos/lifecycle')
            .set('x-api-key', TEST_API_KEY)
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('POST /api/pos/lifecycle with invalid mode returns 400', async () => {
        const res = await request(app)
            .post('/api/pos/lifecycle')
            .set('x-api-key', TEST_API_KEY)
            .send({ mode: 'invalid' });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 3. API key -- endpoints without x-api-key return 401
// ---------------------------------------------------------------------------
describe('PO Routes - API Key Required', () => {
    test('GET /api/pos/diagnostic without API key returns 401', async () => {
        const res = await request(app)
            .get('/api/pos/diagnostic?poNumber=OC001');
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.errors).toContain('Invalid or missing API key');
    });

    test('POST /api/pos/upload without API key returns 401', async () => {
        const res = await request(app)
            .post('/api/pos/upload')
            .send({ poNumbers: ['OC001'] });
        expect(res.status).toBe(401);
    });

    test('PUT /api/pos/update without API key returns 401', async () => {
        const res = await request(app)
            .put('/api/pos/update')
            .send({ poNumber: 'OC001' });
        expect(res.status).toBe(401);
    });

    test('POST /api/pos/lifecycle without API key returns 401', async () => {
        const res = await request(app)
            .post('/api/pos/lifecycle')
            .send({ mode: 'analyze' });
        expect(res.status).toBe(401);
    });
});

// ---------------------------------------------------------------------------
// 4. Dry-run defaults -- PUT /update without dryRun calls with dryRun=true
// ---------------------------------------------------------------------------
describe('PO Routes - Dry-run Defaults', () => {
    test('PUT /api/pos/update defaults dryRun to true', async () => {
        await request(app)
            .put('/api/pos/update')
            .set('x-api-key', TEST_API_KEY)
            .send({ poNumber: 'OC001' });

        expect(testPurchaseOrderUpdate).toHaveBeenCalledWith('OC001', null, 0, true);
    });

    test('PUT /api/pos/update respects explicit dryRun=false', async () => {
        await request(app)
            .put('/api/pos/update')
            .set('x-api-key', TEST_API_KEY)
            .send({ poNumber: 'OC001', dryRun: false });

        expect(testPurchaseOrderUpdate).toHaveBeenCalledWith('OC001', null, 0, false);
    });
});

// ---------------------------------------------------------------------------
// 5. poNumbers normalization -- comma-separated string -> array
// ---------------------------------------------------------------------------
describe('PO Routes - poNumbers Normalization', () => {
    test('GET /query with comma-separated string calls with array', async () => {
        await request(app)
            .get('/api/pos/query?poNumbers=OC001,OC002,OC003')
            .set('x-api-key', TEST_API_KEY);

        expect(testSpecificPurchaseOrders).toHaveBeenCalledWith(
            ['OC001', 'OC002', 'OC003'],
            null,
            0
        );
    });

    test('POST /upload with array keeps array', async () => {
        await request(app)
            .post('/api/pos/upload')
            .set('x-api-key', TEST_API_KEY)
            .send({ poNumbers: ['OC001', 'OC002'] });

        expect(uploadSpecificPurchaseOrders).toHaveBeenCalledWith(
            ['OC001', 'OC002'],
            null,
            0
        );
    });

    test('POST /upload with comma-separated string splits to array', async () => {
        await request(app)
            .post('/api/pos/upload')
            .set('x-api-key', TEST_API_KEY)
            .send({ poNumbers: 'OC001,OC002' });

        expect(uploadSpecificPurchaseOrders).toHaveBeenCalledWith(
            ['OC001', 'OC002'],
            null,
            0
        );
    });
});

// ---------------------------------------------------------------------------
// 6. Lifecycle mode dispatch
// ---------------------------------------------------------------------------
describe('PO Routes - Lifecycle Mode Dispatch', () => {
    test('mode=analyze calls analyzeOrders', async () => {
        await request(app)
            .post('/api/pos/lifecycle')
            .set('x-api-key', TEST_API_KEY)
            .send({ mode: 'analyze', tenantIndex: 1, database: 'DB2' });

        expect(analyzeOrders).toHaveBeenCalledWith({ tenantIndex: 1, database: 'DB2' });
        expect(processOrders).not.toHaveBeenCalled();
        expect(testTenant).not.toHaveBeenCalled();
    });

    test('mode=process calls processOrders', async () => {
        await request(app)
            .post('/api/pos/lifecycle')
            .set('x-api-key', TEST_API_KEY)
            .send({ mode: 'process', tenantIndex: 0 });

        expect(processOrders).toHaveBeenCalledWith({ tenantIndex: 0, database: null });
        expect(analyzeOrders).not.toHaveBeenCalled();
        expect(testTenant).not.toHaveBeenCalled();
    });

    test('mode=tenant calls testTenant', async () => {
        await request(app)
            .post('/api/pos/lifecycle')
            .set('x-api-key', TEST_API_KEY)
            .send({ mode: 'tenant', tenantIndex: 1 });

        expect(testTenant).toHaveBeenCalledWith({ tenantIndex: 1 });
        expect(analyzeOrders).not.toHaveBeenCalled();
        expect(processOrders).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// 7. tenantIndex validation -- reject invalid values
// ---------------------------------------------------------------------------
describe('PO Routes - tenantIndex Validation', () => {
    test('rejects tenantIndex above max tenant count', async () => {
        const res = await request(app)
            .post('/api/pos/upload')
            .set('x-api-key', TEST_API_KEY)
            .send({ poNumbers: ['OC001'], tenantIndex: 99 });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('rejects negative tenantIndex', async () => {
        const res = await request(app)
            .post('/api/pos/upload')
            .set('x-api-key', TEST_API_KEY)
            .send({ poNumbers: ['OC001'], tenantIndex: -1 });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('rejects non-integer tenantIndex', async () => {
        const res = await request(app)
            .get('/api/pos/query?poNumbers=OC001&tenantIndex=abc')
            .set('x-api-key', TEST_API_KEY);
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});
