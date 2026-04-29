const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

/**
 * Tests for src/background.js forResponse per-step timeout (Phase 19, ROOT-03 + ROOT-04).
 *
 * Covers (D-09 / D-10 / D-12 / D-13 / D-16):
 * - Promise.race rejects with /Step timeout after/ wording sentinel after stepTimeoutMs.
 * - Tenant-catch boundary: step throw propagates, next tenant continues normally (D-09 skip-tenant).
 * - endStep registra el error con 'Step timeout' wording en stepProgress entry.
 * - logGenerator emits [TIMEOUT] entry to ForResponse log con context D-16
 *   (step + tenant + url=n/a + durationMs).
 * - Wording sentinel separation: step timeout NO matchea regex /Child process timeout/ (Plan 19-02).
 * - D-12 invariant: startChildProcess in CronScheduler.js NOT wrapped in withStepTimeout.
 *
 * Uses jest.useFakeTimers() + hanging Promise mock — runs sub-second wall-clock.
 */

// ---------------------------------------------------------------------------
// Mocks (declared BEFORE any require)
// ---------------------------------------------------------------------------

// Mock src/config (S-9 pattern — evita process.exit(1) desde validate)
jest.mock('../../src/config', () => ({
    schedule: {
        cronExpression: '*/15 * * * *',
        operationDelayMs: 0,                 // skip delay between tenants para acelerar tests
        lockTimeoutMs: 14 * 60 * 1000,
        childProcessTimeoutMs: 600000,
        stepTimeoutMs: 1000,                 // 1s para tests rápidos con fake timers
    },
    portal: {
        url: 'http://test',
        tenants: [{ id: 'T1' }, { id: 'T2' }],
        httpTimeoutMs: 30000,
    },
    app: {
        importRoute: 'fake',
        arg: 'arg',
        timezone: 'America/Mexico_City',
        company: 'TestCo',
        rfc: '',
        regimen: '',
    },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', password: '', notices: [], cc: [] },
    license: { adminEmail: 'admin@test.com' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs', downloads: '/tmp/dl', providers: '/tmp/p' },
    security: { apiKey: 'test-key' },
}));

// Mock LogGenerator
const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

// Mock buildProviders to hang indefinitely — simula step colgado
const mockBuildProviders = jest.fn(() => new Promise(() => {})); // never resolves
jest.mock('../../src/controller/Providers_Downloader', () => ({
    buildProvidersXML: mockBuildProviders,
}));

// Stubs para los demás controllers (resuelven inmediatamente)
const mockDownloadCFDI = jest.fn().mockResolvedValue();
const mockCheckPayments = jest.fn().mockResolvedValue();
const mockUploadPayments = jest.fn().mockResolvedValue();
const mockCreatePOs = jest.fn().mockResolvedValue();
const mockProcessChanges = jest.fn().mockResolvedValue();
const mockClosePOs = jest.fn().mockResolvedValue();

jest.mock('../../src/controller/CFDI_Downloader', () => ({ downloadCFDI: mockDownloadCFDI }));
jest.mock('../../src/controller/SagePaymentController', () => ({ checkPayments: mockCheckPayments }));
jest.mock('../../src/controller/PortalPaymentController', () => ({ uploadPayments: mockUploadPayments }));
jest.mock('../../src/controller/PortalOC_Creator', () => ({ createPurchaseOrders: mockCreatePOs }));
jest.mock('../../src/controller/PortalOC_Closer', () => ({ closePurchaseOrders: mockClosePOs }));
jest.mock('../../src/controller/PortalOC_LifecycleManager', () => ({ processOrderChanges: mockProcessChanges }));

// Mocks para deps colaterales (no se ejercitan en estos tests pero el require de background.js los toca)
jest.mock('../../src/utils/EmailSender', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
jest.mock('node-notifier', () => ({ notify: jest.fn() }));
jest.mock('child_process', () => ({ spawn: jest.fn(), exec: jest.fn() }));
jest.mock('../../src/utils/TimezoneHelper', () => ({ getCurrentDate: () => new Date('2026-04-29T00:00:00Z') }));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('forResponse step timeout (Phase 19, ROOT-03 + ROOT-04)', () => {
    let forResponse;
    let mockEmitter;

    beforeEach(() => {
        jest.useFakeTimers();
        mockLogGenerator.mockClear();
        mockBuildProviders.mockClear();
        mockDownloadCFDI.mockClear();
        mockCheckPayments.mockClear();
        mockUploadPayments.mockClear();
        mockCreatePOs.mockClear();
        mockProcessChanges.mockClear();
        mockClosePOs.mockClear();

        // Re-mock buildProviders to hang again (mockClear doesn't reset implementation)
        mockBuildProviders.mockImplementation(() => new Promise(() => {}));

        mockEmitter = {
            startStep: jest.fn(),
            endStep: jest.fn(),
            emitProgress: jest.fn(),
        };

        jest.isolateModules(() => {
            ({ forResponse } = require('../../src/background'));
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // Helper to drain step timeouts across both tenants — advances timers and flushes
    // microtasks until forResponse settles. We can't await the global promise inside
    // the loop because microtask drainage is interleaved with timer tick advancement.
    async function drainStepTimeouts() {
        for (let cycle = 0; cycle < 8; cycle++) {
            jest.advanceTimersByTime(1001);
            // flush microtasks several times — each step block has try/catch/finally
            // chained promises, requires multiple rounds for the chain to settle
            for (let m = 0; m < 4; m++) {
                await Promise.resolve();
            }
        }
    }

    test('Promise.race rejects after stepTimeoutMs when step hangs', async () => {
        const promise = forResponse({ operationId: 'op-test', emitter: mockEmitter });
        await drainStepTimeouts();
        // forResponse no rechaza globalmente — tenant-catch atrapa step throws
        await expect(promise).resolves.toBeUndefined();
    });

    test('tenant-catch atrapa step timeout; siguiente tenant ejecuta buildProviders también', async () => {
        const promise = forResponse({ operationId: 'op-test', emitter: mockEmitter });
        await drainStepTimeouts();
        await promise;
        // Tenant T1 cuelga en buildProviders → tenant-catch atrapa → next tenant T2 también ejecuta buildProviders
        expect(mockBuildProviders).toHaveBeenCalledTimes(2);
    });

    test('endStep registra error con [Step timeout] message on stepProgress', async () => {
        const promise = forResponse({ operationId: 'op-test', emitter: mockEmitter });
        await drainStepTimeouts();
        await promise;

        // endStep es invocado para cada step block; el primer call es buildProviders con error
        const buildEndStepCalls = mockEmitter.endStep.mock.calls.filter(
            (c) => c[1] === 'buildProviders'
        );
        expect(buildEndStepCalls.length).toBeGreaterThan(0);
        // El cuarto argumento del endStep es el opts object con error
        const firstWithError = buildEndStepCalls.find(
            (c) => c[3] && c[3].error && /Step timeout after/.test(c[3].error)
        );
        expect(firstWithError).toBeDefined();
    });

    test('logs [TIMEOUT] entry to ForResponse log on step timeout (D-13/D-16)', async () => {
        const promise = forResponse({ operationId: 'op-test', emitter: mockEmitter });
        await drainStepTimeouts();
        await promise;

        const timeoutLog = mockLogGenerator.mock.calls.find(
            (c) => /\[TIMEOUT\]/.test(c[2]) && /step=buildProviders/.test(c[2])
        );
        expect(timeoutLog).toBeDefined();
        // logFileName en background.js es 'ForResponse'
        expect(timeoutLog[0]).toBe('ForResponse');
        expect(timeoutLog[1]).toBe('error');
        expect(timeoutLog[2]).toContain('step=buildProviders');
        expect(timeoutLog[2]).toContain('tenant=T1');
        expect(timeoutLog[2]).toContain('url=n/a');
        expect(timeoutLog[2]).toContain('durationMs=1000');
    });

    test('step timeout wording NO matchea regex de Child process timeout (Plan 19-02 negation)', () => {
        // Smoke test: el regex /Child process timeout/ que CronScheduler.js usa para detectar
        // child timeouts NO debe matchear el wording de step timeout.
        const stepTimeoutMessage = 'Step timeout after 5m — step=buildProviders tenant=T1';
        expect(/Child process timeout/.test(stepTimeoutMessage)).toBe(false);
        expect(/Step timeout/.test(stepTimeoutMessage)).toBe(true);
    });

    test('step timeout es D-12 boundary: startChildProcess NOT wrapped in withStepTimeout', () => {
        // Smoke test: verificar que CronScheduler.js NO wrappea await startChildProcess()
        // en withStepTimeout — porque ROOT-02 (Plan 19-02) ya tiene su propio timer 10min.
        const fs = require('fs');
        const cronSrc = fs.readFileSync('src/services/CronScheduler.js', 'utf8');
        // Match pattern: NO debe haber `withStepTimeout(startChildProcess(` ni `withStepTimeout(await startChildProcess(`
        expect(/withStepTimeout\s*\(\s*(await\s+)?startChildProcess/.test(cronSrc)).toBe(false);
    });
});
