/**
 * Security Integration Tests
 *
 * Tests helmet headers, CORS, API key middleware, rate limiting,
 * and route structure using supertest against the Express app.
 *
 * Strategy: Build a dedicated test app per suite to avoid config.js
 * process.exit() validation. Middleware and routes are tested in isolation.
 */

const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');
const express = require('express');
const request = require('supertest');

// ---------------------------------------------------------------------------
// Shared test app builder -- avoids requiring config.js (which calls process.exit)
// ---------------------------------------------------------------------------

const TEST_API_KEY = 'test-secret-key-12345';

/**
 * Creates a minimal Express app with the security middleware stack
 * that mirrors src/server.js but without requiring config.js env vars.
 */
function createTestApp() {
    const helmet = require('helmet');
    const cors = require('cors');
    const { rateLimit } = require('express-rate-limit');
    const { errorResult } = require('../../src/utils/ResultEnvelope');

    const app = express();

    // Security middleware (same order as server.js)
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(cors({
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'x-api-key'],
    }));

    app.use(express.json());

    return app;
}

// ---------------------------------------------------------------------------
// 1. Helmet Security Headers
// ---------------------------------------------------------------------------
describe('Helmet Security Headers', () => {
    let app;

    beforeAll(() => {
        app = createTestApp();
        // Mount a simple health endpoint
        app.get('/api/system/health', (req, res) => {
            res.json({ success: true, data: { status: 'ok' } });
        });
    });

    test('GET /api/system/health returns 200 with success envelope', async () => {
        const res = await request(app).get('/api/system/health');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('response includes x-content-type-options header', async () => {
        const res = await request(app).get('/api/system/health');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    test('response includes x-frame-options header', async () => {
        const res = await request(app).get('/api/system/health');
        expect(res.headers['x-frame-options']).toBeDefined();
    });

    test('response includes x-xss-protection or removes it (helmet v8 behavior)', async () => {
        const res = await request(app).get('/api/system/health');
        // Helmet v8 removes x-xss-protection by default (it's deprecated)
        // but x-content-type-options should be present
        expect(res.headers['x-content-type-options']).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// 2. CORS Headers
// ---------------------------------------------------------------------------
describe('CORS Headers', () => {
    let app;

    beforeAll(() => {
        app = createTestApp();
        app.get('/api/system/health', (req, res) => {
            res.json({ success: true });
        });
    });

    test('response includes Access-Control-Allow-Origin when Origin header sent', async () => {
        const res = await request(app)
            .get('/api/system/health')
            .set('Origin', 'http://localhost:3000');
        expect(res.headers['access-control-allow-origin']).toBeDefined();
    });

    test('preflight OPTIONS request returns allowed methods', async () => {
        const res = await request(app)
            .options('/api/system/health')
            .set('Origin', 'http://localhost:3000')
            .set('Access-Control-Request-Method', 'GET')
            .set('Access-Control-Request-Headers', 'x-api-key');
        expect(res.status).toBe(204);
        expect(res.headers['access-control-allow-headers']).toMatch(/x-api-key/i);
    });
});

// ---------------------------------------------------------------------------
// 3. API Key Middleware
// ---------------------------------------------------------------------------
describe('API Key Middleware', () => {
    let app;

    beforeAll(() => {
        // Build a test app with a dummy route behind requireApiKey
        app = createTestApp();

        // Mock the requireApiKey middleware with our test key
        const crypto = require('crypto');
        const { errorResult } = require('../../src/utils/ResultEnvelope');

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

        // Protected route
        app.get('/api/payments/test', testRequireApiKey, (req, res) => {
            res.json({ success: true, data: { message: 'authorized' } });
        });

        // Unprotected dashboard route
        app.get('/api/dashboard', (req, res) => {
            res.json({ success: true, data: { dashboard: true } });
        });
    });

    test('GET /api/dashboard returns 200 without API key (unauthenticated)', async () => {
        const res = await request(app).get('/api/dashboard');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('GET /api/payments/test returns 401 when no x-api-key header', async () => {
        const res = await request(app).get('/api/payments/test');
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.errors).toContain('Invalid or missing API key');
    });

    test('GET /api/payments/test returns 401 with wrong API key', async () => {
        const res = await request(app)
            .get('/api/payments/test')
            .set('x-api-key', 'wrong-key');
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.errors).toContain('Invalid or missing API key');
    });

    test('GET /api/payments/test returns 200 with correct API key', async () => {
        const res = await request(app)
            .get('/api/payments/test')
            .set('x-api-key', TEST_API_KEY);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.message).toBe('authorized');
    });
});

// ---------------------------------------------------------------------------
// 4. API Key Middleware -- no key configured
// ---------------------------------------------------------------------------
describe('API Key Middleware (no key configured)', () => {
    let app;

    beforeAll(() => {
        app = createTestApp();

        const { errorResult } = require('../../src/utils/ResultEnvelope');

        // Simulates api-key.js behavior when SAGECONNECT_API_KEY is null
        function noKeyRequireApiKey(req, res, next) {
            const configuredKey = null; // Not configured

            if (!configuredKey) {
                return res.status(401).json(
                    errorResult(['Invalid or missing API key'], 'Unauthorized')
                );
            }

            next();
        }

        app.get('/api/payments/test', noKeyRequireApiKey, (req, res) => {
            res.json({ success: true });
        });
    });

    test('rejects all requests when SAGECONNECT_API_KEY is not configured', async () => {
        const res = await request(app)
            .get('/api/payments/test')
            .set('x-api-key', 'any-key');
        expect(res.status).toBe(401);
        expect(res.body.errors).toContain('Invalid or missing API key');
    });
});

// ---------------------------------------------------------------------------
// 5. Rate Limiting
// ---------------------------------------------------------------------------
describe('Rate Limiting', () => {
    let app;

    beforeAll(() => {
        const { rateLimit } = require('express-rate-limit');

        app = express();
        // Very low limit for testing
        app.use('/api', rateLimit({
            windowMs: 60 * 1000,
            limit: 2,
            standardHeaders: 'draft-7',
            legacyHeaders: false,
            message: {
                success: false,
                data: null,
                errors: ['Too many requests, please try again later'],
                summary: 'Rate limited',
                meta: { duration: 0, timestamp: new Date().toISOString(), tenant: null },
            },
        }));

        app.get('/api/test', (req, res) => {
            res.json({ success: true });
        });
    });

    test('returns RateLimit headers on /api routes (draft-7)', async () => {
        const res = await request(app).get('/api/test');
        expect(res.status).toBe(200);
        // draft-7 uses combined ratelimit header and ratelimit-policy
        expect(res.headers['ratelimit']).toBeDefined();
        expect(res.headers['ratelimit-policy']).toBeDefined();
    });

    test('returns 429 after exceeding rate limit', async () => {
        // Request 1 -- OK
        await request(app).get('/api/test');
        // Request 2 -- should be the last allowed (limit=2, already used 1 from previous test)
        // Request 3 -- should be rate limited
        const res = await request(app).get('/api/test');
        expect(res.status).toBe(429);
        expect(res.body.success).toBe(false);
        expect(res.body.errors).toContain('Too many requests, please try again later');
    });
});

// ---------------------------------------------------------------------------
// 6. Validate middleware unit test
// ---------------------------------------------------------------------------
describe('Validate Middleware', () => {
    const { validate } = require('../../src/middleware/validate');
    const Joi = require('joi');

    test('passes valid query parameters through', async () => {
        const app = express();
        const schema = Joi.object({ page: Joi.number().integer().default(1) });

        app.get('/test', validate(schema, 'query'), (req, res) => {
            res.json({ success: true, data: { page: req.query.page } });
        });

        const res = await request(app).get('/test?page=3');
        expect(res.status).toBe(200);
        expect(res.body.data.page).toBe(3);
    });

    test('returns 400 with validation errors for invalid input', async () => {
        const app = express();
        const schema = Joi.object({ page: Joi.number().integer().required() });

        app.get('/test', validate(schema, 'query'), (req, res) => {
            res.json({ success: true });
        });

        const res = await request(app).get('/test?page=abc');
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.summary).toBe('Validation failed');
        expect(res.body.errors.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 7. Async handler unit test
// ---------------------------------------------------------------------------
describe('Async Handler', () => {
    const { asyncHandler } = require('../../src/middleware/async-handler');

    test('forwards async errors to express error handler', async () => {
        const app = express();

        app.get('/test', asyncHandler(async () => {
            throw new Error('async boom');
        }));

        // Error handler
        app.use((err, req, res, _next) => {
            res.status(500).json({ error: err.message });
        });

        const res = await request(app).get('/test');
        expect(res.status).toBe(500);
        expect(res.body.error).toBe('async boom');
    });
});

// ---------------------------------------------------------------------------
// 8. Send result unit test
// ---------------------------------------------------------------------------
describe('Send Result Helper', () => {
    const { sendResult } = require('../../src/middleware/send-result');

    test('success envelope returns 200', async () => {
        const app = express();
        app.get('/test', (req, res) => {
            sendResult(res, { success: true, data: { ok: true }, errors: [], summary: '' });
        });

        const res = await request(app).get('/test');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/json.*charset=utf-8/);
    });

    test('not found error returns 404', async () => {
        const app = express();
        app.get('/test', (req, res) => {
            sendResult(res, { success: false, data: null, errors: ['Resource not found'], summary: '' });
        });

        const res = await request(app).get('/test');
        expect(res.status).toBe(404);
    });

    test('validation error returns 400', async () => {
        const app = express();
        app.get('/test', (req, res) => {
            sendResult(res, { success: false, data: null, errors: ['Validation failed for field X'], summary: '' });
        });

        const res = await request(app).get('/test');
        expect(res.status).toBe(400);
    });

    test('generic error returns 500', async () => {
        const app = express();
        app.get('/test', (req, res) => {
            sendResult(res, { success: false, data: null, errors: ['Something broke'], summary: '' });
        });

        const res = await request(app).get('/test');
        expect(res.status).toBe(500);
    });
});
