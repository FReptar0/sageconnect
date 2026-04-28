const { describe, test, expect, beforeEach } = require('@jest/globals');
const { EventEmitter } = require('events');

/**
 * Tests for src/services/CronScheduler.js lock:timeout listener (Phase 18, REC-02).
 *
 * Covers:
 * - Listener is NOT registered at module require time (lazy-load + hot-reload safety).
 * - Listener IS registered exactly once inside initScheduler().
 * - addHistory shape on emit (success:false, errors:['Timeout'], summary regex,
 *   stuckOnStep + stuckOnTenant derived from last open stepProgress entry).
 * - Admin email goes to LICENSE_ADMIN_EMAIL with [SageConnect] Auto-timeout subject prefix
 *   (NOT EmailSender.sendMail — uses nodemailer-direct per S-6).
 * - Email body html contains operationId, stuckOnStep, tenant, formatted duration.
 * - Listener swallows nodemailer errors and logs warn — never throws.
 * - logGenerator called with [TIMEOUT] prefix at warn level.
 * - stuckOnStep/stuckOnTenant null when stepProgress empty or fully closed.
 */

// ---------------------------------------------------------------------------
// Mocks (declared BEFORE any require)
// ---------------------------------------------------------------------------

// Mock node-cron
const mockTask = { getStatus: jest.fn(), getNextRun: jest.fn(), on: jest.fn() };
jest.mock('node-cron', () => ({ schedule: jest.fn(() => mockTask) }));

// Mock config — extend cron-scheduler.test.js mock with license + mailing fields needed by sendAdminAlert
jest.mock('../../src/config', () => ({
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 1000, lockTimeoutMs: 1000 },
    app: { timezone: 'America/Mexico_City', company: 'TestCo' },
    portal: { tenants: [{ id: 'T1' }] },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs' },
    license: { adminEmail: 'admin@test.com' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', password: '' },
}));

// OperationManager: REAL EventEmitter so .emit('lock:timeout') actually invokes listeners.
const mockOpManager = new EventEmitter();
mockOpManager.acquireLock = jest.fn(() => true);
mockOpManager.releaseLock = jest.fn();
mockOpManager.addHistory = jest.fn();
mockOpManager.startStep = jest.fn();
mockOpManager.endStep = jest.fn();
mockOpManager.emitProgress = jest.fn();
mockOpManager.getRunningOperations = jest.fn(() => ({}));
mockOpManager.setMaxListeners(20);
jest.mock('../../src/services/OperationManager', () => mockOpManager);

// background.js
jest.mock('../../src/background', () => ({
    forResponse: jest.fn().mockResolvedValue(undefined),
    startChildProcess: jest.fn().mockResolvedValue(undefined),
}));

// LicenseValidator
jest.mock('../../src/services/LicenseValidator', () => ({
    isValid: jest.fn(() => true),
    validate: jest.fn(),
    getStatus: jest.fn(),
    _reset: jest.fn(),
}));

// LogGenerator — capture calls for assertions
const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

// nodemailer — capture sendMail call for subject + recipient + html assertions
const mockNodemailerSendMail = jest.fn().mockResolvedValue({ accepted: ['admin@test.com'] });
jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({ sendMail: mockNodemailerSendMail })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CronScheduler lock:timeout listener (Phase 18, REC-02)', () => {
    let CronScheduler;

    beforeEach(() => {
        // Reset listeners on the singleton mock between tests
        mockOpManager.removeAllListeners('lock:timeout');
        mockOpManager.addHistory.mockClear();
        mockOpManager.releaseLock.mockClear();
        mockNodemailerSendMail.mockReset().mockResolvedValue({ accepted: ['admin@test.com'] });
        mockLogGenerator.mockClear();

        // Re-require CronScheduler in isolation so module-level state is fresh per test.
        jest.isolateModules(() => {
            CronScheduler = require('../../src/services/CronScheduler');
        });
    });

    test('does not register lock:timeout listener at module require time', () => {
        // Sanity check: requiring CronScheduler must NOT register the listener.
        // (beforeEach already required it via isolateModules and removed listeners,
        // so we re-require here to assert clean module load specifically.)
        mockOpManager.removeAllListeners('lock:timeout');

        let _CS;
        jest.isolateModules(() => {
            _CS = require('../../src/services/CronScheduler');
        });

        expect(mockOpManager.listenerCount('lock:timeout')).toBe(0);
        expect(_CS).toBeDefined();
    });

    test('registers exactly one lock:timeout listener inside initScheduler', () => {
        expect(mockOpManager.listenerCount('lock:timeout')).toBe(0);

        CronScheduler.initScheduler();

        expect(mockOpManager.listenerCount('lock:timeout')).toBe(1);
    });

    test('addHistory is called with timeout shape on lock:timeout emit', async () => {
        CronScheduler.initScheduler();

        mockOpManager.emit('lock:timeout', {
            operationType: 'background-cycle',
            operationId: 'op-Z',
            startedAt: '2026-04-28T18:00:00.000Z',
            stepProgress: [
                { step: 'downloadCFDI', tenant: 'capstone', startedAt: '2026-04-28T18:01:00.000Z', finishedAt: '2026-04-28T18:02:00.000Z', error: null },
                { step: 'uploadPayments', tenant: 'capstone', startedAt: '2026-04-28T18:02:00.000Z', finishedAt: null, error: null },
            ],
            durationMs: 14 * 60 * 1000,
        });
        await new Promise((r) => setImmediate(r));

        expect(mockOpManager.addHistory).toHaveBeenCalledTimes(1);
        const record = mockOpManager.addHistory.mock.calls[0][0];
        expect(record).toEqual(
            expect.objectContaining({
                taskId: 'background-cycle',
                operationId: 'op-Z',
                startedAt: '2026-04-28T18:00:00.000Z',
                finishedAt: expect.any(String),
                success: false,
                errors: ['Timeout'],
                summary: expect.stringMatching(/^Timeout — lock forzosamente liberado después de /),
                stuckOnStep: 'uploadPayments',
                stuckOnTenant: 'capstone',
            })
        );
    });

    test('sendAdminAlert sends to LICENSE_ADMIN_EMAIL with [SageConnect] Auto-timeout subject', async () => {
        CronScheduler.initScheduler();

        mockOpManager.emit('lock:timeout', {
            operationType: 'background-cycle',
            operationId: 'op-Z',
            startedAt: '2026-04-28T18:00:00.000Z',
            stepProgress: [
                { step: 'uploadPayments', tenant: 'capstone', startedAt: '2026-04-28T18:02:00.000Z', finishedAt: null, error: null },
            ],
            durationMs: 14 * 60 * 1000,
        });
        await new Promise((r) => setImmediate(r));

        expect(mockNodemailerSendMail).toHaveBeenCalledTimes(1);
        const mailArg = mockNodemailerSendMail.mock.calls[0][0];
        expect(mailArg.to).toBe('admin@test.com');
        expect(mailArg.from).toBe('noreply@test');
        expect(mailArg.subject).toMatch(/^\[SageConnect\] Auto-timeout: lock background-cycle liberado después de /);
    });

    test('admin email html contains operationId, stuckOnStep, tenant, and formatted duration', async () => {
        CronScheduler.initScheduler();

        mockOpManager.emit('lock:timeout', {
            operationType: 'background-cycle',
            operationId: 'op-Z',
            startedAt: '2026-04-28T18:00:00.000Z',
            stepProgress: [
                { step: 'uploadPayments', tenant: 'capstone', startedAt: '2026-04-28T18:02:00.000Z', finishedAt: null, error: null },
            ],
            durationMs: 14 * 60 * 1000,
        });
        await new Promise((r) => setImmediate(r));

        const mailArg = mockNodemailerSendMail.mock.calls[0][0];
        expect(mailArg.html).toContain('op-Z');
        expect(mailArg.html).toContain('uploadPayments');
        expect(mailArg.html).toContain('capstone');
        expect(mailArg.html).toContain('14m');
    });

    test('listener swallows nodemailer errors and logs warn', async () => {
        mockNodemailerSendMail.mockReset().mockRejectedValue(new Error('SMTP down'));

        CronScheduler.initScheduler();

        // Emit; listener must not throw despite nodemailer failure.
        expect(() => {
            mockOpManager.emit('lock:timeout', {
                operationType: 'background-cycle',
                operationId: 'op-fail',
                startedAt: '2026-04-28T18:00:00.000Z',
                stepProgress: [],
                durationMs: 60000,
            });
        }).not.toThrow();
        await new Promise((r) => setImmediate(r));

        // logGenerator should have a 'warn' call mentioning the email failure.
        const warnCalls = mockLogGenerator.mock.calls.filter((c) => c[1] === 'warn');
        const failureLog = warnCalls.find((c) => /Failed.*timeout/i.test(c[2]) || /Failed to send/i.test(c[2]));
        expect(failureLog).toBeDefined();
    });

    test('listener logs warn with [TIMEOUT] prefix', async () => {
        CronScheduler.initScheduler();

        mockOpManager.emit('lock:timeout', {
            operationType: 'background-cycle',
            operationId: 'op-log',
            startedAt: '2026-04-28T18:00:00.000Z',
            stepProgress: [
                { step: 'downloadCFDI', tenant: 'capstone', startedAt: '2026-04-28T18:01:00.000Z', finishedAt: null, error: null },
            ],
            durationMs: 14 * 60 * 1000,
        });
        await new Promise((r) => setImmediate(r));

        const warnCall = mockLogGenerator.mock.calls.find((c) => c[0] === 'CronScheduler' && c[1] === 'warn' && /\[TIMEOUT\]/.test(c[2]));
        expect(warnCall).toBeDefined();
    });

    test('stuckOnStep and stuckOnTenant are null when stepProgress is empty', async () => {
        CronScheduler.initScheduler();

        mockOpManager.emit('lock:timeout', {
            operationType: 'background-cycle',
            operationId: 'op-empty',
            startedAt: '2026-04-28T18:00:00.000Z',
            stepProgress: [],
            durationMs: 14 * 60 * 1000,
        });
        await new Promise((r) => setImmediate(r));

        const record = mockOpManager.addHistory.mock.calls[0][0];
        expect(record.stuckOnStep).toBeNull();
        expect(record.stuckOnTenant).toBeNull();
    });

    test('stuckOnStep and stuckOnTenant are null when all entries have finishedAt', async () => {
        CronScheduler.initScheduler();

        mockOpManager.emit('lock:timeout', {
            operationType: 'background-cycle',
            operationId: 'op-closed',
            startedAt: '2026-04-28T18:00:00.000Z',
            stepProgress: [
                { step: 'downloadCFDI', tenant: 'capstone', startedAt: '2026-04-28T18:01:00.000Z', finishedAt: '2026-04-28T18:02:00.000Z', error: null },
            ],
            durationMs: 14 * 60 * 1000,
        });
        await new Promise((r) => setImmediate(r));

        const record = mockOpManager.addHistory.mock.calls[0][0];
        expect(record.stuckOnStep).toBeNull();
        expect(record.stuckOnTenant).toBeNull();
    });
});
