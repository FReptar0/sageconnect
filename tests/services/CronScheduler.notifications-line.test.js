// tests/services/CronScheduler.notifications-line.test.js (NUEVO — Fase 20.7, plan 20.7-09)
//
// La línea de arranque de initScheduler con el estado de los cuatro avisos y la hora del resumen
// (D-32, D-40, RD-12). Va a la bitácora EomNotification justo después de la línea de
// inicialización, y nunca detiene el arranque: ni con una config sin notifications ni eom, ni con
// la bitácora fallando.
//
// initScheduler es el real, y DailySummary también, porque arma el texto. Los dobles de node-cron,
// OperationManager, LicenseValidator y background se calcan de tests/services/cron-scheduler.test.js;
// AdminEmailSender y LogGenerator también se simulan. La config cambia por caso: cada carga la fija
// con jest.doMock dentro de jest.isolateModules, después de jest.resetModules(), porque en Jest 29.7
// isolateModules reutiliza los dobles ya instanciados afuera (hallazgo del plan 20.7-06).

const mockTask = {
    getStatus: jest.fn(() => 'scheduled'),
    getNextRun: jest.fn(() => null),
    on: jest.fn(),
};
const mockSchedule = jest.fn(() => mockTask);
const mockOperationManager = {
    acquireLock: jest.fn(() => true),
    releaseLock: jest.fn(),
    addHistory: jest.fn(),
    emitProgress: jest.fn(),
    startStep: jest.fn(),
    endStep: jest.fn(),
    on: jest.fn(),
};
const mockSendAdminAlert = jest.fn();
const mockLogGenerator = jest.fn();

// El doble de config de tests/services/cron-scheduler.test.js, sin notifications ni eom (M-4).
const mockBareConfig = {
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 1000 },
    app: { timezone: 'America/Mexico_City' },
    portal: { tenants: [{ id: 'T1' }, { id: 'T2' }] },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
};

jest.mock('../../src/config', () => mockBareConfig);
jest.mock('node-cron', () => ({ schedule: mockSchedule }));
jest.mock('../../src/services/OperationManager', () => mockOperationManager);
jest.mock('../../src/services/LicenseValidator', () => ({
    isValid: jest.fn(() => true),
    validate: jest.fn(),
    getStatus: jest.fn(),
}));
jest.mock('../../src/background', () => ({
    forResponse: jest.fn().mockResolvedValue(undefined),
    startChildProcess: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/utils/AdminEmailSender', () => ({
    sendAdminAlert: mockSendAdminAlert,
    findLastOpenStep: jest.fn(() => null),
}));
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const { describe, test, expect, beforeEach } = require('@jest/globals');

const ALL_OFF = {
    poAlert: { enabled: false },
    paymentReport: { enabled: false, hour: 18, lookbackDays: 365 },
    dailySummary: { enabled: false, hour: 23, minute: 45 },
    mailTimeoutMs: 30000,
};
const ALL_ON = {
    poAlert: { enabled: true },
    paymentReport: { enabled: true, hour: 18, lookbackDays: 365 },
    dailySummary: { enabled: true, hour: 22, minute: 30 },
    mailTimeoutMs: 30000,
};

// La config del servicio con los avisos dados y el interruptor del cierre de mes.
const configWith = (notifications, eomEnabled) => ({
    ...mockBareConfig,
    notifications,
    eom: { notificationHour: 18, notificationEnabled: eomEnabled },
});

// Carga un CronScheduler nuevo con la config del caso.
function loadScheduler(config) {
    let scheduler;
    jest.resetModules();
    jest.isolateModules(() => {
        jest.doMock('../../src/config', () => config);
        scheduler = require('../../src/services/CronScheduler');
    });
    return scheduler;
}

const messages = () => mockLogGenerator.mock.calls.map(([, , message]) => message);
const statusCalls = () => mockLogGenerator.mock.calls.filter(([file]) => file === 'EomNotification');

describe('initScheduler: línea de arranque con el estado de los avisos (Fase 20.7, D-32, RD-12)', () => {
    beforeEach(() => {
        mockLogGenerator.mockReset();
        mockSchedule.mockClear();
        mockTask.on.mockClear();
        mockOperationManager.on.mockClear();
        mockSendAdminAlert.mockReset();
    });

    test('los cuatro avisos apagados y la hora 23:45: una línea en EomNotification, justo después de la de inicialización', () => {
        const scheduler = loadScheduler(configWith(ALL_OFF, false));

        scheduler.initScheduler();

        expect(statusCalls()).toEqual([
            ['EomNotification', 'info', '[NOTIFICATIONS] po-alert=off eom=off payment-report=off daily-summary=off daily-summary-time=23:45'],
        ]);
        const initIndex = messages().findIndex((message) => message.startsWith('[INIT] Scheduler initialized'));
        expect(initIndex).toBeGreaterThanOrEqual(0);
        expect(messages()[initIndex + 1]).toMatch(/^\[NOTIFICATIONS\] /);
        expect(mockLogGenerator.mock.calls[initIndex][0]).toBe('CronScheduler');
    });

    test('los cuatro avisos encendidos y la hora 22:30', () => {
        const scheduler = loadScheduler(configWith(ALL_ON, true));

        scheduler.initScheduler();

        expect(statusCalls()).toEqual([
            ['EomNotification', 'info', '[NOTIFICATIONS] po-alert=on eom=on payment-report=on daily-summary=on daily-summary-time=22:30'],
        ]);
    });

    test('config sin notifications ni eom: todo off, la hora n/a y el arranque no lanza (D-40)', () => {
        const scheduler = loadScheduler(mockBareConfig);

        expect(() => scheduler.initScheduler()).not.toThrow();

        expect(statusCalls()).toEqual([
            ['EomNotification', 'info', '[NOTIFICATIONS] po-alert=off eom=off payment-report=off daily-summary=off daily-summary-time=n/a'],
        ]);
        expect(mockSchedule).toHaveBeenCalledTimes(1);
    });

    test('la bitácora de avisos lanza: initScheduler no lanza y el cron quedó programado (D-40)', () => {
        mockLogGenerator.mockImplementation((file) => {
            if (file === 'EomNotification') {
                throw new Error('bitácora de avisos caída');
            }
        });
        const scheduler = loadScheduler(configWith(ALL_OFF, false));

        expect(() => scheduler.initScheduler()).not.toThrow();

        expect(mockSchedule).toHaveBeenCalledTimes(1);
        // Se intentó la línea, y la de inicialización salió antes que ella.
        expect(statusCalls()).toHaveLength(1);
        expect(mockLogGenerator).toHaveBeenCalledWith('CronScheduler', 'info', expect.stringMatching(/^\[INIT\] Scheduler initialized/));
        expect(mockOperationManager.on).toHaveBeenCalledWith('lock:timeout', expect.any(Function));
    });
});
