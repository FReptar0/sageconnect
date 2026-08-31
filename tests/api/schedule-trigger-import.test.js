/**
 * Schedule Trigger — Importer Invocation Tests (NEW — Fase 23, Plan 23-01 Task 2)
 *
 * Cubre REQ-23-01 .. REQ-23-04: el disparo manual
 * (POST /api/schedule/background-cycle/trigger) encadena startChildProcess()
 * después de forResponse(), dentro del MISMO lock 'background-cycle', con la
 * misma instrumentación, el mismo manejo de timeout y el mismo correo que el cron.
 *
 * Por qué un archivo NUEVO y no tests dentro de tests/api/schedule-routes.test.js
 * (D-16, revisada al planificar): estos casos necesitan mocks a nivel de módulo que
 * ese archivo hoy no tiene —`AdminEmailSender`, `schedule.childProcessTimeoutMs`,
 * `startStep`/`endStep`— y agregárselos cambiaría el entorno de sus 4 tests actuales
 * del trigger. Un archivo propio deja REQ-23-06 ("ningún test existente cambia sus
 * assertions") cierto POR CONSTRUCCIÓN, y sigue el precedente del repo de un archivo
 * de test por endpoint.
 *
 * Estrategia: app de prueba dedicada con todas las dependencias mockeadas — no hace
 * falta .env real, ni base de datos, ni SMTP, ni el .exe (que no existe en la Mac).
 *
 * Nota sobre el timing: el endpoint responde de inmediato y la cadena de promesas
 * corre DESPUÉS del res.json. Cada test cede el event loop con drainChain() antes
 * de afirmar.
 */

const { describe, test, expect, beforeAll, beforeEach } = require('@jest/globals');

// ---------------------------------------------------------------------------
// Mock config.js BEFORE any other requires (prevents process.exit on missing env)
// Copiado de tests/api/schedule-routes.test.js:17-40 y ampliado con
// schedule.childProcessTimeoutMs (lo lee formatDurationMin en el camino del
// sentinel) y license.adminEmail / mailing (los lee sendAdminAlert).
// ---------------------------------------------------------------------------
jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://test-portal',
        tenants: [
            { id: 'T1', key: 'k1', secret: 's1', database: 'DB1', externalId: 'E1' },
        ],
    },
    security: { apiKey: 'test-api-key' },
    database: { user: 'u', password: 'p', server: 's', database: 'd' },
    paths: { logs: '/tmp', downloads: '/tmp', providers: '/tmp' },
    schedule: {
        cronExpression: '*/15 * * * *',
        operationDelayMs: 5000,
        childProcessTimeoutMs: 600000,
    },
    app: {
        timezone: 'America/Mexico_City',
        importRoute: '/test',
        arg: 'ARG',
        company: 'Test',
        rfc: 'RFC',
        regimen: 'REG',
        defaultAddress: {
            city: 'C', country: 'MX', identifier: 'I',
            municipality: 'M', state: 'S', street: 'ST', zip: '00000',
        },
        addressIdentifiersSkip: [],
    },
    license: { adminEmail: 'admin@example.com' },
    mailing: {
        server: 'smtp',
        port: 587,
        ssl: false,
        from: 'noreply@example.com',
        password: '',
        notices: [],
        cc: [],
    },
}));

// ---------------------------------------------------------------------------
// Mock OperationManager — extendido con startStep/endStep (Fase 23 REQ-23-02)
//
// Fase 23 plan 23-04 (REQ-23-10): el mock MODELA ahora la propiedad del slot.
// Antes `acquireLock` devolvía true pero `getRunningOperations()` devolvía `{}`,
// un estado imposible en el OperationManager real (candado tomado y ninguna
// operación corriendo) que dejaba a la guarda de propiedad sin poder ejercitarse.
// Cambia SOLO el andamiaje de los mocks; ninguna assertion de los 6 casos
// originales se toca.
// ---------------------------------------------------------------------------
let mockHeldSlot = null;    // slot vigente de 'background-cycle' dentro del mock

function mockAcquireLockImpl(_operationType, operationId) {
    mockHeldSlot = { operationId, startedAt: new Date().toISOString(), stepProgress: [] };
    return true;
}
function mockReleaseLockImpl() {
    mockHeldSlot = null;
}
function mockRunningOperationsImpl() {
    return mockHeldSlot ? { 'background-cycle': mockHeldSlot } : {};
}

const mockOperationManager = {
    acquireLock: jest.fn(mockAcquireLockImpl),
    releaseLock: jest.fn(mockReleaseLockImpl),
    isLocked: jest.fn().mockReturnValue(false),
    emitProgress: jest.fn(),
    startStep: jest.fn(),
    endStep: jest.fn(),
    getRunningOperations: jest.fn(mockRunningOperationsImpl),
    getHistory: jest.fn().mockReturnValue([]),
    addHistory: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    setMaxListeners: jest.fn(),
};
jest.mock('../../src/services/OperationManager', () => mockOperationManager);

// ---------------------------------------------------------------------------
// Mock CronScheduler (schedule-routes lo hace lazy-require)
// ---------------------------------------------------------------------------
jest.mock('../../src/services/CronScheduler', () => ({
    getSchedulerStatus: jest.fn().mockReturnValue({
        cronExpression: '*/15 * * * *',
        status: 'idle',
        nextRun: '2026-03-24T00:15:00.000Z',
        lastRun: null,
    }),
    getTask: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock background.js — forResponse + startChildProcess (el eslabón de esta fase)
// ---------------------------------------------------------------------------
const mockBackground = {
    forResponse: jest.fn().mockResolvedValue(undefined),
    startChildProcess: jest.fn().mockResolvedValue(0),
};
jest.mock('../../src/background', () => mockBackground);

// ---------------------------------------------------------------------------
// Mock AdminEmailSender (D-18). Sin esto, el caso del sentinel intentaría abrir
// una conexión SMTP real desde el test.
// ---------------------------------------------------------------------------
const mockAdminEmailSender = {
    sendAdminAlert: jest.fn().mockResolvedValue(undefined),
    findLastOpenStep: jest.fn().mockReturnValue(null),
};
jest.mock('../../src/utils/AdminEmailSender', () => mockAdminEmailSender);

// ---------------------------------------------------------------------------
// Mock infrastructure modules
// ---------------------------------------------------------------------------
jest.mock('../../src/utils/LogGenerator', () => ({
    logGenerator: jest.fn(),
}));
jest.mock('../../src/utils/SQLServerConnection', () => ({
    runQuery: jest.fn().mockResolvedValue({ recordset: [] }),
}));
jest.mock('../../src/utils/TimezoneHelper', () => ({
    getCurrentDateCompact: jest.fn().mockReturnValue('20260323'),
    getCurrentDateString: jest.fn().mockReturnValue('2026-03-23'),
}));
// Mock express-rate-limit
jest.mock('express-rate-limit', () => ({
    rateLimit: () => (req, res, next) => next(),
}));

// Mock api-key middleware to use test key (avoids importing real config in middleware)
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
// Build test app
// ---------------------------------------------------------------------------
const express = require('express');
const request = require('supertest');
const { errorResult } = require('../../src/utils/ResultEnvelope');

const TEST_API_KEY = 'test-api-key';
const TRIGGER_URL = '/api/schedule/background-cycle/trigger';

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

/**
 * Cede el event loop para que la cadena .then().then().catch().finally() del
 * handler termine de asentarse. setImmediate corre después de drenar la cola de
 * microtareas; se repite por si algún eslabón agenda trabajo adicional.
 */
async function drainChain(times = 3) {
    for (let i = 0; i < times; i++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/schedule/:taskId/trigger — invocación del importador (Fase 23)', () => {
    let app;

    beforeAll(() => {
        app = createScheduleTestApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockHeldSlot = null;
        mockOperationManager.acquireLock.mockImplementation(mockAcquireLockImpl);
        mockOperationManager.releaseLock.mockImplementation(mockReleaseLockImpl);
        mockOperationManager.getHistory.mockReturnValue([]);
        mockOperationManager.getRunningOperations.mockImplementation(mockRunningOperationsImpl);
        mockBackground.forResponse.mockResolvedValue(undefined);
        mockBackground.startChildProcess.mockResolvedValue(0);
        mockAdminEmailSender.sendAdminAlert.mockResolvedValue(undefined);
    });

    // (a) REQ-23-01
    test('invoca startChildProcess exactamente 1 vez y DESPUÉS de forResponse', async () => {
        const res = await request(app)
            .post(TRIGGER_URL)
            .set('x-api-key', TEST_API_KEY);

        expect(res.status).toBe(200);

        await drainChain();

        expect(mockBackground.startChildProcess).toHaveBeenCalledTimes(1);
        expect(mockBackground.forResponse).toHaveBeenCalledTimes(1);
        expect(mockBackground.forResponse.mock.invocationCallOrder[0])
            .toBeLessThan(mockBackground.startChildProcess.mock.invocationCallOrder[0]);
    });

    // (b) REQ-23-02 — instrumentación paritaria con el cron
    test('registra startStep/endStep con (background-cycle, startChildProcess, null)', async () => {
        await request(app)
            .post(TRIGGER_URL)
            .set('x-api-key', TEST_API_KEY);

        await drainChain();

        expect(mockOperationManager.startStep)
            .toHaveBeenCalledWith('background-cycle', 'startChildProcess', null);
        expect(mockOperationManager.endStep)
            .toHaveBeenCalledWith('background-cycle', 'startChildProcess', null, { error: null });

        // El startStep va ANTES del await, el endStep en el finally
        expect(mockOperationManager.startStep.mock.invocationCallOrder[0])
            .toBeLessThan(mockBackground.startChildProcess.mock.invocationCallOrder[0]);
        expect(mockBackground.startChildProcess.mock.invocationCallOrder[0])
            .toBeLessThan(mockOperationManager.endStep.mock.invocationCallOrder[0]);
    });

    // (c) REQ-23-03 — sentinel load-bearing 'Child process timeout' → 1 correo
    test('un rechazo con el sentinel "Child process timeout" despacha sendAdminAlert 1 vez', async () => {
        mockBackground.startChildProcess.mockRejectedValue(
            new Error('Child process timeout after 10m — killed (PID was 123)')
        );

        await request(app)
            .post(TRIGGER_URL)
            .set('x-api-key', TEST_API_KEY);

        await drainChain();

        expect(mockAdminEmailSender.sendAdminAlert).toHaveBeenCalledTimes(1);

        const [subject] = mockAdminEmailSender.sendAdminAlert.mock.calls[0];
        expect(subject).toMatch(
            /^\[SageConnect\] Child process timeout: ImportaFacturasFocaltec\.exe killed/
        );

        // D-06: el wrapper local inyecta LOG_FILE='ScheduleRoutes' como 3.er argumento,
        // para que la entrada [ADMIN-EMAIL] caiga en ScheduleRoutes.log y no en CronScheduler.log.
        const [, , callerLogFile] = mockAdminEmailSender.sendAdminAlert.mock.calls[0];
        expect(callerLogFile).toBe('ScheduleRoutes');
    });

    // (d) NEGACIÓN explícita — misma disciplina D-15 que ya tienen los tests del cron
    test('un rechazo con otro texto NO despacha ningún correo', async () => {
        mockBackground.startChildProcess.mockRejectedValue(
            new Error('Child process failed with code 2')
        );

        await request(app)
            .post(TRIGGER_URL)
            .set('x-api-key', TEST_API_KEY);

        await drainChain();

        expect(mockBackground.startChildProcess).toHaveBeenCalledTimes(1);
        expect(mockAdminEmailSender.sendAdminAlert).toHaveBeenCalledTimes(0);
    });

    // (e) REQ-23-04 — el fallo del importador no traba el lock ni pierde el historial
    test('si el importador falla: addHistory success:false con el mensaje y releaseLock igual', async () => {
        mockBackground.startChildProcess.mockRejectedValue(
            new Error('Child process failed with code 2')
        );

        await request(app)
            .post(TRIGGER_URL)
            .set('x-api-key', TEST_API_KEY);

        await drainChain();

        expect(mockOperationManager.addHistory).toHaveBeenCalledTimes(1);
        const historyEntry = mockOperationManager.addHistory.mock.calls[0][0];
        expect(historyEntry.success).toBe(false);
        expect(historyEntry.errors).toContain('Child process failed with code 2');

        expect(mockOperationManager.releaseLock).toHaveBeenCalledTimes(1);
        expect(mockOperationManager.releaseLock).toHaveBeenCalledWith('background-cycle');

        // El endStep del finally recibe el mensaje del error, no null
        expect(mockOperationManager.endStep).toHaveBeenCalledWith(
            'background-cycle',
            'startChildProcess',
            null,
            { error: 'Child process failed with code 2' }
        );
    });

    // (f) REGRESIÓN — paridad con el try del cron: si forResponse rechaza, el importador no corre
    test('si forResponse rechaza, startChildProcess NO se invoca', async () => {
        mockBackground.forResponse.mockRejectedValue(new Error('forResponse exploded'));

        await request(app)
            .post(TRIGGER_URL)
            .set('x-api-key', TEST_API_KEY);

        await drainChain();

        expect(mockBackground.startChildProcess).toHaveBeenCalledTimes(0);
        expect(mockOperationManager.startStep).toHaveBeenCalledTimes(0);

        // La cadena existente sigue cumpliendo REQ-23-04 sin código nuevo
        const historyEntry = mockOperationManager.addHistory.mock.calls[0][0];
        expect(historyEntry.success).toBe(false);
        expect(historyEntry.errors).toContain('forResponse exploded');
        expect(mockOperationManager.releaseLock).toHaveBeenCalledTimes(1);
    });
});
