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
const { buildOcDayQuery, buildOcUploadedQuery, buildPaymentsControlQuery, collectDailySummary } = service;
const { recordPaymentRun } = require('../../src/utils/PaymentDayLedger');

const DAY = '2026-11-03';
// El reloj de SQL Server que devuelve la cuenta de OCs subidas (D-35), uno por empresa.
const CLOCK = { sqlDate: '2026-11-03', sqlNow: '2026-11-03 23:45:07', sqlOffsetMin: -360 };
const OTHER_CLOCK = { sqlDate: '2026-11-04', sqlNow: '2026-11-04 05:45:07', sqlOffsetMin: 0 };
const TWO_TENANTS = {
    ...config,
    portal: { tenants: [{ id: 'T1', database: 'COPDAT' }, { id: 'T2', database: 'EMPRESA2' }] },
};

// Doble de runQuery: responde según la marca de cada una de las tres consultas y según la base que
// recibe como segundo argumento. `byDb[base]` acepta ocRows, uploaded, clock y control, y para las
// fallas ocError, uploadedError y controlError (lo que se lance es el motivo del rechazo).
function routeQueries(byDb) {
    return async (sql, db) => {
        const data = Object.prototype.hasOwnProperty.call(byDb, db) ? byDb[db] : {};
        if (sql.includes('COUNT(DISTINCT ocSage)')) {
            if (data.uploadedError) throw data.uploadedError;
            return { recordset: [{ uploaded: data.uploaded ?? 0, ...(data.clock ?? CLOCK) }] };
        }
        if (sql.includes('fesaPagosFocaltec')) {
            if (data.controlError) throw data.controlError;
            return { recordset: (data.control ?? []).map((NoPagoSage) => ({ NoPagoSage })) };
        }
        if (sql.includes("status = 'ERROR'")) {
            if (data.ocError) throw data.ocError;
            return { recordset: data.ocRows ?? [] };
        }
        throw new Error('consulta que el doble no reconoce');
    };
}

// Renglón de OC tal como lo devuelve la consulta de OCs del día.
const ocRow = (idOrPo, lastError, fechaAuth, extra = {}) => ({
    tenant: 'COPDAT', idOrPo, attemptsToday: 2, lastError, isValidation: 0, fechaAuth, ...extra,
});

const rejected = (code, description, vendor, fechaRegistro) => ({ outcome: 'rejected', code, description, vendor, fechaRegistro });

const ledgerFile = () => path.join(tmpRoot, 'sageconnect', DAY, 'daily-summary-payments.json');

// Escribe una corrida de pagos en la carpeta temporal con el módulo real, como lo hace
// uploadPayments al final de cada corrida.
function recordRun(tenantDb, results, runAt = `${DAY}T14:07:00`) {
    const out = recordPaymentRun({ logsRoot: tmpRoot, dateISO: DAY, tenantDb, runAt, results: new Map(results) });
    if (!out.ok) {
        throw new Error(`recordPaymentRun falló: ${out.error}`);
    }
    return out;
}

const groupSizes = (section) => section.groups.map((group) => [group.key, group.rows.length]);
const docnbrsOf = (section) => section.groups.flatMap((group) => group.rows.map((row) => row.docnbr));
const ledgerWarns = () => mockLogGenerator.mock.calls
    .filter(([, level, message]) => level === 'warn' && message.startsWith('[DAILY-SUMMARY-LEDGER]'))
    .map(([, , message]) => message);

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

    // ---- Forma del SQL ----------------------------------------------------------------------

    test('la consulta de OCs parte de las filas ERROR del día, toma el error y la marca de una misma fila y deja fuera lo subido o cerrado (D-11)', () => {
        const sql = buildOcDayQuery('COPDAT', DAY);

        for (const piece of [
            "status = 'ERROR'",
            "idDatabase = 'COPDAT'",
            "createdAt = CAST('2026-11-03' AS DATE)",
            'GROUP BY ocSage',
            'TOP 1',
            "idFocaltec = ''",
            'Autorizada = 1',
            'Autoriza_OC_detalle',
            'NOT EXISTS',
            "status IN ('CLOSED', 'POSTED')",
            'CONVERT(VARCHAR(10)',
            'RTRIM(',
        ]) {
            expect(sql).toContain(piece);
        }
        // Las columnas que lee el modelo (el contrato de ocRows), con la fecha como texto de estilo 23.
        for (const column of ['AS tenant', 'AS idOrPo', 'attemptsToday', 'AS lastError', 'AS isValidation', 'AS fechaAuth']) {
            expect(sql).toContain(column);
        }
        expect(sql).toMatch(/CONVERT\(VARCHAR\(10\), [\w.]+, 23\) AS fechaAuth/);
        for (const piece of ['DATEADD(day', 'DATEFROMPARTS', 'lastUpdate']) {
            expect(sql).not.toContain(piece);
        }
    });

    test('las OCs subidas se cuentan sin repetir sobre las filas POSTED del día, con el reloj de SQL Server en el mismo renglón (D-12, D-35)', () => {
        const sql = buildOcUploadedQuery('COPDAT', DAY);

        expect(sql).toContain('COUNT(DISTINCT ocSage)');
        expect(sql).toContain("status = 'POSTED'");
        expect(sql).toContain("idDatabase = 'COPDAT'");
        expect(sql).toContain("createdAt = CAST('2026-11-03' AS DATE)");
        expect(sql).toContain('CONVERT(VARCHAR(10), GETDATE(), 23) AS sqlDate');
        expect(sql).toContain('AS sqlNow');
        expect(sql).toContain('DATEDIFF(minute, GETUTCDATE(), GETDATE()) AS sqlOffsetMin');
        // Un agregado sin GROUP BY siempre devuelve un renglón: el reloj llega aunque no haya OCs.
        expect(sql).not.toContain('GROUP BY');
    });

    test('la tabla de control de pagos se lee completa por empresa, sin listas de documentos (D-14)', () => {
        const sql = buildPaymentsControlQuery('COPDAT');

        expect(sql.replace(/\s+/g, ' ').trim())
            .toBe("SELECT RTRIM(NoPagoSage) AS NoPagoSage FROM fesa.dbo.fesaPagosFocaltec WHERE idCia = 'COPDAT'");
        expect(sql).not.toContain('IN (');
    });

    test('cada consulta va a la base de su empresa como segundo argumento, en el orden OCs, subidas y control, y todas son de solo lectura', async () => {
        mockRunQuery.mockImplementation(routeQueries({}));

        await collectDailySummary(DAY, config);

        expect(mockRunQuery.mock.calls.map(([sql]) => sql)).toEqual([
            buildOcDayQuery('COPDAT', DAY),
            buildOcUploadedQuery('COPDAT', DAY),
            buildPaymentsControlQuery('COPDAT'),
        ]);
        for (const [sql, db, ...rest] of mockRunQuery.mock.calls) {
            expect(db).toBe('COPDAT');
            expect(rest).toEqual([]);
            expect(sql.trim()).toMatch(/^SELECT\b/);
            expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|MERGE|DROP|TRUNCATE|EXEC)\b/i);
        }
    });

    // ---- Validación de la entrada (T-20.7-26) ------------------------------------------------

    test.each([
        ["2026-11-03'; DROP TABLE x --"],
        ['2026-02-30'],
        ['2026-11-3'],
        [' 2026-11-03'],
        [undefined],
        [20261103],
    ])('la fecha %p se rechaza antes de cualquier consulta', async (badDate) => {
        mockRunQuery.mockImplementation(routeQueries({}));

        await expect(collectDailySummary(badDate, config)).rejects.toThrow('collectDailySummary: fecha inválida');
        expect(mockRunQuery).not.toHaveBeenCalled();
        expect(mockLogGenerator).not.toHaveBeenCalled();
    });

    test("una base \"COP'DAT\" en la config se salta: ninguna consulta la lleva y el correo trae su nota", async () => {
        recordRun('COPDAT', []);
        mockRunQuery.mockImplementation(routeQueries({}));
        const cfg = { ...config, portal: { tenants: [{ id: 'T0', database: "COP'DAT" }, { id: 'T1', database: 'COPDAT' }] } };

        const model = await collectDailySummary(DAY, cfg);

        expect(mockRunQuery).toHaveBeenCalledTimes(3);
        for (const [sql, db] of mockRunQuery.mock.calls) {
            expect(db).toBe('COPDAT');
            expect(sql).not.toContain("COP'DAT");
        }
        // toContain y no la lista exacta: la base saltada tampoco está en el registro de pagos, así
        // que el modelo agrega además su nota de «Sin datos de pagos» (aviso del plan 20.7-04).
        expect(model.notes).toContain("No se pudieron leer las OCs con error de COP'DAT: nombre de base no válido.");
        expect(model.notes).toContain("Sin datos de pagos de COP'DAT ese día.");
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'warn',
            "[DAILY-SUMMARY] date=2026-11-03 tenant=COP'DAT source=oc-errors status=invalid-db-name");
    });

    test.each([[undefined], [null], [12345], ['']])('una base %p, que no es texto o está vacía, se salta sin consultar (test() convertiría undefined, null o el número en un texto que casa)', async (badDb) => {
        mockRunQuery.mockImplementation(routeQueries({}));
        const cfg = { ...config, portal: { tenants: [{ id: 'T9', database: badDb }, { id: 'T1', database: 'COPDAT' }] } };

        const model = await collectDailySummary(DAY, cfg);

        expect(mockRunQuery).toHaveBeenCalledTimes(3);
        expect(mockRunQuery.mock.calls.map(([, db]) => db)).toEqual(['COPDAT', 'COPDAT', 'COPDAT']);
        expect(model.notes).toContain('No se pudieron leer las OCs con error de una empresa: nombre de base no válido.');
    });

    // ---- De punta a punta, con el registro de pagos real --------------------------------------

    test('RD-05: tres OCs, dos con el mismo código del portal y una de validación, dan dos grupos de 2 y 1', async () => {
        recordRun('COPDAT', []);
        mockRunQuery.mockImplementation(routeQueries({ COPDAT: { ocRows: [
            ocRow('PO0000101', '1300: OC duplicada en el portal', '2026-10-20'),
            ocRow('PO0000102', '1300: OC duplicada en el portal', '2026-10-21'),
            ocRow('PO0000103', '"provider_external_id" is required', '2026-10-28', { isValidation: 1 }),
        ] } }));

        const model = await collectDailySummary(DAY, config);

        expect(groupSizes(model.sections.oc)).toEqual([['portal-1300', 2], ['validation', 1]]);
        expect(model.sections.oc.groups[0].rows.map((row) => row.idOrPo)).toEqual(['PO0000101', 'PO0000102']);
        expect(model.counts.ocPending).toBe(3);
        expect(model.notes).toEqual([]);
    });

    test('RD-06: dos rechazos 1827 y uno 1800 dan dos grupos de 2 y 1; ni el pago con fila de control ni el que se subió más tarde aparecen', async () => {
        recordRun('COPDAT', [
            ['PY0000201', rejected('1827', 'Alguna factura del pago ya está pagada', 'PROV01', '2026-10-10')],
            ['PY0000202', rejected('1827', 'Alguna factura del pago ya está pagada', 'PROV02', '2026-10-12')],
            ['PY0000203', rejected('1800', 'El pago no es válido', 'PROV03', '2026-10-14')],
            ['PY0000204', rejected('1827', 'Alguna factura del pago ya está pagada', 'PROV04', '2026-10-15')],
            ['PY0000205', rejected('1300', 'Error del portal', 'PROV05', '2026-10-16')],
        ]);
        recordRun('COPDAT', [['PY0000205', { outcome: 'uploaded', vendor: 'PROV05', fechaRegistro: '2026-10-16' }]], `${DAY}T14:22:00`);
        // La columna es char: la tabla de control llega con relleno a la derecha.
        mockRunQuery.mockImplementation(routeQueries({ COPDAT: { control: ['PY0000204   ', 'PY0000205   '] } }));

        const model = await collectDailySummary(DAY, config);

        expect(groupSizes(model.sections.rejected)).toEqual([['portal-1827', 2], ['portal-1800', 1]]);
        expect(docnbrsOf(model.sections.rejected)).not.toContain('PY0000204');
        expect(docnbrsOf(model.sections.rejected)).not.toContain('PY0000205');
        expect(model.counts.paymentsPending).toBe(3);
        expect(model.counts.paymentsUploaded).toBe(1);
    });

    test('RD-07: el proveedor sin ID con sus 3 pagos, el pago con 2 facturas sin UUID y el pago sin facturas van a su propia sección', async () => {
        recordRun('COPDAT', [
            ['PY0000301', { outcome: 'no-provider-id', vendor: 'PROV05', fechaRegistro: '2026-10-20' }],
            ['PY0000302', { outcome: 'no-provider-id', vendor: 'PROV05', fechaRegistro: '2026-10-21' }],
            ['PY0000303', { outcome: 'no-provider-id', vendor: 'PROV05', fechaRegistro: '2026-10-22' }],
            ['PY0000304', { outcome: 'missing-uuid', vendor: 'PROV06', fechaRegistro: '2026-10-23', description: '2 factura(s) sin UUID', invoices: ['FAC-1001', 'FAC-1002'] }],
            ['PY0000305', { outcome: 'no-invoices', vendor: 'PROV07', fechaRegistro: '2026-10-24', description: 'Sage no devolvió facturas para el pago' }],
        ]);
        mockRunQuery.mockImplementation(routeQueries({}));

        const model = await collectDailySummary(DAY, config);

        const sage = Object.fromEntries(model.sections.sage.groups.map((group) => [group.key, group.rows]));
        expect(sage['no-provider-id']).toHaveLength(1);
        expect(sage['no-provider-id'][0].vendor).toBe('PROV05');
        expect(sage['no-provider-id'][0].payments.map((payment) => payment.docnbr)).toEqual(['PY0000301', 'PY0000302', 'PY0000303']);
        expect(sage['missing-uuid']).toHaveLength(1);
        expect(sage['missing-uuid'][0]).toMatchObject({ docnbr: 'PY0000304', invoices: ['FAC-1001', 'FAC-1002'] });
        expect(sage['no-invoices']).toHaveLength(1);
        expect(sage['no-invoices'][0]).toMatchObject({ docnbr: 'PY0000305', detail: 'Sage no devolvió facturas para el pago' });
        expect(model.sections.rejected.groups).toEqual([]);
        expect(model.counts.paymentsPending).toBe(5);
    });

    test('RD-04: 12 OCs subidas, 3 OCs sin éxito, 30 pagos subidos y 2 sin éxito salen en las cifras', async () => {
        const uploadedPayments = Array.from({ length: 30 }, (_, i) => [
            `PY00011${String(i).padStart(2, '0')}`,
            { outcome: 'uploaded', vendor: 'PROV01', fechaRegistro: '2026-10-30' },
        ]);
        recordRun('COPDAT', [
            ...uploadedPayments,
            ['PY0000401', rejected('1827', 'Alguna factura del pago ya está pagada', 'PROV02', '2026-10-25')],
            ['PY0000402', { outcome: 'no-response', description: 'timeout of 30000ms exceeded', vendor: 'PROV03', fechaRegistro: '2026-10-26' }],
        ]);
        mockRunQuery.mockImplementation(routeQueries({ COPDAT: { uploaded: 12, ocRows: [
            ocRow('PO0000401', '1300: OC duplicada en el portal', '2026-10-20'),
            ocRow('PO0000402', 'timeout of 30000ms exceeded', '2026-10-21'),
            ocRow('PO0000403', 'undefined: undefined', '2026-10-22'),
        ] } }));

        const model = await collectDailySummary(DAY, config);

        expect(model.counts).toEqual({ ocUploaded: 12, paymentsUploaded: 30, ocPending: 3, paymentsPending: 2, lastDay: 0 });
        expect(model.pendingTotal).toBe(5);
    });

    test('RD-09: sin filas ERROR y con un registro sin fallos, el día sale sin pendientes, sin notas y sin avisos', async () => {
        recordRun('COPDAT', [['PY0000501', { outcome: 'uploaded', vendor: 'PROV01', fechaRegistro: '2026-10-30' }]]);
        mockRunQuery.mockImplementation(routeQueries({ COPDAT: { uploaded: 5 } }));

        const model = await collectDailySummary(DAY, config);

        expect(model.pendingTotal).toBe(0);
        expect(model.notes).toEqual([]);
        expect(model.incomplete).toBe(false);
        expect(model.counts).toEqual({ ocUploaded: 5, paymentsUploaded: 1, ocPending: 0, paymentsPending: 0, lastDay: 0 });
        expect(mockLogGenerator).not.toHaveBeenCalled();
    });

    // ---- Fallas parciales (D-27) -------------------------------------------------------------

    test('D-27: si falla la consulta de OCs de la primera empresa, la segunda sale completa, el correo lo dice y queda un warn', async () => {
        recordRun('COPDAT', []);
        recordRun('EMPRESA2', []);
        mockRunQuery.mockImplementation(routeQueries({
            COPDAT: { ocError: new Error('Login failed for user'), uploaded: 4 },
            EMPRESA2: { uploaded: 3, ocRows: [ocRow('PO0000501', '1300: OC duplicada en el portal', '2026-10-20', { tenant: 'EMPRESA2' })] },
        }));

        const model = await collectDailySummary(DAY, TWO_TENANTS);

        expect(mockRunQuery.mock.calls.map(([, db]) => db)).toEqual(['COPDAT', 'COPDAT', 'COPDAT', 'EMPRESA2', 'EMPRESA2', 'EMPRESA2']);
        expect(model.sections.oc.groups.flatMap((group) => group.rows.map((row) => [row.tenant, row.idOrPo])))
            .toEqual([['EMPRESA2', 'PO0000501']]);
        expect(model.counts.ocPending).toBe(1);
        expect(model.counts.ocUploaded).toBe(7);
        expect(model.notes).toEqual(['No se pudieron leer las OCs con error de COPDAT: Login failed for user.']);
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'warn',
            '[DAILY-SUMMARY] date=2026-11-03 tenant=COPDAT source=oc-errors status=query-failed err=Login failed for user');
    });

    test('D-27: si falla la tabla de control, el correo lo dice y los pagos pendientes se listan igual', async () => {
        recordRun('COPDAT', [['PY0000601', rejected('1827', 'Alguna factura del pago ya está pagada', 'PROV01', '2026-10-20')]]);
        mockRunQuery.mockImplementation(routeQueries({ COPDAT: { controlError: new Error('Timeout: Request failed to complete in 180000ms') } }));

        const model = await collectDailySummary(DAY, config);

        expect(model.notes).toContain('No se pudo leer la tabla de control de pagos de COPDAT: Timeout: Request failed to complete in 180000ms. Algunos pagos de la lista pudieron subirse después.');
        expect(docnbrsOf(model.sections.rejected)).toEqual(['PY0000601']);
        expect(model.counts.paymentsPending).toBe(1);
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'warn',
            '[DAILY-SUMMARY] date=2026-11-03 tenant=COPDAT source=payments-control status=query-failed err=Timeout: Request failed to complete in 180000ms');
    });

    test('una falla con un mensaje de varios renglones, o que no es un Error, deja su warn en un solo renglón', async () => {
        recordRun('COPDAT', []);
        mockRunQuery.mockImplementation(routeQueries({ COPDAT: {
            ocError: new Error('Invalid object name\n   en la consulta'),
            controlError: 'texto suelto',
        } }));

        const model = await collectDailySummary(DAY, config);

        expect(mockLogGenerator.mock.calls.map(([, , message]) => message)).toEqual([
            '[DAILY-SUMMARY] date=2026-11-03 tenant=COPDAT source=oc-errors status=query-failed err=Invalid object name en la consulta',
            '[DAILY-SUMMARY] date=2026-11-03 tenant=COPDAT source=payments-control status=query-failed err=texto suelto',
        ]);
        expect(model.notes).toContain('No se pudieron leer las OCs con error de COPDAT: Invalid object name en la consulta.');
    });

    test('un resultado sin arreglo de renglones cuenta como falla de esa fuente y no como día vacío', async () => {
        const route = routeQueries({});
        mockRunQuery.mockImplementation(async (sql, db) => (sql.includes('COUNT(DISTINCT ocSage)') ? {} : route(sql, db)));

        const model = await collectDailySummary(DAY, config);

        expect(model.counts.ocUploaded).toBeNull();
        expect(model.notes).toContain('No se pudieron contar las OCs subidas de COPDAT: la consulta no devolvió renglones.');
    });

    // ---- Registro de pagos (D-19) ------------------------------------------------------------

    test('D-19: sin registro del día queda un warn status=missing, el correo dice que no hay datos de pagos y no se crea nada en disco', async () => {
        mockRunQuery.mockImplementation(routeQueries({}));

        const model = await collectDailySummary(DAY, config);

        expect(ledgerWarns()).toEqual(['[DAILY-SUMMARY-LEDGER] date=2026-11-03 status=missing']);
        expect(model.notes).toContain('Sin datos de pagos de ese día: no hay registro de la subida de pagos.');
        expect(model.counts.paymentsUploaded).toBeNull();
        expect(model.counts.paymentsPending).toBeNull();
        expect(fs.existsSync(path.join(tmpRoot, 'sageconnect'))).toBe(false);
    });

    test("D-19: un registro con 'not json' deja un warn status=unreadable, el correo dice que no se pudo leer y el archivo no se toca", async () => {
        fs.mkdirSync(path.dirname(ledgerFile()), { recursive: true });
        fs.writeFileSync(ledgerFile(), 'not json');
        mockRunQuery.mockImplementation(routeQueries({}));

        const model = await collectDailySummary(DAY, config);

        const warns = ledgerWarns();
        expect(warns).toHaveLength(1);
        expect(warns[0]).toMatch(/^\[DAILY-SUMMARY-LEDGER\] date=2026-11-03 status=unreadable err=JSON inválido: \S/);
        expect(model.notes).toContain('Sin datos de pagos de ese día: el registro de pagos no se pudo leer.');
        expect(model.counts.paymentsPending).toBeNull();
        expect(fs.readFileSync(ledgerFile(), 'utf8')).toBe('not json');
    });

    test('si la ruta del registro no se puede armar, el registro cuenta como ilegible y la recolección sigue', async () => {
        mockRunQuery.mockImplementation(routeQueries({}));

        const model = await collectDailySummary(DAY, { ...config, paths: {} });

        expect(ledgerWarns()).toEqual(['[DAILY-SUMMARY-LEDGER] date=2026-11-03 status=unreadable err=ledgerFilePath: logsRoot debe ser texto no vacío']);
        expect(model.notes).toContain('Sin datos de pagos de ese día: el registro de pagos no se pudo leer.');
        expect(mockRunQuery).toHaveBeenCalledTimes(3);
    });

    test('D-19: un registro que recordPaymentRun reinició llega al modelo con su recoveredAt y la nota dice la hora', async () => {
        fs.mkdirSync(path.dirname(ledgerFile()), { recursive: true });
        fs.writeFileSync(ledgerFile(), 'not json');
        const run = recordPaymentRun({
            logsRoot: tmpRoot,
            dateISO: DAY,
            tenantDb: 'COPDAT',
            runAt: '2026-11-03T14:07:00',
            results: new Map([['PY0000701', rejected('1827', 'Alguna factura del pago ya está pagada', 'PROV01', '2026-10-20')]]),
        });
        expect(run).toMatchObject({ ok: true, previous: 'corrupt', recovered: true });
        mockRunQuery.mockImplementation(routeQueries({}));

        const model = await collectDailySummary(DAY, config);

        expect(model.notes).toContain('Datos de pagos incompletos: el registro se reinició a las 14:07.');
        expect(model.incomplete).toBe(true);
        expect(docnbrsOf(model.sections.rejected)).toEqual(['PY0000701']);
        expect(ledgerWarns()).toEqual([]);
    });

    // ---- Reloj de SQL Server (D-35) ----------------------------------------------------------

    test('clock del modelo = { sqlDate, sqlNow, sqlOffsetMin } del primer renglón de cuenta', async () => {
        mockRunQuery.mockImplementation(routeQueries({ COPDAT: { uploaded: 2 }, EMPRESA2: { uploaded: 1, clock: OTHER_CLOCK } }));

        const model = await collectDailySummary(DAY, TWO_TENANTS);

        expect(model.clock).toEqual(CLOCK);
        expect(model.counts.ocUploaded).toBe(3);
    });

    test('si la cuenta de la primera empresa falla, el reloj sale del renglón de la siguiente', async () => {
        mockRunQuery.mockImplementation(routeQueries({
            COPDAT: { uploadedError: new Error('Timeout') },
            EMPRESA2: { uploaded: 1, clock: OTHER_CLOCK },
        }));

        const model = await collectDailySummary(DAY, TWO_TENANTS);

        expect(model.clock).toEqual(OTHER_CLOCK);
        expect(model.notes).toContain('No se pudieron contar las OCs subidas de COPDAT: Timeout.');
    });

    test('sin ninguna cuenta legible el reloj es null y la cifra de OCs subidas también', async () => {
        mockRunQuery.mockImplementation(routeQueries({ COPDAT: { uploadedError: new Error('Timeout') } }));

        const model = await collectDailySummary(DAY, config);

        expect(model.clock).toBeNull();
        expect(model.counts.ocUploaded).toBeNull();
    });

    // ---- Sin el envío de correo (D-01) -------------------------------------------------------

    test('requerir el servicio y recolectar no carga el envío de correo (D-01)', async () => {
        mockRunQuery.mockImplementation(routeQueries({}));
        // Registros de módulos y de dobles limpios; sin ellos la afirmación sería vacía. La fábrica
        // del doble solo corre la primera vez que se instancia y el reinicio de los dobles borraría
        // esa llamada. Además, isolateModulesAsync por sí solo no basta: si el doble ya se instanció
        // en el registro de afuera (por ejemplo, porque la cabecera del servicio lo cargó en el
        // require de arriba de este archivo), dentro del bloque aislado Jest devuelve esa instancia
        // sin volver a correr la fábrica. resetModules vacía también el registro de dobles de afuera.
        jest.resetModules();
        mockEmailSenderLoaded.mockClear();

        await jest.isolateModulesAsync(async () => {
            const isolated = require('../../src/services/DailySummaryService');
            await isolated.collectDailySummary(DAY, config);
        });

        expect(mockRunQuery).toHaveBeenCalledTimes(3);
        expect(mockEmailSenderLoaded).not.toHaveBeenCalled();
    });

    test('control del caso anterior: con los registros limpios, cargar EmailSender sí corre la fábrica de su doble', async () => {
        jest.resetModules();
        mockEmailSenderLoaded.mockClear();

        await jest.isolateModulesAsync(async () => {
            require('../../src/utils/EmailSender');
        });

        expect(mockEmailSenderLoaded).toHaveBeenCalledTimes(1);
    });
});
