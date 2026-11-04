// tests/scripts/daily-summary-preview.test.js (NUEVO — Fase 20.7, plan 20.7-08)
//
// Vista previa del resumen diario (src/scripts/daily-summary-preview.js; RD-13, RD-11 y D-36): con
// la recolección real arma el mismo HTML del correo del día, sin tope de renglones ni recorte de
// textos, y lo guarda en un archivo. No carga el envío de correo, solo emite SELECT, no toca el
// estado del día y cierra el pool singleton exactamente una vez por corrida. Su bloque clock dice,
// además, cómo formatea este runtime la hora de medianoche (W-05, D-35).
//
// Dobles:
// - config, con la carpeta de bitácoras en un temporal de os.tmpdir() propio de este proceso y sin
//   la llave notifications: el resumen está apagado y la vista previa funciona igual;
// - LogGenerator, y SQLServerConnection con runQuery (un enrutador por el texto de la consulta; cada
//   SQL queda en sus llamadas) y closePool: no hay base de datos local (HANDOFF §6);
// - TimezoneHelper, con un reloj fijo (2026-11-03 09:30) y el TIMEZONE de producción;
// - EmailSender y nodemailer: sus fábricas anotan cada carga, para afirmar que la vista previa no
//   carga el envío (RD-13).
// DailySummaryService, DailySummary, PaymentDayLedger y EomNotification van reales: el registro de
// pagos se escribe de verdad en la carpeta temporal y el HTML es el que armaría el correo.

// Mock de src/config — antes de cualquier require, para que las utilidades anidadas lo vean.
jest.mock('../../src/config', () => {
    const nodePath = require('path');
    const nodeOs = require('os');
    return {
        portal: { tenants: [{ id: 'T1', database: 'COPDAT' }] },
        paths: { logs: nodePath.join(nodeOs.tmpdir(), `sageconnect-daily-summary-preview-${process.pid}`) },
        retry: { scope: 'last_n_days', lookbackDays: 30 },
    };
});

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
const mockClosePool = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery, closePool: mockClosePool }));

// El reloj de getCurrentDate(): un Date cuyos accesores locales dan la hora de pared de TIMEZONE.
jest.mock('../../src/utils/TimezoneHelper', () => ({
    getCurrentDate: () => new Date(2026, 10, 3, 9, 30, 0),
    TIMEZONE: 'America/Mexico_City',
}));

const mockEmailSenderLoaded = jest.fn();
jest.mock('../../src/utils/EmailSender', () => {
    mockEmailSenderLoaded();
    return { sendMail: jest.fn(), sendOperatorReport: jest.fn() };
});

const mockNodemailerLoaded = jest.fn();
jest.mock('nodemailer', () => {
    mockNodemailerLoaded();
    return { createTransport: jest.fn() };
});

const fs = require('fs');
const path = require('path');
const os = require('os');
const { describe, test, expect, beforeEach, afterEach, afterAll } = require('@jest/globals');

const tmpRoot = path.join(os.tmpdir(), `sageconnect-daily-summary-preview-${process.pid}`);
const SCRIPT_FILE = path.join(__dirname, '..', '..', 'src', 'scripts', 'daily-summary-preview.js');

const config = require('../../src/config');
const { parsePreviewArgs, runDailySummaryPreview } = require('../../src/scripts/daily-summary-preview');
const { collectDailySummary } = require('../../src/services/DailySummaryService');
const { buildDailySummaryHtml, buildDailySummarySubject } = require('../../src/utils/DailySummary');
const { recordPaymentRun } = require('../../src/utils/PaymentDayLedger');

// El constructor real, guardado antes de cualquier espía.
const RealDateTimeFormat = Intl.DateTimeFormat;

const DAY = '2026-11-03';
const LOG_FILE = 'DailySummaryPreview';
const dayDir = path.join(tmpRoot, 'sageconnect', DAY);
// El reloj de SQL Server que devuelve la cuenta de OCs subidas (D-35).
const SQL_CLOCK = { sqlDate: '2026-11-03', sqlNow: '2026-11-03 09:30:07', sqlOffsetMin: -360 };
// Copia literal de las opciones de Intl.DateTimeFormat de getCurrentDate() en
// src/utils/TimezoneHelper.js, con el TIMEZONE del doble y en el mismo orden.
const GET_CURRENT_DATE_OPTIONS = {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
};
// Los 24 instantes que formatea la comprobación de la medianoche: Date.UTC(2026, 10, 4, h, 5).
const PROBE_INSTANTS = Array.from({ length: 24 }, (_, h) => Date.UTC(2026, 10, 4, h, 5));

// Doble de runQuery: responde según la marca de cada una de las tres consultas de la recolección.
function routeQueries({ ocRows = [], uploaded = 12, control = [] } = {}) {
    return async (sql) => {
        if (sql.includes('COUNT(DISTINCT ocSage)')) {
            return { recordset: [{ uploaded, ...SQL_CLOCK }] };
        }
        if (sql.includes('fesaPagosFocaltec')) {
            return { recordset: control.map((NoPagoSage) => ({ NoPagoSage })) };
        }
        if (sql.includes("status = 'ERROR'")) {
            return { recordset: ocRows };
        }
        throw new Error('consulta que el doble no reconoce');
    };
}

// Renglón de OC tal como lo devuelve la consulta de OCs del día; la autorización cae dentro de la
// ventana de 30 días que termina el 2026-11-03.
const ocRow = (idOrPo, lastError) => ({
    tenant: 'COPDAT', idOrPo, attemptsToday: 2, lastError, isValidation: 0, fechaAuth: '2026-10-20',
});

const sqlsSent = () => mockRunQuery.mock.calls.map(([sql]) => sql);
const outFile = (name = 'vista.html') => path.join(tmpRoot, 'salida', name);

// Una corrida de pagos con un rechazo, escrita con el módulo real como la escribe uploadPayments.
function recordRejectedPayment() {
    const out = recordPaymentRun({
        logsRoot: tmpRoot,
        dateISO: DAY,
        tenantDb: 'COPDAT',
        runAt: `${DAY}T09:15:00`,
        results: new Map([
            ['PY0000201', { outcome: 'rejected', code: '1827', description: 'Alguna factura del pago ya está pagada', vendor: 'PROV01', fechaRegistro: '2026-10-10' }],
        ]),
    });
    if (!out.ok) {
        throw new Error(`recordPaymentRun falló: ${out.error}`);
    }
}

// Espía de Intl.DateTimeFormat (W-05): con las opciones de getCurrentDate() (las únicas que traen
// hour12: false) devuelve el formateador simulado; cualquier otra llamada construye uno real.
function spyDateTimeFormat(onGetCurrentDateOptions) {
    return jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((locales, options) => {
        if (options && options.hour12 === false) {
            return onGetCurrentDateOptions();
        }
        return new RealDateTimeFormat(locales, options);
    });
}

// Formateador simulado que da la misma hora para cualquier instante y anota cada instante.
function fakeFormatter(hourValue, formatted) {
    return {
        formatToParts: (date) => {
            formatted.push(date.getTime());
            return [{ type: 'hour', value: hourValue }];
        },
    };
}

let consoleTable;

beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    mockLogGenerator.mockReset();
    mockRunQuery.mockReset();
    mockClosePool.mockReset();
    mockClosePool.mockResolvedValue(undefined);
    mockEmailSenderLoaded.mockReset();
    mockNodemailerLoaded.mockReset();
    consoleTable = jest.spyOn(console, 'table').mockImplementation(() => {});
});

afterEach(() => {
    consoleTable.mockRestore();
});

afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('runDailySummaryPreview', () => {
    test('arma el mismo HTML del correo sin tope, lo guarda en --out y devuelve cifras, asunto y reloj, con el resumen apagado (RD-13, D-36)', async () => {
        mockRunQuery.mockImplementation(routeQueries({ ocRows: [ocRow('PO0000101', '1300: OC duplicada en el portal')] }));
        recordRejectedPayment();
        const out = outFile();

        const envelope = await runDailySummaryPreview({ date: DAY, out });

        expect(config.notifications).toBeUndefined();
        expect(envelope.success).toBe(true);
        expect(envelope.errors).toEqual([]);
        const html = fs.readFileSync(out, 'utf8');
        expect(html).toContain('<h1>SageConnect: Resumen del día 2026-11-03</h1>');
        expect(html).toContain('PO0000101');
        expect(html).toContain('PY0000201');
        expect(html).toContain('<p>Vista previa sin tope de renglones ni recorte de textos. No se envió ningún correo.</p>');

        // Con los mismos datos, la recolección real y buildDailySummaryHtml(model, { cap: false }).
        const model = await collectDailySummary(DAY, config);
        expect(html).toBe(buildDailySummaryHtml(model, { cap: false }));

        expect(envelope.data).toEqual({
            date: DAY,
            htmlPath: out,
            subject: buildDailySummarySubject(model),
            counts: model.counts,
            pendingTotal: model.pendingTotal,
            incomplete: model.incomplete,
            notes: model.notes,
            sections: { oc: 1, rejected: 1, sage: 0 },
            clock: {
                tzNow: '2026-11-03T09:30:00',
                tzDate: '2026-11-03',
                midnightHourFormat: '00',
                sqlDate: '2026-11-03',
                sqlNow: '2026-11-03 09:30:07',
                sqlOffsetMin: -360,
            },
        });
        expect(envelope.data.subject).toBe('[SageConnect] Resumen del día 2026-11-03 — 2 sin subir');
        expect(envelope.data.counts).toEqual({ ocUploaded: 12, paymentsUploaded: 0, ocPending: 1, paymentsPending: 1, lastDay: 0 });
        expect(envelope.summary).toBe(`Vista previa del resumen del 2026-11-03 guardada en ${out}`);
        expect(consoleTable).toHaveBeenCalled();
    });

    test('sin argumentos toma la fecha de hoy en TIMEZONE y escribe en <LOG_PATH>/sageconnect/<D>/daily-summary-preview.html (D-36)', async () => {
        mockRunQuery.mockImplementation(routeQueries());

        const envelope = await runDailySummaryPreview();

        const expected = path.join(tmpRoot, 'sageconnect', DAY, 'daily-summary-preview.html');
        expect(envelope.success).toBe(true);
        expect(envelope.data.date).toBe(DAY);
        expect(envelope.data.htmlPath).toBe(expected);
        expect(fs.readFileSync(expected, 'utf8')).toContain('<h1>SageConnect: Resumen del día 2026-11-03</h1>');
        // La fecha de hoy es la que llega al SQL de la recolección.
        expect(sqlsSent().filter((sql) => sql.includes("CAST('2026-11-03' AS DATE)"))).toHaveLength(2);
    });

    test('RD-13: requerir el script y correr la vista previa no carga EmailSender ni nodemailer', async () => {
        mockRunQuery.mockImplementation(routeQueries());
        // Registros de módulos y de dobles limpios; sin ellos la afirmación sería vacía: la fábrica de
        // un doble solo corre la primera vez que se instancia, y dentro de isolateModulesAsync Jest
        // devuelve sin volver a correrla un doble ya instanciado afuera (desviación 4 del plan
        // 20.7-06). resetModules vacía los dos registros.
        jest.resetModules();
        mockEmailSenderLoaded.mockClear();
        mockNodemailerLoaded.mockClear();

        let envelope;
        await jest.isolateModulesAsync(async () => {
            const isolated = require('../../src/scripts/daily-summary-preview');
            envelope = await isolated.runDailySummaryPreview({ date: DAY });
        });

        expect(envelope.success).toBe(true);
        expect(mockRunQuery).toHaveBeenCalledTimes(3);
        expect(mockEmailSenderLoaded).not.toHaveBeenCalled();
        expect(mockNodemailerLoaded).not.toHaveBeenCalled();
    });

    test('control del caso anterior: con los registros limpios, cargar EmailSender y nodemailer sí corre la fábrica de cada doble', async () => {
        jest.resetModules();
        mockEmailSenderLoaded.mockClear();
        mockNodemailerLoaded.mockClear();

        await jest.isolateModulesAsync(async () => {
            require('../../src/utils/EmailSender');
            require('nodemailer');
        });

        expect(mockEmailSenderLoaded).toHaveBeenCalledTimes(1);
        expect(mockNodemailerLoaded).toHaveBeenCalledTimes(1);
    });

    test('RD-13: todo SQL que emite empieza con SELECT, va a la base de la empresa y no contiene como palabra INSERT, UPDATE, DELETE, ALTER ni CREATE', async () => {
        mockRunQuery.mockImplementation(routeQueries({ ocRows: [ocRow('PO0000101', '1300: OC duplicada en el portal')] }));

        const envelope = await runDailySummaryPreview({ date: DAY, out: outFile() });

        expect(envelope.success).toBe(true);
        const sqls = sqlsSent();
        expect(sqls).toHaveLength(3);
        for (const sql of sqls) {
            expect(sql.trim()).toMatch(/^SELECT\b/);
            expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|MERGE|DROP|TRUNCATE|EXEC)\b/i);
        }
        expect(mockRunQuery.mock.calls.map(([, db]) => db)).toEqual(['COPDAT', 'COPDAT', 'COPDAT']);
        // createdAt no cuenta como CREATE: la consulta de OCs lo usa y pasa la afirmación de arriba.
        expect(sqls.some((sql) => sql.includes('createdAt'))).toBe(true);
    });

    test('no crea el estado del día: en la carpeta del día solo queda la vista previa (RD-13, D-36)', async () => {
        mockRunQuery.mockImplementation(routeQueries());

        const envelope = await runDailySummaryPreview({ date: DAY });

        expect(envelope.success).toBe(true);
        expect(fs.existsSync(path.join(dayDir, 'daily-summary.json'))).toBe(false);
        expect(fs.readdirSync(dayDir)).toEqual(['daily-summary-preview.html']);
    });

    test('no modifica el estado del día ni el registro de pagos que ya existen (RD-13, D-36)', async () => {
        mockRunQuery.mockImplementation(routeQueries());
        recordRejectedPayment();
        const statePath = path.join(dayDir, 'daily-summary.json');
        const ledgerPath = path.join(dayDir, 'daily-summary-payments.json');
        const state = `${JSON.stringify({
            date: DAY,
            status: 'pending',
            attempts: [{ at: '2026-11-03T23:45:00', delivered: false, error: 'timeout' }],
        }, null, 2)}\n`;
        fs.writeFileSync(statePath, state, 'utf8');
        const ledgerBefore = fs.readFileSync(ledgerPath, 'utf8');

        const envelope = await runDailySummaryPreview({ date: DAY });

        expect(envelope.success).toBe(true);
        expect(envelope.data.counts.paymentsPending).toBe(1);
        expect(fs.readFileSync(statePath, 'utf8')).toBe(state);
        expect(fs.readFileSync(ledgerPath, 'utf8')).toBe(ledgerBefore);
        expect(fs.readdirSync(dayDir).sort()).toEqual([
            'daily-summary-payments.json',
            'daily-summary-preview.html',
            'daily-summary.json',
        ]);
    });

    test('RD-11 y D-24: con 250 OCs del día el HTML trae los 250 renglones, sin la leyenda del resto, y un error de 150 caracteres sale completo', async () => {
        const longError = `1300: ${'x'.repeat(144)}`;
        const rows = Array.from({ length: 250 }, (_, i) => ocRow(
            `PO${String(i + 1).padStart(7, '0')}`,
            i === 0 ? longError : '1300: OC duplicada en el portal'
        ));
        mockRunQuery.mockImplementation(routeQueries({ ocRows: rows }));
        const out = outFile();

        const envelope = await runDailySummaryPreview({ date: DAY, out });

        expect(longError).toHaveLength(150);
        expect(envelope.success).toBe(true);
        expect(envelope.data.sections.oc).toBe(250);
        const html = fs.readFileSync(out, 'utf8');
        expect(html.match(/<tr><td>\d+<\/td><td>COPDAT<\/td><td>PO\d{7}<\/td>/g)).toHaveLength(250);
        expect(html).not.toMatch(/renglones? más/);
        expect(html).toContain(`<td>${longError}</td>`);
        expect(html).not.toContain('…');

        // Control: el mismo modelo con el tope del correo sí recorta, así que la prueba no es vacía.
        const capped = buildDailySummaryHtml(await collectDailySummary(DAY, config));
        expect(capped).toContain('Y 150 renglones más en esta sección.');
        expect(capped).not.toContain(`<td>${longError}</td>`);
    });

    test.each([
        ['2026-02-30'],
        ["2026-11-03' OR 1=1"],
        [''],
        [20261103],
    ])('la fecha %p se rechaza con errorResult antes de cualquier consulta (D-11, T-20.7-37)', async (date) => {
        const envelope = await runDailySummaryPreview({ date, out: outFile() });

        expect(envelope.success).toBe(false);
        expect(envelope.data).toBeNull();
        // La rechaza la validación del propio script, no la excepción de la recolección: el texto
        // es el de la validación y no queda una línea [FATAL] (mutación M5 de este plan).
        expect(envelope.errors).toEqual(['La fecha debe ser una fecha real YYYY-MM-DD']);
        expect(envelope.summary).toBe('No se armó la vista previa: fecha inválida');
        expect(mockLogGenerator).not.toHaveBeenCalled();
        expect(mockRunQuery).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(tmpRoot, 'salida'))).toBe(false);
        expect(fs.existsSync(path.join(tmpRoot, 'sageconnect'))).toBe(false);
    });
});

describe('parsePreviewArgs', () => {
    test('lee --date y --out', () => {
        expect(parsePreviewArgs(['--date', '2026-11-03', '--out', 'x.html'])).toEqual({
            date: '2026-11-03',
            out: 'x.html',
            errors: [],
        });
    });

    test('sin argumentos no hay fecha ni ruta, ni errores', () => {
        expect(parsePreviewArgs([])).toEqual({ date: null, out: null, errors: [] });
    });

    test.each([
        [['--date']],
        [['--foo']],
        [['--date', '2026-13-01']],
        [['--date', '2026-02-30']],
        [['--date', "2026-11-03' OR 1=1"]],
        [['--out']],
        // Un argumento que empieza con -- no es el valor del anterior (mutación M9 de este plan).
        [['--out', '--date']],
        [['--out', '--date', '2026-11-03']],
        [['--date', '2026-11-03', '--date', '2026-11-04']],
        [['2026-11-03']],
    ])('%j da al menos un error', (argv) => {
        const parsed = parsePreviewArgs(argv);

        expect(parsed.errors.length).toBeGreaterThan(0);
    });

    test('una fecha inválida no queda como fecha', () => {
        expect(parsePreviewArgs(['--date', '2026-13-01']).date).toBeNull();
    });
});

describe('arranque del script (D-41, M-3)', () => {
    test('arranca solo bajo la guarda de require.main, usa process.exitCode y no tiene ningún process.exit(', () => {
        const source = fs.readFileSync(SCRIPT_FILE, 'utf8');

        expect(source.match(/if \(require\.main === module\)/g)).toHaveLength(1);
        expect(source).not.toMatch(/process\.exit\s*\(/);
        expect(source).toMatch(/process\.exitCode = 1/);
    });
});

describe('cierre del pool (CLAUDE.md §3, T-20.7-40)', () => {
    test('en el camino feliz closePool se llama exactamente una vez', async () => {
        mockRunQuery.mockImplementation(routeQueries());

        const envelope = await runDailySummaryPreview({ date: DAY, out: outFile() });

        expect(envelope.success).toBe(true);
        expect(mockClosePool).toHaveBeenCalledTimes(1);
    });

    test('con runQuery rechazando todas las consultas la recolección degrada con notas, la corrida termina y closePool se llama una vez', async () => {
        mockRunQuery.mockRejectedValue(new Error('Timeout'));

        const envelope = await runDailySummaryPreview({ date: DAY, out: outFile() });

        expect(envelope.success).toBe(true);
        expect(envelope.data.incomplete).toBe(true);
        expect(envelope.data.notes).toEqual(expect.arrayContaining([
            'No se pudieron leer las OCs con error de COPDAT: Timeout.',
            'No se pudieron contar las OCs subidas de COPDAT: Timeout.',
        ]));
        expect(envelope.data.clock).toMatchObject({ sqlDate: null, sqlNow: null, sqlOffsetMin: null });
        expect(mockRunQuery).toHaveBeenCalledTimes(3);
        expect(mockClosePool).toHaveBeenCalledTimes(1);
    });

    test('con una fecha inválida sale con errorResult sin consultar y closePool se llama una vez', async () => {
        const envelope = await runDailySummaryPreview({ date: '2026-02-30' });

        expect(envelope.success).toBe(false);
        expect(mockRunQuery).not.toHaveBeenCalled();
        expect(mockClosePool).toHaveBeenCalledTimes(1);
    });

    test('solo requerir el script no la llama', async () => {
        jest.resetModules();
        mockClosePool.mockClear();

        await jest.isolateModulesAsync(async () => {
            require('../../src/scripts/daily-summary-preview');
        });

        expect(mockClosePool).not.toHaveBeenCalled();
        expect(mockRunQuery).not.toHaveBeenCalled();
    });

    test('si cerrar el pool falla, deja un warn y el sobre no cambia', async () => {
        mockRunQuery.mockImplementation(routeQueries());
        mockClosePool.mockRejectedValue(new Error('pool roto'));
        const out = outFile();

        const envelope = await runDailySummaryPreview({ date: DAY, out });

        expect(envelope.success).toBe(true);
        expect(envelope.summary).toBe(`Vista previa del resumen del 2026-11-03 guardada en ${out}`);
        expect(mockClosePool).toHaveBeenCalledTimes(1);
        expect(mockLogGenerator).toHaveBeenCalledWith(LOG_FILE, 'warn', expect.stringContaining('pool roto'));
    });

    test('una excepción al escribir el HTML da errorResult y una línea [FATAL], y el pool se cierra igual', async () => {
        mockRunQuery.mockImplementation(routeQueries());
        const asDirectory = path.join(tmpRoot, 'es-una-carpeta');
        fs.mkdirSync(asDirectory, { recursive: true });

        const envelope = await runDailySummaryPreview({ date: DAY, out: asDirectory });

        expect(envelope.success).toBe(false);
        expect(envelope.summary).toBe('No se pudo armar la vista previa');
        expect(envelope.errors).toHaveLength(1);
        expect(mockLogGenerator).toHaveBeenCalledWith(LOG_FILE, 'error', expect.stringMatching(/^\[FATAL\] /));
        expect(mockClosePool).toHaveBeenCalledTimes(1);
    });
});

describe('formato de la hora de medianoche (W-05, D-35)', () => {
    test('si el runtime formatea la medianoche como 24, clock.midnightHourFormat dice 24; usa las opciones de getCurrentDate() y los 24 instantes', async () => {
        mockRunQuery.mockImplementation(routeQueries());
        const formatted = [];
        const spy = spyDateTimeFormat(() => fakeFormatter('24', formatted));
        let envelope;
        let calls;
        try {
            envelope = await runDailySummaryPreview({ date: DAY, out: outFile() });
            calls = spy.mock.calls.filter(([, options]) => options && options.hour12 === false);
        } finally {
            spy.mockRestore();
        }

        expect(envelope.success).toBe(true);
        expect(envelope.data.clock.midnightHourFormat).toBe('24');
        expect(calls).toHaveLength(1);
        const [locales, options] = calls[0];
        expect(locales).toBe('en-CA');
        expect(options).toStrictEqual(GET_CURRENT_DATE_OPTIONS);
        expect(Object.keys(options)).toEqual(Object.keys(GET_CURRENT_DATE_OPTIONS));
        expect(formatted).toEqual(PROBE_INSTANTS);
    });

    test('con otro formato (la hora sale 12 en todos los instantes) clock.midnightHourFormat dice ??', async () => {
        mockRunQuery.mockImplementation(routeQueries());
        const formatted = [];
        const spy = spyDateTimeFormat(() => fakeFormatter('12', formatted));
        let envelope;
        try {
            envelope = await runDailySummaryPreview({ date: DAY, out: outFile() });
        } finally {
            spy.mockRestore();
        }

        expect(envelope.success).toBe(true);
        expect(envelope.data.clock.midnightHourFormat).toBe('??');
        expect(formatted).toEqual(PROBE_INSTANTS);
    });

    test('si construir el formateador lanza, clock.midnightHourFormat dice ?? y la vista previa sale igual', async () => {
        mockRunQuery.mockImplementation(routeQueries());
        const spy = spyDateTimeFormat(() => {
            throw new RangeError('Invalid time zone specified');
        });
        let envelope;
        try {
            envelope = await runDailySummaryPreview({ date: DAY, out: outFile() });
        } finally {
            spy.mockRestore();
        }

        expect(envelope.success).toBe(true);
        expect(envelope.data.clock.midnightHourFormat).toBe('??');
        expect(envelope.data.clock.tzDate).toBe(DAY);
    });
});
