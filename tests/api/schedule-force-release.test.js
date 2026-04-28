/**
 * Force-Release Endpoint Integration Tests
 *
 * Phase 18 Plan 18-02 — REC-04 (force-release endpoint) + REC-05 (audit history).
 * Verifies POST /api/schedule/:taskId/force-release semantics:
 *   - Always returns HTTP 200 (idempotent, never 404 / never 409).
 *   - Released-true path triggers releaseLock, addHistory, sendAdminAlert (admin email).
 *   - Released-false path emits warn log only, no audit pollution, no email.
 *   - Validation rejects unknown taskId / oversize reason.
 *   - SMTP failure does not block the response.
 *
 * Test app strategy clones tests/api/schedule-routes.test.js mocks + api-key middleware
 * mock so the configured x-api-key is `test-api-key`. nodemailer is mocked at the module
 * level so `sendAdminAlert` (inline in src/routes/schedule-routes.js) sends through the
 * stubbed transport.
 */

const { describe, test, expect, beforeAll, beforeEach } = require('@jest/globals');

// ---------------------------------------------------------------------------
// Mock src/config BEFORE any other requires (prevents process.exit on missing env)
// ---------------------------------------------------------------------------
jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://test-portal',
        tenants: [
            { id: 'capstone', key: 'k1', secret: 's1', database: 'DB1', externalId: 'E1' },
        ],
    },
    security: { apiKey: 'test-api-key' },
    database: { user: 'u', password: 'p', server: 's', database: 'd' },
    paths: { logs: '/tmp', downloads: '/tmp', providers: '/tmp' },
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 5000, lockTimeoutMs: 1000 },
    app: {
        timezone: 'America/Mexico_City',
        importRoute: '/test',
        arg: 'ARG',
        company: 'TestCo',
        rfc: 'RFC',
        regimen: 'REG',
        defaultAddress: {
            city: 'C', country: 'MX', identifier: 'I',
            municipality: 'M', state: 'S', street: 'ST', zip: '00000',
        },
        addressIdentifiersSkip: [],
    },
    license: { adminEmail: 'admin@test.com' },
    mailing: {
        server: 'smtp', port: 587, ssl: false, from: 'noreply@test.com', password: '',
        notices: [], cc: [],
    },
}));

// ---------------------------------------------------------------------------
// Mock OperationManager — getRunningOperations is the key new mock for force-release
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
// Mock CronScheduler — schedule-routes.js lazy-loads it
// ---------------------------------------------------------------------------
jest.mock('../../src/services/CronScheduler', () => ({
    getSchedulerStatus: jest.fn().mockReturnValue({
        cronExpression: '*/15 * * * *',
        status: 'idle',
        nextRun: '2026-04-28T18:30:00.000Z',
        lastRun: null,
    }),
    getTask: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock background.js forResponse (required by schedule-routes top-level require)
// ---------------------------------------------------------------------------
jest.mock('../../src/background', () => ({
    forResponse: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock infrastructure modules
// ---------------------------------------------------------------------------
const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({
    logGenerator: mockLogGenerator,
}));
jest.mock('../../src/utils/SQLServerConnection', () => ({
    runQuery: jest.fn().mockResolvedValue({ recordset: [] }),
}));
jest.mock('../../src/utils/TimezoneHelper', () => ({
    getCurrentDateCompact: jest.fn().mockReturnValue('20260428'),
    getCurrentDateString: jest.fn().mockReturnValue('2026-04-28'),
}));

// Mock express-rate-limit so writeLimiter is a no-op in tests (matches schedule-routes.test.js)
jest.mock('express-rate-limit', () => ({
    rateLimit: () => (req, res, next) => next(),
}));

// Mock api-key middleware (TEST_API_KEY = 'test-api-key' — same as schedule-routes.test.js)
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
// Mock nodemailer — captures sendMail calls for the inline sendAdminAlert helper
// ---------------------------------------------------------------------------
const mockNodemailerSendMail = jest.fn().mockResolvedValue({ accepted: ['admin@test.com'] });
const mockCreateTransport = jest.fn(() => ({ sendMail: mockNodemailerSendMail }));
jest.mock('nodemailer', () => ({
    createTransport: mockCreateTransport,
}));

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

    const scheduleRoutes = require('../../src/routes/schedule-routes');
    app.use('/api/schedule', scheduleRoutes);

    app.use((err, req, res, _next) => {
        res.status(500).json(errorResult([err.message], 'Internal server error'));
    });

    return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/schedule/:taskId/force-release (Phase 18, REC-04 + REC-05)', () => {
    let app;

    beforeAll(() => {
        app = createScheduleTestApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockOperationManager.acquireLock.mockReturnValue(true);
        mockOperationManager.releaseLock.mockReset();
        mockOperationManager.getRunningOperations.mockReset().mockReturnValue({});
        mockOperationManager.addHistory.mockReset();
        mockNodemailerSendMail.mockReset().mockResolvedValue({ accepted: ['admin@test.com'] });
        mockCreateTransport.mockClear();
        mockLogGenerator.mockClear();
    });

    // --------------------------------------------------------------------
    // A. Lock-active path (released:true)
    // --------------------------------------------------------------------

    test('returns 200 + released:true with previousLock when lock is held', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({
            'background-cycle': {
                operationId: 'op-test-1',
                startedAt: '2026-04-28T18:14:32.000Z',
                stepProgress: [
                    {
                        step: 'downloadCFDI',
                        tenant: 'capstone',
                        startedAt: '2026-04-28T18:15:00.000Z',
                        finishedAt: null,
                        error: null,
                    },
                ],
            },
        });

        const res = await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.released).toBe(true);
        expect(res.body.data.previousLock).toEqual(expect.objectContaining({
            operationId: 'op-test-1',
            startedAt: '2026-04-28T18:14:32.000Z',
            durationMs: expect.any(Number),
            stuckOnStep: 'downloadCFDI',
            stuckOnTenant: 'capstone',
        }));
        expect(res.body.data.previousLock.durationMs).toBeGreaterThan(0);
        expect(res.body.summary).toBe('Lock background-cycle liberado');
    });

    test('calls releaseLock exactly once with the taskId', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({
            'background-cycle': {
                operationId: 'op-test-2',
                startedAt: '2026-04-28T18:00:00.000Z',
                stepProgress: [],
            },
        });

        await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});

        expect(mockOperationManager.releaseLock).toHaveBeenCalledTimes(1);
        expect(mockOperationManager.releaseLock).toHaveBeenCalledWith('background-cycle');
    });

    test('calls addHistory exactly once with ManualForceRelease shape', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({
            'background-cycle': {
                operationId: 'op-test-3',
                startedAt: '2026-04-28T18:00:00.000Z',
                stepProgress: [
                    { step: 'downloadCFDI', tenant: 'capstone', startedAt: '2026-04-28T18:01:00.000Z', finishedAt: null, error: null },
                ],
            },
        });

        await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});

        expect(mockOperationManager.addHistory).toHaveBeenCalledTimes(1);
        const record = mockOperationManager.addHistory.mock.calls[0][0];
        expect(record).toEqual(expect.objectContaining({
            taskId: 'background-cycle',
            operationId: 'op-test-3',
            startedAt: '2026-04-28T18:00:00.000Z',
            success: false,
            errors: ['ManualForceRelease'],
            stuckOnStep: 'downloadCFDI',
            stuckOnTenant: 'capstone',
        }));
        expect(record.summary).toMatch(/^Lock forzado manualmente por operador/);
        expect(record.finishedAt).toBeDefined();
    });

    test('sends admin email with [SageConnect] Liberación manual subject', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({
            'background-cycle': {
                operationId: 'op-test-4',
                startedAt: '2026-04-28T18:00:00.000Z',
                stepProgress: [],
            },
        });

        const res = await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});
        expect(res.status).toBe(200);

        // Drain microtasks so the fired-and-forgotten sendAdminAlert resolves
        await new Promise((r) => setImmediate(r));

        expect(mockNodemailerSendMail).toHaveBeenCalledTimes(1);
        const mailArgs = mockNodemailerSendMail.mock.calls[0][0];
        expect(mailArgs.subject).toMatch(/^\[SageConnect\] Liberación manual: lock background-cycle forzado por operador/);
        expect(mailArgs.to).toBe('admin@test.com');
        expect(mailArgs.from).toBe('noreply@test.com');
    });

    test('logs warn with [FORCE-RELEASE] prefix on released:true', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({
            'background-cycle': {
                operationId: 'op-test-5',
                startedAt: '2026-04-28T18:00:00.000Z',
                stepProgress: [],
            },
        });

        await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});

        const warnCalls = mockLogGenerator.mock.calls.filter(
            (call) => call[0] === 'ScheduleRoutes' && call[1] === 'warn' && /\[FORCE-RELEASE\]/.test(call[2])
        );
        expect(warnCalls.length).toBeGreaterThanOrEqual(1);
    });

    // --------------------------------------------------------------------
    // B. Idempotent path (released:false)
    // --------------------------------------------------------------------

    test('returns 200 + released:false when no lock is held', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({});

        const res = await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.released).toBe(false);
        expect(res.body.data.previousLock).toBeNull();
        expect(res.body.summary).toBe('Sin lock activo para liberar');
    });

    test('does NOT call releaseLock when no lock is held', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({});

        await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});

        expect(mockOperationManager.releaseLock).not.toHaveBeenCalled();
    });

    test('does NOT call addHistory when no lock is held', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({});

        await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});

        expect(mockOperationManager.addHistory).not.toHaveBeenCalled();
    });

    test('does NOT send email when no lock is held', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({});

        await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});
        await new Promise((r) => setImmediate(r));

        expect(mockNodemailerSendMail).not.toHaveBeenCalled();
        expect(mockCreateTransport).not.toHaveBeenCalled();
    });

    test('logs warn with [FORCE-RELEASE-NOOP] prefix on released:false', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({});

        await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});

        const noopCalls = mockLogGenerator.mock.calls.filter(
            (call) => call[0] === 'ScheduleRoutes' && call[1] === 'warn' && /\[FORCE-RELEASE-NOOP\]/.test(call[2])
        );
        expect(noopCalls.length).toBeGreaterThanOrEqual(1);
    });

    // --------------------------------------------------------------------
    // C. Reason flowthrough
    // --------------------------------------------------------------------

    test('reason flows into addHistory summary and email body', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({
            'background-cycle': {
                operationId: 'op-test-reason',
                startedAt: '2026-04-28T18:00:00.000Z',
                stepProgress: [],
            },
        });

        const res = await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({ reason: 'investigando timeout en uploadPayments' });
        expect(res.status).toBe(200);

        await new Promise((r) => setImmediate(r));

        const historyCall = mockOperationManager.addHistory.mock.calls[0][0];
        expect(historyCall.summary).toMatch(/\(motivo: investigando timeout en uploadPayments\)/);

        expect(mockNodemailerSendMail).toHaveBeenCalledTimes(1);
        expect(mockNodemailerSendMail.mock.calls[0][0].html).toContain('investigando timeout en uploadPayments');
    });

    // --------------------------------------------------------------------
    // D. Auth and validation
    // --------------------------------------------------------------------

    test('returns 401 without x-api-key', async () => {
        const res = await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .send({});

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.errors).toContain('Invalid or missing API key');
    });

    test('returns 400 for invalid taskId', async () => {
        const res = await request(app)
            .post('/api/schedule/foo/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.errors.length).toBeGreaterThan(0);
    });

    test('returns 400 when reason exceeds 200 chars', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({
            'background-cycle': {
                operationId: 'op-test-toolong',
                startedAt: '2026-04-28T18:00:00.000Z',
                stepProgress: [],
            },
        });

        const res = await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({ reason: 'x'.repeat(201) });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.errors.length).toBeGreaterThan(0);
        // Side-effects must NOT have occurred — Joi rejected before handler ran
        expect(mockOperationManager.releaseLock).not.toHaveBeenCalled();
        expect(mockOperationManager.addHistory).not.toHaveBeenCalled();
    });

    test('accepts empty body { } when lock is held', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({
            'background-cycle': {
                operationId: 'op-test-empty',
                startedAt: '2026-04-28T18:00:00.000Z',
                stepProgress: [],
            },
        });

        const res = await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});

        expect(res.status).toBe(200);
        expect(res.body.data.released).toBe(true);
    });

    test('accepts no body at all (Content-Length 0) when lock is held', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({
            'background-cycle': {
                operationId: 'op-test-nobody',
                startedAt: '2026-04-28T18:00:00.000Z',
                stepProgress: [],
            },
        });

        const res = await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY);

        expect(res.status).toBe(200);
        expect(res.body.data.released).toBe(true);
    });

    // --------------------------------------------------------------------
    // E. ResultEnvelope shape
    // --------------------------------------------------------------------

    test('response body has full ResultEnvelope shape on released:true', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({
            'background-cycle': {
                operationId: 'op-envelope-true',
                startedAt: '2026-04-28T18:00:00.000Z',
                stepProgress: [],
            },
        });

        const res = await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});

        expect(res.status).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({
            success: expect.any(Boolean),
            data: expect.any(Object),
            errors: expect.any(Array),
            summary: expect.any(String),
            meta: expect.objectContaining({
                duration: expect.any(Number),
                timestamp: expect.any(String),
                tenant: null,
            }),
        }));
        expect(res.body.errors).toHaveLength(0);
        expect(res.body.success).toBe(true);
    });

    test('response body has full ResultEnvelope shape on released:false', async () => {
        mockOperationManager.getRunningOperations.mockReturnValue({});

        const res = await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});

        expect(res.status).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({
            success: expect.any(Boolean),
            data: expect.any(Object),
            errors: expect.any(Array),
            summary: expect.any(String),
            meta: expect.objectContaining({
                duration: expect.any(Number),
                timestamp: expect.any(String),
                tenant: null,
            }),
        }));
        expect(res.body.errors).toHaveLength(0);
        expect(res.body.success).toBe(true);
    });

    // --------------------------------------------------------------------
    // F. Email failure resilience
    // --------------------------------------------------------------------

    test('returns 200 + released:true even when SMTP send fails', async () => {
        mockNodemailerSendMail.mockReset().mockRejectedValue(new Error('SMTP down'));
        mockOperationManager.getRunningOperations.mockReturnValue({
            'background-cycle': {
                operationId: 'op-smtp-fail',
                startedAt: '2026-04-28T18:00:00.000Z',
                stepProgress: [],
            },
        });

        const res = await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY)
            .send({});

        expect(res.status).toBe(200);
        expect(res.body.data.released).toBe(true);
        expect(mockOperationManager.releaseLock).toHaveBeenCalledTimes(1);
        expect(mockOperationManager.addHistory).toHaveBeenCalledTimes(1);

        // Drain microtasks so the swallowed SMTP failure has a chance to log warn
        await new Promise((r) => setImmediate(r));

        const failureLogs = mockLogGenerator.mock.calls.filter(
            (call) => call[1] === 'warn' && /\[ADMIN-EMAIL\]/.test(call[2])
        );
        expect(failureLogs.length).toBeGreaterThanOrEqual(1);
    });

    // --------------------------------------------------------------------
    // G. Idempotent double-click
    // --------------------------------------------------------------------

    test('second force-release after auto-release returns released:false (idempotent)', async () => {
        mockOperationManager.getRunningOperations
            .mockReturnValueOnce({
                'background-cycle': {
                    operationId: 'op-double-1',
                    startedAt: '2026-04-28T18:00:00.000Z',
                    stepProgress: [],
                },
            })
            .mockReturnValueOnce({});

        const r1 = await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY).send({});
        const r2 = await request(app)
            .post('/api/schedule/background-cycle/force-release')
            .set('x-api-key', TEST_API_KEY).send({});

        expect(r1.body.data.released).toBe(true);
        expect(r2.body.data.released).toBe(false);
        expect(mockOperationManager.addHistory).toHaveBeenCalledTimes(1);
        expect(mockOperationManager.releaseLock).toHaveBeenCalledTimes(1);
    });
});
