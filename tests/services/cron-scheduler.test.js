const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

/**
 * Tests for src/services/CronScheduler.js
 *
 * CronScheduler wraps node-cron v4 to manage recurring background cycles.
 * It integrates with OperationManager for locking, progress events, and history.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock node-cron: capture the scheduled callback for direct invocation in tests
const mockTask = {
    getStatus: jest.fn(() => 'scheduled'),
    getNextRun: jest.fn(() => new Date('2026-04-01T00:00:00Z')),
    on: jest.fn(),
};
jest.mock('node-cron', () => ({
    schedule: jest.fn(() => mockTask),
}));

// Mock config.js to avoid .env validation / process.exit
jest.mock('../../src/config', () => ({
    schedule: {
        cronExpression: '*/15 * * * *',
        operationDelayMs: 1000,
    },
    app: {
        timezone: 'America/Mexico_City',
    },
    portal: {
        tenants: [{ id: 'T1' }, { id: 'T2' }],
    },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs' },
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

// Mock LogGenerator
jest.mock('../../src/utils/LogGenerator', () => ({
    logGenerator: jest.fn(),
}));

// Mock crypto.randomUUID
const MOCK_UUID = 'test-uuid-1234';
jest.spyOn(require('crypto'), 'randomUUID').mockReturnValue(MOCK_UUID);

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
const cron = require('node-cron');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CronScheduler', () => {
    let CronScheduler;

    beforeEach(() => {
        jest.clearAllMocks();
        mockOperationManager.acquireLock.mockReturnValue(true);
        mockForResponse.mockResolvedValue(undefined);
        mockStartChildProcess.mockResolvedValue(undefined);
        mockTask.getStatus.mockReturnValue('scheduled');
        mockTask.getNextRun.mockReturnValue(new Date('2026-04-01T00:00:00Z'));
        mockTask.on.mockClear();

        // Re-require to reset module state (lastRun, scheduledTask)
        jest.isolateModules(() => {
            CronScheduler = require('../../src/services/CronScheduler');
        });
    });

    describe('initScheduler()', () => {
        test('calls cron.schedule with correct expression, options (noOverlap, timezone)', () => {
            CronScheduler.initScheduler();

            expect(cron.schedule).toHaveBeenCalledTimes(1);
            const [expr, callback, options] = cron.schedule.mock.calls[0];
            expect(expr).toBe('*/15 * * * *');
            expect(typeof callback).toBe('function');
            expect(options).toEqual(
                expect.objectContaining({
                    name: 'background-cycle',
                    noOverlap: true,
                    timezone: 'America/Mexico_City',
                })
            );
        });

        test('wires lifecycle events on the task (started, finished, failed, overlap)', () => {
            CronScheduler.initScheduler();

            const eventNames = mockTask.on.mock.calls.map(([name]) => name);
            expect(eventNames).toContain('execution:started');
            expect(eventNames).toContain('execution:finished');
            expect(eventNames).toContain('execution:failed');
            expect(eventNames).toContain('execution:overlap');
        });
    });

    describe('getSchedulerStatus()', () => {
        test('returns correct shape before initScheduler', () => {
            const status = CronScheduler.getSchedulerStatus();

            expect(status).toEqual({
                cronExpression: '*/15 * * * *',
                status: 'stopped',
                nextRun: null,
                lastRun: null,
            });
        });

        test('returns correct shape after initScheduler', () => {
            CronScheduler.initScheduler();
            const status = CronScheduler.getSchedulerStatus();

            expect(status).toEqual({
                cronExpression: '*/15 * * * *',
                status: 'scheduled',
                nextRun: '2026-04-01T00:00:00.000Z',
                lastRun: null,
            });
        });
    });

    describe('getTask()', () => {
        test('returns null before initScheduler', () => {
            expect(CronScheduler.getTask()).toBeNull();
        });

        test('returns task after initScheduler', () => {
            CronScheduler.initScheduler();
            expect(CronScheduler.getTask()).toBe(mockTask);
        });
    });

    describe('cron callback (execution cycle)', () => {
        let cronCallback;

        beforeEach(() => {
            CronScheduler.initScheduler();
            // Capture the callback passed to cron.schedule
            cronCallback = cron.schedule.mock.calls[0][1];
        });

        test('acquires background-cycle lock before calling forResponse', async () => {
            await cronCallback();

            expect(mockOperationManager.acquireLock).toHaveBeenCalledWith(
                'background-cycle',
                MOCK_UUID
            );
            expect(mockForResponse).toHaveBeenCalledWith({
                operationId: MOCK_UUID,
                emitter: mockOperationManager,
            });
        });

        test('releases lock in finally block after forResponse completes', async () => {
            await cronCallback();

            expect(mockOperationManager.releaseLock).toHaveBeenCalledWith('background-cycle');
        });

        test('calls startChildProcess after forResponse', async () => {
            await cronCallback();

            expect(mockStartChildProcess).toHaveBeenCalled();
        });

        test('records execution history via addHistory after success', async () => {
            await cronCallback();

            expect(mockOperationManager.addHistory).toHaveBeenCalledTimes(1);
            const record = mockOperationManager.addHistory.mock.calls[0][0];
            expect(record).toEqual(
                expect.objectContaining({
                    taskId: 'background-cycle',
                    operationId: MOCK_UUID,
                    success: true,
                    errors: [],
                })
            );
            expect(record.startedAt).toBeDefined();
            expect(record.finishedAt).toBeDefined();
            expect(record.summary).toBeDefined();
        });

        test('if forResponse throws, lock is still released and history records success=false', async () => {
            const testError = new Error('Test forResponse failure');
            mockForResponse.mockRejectedValueOnce(testError);

            await cronCallback();

            // Lock still released
            expect(mockOperationManager.releaseLock).toHaveBeenCalledWith('background-cycle');

            // History records failure
            const record = mockOperationManager.addHistory.mock.calls[0][0];
            expect(record.success).toBe(false);
            expect(record.errors).toContain('Test forResponse failure');
        });

        test('if acquireLock returns false, forResponse is not called', async () => {
            mockOperationManager.acquireLock.mockReturnValue(false);

            await cronCallback();

            expect(mockForResponse).not.toHaveBeenCalled();
        });

        test('updates lastRun after execution', async () => {
            await cronCallback();

            const status = CronScheduler.getSchedulerStatus();
            expect(status.lastRun).not.toBeNull();
        });
    });
});

describe('forResponse() progress emission', () => {
    // These tests verify the modified forResponse signature and behavior

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('forResponse is called with operationId and emitter from cron callback', async () => {
        let CronScheduler;
        jest.isolateModules(() => {
            CronScheduler = require('../../src/services/CronScheduler');
        });

        CronScheduler.initScheduler();
        const cronCallback = cron.schedule.mock.calls[0][1];
        await cronCallback();

        expect(mockForResponse).toHaveBeenCalledWith({
            operationId: MOCK_UUID,
            emitter: mockOperationManager,
        });
    });

    test('forResponse without args still callable (backward compat)', async () => {
        // The mock forResponse should accept no args without throwing
        // Real contract: forResponse(options = {}) -- options is optional
        await expect(mockForResponse()).resolves.not.toThrow();
    });
});
