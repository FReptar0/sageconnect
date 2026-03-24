/**
 * Schedule Routes Integration Tests
 *
 * Tests all 3 schedule endpoints: GET /schedule, GET /schedule/history,
 * POST /schedule/:taskId/trigger with API key enforcement, conflict detection,
 * and Joi validation.
 *
 * Strategy: Build a dedicated test app that mocks all dependencies
 * and config.js to avoid needing real env vars or database connections.
 */

const { describe, test, expect, beforeAll, beforeEach } = require('@jest/globals');

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
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 5000 },
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
// Mock OperationManager
// ---------------------------------------------------------------------------
const mockOperationManager = {
    acquireLock: jest.fn().mockReturnValue(true),
    releaseLock: jest.fn(),
    isLocked: jest.fn().mockReturnValue(false),
    emitProgress: jest.fn(),
    getRunningOperations: jest.fn().mockReturnValue({}),
    getHistory: jest.fn().mockReturnValue([]),
    addHistory: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    setMaxListeners: jest.fn(),
};
jest.mock('../../src/services/OperationManager', () => mockOperationManager);

// ---------------------------------------------------------------------------
// Mock CronScheduler (may not exist yet -- Plan 02 Wave 2 parallel)
// ---------------------------------------------------------------------------
jest.mock('../../src/services/CronScheduler', () => ({
    getSchedulerStatus: jest.fn().mockReturnValue({
        cronExpression: '*/15 * * * *',
        status: 'idle',
        nextRun: '2026-03-24T00:15:00.000Z',
        lastRun: null,
    }),
    getTask: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock background.js forResponse
// ---------------------------------------------------------------------------
jest.mock('../../src/background', () => ({
    forResponse: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock infrastructure modules
// ---------------------------------------------------------------------------
jest.mock('../../src/utils/LogGenerator', () => ({
    logGenerator: jest.fn(),
}));
jest.mock('../../src/utils/SQLServerConnection', () => ({
    runQuery: jest.fn().mockResolvedValue({ recordset: [] }),
}));
jest.mock('../../src/utils/TimezoneHelper', () => ({
    getCurrentDateCompact: jest.fn().mockReturnValue('20260323'),
    getCurrentDateString: jest.fn().mockReturnValue('2026-03-23'),
}));
// Mock express-rate-limit
jest.mock('express-rate-limit', () => ({
    rateLimit: () => (req, res, next) => next(),
}));

// Mock api-key middleware to use test key (avoids importing real config in middleware)
jest.mock('../../src/middleware/api-key', () => {
    const crypto = require('crypto');
    return {
        requireApiKey: (req, res, next) => {
            const configuredKey = 'test-api-key';
            const providedKey = req.headers['x-api-key'];

            if (!providedKey) {
                return res.status(401).json({
                    success: false,
                    data: null,
                    errors: ['Invalid or missing API key'],
                    summary: 'Unauthorized',
                    meta: { duration: 0, timestamp: new Date().toISOString(), tenant: null },
                });
            }

            const configuredBuf = Buffer.from(configuredKey, 'utf8');
            const providedBuf = Buffer.from(String(providedKey), 'utf8');

            if (configuredBuf.length !== providedBuf.length ||
                !crypto.timingSafeEqual(configuredBuf, providedBuf)) {
                return res.status(401).json({
                    success: false,
                    data: null,
                    errors: ['Invalid or missing API key'],
                    summary: 'Unauthorized',
                    meta: { duration: 0, timestamp: new Date().toISOString(), tenant: null },
                });
            }

            next();
        },
    };
});

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------
const express = require('express');
const request = require('supertest');
const { errorResult } = require('../../src/utils/ResultEnvelope');

const TEST_API_KEY = 'test-api-key';

function createScheduleTestApp() {
    const app = express();
    app.use(express.json());

    // Mount schedule routes (schedule-routes applies requireApiKey internally on POST)
    const scheduleRoutes = require('../../src/routes/schedule-routes');
    app.use('/api/schedule', scheduleRoutes);

    // Error handler
    app.use((err, req, res, _next) => {
        res.status(500).json(errorResult([err.message], 'Internal server error'));
    });

    return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Schedule Routes', () => {
    let app;

    beforeAll(() => {
        app = createScheduleTestApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset default mock return values
        mockOperationManager.acquireLock.mockReturnValue(true);
        mockOperationManager.getHistory.mockReturnValue([]);
        mockOperationManager.getRunningOperations.mockReturnValue({});
    });

    // -------------------------------------------------------------------
    // GET /api/schedule
    // -------------------------------------------------------------------
    describe('GET /api/schedule', () => {
        test('returns 200 with tasks array containing background-cycle', async () => {
            const res = await request(app)
                .get('/api/schedule');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.tasks).toBeInstanceOf(Array);
            expect(res.body.data.tasks.length).toBeGreaterThan(0);
            expect(res.body.data.tasks[0].taskId).toBe('background-cycle');
            expect(res.body.data.tasks[0]).toHaveProperty('cronExpression');
            expect(res.body.data.tasks[0]).toHaveProperty('status');
            expect(res.body.data.tasks[0]).toHaveProperty('nextRun');
        });
    });

    // -------------------------------------------------------------------
    // GET /api/schedule/history
    // -------------------------------------------------------------------
    describe('GET /api/schedule/history', () => {
        test('returns 200 with empty executions array', async () => {
            const res = await request(app)
                .get('/api/schedule/history');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.executions).toBeInstanceOf(Array);
            expect(res.body.data.executions).toHaveLength(0);
            expect(res.body.data.count).toBe(0);
        });

        test('returns history entries when present', async () => {
            const mockHistory = [
                { taskId: 'background-cycle', operationId: 'op-1', startedAt: new Date().toISOString(), success: true },
            ];
            mockOperationManager.getHistory.mockReturnValue(mockHistory);

            const res = await request(app)
                .get('/api/schedule/history');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.executions).toHaveLength(1);
            expect(res.body.data.count).toBe(1);
        });
    });

    // -------------------------------------------------------------------
    // POST /api/schedule/:taskId/trigger
    // -------------------------------------------------------------------
    describe('POST /api/schedule/:taskId/trigger', () => {
        test('returns 200 with operationId when triggered with valid API key', async () => {
            const res = await request(app)
                .post('/api/schedule/background-cycle/trigger')
                .set('x-api-key', TEST_API_KEY);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('operationId');
            expect(res.body.data.taskId).toBe('background-cycle');
            expect(mockOperationManager.acquireLock).toHaveBeenCalledWith(
                'background-cycle',
                expect.any(String)
            );
        });

        test('returns 401 without API key', async () => {
            const res = await request(app)
                .post('/api/schedule/background-cycle/trigger');

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.errors).toContain('Invalid or missing API key');
        });

        test('returns 409 when acquireLock returns false (already running)', async () => {
            mockOperationManager.acquireLock.mockReturnValue(false);

            const res = await request(app)
                .post('/api/schedule/background-cycle/trigger')
                .set('x-api-key', TEST_API_KEY);

            expect(res.status).toBe(409);
            expect(res.body.success).toBe(false);
            expect(res.body.errors.length).toBeGreaterThan(0);
        });

        test('returns 400 for invalid taskId', async () => {
            const res = await request(app)
                .post('/api/schedule/invalid-task/trigger')
                .set('x-api-key', TEST_API_KEY);

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.errors.length).toBeGreaterThan(0);
        });
    });
});
