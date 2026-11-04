// tests/utils/PaymentDayLedger.test.js
// Fase 20.7 (RD-10, D-16 a D-19): el registro diario de pagos en disco. Cubre la ruta, la
// lectura que distingue ausente, legible y dañado, la mezcla (gana el último resultado y los
// intentos suman uno por corrida), el reinicio con recoveredAt en la RAÍZ del archivo, las cotas
// y la escritura atómica que nunca lanza.
//
// Todo corre sobre una carpeta de os.tmpdir() que se crea en beforeAll y se borra en afterAll;
// cada caso usa su propia raíz de bitácoras dentro de ella.

// Doble de config vacío, antes de cualquier require: si el módulo, o algo que carga, leyera
// config al cargar, la suite entera fallaría aquí (M-4).
jest.mock('../../src/config', () => ({}));

const fs = require('fs');
const os = require('os');
const path = require('path');

const ledgerModule = require('../../src/utils/PaymentDayLedger');

const {
    LEDGER_FILE_NAME,
    LEDGER_OUTCOMES,
    ledgerFilePath,
    readPaymentDayLedger,
    emptyPaymentDayLedger,
    mergePaymentRun,
    recordPaymentRun,
} = ledgerModule;

const D = '2026-11-03';
const TENANT = 'COPDAT';
const OTHER_TENANT = 'EMPRESA2';
const T1 = '2026-11-03T08:00:00';
const T2 = '2026-11-03T08:15:00';
const T3 = '2026-11-03T08:30:00';

let tmpRoot = null;
let caseCount = 0;

beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-ledger-'));
});

afterAll(() => {
    if (tmpRoot) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

// Raíz de bitácoras nueva para cada caso: ningún caso ve los archivos de otro.
function newLogsRoot() {
    caseCount += 1;
    const root = path.join(tmpRoot, `case-${caseCount}`);
    fs.mkdirSync(root);
    return root;
}

// Ruta esperada armada aquí, no con ledgerFilePath, para que la prueba de la ruta no se
// valide contra sí misma.
function expectedFile(root, dateISO = D) {
    return path.join(root, 'sageconnect', dateISO, 'daily-summary-payments.json');
}

function writeRaw(root, text, dateISO = D) {
    const file = expectedFile(root, dateISO);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
    return file;
}

function readJson(root, dateISO = D) {
    return JSON.parse(fs.readFileSync(expectedFile(root, dateISO), 'utf8'));
}

// readFileSync que lanza un error de E/S con su código para `file` y deja pasar todo lo demás
// (WR-02): el archivo en disco está bien y lo que falla es su lectura. Quien llama restaura.
function failRead(file, code) {
    const realReadFileSync = fs.readFileSync;
    return jest.spyOn(fs, 'readFileSync').mockImplementation((target, ...rest) => {
        if (String(target) === file) {
            throw Object.assign(new Error(`${code}: simulado por la prueba`), { code });
        }
        return realReadFileSync.call(fs, target, ...rest);
    });
}

function deepFreeze(value) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const key of Object.keys(value)) {
            deepFreeze(value[key]);
        }
    }
    return value;
}

// Un registro legible con una empresa y un pago rechazado; `extra` va entre `date` y `tenants`.
function validLedger(extra = {}) {
    return {
        version: 1,
        date: D,
        ...extra,
        tenants: {
            [TENANT]: {
                runs: 1,
                lastRunAt: T1,
                queryFailures: 0,
                lastQueryError: null,
                payments: {
                    PY0000101: {
                        outcome: 'rejected',
                        code: '1827',
                        description: 'Alguna factura del pago ya está pagada',
                        vendor: 'PROV01',
                        fechaRegistro: '2026-10-20',
                        attempts: 1,
                        firstAt: T1,
                        lastAt: T1,
                    },
                },
            },
        },
    };
}

function fivePayments() {
    return new Map([
        ['PY0000101', { outcome: 'rejected', code: '1827', description: 'Alguna factura del pago ya está pagada', vendor: 'PROV01', fechaRegistro: '2026-10-20' }],
        ['PY0000102', { outcome: 'rejected', code: '1800', description: 'Pago rechazado por el portal', vendor: 'PROV02', fechaRegistro: '2026-10-21' }],
        ['PY0000103', { outcome: 'no-response', description: 'timeout of 30000ms exceeded', vendor: 'PROV03', fechaRegistro: '2026-10-22' }],
        ['PY0000104', { outcome: 'no-provider-id', description: 'Proveedor sin ID del portal', vendor: 'PROV04', fechaRegistro: '2026-10-23' }],
        ['PY0000105', { outcome: 'missing-uuid', description: '2 factura(s) sin UUID', vendor: 'PROV05', fechaRegistro: '2026-10-24', invoices: ['FAC-1', 'FAC-2'] }],
    ]);
}

function record(root, runAt, results, extra = {}) {
    return recordPaymentRun({ logsRoot: root, dateISO: D, tenantDb: TENANT, runAt, results, ...extra });
}

describe('PaymentDayLedger — contrato del módulo', () => {
    test('exporta exactamente las siete piezas del contrato', () => {
        expect(Object.keys(ledgerModule).sort()).toEqual([
            'LEDGER_FILE_NAME',
            'LEDGER_OUTCOMES',
            'emptyPaymentDayLedger',
            'ledgerFilePath',
            'mergePaymentRun',
            'readPaymentDayLedger',
            'recordPaymentRun',
        ]);
    });

    test('LEDGER_FILE_NAME y los seis resultados de D-17, congelados', () => {
        expect(LEDGER_FILE_NAME).toBe('daily-summary-payments.json');
        expect(LEDGER_OUTCOMES).toEqual(['uploaded', 'rejected', 'no-response', 'no-provider-id', 'missing-uuid', 'no-invoices']);
        expect(Object.isFrozen(LEDGER_OUTCOMES)).toBe(true);
    });

    test('se carga con un doble de config vacío: no lee config al cargar', () => {
        expect(require('../../src/config')).toEqual({});
        expect(typeof recordPaymentRun).toBe('function');
    });
});

describe('ledgerFilePath', () => {
    test('arma <logsRoot>/sageconnect/<D>/daily-summary-payments.json, la carpeta del día de LogGenerator', () => {
        const root = path.join(os.tmpdir(), 'raiz-de-bitacoras');
        const file = ledgerFilePath(root, D);
        expect(file).toBe(expectedFile(root));
        expect(file.endsWith(path.join('sageconnect', '2026-11-03', 'daily-summary-payments.json'))).toBe(true);
    });

    test.each([
        ['2026-11-3'],
        ['../2026-11-03'],
        [''],
        ['2026-11-03/..'],
        ['2026-11-03\n'],
        [' 2026-11-03'],
        [20261103],
        [null],
        [undefined],
    ])('lanza con la fecha %p, que entraría en una ruta', (dateISO) => {
        expect(() => ledgerFilePath(path.join(os.tmpdir(), 'raiz'), dateISO)).toThrow();
    });

    test.each([[''], ['   '], [null], [undefined], [42]])('lanza con logsRoot %p', (logsRoot) => {
        expect(() => ledgerFilePath(logsRoot, D)).toThrow();
    });
});

describe('readPaymentDayLedger', () => {
    test('archivo ausente → missing', () => {
        const root = newLogsRoot();
        expect(readPaymentDayLedger(expectedFile(root), D)).toEqual({ status: 'missing', data: null });
    });

    test('archivo válido → ok con sus datos', () => {
        const root = newLogsRoot();
        const file = writeRaw(root, JSON.stringify(validLedger()));
        expect(readPaymentDayLedger(file, D)).toEqual({ status: 'ok', data: validLedger() });
    });

    test("válido con recoveredAt '2026-11-03T14:07:00' en la raíz → ok", () => {
        const root = newLogsRoot();
        const file = writeRaw(root, JSON.stringify(validLedger({ recoveredAt: '2026-11-03T14:07:00' })));
        const result = readPaymentDayLedger(file, D);
        expect(result.status).toBe('ok');
        expect(result.data.recoveredAt).toBe('2026-11-03T14:07:00');
    });

    test.each([
        ['texto que no es JSON', 'not json'],
        ['un arreglo JSON', '[]'],
        ['el literal null', 'null'],
        ['un archivo vacío', ''],
        ['JSON truncado', JSON.stringify(validLedger()).slice(0, 40)],
        ['version 2', JSON.stringify({ ...validLedger(), version: 2 })],
        ['version de texto', JSON.stringify({ ...validLedger(), version: '1' })],
        ['tenants ausente', JSON.stringify({ version: 1, date: D })],
        ['tenants que es arreglo', JSON.stringify({ version: 1, date: D, tenants: [] })],
        ['tenants null', JSON.stringify({ version: 1, date: D, tenants: null })],
        ['una fecha distinta a la del archivo', JSON.stringify({ ...validLedger(), date: '2026-11-02' })],
        ["recoveredAt: 'ayer'", JSON.stringify(validLedger({ recoveredAt: 'ayer' }))],
        ['recoveredAt null', JSON.stringify(validLedger({ recoveredAt: null }))],
        ['recoveredAt sin segundos', JSON.stringify(validLedger({ recoveredAt: '2026-11-03T14:07' }))],
    ])('%s → corrupt, con el motivo y sin lanzar', (_label, text) => {
        const root = newLogsRoot();
        const file = writeRaw(root, text);
        const result = readPaymentDayLedger(file, D);
        expect(result).toEqual({ status: 'corrupt', data: null, error: expect.any(String) });
        expect(result.error.length).toBeGreaterThan(0);
    });

    test('una carpeta en lugar del archivo → unreadable sin lanzar: es un error de E/S, no un contenido dañado (WR-02)', () => {
        const root = newLogsRoot();
        const file = expectedFile(root);
        fs.mkdirSync(file, { recursive: true });
        let result;
        expect(() => {
            result = readPaymentDayLedger(file, D);
        }).not.toThrow();
        expect(result).toEqual({ status: 'unreadable', data: null, error: expect.stringContaining('EISDIR') });
    });

    test.each([['EACCES'], ['EPERM'], ['EBUSY'], ['EMFILE'], ['EIO']])(
        'un error de E/S %s al leer un archivo válido → unreadable con el error, nunca corrupt (WR-02)', (code) => {
            const root = newLogsRoot();
            const file = writeRaw(root, JSON.stringify(validLedger()));
            const spy = failRead(file, code);
            let result;
            try {
                expect(() => {
                    result = readPaymentDayLedger(file, D);
                }).not.toThrow();
            } finally {
                spy.mockRestore();
            }
            expect(result).toEqual({ status: 'unreadable', data: null, error: `${code}: simulado por la prueba` });
        });

    test.each([[undefined], [null], [{}], ['']])('una ruta que no es texto útil (%p) → corrupt sin lanzar', (filePath) => {
        let result;
        expect(() => {
            result = readPaymentDayLedger(filePath, D);
        }).not.toThrow();
        expect(result).toEqual({ status: 'corrupt', data: null, error: expect.any(String) });
    });
});

describe('emptyPaymentDayLedger', () => {
    test('devuelve { version: 1, date, tenants: {} }, un objeto nuevo en cada llamada', () => {
        const a = emptyPaymentDayLedger(D);
        const b = emptyPaymentDayLedger(D);
        expect(a).toEqual({ version: 1, date: D, tenants: {} });
        expect(a).not.toBe(b);
        expect(a.tenants).not.toBe(b.tenants);
    });
});

describe('mergePaymentRun', () => {
    test('no muta su entrada: congelada a fondo no lanza y devuelve un objeto nuevo', () => {
        const base = validLedger({ recoveredAt: '2026-11-03T07:30:00' });
        base.tenants[OTHER_TENANT] = { runs: 3, lastRunAt: '2026-11-03T07:45:00', queryFailures: 1, lastQueryError: 'ETIMEOUT', payments: {} };
        const snapshot = JSON.parse(JSON.stringify(base));
        const input = deepFreeze(base);
        let out;
        expect(() => {
            out = mergePaymentRun(input, {
                tenantDb: TENANT,
                runAt: T2,
                results: new Map([
                    ['PY0000101', { outcome: 'uploaded' }],
                    ['PY0000102', { outcome: 'no-response', description: 'socket hang up', vendor: 'PROV02', fechaRegistro: '2026-10-21' }],
                ]),
                queryError: null,
            });
        }).not.toThrow();
        expect(input).toEqual(snapshot);
        expect(out).not.toBe(input);
        expect(out.tenants).not.toBe(input.tenants);
        expect(out.tenants[TENANT]).not.toBe(input.tenants[TENANT]);
        expect(out.tenants[TENANT].payments).not.toBe(input.tenants[TENANT].payments);
        expect(out.recoveredAt).toBe('2026-11-03T07:30:00');
        expect(out.tenants[OTHER_TENANT]).toEqual(snapshot.tenants[OTHER_TENANT]);
        expect(out.tenants[TENANT].runs).toBe(2);
        expect(out.tenants[TENANT].lastRunAt).toBe(T2);
        expect(out.tenants[TENANT].payments.PY0000101).toEqual({
            outcome: 'uploaded', code: null, description: null, vendor: 'PROV01', fechaRegistro: '2026-10-20',
            attempts: 2, firstAt: T1, lastAt: T2,
        });
        expect(out.tenants[TENANT].payments.PY0000102).toEqual({
            outcome: 'no-response', code: null, description: 'socket hang up', vendor: 'PROV02', fechaRegistro: '2026-10-21',
            attempts: 1, firstAt: T2, lastAt: T2,
        });
    });

    test('tampoco muta una entrada sin congelar', () => {
        const input = validLedger();
        const snapshot = JSON.parse(JSON.stringify(input));
        mergePaymentRun(input, { tenantDb: TENANT, runAt: T2, results: fivePayments(), queryError: 'ETIMEOUT' });
        expect(input).toEqual(snapshot);
    });

    test('rejected y luego uploaded → uploaded con attempts 2, firstAt del primero y lastAt del segundo', () => {
        const first = mergePaymentRun(emptyPaymentDayLedger(D), {
            tenantDb: TENANT,
            runAt: T1,
            results: new Map([['PY1', { outcome: 'rejected', code: '1827', description: 'Factura ya pagada', vendor: 'PROV01', fechaRegistro: '2026-10-20' }]]),
        });
        const second = mergePaymentRun(first, { tenantDb: TENANT, runAt: T2, results: new Map([['PY1', { outcome: 'uploaded' }]]) });
        expect(second.tenants[TENANT].payments.PY1).toEqual({
            outcome: 'uploaded', code: null, description: null, vendor: 'PROV01', fechaRegistro: '2026-10-20',
            attempts: 2, firstAt: T1, lastAt: T2,
        });
    });

    test('vendor y fechaRegistro se conservan si el nuevo no los trae y se reemplazan si los trae', () => {
        const first = mergePaymentRun(emptyPaymentDayLedger(D), {
            tenantDb: TENANT,
            runAt: T1,
            results: new Map([['PY1', { outcome: 'rejected', code: '1800', vendor: 'PROV01', fechaRegistro: '2026-10-20' }]]),
        });
        const second = mergePaymentRun(first, {
            tenantDb: TENANT,
            runAt: T2,
            results: new Map([['PY1', { outcome: 'rejected', code: '1800', vendor: '', fechaRegistro: 'ayer' }]]),
        });
        expect(second.tenants[TENANT].payments.PY1.vendor).toBe('PROV01');
        expect(second.tenants[TENANT].payments.PY1.fechaRegistro).toBe('2026-10-20');
        const third = mergePaymentRun(second, {
            tenantDb: TENANT,
            runAt: T3,
            results: new Map([['PY1', { outcome: 'rejected', code: '1800', vendor: 'PROV09', fechaRegistro: '2026-10-25' }]]),
        });
        expect(third.tenants[TENANT].payments.PY1.vendor).toBe('PROV09');
        expect(third.tenants[TENANT].payments.PY1.fechaRegistro).toBe('2026-10-25');
        expect(third.tenants[TENANT].payments.PY1.attempts).toBe(3);
    });

    test('un outcome fuera de LEDGER_OUTCOMES se ignora y no toca la entrada anterior', () => {
        const out = mergePaymentRun(validLedger(), {
            tenantDb: TENANT,
            runAt: T2,
            results: new Map([
                ['PY0000101', { outcome: 'exploded' }],
                ['PY2', { outcome: 'UPLOADED' }],
                ['PY3', null],
                ['PY4', { code: '1800' }],
                ['PY5', { outcome: 'uploaded' }],
            ]),
        });
        const tenant = out.tenants[TENANT];
        expect(Object.keys(tenant.payments).sort()).toEqual(['PY0000101', 'PY5']);
        expect(tenant.payments.PY0000101).toEqual(validLedger().tenants[TENANT].payments.PY0000101);
        expect(tenant.runs).toBe(2);
    });

    test('un DOCNBR vacío o que no es texto se ignora, y el DOCNBR se guarda sin espacios a las orillas', () => {
        const out = mergePaymentRun(emptyPaymentDayLedger(D), {
            tenantDb: TENANT,
            runAt: T1,
            results: [
                ['', { outcome: 'uploaded' }],
                ['   ', { outcome: 'uploaded' }],
                [null, { outcome: 'uploaded' }],
                [101, { outcome: 'uploaded' }],
                [' PY1 ', { outcome: 'uploaded' }],
            ],
        });
        expect(Object.keys(out.tenants[TENANT].payments)).toEqual(['PY1']);
    });

    test("un DOCNBR '__proto__' se ignora y no cambia el prototipo de payments", () => {
        const out = mergePaymentRun(emptyPaymentDayLedger(D), {
            tenantDb: TENANT,
            runAt: T1,
            results: [['__proto__', { outcome: 'uploaded' }], ['PY1', { outcome: 'uploaded' }]],
        });
        const payments = out.tenants[TENANT].payments;
        expect(Object.keys(payments)).toEqual(['PY1']);
        expect(Object.getPrototypeOf(payments)).toBe(Object.prototype);
    });

    test('los textos se acotan a 500 caracteres: código, descripción, proveedor, factura, error de consulta y DOCNBR', () => {
        const long = 'x'.repeat(600);
        const longKey = 'P'.repeat(600);
        const out = mergePaymentRun(emptyPaymentDayLedger(D), {
            tenantDb: TENANT,
            runAt: T1,
            results: new Map([
                ['PY1', { outcome: 'missing-uuid', code: long, description: long, vendor: long, invoices: [long] }],
                [longKey, { outcome: 'uploaded' }],
            ]),
            queryError: long,
        });
        const tenant = out.tenants[TENANT];
        const entry = tenant.payments.PY1;
        expect(entry.code).toHaveLength(500);
        expect(entry.description).toHaveLength(500);
        expect(entry.vendor).toHaveLength(500);
        expect(entry.invoices[0]).toHaveLength(500);
        expect(tenant.lastQueryError).toHaveLength(500);
        expect(Object.keys(tenant.payments)).toContain('P'.repeat(500));
        expect(Object.keys(tenant.payments).every((key) => key.length <= 500)).toBe(true);
    });

    test('las facturas se acotan a 50 por pago y solo se guardan las que traen texto', () => {
        const invoices = Array.from({ length: 60 }, (_, i) => `F${String(i + 1).padStart(3, '0')}`);
        const out = mergePaymentRun(emptyPaymentDayLedger(D), {
            tenantDb: TENANT,
            runAt: T1,
            results: new Map([
                ['PY1', { outcome: 'missing-uuid', description: '60 factura(s) sin UUID', invoices }],
                ['PY2', { outcome: 'missing-uuid', invoices: [null, '', 'F9', undefined] }],
            ]),
        });
        const payments = out.tenants[TENANT].payments;
        expect(payments.PY1.invoices).toHaveLength(50);
        expect(payments.PY1.invoices[0]).toBe('F001');
        expect(payments.PY1.invoices[49]).toBe('F050');
        expect(payments.PY2.invoices).toEqual(['F9']);
    });

    test("fechaRegistro solo si es YYYY-MM-DD: 'ayer' queda null", () => {
        const out = mergePaymentRun(emptyPaymentDayLedger(D), {
            tenantDb: TENANT,
            runAt: T1,
            results: new Map([
                ['PY1', { outcome: 'rejected', fechaRegistro: 'ayer' }],
                ['PY2', { outcome: 'rejected', fechaRegistro: '2026-10-20' }],
                ['PY3', { outcome: 'rejected', fechaRegistro: '2026-10-20T00:00:00' }],
            ]),
        });
        const payments = out.tenants[TENANT].payments;
        expect(payments.PY1.fechaRegistro).toBeNull();
        expect(payments.PY2.fechaRegistro).toBe('2026-10-20');
        expect(payments.PY3.fechaRegistro).toBeNull();
    });

    test('invoices solo si el resultado nuevo las trae', () => {
        const first = mergePaymentRun(emptyPaymentDayLedger(D), {
            tenantDb: TENANT,
            runAt: T1,
            results: new Map([['PY1', { outcome: 'missing-uuid', invoices: ['F1', 'F2'] }]]),
        });
        expect(first.tenants[TENANT].payments.PY1.invoices).toEqual(['F1', 'F2']);
        const second = mergePaymentRun(first, { tenantDb: TENANT, runAt: T2, results: new Map([['PY1', { outcome: 'uploaded' }]]) });
        expect(second.tenants[TENANT].payments.PY1).not.toHaveProperty('invoices');
    });

    test('un Map vacío suma 1 a runs y fija lastRunAt', () => {
        const out = mergePaymentRun(emptyPaymentDayLedger(D), { tenantDb: TENANT, runAt: T1, results: new Map() });
        expect(out.tenants[TENANT]).toEqual({ runs: 1, lastRunAt: T1, queryFailures: 0, lastQueryError: null, payments: {} });
        const again = mergePaymentRun(out, { tenantDb: TENANT, runAt: T2, results: new Map() });
        expect(again.tenants[TENANT]).toEqual({ runs: 2, lastRunAt: T2, queryFailures: 0, lastQueryError: null, payments: {} });
    });

    test('queryError suma 1 a queryFailures y guarda el texto; una corrida sin error no lo borra', () => {
        const message = 'Timeout: Request failed to complete in 180000ms';
        const first = mergePaymentRun(emptyPaymentDayLedger(D), { tenantDb: TENANT, runAt: T1, results: new Map(), queryError: message });
        expect(first.tenants[TENANT]).toEqual({ runs: 1, lastRunAt: T1, queryFailures: 1, lastQueryError: message, payments: {} });
        const second = mergePaymentRun(first, { tenantDb: TENANT, runAt: T2, results: new Map(), queryError: null });
        expect(second.tenants[TENANT]).toEqual({ runs: 2, lastRunAt: T2, queryFailures: 1, lastQueryError: message, payments: {} });
        const third = mergePaymentRun(second, { tenantDb: TENANT, runAt: T3, results: new Map(), queryError: 'ECONNRESET' });
        expect(third.tenants[TENANT].queryFailures).toBe(2);
        expect(third.tenants[TENANT].lastQueryError).toBe('ECONNRESET');
    });

    test('un data con recoveredAt en la raíz devuelve el mismo recoveredAt y los demás campos de la raíz', () => {
        const data = { version: 1, date: D, recoveredAt: '2026-11-03T14:07:00', tenants: {} };
        const out = mergePaymentRun(data, { tenantDb: TENANT, runAt: T2, results: fivePayments() });
        expect(out.recoveredAt).toBe('2026-11-03T14:07:00');
        expect(out.version).toBe(1);
        expect(out.date).toBe(D);
        expect(Object.keys(out).sort()).toEqual(['date', 'recoveredAt', 'tenants', 'version']);
        expect(out.tenants[TENANT]).not.toHaveProperty('recoveredAt');
    });

    test('acepta un arreglo de pares además de un Map', () => {
        const out = mergePaymentRun(emptyPaymentDayLedger(D), {
            tenantDb: TENANT,
            runAt: T1,
            results: Array.from(fivePayments().entries()),
        });
        expect(Object.keys(out.tenants[TENANT].payments)).toHaveLength(5);
    });

    test('cada pago guarda exactamente los campos de D-16, nunca los que sobran en el resultado', () => {
        const out = mergePaymentRun(emptyPaymentDayLedger(D), {
            tenantDb: TENANT,
            runAt: T1,
            results: new Map([['PY1', {
                outcome: 'missing-uuid',
                code: null,
                description: '2 factura(s) sin UUID',
                vendor: 'PROV01',
                fechaRegistro: '2026-10-20',
                invoices: ['F1', 'F2'],
                extra: 'no se guarda',
                responseAPI: 'tampoco',
            }]]),
        });
        expect(Object.keys(out.tenants[TENANT].payments.PY1).sort()).toEqual([
            'attempts', 'code', 'description', 'fechaRegistro', 'firstAt', 'invoices', 'lastAt', 'outcome', 'vendor',
        ]);
        expect(Object.keys(out.tenants[TENANT]).sort()).toEqual(['lastQueryError', 'lastRunAt', 'payments', 'queryFailures', 'runs']);
    });

    test.each([
        ['tenantDb vacío', { tenantDb: '', runAt: T1, results: new Map() }],
        ['tenantDb que no es texto', { tenantDb: 7, runAt: T1, results: new Map() }],
        ["tenantDb '__proto__'", { tenantDb: '__proto__', runAt: T1, results: new Map() }],
        ['runAt sin segundos', { tenantDb: TENANT, runAt: '2026-11-03T08:00', results: new Map() }],
        ['runAt con espacio en vez de T', { tenantDb: TENANT, runAt: '2026-11-03 08:00:00', results: new Map() }],
        ['runAt ausente', { tenantDb: TENANT, results: new Map() }],
        ['results que es un objeto', { tenantDb: TENANT, runAt: T1, results: { PY1: { outcome: 'uploaded' } } }],
        ['results ausente', { tenantDb: TENANT, runAt: T1 }],
    ])('lanza ante %s: es un error de programación que recordPaymentRun vuelve ok false', (_label, runArgs) => {
        expect(() => mergePaymentRun(emptyPaymentDayLedger(D), runArgs)).toThrow(TypeError);
    });

    test('lanza si data no es un objeto', () => {
        const runArgs = { tenantDb: TENANT, runAt: T1, results: new Map() };
        expect(() => mergePaymentRun(null, runArgs)).toThrow(TypeError);
        expect(() => mergePaymentRun([], runArgs)).toThrow(TypeError);
    });
});

describe('recordPaymentRun', () => {
    test('la primera llamada crea la carpeta del día y el archivo, de forma síncrona', () => {
        const root = newLogsRoot();
        expect(fs.existsSync(path.join(root, 'sageconnect'))).toBe(false);
        const result = record(root, T1, new Map([['PY1', { outcome: 'uploaded', vendor: 'PROV01', fechaRegistro: '2026-10-20' }]]));
        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toEqual({ ok: true, previous: 'missing', recovered: false, file: expectedFile(root), error: null });
        expect(readJson(root)).toEqual({
            version: 1,
            date: D,
            tenants: {
                [TENANT]: {
                    runs: 1,
                    lastRunAt: T1,
                    queryFailures: 0,
                    lastQueryError: null,
                    payments: {
                        PY1: {
                            outcome: 'uploaded', code: null, description: null, vendor: 'PROV01', fechaRegistro: '2026-10-20',
                            attempts: 1, firstAt: T1, lastAt: T1,
                        },
                    },
                },
            },
        });
        expect(fs.existsSync(expectedFile(root) + '.tmp')).toBe(false);
        expect(readPaymentDayLedger(expectedFile(root), D).status).toBe('ok');
    });

    test('RD-10: cuatro corridas con los mismos 5 pagos dejan 5 entradas con attempts 4 y runs 4', () => {
        const root = newLogsRoot();
        const stamps = ['2026-11-03T08:00:00', '2026-11-03T08:15:00', '2026-11-03T08:30:00', '2026-11-03T08:45:00'];
        const sizes = [];
        for (const runAt of stamps) {
            const result = record(root, runAt, fivePayments());
            expect(result.ok).toBe(true);
            sizes.push(fs.statSync(expectedFile(root)).size);
        }
        const tenant = readJson(root).tenants[TENANT];
        expect(tenant.runs).toBe(4);
        expect(tenant.lastRunAt).toBe('2026-11-03T08:45:00');
        expect(Object.keys(tenant.payments).sort()).toEqual(['PY0000101', 'PY0000102', 'PY0000103', 'PY0000104', 'PY0000105']);
        for (const entry of Object.values(tenant.payments)) {
            expect(entry.attempts).toBe(4);
            expect(entry.firstAt).toBe('2026-11-03T08:00:00');
            expect(entry.lastAt).toBe('2026-11-03T08:45:00');
        }
        // El tamaño crece con los pagos distintos del día, no con las corridas.
        expect(sizes).toEqual([sizes[0], sizes[0], sizes[0], sizes[0]]);
    });

    test('dos empresas en el mismo archivo quedan separadas', () => {
        const root = newLogsRoot();
        expect(record(root, T1, new Map([['PY1', { outcome: 'rejected', code: '1800' }]])).ok).toBe(true);
        expect(recordPaymentRun({
            logsRoot: root, dateISO: D, tenantDb: OTHER_TENANT, runAt: T2,
            results: new Map([['PY1', { outcome: 'uploaded' }]]),
            queryError: 'ETIMEOUT',
        }).ok).toBe(true);
        expect(record(root, T3, new Map()).ok).toBe(true);
        const data = readJson(root);
        expect(Object.keys(data.tenants).sort()).toEqual([TENANT, OTHER_TENANT].sort());
        expect(data.tenants[TENANT]).toEqual(expect.objectContaining({ runs: 2, lastRunAt: T3, queryFailures: 0, lastQueryError: null }));
        expect(data.tenants[TENANT].payments.PY1).toEqual(expect.objectContaining({ outcome: 'rejected', code: '1800', attempts: 1 }));
        expect(data.tenants[OTHER_TENANT]).toEqual(expect.objectContaining({ runs: 1, lastRunAt: T2, queryFailures: 1, lastQueryError: 'ETIMEOUT' }));
        expect(data.tenants[OTHER_TENANT].payments.PY1).toEqual(expect.objectContaining({ outcome: 'uploaded', attempts: 1 }));
    });

    test('un archivo dañado se reinicia con recoveredAt = runAt en la RAÍZ y devuelve recovered true, previous corrupt', () => {
        const root = newLogsRoot();
        writeRaw(root, 'not json');
        const result = record(root, '2026-11-03T14:07:00', new Map([['PY1', { outcome: 'rejected', code: '1827', description: 'Factura ya pagada' }]]));
        expect(result).toEqual({ ok: true, previous: 'corrupt', recovered: true, file: expectedFile(root), error: null });
        const data = readJson(root);
        expect(Object.keys(data).sort()).toEqual(['date', 'recoveredAt', 'tenants', 'version']);
        expect(data.recoveredAt).toBe('2026-11-03T14:07:00');
        expect(data.version).toBe(1);
        expect(data.date).toBe(D);
        expect(data.tenants[TENANT]).not.toHaveProperty('recoveredAt');
        expect(data.tenants[TENANT].payments.PY1).not.toHaveProperty('recoveredAt');
        expect(data.tenants[TENANT].runs).toBe(1);
        expect(data.tenants[TENANT].payments.PY1).toEqual(expect.objectContaining({ outcome: 'rejected', attempts: 1 }));
        expect(readPaymentDayLedger(expectedFile(root), D).status).toBe('ok');
    });

    test('reinicio y conservación: el recoveredAt del reinicio sobrevive a la corrida normal y un segundo daño lo reemplaza', () => {
        const root = newLogsRoot();
        writeRaw(root, 'not json');
        const first = record(root, '2026-11-03T14:07:00', new Map([['PY1', { outcome: 'rejected', code: '1800' }]]));
        expect(first).toEqual(expect.objectContaining({ ok: true, previous: 'corrupt', recovered: true }));
        expect(readJson(root).recoveredAt).toBe('2026-11-03T14:07:00');

        const second = record(root, '2026-11-03T15:00:00', new Map([['PY2', { outcome: 'uploaded', vendor: 'PROV02' }]]));
        expect(second).toEqual(expect.objectContaining({ ok: true, previous: 'ok', recovered: false }));
        const afterSecond = readJson(root);
        expect(afterSecond.recoveredAt).toBe('2026-11-03T14:07:00');
        expect(afterSecond.tenants[TENANT].runs).toBe(2);
        expect(afterSecond.tenants[TENANT].payments.PY2).toEqual(expect.objectContaining({
            outcome: 'uploaded', vendor: 'PROV02', attempts: 1, firstAt: '2026-11-03T15:00:00', lastAt: '2026-11-03T15:00:00',
        }));
        expect(afterSecond.tenants[TENANT].payments.PY1).toEqual(expect.objectContaining({ outcome: 'rejected', attempts: 1 }));

        writeRaw(root, '{"version":1,"date":"2026-11-03","tenants":');
        const third = record(root, '2026-11-03T16:30:00', new Map([['PY3', { outcome: 'no-invoices' }]]));
        expect(third).toEqual(expect.objectContaining({ ok: true, previous: 'corrupt', recovered: true }));
        const afterThird = readJson(root);
        expect(afterThird.recoveredAt).toBe('2026-11-03T16:30:00');
        expect(afterThird.tenants[TENANT].runs).toBe(1);
        expect(Object.keys(afterThird.tenants[TENANT].payments)).toEqual(['PY3']);
    });

    test('una falla de la consulta de encabezados queda contada por empresa (D-27)', () => {
        const root = newLogsRoot();
        expect(record(root, T1, new Map(), { queryError: 'Connection lost - read ECONNRESET' }).ok).toBe(true);
        expect(record(root, T2, new Map([['PY1', { outcome: 'uploaded' }]])).ok).toBe(true);
        const tenant = readJson(root).tenants[TENANT];
        expect(tenant.runs).toBe(2);
        expect(tenant.queryFailures).toBe(1);
        expect(tenant.lastQueryError).toBe('Connection lost - read ECONNRESET');
    });

    test('si el rename falla: ok false con el mensaje y el archivo anterior queda byte a byte igual', () => {
        const root = newLogsRoot();
        expect(record(root, T1, fivePayments()).ok).toBe(true);
        const file = expectedFile(root);
        const before = fs.readFileSync(file);
        const realRenameSync = fs.renameSync;
        let renameAttempts = 0;
        const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
            if (to === file) {
                renameAttempts += 1;
                throw new Error('EPERM forzado por la prueba');
            }
            return realRenameSync.call(fs, from, to);
        });
        let result;
        try {
            expect(() => {
                result = record(root, T2, new Map([['PY9', { outcome: 'uploaded' }]]));
            }).not.toThrow();
        } finally {
            renameSpy.mockRestore();
        }
        expect(renameAttempts).toBe(1);
        expect(result).toEqual(expect.objectContaining({ ok: false, recovered: false, file }));
        expect(result.error).toMatch(/EPERM forzado por la prueba/);
        expect(fs.readFileSync(file).equals(before)).toBe(true);

        // La corrida que no se pudo escribir no dejó rastro: la siguiente cuenta sobre el archivo anterior.
        expect(record(root, T3, fivePayments()).ok).toBe(true);
        const tenant = readJson(root).tenants[TENANT];
        expect(tenant.runs).toBe(2);
        expect(tenant.payments).not.toHaveProperty('PY9');
        expect(tenant.payments.PY0000101.attempts).toBe(2);
    });

    test.each([['2026-11-3'], ['../2026-11-03'], ['']])('con la fecha inválida %p devuelve ok false y no crea nada', (dateISO) => {
        const root = newLogsRoot();
        let result;
        expect(() => {
            result = recordPaymentRun({ logsRoot: root, dateISO, tenantDb: TENANT, runAt: T1, results: fivePayments() });
        }).not.toThrow();
        expect(result).toEqual({ ok: false, previous: null, recovered: false, file: null, error: expect.any(String) });
        expect(fs.readdirSync(root)).toEqual([]);
    });

    test('con logsRoot vacío o ausente devuelve ok false sin calcular ninguna ruta', () => {
        for (const logsRoot of ['', undefined]) {
            const result = recordPaymentRun({ logsRoot, dateISO: D, tenantDb: TENANT, runAt: T1, results: new Map() });
            expect(result).toEqual({ ok: false, previous: null, recovered: false, file: null, error: expect.any(String) });
        }
    });

    test('con logsRoot apuntando a un archivo regular devuelve ok false sin lanzar', () => {
        const root = newLogsRoot();
        const regular = path.join(root, 'no-soy-carpeta.txt');
        fs.writeFileSync(regular, 'x', 'utf8');
        let result;
        expect(() => {
            result = recordPaymentRun({ logsRoot: regular, dateISO: D, tenantDb: TENANT, runAt: T1, results: fivePayments() });
        }).not.toThrow();
        expect(result.ok).toBe(false);
        expect(result.error).toEqual(expect.any(String));
        expect(fs.readFileSync(regular, 'utf8')).toBe('x');
    });

    test('con una carpeta en lugar del archivo devuelve ok false sin lanzar, previous unreadable, y la carpeta sigue ahí', () => {
        const root = newLogsRoot();
        const file = expectedFile(root);
        fs.mkdirSync(file, { recursive: true });
        let result;
        expect(() => {
            result = record(root, T1, fivePayments());
        }).not.toThrow();
        expect(result).toEqual({ ok: false, previous: 'unreadable', recovered: false, file, error: expect.stringContaining('EISDIR') });
        expect(fs.statSync(file).isDirectory()).toBe(true);
        // Ni siquiera se intentó escribir: no quedó temporal.
        expect(fs.existsSync(file + '.tmp')).toBe(false);
    });

    test('WR-02: con dos empresas en el archivo, una lectura que falla (EACCES) no lo reinicia: ok false, previous unreadable y el archivo queda byte a byte igual', () => {
        const root = newLogsRoot();
        expect(record(root, T1, new Map([
            ['PY0000101', { outcome: 'rejected', code: '1827', description: 'Alguna factura del pago ya está pagada', vendor: 'PROV01', fechaRegistro: '2026-10-20' }],
        ])).ok).toBe(true);
        expect(recordPaymentRun({
            logsRoot: root, dateISO: D, tenantDb: OTHER_TENANT, runAt: T2,
            results: new Map([['PY0000201', { outcome: 'uploaded', vendor: 'PROV02', fechaRegistro: '2026-10-21' }]]),
        }).ok).toBe(true);
        const file = expectedFile(root);
        const before = fs.readFileSync(file);

        const spy = failRead(file, 'EACCES');
        let result;
        try {
            expect(() => {
                result = record(root, T3, new Map([['PY0000102', { outcome: 'uploaded', vendor: 'PROV01' }]]));
            }).not.toThrow();
        } finally {
            spy.mockRestore();
        }

        expect(result).toEqual({ ok: false, previous: 'unreadable', recovered: false, file, error: 'EACCES: simulado por la prueba' });
        expect(fs.readFileSync(file).equals(before)).toBe(true);
        expect(fs.existsSync(file + '.tmp')).toBe(false);

        // Con la lectura de vuelta, la corrida siguiente mezcla sobre el archivo intacto: las dos
        // empresas y el rechazo siguen ahí y no hay marca de reinicio.
        expect(record(root, '2026-11-03T08:45:00', new Map()).ok).toBe(true);
        const data = readJson(root);
        expect(data).not.toHaveProperty('recoveredAt');
        expect(Object.keys(data.tenants).sort()).toEqual([TENANT, OTHER_TENANT].sort());
        expect(data.tenants[TENANT].runs).toBe(2);
        expect(data.tenants[TENANT].payments.PY0000101).toEqual(expect.objectContaining({ outcome: 'rejected', code: '1827', attempts: 1 }));
        expect(data.tenants[OTHER_TENANT].payments.PY0000201).toEqual(expect.objectContaining({ outcome: 'uploaded', attempts: 1 }));
    });

    test('con un runAt inválido devuelve ok false y no toca el archivo, ni el legible ni el dañado', () => {
        const root = newLogsRoot();
        expect(record(root, T1, fivePayments()).ok).toBe(true);
        const before = fs.readFileSync(expectedFile(root));
        const onValid = record(root, '2026-11-03 08:15', fivePayments());
        expect(onValid).toEqual(expect.objectContaining({ ok: false, previous: 'ok', recovered: false }));
        expect(fs.readFileSync(expectedFile(root)).equals(before)).toBe(true);

        writeRaw(root, 'not json');
        const onCorrupt = record(root, 'ayer', fivePayments());
        expect(onCorrupt).toEqual(expect.objectContaining({ ok: false, previous: 'corrupt', recovered: false }));
        expect(fs.readFileSync(expectedFile(root), 'utf8')).toBe('not json');
    });

    test('sin argumentos devuelve ok false sin lanzar', () => {
        let result;
        expect(() => {
            result = recordPaymentRun();
        }).not.toThrow();
        expect(result).toEqual({ ok: false, previous: null, recovered: false, file: null, error: expect.any(String) });
    });

    test('el JSON escrito no contiene lastUpdate ni responseAPI', () => {
        const root = newLogsRoot();
        const results = fivePayments();
        results.set('PY0000106', { outcome: 'uploaded', vendor: 'PROV06', fechaRegistro: '2026-10-25' });
        results.set('PY0000107', { outcome: 'no-invoices', description: 'Sage no devolvió facturas para el pago', vendor: 'PROV07' });
        expect(record(root, T1, results, { queryError: 'ETIMEOUT' }).ok).toBe(true);
        const raw = fs.readFileSync(expectedFile(root), 'utf8');
        expect(raw).not.toMatch(/lastUpdate|responseAPI/);
        expect(Object.keys(JSON.parse(raw).tenants[TENANT].payments)).toHaveLength(7);
    });
});
