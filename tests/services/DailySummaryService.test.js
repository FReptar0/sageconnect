// tests/services/DailySummaryService.test.js (NUEVO — Fase 20.7, plan 20.7-06)
//
// Recolección del resumen diario (src/services/DailySummaryService.js): la forma de sus tres
// consultas, la base explícita en cada una, la validación de la fecha antes del SQL, las fallas
// parciales y el modelo que sale de punta a punta. El plan 20.7-07 agrega aquí los casos del
// despacho.
//
// Dobles, calcados de tests/integration/payment-report-dispatch.test.js:
// - config, con la carpeta de bitácoras en un temporal de os.tmpdir() propio de este proceso;
// - LogGenerator y SQLServerConnection.runQuery: no hay base de datos local (HANDOFF §6), así que
//   las consultas se prueban por su texto y con runQuery simulado;
// - EmailSender: su fábrica anota cada carga en mockEmailSenderLoaded, para poder afirmar que la
//   recolección no carga el envío (D-01). Sus dos funciones las usa el despacho del plan 20.7-07.
// PaymentDayLedger y DailySummary van reales: el registro se escribe y se lee de verdad en la
// carpeta temporal, y el modelo es el mismo que recibiría el correo.

// Mock de src/config — antes de cualquier require, para que las utilidades anidadas lo vean.
jest.mock('../../src/config', () => {
    const nodePath = require('path');
    const nodeOs = require('os');
    return {
        portal: { tenants: [{ id: 'T1', database: 'COPDAT' }] },
        paths: { logs: nodePath.join(nodeOs.tmpdir(), `sageconnect-daily-summary-service-${process.pid}`) },
        retry: { scope: 'last_n_days', lookbackDays: 30 },
    };
});

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

const mockSendOperatorReport = jest.fn();
const mockSendMail = jest.fn();
const mockEmailSenderLoaded = jest.fn();
jest.mock('../../src/utils/EmailSender', () => {
    mockEmailSenderLoaded();
    return { sendMail: mockSendMail, sendOperatorReport: mockSendOperatorReport };
});

const fs = require('fs');
const path = require('path');
const os = require('os');
const { describe, test, expect, beforeEach, afterAll } = require('@jest/globals');

const tmpRoot = path.join(os.tmpdir(), `sageconnect-daily-summary-service-${process.pid}`);

const config = require('../../src/config');
const service = require('../../src/services/DailySummaryService');

beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    mockLogGenerator.mockReset();
    mockRunQuery.mockReset();
    mockSendOperatorReport.mockReset();
    mockSendMail.mockReset();
    mockEmailSenderLoaded.mockReset();
});

afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('collectDailySummary', () => {
    test('el servicio carga con sus dobles y exporta las tres consultas y la recolección', () => {
        expect(typeof service.buildOcDayQuery).toBe('function');
        expect(typeof service.buildOcUploadedQuery).toBe('function');
        expect(typeof service.buildPaymentsControlQuery).toBe('function');
        expect(typeof service.collectDailySummary).toBe('function');
        expect(config.paths.logs).toBe(tmpRoot);
    });
});
