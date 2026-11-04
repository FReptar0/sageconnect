// tests/integration/daily-summary-dispatch.test.js (NUEVO — Fase 20.7, plan 20.7-09)
//
// forResponse con el bloque del resumen diario (D-03, D-10, D-40; RD-01 y RD-03). Corre el
// forResponse real con el despacho real: DailySummaryService, DailySummary, PaymentDayLedger y
// EomNotification no se simulan, así que el estado del día y el registro de pagos se escriben y se
// leen de verdad en una carpeta temporal de os.tmpdir().
//
// Dobles, calcados de tests/services/background.forResponse.stepTimeout.test.js y de
// tests/integration/payment-report-dispatch.test.js:
// - los siete pasos de empresa resuelven de inmediato;
// - runQuery devuelve datos válidos del día, según la marca de cada consulta del resumen;
// - el correo del operador falla por VALOR DE RETORNO, nunca rechazando (D-38);
// - el reloj de la ejecución es mutable y vive fuera de la fábrica de su doble, porque cada caso
//   carga un forResponse nuevo y la fábrica vuelve a correr en cada carga.
//
// Temporizadores falsos. Los casos que esperan que el despacho termine avanzan el reloj en pasos
// de 10 ms con advanceTimersByTimeAsync, muy por debajo de su stepTimeoutMs de 60 000 ms, así que
// ningún paso vence. La receta de avances de 1001 ms de la suite de origen se usa solo en el caso
// de tiempo agotado.

const mockLogGenerator = jest.fn();
const mockRunQuery = jest.fn();
const mockSendOperatorReport = jest.fn();
const mockSendMail = jest.fn();
const mockSendAdminAlert = jest.fn();
const mockBuildProviders = jest.fn();
const mockDownloadCFDI = jest.fn();
const mockCheckPayments = jest.fn();
const mockUploadPayments = jest.fn();
const mockCreatePOs = jest.fn();
const mockProcessChanges = jest.fn();
const mockClosePOs = jest.fn();
const mockClock = { now: null };
const mockGetCurrentDate = jest.fn(() => mockClock.now);

jest.mock('../../src/config', () => mockConfig);
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));
jest.mock('../../src/utils/EmailSender', () => ({
    sendMail: mockSendMail,
    sendOperatorReport: mockSendOperatorReport,
}));
// Se simula para poder afirmar que el resumen nunca usa el buzón de administración.
jest.mock('../../src/utils/AdminEmailSender', () => ({
    sendAdminAlert: mockSendAdminAlert,
    findLastOpenStep: jest.fn(),
}));
jest.mock('../../src/controller/Providers_Downloader', () => ({ buildProvidersXML: mockBuildProviders }));
jest.mock('../../src/controller/CFDI_Downloader', () => ({ downloadCFDI: mockDownloadCFDI }));
jest.mock('../../src/controller/SagePaymentController', () => ({ checkPayments: mockCheckPayments }));
jest.mock('../../src/controller/PortalPaymentController', () => ({ uploadPayments: mockUploadPayments }));
jest.mock('../../src/controller/PortalOC_Creator', () => ({ createPurchaseOrders: mockCreatePOs }));
jest.mock('../../src/controller/PortalOC_Closer', () => ({ closePurchaseOrders: mockClosePOs }));
jest.mock('../../src/controller/PortalOC_LifecycleManager', () => ({ processOrderChanges: mockProcessChanges }));
jest.mock('node-notifier', () => ({ notify: jest.fn() }));
jest.mock('child_process', () => ({ spawn: jest.fn(), exec: jest.fn() }));
jest.mock('../../src/utils/TimezoneHelper', () => ({ getCurrentDate: mockGetCurrentDate }));

const fs = require('fs');
const path = require('path');
const os = require('os');
const { describe, test, expect, beforeEach, afterEach, afterAll } = require('@jest/globals');

const DAY = '2026-11-03';
const ECONNREFUSED = 'connect ECONNREFUSED 127.0.0.1:25';
const SUMMARY_ON = { enabled: true, hour: 23, minute: 45 };
const TENANT_IDS = ['T1', 'T2'];
const TENANT_DBS = ['COPDAT', 'EMPRESA2'];

const tmpRoot = path.join(os.tmpdir(), `sageconnect-daily-summary-dispatch-${process.pid}`);

// La config del servicio para estos casos. Ningún caso la modifica: los que necesitan otra
// cargan forResponse con una copia.
const mockConfig = {
    schedule: {
        cronExpression: '*/15 * * * *',
        operationDelayMs: 0,
        lockTimeoutMs: 14 * 60 * 1000,
        childProcessTimeoutMs: 600000,
        stepTimeoutMs: 60000,
    },
    portal: {
        url: 'http://test',
        tenants: [
            { id: TENANT_IDS[0], database: TENANT_DBS[0] },
            { id: TENANT_IDS[1], database: TENANT_DBS[1] },
        ],
        httpTimeoutMs: 30000,
    },
    app: { importRoute: 'fake', arg: 'arg', timezone: 'America/Mexico_City', company: 'TestCo', rfc: '', regimen: '' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: tmpRoot, downloads: path.join(tmpRoot, 'dl'), providers: path.join(tmpRoot, 'p') },
    security: { apiKey: 'test-key' },
    retry: { scope: 'last_n_days', lookbackDays: 30, interval: { payment: 30, po: 240 } },
    eom: { notificationHour: 18, notificationEnabled: false },
    notifications: {
        poAlert: { enabled: false },
        paymentReport: { enabled: false, hour: 18, lookbackDays: 365 },
        dailySummary: SUMMARY_ON,
        mailTimeoutMs: 30000,
    },
};

const { recordPaymentRun } = require('../../src/utils/PaymentDayLedger');

// Los siete pasos de empresa, en el orden en que forResponse los corre.
const STEPS = [
    ['buildProviders', mockBuildProviders],
    ['downloadCFDI', mockDownloadCFDI],
    ['checkPayments', mockCheckPayments],
    ['uploadPayments', mockUploadPayments],
    ['createPurchaseOrders', mockCreatePOs],
    ['processOrderChanges', mockProcessChanges],
    ['closePurchaseOrders', mockClosePOs],
];

const CONFIG_MODULE = '../../src/config';
const SERVICE_MODULE = '../../src/services/DailySummaryService';
const DURATION_MODULE = '../../src/utils/duration';

// Relojes locales, como el `date` de forResponse; noviembre es el mes 10.
const at = (hour, minute) => new Date(2026, 10, 3, hour, minute);

// La config con otro valor en la llave del resumen; con undefined la llave no existe.
function withDailySummary(dailySummary) {
    const notifications = { ...mockConfig.notifications };
    if (dailySummary === undefined) {
        delete notifications.dailySummary;
    } else {
        notifications.dailySummary = dailySummary;
    }
    return { ...mockConfig, notifications };
}

// Carga un forResponse nuevo con los dobles del caso. Cada carga vuelve a fijar las tres fábricas
// que algún caso cambia, porque jest.doMock deja su fábrica registrada para el resto del archivo y
// el doble de un caso pasaría al siguiente. jest.resetModules() va antes del bloque aislado: en
// Jest 29.7, isolateModules reutiliza los dobles ya instanciados afuera (hallazgo del plan 20.7-06).
function loadForResponse({ config = mockConfig, service = null, duration = null } = {}) {
    let forResponse;
    jest.resetModules();
    jest.isolateModules(() => {
        jest.doMock(CONFIG_MODULE, () => config);
        if (service) {
            jest.doMock(SERVICE_MODULE, service);
        } else {
            jest.dontMock(SERVICE_MODULE);
        }
        if (duration) {
            jest.doMock(DURATION_MODULE, duration);
        } else {
            jest.dontMock(DURATION_MODULE);
        }
        ({ forResponse } = require('../../src/background'));
    });
    return forResponse;
}

// Corre una ejecución sin dejar vencer ningún paso: avanza el reloj falso de 10 en 10 ms con
// advanceTimersByTimeAsync, que entre avance y avance deja correr las promesas, hasta que
// forResponse termine. El tope de 500 vueltas son 5 s simulados, muy por debajo de los 60 000 ms
// de stepTimeoutMs: ningún temporizador de paso vence y el despacho termina dentro de su tiempo.
async function settle(promise) {
    let done = false;
    promise.then(() => { done = true; }, () => { done = true; });
    for (let turn = 0; turn < 500 && !done; turn++) {
        await jest.advanceTimersByTimeAsync(10);
    }
    if (!done) {
        throw new Error('forResponse no terminó en 500 vueltas de 10 ms');
    }
    return promise;
}

// runQuery con datos válidos del día, según la marca de cada consulta del resumen y la base que
// recibe, como routeQueries de tests/services/DailySummaryService.test.js. Una consulta que el doble
// no reconoce rechaza, y el resumen la vuelve una nota del correo que el caso RD-01 vería.
async function dayQueries(sql, db) {
    if (sql.includes('COUNT(DISTINCT ocSage)')) {
        return { recordset: [{ uploaded: 2, sqlDate: DAY, sqlNow: `${DAY} 23:45:07`, sqlOffsetMin: -360 }] };
    }
    if (sql.includes('fesaPagosFocaltec')) {
        return { recordset: [{ NoPagoSage: 'PY0000101' }] };
    }
    if (sql.includes("status = 'ERROR'")) {
        return {
            recordset: [{
                tenant: db,
                idOrPo: 'PO0000201',
                attemptsToday: 3,
                lastError: '500: Error interno del portal',
                isValidation: 0,
                fechaAuth: '2026-11-01',
            }],
        };
    }
    throw new Error(`consulta que el doble no reconoce en ${db}`);
}

// El registro de pagos del día de las dos empresas, como lo deja uploadPayments al final de cada
// corrida: así el resumen sale con todas sus fuentes.
function seedPaymentLedger() {
    for (const tenantDb of TENANT_DBS) {
        const out = recordPaymentRun({
            logsRoot: tmpRoot,
            dateISO: DAY,
            tenantDb,
            runAt: `${DAY}T14:07:00`,
            results: new Map([
                ['PY0000101', { outcome: 'uploaded', vendor: 'PROV01', fechaRegistro: '2026-10-30' }],
                ['PY0000102', { outcome: 'rejected', code: '400', description: 'Datos inválidos', vendor: 'PROV02', fechaRegistro: '2026-10-29' }],
            ]),
        });
        if (!out.ok) {
            throw new Error(`recordPaymentRun falló: ${out.error}`);
        }
    }
}

const statePath = (dateISO) => path.join(tmpRoot, 'sageconnect', dateISO, 'daily-summary.json');
const stateOf = (dateISO) => (fs.existsSync(statePath(dateISO))
    ? JSON.parse(fs.readFileSync(statePath(dateISO), 'utf8'))
    : null);
// [nivel, mensaje] de las líneas del resumen en la bitácora de avisos.
const summaryLines = () => mockLogGenerator.mock.calls
    .filter(([file, , message]) => file === 'EomNotification' && String(message).startsWith('[DAILY-SUMMARY'))
    .map(([, level, message]) => [level, message]);
const timeoutLines = () => mockLogGenerator.mock.calls
    .filter(([, , message]) => String(message).includes('[TIMEOUT]'));

// Cada paso de empresa corrió una vez por empresa, con el índice de la empresa.
function expectStepsRanOncePerTenant() {
    for (const [, step] of STEPS) {
        expect(step.mock.calls).toEqual([[0], [1]]);
    }
}

describe('forResponse con el resumen diario (Fase 20.7: D-03, RD-01, RD-03)', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        fs.mkdirSync(tmpRoot, { recursive: true });
        mockLogGenerator.mockReset();
        mockRunQuery.mockReset();
        mockRunQuery.mockImplementation(dayQueries);
        mockSendOperatorReport.mockReset();
        // El doble por omisión AFIRMA la entrega: un valor ausente cuenta como no entregado (S-2).
        mockSendOperatorReport.mockResolvedValue({ delivered: true, error: null });
        mockSendMail.mockReset();
        mockSendAdminAlert.mockReset();
        mockGetCurrentDate.mockClear();
        for (const [, step] of STEPS) {
            step.mockReset();
            step.mockResolvedValue(undefined);
        }
        mockClock.now = at(23, 45);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    afterAll(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    test('RD-01: a las 23:30, 23:45 y 23:50 sale un solo correo, en la de las 23:45 y después del último paso de empresas', async () => {
        seedPaymentLedger();
        const forResponse = loadForResponse();
        const sendsAfterRun = [];
        let lastCloseOf2345 = null;

        for (const minute of [30, 45, 50]) {
            mockClock.now = at(23, minute);
            const closesBefore = mockClosePOs.mock.invocationCallOrder.length;
            await expect(settle(forResponse())).resolves.toBeUndefined();
            sendsAfterRun.push(mockSendOperatorReport.mock.calls.length);
            if (minute === 45) {
                lastCloseOf2345 = Math.max(...mockClosePOs.mock.invocationCallOrder.slice(closesBefore));
            }
        }

        expect(sendsAfterRun).toEqual([0, 1, 1]);
        // El resumen sale al final de la ejecución, después del último paso de la última empresa.
        expect(mockSendOperatorReport.mock.invocationCallOrder[0]).toBeGreaterThan(lastCloseOf2345);
        const { subject, callerLogFile } = mockSendOperatorReport.mock.calls[0][0];
        expect(subject).toContain(DAY);
        expect(callerLogFile).toBe('EomNotification');
        expect(mockSendMail).not.toHaveBeenCalled();
        expect(mockSendAdminAlert).not.toHaveBeenCalled();
        // Un solo reloj por ejecución (D-03): una lectura en cada una de las tres.
        expect(mockGetCurrentDate).toHaveBeenCalledTimes(3);
        expect(stateOf(DAY)).toEqual({
            date: DAY,
            status: 'delivered',
            attempts: [{ at: '2026-11-03T23:45:00', delivered: true, error: null }],
        });
        expect(summaryLines()).toEqual([
            ['info', expect.stringMatching(/^\[DAILY-SUMMARY\] date=2026-11-03 attempt=1\/4 sent=true .* incomplete=false$/)],
        ]);
        expect(timeoutLines()).toEqual([]);
    });

    test('RD-03: con el correo caído a las 23:45, forResponse resuelve, los siete pasos corren por empresa y queda el warn del intento', async () => {
        seedPaymentLedger();
        mockSendOperatorReport.mockResolvedValue({ delivered: false, error: ECONNREFUSED });
        const forResponse = loadForResponse();

        await expect(settle(forResponse())).resolves.toBeUndefined();

        expectStepsRanOncePerTenant();
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(summaryLines()).toEqual([
            ['warn', expect.stringMatching(/^\[DAILY-SUMMARY\] date=2026-11-03 attempt=1\/4 sent=false .* err=connect ECONNREFUSED 127\.0\.0\.1:25$/)],
        ]);
        // El intento fallido queda anotado y el día sigue pendiente para su reintento.
        expect(stateOf(DAY)).toEqual({
            date: DAY,
            status: 'pending',
            attempts: [{ at: '2026-11-03T23:45:00', delivered: false, error: ECONNREFUSED }],
        });
        expect(mockSendAdminAlert).not.toHaveBeenCalled();
        expect(timeoutLines()).toEqual([]);
    });

    test('bloque que lanza: si el despacho rechaza, forResponse resuelve y deja dispatch-failed en error (RD-03)', async () => {
        const rejecting = jest.fn().mockRejectedValue(new Error('fallo simulado del despacho'));
        const forResponse = loadForResponse({ service: () => ({ dispatchDailySummaryIfDue: rejecting }) });

        await expect(settle(forResponse())).resolves.toBeUndefined();

        expectStepsRanOncePerTenant();
        // El bloque le pasa el reloj tomado al empezar la ejecución y la config del servicio.
        expect(rejecting).toHaveBeenCalledTimes(1);
        expect(rejecting.mock.calls[0][0]).toBe(mockClock.now);
        expect(rejecting.mock.calls[0][1]).toBe(mockConfig);
        expect(summaryLines()).toEqual([
            ['error', '[DAILY-SUMMARY] status=dispatch-failed err=fallo simulado del despacho'],
        ]);
        expect(timeoutLines()).toEqual([]);
    });

    test('tiempo agotado: el paso del resumen vence, forResponse resuelve y la única línea [TIMEOUT] es la suya (RD-03)', async () => {
        const neverSettles = jest.fn(() => new Promise(() => {}));
        const forResponse = loadForResponse({
            config: { ...mockConfig, schedule: { ...mockConfig.schedule, stepTimeoutMs: 1000 } },
            service: () => ({ dispatchDailySummaryIfDue: neverSettles }),
        });

        let done = false;
        let failure = null;
        forResponse().then(() => { done = true; }, (err) => { done = true; failure = err; });
        // La receta de la suite de origen, con un tope de 100 vueltas en lugar de sus 8 fijas: cada
        // espera entre pasos consume una vuelta, y con 8 la ejecución no llega al bloque nuevo. Los
        // pasos de empresa no vencen aunque su temporizador se dispare: su promesa ya está resuelta
        // cuando empieza la carrera, así que la gana.
        for (let turn = 0; turn < 100 && !done; turn++) {
            jest.advanceTimersByTime(1001);
            for (let flush = 0; flush < 4; flush++) {
                await Promise.resolve();
            }
        }

        expect(done).toBe(true);
        expect(failure).toBeNull();
        expect(neverSettles).toHaveBeenCalledTimes(1);
        expectStepsRanOncePerTenant();
        const timeouts = timeoutLines();
        expect(timeouts).toHaveLength(1);
        expect(timeouts[0][0]).toBe('ForResponse');
        expect(timeouts[0][1]).toBe('error');
        expect(timeouts[0][2]).toMatch(/^\[TIMEOUT\] step=dailySummary tenant=global url=n\/a durationMs=1000 err=Step timeout after 1s — step=dailySummary$/);
        expect(summaryLines()).toEqual([
            ['error', '[DAILY-SUMMARY] status=dispatch-failed err=Step timeout after 1s — step=dailySummary'],
        ]);
    });

    test('apagado: con enabled en false no hay consultas, envío, estado ni líneas del resumen (D-40)', async () => {
        const forResponse = loadForResponse({ config: withDailySummary({ ...SUMMARY_ON, enabled: false }) });

        await expect(settle(forResponse())).resolves.toBeUndefined();

        expectStepsRanOncePerTenant();
        expect(mockRunQuery).not.toHaveBeenCalled();
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(fs.existsSync(statePath(DAY))).toBe(false);
        expect(fs.existsSync(path.join(tmpRoot, 'sageconnect'))).toBe(false);
        expect(summaryLines()).toEqual([]);
        expect(timeoutLines()).toEqual([]);
    });

    test('llave ausente: sin dailySummary en la config, forResponse resuelve y no arma el paso (D-40)', async () => {
        const dispatchSpy = jest.fn().mockResolvedValue(undefined);
        const wrapLabels = [];
        const forResponse = loadForResponse({
            config: withDailySummary(undefined),
            service: () => ({ dispatchDailySummaryIfDue: dispatchSpy }),
            duration: () => {
                const actual = jest.requireActual('../../src/utils/duration');
                return {
                    ...actual,
                    withStepTimeout: (promise, ms, label) => {
                        wrapLabels.push(label);
                        return actual.withStepTimeout(promise, ms, label);
                    },
                };
            },
        });

        await expect(settle(forResponse())).resolves.toBeUndefined();

        expectStepsRanOncePerTenant();
        expect(dispatchSpy).not.toHaveBeenCalled();
        // Solo se envolvieron los siete pasos de cada empresa: ninguno del resumen.
        const tenantLabels = TENANT_IDS.flatMap((tenant) => STEPS.map(([name]) => `step=${name} tenant=${tenant}`));
        expect(wrapLabels).toEqual(tenantLabels);
        expect(summaryLines()).toEqual([]);
        expect(timeoutLines()).toEqual([]);
    });

    test('D-03: el resumen no agrega pasos al panel; startStep va 7 veces por empresa, igual que con el resumen apagado', async () => {
        const runWithEmitter = async (config) => {
            const emitter = { startStep: jest.fn(), endStep: jest.fn(), emitProgress: jest.fn() };
            const forResponse = loadForResponse({ config });
            await expect(settle(forResponse({ operationId: 'op-d03', emitter }))).resolves.toBeUndefined();
            return emitter;
        };

        const on = await runWithEmitter(mockConfig);
        // El bloque sí corrió: hubo un envío en esta ejecución.
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        const off = await runWithEmitter(withDailySummary({ ...SUMMARY_ON, enabled: false }));

        const expectedStarts = TENANT_IDS.flatMap((tenant) => STEPS.map(([name]) => ['background-cycle', name, tenant]));
        expect(on.startStep.mock.calls).toEqual(expectedStarts);
        expect(off.startStep.mock.calls).toEqual(expectedStarts);
        expect(on.endStep).toHaveBeenCalledTimes(expectedStarts.length);
        for (const fn of [on.startStep, on.endStep, on.emitProgress]) {
            expect(JSON.stringify(fn.mock.calls)).not.toContain('dailySummary');
        }
        // El aviso de terminación al panel sale después del resumen.
        const completeIndex = on.emitProgress.mock.calls.findIndex(([, event]) => event.type === 'complete');
        expect(completeIndex).toBeGreaterThanOrEqual(0);
        expect(on.emitProgress.mock.invocationCallOrder[completeIndex])
            .toBeGreaterThan(mockSendOperatorReport.mock.invocationCallOrder[0]);
        expect(timeoutLines()).toEqual([]);
    });
});
