/**
 * Guardas estructurales del cableado de la sonda de existencia en el portal.
 * Fase 20.3 — RETRY-D2, RETRY-D4, RETRY-D6, RETRY-D7, RETRY-D8 (CONTEXT D-01, D-02, D-06).
 *
 * Por qué son aserciones sobre el TEXTO del fuente y no casos con dobles en tiempo de ejecución
 * (patrón S-6): todo lo que se prueba aquí es la AUSENCIA de código — que no se emite ninguna
 * sentencia de actualización contra la tabla de control, que no se añadió ninguna primitiva
 * retenida, que la firma de runQuery no se movió, que el conjunto de etiquetas no creció. Una
 * ausencia no se puede probar ejercitando el módulo: un doble que nunca recibe la llamada prohibida
 * hace que la aserción pase por construcción, es decir, es una tautología. Leer el fuente literal es
 * la única forma de que la guarda detecte la regresión que existe para detectar.
 *
 * Precedente hermano en este repo: tests/utils/GetProviders.test.js:65-73, que a su vez espeja
 * tests/services/CronScheduler.timeout-listener.test.js:297-303.
 *
 * Bloques de este archivo:
 *   1. «guardas estructurales» (plan 20.3-03) — RETRY-D2, D6, D7, D8 leídas del TEXTO del fuente:
 *      sin UPDATE, cuatro sitios de INSERT con el literal FESA, la sonda antes de Joi, cero
 *      primitivas always-on, la firma de runQuery intacta, un solo sitio de llamada, sin id_type,
 *      un solo external id por petición, y exactamente dos etiquetas de bitácora.
 *   2. «behaviour» (plan 20.3-04) — RETRY-D4, D6, D7: la compuerta de errorCount en ambos
 *      sentidos, las seis filas de la tabla de despacho con su desenlace de POST y de escritura,
 *      y los dos controles de orden contra la validación Joi.
 *   3. «fail-closed, id guard and log vocabulary» (plan 20.3-04) — RETRY-D5, D8 y CONTEXT D-06:
 *      tres formas distintas de fallo de la sonda que no escriben nada, seis idFocaltec
 *      malformados que no llegan a ningún string SQL (más su control positivo), la ausencia de
 *      UPDATE también en tiempo de ejecución, y el texto de las dos etiquetas con sus cinco
 *      escenarios de contadores.
 *
 * D-07: los casos de comportamiento viven aquí y NO en `PortalOC_Creator.cron-where.test.js`, que
 * ancla con regex la FORMA del SQL emitido. Mantenerlos separados significa que un cambio de
 * comportamiento no puede romper un ancla de forma de SQL, ni al revés — la misma separación que la
 * fase 20.2 usó para `tests/schema-guard.test.js`.
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Preámbulo de dobles. Copiado de tests/controller/PortalOC_Creator.cron-where.test.js con dos
// cambios (ver abajo). El mock de config va COMPLETO a propósito: PortalOC_Creator.js lee siete
// claves de config.app.defaultAddress y config.app.addressIdentifiersSkip AL CARGAR EL MÓDULO
// (L6-12 y L40) y config.retry.interval más abajo, así que un mock mínimo rompe el require.
//
// T-20.3-22: todos los valores son los placeholders que ya usan las suites hermanas — ni un id de
// tenant real, ni una clave, ni un secreto, ni un host, ni un correo real (HANDOFF §1 y §2).
// ─────────────────────────────────────────────────────────────────────────────────────────────

jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://test',
        tenants: [{ id: 'T1', key: 'k1', secret: 's1', database: 'COPDAT', externalId: 'ext1' }],
        httpTimeoutMs: 30000,
        // Fase 20.4: los defaults de producción. Omitirlos deja `probed >= undefined` en false y
        // desactiva en silencio el tope de la sonda a lo largo de los 44 casos de este archivo.
        probeBudgetMs: 120000,
        probeMaxPerTick: 50,
    },
    paths: { downloads: '/tmp/downloads', logs: '/tmp/logs', providers: '/tmp/p' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', notices: [], cc: [], password: '' },
    license: { adminEmail: 'admin@test.com' },
    app: {
        company: 'TestCo', timezone: 'America/Mexico_City', rfc: 'RFC', regimen: 'R1', arg: 'A1',
        importRoute: '',
        defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
        addressIdentifiersSkip: [],
    },
    security: { apiKey: 'test-key' },
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 0, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
    // Mismo valor que la suite hermana: este archivo no ancla la forma del SQL de alcance, pero
    // mantener el valor idéntico evita que las dos suites carguen el controlador con configs
    // distintas y que una diferencia de comportamiento se lea como una diferencia de config.
    retry: { scope: 'current_month', lookbackDays: 30, interval: { payment: 30, po: 240 } },
    // Fase 20.5: omitir esta clave dejaría config.notifications.poAlert.enabled leyendo undefined y
    // desactivaría en silencio la alerta inmediata en los 44 casos de este archivo — el mismo
    // agujero de desactivación silenciosa que la fase 20.4 cerró en dos de estos mismos mocks.
    notifications: { poAlert: { enabled: true } },
    eom: { notificationHour: 18, notificationEnabled: true },
}));

// Fase 20.5: este archivo ejecuta el createPurchaseOrders REAL por caminos de fallo del POST con
// fixtures cuyo errorCount es 0 — que es exactamente la condición de primer fallo. Sin este mock la
// suite intentaría envíos SMTP salientes de verdad contra un host inventado, y una suite que hoy es
// hermética pasaría a depender de la latencia de la red.
// D-14 de la 20.6: el doble resuelve lo que la función resuelve de verdad desde el plan 20.6-01.
// Con `undefined` caería del lado NO entregado bajo la regla fail-closed del controlador, y
// cualquier tick de esta suite que dispare la alerta registraría una no entrega falsa.
jest.mock('../../src/utils/EmailSender', () => ({ sendMail: jest.fn(), sendOperatorReport: jest.fn().mockResolvedValue({ delivered: true, error: null }) }));

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

// CAMBIO 1 respecto de la plantilla (CONTEXT D-09): se mockea PortalClient con AMBOS verbos y se
// deja correr la sonda REAL (`src/utils/GetPurchaseOrders.js`). Si en cambio se mockeara el helper,
// la aserción de RETRY-D4 "no se llamó a PortalClient.get" sería trivialmente cierta y no probaría
// nada: el doble jamás emitiría un GET aunque el cableado lo pidiera. Mockear una capa MÁS ABAJO
// que la unidad bajo prueba es lo que convierte esa aserción en una prueba real.
const mockPortalGet = jest.fn();
const mockPortalPost = jest.fn();
jest.mock('../../src/utils/PortalClient', () => ({ get: mockPortalGet, post: mockPortalPost }));

jest.mock('../../src/utils/TimezoneHelper', () => ({ getCurrentDateString: () => '2026-05-15' }));
jest.mock('../../src/utils/OC_GroupOrdersByNumber', () => ({ groupOrdersByNumber: (rs) => rs }));
jest.mock('../../src/utils/parseExternPurchaseOrders', () => ({
    parseExternPurchaseOrders: (g) => g.map((r) => ({ external_id: r.EXTERNAL_ID, cfdi_payment_method: '', requisition_number: 0, _row: r })),
}));

// CAMBIO 2 respecto de la plantilla: la validación Joi se ata a un jest.fn() en vez de a una flecha
// anónima, para poder observar SI se llamó. Ésa es la prueba en tiempo de ejecución de CONTEXT D-01
// (la sonda va antes que Joi); la prueba por orden en el fuente es la Guarda 3 de arriba.
const mockValidatePO = jest.fn((po) => po);
jest.mock('../../src/models/PurchaseOrder', () => ({ validateExternPurchaseOrder: mockValidatePO }));

const { createPurchaseOrders } = require('../../src/controller/PortalOC_Creator');

const CONTROLLER_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'controller', 'PortalOC_Creator.js'), 'utf8');
const PROBE_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'utils', 'GetPurchaseOrders.js'), 'utf8');
const SQLCONN_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'utils', 'SQLServerConnection.js'), 'utf8');

const countOf = (src, re) => (src.match(re) || []).length;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Fixtures compartidos por los bloques de comportamiento.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// Reloj único (20.2 D-01 / hazard H-2), espejo de cron-where.test.js:86-87. Medido el 2026-07-27
// en el host SQL desplegado: el driver entrega las marcas de tiempo 360 minutos por detrás del
// reloj del proceso Node, así que un fixture que deje dbNow sin poner cae al reloj de Node y pasa
// haga lo que haga el controlador.
const SERVER_SKEW_MIN = 360;
const DB_NOW = new Date(Date.now() - SERVER_SKEW_MIN * 60 * 1000);

// 24 hexadecimales en minúscula — la forma que documenta el runbook de acuse perdido y la única
// que la sonda deja salir (RETRY-D8, guarda ^[0-9a-fA-F]{24}$ dentro de GetPurchaseOrders.js).
const VALID_ID = '507f1f77bcf86cd799439011';
const OTHER_VALID_ID = '6650c1f2a4b8e91d3c7f0a12';

const GATE_OPEN_OC = 'PO0084361';
const GATE_CLOSED_OC = 'PO0083600';

// `lastErrorAt: null` deja la fila elegible de inmediato por la regla de primer intento de
// computeRetryEligibility, así que sobrevive al post-filtro JS y llega al bucle. Es la forma
// correcta de desacoplar "elegible ahora" de "ya falló antes": desde 20.1 D-04, errorCount no
// participa en ninguna cuenta de tiempo — solo abre o cierra la compuerta de la sonda.
const gateOpenRow = () => ({ EXTERNAL_ID: GATE_OPEN_OC, errorCount: 3, lastErrorAt: null, dbNow: DB_NOW });
const gateClosedRow = () => ({ EXTERNAL_ID: GATE_CLOSED_OC, errorCount: 0, lastErrorAt: null, dbNow: DB_NOW });

// D-10. mockReset() DRENA las implementaciones encoladas con mockResolvedValueOnce; clearAllMocks()
// NO — solo borra el registro de llamadas. Ambas suites cron-where filtraron stubs entre casos
// hasta que se arregló así (decisión 20.1-02 en STATE.md), y esta suite encola una respuesta de
// portal por caso, o sea que está expuesta exactamente a ese bug. mockReset() también borra la
// IMPLEMENTACIÓN, por eso mockValidatePO se vuelve a armar en la línea siguiente.
const resetProbeStubs = () => {
    jest.clearAllMocks();
    mockRunQuery.mockReset();
    mockPortalPost.mockReset();
    mockPortalGet.mockReset();
    // Mismo motivo D-10 que los cuatro de arriba: los casos de WR-02 le ponen una implementación
    // que LANZA para simular una bitácora rota, y clearAllMocks() no la retira — sólo borra el
    // registro de llamadas. Sin este reset, esa implementación se filtraría al siguiente caso.
    mockLogGenerator.mockReset();
    mockValidatePO.mockReset();
    mockValidatePO.mockImplementation((po) => po);
};

// La llamada 0 de runQuery es SIEMPRE el SELECT por tenant; los INSERT empiezan en la 1.
const stubSelect = (rows) => {
    mockRunQuery.mockResolvedValueOnce({ recordset: rows });
    mockRunQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
};

// Respuestas del portal con la forma que parsea la sonda real: { data: { items: [...], total } }.
const stubPortalFound = (id, status, externalId = GATE_OPEN_OC) => {
    mockPortalGet.mockResolvedValueOnce({ data: { items: [{ id, external_id: externalId, status }], total: 1 } });
};
const stubPortalAbsent = () => {
    mockPortalGet.mockResolvedValueOnce({ data: { items: [], total: 0 } });
};
const stubPortalAmbiguous = (externalId = GATE_OPEN_OC) => {
    mockPortalGet.mockResolvedValueOnce({
        data: {
            items: [
                { id: VALID_ID, external_id: externalId, status: 'OPEN' },
                { id: OTHER_VALID_ID, external_id: externalId, status: 'OPEN' },
            ],
            total: 2,
        },
    });
};
const stubPostSuccess = (id = VALID_ID) => {
    mockPortalPost.mockResolvedValueOnce({ status: 201, statusText: 'Created', data: { id } });
};

const insertsEmitted = () => mockRunQuery.mock.calls
    .filter((c) => /INSERT INTO fesa\.dbo\.fesaOCFocaltec/i.test(c[0] || ''));

describe('PortalOC_Creator — guardas estructurales de la sonda de existencia (Fase 20.3)', () => {

    test('Guarda 1 (RETRY-D6, aceptación #12): ningún camino de código actualiza la tabla de control', () => {
        // El detect-and-seed del runbook de acuse perdido SIEMBRA una fila nueva; jamás reescribe
        // las históricas. En producción hay 3,313 filas ERROR acumuladas, no hay staging y no hay
        // rollback: una actualización masiva mal apuntada no se deshace. La guarda es case-insensitive
        // para que ni `update` en minúscula pase.
        expect(CONTROLLER_SRC).not.toMatch(/UPDATE\s+fesa\.dbo\.fesaOCFocaltec/i);
    });

    test('Guarda 2 (CLAUDE.md §6 #2): cuatro sitios de escritura y los cuatro pasan el literal FESA', () => {
        // Tres preexistentes (fallo de Joi, POST exitoso, POST fallido) más el de reconciliación.
        // Si este número sube sin que suba el de abajo, alguien añadió una escritura que va a caer en
        // la base por defecto de runQuery en vez de en FESA — el modo de falla exacto de PR #16, que
        // rompió 7 llamadores al cambiar un valor por defecto implícito.
        expect(countOf(CONTROLLER_SRC, /INSERT INTO fesa\.dbo\.fesaOCFocaltec/g)).toBe(4);
        expect(countOf(CONTROLLER_SRC, /runQuery\([A-Za-z]+,\s*'FESA'\)/g)).toBe(4);
        // La única llamada restante del archivo es el SELECT por tenant, que pasa databases[index].
        // El valor por defecto implícito no debe aparecer nunca escrito en este controlador.
        expect(CONTROLLER_SRC).not.toMatch(/config\.database\.database/);
    });

    test('Guarda 3 (CONTEXT D-01): la sonda corre ANTES de la validación Joi', () => {
        // El camino de fallo de Joi inserta una fila ERROR. Preguntarle al portal después de eso
        // significaría fabricar exactamente el ruido que esta fase existe para eliminar, y además
        // inflaría el propio errorCount que abre la compuerta — un bucle que se realimenta.
        // Se comparan las formas de LLAMADA, no los identificadores pelados: si se compararan los
        // identificadores, la línea de require del inicio del archivo satisfaría la guarda sola.
        const probeAt = CONTROLLER_SRC.indexOf('getPurchaseOrderByExternalId(');
        const joiAt = CONTROLLER_SRC.indexOf('validateExternPurchaseOrder(po)');
        expect(probeAt).toBeGreaterThan(-1);
        expect(joiAt).toBeGreaterThan(-1);
        expect(probeAt).toBeLessThan(joiAt);
    });

    test('Guarda 4 (CLAUDE.md §3, aceptación #14): no se añadió ninguna primitiva always-on', () => {
        // El servicio no termina entre ticks del cron, así que cualquier temporizador, listener o
        // colección en scope de módulo crece sin cota para siempre. El lookup de errorCount es un Map
        // function-scoped: se comprueba que la PRIMERA aparición de `new Map(` esté DESPUÉS de la
        // declaración de la función, que es la diferencia entre "se recolecta al retornar" y "vive lo
        // que viva el proceso".
        expect(CONTROLLER_SRC).not.toMatch(/setInterval/);
        expect(CONTROLLER_SRC).not.toMatch(/setTimeout/);
        expect(CONTROLLER_SRC).not.toMatch(/new Set\(/);
        expect(CONTROLLER_SRC).not.toMatch(/\.addListener\(/);
        const mapAt = CONTROLLER_SRC.indexOf('new Map(');
        const fnAt = CONTROLLER_SRC.indexOf('async function createPurchaseOrders');
        expect(mapAt).toBeGreaterThan(-1);
        expect(fnAt).toBeGreaterThan(-1);
        expect(mapAt).toBeGreaterThan(fnAt);
    });

    test('Guarda 5 (aceptación #13): la firma de runQuery sigue intacta y sigue sin parametrizar', () => {
        // El punto es la INMUTABILIDAD de la firma, no su formato concreto: runQuery lo comparte todo
        // el codebase y cambiar su valor por defecto es la trampa documentada de CLAUDE.md §6 #2.
        // Esta fase resuelve la inyección aguas arriba (la forma de 24 hexadecimales validada dentro
        // de la propia sonda), justamente para no tener que tocar esta utilería compartida.
        expect(SQLCONN_SRC).toMatch(/async function runQuery\(query, database = config\.database\.database\)/);
        // La ausencia de enlace de parámetros es la PREMISA de la guarda de valor de RETRY-D8. Si algún
        // día aparece, la guarda de forma deja de ser la única defensa y este comentario deja de ser
        // cierto — que es exactamente cuando conviene que esta aserción falle y obligue a releerlo.
        expect(SQLCONN_SRC).not.toMatch(/request\.input\(/);
    });

    test('Guarda 6 (CLAUDE.md §9): la sonda se requiere y se llama exactamente una vez', () => {
        // Un solo sitio de llamada dentro del bucle acota el gasto HTTP a un GET por OC ya fallida y
        // por tick. Si se duplicara el sitio de llamada, el primer tick tras el despliegue podría
        // desbordar el techo de 5 minutos de STEP_TIMEOUT_MS contra el rezago acumulado de ERRORes.
        expect(CONTROLLER_SRC).toMatch(/require\(['"]\.\.\/utils\/GetPurchaseOrders['"]\)/);
        expect(countOf(CONTROLLER_SRC, /getPurchaseOrderByExternalId\(/g)).toBe(1);
    });

    test('Guarda 7 (RETRY-D2, con el alcance corregido): el camino de OCs no usa id_type', () => {
        // La aceptación original del SPEC decía "id_type=EXTERNAL no aparece en ninguna parte de src/".
        // Eso era insatisfacible desde el día uno: src/scripts/payment-status-check.js:10 y :78 ya lo
        // usan contra el endpoint de PAGOS, que esta fase no toca. La guarda se acota al camino de
        // órdenes de compra, que es lo que el requisito quiere decir en realidad: la existencia se lee
        // del cuerpo de un 200 filtrado por external id, no de un endpoint de búsqueda por tipo de id.
        expect(CONTROLLER_SRC).not.toMatch(/id_type/);
        expect(PROBE_SRC).not.toMatch(/id_type/);
    });

    test('Guarda 8 (RETRY-D2): un solo external id por petición, sin lotes', () => {
        // Preguntar por una OC a la vez es lo que hace que "el portal no contestó" sea imposible de
        // confundir con "la OC no existe". Un lote separado por comas devolvería un 200 parcial del que
        // no se puede deducir la ausencia de cada id individual — y esa confusión es precisamente la
        // que produce el POST duplicado que esta fase elimina.
        expect(countOf(PROBE_SRC, /external_ids=/g)).toBe(1);
        expect(PROBE_SRC).not.toMatch(/external_ids=\$\{[^}]*join\(/);
    });

    test('Guarda 9 (CONTEXT D-06): exactamente dos etiquetas, y el resultado viaja en un campo', () => {
        // D-06: el desenlace va en un campo `result=`, NO en la etiqueta. Así el conjunto de etiquetas
        // no puede crecer conforme se añaden ramas, y el operador tiene un solo prefijo que buscar.
        // La aserción negativa es la que hace el trabajo: prohíbe cualquier etiqueta hermana del estilo
        // [PORTAL-CHECK-FOUND] o [PORTAL-CHECK-SKIP], dejando pasar únicamente la de resumen.
        expect(CONTROLLER_SRC).toMatch(/\[PORTAL-CHECK\]/);
        expect(CONTROLLER_SRC).toMatch(/\[PORTAL-CHECK-SUMMARY\]/);
        expect(CONTROLLER_SRC).not.toMatch(/\[PORTAL-CHECK-(?!SUMMARY)[A-Z-]+\]/);
    });
});

describe('PortalOC_Creator portal existence probe — behaviour (Phase 20.3 / RETRY-D4, D6, D7)', () => {

    beforeEach(() => {
        resetProbeStubs();
    });

    test('RETRY-D4 (aceptación #4): compuerta cerrada — errorCount 0 no emite ningún GET', async () => {
        // Ésta es la aserción que hace GRATIS la postura fail-closed de RETRY-D5: una OC que nunca
        // falló jamás se sondea, así que una caída del portal no puede retrasar trabajo legítimo.
        // Sólo puede hacer esperar un tick más a una OC que YA venía fallando.
        stubSelect([gateClosedRow()]);
        stubPostSuccess();

        await createPurchaseOrders(0);

        expect(mockPortalGet).not.toHaveBeenCalled();
        expect(mockPortalPost).toHaveBeenCalledTimes(1);
    });

    test('RETRY-D4 (aceptación #5): compuerta abierta — exactamente un GET, y ANTES del POST', async () => {
        stubSelect([gateOpenRow()]);
        stubPortalAbsent();
        stubPostSuccess();

        await createPurchaseOrders(0);

        expect(mockPortalGet).toHaveBeenCalledTimes(1);
        expect(mockPortalPost).toHaveBeenCalledTimes(1);
        // El orden se prueba, no se asume: invocationCallOrder es un contador global monótono de
        // Jest compartido por todos los dobles, así que compara llamadas entre mocks distintos.
        // Sin esto, "se llamó al GET" y "se llamó al POST" serían ciertas también si la sonda
        // corriera DESPUÉS del POST — es decir, sin cortar nada.
        expect(mockPortalGet.mock.invocationCallOrder[0])
            .toBeLessThan(mockPortalPost.mock.invocationCallOrder[0]);
    });

    test('fila 8 (aceptación #9): absent hace POST exactamente como antes de la fase', async () => {
        stubSelect([gateOpenRow()]);
        stubPortalAbsent();
        stubPostSuccess();

        await createPurchaseOrders(0);

        expect(mockPortalPost).toHaveBeenCalledTimes(1);
        expect(mockPortalPost.mock.calls[0][0]).toMatch(/\/purchase-orders$/);

        const inserts = insertsEmitted();
        expect(inserts.length).toBe(1);
        expect(inserts[0][0]).toMatch(/'POSTED'/);
        // La escritura del camino normal, NO la de reconciliación: si esta fila llevara la marca
        // 'PORTAL-CHECK' significaría que la sonda escribió por un camino que debía dejar pasar.
        expect(inserts[0][0]).not.toMatch(/PORTAL-CHECK/);
        expect(inserts[0][1]).toBe('FESA');
    });

    test('fila 1 (aceptación #6): found + OPEN — sin POST, una fila POSTED con el idFocaltec', async () => {
        stubSelect([gateOpenRow()]);
        stubPortalFound(VALID_ID, 'OPEN');

        await createPurchaseOrders(0);

        expect(mockPortalPost).not.toHaveBeenCalled();

        const inserts = insertsEmitted();
        expect(inserts.length).toBe(1);
        expect(inserts[0][0]).toMatch(/INSERT INTO fesa\.dbo\.fesaOCFocaltec/i);
        expect(inserts[0][0]).toContain(VALID_ID);
        expect(inserts[0][0]).toMatch(/'POSTED'/);
        expect(inserts[0][0]).toMatch(/'PORTAL-CHECK'/);
        // RETRY-D5: reconciliar NO es fallar. Una fila ERROR aquí inflaría el errorCount de una OC
        // que el portal ya tiene, que es justo el ruido que la fase existe para eliminar.
        expect(inserts[0][0]).not.toMatch(/'ERROR'/);
        // CLAUDE.md §6 #2: el literal FESA explícito. El valor por defecto implícito de runQuery
        // mandaría esta escritura a la base de Sage.
        expect(inserts[0][1]).toBe('FESA');
    });

    // IN-04 de la revisión de la 20.3. NO era un fallo vivo: `groupOrdersByNumber` recorta los
    // strings (OC_GroupOrdersByNumber.js:21), así que en producción los dos valores coinciden, y
    // aunque no coincidieran el dedupe aguantaría porque la comparación `=` de SQL Server ignora
    // los blancos a la derecha. Lo que se corrige es el acoplamiento: la fila dependía de que una
    // utilería compartida siguiera recortando, y nada lo obliga.
    // Este caso lo puede exhibir porque el doble de `parseExternPurchaseOrders` de esta suite es un
    // pass-through que NO recorta (línea 97) — el mismo hecho que la revisión anotó como WR-03.
    test('IN-04: la fila reconciliada lleva la clave recortada, no el external_id crudo', async () => {
        const PADDED_OC = `${GATE_OPEN_OC}  `;
        stubSelect([{ EXTERNAL_ID: PADDED_OC, errorCount: 3, lastErrorAt: null, dbNow: DB_NOW }]);
        stubPortalFound(VALID_ID, 'OPEN');

        await createPurchaseOrders(0);

        const inserts = insertsEmitted();
        expect(inserts.length).toBe(1);
        // La clave que se escribe es la MISMA con la que se preguntó al portal y con la que se leyó
        // errorCounts. Las dos aserciones discriminan: contra el fuente anterior el literal emitido
        // es `'<oc>  '`, que no contiene `'<oc>'` (después de la OC viene un blanco, no la comilla).
        expect(inserts[0][0]).toContain(`'${GATE_OPEN_OC}'`);
        expect(inserts[0][0]).not.toContain(`'${PADDED_OC}'`);
        // La bitácora de reconciliación va por el mismo camino.
        const okLine = mockLogGenerator.mock.calls.find((c) => String(c[2]).includes('reconciliada'));
        expect(okLine).toBeDefined();
        expect(okLine[2]).toContain(`PO ${GATE_OPEN_OC} reconciliada`);
    });

    test('fila 2 (aceptación #6): found + GENERATED — mismo desenlace que OPEN', async () => {
        // Esta fila existe porque `20.1-RELEASE-STATUS.md` § BLOQUEOS 1 registró sólo DOS valores de
        // status, y el SPEC de esta fase corrige el dato: el enum del portal tiene CUATRO —
        // OPEN | CANCELLED | GENERATED | CLOSED. GENERATED se mapea a POSTED igual que OPEN; si el
        // dato equivocado hubiera sobrevivido, GENERATED habría caído en la rama "no reconocido".
        stubSelect([gateOpenRow()]);
        stubPortalFound(VALID_ID, 'GENERATED');

        await createPurchaseOrders(0);

        expect(mockPortalPost).not.toHaveBeenCalled();

        const inserts = insertsEmitted();
        expect(inserts.length).toBe(1);
        expect(inserts[0][0]).toMatch(/INSERT INTO fesa\.dbo\.fesaOCFocaltec/i);
        expect(inserts[0][0]).toContain(VALID_ID);
        expect(inserts[0][0]).toMatch(/'POSTED'/);
        expect(inserts[0][0]).toMatch(/'PORTAL-CHECK'/);
        expect(inserts[0][0]).not.toMatch(/'ERROR'/);
        expect(inserts[0][1]).toBe('FESA');
    });

    test('fila 3 (aceptación #7): found + CLOSED — sin POST, una fila CLOSED con el idFocaltec', async () => {
        stubSelect([gateOpenRow()]);
        stubPortalFound(VALID_ID, 'CLOSED');

        await createPurchaseOrders(0);

        expect(mockPortalPost).not.toHaveBeenCalled();

        const inserts = insertsEmitted();
        expect(inserts.length).toBe(1);
        expect(inserts[0][0]).toContain(VALID_ID);
        expect(inserts[0][0]).toMatch(/'CLOSED'/);
        // El status local es un literal LOCAL y excluyente: sembrar POSTED para una OC ya cerrada
        // reabriría en la tabla de control un ciclo de vida que el portal ya terminó.
        expect(inserts[0][0]).not.toMatch(/'POSTED'/);
        expect(inserts[0][1]).toBe('FESA');
    });

    test('fila 4 (aceptación #8): found + CANCELLED — sin POST y sin ninguna fila', async () => {
        // CR-02 (añadir CANCELLED a la lista del NOT EXISTS del dedupe) está FUERA de alcance, así
        // que esta OC se sigue seleccionando en cada tick y sigue produciendo un GET inofensivo.
        // La fase 20.3 mitiga CR-02 —deja de hacerle POST— pero no lo cierra.
        stubSelect([gateOpenRow()]);
        stubPortalFound(VALID_ID, 'CANCELLED');

        await createPurchaseOrders(0);

        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(insertsEmitted().length).toBe(0);
    });

    test('fila 5 (aceptación #8, piedra angular de RETRY-D7): un status fuera del enum NUNCA llega al POST', async () => {
        // EL CASO MÁS IMPORTANTE DE LA SUITE.
        //
        // Si un status no reconocido cayera al camino de creación, el cron volvería a hacer POST de
        // una OC que el portal YA TIENE: el portal contestaría 409, el catch escribiría otra fila
        // ERROR, el errorCount subiría, y el siguiente tick repetiría todo. Es exactamente el bucle
        // que esta fase existe para cortar — reproducido, y encima EN SILENCIO, porque desde fuera
        // se vería idéntico al comportamiento correcto salvo por una línea de bitácora a nivel warn.
        //
        // El despacho de 20.3-03 lo impide por CONSTRUCCIÓN y no por enumeración: llegar al POST
        // exige ACERTAR el valor 'absent', no FALLAR una lista de ramas. 'FROZEN' es un valor que
        // nadie anticipó; el punto es que no hace falta anticiparlo.
        stubSelect([gateOpenRow()]);
        stubPortalFound(VALID_ID, 'FROZEN');

        await createPurchaseOrders(0);

        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(insertsEmitted().length).toBe(0);
    });

    test('fila 6 (aceptación #8): coincidencia ambigua — sin POST, sin fila, línea a nivel warn', async () => {
        stubSelect([gateOpenRow()]);
        stubPortalAmbiguous();

        await createPurchaseOrders(0);

        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(insertsEmitted().length).toBe(0);
        // Cola abierta después de `result=ambiguous ` a propósito — ver la nota de anclaje del
        // tercer bloque describe.
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'warn',
            expect.stringMatching(/^\[PORTAL-CHECK\] PO PO0084361 tenant=COPDAT result=ambiguous /));
    });

    test('CONTEXT D-01: con un resultado found, la validación Joi NO se ejecuta', async () => {
        // Prueba de ORDEN en tiempo de ejecución (la prueba por orden en el fuente es la Guarda 3).
        // Si la sonda corriera después de Joi, una OC que el portal ya tiene tomaría el camino de
        // fallo de Joi cuando éste fallara — y ese camino INSERTA una fila ERROR e infla el propio
        // errorCount que abre la compuerta. Un bucle que se realimenta.
        stubSelect([gateOpenRow()]);
        stubPortalFound(VALID_ID, 'OPEN');

        await createPurchaseOrders(0);

        expect(mockValidatePO).not.toHaveBeenCalled();
    });

    test('CONTEXT D-01 (control complementario): con absent, Joi SÍ se ejecuta una vez', async () => {
        // Sin este control, el caso anterior podría pasar porque el cableado dejó el camino de
        // caída roto por completo en vez de porque la sonda corre primero.
        stubSelect([gateOpenRow()]);
        stubPortalAbsent();
        stubPostSuccess();

        await createPurchaseOrders(0);

        expect(mockValidatePO).toHaveBeenCalledTimes(1);
    });
});

describe('PortalOC_Creator portal existence probe — fail-closed, id guard and log vocabulary (Phase 20.3 / RETRY-D5, D8, D-06)', () => {

    beforeEach(() => {
        resetProbeStubs();
    });

    // ── RETRY-D5: la sonda que no puede contestar no escribe NADA ────────────────────────────
    //
    // Las tres formas de fallo de abajo comparten una sola postura, y el razonamiento es el que da
    // el propio SPEC: escribir una fila ERROR aquí inflaría el errorCount por una falla del LADO
    // DEL PORTAL y corrompería el historial de fallos que el operador usa para diagnosticar; y leer
    // un 404 como "la OC no existe" produciría exactamente el POST duplicado que la fase previene.
    // Por eso la aserción es doble: ni POST, ni NINGUNA fila — ni ERROR ni POSTED.

    test('RETRY-D5 (aceptación #10): un rechazo con forma de 404 no postea y no escribe nada', async () => {
        stubSelect([gateOpenRow()]);
        mockPortalGet.mockRejectedValueOnce(
            Object.assign(new Error('Request failed with status code 404'), { response: { status: 404, data: {} } }));

        await createPurchaseOrders(0);

        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(insertsEmitted().length).toBe(0);
    });

    test('RETRY-D5 (aceptación #10): un corte de red / expiración no postea y no escribe nada', async () => {
        // Segunda forma de fallo, misma postura: un Error pelado sin `response`, que es lo que
        // entrega axios cuando vence el techo de 30 s del singleton PortalClient.
        stubSelect([gateOpenRow()]);
        mockPortalGet.mockRejectedValueOnce(new Error('timeout of 30000ms exceeded'));

        await createPurchaseOrders(0);

        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(insertsEmitted().length).toBe(0);
    });

    test('RETRY-D5 (aceptación #10): un 500 del portal no postea y no escribe nada', async () => {
        stubSelect([gateOpenRow()]);
        mockPortalGet.mockRejectedValueOnce(
            Object.assign(new Error('Request failed with status code 500'), { response: { status: 500, data: {} } }));

        await createPurchaseOrders(0);

        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(insertsEmitted().length).toBe(0);
    });

    test('CR-01 (RETRY-D5, cuarta forma de fallo): un 200 con cuerpo malformado no postea y no escribe nada', async () => {
        // La forma de fallo que ninguna prueba cubría, porque todos los stubs de esta suite y el
        // factory `ok(items)` de la suite del helper construyen siempre un `items` bien formado.
        // Un 200 sin arreglo `items` —una página de login tras un 302, un sobre de error servido
        // con 200— NO prueba que la OC esté ausente, y postear ahí fabrica el 409 duplicado.
        // D-09: la sonda REAL corre; lo que se mockea es PortalClient, una capa más abajo.
        stubSelect([gateOpenRow()]);
        mockPortalGet.mockResolvedValueOnce({ data: {} });

        await createPurchaseOrders(0);

        expect(mockPortalGet).toHaveBeenCalledTimes(1);
        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(insertsEmitted().length).toBe(0);

        // El `reason` viaja intacto del helper a la bitácora: sin él, el operador vería el mismo
        // `result=unknown` que produce un portal caído y no podría distinguir las dos causas.
        const checkLine = mockLogGenerator.mock.calls
            .find((c) => /^\[PORTAL-CHECK\] PO PO0084361/.test(c[2] || ''));
        expect(checkLine).toBeDefined();
        expect(checkLine[1]).toBe('warn');
        expect(String(checkLine[2])).toContain('reason=malformed-response');
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[PORTAL-CHECK-SUMMARY\] tenant=COPDAT probed=1 found=0 absent=0 skipped=0 unknown=1 deferred=0$/));
    });

    // ── RETRY-D8 observado desde el borde del controlador ────────────────────────────────────

    const MALFORMED_IDS = [
        ['con forma de inyección SQL', "'; DROP TABLE--"],
        ['vacío', ''],
        ['nulo', null],
        ['de 23 hexadecimales', '507f1f77bcf86cd79943901'],
        ['de 25 hexadecimales', '507f1f77bcf86cd7994390111'],
        ['de 24 caracteres no hexadecimales', 'zzzzzzzzzzzzzzzzzzzzzzzz'],
    ];

    test.each(MALFORMED_IDS)('RETRY-D8 (aceptación #11): un idFocaltec %s no llega a ningún string SQL', async (_label, badId) => {
        // Ésta es la prueba OBSERVABLE de que la guarda del lado del helper (CONTEXT D-05) vuelve
        // ESTRUCTURAL a RETRY-D8: no existe camino de código en el controlador por el que un id
        // malformado pueda llegar a un string SQL, porque el controlador nunca llega a sostener uno.
        // runQuery no parametriza (CLAUDE.md §6 #1) y su firma no se tocó (§6 #2), así que la
        // defensa tenía que vivir en el valor, y vive aguas arriba del consumidor.
        stubSelect([gateOpenRow()]);
        stubPortalFound(badId, 'OPEN');

        await createPurchaseOrders(0);

        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(insertsEmitted().length).toBe(0);

        // La mitad de "no aparece en ningún SQL" sólo tiene sentido para un valor buscable: `''`
        // es subcadena de toda cadena (String.prototype.includes('') es siempre cierto) y `null`
        // nunca fue texto. Para esos dos, la aserción portadora es la de arriba — cero INSERT, o
        // sea cero SQL emitido después del SELECT en el que puedan aparecer.
        const needle = badId == null ? '' : String(badId);
        if (needle.length > 0) {
            mockRunQuery.mock.calls.forEach((c) => {
                expect(String(c[0] || '').includes(needle)).toBe(false);
            });
        }
    });

    test('RETRY-D8 (aceptación #11, control positivo): un id de 24 hexadecimales SÍ llega al INSERT', async () => {
        // Sin este control, los seis casos de arriba pasarían igual si la sonda estuviera rota del
        // todo y no devolviera nunca un `found`. "No se escribió nada" sólo prueba algo cuando se
        // demuestra que el mismo camino SÍ escribe con una entrada válida.
        stubSelect([gateOpenRow()]);
        stubPortalFound(VALID_ID, 'OPEN');

        await createPurchaseOrders(0);

        const inserts = insertsEmitted();
        expect(inserts.length).toBe(1);
        expect(inserts[0][0]).toContain(VALID_ID);
    });

    test('RETRY-D6 (aceptación #12): ningún desenlace emite un UPDATE en tiempo de ejecución', async () => {
        // Complementa la Guarda 1 del primer bloque: ausencia en el fuente MÁS ausencia en tiempo
        // de ejecución. La primera detecta el código que alguien escriba; ésta detecta el SQL que
        // el proceso realmente manda, incluido el que se armara por concatenación en una rama.
        const scenarios = [
            ['found', () => stubPortalFound(VALID_ID, 'OPEN')],
            ['absent', () => { stubPortalAbsent(); stubPostSuccess(); }],
            ['cancelled', () => stubPortalFound(VALID_ID, 'CANCELLED')],
            ['unknown', () => mockPortalGet.mockRejectedValueOnce(new Error('timeout of 30000ms exceeded'))],
        ];

        for (const [, arm] of scenarios) {
            resetProbeStubs();
            stubSelect([gateOpenRow()]);
            arm();

            await createPurchaseOrders(0);

            expect(mockRunQuery).toHaveBeenCalled();
            mockRunQuery.mock.calls.forEach((c) => {
                expect(String(c[0] || '')).not.toMatch(/UPDATE\s+fesa\.dbo\.fesaOCFocaltec/i);
            });
        }
    });

    // ── D-06: el vocabulario de bitácora ──────────────────────────────────────────────────────
    //
    // POLÍTICA DE ANCLAJE (PATTERNS Q5). La línea POR FILA se deja con la COLA ABIERTA justo
    // después de `result=<valor>`, igual que `[RETRY-DEFER]` en cron-where.test.js:172, para que el
    // renderizado de `id=` / `status=` / `reason=` siga siendo ajustable. La línea de RESUMEN sí se
    // cierra con `$`, igual que `[RETRY]` y `[RETRY-CLOCK]`, porque su juego de campos es fijo y
    // completo. Lo que se ancla aquí queda INAMOVIBLE: la fase 20.2 registró que las etiquetas
    // `[RETRY*]` ya no se pudieron corregir ni cuando se descubrió que su semántica de zona horaria
    // era engañosa. `^\[PORTAL-CHECK\]` no colisiona con la de resumen gracias al `\]`.

    test('D-06: línea por fila de un found, a nivel info, con la cola abierta', async () => {
        stubSelect([gateOpenRow()]);
        stubPortalFound(VALID_ID, 'OPEN');

        await createPurchaseOrders(0);

        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[PORTAL-CHECK\] PO PO0084361 tenant=COPDAT result=found /));
    });

    test('D-06: línea por fila de un cancelled, a nivel info', async () => {
        stubSelect([gateOpenRow()]);
        stubPortalFound(VALID_ID, 'CANCELLED');

        await createPurchaseOrders(0);

        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[PORTAL-CHECK\] PO PO0084361 tenant=COPDAT result=cancelled /));
    });

    test('D-06: línea por fila de una sonda rechazada, a nivel WARN', async () => {
        // El nivel es parte del contrato, no cosmética: el operador filtra la bitácora por nivel, y
        // un desenlace que bloqueó una creación tiene que verse por encima del ruido informativo.
        stubSelect([gateOpenRow()]);
        mockPortalGet.mockRejectedValueOnce(new Error('timeout of 30000ms exceeded'));

        await createPurchaseOrders(0);

        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'warn',
            expect.stringMatching(/^\[PORTAL-CHECK\] PO PO0084361 tenant=COPDAT result=unknown /));
    });

    // Los cinco escenarios de contadores. Con los cinco, cada uno de los cuatro buckets queda
    // fijado por una aserción cerrada propia y las dos reglas de plegado —cancelled→skipped y
    // ambiguous→unknown— quedan PROBADAS en vez de supuestas. Eso es lo que convierte
    // `probed === found + absent + skipped + unknown` en una invariante real y no en una
    // afirmación aritmética que los tests nunca ejercitan.
    //
    // Fase 20.4 (RETRY-E4): estas anclas llevan ahora un SEXTO campo, ` deferred=0`. Se agregó
    // porque el SPEC de la 20.4 fija el campo en la línea de resumen, y en los cinco escenarios no
    // se difiere nada, así que cero es el valor correcto en todos. Lo que NO se hizo, a propósito,
    // fue aflojar el `$` de cierre para "acomodar" el campo nuevo: ese ancla es el valor entero de
    // la aserción — es lo que prueba que ningún campo extra puede colarse sin que nadie lo note.
    // Se conserva, y ahora prohíbe un séptimo campo igual que antes prohibía un sexto.

    test('D-06: resumen del escenario found — probed=1 found=1', async () => {
        stubSelect([gateOpenRow()]);
        stubPortalFound(VALID_ID, 'OPEN');

        await createPurchaseOrders(0);

        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[PORTAL-CHECK-SUMMARY\] tenant=COPDAT probed=1 found=1 absent=0 skipped=0 unknown=0 deferred=0$/));
    });

    test('D-06: resumen del escenario absent — probed=1 absent=1', async () => {
        stubSelect([gateOpenRow()]);
        stubPortalAbsent();
        stubPostSuccess();

        await createPurchaseOrders(0);

        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[PORTAL-CHECK-SUMMARY\] tenant=COPDAT probed=1 found=0 absent=1 skipped=0 unknown=0 deferred=0$/));
    });

    test('D-06: resumen del escenario cancelled — se pliega en skipped, no en unknown', async () => {
        stubSelect([gateOpenRow()]);
        stubPortalFound(VALID_ID, 'CANCELLED');

        await createPurchaseOrders(0);

        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[PORTAL-CHECK-SUMMARY\] tenant=COPDAT probed=1 found=0 absent=0 skipped=1 unknown=0 deferred=0$/));
    });

    test('D-06: resumen del escenario ambiguous — se pliega en unknown, no en skipped', async () => {
        stubSelect([gateOpenRow()]);
        stubPortalAmbiguous();

        await createPurchaseOrders(0);

        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[PORTAL-CHECK-SUMMARY\] tenant=COPDAT probed=1 found=0 absent=0 skipped=0 unknown=1 deferred=0$/));
    });

    test('D-06: resumen de una sonda rechazada — probed=1 unknown=1', async () => {
        stubSelect([gateOpenRow()]);
        mockPortalGet.mockRejectedValueOnce(new Error('timeout of 30000ms exceeded'));

        await createPurchaseOrders(0);

        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[PORTAL-CHECK-SUMMARY\] tenant=COPDAT probed=1 found=0 absent=0 skipped=0 unknown=1 deferred=0$/));
    });

    test('D-06: con probed=0 no se emite resumen, y el vocabulario [RETRY*] queda intacto', async () => {
        // El tick sin ninguna OC ya fallida es el abrumadoramente común: una línea de ceros cada
        // 15 minutos vuelve ilegible la bitácora que el operador necesita leer. La segunda mitad
        // del caso es la que importa igual — prueba que la etiqueta nueva no perturbó la anclada
        // de la fase 20.1, que es exactamente el tipo de regresión que nadie nota hasta producción.
        stubSelect([gateClosedRow()]);
        stubPostSuccess();

        await createPurchaseOrders(0);

        const summaryCalls = mockLogGenerator.mock.calls
            .filter((c) => /^\[PORTAL-CHECK-SUMMARY\]/.test(c[2] || ''));
        expect(summaryCalls.length).toBe(0);
        const perRowCalls = mockLogGenerator.mock.calls
            .filter((c) => /^\[PORTAL-CHECK\]/.test(c[2] || ''));
        expect(perRowCalls.length).toBe(0);

        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[RETRY\] tenant=COPDAT candidates=1 deferred=0 processing=1$/));
    });

    test('T-20.3-15: un status hostil no puede forjar una segunda entrada de bitácora', async () => {
        // Las bitácoras de winston son el rastro de auditoría que sobrevive al reinicio
        // (CLAUDE.md §5), así que un salto de línea de origen portal metido en el status no debe
        // poder inyectar una línea falsa que parezca emitida por el servicio. El saneador en línea
        // del controlador elimina todo lo que no sea [A-Za-z0-9_-] y recorta a 32 caracteres.
        // Además el status resultante queda fuera del enum, así que aplica la fila 5: sin POST.
        const HOSTILE_STATUS = 'OPEN\n[PORTAL-CHECK] PO FORGED tenant=COPDAT result=absent\u0007';
        stubSelect([gateOpenRow()]);
        stubPortalFound(VALID_ID, HOSTILE_STATUS);

        await createPurchaseOrders(0);

        mockLogGenerator.mock.calls.forEach((c) => {
            const msg = String(c[2] || '');
            expect(msg).not.toContain('\n');
            expect(msg).not.toContain('\u0007');
            // La carga útil buscaba hacerse pasar por un desenlace `absent`, que es el ÚNICO que
            // deja pasar el POST — o sea, la línea forjada más peligrosa que se podía intentar.
            expect(msg).not.toMatch(/result=absent/);
        });

        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(insertsEmitted().length).toBe(0);
    });

    // ── WR-02: el catch tiene que decir la verdad sobre la etapa que falló ────────────────────
    //
    // El try abarca tres cosas —la sonda, la escritura de reconciliación y las llamadas de
    // bitácora— y el catch afirmaba una sola causa (`reason=write-failed`) para las tres. En prod
    // no hay SSMS ni depurador (HANDOFF §6): la bitácora es el único canal, y ahí mentía sobre la
    // etapa. Que `logGenerator` pueda lanzar no es hipotético — su ruta de respaldo hace
    // `fs.mkdirSync` fuera de todo try (LogGenerator.js:53-56) — y `console.*` sobre un stdout
    // capturado por Servy puede dar EPIPE durante la rotación de servy-stdout.log.
    //
    // El daño mayor era en el tramo `absent`: ahí ya se había contado probeAbsent, así que el
    // `probeUnknown++` del catch dejaba el resumen en `probed=1 absent=1 unknown=1` y rompía la
    // invariante que el comentario de PortalOC_Creator.js:537-539 declara que debe cumplirse
    // SIEMPRE. Un resumen que no cuadra es peor que ninguno: es el número con el que el operador
    // decide si la sonda está sana.

    // Lee el resumen y devuelve sus cinco campos como números.
    const summaryCounters = () => {
        const call = mockLogGenerator.mock.calls
            .find((c) => /^\[PORTAL-CHECK-SUMMARY\]/.test(String(c[2] || '')));
        expect(call).toBeDefined();
        const msg = String(call[2]);
        const read = (field) => Number((msg.match(new RegExp(`${field}=(\\d+)`)) || [])[1]);
        return { msg, probed: read('probed'), found: read('found'), absent: read('absent'), skipped: read('skipped'), unknown: read('unknown') };
    };

    test('WR-02: si la bitácora del camino absent lanza, la invariante de contadores se sostiene', async () => {
        stubSelect([gateOpenRow()]);
        stubPortalAbsent();
        stubPostSuccess();
        mockLogGenerator.mockImplementation((_file, _level, msg) => {
            if (/^\[PORTAL-CHECK\] PO PO0084361 .*result=absent/.test(String(msg))) {
                throw new Error('EPIPE: write EPIPE');
            }
        });

        await createPurchaseOrders(0);

        const c = summaryCounters();
        expect(c.probed).toBe(c.found + c.absent + c.skipped + c.unknown);
        expect(c.msg).toMatch(/probed=1 found=0 absent=0 skipped=0 unknown=1 deferred=0$/);

        // Y la etapa se nombra: `write-failed` habría mandado al operador a revisar una escritura
        // que nunca se intentó (esta OC ni siquiera tiene fila que escribir).
        const failLine = mockLogGenerator.mock.calls
            .find((c2) => /^\[PORTAL-CHECK\] PO PO0084361 tenant=COPDAT result=unknown /.test(String(c2[2] || '')));
        expect(failLine).toBeDefined();
        expect(String(failLine[2])).not.toContain('reason=write-failed');
        expect(String(failLine[2])).toContain('reason=log-absent-failed');
    });

    test('WR-02 (control positivo): cuando SÍ falla el INSERT, el reason sigue siendo write-failed', async () => {
        // Sin este control, el caso anterior pasaría igual si se hubiera borrado `write-failed` del
        // todo. El diagnóstico verdadero tiene que sobrevivir intacto: es el que ya estaba bien.
        stubSelect([gateOpenRow()]);
        mockRunQuery.mockRejectedValueOnce(new Error('Timeout: Request failed to complete'));
        stubPortalFound(VALID_ID, 'OPEN');

        await createPurchaseOrders(0);

        expect(mockPortalPost).not.toHaveBeenCalled();
        const failLine = mockLogGenerator.mock.calls
            .find((c2) => /^\[PORTAL-CHECK\] PO PO0084361 tenant=COPDAT result=unknown /.test(String(c2[2] || '')));
        expect(failLine).toBeDefined();
        expect(String(failLine[2])).toContain('reason=write-failed');

        const c = summaryCounters();
        expect(c.probed).toBe(c.found + c.absent + c.skipped + c.unknown);
        expect(c.msg).toMatch(/probed=1 found=0 absent=0 skipped=0 unknown=1 deferred=0$/);
    });
});
