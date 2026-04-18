const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

/**
 * Tests for src/services/OperationManager.js
 *
 * OperationManager is a singleton concurrency controller providing:
 * - Per-operation-type locks (prevents concurrent same-type execution)
 * - Global background-cycle lock (blocks ALL manual triggers)
 * - EventEmitter progress events (for SSE streaming)
 * - Bounded execution history ring buffer (max 100 entries)
 */

// Mock config.js to avoid .env validation / process.exit
jest.mock('../../src/config', () => ({
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs' },
}));

// Mock LogGenerator to prevent file I/O
jest.mock('../../src/utils/LogGenerator', () => ({
    getLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    })),
}));

const operationManager = require('../../src/services/OperationManager');

// ============================================================
// Reset singleton state between tests
// ============================================================
beforeEach(() => {
    operationManager._reset();
});

// ============================================================
// 1. Lock Acquisition
// ============================================================
describe('OperationManager - Lock Acquisition', () => {
    test('acquireLock returns true when no lock held for that operation type', () => {
        const result = operationManager.acquireLock('payment-reconciliation', 'op-1');
        expect(result).toBe(true);
    });

    test('acquireLock returns false when same operation type already locked', () => {
        operationManager.acquireLock('payment-reconciliation', 'op-1');
        const result = operationManager.acquireLock('payment-reconciliation', 'op-2');
        expect(result).toBe(false);
    });

    test('acquireLock returns true for different operation type even when another is locked', () => {
        operationManager.acquireLock('payment-reconciliation', 'op-1');
        const result = operationManager.acquireLock('po-upload', 'op-3');
        expect(result).toBe(true);
    });

    test('acquireLock returns false for any type when background-cycle lock is held', () => {
        operationManager.acquireLock('background-cycle', 'bg-1');
        const result = operationManager.acquireLock('po-upload', 'op-4');
        expect(result).toBe(false);
    });

    test('acquireLock allows background-cycle to be acquired when background-cycle is already locked', () => {
        // background-cycle should still fail if already held (same type)
        operationManager.acquireLock('background-cycle', 'bg-1');
        const result = operationManager.acquireLock('background-cycle', 'bg-2');
        expect(result).toBe(false);
    });
});

// ============================================================
// 2. Lock Release
// ============================================================
describe('OperationManager - Lock Release', () => {
    test('releaseLock frees the lock so subsequent acquireLock returns true', () => {
        operationManager.acquireLock('payment-reconciliation', 'op-1');
        operationManager.releaseLock('payment-reconciliation');
        const result = operationManager.acquireLock('payment-reconciliation', 'op-5');
        expect(result).toBe(true);
    });

    test('releaseLock for background-cycle unblocks other operation types', () => {
        operationManager.acquireLock('background-cycle', 'bg-1');
        operationManager.releaseLock('background-cycle');
        const result = operationManager.acquireLock('po-upload', 'op-6');
        expect(result).toBe(true);
    });
});

// ============================================================
// 3. isLocked
// ============================================================
describe('OperationManager - isLocked', () => {
    test('isLocked returns true when operation type is locked', () => {
        operationManager.acquireLock('payment-reconciliation', 'op-1');
        expect(operationManager.isLocked('payment-reconciliation')).toBe(true);
    });

    test('isLocked returns true for any type when background-cycle is locked', () => {
        operationManager.acquireLock('background-cycle', 'bg-1');
        expect(operationManager.isLocked('po-upload')).toBe(true);
    });

    test('isLocked returns false when no locks held', () => {
        expect(operationManager.isLocked('payment-reconciliation')).toBe(false);
    });
});

// ============================================================
// 4. getRunningOperations
// ============================================================
describe('OperationManager - getRunningOperations', () => {
    test('getRunningOperations returns object with currently locked operation types', () => {
        operationManager.acquireLock('payment-reconciliation', 'op-1');
        operationManager.acquireLock('po-upload', 'op-2');

        const running = operationManager.getRunningOperations();
        expect(running).toHaveProperty('payment-reconciliation');
        expect(running['payment-reconciliation']).toHaveProperty('operationId', 'op-1');
        expect(running['payment-reconciliation']).toHaveProperty('startedAt');
        expect(running).toHaveProperty('po-upload');
        expect(running['po-upload']).toHaveProperty('operationId', 'op-2');
    });

    test('getRunningOperations returns empty object when no locks', () => {
        const running = operationManager.getRunningOperations();
        expect(running).toEqual({});
    });
});

// ============================================================
// 5. Progress Events (EventEmitter)
// ============================================================
describe('OperationManager - Progress Events', () => {
    test('emitProgress emits event on progress:{operationId} channel', (done) => {
        const event = {
            type: 'progress',
            operation: 'bg',
            tenant: 'T1',
            step: 'buildProviders',
            message: 'test',
            timestamp: new Date().toISOString(),
        };

        operationManager.on('progress:op-1', (received) => {
            expect(received).toEqual(event);
            done();
        });

        operationManager.emitProgress('op-1', event);
    });

    test('subscriber receives emitted progress event with correct shape', (done) => {
        const event = {
            type: 'progress',
            operation: 'payment-reconciliation',
            tenant: 'T2',
            step: 'reconcile',
            message: 'Processing batch 1',
            timestamp: '2026-03-24T00:00:00Z',
        };

        operationManager.on('progress:op-99', (received) => {
            expect(received).toHaveProperty('type', 'progress');
            expect(received).toHaveProperty('operation', 'payment-reconciliation');
            expect(received).toHaveProperty('tenant', 'T2');
            expect(received).toHaveProperty('step', 'reconcile');
            expect(received).toHaveProperty('message');
            expect(received).toHaveProperty('timestamp');
            done();
        });

        operationManager.emitProgress('op-99', event);
    });
});

// ============================================================
// 6. Execution History (Ring Buffer)
// ============================================================
describe('OperationManager - Execution History', () => {
    test('addHistory pushes record to history', () => {
        operationManager.addHistory({
            taskId: 't-1',
            operationId: 'op-1',
            startedAt: '2026-03-24T00:00:00Z',
            finishedAt: '2026-03-24T00:01:00Z',
            success: true,
            errors: [],
            summary: 'OK',
        });

        const history = operationManager.getHistory();
        expect(history).toHaveLength(1);
        expect(history[0]).toHaveProperty('taskId', 't-1');
    });

    test('getHistory returns all entries', () => {
        for (let i = 0; i < 5; i++) {
            operationManager.addHistory({
                taskId: `t-${i}`,
                operationId: `op-${i}`,
                startedAt: new Date(Date.now() - (5 - i) * 60000).toISOString(),
                finishedAt: new Date(Date.now() - (5 - i) * 60000 + 30000).toISOString(),
                success: true,
                errors: [],
                summary: `Task ${i}`,
            });
        }

        const history = operationManager.getHistory();
        expect(history).toHaveLength(5);
    });

    test('ring buffer evicts oldest entry after 101 pushes (max 100)', () => {
        for (let i = 0; i < 101; i++) {
            operationManager.addHistory({
                taskId: `t-${i}`,
                operationId: `op-${i}`,
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                success: true,
                errors: [],
                summary: `Task ${i}`,
            });
        }

        const history = operationManager.getHistory();
        expect(history).toHaveLength(100);
        // Oldest entry (t-0) should be evicted
        expect(history[0].taskId).toBe('t-1');
        // Newest entry should be the last one
        expect(history[history.length - 1].taskId).toBe('t-100');
    });

    test('getHistory(1) returns only entries from last 1 hour', () => {
        // Add one entry from 2 hours ago
        operationManager.addHistory({
            taskId: 't-old',
            operationId: 'op-old',
            startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            finishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000 + 30000).toISOString(),
            success: true,
            errors: [],
            summary: 'Old task',
        });

        // Add one entry from 30 minutes ago
        operationManager.addHistory({
            taskId: 't-recent',
            operationId: 'op-recent',
            startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            finishedAt: new Date(Date.now() - 30 * 60 * 1000 + 30000).toISOString(),
            success: true,
            errors: [],
            summary: 'Recent task',
        });

        const history = operationManager.getHistory(1);
        expect(history).toHaveLength(1);
        expect(history[0].taskId).toBe('t-recent');
    });
});

// ============================================================
// 7. Config Schedule Section
// ============================================================
// These tests use a separate describe block with jest.resetModules
// to load the REAL config.js (not the mocked version above).
describe('Config - Schedule Section', () => {
    let originalEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        setRequiredEnv();
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.restoreAllMocks();
    });

    function setRequiredEnv() {
        Object.assign(process.env, {
            DB_USER: 'test', DB_PASSWORD: 'test', SERVER: 'localhost', DATABASE: 'TEST',
            URL: 'https://test.com', TENANT_ID: 't1', API_KEY: 'k1', API_SECRET: 's1',
            DATABASES: 'DB1', EXTERNAL_IDS: 'EXT1',
            DOWNLOADS_PATH: '/tmp', PROVIDERS_PATH: '/tmp', LOG_PATH: '/tmp',
            IMPORT_CFDIS_ROUTE: '/route', ARG: 'TEST', NOMBRE: 'Test', RFC: 'RFC123',
            REGIMEN: '601', TIMEZONE: 'America/Mexico_City',
            DEFAULT_ADDRESS_CITY: 'City', DEFAULT_ADDRESS_COUNTRY: 'MX',
            DEFAULT_ADDRESS_IDENTIFIER: 'ID', DEFAULT_ADDRESS_MUNICIPALITY: 'Mun',
            DEFAULT_ADDRESS_STATE: 'State', DEFAULT_ADDRESS_STREET: 'Street',
            DEFAULT_ADDRESS_ZIP: '12345', ADDRESS_IDENTIFIERS_SKIP: 'A,B',
        });
    }

    function loadRealConfig() {
        let config;
        jest.isolateModules(() => {
            // Override the top-level mock for this isolated load
            jest.mock('dotenv', () => ({ config: jest.fn() }));
            // Unmock config so we get the real module
            jest.unmock('../../src/config');
            config = require('../../src/config');
        });
        return config;
    }

    test('config.schedule.cronExpression defaults to "*/15 * * * *" when CRON_SCHEDULE not set', () => {
        delete process.env.CRON_SCHEDULE;
        const config = loadRealConfig();
        expect(config.schedule).toBeDefined();
        expect(config.schedule.cronExpression).toBe('*/15 * * * *');
    });

    test('config.schedule.operationDelayMs defaults to 5000 when OPERATION_DELAY_MS not set', () => {
        delete process.env.OPERATION_DELAY_MS;
        const config = loadRealConfig();
        expect(config.schedule.operationDelayMs).toBe(5000);
    });

    test('config.schedule.operationDelayMs parses string env var to integer', () => {
        process.env.OPERATION_DELAY_MS = '10000';
        const config = loadRealConfig();
        expect(config.schedule.operationDelayMs).toBe(10000);
        expect(typeof config.schedule.operationDelayMs).toBe('number');
    });

    test('config.schedule.cronExpression reads from CRON_SCHEDULE env var', () => {
        process.env.CRON_SCHEDULE = '0 * * * *';
        const config = loadRealConfig();
        expect(config.schedule.cronExpression).toBe('0 * * * *');
    });
});
