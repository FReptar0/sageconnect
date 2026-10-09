/**
 * Tests del filtro "ya está en Sage" en bloque y de getTypeI/getTypeE paginadas
 * (fase 24, plan 24-02).
 *
 * Cubre D-12 a D-20 (orden del filtro RFC → CxP → OC/NC, literales del IN tal como vinieron,
 * lista blanca antes de SQL, errores por bloque, consultas en serie y acotadas, líneas
 * [FILTRO-SAGE], sin console.log por factura), D-24 (paridad contra un oráculo congelado de la
 * decisión por factura de hoy, con intercalación CI y CS) y D-25 (prueba negativa). Los modelos
 * del portal y de la base viven en tests/helpers/getTypesCfdiFakes.js.
 *
 * Ningún test duerme en tiempo real (D-11): jest.useFakeTimers y settle(), que corre los
 * temporizadores; el modelo del portal adelanta el reloj con jest.setSystemTime.
 *
 * Prueba negativa (D-25), corriendo esta suite contra el GetTypesCFDI.js de origin/master:
 *   DEBEN FALLAR F-01 a F-04, F-07 a F-16 y F-18 (paginación, conteo de SQL, presupuesto,
 *   validación, errores por bloque, registro y fuente).
 *   DEBEN PASAR F-05, F-06 y F-17 en todas sus variantes: anclas de la decisión por factura de hoy.
 */

const fs = require('fs');
const path = require('path');
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://test',
        tenants: [{ id: 'T1', key: 'k1', secret: 's1', database: 'DB1' }],
        httpTimeoutMs: 30000,
    },
    paths: { logs: '/tmp/logs' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    app: { timezone: 'America/Mexico_City' },
    schedule: { stepTimeoutMs: 300000, lockTimeoutMs: 840000, childProcessTimeoutMs: 600000, cronExpression: '*/15 * * * *', operationDelayMs: 5000 },
}));

const mockGet = jest.fn();
jest.mock('../../src/utils/PortalClient', () => ({ get: mockGet }));

const mockLog = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLog }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

jest.mock('../../src/utils/TimezoneHelper', () => ({ getOneMonthAgoString: () => '2026-09' }));

const config = require('../../src/config');
const GetTypesCFDI = require('../../src/utils/GetTypesCFDI');
const {
    makeUuid,
    makeItem,
    makeItems,
    createPortal,
    createSageDb,
    sqlEquals,
    logLines,
    PAGINACION_LINE,
    FILTRO_RESUMEN_LINE,
    FILTRO_FACTURA_LINE
} = require('../helpers/getTypesCfdiFakes');

const R1 = 'AAA010101AAA';
const R2 = 'BBB020202BBB';

/** Corre los temporizadores falsos (esperas de reintento) hasta que la llamada termina. */
async function settle(p) {
    await jest.runAllTimersAsync();
    return p;
}

/** Líneas [PAGINACION] de GetTypesCFDI.log; cada una debe cumplir el formato fijo de D-17. */
function paginacion() {
    const lineas = logLines(mockLog).filter(l => l.msg.startsWith('[PAGINACION] '));
    for (const linea of lineas) {
        expect(linea.msg).toMatch(PAGINACION_LINE);
    }
    return lineas;
}

/** Líneas [FILTRO-SAGE] de GetTypesCFDI.log. */
function filtro() {
    return logLines(mockLog).filter(l => l.msg.startsWith('[FILTRO-SAGE] '));
}

/** La única línea resumen [FILTRO-SAGE] de una consulta (D-18). */
function resumen(consulta) {
    const lineas = filtro().filter(l => FILTRO_RESUMEN_LINE.test(l.msg) && l.msg.startsWith(`[FILTRO-SAGE] consulta=${consulta} `));
    expect(lineas).toHaveLength(1);
    return lineas[0];
}

/** Líneas por factura (D-19). */
function porFactura() {
    return filtro().filter(l => FILTRO_FACTURA_LINE.test(l.msg));
}

/** Líneas de error de una consulta del filtro: llevan tabla, bloque, tamaño y mensaje (D-15). */
function erroresDeBloque() {
    return filtro().filter(l => /^\[FILTRO-SAGE\] consulta=\S+ tenant=\S+ tabla=/.test(l.msg));
}

/** Llamadas a runQuery de una tabla del modelo: rfcs, cxp, oc o nc. */
function sqls(db, tabla) {
    return db.calls.filter(c => c.table === tabla);
}

/** Texto de cada llamada a console.log (el espía del beforeEach). */
function consola() {
    return console.log.mock.calls.map(args => args.map(a => String(a)).join(' '));
}

function rango(desde, hasta) {
    const out = [];
    for (let n = desde; n <= hasta; n++) out.push(n);
    return out;
}

/** Copia de stripComments de tests/integration/timeout-logging.test.js:59-65. */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
}

/** Funciones de nivel superior: { nombre: cuerpo }, del encabezado al siguiente o a module.exports. */
function funciones(src) {
    const encabezados = [...src.matchAll(/^(?:async\s+)?function\s+(\w+)\s*\(/gm)];
    const fin = src.indexOf('module.exports');
    const cuerpos = {};
    encabezados.forEach((m, i) => {
        const hasta = i + 1 < encabezados.length ? encabezados[i + 1].index : (fin === -1 ? src.length : fin);
        cuerpos[m[1]] = src.slice(m.index, hasta);
    });
    return cuerpos;
}

/**
 * Los 12 items de la paridad (F-05 a F-07). Todos con R1 salvo el 9 (R2, no registrado) y el 10
 * (R1 en minúsculas); el 6 llega con el UUID en minúsculas.
 */
function itemsParidad() {
    return rango(1, 12).map(n => {
        if (n === 6) return makeItem(n, { rfc: R1, uuid: makeUuid(6).toLowerCase() });
        if (n === 9) return makeItem(n, { rfc: R2 });
        if (n === 10) return makeItem(n, { rfc: R1.toLowerCase() });
        return makeItem(n, { rfc: R1 });
    });
}

/**
 * Dataset de la paridad. Trampas: ERRENTRY distinto de 0 (7), OPTFIELD distinto de FOLIOCFD (8),
 * espacios finales como un char(60) (11), mayúsculas distintas entre portal y Sage (6 y 12), y la
 * tabla que NO corresponde (NC para facturas, OC para notas de crédito) con el UUID del 4.
 */
function datasetParidad(tablaDoc) {
    const otra = tablaDoc === 'oc' ? 'nc' : 'oc';
    return {
        rfcs: [R1],
        cxp: [makeUuid(1), makeUuid(3), makeUuid(6), { value: makeUuid(7), errentry: 1 }, makeUuid(9), makeUuid(11) + '   '],
        [tablaDoc]: [makeUuid(2), makeUuid(3), { value: makeUuid(8), optfield: 'OTRO' }, makeUuid(12).toLowerCase()],
        [otra]: [makeUuid(4)]
    };
}

/**
 * Oráculo congelado (D-24): la decisión por factura del filtro anterior, evaluada sobre el mismo
 * dataset con la misma intercalación. Se conserva si algún RFC registrado es igual al suyo, Y no
 * hay fila de CxP con ERRENTRY 0, OPTFIELD 'FOLIOCFD' y su UUID, Y no hay fila de la tabla de
 * documento (oc para facturas, nc para notas de crédito) con OPTFIELD 'FOLIOCFD' y su UUID.
 */
function oraculo(items, dataset, tablaDoc, collation) {
    const fila = (row) => (typeof row === 'string'
        ? { value: row, errentry: 0, optfield: 'FOLIOCFD' }
        : { errentry: 0, optfield: 'FOLIOCFD', ...row });
    return items.filter(item => {
        const rfc = item.cfdi.receptor.rfc;
        const uuid = item.cfdi.timbre.uuid;
        const rfcRegistrado = (dataset.rfcs || []).some(r => sqlEquals(r, rfc, collation));
        const enCxp = (dataset.cxp || []).map(fila)
            .some(f => f.errentry === 0 && f.optfield === 'FOLIOCFD' && sqlEquals(f.value, uuid, collation));
        const enDocumento = (dataset[tablaDoc] || []).map(fila)
            .some(f => f.optfield === 'FOLIOCFD' && sqlEquals(f.value, uuid, collation));
        return rfcRegistrado && !enCxp && !enDocumento;
    });
}

/**
 * Escenario del registro (F-14 y F-15): 450 items; 1..440 y 449..450 con R1, 441..445 con R2 (no
 * registrado), 446 con UUID inválido, 447 con RFC inválido y 448 sin receptor. En Sage: 1..300 en
 * CxP y 301..400 en OC.
 */
function escenarioRegistro() {
    const items = rango(1, 450).map(n => {
        if (n >= 441 && n <= 445) return makeItem(n, { rfc: R2 });
        if (n === 446) return makeItem(n, { rfc: R1, uuid: 'no-es-uuid' });
        if (n === 447) return makeItem(n, { rfc: 'RFC CON ESPACIOS' });
        if (n === 448) return makeItem(n, { sinReceptor: true });
        return makeItem(n, { rfc: R1 });
    });
    const dataset = {
        rfcs: [R1],
        cxp: items.slice(0, 300).map(i => i.cfdi.timbre.uuid),
        oc: items.slice(300, 400).map(i => i.cfdi.timbre.uuid)
    };
    return { items, dataset };
}

describe('GetTypesCFDI — filtro en bloque y getTypeI/getTypeE paginadas (fase 24, 24-02)', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        jest.useFakeTimers({ now: new Date('2026-10-08T12:00:00Z'), doNotFake: ['nextTick', 'queueMicrotask'] });
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        // Primero restaurar los espías: si se restaurara uno de setTimeout después de
        // useRealTimers, reinstalaría el setTimeout falso en el global.
        jest.restoreAllMocks();
        jest.useRealTimers();
        config.schedule.stepTimeoutMs = 300000;
    });

    test('F-01 getTypeI pide en serie las 3 páginas de 450 con hideValidations y las filtra en bloque (REQ-24-01/14)', async () => {
        const items = makeItems(450, { rfc: R1 });
        const portal = createPortal({ items });
        const db = createSageDb({ rfcs: [R1] });
        mockGet.mockImplementation(portal.get);
        mockRunQuery.mockImplementation(db.runQuery);

        const result = await settle(GetTypesCFDI.getTypeI(0));

        const url = (offset) => 'http://test/api/1.0/extern/tenants/T1/cfdis?documentTypes=CFDI&offset=' + offset +
            '&pageSize=200&cfdiType=INVOICE&stage=PENDING_TO_PAY&from=2026-09-01&hideValidations=true';
        expect(portal.calls.map(c => c.url)).toEqual([url(0), url(200), url(400)]);
        for (const call of portal.calls) {
            expect(call.headers.PDPTenantKey).toBe('k1');
            expect(call.headers.PDPTenantSecret).toBe('s1');
        }
        expect(portal.stats.maxInFlight).toBe(1);
        expect(result).toEqual(items);
        expect(paginacion()).toEqual([{
            level: 'info',
            msg: '[PAGINACION] consulta=getTypeI tenant=T1 total=450 recibidas=450 paginas=3 ms=0 pagina_mas_lenta_ms=0 corte=completo'
        }]);
        expect(resumen('getTypeI')).toEqual({
            level: 'info',
            msg: '[FILTRO-SAGE] consulta=getTypeI tenant=T1 recibidas=450 ya_en_sage=0 sin_rfc=0 invalidas=0 error_sql=0 a_descargar=450 ms=0'
        });
    });

    test('F-02 getTypeE pide las 3 páginas de CREDIT_NOTE sin stage y con hideValidations (REQ-24-01/14)', async () => {
        const items = makeItems(450, { rfc: R1 });
        const portal = createPortal({ items });
        const db = createSageDb({ rfcs: [R1] });
        mockGet.mockImplementation(portal.get);
        mockRunQuery.mockImplementation(db.runQuery);

        const result = await settle(GetTypesCFDI.getTypeE(0));

        const url = (offset) => 'http://test/api/1.0/extern/tenants/T1/cfdis?documentTypes=CFDI&offset=' + offset +
            '&pageSize=200&cfdiType=CREDIT_NOTE&from=2026-09-01&hideValidations=true';
        expect(portal.calls.map(c => c.url)).toEqual([url(0), url(200), url(400)]);
        expect(portal.calls.some(c => c.url.includes('stage'))).toBe(false);
        expect(result).toEqual(items);
        expect(paginacion()).toEqual([{
            level: 'info',
            msg: '[PAGINACION] consulta=getTypeE tenant=T1 total=450 recibidas=450 paginas=3 ms=0 pagina_mas_lenta_ms=0 corte=completo'
        }]);
    });

    test('F-03 con una página fallida filtra lo recibido y sólo dice "no hay" si el listado terminó (REQ-24-05, D-02)', async () => {
        const db = createSageDb({ rfcs: [R1] });
        mockRunQuery.mockImplementation(db.runQuery);

        // (a) la página 3 falla tras 3 intentos: se filtran y devuelven las 400 recibidas
        const items = makeItems(450, { rfc: R1 });
        const a = createPortal({ items, failures: { 400: [503, 503, 503] } });
        mockGet.mockImplementation(a.get);

        const ra = await settle(GetTypesCFDI.getTypeI(0));

        expect(ra).toEqual(items.slice(0, 400));
        const [la] = paginacion();
        expect(la.level).toBe('warn');
        expect(la.msg).toContain('recibidas=400 paginas=2');
        expect(la.msg).toContain('corte=pagina-fallida offset_fallido=400');
        expect(resumen('getTypeI').msg).toContain('recibidas=400');

        // (b) falla la primera página: [] sin decir que no hay comprobantes
        mockLog.mockClear();
        console.log.mockClear();
        const b = createPortal({ items: makeItems(450, { rfc: R1 }), failures: { 0: [503, 503, 503] } });
        mockGet.mockImplementation(b.get);

        const rb = await settle(GetTypesCFDI.getTypeI(0));

        expect(rb).toEqual([]);
        const [lb] = paginacion();
        expect(lb.level).toBe('warn');
        expect(lb.msg).toContain('corte=pagina-fallida offset_fallido=0');
        expect(consola().some(t => t.includes('No hay CFDI de tipo I'))).toBe(false);

        // (c) el portal no tiene comprobantes: [] y una sola vez "[INFO] No hay CFDI de tipo I"
        mockLog.mockClear();
        console.log.mockClear();
        const c = createPortal({ items: [] });
        mockGet.mockImplementation(c.get);

        const rc = await settle(GetTypesCFDI.getTypeI(0));

        expect(rc).toEqual([]);
        const [lc] = paginacion();
        expect(lc.level).toBe('info');
        expect(lc.msg).toContain('total=0 recibidas=0 paginas=1');
        expect(lc.msg).toContain('corte=completo');
        expect(consola().filter(t => t.includes('[INFO] No hay CFDI de tipo I'))).toHaveLength(1);
    });

    describe.each(['getTypeI', 'getTypeE'])('%s', (fn) => {
        test('F-04 agotado el presupuesto no pide otra página y filtra lo recibido (REQ-24-06)', async () => {
            const items = makeItems(600, { rfc: R1 });
            const portal = createPortal({ items, delayMs: 40000 });
            const db = createSageDb({ rfcs: [R1] });
            mockGet.mockImplementation(portal.get);
            mockRunQuery.mockImplementation(db.runQuery);

            const result = await settle(GetTypesCFDI[fn](0));

            expect(portal.calls).toHaveLength(2);
            expect(result).toEqual(items.slice(0, 400));
            const [linea] = paginacion();
            expect(linea.level).toBe('warn');
            expect(linea.msg).toContain('total=600 recibidas=400 paginas=2 ms=80000 pagina_mas_lenta_ms=40000 corte=presupuesto');
        });
    });

    describe.each(['CI', 'CS'])('intercalación %s', (collation) => {
        test('F-05 getTypeI decide lo mismo que el filtro por factura de hoy (REQ-24-07, D-24)', async () => {
            const items = itemsParidad();
            const dataset = datasetParidad('oc');
            const db = createSageDb(dataset, { collation });
            mockGet.mockImplementation(createPortal({ items }).get);
            mockRunQuery.mockImplementation(db.runQuery);

            const result = await settle(GetTypesCFDI.getTypeI(0));

            const salida = result.map(i => i.cfdi.timbre.uuid);
            expect(salida).toEqual(oraculo(items, dataset, 'oc', collation).map(i => i.cfdi.timbre.uuid));
            const u6 = makeUuid(6).toLowerCase();
            expect(salida).toEqual(collation === 'CI'
                ? [makeUuid(4), makeUuid(5), makeUuid(7), makeUuid(8), makeUuid(10)]
                : [makeUuid(4), makeUuid(5), u6, makeUuid(7), makeUuid(8), makeUuid(12)]);
        });

        test('F-06 getTypeE decide lo mismo que el filtro por factura de hoy (REQ-24-07, D-24)', async () => {
            const items = itemsParidad();
            const dataset = datasetParidad('nc');
            const db = createSageDb(dataset, { collation });
            mockGet.mockImplementation(createPortal({ items }).get);
            mockRunQuery.mockImplementation(db.runQuery);

            const result = await settle(GetTypesCFDI.getTypeE(0));

            const salida = result.map(i => i.cfdi.timbre.uuid);
            expect(salida).toEqual(oraculo(items, dataset, 'nc', collation).map(i => i.cfdi.timbre.uuid));
            const u6 = makeUuid(6).toLowerCase();
            expect(salida).toEqual(collation === 'CI'
                ? [makeUuid(4), makeUuid(5), makeUuid(7), makeUuid(8), makeUuid(10)]
                : [makeUuid(4), makeUuid(5), u6, makeUuid(7), makeUuid(8), makeUuid(12)]);
        });
    });

    test('F-07 el IN lleva cada UUID tal como vino del portal (REQ-24-07, D-13)', async () => {
        const db = createSageDb(datasetParidad('oc'), { collation: 'CI' });
        mockGet.mockImplementation(createPortal({ items: itemsParidad() }).get);
        mockRunQuery.mockImplementation(db.runQuery);

        await settle(GetTypesCFDI.getTypeI(0));

        const u6 = makeUuid(6).toLowerCase();
        expect(sqls(db, 'cxp').some(c => c.sql.includes('IN (') && c.sql.includes(`'${u6}'`))).toBe(true);
        expect(db.calls.some(c => c.sql.includes(`'${makeUuid(6)}'`))).toBe(false);
    });

    test('F-08 450 facturas con 2 RFC hacen a lo más 8 consultas, en serie y con la base explícita (REQ-24-08, D-16)', async () => {
        const items = [...makeItems(225, { rfc: R1 }), ...makeItems(225, { start: 226, rfc: R2 })];
        const db = createSageDb({ rfcs: [R1, R2] });
        mockGet.mockImplementation(createPortal({ items }).get);
        mockRunQuery.mockImplementation(db.runQuery);

        const result = await settle(GetTypesCFDI.getTypeI(0));

        expect(result).toEqual(items);
        expect(db.calls.length).toBeLessThanOrEqual(8);
        expect(sqls(db, 'rfcs')).toHaveLength(2);
        expect(sqls(db, 'cxp')).toHaveLength(3);
        expect(sqls(db, 'oc')).toHaveLength(3);
        for (const call of db.calls) {
            expect(call.db).toBeDefined();
            expect(call.db).toBe(call.table === 'rfcs' ? 'FESA' : 'DB1');
        }
        expect(db.stats.maxInFlight).toBe(1);
    });

    test('F-09 UUID y RFC con inyección no llegan al SQL ni rompen el log (REQ-24-09, D-14, D-19)', async () => {
        const validos = makeItems(10, { rfc: R1 });
        const A = makeItem(11, { rfc: R1, uuid: "x' OR 1=1--" });
        const B = makeItem(12, { rfc: "ABC';DROP" });
        const C = makeItem(13, { rfc: R1, uuid: makeUuid(99) + '\n[ERROR]: inyectado' });
        const db = createSageDb({ rfcs: [R1] });
        mockGet.mockImplementation(createPortal({ items: [...validos, A, B, C] }).get);
        mockRunQuery.mockImplementation(db.runQuery);

        const result = await settle(GetTypesCFDI.getTypeI(0));

        expect(result).toEqual(validos);
        for (const call of db.calls) {
            expect(call.sql).not.toContain('OR 1=1');
            expect(call.sql).not.toContain('DROP');
            expect(call.sql).not.toContain('inyectado');
        }
        expect(resumen('getTypeI').msg).toContain('invalidas=3');
        const invalidas = porFactura().filter(l => l.msg.includes('resultado=invalida'));
        expect(invalidas).toHaveLength(3);
        for (const linea of invalidas) {
            expect(linea.level).toBe('warn');
        }
        expect(invalidas.find(l => l.msg.includes(' id=cfdi-11 ')).msg).toContain(`UUID="x' OR 1=1--"`);
        expect(invalidas.find(l => l.msg.includes(' id=cfdi-12 ')).msg).toContain(`detalle=rfc-invalido valor="ABC';DROP"`);
        expect(invalidas.find(l => l.msg.includes(' id=cfdi-13 ')).msg).toContain('\\n[ERROR]: inyectado');
        for (const call of mockLog.mock.calls) {
            expect(String(call[2])).not.toContain('\n');
        }
    });

    test('F-10 un item sin receptor o sin timbre sólo se aparta a sí mismo (REQ-24-09)', async () => {
        const db = createSageDb({ rfcs: [R1] });
        mockRunQuery.mockImplementation(db.runQuery);

        // getTypeI: sin cfdi.receptor
        const facturas = [...makeItems(5, { rfc: R1 }), makeItem(6, { sinReceptor: true })];
        mockGet.mockImplementation(createPortal({ items: facturas }).get);

        const ri = await settle(GetTypesCFDI.getTypeI(0));

        expect(ri).toEqual(facturas.slice(0, 5));
        expect(resumen('getTypeI').msg).toContain('invalidas=1');
        const li = porFactura().filter(l => l.msg.startsWith('[FILTRO-SAGE] consulta=getTypeI ') && l.msg.includes('resultado=invalida'));
        expect(li).toHaveLength(1);
        expect(li[0].msg).toContain('detalle=rfc-ausente');

        // getTypeE: sin cfdi.timbre
        const notas = [...makeItems(5, { rfc: R1 }), makeItem(6, { rfc: R1, sinTimbre: true })];
        mockGet.mockImplementation(createPortal({ items: notas }).get);

        const re = await settle(GetTypesCFDI.getTypeE(0));

        expect(re).toEqual(notas.slice(0, 5));
        expect(resumen('getTypeE').msg).toContain('invalidas=1');
        const le = porFactura().filter(l => l.msg.startsWith('[FILTRO-SAGE] consulta=getTypeE ') && l.msg.includes('resultado=invalida'));
        expect(le).toHaveLength(1);
        expect(le[0].msg).toContain('detalle=uuid-ausente');
    });

    test('F-11 un bloque de CxP que falla aparta sólo sus 200 facturas (REQ-24-10, D-15)', async () => {
        const items = makeItems(450, { rfc: R1 });
        const db = createSageDb({ rfcs: [R1] }, { failOn: ({ table, n }) => table === 'cxp' && n === 2 });
        mockGet.mockImplementation(createPortal({ items }).get);
        mockRunQuery.mockImplementation(db.runQuery);

        const result = await settle(GetTypesCFDI.getTypeI(0));

        expect(result).toEqual([...items.slice(0, 200), ...items.slice(400)]);
        const errores = erroresDeBloque();
        expect(errores).toHaveLength(1);
        expect(errores[0].level).toBe('error');
        expect(errores[0].msg).toContain('tabla=APIBHO bloque=2 tamano=200');
        const r = resumen('getTypeI');
        expect(r.level).toBe('warn');
        expect(r.msg).toContain('error_sql=200');
        expect(r.msg).toContain('a_descargar=250');
        const conError = porFactura().filter(l => l.msg.includes('resultado=error-sql'));
        expect(conError).toHaveLength(200);
        for (const linea of conError) {
            expect(linea.level).toBe('error');
        }
        const apartados = items.slice(200, 400).map(i => i.cfdi.timbre.uuid);
        for (const call of sqls(db, 'oc')) {
            expect(apartados.some(u => call.sql.includes(u))).toBe(false);
        }
    });

    test('F-12 si falla la consulta de un RFC se apartan sólo sus facturas (D-15)', async () => {
        const items = [...makeItems(10, { rfc: R1 }), ...makeItems(10, { start: 11, rfc: R2 })];
        const db = createSageDb({ rfcs: [R1, R2] }, { failOn: ({ table, n }) => table === 'rfcs' && n === 2 });
        mockGet.mockImplementation(createPortal({ items }).get);
        mockRunQuery.mockImplementation(db.runQuery);

        const result = await settle(GetTypesCFDI.getTypeI(0));

        expect(result).toEqual(items.slice(0, 10));
        const errores = erroresDeBloque();
        expect(errores).toHaveLength(1);
        expect(errores[0].level).toBe('error');
        expect(errores[0].msg).toContain('tabla=fesaParam bloque=2 tamano=10');
        expect(resumen('getTypeI').msg).toContain('error_sql=10 a_descargar=10');
    });

    test('F-13 si falla un bloque de OC sus facturas no se descargan (D-15)', async () => {
        const items = makeItems(10, { rfc: R1 });
        const db = createSageDb({ rfcs: [R1] }, { failOn: ({ table, n }) => table === 'oc' && n === 1 });
        mockGet.mockImplementation(createPortal({ items }).get);
        mockRunQuery.mockImplementation(db.runQuery);

        const result = await settle(GetTypesCFDI.getTypeI(0));

        expect(result).toEqual([]);
        const errores = erroresDeBloque();
        expect(errores).toHaveLength(1);
        expect(errores[0].level).toBe('error');
        expect(errores[0].msg).toContain('tabla=POINVHO bloque=1 tamano=10');
        expect(resumen('getTypeI').msg).toContain('error_sql=10 a_descargar=0');
    });

    test('F-14 el registro tiene el resumen y una línea sólo por lo que se descarga o tiene anomalía (REQ-24-11, D-18, D-19)', async () => {
        const { items, dataset } = escenarioRegistro();
        const db = createSageDb(dataset);
        mockGet.mockImplementation(createPortal({ items }).get);
        mockRunQuery.mockImplementation(db.runQuery);

        await settle(GetTypesCFDI.getTypeI(0));

        const pag = paginacion();
        expect(pag).toHaveLength(1);
        expect(pag[0].level).toBe('info');
        expect(pag[0].msg).toContain('total=450 recibidas=450 paginas=3');
        expect(resumen('getTypeI')).toEqual({
            level: 'warn',
            msg: '[FILTRO-SAGE] consulta=getTypeI tenant=T1 recibidas=450 ya_en_sage=400 sin_rfc=5 invalidas=3 error_sql=0 a_descargar=42 ms=0'
        });

        const lineas = porFactura();
        const aDescargar = lineas.filter(l => l.msg.includes('resultado=a-descargar'));
        const sinRfc = lineas.filter(l => l.msg.includes('resultado=sin-rfc'));
        const invalidas = lineas.filter(l => l.msg.includes('resultado=invalida'));
        expect(aDescargar).toHaveLength(42);
        expect(aDescargar.every(l => l.level === 'info')).toBe(true);
        expect(sinRfc).toHaveLength(5);
        expect(sinRfc.every(l => l.level === 'info')).toBe(true);
        expect(invalidas).toHaveLength(3);
        expect(invalidas.every(l => l.level === 'warn')).toBe(true);
        expect(lineas).toHaveLength(50);
        for (const n of [...rango(401, 440), 449, 450, ...rango(441, 448)]) {
            expect(lineas.filter(l => l.msg.includes(` id=cfdi-${n} `))).toHaveLength(1);
        }

        const mensajes = mockLog.mock.calls.map(call => String(call[2]));
        for (const uuid of items.slice(0, 400).map(i => i.cfdi.timbre.uuid)) {
            expect(mensajes.some(m => m.includes(uuid))).toBe(false);
        }
        for (const linea of filtro().filter(l => l.msg.includes(' resultado='))) {
            expect(linea.msg).toMatch(FILTRO_FACTURA_LINE);
        }
    });

    test('F-15 ni getTypeI ni getTypeE escriben UUID en consola (D-20)', async () => {
        const { items, dataset } = escenarioRegistro();
        const db = createSageDb(dataset);
        mockRunQuery.mockImplementation(db.runQuery);

        mockGet.mockImplementation(createPortal({ items }).get);
        await settle(GetTypesCFDI.getTypeI(0));
        mockGet.mockImplementation(createPortal({ items }).get);
        await settle(GetTypesCFDI.getTypeE(0));

        const textos = consola();
        for (const uuid of items.map(i => i.cfdi.timbre.uuid)) {
            expect(textos.some(t => t.includes(uuid) || t.includes(uuid.toLowerCase()))).toBe(false);
        }
    });

    test('F-16 el fuente: una sola paginación, pageSize=0 sólo donde no se pagina y sin estado de módulo (REQ-24-02, CLAUDE.md §3)', () => {
        const src = stripComments(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'utils', 'GetTypesCFDI.js'), 'utf8'));
        const fns = funciones(src);

        expect(Object.keys(fns).filter(n => fns[n].includes('pageSize=0')).sort()).toEqual(['getTypeIToSend', 'getTypeP']);
        for (const n of ['getTypeI', 'getTypeE', 'getCfdisByProvider', 'getPendingToPayInvoices']) {
            expect(fns[n]).toContain('fetchCfdiPages(');
            expect(fns[n]).not.toContain('while (');
            expect(fns[n]).not.toContain('offset +=');
        }
        expect(src.split('setTimeout(').length - 1).toBe(1);
        expect(fns.sleep).toContain('setTimeout(');
        expect(src).not.toMatch(/^(const|let|var)\s[^=]*=\s*new (Map|Set)\(/m);
        expect(fns.filterNotInSage).toBeDefined();
        expect(fns.filterNotInSage).not.toContain('console.log(');
    });

    test('F-17 la precedencia RFC → CxP → OC se conserva: no se consulta lo que ya se decidió (D-12)', async () => {
        const X = makeItem(1, { rfc: R2 });
        const Y = makeItem(2, { rfc: R1 });
        const Z = makeItem(3, { rfc: R1 });
        const uX = X.cfdi.timbre.uuid;
        const uY = Y.cfdi.timbre.uuid;
        const db = createSageDb({ rfcs: [R1], cxp: [uX, uY], oc: [uY] });
        mockGet.mockImplementation(createPortal({ items: [X, Y, Z] }).get);
        mockRunQuery.mockImplementation(db.runQuery);

        const result = await settle(GetTypesCFDI.getTypeI(0));

        expect(result).toEqual([Z]);
        expect(sqls(db, 'cxp').some(c => c.sql.includes(uX))).toBe(false);
        expect(sqls(db, 'oc').some(c => c.sql.includes(uY))).toBe(false);
    });

    test('F-18 el UUID se recorta antes de consultar (REQ-24-09, cambio deliberado)', async () => {
        const item = makeItem(7, { rfc: R1, uuid: '  ' + makeUuid(7) + ' ' });
        const db = createSageDb({ rfcs: [R1], cxp: [makeUuid(7)] });
        mockGet.mockImplementation(createPortal({ items: [item] }).get);
        mockRunQuery.mockImplementation(db.runQuery);

        const result = await settle(GetTypesCFDI.getTypeI(0));

        expect(result).toEqual([]);
        expect(resumen('getTypeI').msg).toContain('ya_en_sage=1');
        expect(sqls(db, 'cxp').some(c => c.sql.includes(`'${makeUuid(7)}'`))).toBe(true);
    });
});
