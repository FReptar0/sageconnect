/**
 * Tests for src/utils/GetPurchaseOrders.js — Phase 20.3 portal existence probe.
 *
 * Cubre RETRY-D1 (shape de la petición + tres resultados distinguibles), RETRY-D2 (un no-200
 * JAMÁS produce 'absent') y RETRY-D8 (el id del portal se valida contra ^[0-9a-fA-F]{24}$ antes
 * de salir del helper).
 *
 * Cada caso afirma el objeto COMPLETO con toEqual, no solo `outcome`: una clave extra colada en
 * el retorno rompe el contrato que el plan 20.3-03 va a consumir por discriminante, así que se
 * atrapa aquí.
 *
 * Pattern S-9: jest.mock('../../src/config', ...) impide que src/config.js haga process.exit(1)
 * sobre el worker por una env var faltante.
 * D-09: se mockea src/utils/PortalClient, NUNCA axios — es la línea establecida en
 * tests/utils/GetProviders.test.js:34.
 * TimezoneHelper NO se mockea: el helper no tiene lógica de fechas y no lo importa.
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const fs = require('fs');
const path = require('path');

jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://test',
        tenants: [{ id: 'T1', key: 'k1', secret: 's1', database: 'DB1' }],
        httpTimeoutMs: 30000,
    },
    paths: { logs: '/tmp/logs' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', notices: [], cc: [] },
    license: { adminEmail: 'admin@test.com' },
    app: { company: 'TestCo', timezone: 'America/Mexico_City' },
    security: { apiKey: 'test-key' },
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 5000, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
}));

const mockGet = jest.fn();
jest.mock('../../src/utils/PortalClient', () => ({ get: mockGet }));

jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: jest.fn() }));

// Fixtures. Dos ids válidos de 24 hex — uno en minúsculas y otro en mayúsculas — porque la guarda
// acepta ambos casos y hay que probarlo explícitamente (RETRY-D8, mitad positiva).
const VALID_ID_LOWER = '507f1f77bcf86cd799439011';
const VALID_ID_UPPER = '507F1F77BCF86CD799439011';
const SECOND_VALID_ID = '507f1f77bcf86cd799439012';
const OC = 'PO0084361';

// El item del portal solo aporta tres campos al helper: id, external_id y status.
function portalItem(overrides) {
    return Object.assign({ id: VALID_ID_LOWER, external_id: OC, status: 'OPEN' }, overrides || {});
}

function ok(items) {
    return { data: { items, total: items.length } };
}

describe('GetPurchaseOrders — portal existence probe (Phase 20.3 / RETRY-D1, D2, D8)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Limpiar los registros de llamada NO drena las implementaciones encoladas con
        // mockResolvedValueOnce (STATE.md, decisión 20.1-02: ambas suites cron-where filtraron
        // stubs entre casos hasta que se corrigió). Esta suite encola una respuesta del portal por
        // caso, así que está expuesta exactamente a ese bug. mockReset() sí drena la cola.
        mockGet.mockReset();
    });

    test('Caso 1: 200 con un match exacto y status OPEN -> found con id y status', async () => {
        mockGet.mockResolvedValueOnce(ok([portalItem({ status: 'OPEN' })]));
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const result = await getPurchaseOrderByExternalId(0, OC);

        expect(result).toEqual({ outcome: 'found', id: VALID_ID_LOWER, status: 'OPEN' });
    });

    test('Caso 2 (RETRY-D1): la petición lleva external_ids/pageSize/offset, ambas cabeceras, y NINGUN limite de espera propio', async () => {
        mockGet.mockResolvedValueOnce(ok([portalItem()]));
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        await getPurchaseOrderByExternalId(0, OC);

        expect(mockGet).toHaveBeenCalledTimes(1);

        const urlPassed = mockGet.mock.calls[0][0];
        expect(urlPassed).toMatch(/\/purchase-orders\?/);
        expect(urlPassed).toMatch(/external_ids=PO0084361/);
        expect(urlPassed).toMatch(/pageSize=1/);
        expect(urlPassed).toMatch(/offset=0/);

        const opts = mockGet.mock.calls[0][1];
        expect(opts.headers['PDPTenantKey']).toBe('k1');
        expect(opts.headers['PDPTenantSecret']).toBe('s1');
        // CLAUDE.md §9: el singleton PortalClient aporta los 30 s. Si el helper fijara el suyo,
        // la invariante axios < step < child < lock dejaría de sostenerse sola.
        expect(opts.timeout).toBeUndefined();
        expect(Object.keys(opts)).toEqual(['headers']);
    });

    test('Caso 3: 200 con items vacio -> absent y ninguna otra clave', async () => {
        mockGet.mockResolvedValueOnce(ok([]));
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const result = await getPurchaseOrderByExternalId(0, OC);

        expect(result).toEqual({ outcome: 'absent' });
    });

    test('Caso 4: 200 cuyo unico item no hace match exacto -> absent (el re-filtro del cliente corre)', async () => {
        // Prueba que NO se confía en el filtro del propio API: el portal devolvió un item, pero su
        // external_id no es el consultado, así que la OC sigue estando ausente.
        mockGet.mockResolvedValueOnce(ok([portalItem({ external_id: 'PO0099999' })]));
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const result = await getPurchaseOrderByExternalId(0, OC);

        expect(result).toEqual({ outcome: 'absent' });
    });

    test('Caso 5: se recortan AMBOS lados (ocSage es nchar rellenado con espacios)', async () => {
        mockGet.mockResolvedValueOnce(ok([portalItem({ external_id: '  PO0084361' })]));
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const result = await getPurchaseOrderByExternalId(0, 'PO0084361  ');

        expect(result).toEqual({ outcome: 'found', id: VALID_ID_LOWER, status: 'OPEN' });
        const urlPassed = mockGet.mock.calls[0][0];
        expect(urlPassed).toContain('external_ids=PO0084361');
        expect(urlPassed).not.toMatch(/%20/);
    });

    test('Caso 6 (RETRY-D2, piedra angular): un 404 NO es absent, es request-failed', async () => {
        // Si este caso devolviera 'absent', el controlador concluiría que la OC no está en el
        // portal y volvería a hacer POST — el duplicado exacto que esta fase existe para evitar.
        // Un GET rechazado nunca prueba ausencia; solo un 200 con cero matches exactos lo prueba.
        const notFound = Object.assign(new Error('Request failed with status code 404'), {
            response: { status: 404, data: {} },
        });
        mockGet.mockRejectedValueOnce(notFound);
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const result = await getPurchaseOrderByExternalId(0, OC);

        expect(result).toEqual({ outcome: 'unknown', reason: 'request-failed' });
        expect(result.outcome).not.toBe('absent');
    });

    test('Caso 7 (RETRY-D2): un 500 y un corte de red pelado tambien son request-failed', async () => {
        const serverError = Object.assign(new Error('Request failed with status code 500'), {
            response: { status: 500, data: {} },
        });
        mockGet.mockRejectedValueOnce(serverError);
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const first = await getPurchaseOrderByExternalId(0, OC);
        expect(first).toEqual({ outcome: 'unknown', reason: 'request-failed' });

        mockGet.mockRejectedValueOnce(new Error('timeout of 30000ms exceeded'));
        const second = await getPurchaseOrderByExternalId(0, OC);
        expect(second).toEqual({ outcome: 'unknown', reason: 'request-failed' });
    });

    test('Caso 8: 200 con dos matches exactos -> ambiguous (guarda contra un portal que ignore el tamano de pagina)', async () => {
        mockGet.mockResolvedValueOnce(ok([
            portalItem(),
            portalItem({ id: SECOND_VALID_ID }),
        ]));
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const result = await getPurchaseOrderByExternalId(0, OC);

        expect(result).toEqual({ outcome: 'unknown', reason: 'ambiguous' });
    });

    test.each([
        ['null', null],
        ['undefined', undefined],
        ['cadena vacia', ''],
        ['solo espacios', '   '],
    ])('Caso 9: externalId %s -> empty-external-id y NO se emite peticion HTTP', async (_label, value) => {
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const result = await getPurchaseOrderByExternalId(0, value);

        expect(result).toEqual({ outcome: 'unknown', reason: 'empty-external-id' });
        expect(mockGet).not.toHaveBeenCalled();
    });

    test.each([
        ['payload de inyeccion', "'; DROP TABLE--"],
        ['cadena vacia', ''],
        ['null', null],
        ['23 hex', '507f1f77bcf86cd79943901'],
        ['25 hex', '507f1f77bcf86cd7994390111'],
        ['24 caracteres no-hex', 'zzzzzzzzzzzzzzzzzzzzzzzz'],
    ])('Caso 10 (RETRY-D8, negativo): id del portal %s -> invalid-id, nunca found', async (_label, badId) => {
        // Esto es lo que hace a RETRY-D8 ESTRUCTURAL y no disciplinar: el controlador (plan
        // 20.3-03) jamás puede recibir un valor capaz de llegar a un string SQL interpolado,
        // porque el único camino que devuelve un id ya pasó por ^[0-9a-fA-F]{24}$.
        mockGet.mockResolvedValueOnce(ok([portalItem({ id: badId })]));
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const result = await getPurchaseOrderByExternalId(0, OC);

        expect(result).toEqual({ outcome: 'unknown', reason: 'invalid-id' });
    });

    test.each([
        ['minusculas', VALID_ID_LOWER],
        ['mayusculas', VALID_ID_UPPER],
    ])('Caso 11 (RETRY-D8, positivo): id de 24 hex en %s -> found con ese mismo id', async (_label, goodId) => {
        mockGet.mockResolvedValueOnce(ok([portalItem({ id: goodId, status: 'CLOSED' })]));
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const result = await getPurchaseOrderByExternalId(0, OC);

        expect(result).toEqual({ outcome: 'found', id: goodId, status: 'CLOSED' });
    });

    test('Caso 12 (always-on): dos llamadas seguidas con el mismo id valido devuelven found las dos veces', async () => {
        // Una regex en scope de módulo con flag `g` conserva lastIndex entre llamadas a .test(),
        // y este proceso NO termina entre ticks del cron (CLAUDE.md §3): la segunda llamada
        // fallaría en silencio para un id perfectamente válido. Este caso es la mitad runtime de
        // esa garantía; la mitad estructural está en el caso 13.
        mockGet.mockResolvedValueOnce(ok([portalItem()]));
        mockGet.mockResolvedValueOnce(ok([portalItem()]));
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const first = await getPurchaseOrderByExternalId(0, OC);
        const second = await getPurchaseOrderByExternalId(0, OC);

        expect(first).toEqual({ outcome: 'found', id: VALID_ID_LOWER, status: 'OPEN' });
        expect(second).toEqual({ outcome: 'found', id: VALID_ID_LOWER, status: 'OPEN' });
    });

    test('Caso 13 (S-6, guardas estructurales sobre el fuente): sin limite de espera propio, sin temporizadores, sin estado retenido, un solo GET', () => {
        // Mismo patrón que tests/utils/GetProviders.test.js:65-73. Son aserciones sobre el TEXTO
        // del fuente y no mocks en runtime porque un mock no puede probar la AUSENCIA de código:
        // "no hay bucle de reintento" y "no fija su propio límite de espera" no tienen rama que
        // ejercitar. Son criterios de aceptación del SPEC, así que se pinean aquí.
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'utils', 'GetPurchaseOrders.js'),
            'utf8'
        );

        expect(src).not.toMatch(/timeout\s*:/);
        expect(src).not.toMatch(/setTimeout|setInterval/);
        expect(src).not.toMatch(/new Map\(|new Set\(/);
        expect(src).not.toMatch(/return null/);
        expect(src).not.toMatch(/id_type/);
        // La regex de forma no puede llevar flag `g` — ver el caso 12.
        expect(src).not.toMatch(/\[0-9a-fA-F\]\{24\}\$\/[gimsuy]*g/);
        // Exactamente un call site HTTP: sin bucle de reintento interno, que multiplicaría el
        // presupuesto por OC contra el techo de 5 min de STEP_TIMEOUT_MS.
        expect(src.split('portalClient.get(').length - 1).toBe(1);
    });

    // ── CR-01: un 200 con cuerpo inutilizable no prueba ausencia ──────────────────────────────
    //
    // El hueco que estos casos cierran: TODOS los de arriba construyen el cuerpo con `ok(items)`
    // (L55-57), que siempre produce un `items` array bien formado, así que ninguno podía tocar la
    // rama del `|| []`. Ahí «no sé» se colapsaba en 'absent' — el ÚNICO desenlace que autoriza el
    // POST del controlador — y el resultado era el 409 duplicado que esta fase existe para cortar,
    // en silencio y con una línea de bitácora diciendo que todo salió bien.
    //
    // Los cuerpos de abajo se construyen A MANO, sin `ok()`, precisamente por eso.

    test.each([
        ['sin la clave items', { data: {} }],
        ['con items null y total 7', { data: { items: null, total: 7 } }],
        ['con una página de login en HTML (302 seguido por axios)', { data: '<html><body>login</body></html>' }],
        ['con un sobre de error servido con 200', { data: { code: 'X', description: 'Y' } }],
    ])('Caso 14 (CR-01): 200 %s -> malformed-response, JAMÁS absent', async (_label, body) => {
        // El segundo caso es el peor: el portal está AFIRMANDO siete coincidencias (`total: 7`) y
        // la versión anterior contestaba 'absent'.
        mockGet.mockResolvedValueOnce(body);
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const result = await getPurchaseOrderByExternalId(0, OC);

        expect(result).toEqual({ outcome: 'unknown', reason: 'malformed-response' });
        expect(result.outcome).not.toBe('absent');
    });

    test('Caso 15 (CR-01, control positivo): un 200 con items vacío SIGUE siendo absent', async () => {
        // Sin este control, el caso 14 pasaría igual si la guarda nueva hubiera roto la detección
        // de ausencia por completo — y una sonda que nunca dice 'absent' congela toda creación de
        // OCs. El cuerpo va a mano (sin `ok()`) para que sea comparable con los cuatro de arriba.
        mockGet.mockResolvedValueOnce({ data: { items: [], total: 0 } });
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const result = await getPurchaseOrderByExternalId(0, OC);

        expect(result).toEqual({ outcome: 'absent' });
    });

    // ── WR-01: el catch no puede repetir la operación que pudo lanzar ─────────────────────────
    //
    // El JSDoc declara «nunca lanza, nunca devuelve un valor nulo» y el comentario del catch razona
    // explícitamente sobre no hacer estallar el propio catch — pero su primera línea repetía
    // `(externalId || '').trim()`, exactamente la operación que pudo tirar el try. Con un valor que
    // no sea string, el try lanza, el catch lanza lo mismo y la excepción ESCAPA del helper. En un
    // servicio que no termina entre ticks eso aborta el tick a media tanda (CLAUDE.md §3).
    //
    // Hoy no es alcanzable desde el único call site (el controlador pasa un `String(...)`); el
    // contrato del helper es lo que el próximo consumidor va a creer, y estos dos casos son los que
    // lo hacen cierto.

    test('Caso 16 (WR-01): un externalId que no es string no hace estallar el helper', async () => {
        mockGet.mockResolvedValueOnce({ data: { items: [], total: 0 } });
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const result = await getPurchaseOrderByExternalId(0, 12345);

        expect(result).toEqual({ outcome: 'absent' });
        expect(mockGet.mock.calls[0][0]).toContain('external_ids=12345');
    });

    test('Caso 17 (WR-01): con un externalId no-string, un GET rechazado sigue siendo request-failed', async () => {
        // Éste es el que apunta al catch: es el camino por el que la excepción se escapaba.
        mockGet.mockRejectedValueOnce(new Error('timeout of 30000ms exceeded'));
        const { getPurchaseOrderByExternalId } = require('../../src/utils/GetPurchaseOrders');

        const result = await getPurchaseOrderByExternalId(0, 12345);

        expect(result).toEqual({ outcome: 'unknown', reason: 'request-failed' });
    });
});
