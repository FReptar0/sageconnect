/**
 * Tests de la paginación de src/utils/GetTypesCFDI.js (fase 24, plan 24-01).
 *
 * Cubre D-01 a D-11 (API intacta, paginación única que nunca lanza, URL codificada, cortes,
 * sin regla de página corta, total desconocido, dedupe, topes, reintento, presupuesto leído por
 * llamada, reloj falso), D-17 (línea [PAGINACION]), D-21 (línea de getTypeP) y D-31
 * (providerId vacío). Los modelos del portal y de la base viven en tests/helpers/getTypesCfdiFakes.js.
 *
 * Ningún test duerme en tiempo real (D-11): jest.useFakeTimers y settle(), que corre los
 * temporizadores; el modelo del portal adelanta el reloj con jest.setSystemTime.
 *
 * Prueba negativa (D-25), corriendo esta suite contra el GetTypesCFDI.js de origin/master:
 *   DEBEN FALLAR P-02 a P-18, P-23, P-24 y P-25 (paginación, providerId, reintento, presupuesto, registro).
 *   DEBEN PASAR P-01, P-19, P-20, P-21 y P-22: anclas del contrato de hoy (REQ-24-03).
 */

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
    logLines,
    PAGINACION_LINE
} = require('../helpers/getTypesCfdiFakes');

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

/** Líneas [PAGINACION-INTENTO] (reintentos, abandonos y esperas que no caben en el presupuesto). */
function intentos() {
    return logLines(mockLog).filter(l => l.msg.startsWith('[PAGINACION-INTENTO] '));
}

function rango(desde, hasta) {
    const out = [];
    for (let n = desde; n <= hasta; n++) out.push(n);
    return out;
}

/** Esperas de reintento que vio el espía de setTimeout (múltiplos de 1500 ms). */
function esperasDe(spy) {
    return spy.mock.calls.map(c => c[1]).filter(ms => ms > 0 && ms % 1500 === 0);
}

describe('GetTypesCFDI — paginación (fase 24, 24-01)', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        jest.useFakeTimers({ now: new Date('2026-10-08T12:00:00Z'), doNotFake: ['nextTick', 'queueMicrotask'] });
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        // Primero restaurar los espías: si se restaurara el de setTimeout después de
        // useRealTimers, reinstalaría el setTimeout falso en el global.
        jest.restoreAllMocks();
        jest.useRealTimers();
        config.schedule.stepTimeoutMs = 300000;
    });

    test('P-01 la API exportada no cambia (REQ-24-15, D-01)', () => {
        expect(Object.keys(GetTypesCFDI).sort()).toEqual([
            'getCfdisByProvider',
            'getPendingToPayInvoices',
            'getTypeE',
            'getTypeI',
            'getTypeIToSend',
            'getTypeP'
        ]);
    });

    test('P-02 getCfdisByProvider pide en serie las 3 páginas de 450 con providerId y hideValidations (REQ-24-01/12/14, D-03, D-17)', async () => {
        const items = makeItems(450);
        const portal = createPortal({ items });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        const base = 'http://test/api/1.0/extern/tenants/T1/cfdis?documentTypes=CFDI&offset=';
        const resto = '&pageSize=200&cfdiType=INVOICE&stage=PENDING_TO_PAY&from=2026-09-01&providerId=PROV1&hideValidations=true';
        expect(portal.calls.map(c => c.url)).toEqual([base + '0' + resto, base + '200' + resto, base + '400' + resto]);
        for (const call of portal.calls) {
            expect(call.headers.PDPTenantKey).toBe('k1');
            expect(call.headers.PDPTenantSecret).toBe('s1');
        }
        expect(portal.stats.maxInFlight).toBe(1);
        expect(result).toEqual(items);
        expect(paginacion()).toEqual([{
            level: 'info',
            msg: '[PAGINACION] consulta=getCfdisByProvider tenant=T1 total=450 recibidas=450 paginas=3 ms=0 pagina_mas_lenta_ms=0 corte=completo proveedor=PROV1'
        }]);
    });

    test('P-03 conserva el filtro local aunque el portal ignore providerId (REQ-24-12)', async () => {
        const items = rango(1, 300).map(n => makeItem(n, { providerId: n % 2 === 1 ? 'PROV1' : 'PROV2' }));
        const portal = createPortal({ items, honorProviderId: false });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(result).toHaveLength(150);
        expect(result).toEqual(items.filter(i => i.metadata.provider_id === 'PROV1'));
        expect(result.some(i => i.metadata.provider_id === 'PROV2')).toBe(false);
    });

    test('P-04 providerId viaja codificado en la URL y escapado en el log (D-03, T-24-01)', async () => {
        const portal = createPortal({ items: [] });
        mockGet.mockImplementation(portal.get);

        await settle(GetTypesCFDI.getCfdisByProvider(0, 'P&1 2'));

        expect(portal.calls).toHaveLength(1);
        const url = portal.calls[0].url;
        expect(url).toContain('providerId=P%261%202');
        expect(url).not.toContain('&1 2');
        expect(new URL(url).searchParams.get('providerId')).toBe('P&1 2');
        const lineas = paginacion();
        expect(lineas).toHaveLength(1);
        expect(lineas[0].msg).toContain('proveedor="P&1 2"');
    });

    test('P-05 providerId vacío devuelve [] sin consultar el portal (D-31)', async () => {
        for (const vacio of ['', '   ', undefined, null]) {
            mockGet.mockClear();
            mockLog.mockClear();
            const portal = createPortal({ items: makeItems(10) });
            mockGet.mockImplementation(portal.get);

            const result = await settle(GetTypesCFDI.getCfdisByProvider(0, vacio));

            expect(result).toEqual([]);
            expect(mockGet).not.toHaveBeenCalled();
            expect(logLines(mockLog)).toEqual([{
                level: 'warn',
                msg: '[PAGINACION-OMITIDA] consulta=getCfdisByProvider tenant=T1 motivo=proveedor-vacio'
            }]);
        }
    });

    test('P-06 una página vacía detiene la paginación aunque no se llegue a total (D-04, D-06)', async () => {
        const portal = createPortal({ items: makeItems(450), pages: { 200: [] } });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(portal.calls).toHaveLength(2);
        expect(result).toHaveLength(200);
        const [linea] = paginacion();
        expect(linea.level).toBe('warn');
        expect(linea.msg).toContain('total=450 recibidas=200 paginas=2');
        expect(linea.msg).toContain('corte=pagina-vacia');
    });

    test('P-07 un UUID repetido entre páginas cuenta una vez y se conserva la primera aparición (D-07)', async () => {
        const primera = makeItems(200);
        const repetido = makeItem(150, { uuid: makeUuid(150).toLowerCase() });
        const segunda = [repetido, ...makeItems(199, { start: 201 })];
        const portal = createPortal({ pages: { 0: primera, 200: segunda, 400: [] }, total: 400 });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(result).toHaveLength(399);
        const con150 = result.filter(i => i.cfdi.timbre.uuid.toUpperCase() === makeUuid(150));
        expect(con150).toHaveLength(1);
        expect(con150[0]).toBe(primera[149]);
        expect(con150[0].cfdi.timbre.uuid).toBe(makeUuid(150));
        expect(result.map(i => Number(i.cfdi.folio))).toEqual([...rango(1, 200), ...rango(201, 399)]);
        const [linea] = paginacion();
        expect(linea.level).toBe('warn');
        expect(linea.msg).toContain('recibidas=399');
    });

    test('P-08 un portal que ignora offset corta por sin-avance, no por total (D-04)', async () => {
        const portal = createPortal({ items: makeItems(450), ignoreOffset: true });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(portal.calls).toHaveLength(2);
        expect(result).toHaveLength(200);
        const [linea] = paginacion();
        expect(linea.level).toBe('warn');
        expect(linea.msg).toContain('corte=sin-avance');
    });

    test('P-09 el tope de 50 páginas detiene un total enorme y registra warn (D-08)', async () => {
        const portal = createPortal({
            generate: (offset, size) => makeItems(size, { start: offset + 1 }),
            total: 1000000
        });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(portal.calls).toHaveLength(50);
        expect(result).toHaveLength(10000);
        const [linea] = paginacion();
        expect(linea.level).toBe('warn');
        expect(linea.msg).toContain('recibidas=10000 paginas=50');
        expect(linea.msg).toContain('corte=tope-paginas');
    });

    test('P-10 sin regla de página corta: con páginas de 100 y total=250 llegan las 250 (D-05)', async () => {
        const portal = createPortal({ items: makeItems(250), pageCap: 100 });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(portal.calls.map(c => c.params.offset)).toEqual(['0', '100', '200']);
        expect(result).toHaveLength(250);
        const [linea] = paginacion();
        expect(linea.level).toBe('info');
        expect(linea.msg).toContain('corte=completo');
    });

    test('P-11 total=0 con página vacía es completo y sin total se pagina hasta página vacía (D-06)', async () => {
        // (a) 0 de 0
        const vacio = createPortal({ items: [] });
        mockGet.mockImplementation(vacio.get);

        const a = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(vacio.calls).toHaveLength(1);
        expect(a).toEqual([]);
        expect(paginacion()).toEqual([{
            level: 'info',
            msg: '[PAGINACION] consulta=getCfdisByProvider tenant=T1 total=0 recibidas=0 paginas=1 ms=0 pagina_mas_lenta_ms=0 corte=completo proveedor=PROV1'
        }]);

        // (b) el portal no manda total
        mockLog.mockClear();
        const sinTotal = createPortal({ items: makeItems(450), total: 'omit' });
        mockGet.mockImplementation(sinTotal.get);

        const b = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(sinTotal.calls).toHaveLength(4);
        expect(b).toHaveLength(450);
        const lineas = paginacion();
        expect(lineas).toHaveLength(1);
        expect(lineas[0].level).toBe('info');
        expect(lineas[0].msg).toContain('total=desconocido recibidas=450 paginas=4');
        expect(lineas[0].msg).toContain('corte=pagina-vacia');
    });

    test('P-12 un 429 y un ECONNRESET se reintentan y la consulta se completa (REQ-24-04, D-09)', async () => {
        const items = makeItems(450);
        const portal = createPortal({ items, failures: { 200: [429], 400: ['ECONNRESET'] } });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(portal.calls).toHaveLength(5);
        expect(result).toEqual(items);
        expect(intentos()).toEqual([
            { level: 'warn', msg: '[PAGINACION-INTENTO] consulta=getCfdisByProvider tenant=T1 offset=200 intento=1/3 status=429 accion=reintentar espera_ms=1500' },
            { level: 'warn', msg: '[PAGINACION-INTENTO] consulta=getCfdisByProvider tenant=T1 offset=400 intento=1/3 status=ECONNRESET accion=reintentar espera_ms=1500' }
        ]);
        const [linea] = paginacion();
        expect(linea.level).toBe('info');
        expect(linea.msg).toContain('recibidas=450 paginas=3');
        expect(linea.msg).toContain('corte=completo');
    });

    test('P-13 un 400 no se reintenta y se devuelve lo recibido (REQ-24-04/05)', async () => {
        const portal = createPortal({ items: makeItems(450), failures: { 200: [400] } });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(portal.calls).toHaveLength(2);
        expect(result).toHaveLength(200);
        const fallas = intentos();
        expect(fallas).toHaveLength(1);
        expect(fallas[0].msg).toContain('status=400 accion=abandonar');
        const [linea] = paginacion();
        expect(linea.level).toBe('warn');
        expect(linea.msg).toContain('corte=pagina-fallida offset_fallido=200');
    });

    test('P-14 la página 3 falla tras 3 intentos: se devuelven las 400 recibidas (REQ-24-05)', async () => {
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
        const portal = createPortal({ items: makeItems(450), failures: { 400: [503, 503, 503] } });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(portal.calls).toHaveLength(5);
        expect(result).toHaveLength(400);
        expect(esperasDe(setTimeoutSpy)).toEqual([1500, 3000]);
        const [linea] = paginacion();
        expect(linea.level).toBe('warn');
        expect(linea.msg).toContain('recibidas=400');
        expect(linea.msg).toContain('corte=pagina-fallida offset_fallido=400');
    });

    test('P-15 si falla la primera página el resultado es [] (REQ-24-04/05)', async () => {
        const portal = createPortal({ items: makeItems(450), failures: { 0: [503, 503, 503] } });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(portal.calls).toHaveLength(3);
        expect(result).toEqual([]);
        const [linea] = paginacion();
        expect(linea.level).toBe('warn');
        expect(linea.msg).toContain('total=desconocido recibidas=0 paginas=0');
        expect(linea.msg).toContain('corte=pagina-fallida offset_fallido=0');
    });

    test('P-16 agotado el presupuesto no se pide otra página y se devuelve lo recibido (REQ-24-06, D-10)', async () => {
        const portal = createPortal({ items: makeItems(600), delayMs: 40000 });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(portal.calls).toHaveLength(2);
        expect(result).toHaveLength(400);
        expect(paginacion()).toEqual([{
            level: 'warn',
            msg: '[PAGINACION] consulta=getCfdisByProvider tenant=T1 total=600 recibidas=400 paginas=2 ms=80000 pagina_mas_lenta_ms=40000 corte=presupuesto proveedor=PROV1'
        }]);
    });

    test('P-17 una espera de reintento que rebasaría el presupuesto no se crea (REQ-24-06, D-10)', async () => {
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
        const portal = createPortal({
            items: makeItems(450),
            delayMs: (offset) => (offset === 0 ? 70000 : 4000),
            failures: { 200: [503, 503, 503] }
        });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(portal.calls).toHaveLength(2);
        expect(result).toHaveLength(200);
        expect(setTimeoutSpy.mock.calls.some(c => c[1] === 1500)).toBe(false);
        const fallas = intentos();
        expect(fallas).toHaveLength(1);
        expect(fallas[0].msg).toContain('accion=presupuesto');
        const [linea] = paginacion();
        expect(linea.level).toBe('warn');
        expect(linea.msg).toContain('corte=presupuesto');
    });

    test('P-18 el presupuesto se lee de stepTimeoutMs en cada llamada (D-10)', async () => {
        // 120 s de paso => 30 s de presupuesto: con 20 s por página caben 2 páginas.
        config.schedule.stepTimeoutMs = 120000;
        const corto = createPortal({ items: makeItems(600), delayMs: 20000 });
        mockGet.mockImplementation(corto.get);

        await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(corto.calls).toHaveLength(2);
        expect(paginacion()[0].msg).toContain('corte=presupuesto');

        // Con el default (75 s) el mismo escenario completa las 3 páginas.
        config.schedule.stepTimeoutMs = 300000;
        mockLog.mockClear();
        const normal = createPortal({ items: makeItems(600), delayMs: 20000 });
        mockGet.mockImplementation(normal.get);

        await settle(GetTypesCFDI.getCfdisByProvider(0, 'PROV1'));

        expect(normal.calls).toHaveLength(3);
        expect(paginacion()[0].msg).toContain('corte=completo');
    });

    test('P-19 getPendingToPayInvoices conserva su URL y su resultado (REQ-24-03, contrato)', async () => {
        const items = makeItems(450);
        const portal = createPortal({ items });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getPendingToPayInvoices(0, { from: '2026-08-01', to: '2026-08-31' }));

        const url = (offset) => 'http://test/api/1.0/extern/tenants/T1/cfdis?documentTypes=CFDI&offset=' + offset +
            '&pageSize=200&cfdiType=INVOICE&stage=PENDING_TO_PAY&from=2026-08-01&to=2026-08-31';
        expect(portal.calls.map(c => c.url)).toEqual([url(0), url(200), url(400)]);
        expect(portal.calls.some(c => c.url.includes('hideValidations'))).toBe(false);
        expect(result).toEqual(items);
    });

    test('P-20 getPendingToPayInvoices devuelve [] si una página falla tras los reintentos (REQ-24-03, contrato)', async () => {
        const portal = createPortal({ items: makeItems(450), failures: { 200: [503, 503, 503] } });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getPendingToPayInvoices(0));

        expect(result).toEqual([]);
        expect(portal.calls).toHaveLength(4);
    });

    test('P-21 getPendingToPayInvoices no tiene presupuesto de tiempo (REQ-24-03, D-10, contrato)', async () => {
        const items = makeItems(600);
        const portal = createPortal({ items, delayMs: 100000 });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getPendingToPayInvoices(0));

        expect(portal.calls).toHaveLength(3);
        expect(result).toHaveLength(600);
        expect(portal.calls.some(c => c.url.includes('from=') || c.url.includes('to='))).toBe(false);
    });

    test('P-22 getPendingToPayInvoices respeta pageSize y maxPages (REQ-24-03, D-08, contrato)', async () => {
        const items = makeItems(1000);
        const portal = createPortal({ items });
        mockGet.mockImplementation(portal.get);

        const result = await settle(GetTypesCFDI.getPendingToPayInvoices(0, { pageSize: 50, maxPages: 2 }));

        expect(portal.calls.map(c => c.params.pageSize)).toEqual(['50', '50']);
        expect(portal.calls.map(c => c.params.offset)).toEqual(['0', '50']);
        expect(result).toEqual(items.slice(0, 100));
    });

    test('P-23 getPendingToPayInvoices escribe su línea [PAGINACION] (D-17)', async () => {
        const portal = createPortal({ items: makeItems(450) });
        mockGet.mockImplementation(portal.get);

        await settle(GetTypesCFDI.getPendingToPayInvoices(0));

        expect(paginacion()).toEqual([{
            level: 'info',
            msg: '[PAGINACION] consulta=getPendingToPayInvoices tenant=T1 total=450 recibidas=450 paginas=3 ms=0 pagina_mas_lenta_ms=0 corte=completo'
        }]);
    });

    test('P-24 getTypeP no pagina, devuelve lo mismo y registra el corte 200 de 244 (REQ-24-13, D-21)', async () => {
        const items = makeItems(244);
        const portal = createPortal({ items });
        const db = createSageDb({ rfcs: ['AAA010101AAA'], cxp: items.slice(0, 30).map(i => i.cfdi.timbre.uuid) });
        mockGet.mockImplementation(portal.get);
        mockRunQuery.mockImplementation(db.runQuery);

        const result = await settle(GetTypesCFDI.getTypeP(0));

        expect(portal.calls).toHaveLength(1);
        expect(portal.calls[0].url).toContain('offset=0&pageSize=0');
        expect(portal.calls[0].url).toContain('cfdiType=PAYMENT_CFDI');
        expect(result).toEqual(items.slice(30, 200));
        expect(paginacion()).toEqual([{
            level: 'warn',
            msg: '[PAGINACION] consulta=getTypeP tenant=T1 total=244 recibidas=200 paginas=1 ms=0 pagina_mas_lenta_ms=0 corte=sin-paginar'
        }]);
    });

    test('P-25 getTypeP con todo recibido registra corte=completo en info (D-21)', async () => {
        const items = makeItems(150);
        const portal = createPortal({ items });
        const db = createSageDb({ rfcs: ['AAA010101AAA'], cxp: items.slice(0, 30).map(i => i.cfdi.timbre.uuid) });
        mockGet.mockImplementation(portal.get);
        mockRunQuery.mockImplementation(db.runQuery);

        await settle(GetTypesCFDI.getTypeP(0));

        expect(paginacion()).toEqual([{
            level: 'info',
            msg: '[PAGINACION] consulta=getTypeP tenant=T1 total=150 recibidas=150 paginas=1 ms=0 pagina_mas_lenta_ms=0 corte=completo'
        }]);
    });
});
