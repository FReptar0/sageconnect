const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const { EventEmitter } = require('events');

/**
 * Tests for src/background.js startChildProcess timeout cascade (Phase 19, ROOT-02).
 *
 * Covers (D-05 / D-06 / D-08 / D-13):
 * - Promise rejects with /Child process timeout after/ wording sentinel after childProcessTimeoutMs.
 * - Reject error message includes the PID for forensics.
 * - childProcess.kill() (SIGTERM) invoked on timeout.
 * - exec('taskkill /F /T /PID <pid>') invoked after 30s grace if exitCode still null.
 * - taskkill NOT invoked if process closes during grace period (exitCode set).
 * - clearTimeout(killTimer) on close prevents fire-after-resolve when child closes BEFORE timeout.
 * - hasSettled flag prevents double-settle on close-during-grace race.
 * - logGenerator emits [TIMEOUT] entry to ChildProcess log on timeout dispatch.
 *
 * Uses jest.useFakeTimers() + spawn EventEmitter mock — runs sub-second wall-clock.
 */

// ---------------------------------------------------------------------------
// Mocks (declared BEFORE any require)
// ---------------------------------------------------------------------------

// Mock src/config (S-9 pattern — evita process.exit(1) desde validate)
jest.mock('../../src/config', () => ({
    schedule: {
        cronExpression: '*/15 * * * *',
        operationDelayMs: 5000,
        lockTimeoutMs: 14 * 60 * 1000,
        childProcessTimeoutMs: 1000,    // 1s para tests rápidos con fake timers
    },
    app: {
        importRoute: 'C:\\fake\\ImportaFacturasFocaltec.exe',
        arg: 'arg',
        timezone: 'America/Mexico_City',
        company: 'TestCo',
        rfc: '',
        regimen: '',
    },
    portal: { url: 'http://test', tenants: [], httpTimeoutMs: 30000 },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', password: '', notices: [], cc: [] },
    license: { adminEmail: 'admin@test.com' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs', downloads: '/tmp/dl', providers: '/tmp/p' },
    security: { apiKey: 'test-key' },
}));

// Mock child_process — fake spawn returns an EventEmitter we control
let fakeChild;
const mockSpawn = jest.fn(() => fakeChild);
const mockExec = jest.fn();
jest.mock('child_process', () => ({
    spawn: mockSpawn,
    exec: mockExec,
}));

// Mock LogGenerator
const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

// Mock other deps that background.js requires (no necesitamos exercicarlos para startChildProcess)
jest.mock('../../src/utils/EmailSender', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
jest.mock('node-notifier', () => ({ notify: jest.fn() }));
jest.mock('../../src/utils/TimezoneHelper', () => ({ getCurrentDate: () => new Date('2026-04-29T00:00:00Z') }));

// Stubs for downstream controllers (forResponse not exercised here)
jest.mock('../../src/controller/SagePaymentController', () => ({ checkPayments: jest.fn() }));
jest.mock('../../src/controller/PortalPaymentController', () => ({ uploadPayments: jest.fn() }));
jest.mock('../../src/controller/CFDI_Downloader', () => ({ downloadCFDI: jest.fn() }));
jest.mock('../../src/controller/PortalOC_Creator', () => ({ createPurchaseOrders: jest.fn() }));
jest.mock('../../src/controller/PortalOC_Closer', () => ({ closePurchaseOrders: jest.fn() }));
jest.mock('../../src/controller/PortalOC_LifecycleManager', () => ({ processOrderChanges: jest.fn() }));
jest.mock('../../src/controller/Providers_Downloader', () => ({ buildProvidersXML: jest.fn() }));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startChildProcess timeout (Phase 19, ROOT-02)', () => {
    let startChildProcess;

    beforeEach(() => {
        jest.useFakeTimers();
        mockSpawn.mockClear();
        mockExec.mockClear();
        mockLogGenerator.mockClear();

        // fakeChild is a fresh EventEmitter per test, with stdout/stderr sub-emitters and exitCode field
        fakeChild = new EventEmitter();
        fakeChild.stdout = new EventEmitter();
        fakeChild.stderr = new EventEmitter();
        fakeChild.kill = jest.fn();
        fakeChild.pid = 9999;
        fakeChild.exitCode = null;        // simulate "still running"

        jest.isolateModules(() => {
            ({ startChildProcess } = require('../../src/background'));
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('rejects with "Child process timeout" wording sentinel after childProcessTimeoutMs', async () => {
        const promise = startChildProcess();
        promise.catch(() => {});  // suppress unhandled until we await
        jest.advanceTimersByTime(1001);
        await expect(promise).rejects.toThrow(/Child process timeout after/);
    });

    test('reject message includes the PID for forensics', async () => {
        const promise = startChildProcess();
        promise.catch(() => {});
        jest.advanceTimersByTime(1001);
        await expect(promise).rejects.toThrow(/PID was 9999/);
    });

    test('calls childProcess.kill() (SIGTERM) when timeout fires', async () => {
        const promise = startChildProcess();
        promise.catch(() => {});
        jest.advanceTimersByTime(1001);
        expect(fakeChild.kill).toHaveBeenCalled();
    });

    test('calls taskkill /F /T /PID after 30s grace period if exitCode still null', async () => {
        const promise = startChildProcess();
        promise.catch(() => {});
        jest.advanceTimersByTime(1001);    // primary timeout fires kill()
        jest.advanceTimersByTime(30001);   // grace expires
        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('taskkill /F /T /PID 9999'),
            expect.any(Function)
        );
    });

    test('does NOT call taskkill if process closes during grace period (exitCode set)', async () => {
        const promise = startChildProcess();
        promise.catch(() => {});
        jest.advanceTimersByTime(1001);
        // Simulate process closing during grace
        fakeChild.exitCode = 1;
        fakeChild.emit('close', 1);
        jest.advanceTimersByTime(30001);
        expect(mockExec).not.toHaveBeenCalled();
    });

    test('clears killTimer on close (no fire-after-resolve when child closes BEFORE timeout)', async () => {
        const promise = startChildProcess();
        // Simulate clean close BEFORE timeout
        fakeChild.exitCode = 0;
        fakeChild.emit('close', 0);
        await Promise.resolve();    // allow microtasks to drain
        await Promise.resolve();
        await expect(promise).resolves.toBe(0);

        // Now advance past timeout — kill MUST NOT fire (timer was cleared)
        jest.advanceTimersByTime(2000);
        expect(fakeChild.kill).not.toHaveBeenCalled();
    });

    test('hasSettled prevents double-settle on close-during-grace race', async () => {
        const events = [];
        const promise = startChildProcess()
            .then((v) => events.push({ type: 'resolve', v }))
            .catch((err) => events.push({ type: 'reject', err: err.message }));
        jest.advanceTimersByTime(1001);    // timeout fires reject + arms grace timer
        // Simulate clean close DURING grace period (process exited cleanly between SIGTERM and taskkill)
        fakeChild.exitCode = 0;
        fakeChild.emit('close', 0);
        await Promise.resolve();
        await Promise.resolve();
        await promise;
        // Promise must have settled exactly once (reject from timeout, since it fired first)
        const rejects = events.filter((e) => e.type === 'reject');
        const resolves = events.filter((e) => e.type === 'resolve');
        // settle wrapper guarantees exactly one of these — and given the timeout fired first, it MUST be reject
        expect(rejects.length).toBe(1);
        expect(resolves.length).toBe(0);
        expect(rejects[0].err).toMatch(/Child process timeout/);
    });

    test('logs [TIMEOUT] entry on ChildProcess log when timeout fires (D-13/D-14)', async () => {
        const promise = startChildProcess();
        promise.catch(() => {});
        jest.advanceTimersByTime(1001);
        const timeoutLog = mockLogGenerator.mock.calls.find(
            (c) => c[0] === 'ChildProcess' && /\[TIMEOUT\]/.test(c[2])
        );
        expect(timeoutLog).toBeDefined();
        expect(timeoutLog[2]).toContain('step=startChildProcess');
        expect(timeoutLog[2]).toContain('pid=9999');
        expect(timeoutLog[2]).toContain('action=SIGTERM');
    });
});
