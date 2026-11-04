// tests/services/DailySummaryService.test.js (NUEVO — Fase 20.7, planes 20.7-06 y 20.7-07)
//
// Recolección del resumen diario (src/services/DailySummaryService.js): la forma de sus tres
// consultas, la base explícita en cada una, la validación de la fecha antes del SQL, las fallas
// parciales y el modelo que sale de punta a punta. Despacho (plan 20.7-07): el estado de cada día
// en disco, el intento anotado antes de enviar, el tope de 4 intentos, la reposición del día
// anterior y que nunca lance, con relojes simulados y el estado real en la carpeta temporal.
//
// Dobles, calcados de tests/integration/payment-report-dispatch.test.js:
// - config, con la carpeta de bitácoras en un temporal de os.tmpdir() propio de este proceso;
// - LogGenerator y SQLServerConnection.runQuery: no hay base de datos local (HANDOFF §6), así que
//   las consultas se prueban por su texto y con runQuery simulado;
// - EmailSender: su fábrica anota cada carga en mockEmailSenderLoaded, para poder afirmar que la
//   recolección no carga el envío y que el despacho solo lo carga al intentar (D-01). El despacho
//   manda por sendOperatorReport, cuyo doble falla por VALOR DE RETORNO, nunca rechazando (D-38).
// PaymentDayLedger, EomNotification y DailySummary van reales: el registro y el estado del día se
// escriben y se leen de verdad en la carpeta temporal, y el modelo es el mismo que recibiría el
// correo.

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
const { localStamp, buildDailySummarySubject } = require('../../src/utils/DailySummary');

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

    test('WR-02: un registro que no se puede leer por E/S (EBUSY) se trata como ilegible: warn status=unreadable, la nota «no se pudo leer» y el archivo no se toca', async () => {
        recordRun('COPDAT', [['PY0000601', rejected('1827', 'Alguna factura del pago ya está pagada', 'PROV01', '2026-10-20')]]);
        const before = fs.readFileSync(ledgerFile());
        mockRunQuery.mockImplementation(routeQueries({}));
        const realReadFileSync = fs.readFileSync;
        const readSpy = jest.spyOn(fs, 'readFileSync').mockImplementation((file, ...rest) => {
            if (String(file) === ledgerFile()) {
                throw Object.assign(new Error('EBUSY: resource busy or locked, open'), { code: 'EBUSY' });
            }
            return realReadFileSync.call(fs, file, ...rest);
        });
        let model;
        try {
            model = await collectDailySummary(DAY, config);
        } finally {
            readSpy.mockRestore();
        }

        expect(ledgerWarns()).toEqual(['[DAILY-SUMMARY-LEDGER] date=2026-11-03 status=unreadable err=EBUSY: resource busy or locked, open']);
        expect(model.notes).toContain('Sin datos de pagos de ese día: el registro de pagos no se pudo leer.');
        expect(model.counts.paymentsPending).toBeNull();
        expect(model.incomplete).toBe(true);
        expect(fs.readFileSync(ledgerFile()).equals(before)).toBe(true);
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

    test('WR-05: una corrida de pagos interrumpida llega al correo como nota y, sin otros pendientes, el asunto dice «datos incompletos», no «sin pendientes»', async () => {
        const run = recordPaymentRun({
            logsRoot: tmpRoot,
            dateISO: DAY,
            tenantDb: 'COPDAT',
            runAt: '2026-11-03T14:07:00',
            results: new Map([['PY0000801', { outcome: 'uploaded', vendor: 'PROV01', fechaRegistro: '2026-10-30' }]]),
            runError: "Cannot read properties of null (reading 'toString')",
        });
        expect(run.ok).toBe(true);
        mockRunQuery.mockImplementation(routeQueries({ COPDAT: { uploaded: 4 } }));

        const model = await collectDailySummary(DAY, config);

        expect(model.notes).toEqual(["La subida de pagos de COPDAT se interrumpió en 1 de 1 corridas del día (último error: Cannot read properties of null (reading 'toString'))."]);
        expect(model.incomplete).toBe(true);
        expect(model.pendingTotal).toBe(0);
        expect(buildDailySummarySubject(model)).toBe('[SageConnect] Resumen del día 2026-11-03 — datos incompletos');
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

describe('dispatchDailySummaryIfDue', () => {
    const { dispatchDailySummaryIfDue, readDayState, dayStatePath } = service;
    const D = '2026-11-03';
    const D1 = '2026-11-04';
    const SUMMARY = { enabled: true, hour: 23, minute: 45 };
    const ON = { ...config, notifications: { dailySummary: SUMMARY } };
    const OFF = { ...config, notifications: { dailySummary: { ...SUMMARY, enabled: false } } };
    const ECONNREFUSED = 'connect ECONNREFUSED 127.0.0.1:25';

    // Relojes locales, como el `date` de forResponse; noviembre es el mes 10.
    const at = (d, h, min) => new Date(2026, 10, d, h, min);
    const runAt = (y, m, d, h, min, cfg = ON) => dispatchDailySummaryIfDue(new Date(y, m, d, h, min), cfg);

    // El estado de un día tal como quedó en la carpeta temporal, o null si no existe.
    const stateOf = (dateISO) => {
        const file = dayStatePath(tmpRoot, dateISO);
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    };
    const writeRawState = (dateISO, content) => {
        const file = dayStatePath(tmpRoot, dateISO);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    };
    const subjects = () => mockSendOperatorReport.mock.calls.map(([args]) => args.subject);
    // [nivel, mensaje] de las líneas de la bitácora de avisos que empiezan con `prefix`.
    const logged = (prefix) => mockLogGenerator.mock.calls
        .filter(([file, , message]) => file === 'EomNotification' && message.startsWith(prefix))
        .map(([, level, message]) => [level, message]);
    // Solo las líneas de intento, las que llevan las cifras.
    const attemptLines = () => logged('[DAILY-SUMMARY] date=')
        .filter(([, message]) => / attempt=\d+\/4 sent=(true|false) oc-uploaded=/.test(message));

    // renameSync que lanza para el estado del día cuando `shouldFail(n)` lo pide (n cuenta las
    // escrituras de ese archivo desde 1) y que deja pasar todo lo demás. Es la última pieza de la
    // escritura atómica, así que el archivo final no cambia.
    const failStateRename = (message, shouldFail = () => true) => {
        const realRenameSync = fs.renameSync;
        let writes = 0;
        return jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
            if (String(to).endsWith('daily-summary.json')) {
                writes += 1;
                if (shouldFail(writes)) {
                    throw new Error(message);
                }
            }
            return realRenameSync.call(fs, from, to);
        });
    };

    // readFileSync que lanza un error de E/S con su código para el estado de `dateISO` y deja pasar
    // todo lo demás (WR-01): el archivo en disco está bien y lo que falla es su lectura.
    const failStateRead = (dateISO, code, message) => {
        const realReadFileSync = fs.readFileSync;
        const target = dayStatePath(tmpRoot, dateISO);
        return jest.spyOn(fs, 'readFileSync').mockImplementation((file, ...rest) => {
            if (String(file) === target) {
                throw Object.assign(new Error(message), { code });
            }
            return realReadFileSync.call(fs, file, ...rest);
        });
    };

    beforeEach(() => {
        // El doble por omisión AFIRMA la entrega: un valor ausente cuenta como no entregado y cada
        // caso de éxito pasaría a ser un intento fallido (S-2, 20.6 D-14).
        mockSendOperatorReport.mockResolvedValue({ delivered: true, error: null });
        mockRunQuery.mockImplementation(routeQueries({}));
    });

    test('exporta dayStatePath, readDayState y el despacho; el estado va en la carpeta del día (D-04)', () => {
        expect(typeof dispatchDailySummaryIfDue).toBe('function');
        expect(typeof readDayState).toBe('function');
        expect(dayStatePath(tmpRoot, D)).toBe(path.join(tmpRoot, 'sageconnect', D, 'daily-summary.json'));
        for (const badRoot of ['', '   ', undefined, 12]) {
            expect(() => dayStatePath(badRoot, D)).toThrow(TypeError);
        }
        // La fecha entra en una ruta: nada que no sea una fecha real YYYY-MM-DD.
        for (const badDate of ['../../x', '2026-11-3', '2026-02-30', undefined]) {
            expect(() => dayStatePath(tmpRoot, badDate)).toThrow(TypeError);
        }
    });

    test('readDayState distingue un estado ausente, uno válido, uno dañado y uno que no se pudo leer, y nunca lanza (T-20.7-33, WR-01)', () => {
        expect(readDayState(tmpRoot, D)).toEqual({ status: 'missing' });

        const valid = { date: D, status: 'pending', attempts: [{ at: '2026-11-03T23:45:00', delivered: false, error: 'x' }] };
        writeRawState(D, JSON.stringify(valid));
        expect(readDayState(tmpRoot, D)).toEqual({ status: 'ok', data: valid });

        // Dañado es solo el contenido: un JSON que no se puede leer o con una forma que no se reconoce.
        for (const content of [
            'not json',
            JSON.stringify({ ...valid, date: D1 }),
            JSON.stringify({ ...valid, status: 'otro' }),
            JSON.stringify({ ...valid, status: 'delivered' }),
            '[]',
            'null',
        ]) {
            writeRawState(D, content);
            expect(readDayState(tmpRoot, D)).toEqual({ status: 'corrupt' });
        }
        // Una carpeta en el lugar del archivo es un error de lectura, no un estado ausente ni un
        // contenido dañado (WR-01): sale unreadable con el error.
        const file = dayStatePath(tmpRoot, D);
        fs.rmSync(file);
        fs.mkdirSync(file);
        expect(readDayState(tmpRoot, D)).toEqual({ status: 'unreadable', error: expect.stringContaining('EISDIR') });
        // Sin ruta tampoco se leyó nada.
        expect(readDayState(undefined, D)).toEqual({ status: 'unreadable', error: 'dayStatePath: logsRoot debe ser texto no vacío' });
    });

    test.each([
        ['enabled en false', OFF],
        ["enabled con el texto 'true'", { ...config, notifications: { dailySummary: { ...SUMMARY, enabled: 'true' } } }],
        ['notifications sin la llave dailySummary', { ...config, notifications: {} }],
        ['config sin notifications', config],
        ['sin config', undefined],
    ])('apagado (%s): no lee ni escribe estado, no consulta, no envía y no deja bitácora (D-06, D-34, D-40)', async (_label, cfg) => {
        const readSpy = jest.spyOn(fs, 'readFileSync');
        try {
            await expect(dispatchDailySummaryIfDue(at(3, 23, 45), cfg)).resolves.toBeUndefined();
            await expect(dispatchDailySummaryIfDue(at(4, 0, 0), cfg)).resolves.toBeUndefined();
            expect(readSpy.mock.calls.filter(([file]) => String(file).endsWith('daily-summary.json'))).toEqual([]);
        } finally {
            readSpy.mockRestore();
        }

        expect(mockRunQuery).not.toHaveBeenCalled();
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(tmpRoot, 'sageconnect'))).toBe(false);
        expect(mockLogGenerator).not.toHaveBeenCalled();
    });

    test('encendido sin carpeta de bitácoras: una sola línea de error, sin consultas ni envío (D-08)', async () => {
        await expect(dispatchDailySummaryIfDue(at(3, 23, 45), { ...ON, paths: {} })).resolves.toBeUndefined();

        expect(mockLogGenerator.mock.calls).toEqual([['EomNotification', 'error', '[DAILY-SUMMARY] status=no-log-path']]);
        expect(mockRunQuery).not.toHaveBeenCalled();
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
    });

    test('RD-01: a las 23:30 crea el día sin enviar; a las 23:45 sale un correo con la fecha; a las 23:50 ya no sale otro', async () => {
        await runAt(2026, 10, 3, 23, 30);
        expect(stateOf(D)).toEqual({ date: D, status: 'pending', attempts: [] });
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        // Crear el día no deja bitácora: nada de una línea por ejecución (D-34).
        expect(mockLogGenerator).not.toHaveBeenCalled();

        await runAt(2026, 10, 3, 23, 45);
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        const [args] = mockSendOperatorReport.mock.calls[0];
        expect(args.subject).toContain('Resumen del día 2026-11-03');
        expect(args.callerLogFile).toBe('EomNotification');
        expect(args.html).toContain('<h1>SageConnect: Resumen del día 2026-11-03</h1>');
        // Solo el canal del operador (T-20.7-35).
        expect(mockSendMail).not.toHaveBeenCalled();
        expect(stateOf(D)).toEqual({ date: D, status: 'delivered', attempts: [{ at: '2026-11-03T23:45:00', delivered: true, error: null }] });
        expect(attemptLines()).toEqual([['info',
            '[DAILY-SUMMARY] date=2026-11-03 attempt=1/4 sent=true oc-uploaded=0 payments-uploaded=n/a oc-pending=0 payments-pending=n/a last-day=0 incomplete=true']]);
        // El reloj de SQL Server del doble dice el mismo día: no hay línea de reloj.
        expect(logged('[DAILY-SUMMARY-CLOCK]')).toEqual([]);
        const linesAfter2345 = mockLogGenerator.mock.calls.length;

        await runAt(2026, 10, 3, 23, 50);
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(mockLogGenerator.mock.calls.length).toBe(linesAfter2345);
    });

    test('D-08: al recolectar y durante el envío, el estado en disco ya trae el intento anotado con delivered: null', async () => {
        const seen = { collecting: null, sending: null };
        const snapshot = () => {
            try {
                return JSON.parse(fs.readFileSync(dayStatePath(tmpRoot, D), 'utf8'));
            } catch (err) {
                return { readError: err.message };
            }
        };
        const route = routeQueries({});
        mockRunQuery.mockImplementation(async (sql, db) => {
            if (seen.collecting === null) {
                seen.collecting = snapshot();
            }
            return route(sql, db);
        });
        mockSendOperatorReport.mockImplementation(async () => {
            seen.sending = snapshot();
            return { delivered: true, error: null };
        });

        await runAt(2026, 10, 3, 23, 45);

        const noted = { date: D, status: 'pending', attempts: [{ at: '2026-11-03T23:45:00', delivered: null, error: null }] };
        expect(seen).toEqual({ collecting: noted, sending: noted });
        expect(stateOf(D)).toEqual({ date: D, status: 'delivered', attempts: [{ at: '2026-11-03T23:45:00', delivered: true, error: null }] });
    });

    test('D-08: si no se puede anotar el intento, no se recolecta ni se envía y queda un error state-write-failed', async () => {
        // El día ya existe: la única escritura de las 23:45 es la del intento.
        await runAt(2026, 10, 3, 23, 30);
        const renameSpy = failStateRename('EPERM: operation not permitted, rename');
        try {
            await expect(runAt(2026, 10, 3, 23, 45)).resolves.toBeUndefined();
        } finally {
            renameSpy.mockRestore();
        }

        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(mockRunQuery).not.toHaveBeenCalled();
        expect(mockLogGenerator.mock.calls).toEqual([['EomNotification', 'error',
            '[DAILY-SUMMARY] date=2026-11-03 attempt=1/4 sent=false status=state-write-failed err=EPERM: operation not permitted, rename']]);
        expect(stateOf(D)).toEqual({ date: D, status: 'pending', attempts: [] });
    });

    test('D-08: si no se puede crear el día, en esa ejecución no se intenta aunque la escritura siguiente sí funcionaría', async () => {
        const renameSpy = failStateRename('EBUSY: resource busy or locked, rename', (n) => n === 1);
        try {
            await runAt(2026, 10, 3, 23, 45);
        } finally {
            renameSpy.mockRestore();
        }

        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(stateOf(D)).toBeNull();
        expect(mockLogGenerator.mock.calls).toEqual([['EomNotification', 'error',
            '[DAILY-SUMMARY] date=2026-11-03 status=state-write-failed err=EBUSY: resource busy or locked, rename']]);

        // La ejecución siguiente crea el día y hace su primer intento.
        await runAt(2026, 10, 3, 23, 50);
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(stateOf(D)).toEqual({ date: D, status: 'delivered', attempts: [{ at: '2026-11-03T23:50:00', delivered: true, error: null }] });
    });

    test('D-08: si no se puede completar el intento después del envío, queda el error, el intento se queda en null y no hay reenvío inmediato', async () => {
        await runAt(2026, 10, 3, 23, 30);
        // A las 23:45 la 1.ª escritura del estado es la del intento y la 2.ª la que lo completa.
        const renameSpy = failStateRename('ENOSPC: no space left on device, rename', (n) => n === 2);
        try {
            await runAt(2026, 10, 3, 23, 45);
        } finally {
            renameSpy.mockRestore();
        }

        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(stateOf(D)).toEqual({ date: D, status: 'pending', attempts: [{ at: '2026-11-03T23:45:00', delivered: null, error: null }] });
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'error',
            '[DAILY-SUMMARY] date=2026-11-03 attempt=1/4 sent=true status=state-write-failed-after-send err=ENOSPC: no space left on device, rename');
        expect(attemptLines()).toHaveLength(1);

        // El intento en null cuenta: a las 00:00 todavía no toca el segundo.
        await runAt(2026, 10, 4, 0, 0);
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
    });

    test('D-08: si el cuarto intento no se puede completar, el abandono no se anuncia hasta que la ejecución siguiente lo escribe; queda una sola línea de abandono', async () => {
        const failed = (stamp) => ({ at: stamp, delivered: false, error: ECONNREFUSED });
        writeRawState(D, JSON.stringify({
            date: D,
            status: 'pending',
            attempts: [failed('2026-11-03T23:45:00'), failed('2026-11-04T00:45:00'), failed('2026-11-04T03:45:00')],
        }));
        writeRawState(D1, JSON.stringify({ date: D1, status: 'pending', attempts: [] }));
        mockSendOperatorReport.mockResolvedValue({ delivered: false, error: ECONNREFUSED });
        // A las 11:45 la 1.ª escritura del estado de D anota el cuarto intento y la 2.ª lo completa.
        const renameSpy = failStateRename('ENOSPC: no space left on device, rename', (n) => n === 2);
        try {
            await runAt(2026, 10, 4, 11, 45);
        } finally {
            renameSpy.mockRestore();
        }

        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(stateOf(D).status).toBe('pending');
        expect(stateOf(D).attempts).toHaveLength(4);
        expect(stateOf(D).attempts[3]).toEqual({ at: '2026-11-04T11:45:00', delivered: null, error: null });
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'error',
            '[DAILY-SUMMARY] date=2026-11-03 attempt=4/4 sent=false status=state-write-failed-after-send err=ENOSPC: no space left on device, rename');
        expect(logged('[DAILY-SUMMARY-ABANDON]')).toEqual([]);

        // La ejecución siguiente encuentra los 4 intentos, abandona el día sin enviar y lo anuncia.
        await runAt(2026, 10, 4, 12, 0);
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(stateOf(D)).toMatchObject({ status: 'abandoned', reason: 'max-attempts' });
        expect(logged('[DAILY-SUMMARY-ABANDON]')).toEqual([['warn', '[DAILY-SUMMARY-ABANDON] date=2026-11-03 reason=max-attempts attempts=4']]);
    });

    test('RD-03: después de un envío entregado, las dos ejecuciones siguientes no vuelven a enviar', async () => {
        await runAt(2026, 10, 3, 23, 45);
        // 23:50, el mismo día; 00:45, cuando tocaría el segundo intento si no se hubiera entregado.
        await runAt(2026, 10, 3, 23, 50);
        await runAt(2026, 10, 4, 0, 45);

        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(stateOf(D).status).toBe('delivered');
    });

    test('RD-03: con el correo siempre caído, el día recibe exactamente 4 intentos (23:45, 00:45, 03:45 y 11:45: 60, 180 y 480 minutos después del anterior, WR-03) y queda abandonado con max-attempts en la ejecución del cuarto', async () => {
        mockSendOperatorReport.mockResolvedValue({ delivered: false, error: ECONNREFUSED });
        const sentAt = [];
        let rightAfter1145 = null;

        // 96 ejecuciones, una cada 15 minutos, de las 23:45 del día D a las 23:30 del siguiente.
        for (let k = 0; k < 96; k++) {
            const now = new Date(2026, 10, 3, 23, 45 + 15 * k);
            const before = mockSendOperatorReport.mock.calls.length;
            await expect(dispatchDailySummaryIfDue(now, ON)).resolves.toBeUndefined();
            const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            if (mockSendOperatorReport.mock.calls.length > before) {
                sentAt.push(hhmm);
            }
            if (now.getDate() === 4 && hhmm === '11:45') {
                rightAfter1145 = stateOf(D);
            }
        }

        expect(sentAt).toEqual(['23:45', '00:45', '03:45', '11:45']);
        expect(subjects()).toHaveLength(4);
        for (const subject of subjects()) {
            expect(subject).toContain('Resumen del día 2026-11-03');
        }
        expect(rightAfter1145).toEqual({
            date: D,
            status: 'abandoned',
            attempts: ['2026-11-03T23:45:00', '2026-11-04T00:45:00', '2026-11-04T03:45:00', '2026-11-04T11:45:00']
                .map((stamp) => ({ at: stamp, delivered: false, error: ECONNREFUSED })),
            reason: 'max-attempts',
        });
        expect(logged('[DAILY-SUMMARY-ABANDON]')).toEqual([['warn', '[DAILY-SUMMARY-ABANDON] date=2026-11-03 reason=max-attempts attempts=4']]);
        const lines = attemptLines();
        expect(lines).toHaveLength(4);
        lines.forEach(([level, message], index) => {
            expect(level).toBe('warn');
            expect(message).toMatch(new RegExp(`^\\[DAILY-SUMMARY\\] date=2026-11-03 attempt=${index + 1}/4 sent=false .* err=connect ECONNREFUSED 127\\.0\\.0\\.1:25$`));
        });
        // El día siguiente se creó a las 00:00 y queda pendiente para su propio resumen.
        expect(stateOf(D1)).toEqual({ date: D1, status: 'pending', attempts: [] });
    });

    test('WR-03: con el servicio apagado de 00:00 a 12:30 del día siguiente, los intentos 2 a 4 salen a las 12:30, 15:30 y 23:30, nunca en ráfaga', async () => {
        mockSendOperatorReport.mockResolvedValue({ delivered: false, error: ECONNREFUSED });
        const sentAt = [];

        // Una ejecución cada 15 minutos de las 23:45 del día D a las 23:30 del siguiente, salvo las
        // que caen con el servicio apagado.
        for (let k = 0; k < 96; k++) {
            const now = new Date(2026, 10, 3, 23, 45 + 15 * k);
            const down = now.getDate() === 4 && (now.getHours() < 12 || (now.getHours() === 12 && now.getMinutes() < 30));
            if (down) {
                continue;
            }
            const before = mockSendOperatorReport.mock.calls.length;
            await expect(dispatchDailySummaryIfDue(now, ON)).resolves.toBeUndefined();
            if (mockSendOperatorReport.mock.calls.length > before) {
                sentAt.push(localStamp(now));
            }
        }

        // Antes salían a las 12:30, 12:45 y 13:00: las tres esperas vencían a la vez contra el primero.
        expect(sentAt).toEqual(['2026-11-03T23:45:00', '2026-11-04T12:30:00', '2026-11-04T15:30:00', '2026-11-04T23:30:00']);
        for (const subject of subjects()) {
            expect(subject).toContain('Resumen del día 2026-11-03');
        }
        expect(stateOf(D)).toEqual({
            date: D,
            status: 'abandoned',
            attempts: sentAt.map((stamp) => ({ at: stamp, delivered: false, error: ECONNREFUSED })),
            reason: 'max-attempts',
        });
        expect(logged('[DAILY-SUMMARY-ABANDON]')).toEqual([['warn', '[DAILY-SUMMARY-ABANDON] date=2026-11-03 reason=max-attempts attempts=4']]);
        // El día siguiente se creó en la primera ejecución después del hueco.
        expect(stateOf(D1)).toEqual({ date: D1, status: 'pending', attempts: [] });
    });

    test('RD-02 (a): un día creado a las 10:00 y sin más ejecuciones se envía en la de las 00:00 del día siguiente, con sus datos y su fecha', async () => {
        await runAt(2026, 10, 3, 10, 0);
        expect(stateOf(D)).toEqual({ date: D, status: 'pending', attempts: [] });
        expect(mockSendOperatorReport).not.toHaveBeenCalled();

        await runAt(2026, 10, 4, 0, 0);

        expect(subjects()).toHaveLength(1);
        expect(subjects()[0]).toContain('Resumen del día 2026-11-03');
        expect(mockRunQuery.mock.calls[0][0]).toContain("CAST('2026-11-03' AS DATE)");
        expect(stateOf(D)).toEqual({ date: D, status: 'delivered', attempts: [{ at: '2026-11-04T00:00:00', delivered: true, error: null }] });
        expect(stateOf(D1)).toEqual({ date: D1, status: 'pending', attempts: [] });
    });

    test('RD-02 (b): con el día D pendiente tras 2 intentos fallidos, a las 23:45 del día siguiente se abandona D y se intenta el nuevo día', async () => {
        mockSendOperatorReport
            .mockResolvedValueOnce({ delivered: false, error: ECONNREFUSED })
            .mockResolvedValueOnce({ delivered: false, error: ECONNREFUSED });
        await runAt(2026, 10, 3, 23, 45);
        await runAt(2026, 10, 4, 0, 45);
        expect(stateOf(D)).toMatchObject({ status: 'pending', attempts: [{ delivered: false }, { delivered: false }] });

        await runAt(2026, 10, 4, 23, 45);

        expect(logged('[DAILY-SUMMARY-ABANDON]')).toEqual([['warn', '[DAILY-SUMMARY-ABANDON] date=2026-11-03 reason=next-summary-due attempts=2']]);
        expect(stateOf(D)).toMatchObject({ status: 'abandoned', reason: 'next-summary-due', attempts: [{ delivered: false }, { delivered: false }] });
        expect(subjects()).toHaveLength(3);
        expect(subjects()[2]).toContain('Resumen del día 2026-11-04');
        expect(stateOf(D1)).toMatchObject({ status: 'delivered' });
    });

    test('RD-02 (c): sin estado del día D, a las 08:00 del día siguiente no se envía nada y a las 23:45 sale el del nuevo día', async () => {
        await runAt(2026, 10, 4, 8, 0);
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(stateOf(D)).toBeNull();

        await runAt(2026, 10, 4, 23, 45);
        expect(subjects()).toHaveLength(1);
        expect(subjects()[0]).toContain('Resumen del día 2026-11-04');
    });

    test('RD-02 (d): con el resumen apagado el día D, al encenderlo a las 10:30 del día siguiente no se manda el de D', async () => {
        await runAt(2026, 10, 3, 10, 0, OFF);
        await runAt(2026, 10, 3, 23, 45, OFF);
        await runAt(2026, 10, 4, 10, 30);

        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(stateOf(D)).toBeNull();
        expect(stateOf(D1)).toEqual({ date: D1, status: 'pending', attempts: [] });
    });

    test("un estado de hoy dañado ('not json') a las 23:45 no se envía: queda abandonado con state-corrupt y una sola línea de abandono", async () => {
        writeRawState(D, 'not json');

        await runAt(2026, 10, 3, 23, 45);

        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(stateOf(D)).toEqual({ date: D, status: 'abandoned', attempts: [], reason: 'state-corrupt' });
        expect(mockLogGenerator.mock.calls).toEqual([['EomNotification', 'warn', '[DAILY-SUMMARY-ABANDON] date=2026-11-03 reason=state-corrupt attempts=0']]);

        await runAt(2026, 10, 3, 23, 50);
        expect(mockLogGenerator).toHaveBeenCalledTimes(1);
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
    });

    test('si no se puede escribir un abandono, queda el error y ninguna línea de abandono, y el día dañado tampoco se envía', async () => {
        writeRawState(D, 'not json');
        const renameSpy = failStateRename('EACCES: permission denied, rename');
        try {
            await runAt(2026, 10, 3, 23, 45);
        } finally {
            renameSpy.mockRestore();
        }

        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(mockLogGenerator.mock.calls).toEqual([['EomNotification', 'error',
            '[DAILY-SUMMARY] date=2026-11-03 status=state-write-failed err=EACCES: permission denied, rename']]);
        expect(fs.readFileSync(dayStatePath(tmpRoot, D), 'utf8')).toBe('not json');
    });

    test('WR-01: si la lectura del estado de hoy falla con EBUSY a las 23:45, el día no se abandona ni se reescribe y queda un solo warn state-unreadable; la ejecución siguiente envía', async () => {
        writeRawState(D, JSON.stringify({ date: D, status: 'pending', attempts: [] }));
        const before = fs.readFileSync(dayStatePath(tmpRoot, D));
        const readSpy = failStateRead(D, 'EBUSY', 'EBUSY: resource busy or locked, open');
        try {
            await expect(runAt(2026, 10, 3, 23, 45)).resolves.toBeUndefined();
        } finally {
            readSpy.mockRestore();
        }

        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(mockRunQuery).not.toHaveBeenCalled();
        expect(fs.readFileSync(dayStatePath(tmpRoot, D)).equals(before)).toBe(true);
        expect(mockLogGenerator.mock.calls).toEqual([['EomNotification', 'warn',
            '[DAILY-SUMMARY] date=2026-11-03 status=state-unreadable err=EBUSY: resource busy or locked, open']]);

        // La falla era pasajera: con la lectura de vuelta, el intento que tocaba sale en la ejecución siguiente.
        await runAt(2026, 10, 3, 23, 50);
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(stateOf(D)).toEqual({ date: D, status: 'delivered', attempts: [{ at: '2026-11-03T23:50:00', delivered: true, error: null }] });
    });

    test('WR-01: un estado de ayer entregado que no se puede leer (EACCES) antes de la hora queda igual en disco; hoy se crea como siempre', async () => {
        const delivered = JSON.stringify({ date: D, status: 'delivered', attempts: [{ at: '2026-11-03T23:45:00', delivered: true, error: null }] });
        writeRawState(D, delivered);
        const readSpy = failStateRead(D, 'EACCES', 'EACCES: permission denied, open');
        try {
            await runAt(2026, 10, 4, 10, 30);
        } finally {
            readSpy.mockRestore();
        }

        expect(fs.readFileSync(dayStatePath(tmpRoot, D), 'utf8')).toBe(delivered);
        expect(stateOf(D1)).toEqual({ date: D1, status: 'pending', attempts: [] });
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(mockLogGenerator.mock.calls).toEqual([['EomNotification', 'warn',
            '[DAILY-SUMMARY] date=2026-11-03 status=state-unreadable err=EACCES: permission denied, open']]);
    });

    test('D-35: al resumir hoy con la fecha de SQL Server en otro día queda un warn de reloj', async () => {
        mockRunQuery.mockImplementation(routeQueries({ COPDAT: { clock: OTHER_CLOCK } }));

        await runAt(2026, 10, 3, 23, 45);

        expect(logged('[DAILY-SUMMARY-CLOCK]')).toEqual([['warn', '[DAILY-SUMMARY-CLOCK] tz-date=2026-11-03 sql-date=2026-11-04']]);
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
    });

    // Los dos relojes de SQL Server posibles a las 00:00 del día siguiente: ya en ese día, o todavía
    // en el día resumido, unos minutos atrás. El segundo es el que distingue la regla «solo al
    // resumir hoy»: comparado contra hoy, sí avisaría.
    test.each([
        ['ya en el día siguiente', OTHER_CLOCK],
        ['todavía en el día resumido', CLOCK],
    ])('D-35: en una reposición no hay línea de reloj, con SQL Server %s', async (_label, clock) => {
        await runAt(2026, 10, 3, 10, 0);
        mockRunQuery.mockImplementation(routeQueries({ COPDAT: { clock } }));

        await runAt(2026, 10, 4, 0, 0);

        expect(subjects()).toHaveLength(1);
        expect(subjects()[0]).toContain('Resumen del día 2026-11-03');
        expect(logged('[DAILY-SUMMARY-CLOCK]')).toEqual([]);
    });

    test.each([
        ['ausente (undefined)', undefined],
        ['malformado ({ delivered: 1 })', { delivered: 1, error: null }],
    ])('D-38: un desenlace %s no cuenta como entregado: el intento queda en false, el día sigue pendiente y la línea dice unknown delivery failure', async (_label, outcome) => {
        mockSendOperatorReport.mockResolvedValueOnce(outcome);

        await expect(runAt(2026, 10, 3, 23, 45)).resolves.toBeUndefined();

        expect(stateOf(D)).toEqual({
            date: D,
            status: 'pending',
            attempts: [{ at: '2026-11-03T23:45:00', delivered: false, error: 'unknown delivery failure' }],
        });
        expect(attemptLines()).toEqual([['warn',
            expect.stringMatching(/^\[DAILY-SUMMARY\] date=2026-11-03 attempt=1\/4 sent=false .* err=unknown delivery failure$/)]]);
    });

    test('T-20.7-36: el mensaje del transporte se guarda recortado a 500 caracteres y la línea lo acota a 200', async () => {
        mockSendOperatorReport.mockResolvedValueOnce({ delivered: false, error: 'E'.repeat(800) });

        await runAt(2026, 10, 3, 23, 45);

        expect(stateOf(D).attempts[0].error).toBe('E'.repeat(500));
        const [[, message]] = attemptLines();
        expect(message.endsWith(` err=${'E'.repeat(200)}`)).toBe(true);
        expect(message).not.toContain('E'.repeat(201));
    });

    test('RD-09: un día sin pendientes manda igual su correo, con «sin pendientes» en el asunto y «Sin pendientes» en el cuerpo', async () => {
        recordRun('COPDAT', [['PY0000801', { outcome: 'uploaded', vendor: 'PROV01', fechaRegistro: '2026-10-30' }]]);
        mockRunQuery.mockImplementation(routeQueries({ COPDAT: { uploaded: 4 } }));

        await runAt(2026, 10, 3, 23, 45);

        expect(subjects()).toEqual(['[SageConnect] Resumen del día 2026-11-03 — sin pendientes']);
        expect(mockSendOperatorReport.mock.calls[0][0].html).toContain('<p>Sin pendientes</p>');
        expect(stateOf(D).status).toBe('delivered');
    });

    test('nunca lanza: con runQuery rechazando todo, resuelve y envía el correo con las notas de lo que no se pudo leer', async () => {
        mockRunQuery.mockRejectedValue(new Error('Login failed for user'));

        await expect(runAt(2026, 10, 3, 23, 45)).resolves.toBeUndefined();

        expect(subjects()).toEqual(['[SageConnect] Resumen del día 2026-11-03 — datos incompletos']);
        expect(mockSendOperatorReport.mock.calls[0][0].html).toContain('No se pudieron leer las OCs con error de COPDAT: Login failed for user.');
        expect(stateOf(D).status).toBe('delivered');
    });

    test('nunca lanza: si la recolección lanza (config sin portal), resuelve, deja dispatch-failed y el intento se queda en null sin reenvío inmediato', async () => {
        const { portal: _omitted, ...broken } = ON;

        await expect(dispatchDailySummaryIfDue(at(3, 23, 45), broken)).resolves.toBeUndefined();

        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(stateOf(D)).toEqual({ date: D, status: 'pending', attempts: [{ at: '2026-11-03T23:45:00', delivered: null, error: null }] });
        const errors = mockLogGenerator.mock.calls.filter(([, level]) => level === 'error');
        expect(errors).toHaveLength(1);
        expect(errors[0][2]).toMatch(/^\[DAILY-SUMMARY\] status=dispatch-failed err=\S.*tenants/);

        // El intento en null cuenta como hecho: a las 00:00 todavía no toca el segundo.
        await runAt(2026, 10, 4, 0, 0);
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
    });

    test('nunca lanza, aunque la bitácora también lance: ni la excepción de la recolección ni la de su propia línea de error salen del despacho', async () => {
        // La rama de respaldo de LogGenerator crea carpetas fuera de un try, así que sí puede lanzar.
        mockLogGenerator.mockImplementation(() => {
            throw new Error('EACCES: permission denied, mkdir');
        });

        await expect(runAt(2026, 10, 3, 23, 45)).resolves.toBeUndefined();

        // La primera línea de la recolección lanzó; el despacho la atrapó y su línea de error también
        // lanzó. No hubo envío y el intento se quedó anotado en null.
        expect(mockLogGenerator.mock.calls.map(([, level, message]) => [level, message.split(' ')[0]])).toEqual([
            ['warn', '[DAILY-SUMMARY-LEDGER]'],
            ['error', '[DAILY-SUMMARY]'],
        ]);
        expect(mockLogGenerator.mock.calls[1][2]).toBe('[DAILY-SUMMARY] status=dispatch-failed err=EACCES: permission denied, mkdir');
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(stateOf(D)).toEqual({ date: D, status: 'pending', attempts: [{ at: '2026-11-03T23:45:00', delivered: null, error: null }] });
    });

    test('D-01: el envío se carga solo al intentar; ni una ejecución apagada ni la de las 23:30 lo cargan, la de las 23:45 sí', async () => {
        // Registros limpios. Los casos de arriba ya cargaron el doble en el registro de afuera, y
        // dentro del bloque aislado Jest devolvería esa instancia sin volver a correr la fábrica
        // (desviación 4 del plan 20.7-06): resetModules vacía los dos registros.
        jest.resetModules();
        mockEmailSenderLoaded.mockClear();
        const loads = {};

        await jest.isolateModulesAsync(async () => {
            const isolated = require('../../src/services/DailySummaryService');
            loads.alRequerir = mockEmailSenderLoaded.mock.calls.length;
            await isolated.dispatchDailySummaryIfDue(at(3, 23, 45), OFF);
            loads.apagado = mockEmailSenderLoaded.mock.calls.length;
            await isolated.dispatchDailySummaryIfDue(at(3, 23, 30), ON);
            loads.a2330 = mockEmailSenderLoaded.mock.calls.length;
            await isolated.dispatchDailySummaryIfDue(at(3, 23, 45), ON);
            loads.a2345 = mockEmailSenderLoaded.mock.calls.length;
        });

        expect(loads).toEqual({ alRequerir: 0, apagado: 0, a2330: 0, a2345: 1 });
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(stateOf(D).status).toBe('delivered');
    });
});
