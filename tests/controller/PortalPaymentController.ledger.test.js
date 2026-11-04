// tests/controller/PortalPaymentController.ledger.test.js
// Fase 20.7, plan 05 (RD-10, D-16 a D-22, D-27): el registro diario de pagos que escribe
// uploadPayments. Corre el uploadPayments REAL con runQuery y el POST simulados y lee el archivo del
// día que escribe PaymentDayLedger. Ese módulo NO se simula: escribe de verdad en una carpeta de
// os.tmpdir() propia de la suite, que beforeEach vacía y afterAll borra.
//
// Cubre cada resultado en su punto (D-17), un solo volcado por corrida, también con el return
// temprano y con el catch externo (D-18), el archivo dañado que se reinicia (D-19), el registro
// escrito con el resumen diario apagado (D-20), la columna fechaRegistro (D-21), el silencio sin
// LOG_PATH o sin reloj (D-22) y la falla de la consulta de encabezados (D-27). También fija que el
// registro no cambia las consultas, los POST ni el INSERT de la tabla de control (RD-10, RD-14).
//
// Los dobles, la fábrica de renglón y el vaciado de colas vienen de
// tests/controller/PortalPaymentController.cron-where.test.js. Cambian dos cosas (PATTERNS,
// Corrección 1): paths.logs apunta a la carpeta temporal y el doble de TimezoneHelper sí exporta
// getCurrentDate, con una lectura fija: el 3 de noviembre de 2026 a las 10:15:00.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, expect, beforeEach, afterAll } = require('@jest/globals');

jest.mock('../../src/config', () => {
    // La fábrica no puede leer variables de fuera: calcula aquí su carpeta temporal.
    const nodePath = require('path');
    const nodeOs = require('os');
    const tmpRoot = nodePath.join(nodeOs.tmpdir(), `sc-ppc-ledger-${process.pid}`);
    return {
        portal: {
            url: 'http://test',
            tenants: [{ id: 'T1', key: 'k1', secret: 's1', database: 'COPDAT', externalId: 'ext1' }],
            httpTimeoutMs: 30000,
        },
        paths: {
            downloads: nodePath.join(tmpRoot, 'downloads'),
            logs: tmpRoot,
            providers: nodePath.join(tmpRoot, 'providers'),
        },
        database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
        mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', notices: [], cc: [], password: '' },
        license: { adminEmail: 'admin@test.com' },
        app: { company: 'TestCo', timezone: 'America/Mexico_City', rfc: 'RFC', regimen: 'R1', arg: 'A1', importRoute: '' },
        security: { apiKey: 'test-key' },
        schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 0, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
        retry: { scope: 'current_month', lookbackDays: 30, interval: { payment: 30, po: 240 } },
        // D-20: el resumen diario apagado. El registro se escribe igual.
        notifications: { dailySummary: { enabled: false, hour: 23, minute: 45 } },
        eom: { notificationHour: 18, notificationEnabled: true },
    };
});

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

const mockPortalPost = jest.fn();
jest.mock('../../src/utils/PortalClient', () => ({ post: mockPortalPost }));

const mockNotify = jest.fn();
jest.mock('node-notifier', () => ({ notify: mockNotify }));
jest.mock('../../src/services/ProviderIdResolver', () => ({ resolveProviderIdByExternalId: jest.fn() }));
jest.mock('../../src/services/UuidResolver', () => ({ resolveUuidByFolio: jest.fn() }));
jest.mock('../../src/utils/TimezoneHelper', () => ({
    getCurrentDateCompact: () => '20261103',
    getCurrentDate: jest.fn(() => new Date(2026, 10, 3, 10, 15, 0)),
}));

const config = require('../../src/config');
const timezoneMock = require('../../src/utils/TimezoneHelper');
const { resolveUuidByFolio } = require('../../src/services/UuidResolver');
const { uploadPayments } = require('../../src/controller/PortalPaymentController');

// La lectura fija del reloj (D-16): de ella salen la fecha del archivo y la hora de la corrida.
const DAY = '2026-11-03';
const RUN_AT = '2026-11-03T10:15:00';
const fixedClock = () => new Date(2026, 10, 3, 10, 15, 0);
const getCurrentDateMock = timezoneMock.getCurrentDate;

const TMP_LOGS = config.paths.logs;
const LEDGER_FILE = path.join(TMP_LOGS, 'sageconnect', DAY, 'daily-summary-payments.json');
const ENDPOINT = 'http://test/api/1.0/extern/tenants/T1/payments';

// Reloj único de la consulta (20.2 D-01), como en cron-where: sin dbNow cada corrida dejaría un
// [RETRY-CLOCK] que no viene al caso.
const DB_NOW = new Date(Date.now() - 360 * 60 * 1000);

// Solo borra la carpeta propia de la suite, y solo si de verdad está dentro de os.tmpdir().
function removeTmpLogs() {
    if (!TMP_LOGS.startsWith(os.tmpdir()) || !path.basename(TMP_LOGS).startsWith('sc-ppc-ledger-')) {
        throw new Error(`carpeta temporal inesperada: ${TMP_LOGS}`);
    }
    fs.rmSync(TMP_LOGS, { recursive: true, force: true });
}

// Renglón completo de encabezado de pago, para que llegue al bucle de subida.
const paymentRow = (overrides) => ({
    external_id: 'PY0000000',
    LotePago: 100,
    AsientoPago: 1,
    bank_account_id: 'BANK-001',
    IDBANK: 'B1',
    FechaAsentamiento: '20261020',
    comments: '',
    reference: '',
    bk_currency: 'MXN',
    payment_date: '20261020',
    provider_external_id: 'V001',
    total_amount: 100,
    operation_type: 'TRANSFER',
    TipoCambioPago: 1,
    fechaRegistro: '2026-10-20', // la columna de D-21
    PROVIDERID: 'PROV-1',
    DIFERENCIA_MINUTOS: 120,
    errorCount: 0,
    lastErrorAt: null,
    dbNow: DB_NOW,
    ...overrides,
});

// Renglón de factura pagada, con UUID y pagada por completo.
const invoiceRow = (overrides) => ({
    LotePago: 100,
    AsientoPago: 1,
    invoice_external_id: 'FAC-0001',
    inv_batch: 50,
    inv_entry: 1,
    invoice_amount: 100,
    invoice_currency: 'MXN',
    invoice_exchange_rate: 1,
    payment_amount: 100,
    FULL_PAID: 1,
    UUID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    exchange_rate: 1,
    ...overrides,
});

// runQuery simulado con un enrutador por el texto del SQL: encabezados, tabla de control, facturas
// de cada pago (por su lote) e INSERT de control. La consulta de encabezados también menciona la
// tabla de control en su NOT IN, así que se reconoce primero. `rejectHeadersWith` y
// `rejectInvoicesWith` hacen rechazar esa consulta con el valor dado, sea o no un Error.
function routeQueries(opts = {}) {
    const { headers = [], registered = [], invoicesByLote = {} } = opts;
    mockRunQuery.mockImplementation(async (sql) => {
        if (sql.includes('FROM APBTA B')) {
            if ('rejectHeadersWith' in opts) throw opts.rejectHeadersWith;
            return { recordset: headers.map((row) => ({ ...row })) };
        }
        if (sql.includes('INSERT INTO fesa.dbo.fesaPagosFocaltec')) {
            return { rowsAffected: [1] };
        }
        if (sql.includes('FROM APTCP DP')) {
            if ('rejectInvoicesWith' in opts) throw opts.rejectInvoicesWith;
            const lote = Number((sql.match(/DP\.CNTBTCH\s*=\s*(\d+)/) || [])[1]);
            return { recordset: (invoicesByLote[lote] || []).map((row) => ({ ...row })) };
        }
        if (sql.includes('SELECT NoPagoSage')) {
            return { recordset: registered.map((id) => ({ NoPagoSage: id })) };
        }
        throw new Error(`SQL no esperado en la prueba: ${sql.slice(0, 80)}`);
    });
}

// POST simulado por número de pago: cada valor es la respuesta que resuelve, o { reject: valor }.
function routePosts(byDocnbr) {
    mockPortalPost.mockImplementation(async (url, payload) => {
        const outcome = byDocnbr[payload.external_id];
        if (outcome === undefined) throw new Error(`POST no esperado en la prueba: ${payload.external_id}`);
        if ('reject' in outcome) throw outcome.reject;
        return outcome;
    });
}

// Un pago que sube con HTTP 200, para que la corrida recorra el camino completo.
function uploadedScenario(docnbr, lote, extraHeaders = []) {
    routeQueries({
        headers: [paymentRow({ external_id: docnbr, LotePago: lote }), ...extraHeaders],
        invoicesByLote: { [lote]: [invoiceRow({ LotePago: lote })] },
    });
    routePosts({ [docnbr]: { status: 200, data: { id: `portal-${lote}` } } });
}

function readLedger() {
    return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
}

function ledgerPayments() {
    return readLedger().tenants.COPDAT.payments;
}

function ledgerLines() {
    return mockLogGenerator.mock.calls.filter((call) => /\[DAILY-SUMMARY-LEDGER\]/.test(String(call[2])));
}

function insertCalls() {
    return mockRunQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO fesa.dbo.fesaPagosFocaltec'));
}

describe('PortalPaymentController — registro diario de pagos (fase 20.7, plan 05)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // mockReset() vacía las colas y las implementaciones de cada caso (ver cron-where).
        mockRunQuery.mockReset();
        mockPortalPost.mockReset();
        getCurrentDateMock.mockReset();
        getCurrentDateMock.mockImplementation(fixedClock);
        removeTmpLogs();
    });

    afterAll(() => {
        removeTmpLogs();
    });

    describe('D-21: la columna fechaRegistro', () => {
        test('la consulta de encabezados proyecta AUDTDATE como YYYY-MM-DD y se manda a la base de la empresa', async () => {
            routeQueries({ headers: [] });

            await uploadPayments(0);

            const [sql, db] = mockRunQuery.mock.calls[0];
            expect(sql).toContain('CONVERT(VARCHAR(10), CONVERT(Date, CONVERT(VARCHAR(8), P.AUDTDATE)), 23) AS fechaRegistro,');
            expect(sql).not.toMatch(/lastUpdate/);
            expect(db).toBe('COPDAT');
        });
    });

    describe('D-17: cada resultado en su punto', () => {
        test('HTTP 200: uploaded con proveedor y fechaRegistro; el INSERT de control y las 4 llamadas a runQuery quedan igual', async () => {
            routeQueries({
                headers: [paymentRow({ external_id: 'PY0000101', LotePago: 101, provider_external_id: 'V101' })],
                invoicesByLote: { 101: [invoiceRow({ LotePago: 101 })] },
            });
            routePosts({ PY0000101: { status: 200, data: { id: 'portal-101' } } });

            await uploadPayments(0);

            // Encabezados, tabla de control, facturas e INSERT: las cuatro de siempre para un pago.
            expect(mockRunQuery).toHaveBeenCalledTimes(4);
            expect(insertCalls()).toHaveLength(1);
            expect(insertCalls()[0][0]).toMatch(/\('COPDAT',\s*'PY0000101',\s*'PAID',\s*'portal-101'\s*\)/);
            expect(mockPortalPost).toHaveBeenCalledTimes(1);

            const tenant = readLedger().tenants.COPDAT;
            expect(tenant.runs).toBe(1);
            expect(tenant.lastRunAt).toBe(RUN_AT);
            expect(tenant.payments).toEqual({
                PY0000101: {
                    outcome: 'uploaded',
                    code: null,
                    description: null,
                    vendor: 'V101',
                    fechaRegistro: '2026-10-20',
                    attempts: 1,
                    firstAt: RUN_AT,
                    lastAt: RUN_AT,
                },
            });
            expect(ledgerLines()).toHaveLength(0);
        });

        test('RD-10 / RD-14: con y sin registro salen las mismas consultas, los mismos POST y el mismo INSERT', async () => {
            const scenario = () => {
                routeQueries({
                    headers: [
                        paymentRow({ external_id: 'PY0000201', LotePago: 201, provider_external_id: 'V201' }),
                        paymentRow({ external_id: 'PY0000202', LotePago: 202, provider_external_id: 'V202' }),
                        paymentRow({ external_id: 'PY0000203', LotePago: 203, provider_external_id: 'V203' }),
                        paymentRow({ external_id: 'PY0000204', LotePago: 204, provider_external_id: 'V204', PROVIDERID: '' }),
                    ],
                    invoicesByLote: {
                        201: [invoiceRow({ LotePago: 201 })],
                        202: [invoiceRow({ LotePago: 202 })],
                        203: [],
                    },
                });
                routePosts({
                    PY0000201: { status: 200, data: { id: 'portal-201' } },
                    PY0000202: { status: 400, data: { code: 1827, description: 'Alguna factura del pago ya está pagada' } },
                });
            };
            const snapshot = () => ({
                queries: mockRunQuery.mock.calls.map(([sql, db]) => [sql, db]),
                posts: mockPortalPost.mock.calls.map(([url, payload, options]) => [url, payload, options]),
            });

            scenario();
            await uploadPayments(0);
            const withLedger = snapshot();
            expect(Object.keys(ledgerPayments()).sort()).toEqual(['PY0000201', 'PY0000202', 'PY0000203', 'PY0000204']);

            jest.clearAllMocks();
            mockRunQuery.mockReset();
            mockPortalPost.mockReset();
            removeTmpLogs();
            const savedLogs = config.paths.logs;
            delete config.paths.logs;
            try {
                scenario();
                await uploadPayments(0);
            } finally {
                config.paths.logs = savedLogs;
            }
            const withoutLedger = snapshot();
            expect(fs.existsSync(TMP_LOGS)).toBe(false);

            expect(withLedger).toEqual(withoutLedger);
            // Encabezados, control, facturas de 201, 202 y 203 y el INSERT de 201.
            expect(withLedger.queries).toHaveLength(6);
            expect(withLedger.queries.filter(([sql]) => sql.includes('INSERT INTO'))).toHaveLength(1);
            expect(withLedger.posts.map(([url, payload]) => [url, payload.external_id])).toEqual([
                [ENDPOINT, 'PY0000201'],
                [ENDPOINT, 'PY0000202'],
            ]);
        });

        test('HTTP 400 resuelto con { code: 1827, description }: rejected con el código como texto y la descripción del portal', async () => {
            routeQueries({
                headers: [paymentRow({ external_id: 'PY0000301', LotePago: 301, provider_external_id: 'V301' })],
                invoicesByLote: { 301: [invoiceRow({ LotePago: 301 })] },
            });
            routePosts({ PY0000301: { status: 400, data: { code: 1827, description: 'Alguna factura del pago ya está pagada' } } });

            await uploadPayments(0);

            expect(ledgerPayments().PY0000301).toEqual(expect.objectContaining({
                outcome: 'rejected',
                code: '1827',
                description: 'Alguna factura del pago ya está pagada',
                vendor: 'V301',
                fechaRegistro: '2026-10-20',
                attempts: 1,
            }));
            // Un rechazo no escribe en la tabla de control, y la línea error de siempre sigue ahí.
            expect(insertCalls()).toHaveLength(0);
            expect(mockLogGenerator).toHaveBeenCalledWith('PortalPaymentController', 'error',
                expect.stringMatching(/^Error al enviar pago PY0000301: 400 /));
        });

        test('rechazo de axios con response 400 { code: 1800 }: rejected con code "1800", no sin respuesta', async () => {
            routeQueries({
                headers: [paymentRow({ external_id: 'PY0000302', LotePago: 302, provider_external_id: 'V302' })],
                invoicesByLote: { 302: [invoiceRow({ LotePago: 302 })] },
            });
            const axiosError = Object.assign(new Error('Request failed with status code 400'), {
                response: { status: 400, data: { code: 1800, description: 'El proveedor no existe en el portal' } },
            });
            routePosts({ PY0000302: { reject: axiosError } });

            await uploadPayments(0);

            expect(ledgerPayments().PY0000302).toEqual(expect.objectContaining({
                outcome: 'rejected',
                code: '1800',
                description: 'El proveedor no existe en el portal',
                vendor: 'V302',
            }));
            expect(mockLogGenerator).toHaveBeenCalledWith('PortalPaymentController', 'error',
                'Error POST payment: Request failed with status code 400');
        });

        test('HTTP 502 con cuerpo de texto: rejected con code "HTTP 502" y el texto como descripción', async () => {
            routeQueries({
                headers: [paymentRow({ external_id: 'PY0000303', LotePago: 303 })],
                invoicesByLote: { 303: [invoiceRow({ LotePago: 303 })] },
            });
            routePosts({ PY0000303: { status: 502, data: '<html><body>502 Bad Gateway</body></html>' } });

            await uploadPayments(0);

            expect(ledgerPayments().PY0000303).toEqual(expect.objectContaining({
                outcome: 'rejected',
                code: 'HTTP 502',
                description: '<html><body>502 Bad Gateway</body></html>',
            }));
        });

        test('HTTP 400 sin code en la respuesta: rejected con code "HTTP 400" y el cuerpo en JSON', async () => {
            routeQueries({
                headers: [paymentRow({ external_id: 'PY0000304', LotePago: 304 })],
                invoicesByLote: { 304: [invoiceRow({ LotePago: 304 })] },
            });
            routePosts({ PY0000304: { status: 400, data: { message: 'Bad Request', errors: ['cfdis vacío'] } } });

            await uploadPayments(0);

            expect(ledgerPayments().PY0000304).toEqual(expect.objectContaining({
                outcome: 'rejected',
                code: 'HTTP 400',
                description: '{"message":"Bad Request","errors":["cfdis vacío"]}',
            }));
        });

        test('sin respuesta (ECONNABORTED): no-response con el mensaje, y la línea [TIMEOUT] step=uploadPayments se sigue escribiendo', async () => {
            routeQueries({
                headers: [paymentRow({ external_id: 'PY0000305', LotePago: 305, provider_external_id: 'V305' })],
                invoicesByLote: { 305: [invoiceRow({ LotePago: 305 })] },
            });
            const timeout = Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });
            routePosts({ PY0000305: { reject: timeout } });

            await uploadPayments(0);

            expect(ledgerPayments().PY0000305).toEqual(expect.objectContaining({
                outcome: 'no-response',
                code: null,
                description: 'timeout of 30000ms exceeded',
                vendor: 'V305',
                fechaRegistro: '2026-10-20',
            }));
            expect(mockLogGenerator).toHaveBeenCalledWith('PortalPaymentController', 'error',
                `[TIMEOUT] step=uploadPayments tenant=T1 url=${ENDPOINT} durationMs=30000 err=timeout of 30000ms exceeded`);
            expect(insertCalls()).toHaveLength(0);
        });

        test('PROVIDERID vacío: no-provider-id con el proveedor; ese pago no consulta facturas ni llega al POST', async () => {
            routeQueries({
                headers: [
                    paymentRow({ external_id: 'PY0000401', LotePago: 401, provider_external_id: 'V401', PROVIDERID: '' }),
                    paymentRow({ external_id: 'PY0000402', LotePago: 402, provider_external_id: 'V402' }),
                ],
                invoicesByLote: { 402: [invoiceRow({ LotePago: 402 })] },
            });
            routePosts({ PY0000402: { status: 200, data: { id: 'portal-402' } } });

            await uploadPayments(0);

            const payments = ledgerPayments();
            expect(payments.PY0000401).toEqual({
                outcome: 'no-provider-id',
                code: null,
                description: 'Proveedor sin ID del portal',
                vendor: 'V401',
                fechaRegistro: '2026-10-20',
                attempts: 1,
                firstAt: RUN_AT,
                lastAt: RUN_AT,
            });
            expect(payments.PY0000402.outcome).toBe('uploaded');
            expect(mockPortalPost.mock.calls.map(([, payload]) => payload.external_id)).toEqual(['PY0000402']);
            expect(mockRunQuery.mock.calls.some(([sql]) => /DP\.CNTBTCH\s*=\s*401\b/.test(sql))).toBe(false);
        });

        test('dos facturas sin UUID: missing-uuid con las dos facturas y sin POST', async () => {
            routeQueries({
                headers: [paymentRow({ external_id: 'PY0000501', LotePago: 501, provider_external_id: 'V501' })],
                invoicesByLote: {
                    501: [
                        invoiceRow({ LotePago: 501, invoice_external_id: 'FAC-5011', UUID: '' }),
                        invoiceRow({ LotePago: 501, invoice_external_id: 'FAC-5012', UUID: '   ' }),
                        invoiceRow({ LotePago: 501, invoice_external_id: 'FAC-5013' }),
                    ],
                },
            });

            await uploadPayments(0);

            expect(ledgerPayments().PY0000501).toEqual({
                outcome: 'missing-uuid',
                code: null,
                description: '2 factura(s) sin UUID',
                vendor: 'V501',
                fechaRegistro: '2026-10-20',
                attempts: 1,
                firstAt: RUN_AT,
                lastAt: RUN_AT,
                invoices: ['FAC-5011', 'FAC-5012'],
            });
            expect(resolveUuidByFolio).toHaveBeenCalledTimes(2);
            expect(mockPortalPost).not.toHaveBeenCalled();
        });

        test('Sage no devuelve facturas: no-invoices «Sage no devolvió facturas para el pago»', async () => {
            routeQueries({
                headers: [paymentRow({ external_id: 'PY0000601', LotePago: 601, provider_external_id: 'V601' })],
                invoicesByLote: { 601: [] },
            });

            await uploadPayments(0);

            expect(ledgerPayments().PY0000601).toEqual(expect.objectContaining({
                outcome: 'no-invoices',
                code: null,
                description: 'Sage no devolvió facturas para el pago',
                vendor: 'V601',
                fechaRegistro: '2026-10-20',
            }));
            expect(mockPortalPost).not.toHaveBeenCalled();
        });

        test('la consulta de facturas rechaza: no-invoices «No se pudieron leer las facturas en Sage: …»', async () => {
            routeQueries({
                headers: [paymentRow({ external_id: 'PY0000602', LotePago: 602, provider_external_id: 'V602' })],
                rejectInvoicesWith: new Error('Timeout: Request failed to complete in 180000ms'),
            });

            await uploadPayments(0);

            expect(ledgerPayments().PY0000602).toEqual(expect.objectContaining({
                outcome: 'no-invoices',
                description: 'No se pudieron leer las facturas en Sage: Timeout: Request failed to complete in 180000ms',
                vendor: 'V602',
            }));
            // El catch de siempre sigue dejando su línea, y el pago se sigue omitiendo.
            expect(mockLogGenerator).toHaveBeenCalledWith('PortalPaymentController', 'error',
                'Error queryFacturasPagadas: Timeout: Request failed to complete in 180000ms');
            expect(mockPortalPost).not.toHaveBeenCalled();
        });

        test('los pagos que ya están en la tabla de control no se anotan: no se intentaron', async () => {
            routeQueries({
                headers: [
                    paymentRow({ external_id: 'PY0000701', LotePago: 701 }),
                    paymentRow({ external_id: 'PY0000702', LotePago: 702 }),
                ],
                registered: ['PY0000701'],
                invoicesByLote: { 702: [invoiceRow({ LotePago: 702 })] },
            });
            routePosts({ PY0000702: { status: 200, data: { id: 'portal-702' } } });

            await uploadPayments(0);

            expect(Object.keys(ledgerPayments())).toEqual(['PY0000702']);
        });
    });

    describe('D-18: un solo volcado por corrida', () => {
        test('encabezados vacíos (return temprano): el archivo existe con runs 1, sin pagos y sin falla de consulta', async () => {
            routeQueries({ headers: [] });

            await uploadPayments(0);

            expect(readLedger()).toEqual({
                version: 1,
                date: DAY,
                tenants: {
                    COPDAT: { runs: 1, lastRunAt: RUN_AT, queryFailures: 0, lastQueryError: null, runFailures: 0, lastRunError: null, payments: {} },
                },
            });
            expect(mockPortalPost).not.toHaveBeenCalled();
        });

        test('catch externo: el primer pago sube y el segundo lanza; el archivo guarda el primero, marca la corrida interrumpida (WR-05) y notifier.notify se llamó', async () => {
            routeQueries({
                headers: [
                    paymentRow({ external_id: 'PY0000801', LotePago: 801, provider_external_id: 'V801' }),
                    paymentRow({ external_id: 'PY0000802', LotePago: 802, payment_date: null }),
                ],
                invoicesByLote: {
                    801: [invoiceRow({ LotePago: 801 })],
                    802: [invoiceRow({ LotePago: 802 })],
                },
            });
            routePosts({ PY0000801: { status: 200, data: { id: 'portal-801' } } });

            await expect(uploadPayments(0)).resolves.toBeUndefined();

            expect(mockNotify).toHaveBeenCalledTimes(1);
            expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error en uploadPayments' }));
            const tenant = readLedger().tenants.COPDAT;
            expect(tenant.runs).toBe(1);
            expect(tenant.payments).toEqual({
                PY0000801: expect.objectContaining({ outcome: 'uploaded', vendor: 'V801' }),
            });
            // WR-05: la corrida interrumpida queda marcada con su propio campo, para que el resumen no
            // la lea como un día limpio; no es una falla de la consulta de encabezados.
            expect(tenant.runFailures).toBe(1);
            expect(tenant.lastRunError).toBe("Cannot read properties of null (reading 'toString')");
            expect(tenant.queryFailures).toBe(0);
            expect(tenant.lastQueryError).toBeNull();
            expect(insertCalls()).toHaveLength(1);
        });

        test('RD-10: cuatro corridas sobre los mismos 5 pagos rechazados dejan 5 entradas con attempts 4 y runs 4', async () => {
            const docnbrs = ['PY0000901', 'PY0000902', 'PY0000903', 'PY0000904', 'PY0000905'];
            routeQueries({
                headers: docnbrs.map((docnbr, i) => paymentRow({ external_id: docnbr, LotePago: 901 + i, provider_external_id: `V90${i + 1}` })),
                invoicesByLote: Object.fromEntries(docnbrs.map((docnbr, i) => [901 + i, [invoiceRow({ LotePago: 901 + i })]])),
            });
            routePosts(Object.fromEntries(docnbrs.map((docnbr) => [
                docnbr,
                { status: 400, data: { code: 1827, description: 'Alguna factura del pago ya está pagada' } },
            ])));

            for (let run = 0; run < 4; run++) {
                getCurrentDateMock.mockImplementation(() => new Date(2026, 10, 3, 10, 15 + 15 * run, 0));
                await uploadPayments(0);
            }

            const tenant = readLedger().tenants.COPDAT;
            expect(tenant.runs).toBe(4);
            expect(tenant.lastRunAt).toBe('2026-11-03T11:00:00');
            expect(Object.keys(tenant.payments).sort()).toEqual(docnbrs);
            for (const docnbr of docnbrs) {
                expect(tenant.payments[docnbr]).toEqual(expect.objectContaining({
                    outcome: 'rejected',
                    code: '1827',
                    attempts: 4,
                    firstAt: '2026-11-03T10:15:00',
                    lastAt: '2026-11-03T11:00:00',
                }));
            }
            expect(mockPortalPost).toHaveBeenCalledTimes(20);
            expect(insertCalls()).toHaveLength(0);
        });

        test('D-20: con el resumen diario apagado el archivo se escribe igual', async () => {
            expect(config.notifications.dailySummary.enabled).toBe(false);
            uploadedScenario('PY0001001', 1001);

            await uploadPayments(0);

            expect(fs.existsSync(LEDGER_FILE)).toBe(true);
            expect(readLedger().tenants.COPDAT.runs).toBe(1);
            expect(ledgerPayments().PY0001001.outcome).toBe('uploaded');
        });
    });

    describe('D-27: la falla de la consulta de encabezados queda anotada', () => {
        test('la consulta rechaza con un Error: queryFailures 1 y lastQueryError con el mensaje', async () => {
            routeQueries({ rejectHeadersWith: new Error('Connection lost - read ECONNRESET') });

            await uploadPayments(0);

            const tenant = readLedger().tenants.COPDAT;
            expect(tenant).toEqual({
                runs: 1,
                lastRunAt: RUN_AT,
                queryFailures: 1,
                lastQueryError: 'Connection lost - read ECONNRESET',
                runFailures: 0,
                lastRunError: null,
                payments: {},
            });
            expect(mockLogGenerator).toHaveBeenCalledWith('PortalPaymentController', 'error',
                'Error queryEncabezadosPago: Connection lost - read ECONNRESET');
        });

        test('aviso del plan 03: un rechazo que no es Error deja queryError en texto no vacío y la falla cuenta', async () => {
            routeQueries({ rejectHeadersWith: 'conexión cerrada por el servidor' });

            await uploadPayments(0);

            const tenant = readLedger().tenants.COPDAT;
            expect(tenant.queryFailures).toBe(1);
            expect(tenant.lastQueryError).toBe('conexión cerrada por el servidor');
        });

        test('un rechazo sin valor también cuenta: la anotación va antes de las líneas del catch que leen err.message', async () => {
            routeQueries({ rejectHeadersWith: undefined });

            await expect(uploadPayments(0)).resolves.toBeUndefined();

            const tenant = readLedger().tenants.COPDAT;
            expect(tenant.runs).toBe(1);
            expect(tenant.queryFailures).toBe(1);
            expect(typeof tenant.lastQueryError).toBe('string');
            expect(tenant.lastQueryError.trim()).not.toBe('');
        });
    });

    describe('D-19: archivo dañado y fallo de escritura', () => {
        test('un archivo dañado queda válido con recoveredAt en la raíz y un warn recovered en EomNotification; la corrida siguiente lo conserva', async () => {
            fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
            fs.writeFileSync(LEDGER_FILE, 'not json', 'utf8');
            uploadedScenario('PY0001101', 1101);

            await uploadPayments(0);

            const data = readLedger();
            expect(data.version).toBe(1);
            expect(data.date).toBe(DAY);
            // La misma lectura del reloj que da runAt.
            expect(data.recoveredAt).toBe(RUN_AT);
            expect(data.tenants.COPDAT.lastRunAt).toBe(RUN_AT);
            expect(data.tenants.COPDAT.payments.PY0001101.outcome).toBe('uploaded');
            expect(ledgerLines()).toEqual([[
                'EomNotification',
                'warn',
                '[DAILY-SUMMARY-LEDGER] tenant=COPDAT date=2026-11-03 status=recovered previous=corrupt',
            ]]);

            // Una corrida normal después: conserva la marca y no repite el aviso.
            jest.clearAllMocks();
            getCurrentDateMock.mockImplementation(() => new Date(2026, 10, 3, 10, 30, 0));
            uploadedScenario('PY0001102', 1102);

            await uploadPayments(0);

            const after = readLedger();
            expect(after.recoveredAt).toBe(RUN_AT);
            expect(after.tenants.COPDAT.runs).toBe(2);
            expect(Object.keys(after.tenants.COPDAT.payments).sort()).toEqual(['PY0001101', 'PY0001102']);
            expect(ledgerLines()).toHaveLength(0);
        });

        test('si la escritura falla, uploadPayments resuelve, hubo un solo intento y queda un warn write-failed', async () => {
            uploadedScenario('PY0001201', 1201);
            const realRenameSync = fs.renameSync;
            let ledgerRenames = 0;
            const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
                if (to === LEDGER_FILE) {
                    ledgerRenames += 1;
                    throw new Error('EPERM forzado por la prueba');
                }
                return realRenameSync.call(fs, from, to);
            });
            try {
                await expect(uploadPayments(0)).resolves.toBeUndefined();
            } finally {
                renameSpy.mockRestore();
            }

            expect(ledgerRenames).toBe(1);
            expect(fs.existsSync(LEDGER_FILE)).toBe(false);
            // La subida terminó igual: el POST y el INSERT de control ocurrieron.
            expect(mockPortalPost).toHaveBeenCalledTimes(1);
            expect(insertCalls()).toHaveLength(1);
            const lines = ledgerLines();
            expect(lines).toHaveLength(1);
            expect(lines[0][0]).toBe('EomNotification');
            expect(lines[0][1]).toBe('warn');
            expect(lines[0][2]).toMatch(/^\[DAILY-SUMMARY-LEDGER\] tenant=COPDAT date=2026-11-03 status=write-failed err=.*EPERM forzado por la prueba/);
        });
    });

    describe('D-22: sin LOG_PATH o sin reloj, el registro se omite en silencio', () => {
        test('sin config.paths.logs no hay archivo ni línea [DAILY-SUMMARY-LEDGER] y uploadPayments resuelve', async () => {
            uploadedScenario('PY0001301', 1301);
            const savedLogs = config.paths.logs;
            delete config.paths.logs;
            try {
                await expect(uploadPayments(0)).resolves.toBeUndefined();
            } finally {
                config.paths.logs = savedLogs;
            }

            expect(fs.existsSync(TMP_LOGS)).toBe(false);
            expect(ledgerLines()).toHaveLength(0);
            expect(getCurrentDateMock).not.toHaveBeenCalled();
            expect(mockPortalPost).toHaveBeenCalledTimes(1);
            expect(insertCalls()).toHaveLength(1);
        });

        test('sin getCurrentDate en TimezoneHelper no hay archivo ni línea y uploadPayments resuelve', async () => {
            uploadedScenario('PY0001302', 1302);
            delete timezoneMock.getCurrentDate;
            try {
                await expect(uploadPayments(0)).resolves.toBeUndefined();
            } finally {
                timezoneMock.getCurrentDate = getCurrentDateMock;
            }

            expect(fs.existsSync(TMP_LOGS)).toBe(false);
            expect(ledgerLines()).toHaveLength(0);
            expect(mockPortalPost).toHaveBeenCalledTimes(1);
            expect(insertCalls()).toHaveLength(1);
        });

        test('un reloj que no da una fecha válida también omite el registro en silencio', async () => {
            uploadedScenario('PY0001303', 1303);
            getCurrentDateMock.mockImplementation(() => new Date(Number.NaN));

            await expect(uploadPayments(0)).resolves.toBeUndefined();

            expect(fs.existsSync(TMP_LOGS)).toBe(false);
            expect(ledgerLines()).toHaveLength(0);
            expect(mockPortalPost).toHaveBeenCalledTimes(1);
        });
    });
});
