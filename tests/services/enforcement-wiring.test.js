const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

/**
 * Tests for enforcement wiring:
 * - index.js startup license validation gate
 * - CronScheduler license guard (skip cycle when license invalid)
 *
 * Split into two separate test files conceptually but combined here for plan cohesion.
 * The cron tests do NOT mock CronScheduler -- they require the real module.
 * The index.js tests DO mock CronScheduler since they only test the startup flow.
 */

// ---------------------------------------------------------------------------
// Common Mocks (must be before imports)
// ---------------------------------------------------------------------------

// Mock LicenseValidator
const mockValidate = jest.fn();
const mockIsValid = jest.fn();
jest.mock('../../src/services/LicenseValidator', () => ({
    validate: mockValidate,
    isValid: mockIsValid,
    getStatus: jest.fn(),
    _reset: jest.fn(),
}));

// Mock config.js to avoid .env validation / process.exit
jest.mock('../../src/config', () => ({
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 1000 },
    app: { timezone: 'America/Mexico_City' },
    portal: { tenants: [{ id: 'T1' }] },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs' },
    security: { apiKey: 'test-key' },
    license: { apiUrl: 'https://license.test.com', hmacSecret: 'test-secret', adminEmail: 'admin@test.com' },
    mailing: { server: 'smtp.test.com', port: 587, ssl: false, from: 'test@test.com', password: 'testpass' },
}));

// Mock LogGenerator
jest.mock('../../src/utils/LogGenerator', () => ({
    logGenerator: jest.fn(),
}));

// Mock OperationManager
const mockOperationManager = {
    acquireLock: jest.fn(() => true),
    releaseLock: jest.fn(),
    addHistory: jest.fn(),
    emitProgress: jest.fn(),
};
jest.mock('../../src/services/OperationManager', () => mockOperationManager);

// Mock background.js
const mockForResponse = jest.fn().mockResolvedValue(undefined);
const mockStartChildProcess = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/background', () => ({
    forResponse: mockForResponse,
    startChildProcess: mockStartChildProcess,
}));

// Mock node-cron: capture the callback passed to cron.schedule via closure variable
var _capturedCb = null;
const mockCronTask = {
    getStatus: jest.fn(() => 'scheduled'),
    getNextRun: jest.fn(() => new Date('2026-04-01T00:00:00Z')),
    on: jest.fn(),
};
jest.mock('node-cron', () => {
    var _mod = {
        schedule: jest.fn(function (expr, cb, opts) {
            _capturedCb = cb;
            return mockCronTask;
        }),
    };
    return _mod;
});

// Mock server.js
const mockStartServer = jest.fn();
jest.mock('../../src/server', () => ({ startServer: mockStartServer }));

// Mock CronScheduler for index.js tests
const mockInitScheduler = jest.fn();
jest.mock('../../src/services/CronScheduler', () => ({ initScheduler: mockInitScheduler }));

// Mock crypto.randomUUID
const MOCK_UUID = 'test-uuid-enforcement';
jest.spyOn(require('crypto'), 'randomUUID').mockReturnValue(MOCK_UUID);

// ============================================================
// 1. index.js Startup Validation Gate
// ============================================================
describe('index.js startup license validation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(require('crypto'), 'randomUUID').mockReturnValue(MOCK_UUID);
    });

    test('calls validate({ startup: true }) before startServer and initScheduler', async () => {
        var callOrder = [];
        mockValidate.mockImplementation(async () => {
            callOrder.push('validate');
            return { valid: true, expiresAt: '2099-12-31T00:00:00.000Z', error: null, state: 'VALID' };
        });
        mockStartServer.mockImplementation(() => { callOrder.push('startServer'); });
        mockInitScheduler.mockImplementation(() => { callOrder.push('initScheduler'); });

        await jest.isolateModulesAsync(async () => {
            require('../../src/index');
            // Allow async IIFE to settle
            await new Promise((resolve) => setImmediate(resolve));
        });

        expect(mockValidate).toHaveBeenCalledWith({ startup: true });
        expect(callOrder.indexOf('validate')).toBeLessThan(callOrder.indexOf('startServer'));
        expect(callOrder.indexOf('validate')).toBeLessThan(callOrder.indexOf('initScheduler'));
    });

    test('does NOT call startServer or initScheduler if validate returns { valid: false }', async () => {
        mockValidate.mockResolvedValue({ valid: false, expiresAt: null, error: 'inactive', state: 'INVALID' });

        // Mock process.exit to prevent test from exiting
        var mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

        await jest.isolateModulesAsync(async () => {
            require('../../src/index');
            await new Promise((resolve) => setImmediate(resolve));
        });

        expect(mockStartServer).not.toHaveBeenCalled();
        expect(mockInitScheduler).not.toHaveBeenCalled();

        mockExit.mockRestore();
    });
});

// ============================================================
// 2. CronScheduler License Guard
// ============================================================
describe('CronScheduler license guard', () => {
    var cronCallback;

    beforeEach(() => {
        jest.clearAllMocks();
        _capturedCb = null;
        mockOperationManager.acquireLock.mockReturnValue(true);
        mockForResponse.mockResolvedValue(undefined);
        mockStartChildProcess.mockResolvedValue(undefined);
        jest.spyOn(require('crypto'), 'randomUUID').mockReturnValue(MOCK_UUID);

        // Require the REAL CronScheduler (bypass the mock) and init it
        // The real CronScheduler calls cron.schedule (which IS mocked),
        // so we capture the callback via _capturedCb.
        var realCronScheduler = jest.requireActual('../../src/services/CronScheduler');
        realCronScheduler.initScheduler();

        cronCallback = _capturedCb;
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(require('crypto'), 'randomUUID').mockReturnValue(MOCK_UUID);
    });

    test('skips forResponse/startChildProcess when isValid() returns false after lock acquisition', async () => {
        mockIsValid.mockReturnValue(false);

        await cronCallback();

        expect(mockForResponse).not.toHaveBeenCalled();
        expect(mockStartChildProcess).not.toHaveBeenCalled();
    });

    test('records history entry with summary "Ciclo omitido: licencia inactiva" when skipping', async () => {
        mockIsValid.mockReturnValue(false);

        await cronCallback();

        expect(mockOperationManager.addHistory).toHaveBeenCalledTimes(1);
        var record = mockOperationManager.addHistory.mock.calls[0][0];
        expect(record.success).toBe(false);
        expect(record.summary).toBe('Ciclo omitido: licencia inactiva');
    });

    test('logs "Ciclo omitido: licencia inactiva" when skipping', async () => {
        mockIsValid.mockReturnValue(false);

        var consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        await cronCallback();

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Ciclo omitido: licencia inactiva')
        );

        consoleSpy.mockRestore();
    });

    test('proceeds normally when isValid() returns true', async () => {
        mockIsValid.mockReturnValue(true);

        await cronCallback();

        expect(mockForResponse).toHaveBeenCalled();
        expect(mockStartChildProcess).toHaveBeenCalled();
    });

    test('releases lock even when skipping due to invalid license', async () => {
        mockIsValid.mockReturnValue(false);

        await cronCallback();

        expect(mockOperationManager.releaseLock).toHaveBeenCalledWith('background-cycle');
    });
});
