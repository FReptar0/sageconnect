const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

/**
 * Tests for src/services/OperationManager.js timer encapsulation (Phase 18, REC-01).
 *
 * Covers:
 * - acquireLock arms a setTimeout per-slot
 * - releaseLock cancels the timer (no fire-after-release)
 * - _fireTimeout emits 'lock:timeout' with correct payload, then auto-releases
 * - releaseLock after timer fires is idempotent (no second emit)
 * - _reset clears pending timers (no setTimeout leak across tests)
 * - clearTimeout(undefined) is safe on slots without a timer
 * - stepProgress in payload reflects entries pushed AFTER acquireLock (snapshot at fire time)
 * - durationMs in payload >= lockTimeoutMs (derived from startedAt to fire time)
 */

// Mock config.js to avoid .env validation / process.exit
jest.mock('../../src/config', () => ({
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs' },
    schedule: { lockTimeoutMs: 1000 }, // 1s — keeps tests fast
}));

// Mock LogGenerator to prevent file I/O
jest.mock('../../src/utils/LogGenerator', () => ({
    logGenerator: jest.fn(),
    getLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    })),
}));

const operationManager = require('../../src/services/OperationManager');

describe('OperationManager timer (Phase 18, REC-01)', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        operationManager._reset();
    });

    afterEach(() => {
        operationManager._reset();
        jest.useRealTimers();
    });

    test('arms a setTimeout when acquireLock creates a slot', () => {
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

        operationManager.acquireLock('background-cycle', 'op-A');

        expect(setTimeoutSpy).toHaveBeenCalled();
        // Find the call whose delay matches our mocked lockTimeoutMs (1000).
        // jest.useFakeTimers() may install other timers internally — guard against them.
        const ourCall = setTimeoutSpy.mock.calls.find((args) => args[1] === 1000);
        expect(ourCall).toBeDefined();
        expect(typeof ourCall[0]).toBe('function');

        // The slot must store the timer handle so releaseLock can cancel it.
        // Use the private locks Map directly — getRunningOperations() strips
        // timeoutHandle from its public shape (see operation-manager.test.js
        // "JSON-serializable" regression test).
        const slot = operationManager.locks.get('background-cycle');
        expect(slot).toBeDefined();
        expect(slot.timeoutHandle).toBeTruthy();

        setTimeoutSpy.mockRestore();
    });

    test('cancels the timer when releaseLock runs before timeout', () => {
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
        const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

        operationManager.acquireLock('background-cycle', 'op-B');
        const ourSetCall = setTimeoutSpy.mock.calls.findIndex((args) => args[1] === 1000);
        expect(ourSetCall).toBeGreaterThanOrEqual(0);
        const handle = setTimeoutSpy.mock.results[ourSetCall].value;

        operationManager.releaseLock('background-cycle');

        expect(clearTimeoutSpy).toHaveBeenCalledWith(handle);

        // After releaseLock, advancing past the timeout MUST NOT emit lock:timeout
        const events = [];
        operationManager.on('lock:timeout', (p) => events.push(p));
        jest.advanceTimersByTime(2000);
        expect(events).toHaveLength(0);

        setTimeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
    });

    test('emits lock:timeout with correct payload after lockTimeoutMs', () => {
        const events = [];
        operationManager.on('lock:timeout', (payload) => events.push(payload));

        operationManager.acquireLock('background-cycle', 'op-T');
        operationManager.startStep('background-cycle', 'downloadCFDI', 'capstone');
        operationManager.startStep('background-cycle', 'uploadPayments', 'capstone');
        operationManager.endStep('background-cycle', 'downloadCFDI', 'capstone');

        jest.advanceTimersByTime(1001);

        expect(events).toHaveLength(1);
        const payload = events[0];
        expect(payload).toEqual(
            expect.objectContaining({
                operationType: 'background-cycle',
                operationId: 'op-T',
                startedAt: expect.any(String),
                stepProgress: expect.any(Array),
                durationMs: expect.any(Number),
            })
        );
        expect(payload.stepProgress).toHaveLength(2);
        expect(payload.durationMs).toBeGreaterThanOrEqual(1000);
    });

    test('releases the lock automatically when the timer fires', () => {
        operationManager.acquireLock('background-cycle', 'op-T2');

        jest.advanceTimersByTime(1001);

        const running = operationManager.getRunningOperations();
        expect(running['background-cycle']).toBeUndefined();
    });

    test('releaseLock after timer fires is idempotent (no second emit)', () => {
        const events = [];
        operationManager.on('lock:timeout', (p) => events.push(p));

        operationManager.acquireLock('background-cycle', 'op-T3');
        jest.advanceTimersByTime(1001);

        // Slot already cleared by _fireTimeout — second release is a no-op.
        expect(() => operationManager.releaseLock('background-cycle')).not.toThrow();
        expect(events).toHaveLength(1);
    });

    test('_reset clears pending timers (no setTimeout leak)', () => {
        const events = [];
        operationManager.on('lock:timeout', (p) => events.push(p));

        operationManager.acquireLock('background-cycle', 'op-T4');
        operationManager._reset();

        // After _reset, the timer must NOT fire — listener is also gone.
        // Re-subscribe to be sure (removeAllListeners cleared the prior on()).
        const post = [];
        operationManager.on('lock:timeout', (p) => post.push(p));

        jest.advanceTimersByTime(2000);

        expect(events).toHaveLength(0);
        expect(post).toHaveLength(0);
    });

    test('releaseLock on slots without timeoutHandle is safe', () => {
        // Manually inject a slot with NO timeoutHandle (simulates legacy / partial slot).
        operationManager.locks.set('foo', {
            operationId: 'x',
            startedAt: '2026-01-01T00:00:00.000Z',
            stepProgress: [],
        });

        expect(() => operationManager.releaseLock('foo')).not.toThrow();
        expect(operationManager.getRunningOperations()['foo']).toBeUndefined();
    });

    test('stepProgress in payload reflects entries pushed after acquire', () => {
        const events = [];
        operationManager.on('lock:timeout', (p) => events.push(p));

        operationManager.acquireLock('background-cycle', 'op-T5');
        // Advance partway, push a new step, then go past timeout.
        jest.advanceTimersByTime(500);
        operationManager.startStep('background-cycle', 'uploadPayments', 'capstone');
        jest.advanceTimersByTime(600);

        expect(events).toHaveLength(1);
        expect(events[0].stepProgress).toHaveLength(1);
        expect(events[0].stepProgress[0].step).toBe('uploadPayments');
        expect(events[0].stepProgress[0].finishedAt).toBeNull();
    });

    test('durationMs in payload is at least lockTimeoutMs', () => {
        const events = [];
        operationManager.on('lock:timeout', (p) => events.push(p));

        operationManager.acquireLock('background-cycle', 'op-T6');
        jest.advanceTimersByTime(1001);

        expect(events).toHaveLength(1);
        expect(events[0].durationMs).toBeGreaterThanOrEqual(1000);
    });
});
