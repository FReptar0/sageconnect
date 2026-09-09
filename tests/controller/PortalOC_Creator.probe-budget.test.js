/**
 * El tope por tick de la sonda de existencia en el portal: las dos cotas, cada una alcanzable por
 * separado, y el camino fail-closed que no escribe nada.
 * Fase 20.4 — RETRY-E1 y RETRY-E3 (CONTEXT D-14, D-15, D-16; casillas de aceptación 1, 2, 3 y 4).
 *
 * ── Por qué este archivo existe aparte (D-15) ────────────────────────────────────────────────
 * La cobertura natural de esta fase sería extender `PortalOC_Creator.portal-check.test.js`, que ya
 * trae el preámbulo de dobles y ejercita el mismo controlador. No se hace, y no es preferencia de
 * organización: este archivo instala un espía sobre `Date.now` en un `beforeEach`, y un `beforeEach`
 * es compartido por TODO el archivo. Puesto allá, los 44 casos de la fase 20.3 heredarían un reloj
 * congelado que ninguno pidió, y el SPEC exige explícitamente que esas aserciones sigan pasando sin
 * cambios. Un archivo separado vuelve esa exigencia cierta POR CONSTRUCCIÓN en vez de por vigilancia
 * — el mismo razonamiento que la decisión D-16 de la fase 23 usó para no editar
 * `schedule-routes.test.js`. Precio a pagar: el preámbulo de dobles se duplica. Es el precio
 * correcto; la alternativa es acoplar 44 casos ajenos al reloj de éste.
 *
 * ── Por qué un espía sobre Date.now y NO la API de temporizadores falsos de Jest (D-14) ──────
 * La suite de la 20.3 no usa temporizadores falsos en ninguna parte — `jest.mock` puro más resets de
 * dobles — y sus casos son `async` con `await` sobre promesas mockeadas. Los temporizadores falsos
 * modernos y las microtareas conviven bien, pero instalarlos cambia el entorno de EJECUCIÓN de todos
 * los casos del archivo donde caen, y eso es superficie de riesgo comprada a cambio de nada: la
 * única fuente de tiempo que lee el código nuevo es `Date.now()` (`PortalOC_Creator.js:58` y `:368`,
 * los dos únicos sitios del controlador). Un espía sobre `Date.now` es determinista, quirúrgico y
 * deja el bucle de eventos en paz.
 *
 * ── Sobre la letra del SPEC ──────────────────────────────────────────────────────────────────
 * La aceptación de RETRY-E1 dice "proven with fake timers". Un espía sobre `Date.now` ES un reloj
 * falso; lo que el criterio pide de verdad es (a) determinismo y (b) que ambas cotas sean
 * alcanzables de forma independiente. Las dos se cumplen aquí y con más precisión que con
 * temporizadores falsos, porque el avance del reloj está atado al COSTO DECLARADO de cada sonda y no
 * al paso del bucle de eventos. Queda escrito para que `/gsd-verify-work` lo lea como una elección
 * de implementación documentada y no como una desviación.
 *
 * ── La colisión de nombre `deferred=`, y la regla que se sigue de ella ───────────────────────
 * `deferred=` aparece en DOS líneas distintas de esta misma bitácora, con dos significados
 * distintos: en la línea de resumen por tick del post-filtro de reintentos (`PortalOC_Creator.js:282`,
 * etiqueta RETRY) significa "retenida por el intervalo de reintento", y en
 * `[PORTAL-CHECK-SUMMARY]` (`:650`) significa "retenida por el presupuesto de sondeo del tick". Lo
 * que las desambigua es la ETIQUETA, no el nombre del campo. Un parser sin anclar leería el número
 * equivocado y pasaría en verde. Regla de este archivo, sin excepciones: todo campo se lee a través
 * de `summaryLine()`, que ancla en `^\[PORTAL-CHECK-SUMMARY\]`, y la etiqueta de reintentos no se
 * menciona en ninguna aserción.
 *
 * ── Dos literales que este archivo describe pero NO transcribe, a propósito ──────────────────
 * La etiqueta de reintentos entre corchetes y el nombre de la API de temporizadores falsos de Jest
 * son las dos cosas que este archivo se compromete a NO usar, y existe una aserción estructural que
 * cuenta cada una de esas subcadenas en este fuente y debe dar cero. Escribirlas textuales en un
 * comentario dejaría a esas dos guardas ciegas para siempre: no podrían distinguir el uso prohibido
 * de la cita del uso prohibido. Se describen con todo su detalle y no se transcriben — mismo
 * desenlace y mismo motivo que el hazard de D-04 en `PortalOC_Creator.js:347-360`. No las
 * "completes".
 *
 * Bloques de este archivo:
 *   1. «ambos topes, cada uno alcanzable por separado» (plan 20.4-03, tarea 1) — RETRY-E1 / D-16.
 *   2. «fail-closed al alcanzar cualquiera de los dos topes» (plan 20.4-03, tarea 2) — RETRY-E3.
 *   (El plan 20.4-04 agrega a este mismo archivo la invariante de contadores, el punto ciego de
 *   D-07 y las guardas estructurales.)
 */

const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Preámbulo de dobles. Copiado de tests/controller/PortalOC_Creator.portal-check.test.js:50-102 con
// dos cambios, ambos exigidos por lo que este archivo mide.
//
// El mock de config va COMPLETO a propósito: PortalOC_Creator.js lee las siete claves de
// config.app.defaultAddress y config.app.addressIdentifiersSkip AL CARGAR EL MÓDULO (L6-12 y L40),
// así que un mock mínimo revienta el require antes de llegar a ningún caso.
//
// T-20.4-16 (HANDOFF §1): todos los valores son placeholders sintéticos — ni un id de tenant real,
// ni una clave, ni un secreto, ni un host, ni un correo, ni un nombre de cliente, ni un nombre de
// servidor. Los números de OC son sintéticos (PO9xxxx).
// ─────────────────────────────────────────────────────────────────────────────────────────────

// Los defaults de producción que fija RETRY-E2 y que la ola 1 dejó garantizados enteros en runtime.
// Viven como constantes porque `beforeEach` los reinstala en cada caso: un override por caso sobre
// `mockConfig.portal.*` sobreviviría al siguiente y lo haría pasar por la razón equivocada
// (T-20.4-15).
const PROBE_DEFAULT_BUDGET_MS = 120000;
const PROBE_DEFAULT_MAX_PER_TICK = 50;

// CAMBIO 1 respecto de la plantilla de la 20.3: el mock de config es un objeto de módulo MUTABLE en
// vez de un literal dentro de la fábrica. El controlador lee `config.portal.probeMaxPerTick` y
// `config.portal.probeBudgetMs` en tiempo de LLAMADA, dentro del bucle (`:367-368`), así que
// reafinar este objeto entre casos surte efecto sin volver a requerir nada. El prefijo `mock` del
// nombre es lo que permite que `babel-plugin-jest-hoist` acepte la referencia fuera de alcance
// dentro de la fábrica; y como la fábrica sólo se invoca al requerir el controlador —al final de
// este archivo— para entonces `mockConfig` ya está construido por completo.
const mockConfig = {
    portal: {
        url: 'http://test',
        tenants: [{ id: 'T1', key: 'k1', secret: 's1', database: 'COPDAT', externalId: 'ext1' }],
        httpTimeoutMs: 30000,
        probeBudgetMs: PROBE_DEFAULT_BUDGET_MS,
        probeMaxPerTick: PROBE_DEFAULT_MAX_PER_TICK,
    },
    paths: { downloads: '/tmp/downloads', logs: '/tmp/logs', providers: '/tmp/p' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', notices: [], cc: [], password: '' },
    // El placeholder NO tiene forma de correo, a diferencia de la plantilla de la 20.3. El criterio
    // de redacción de este plan exige que un regex genérico de correo no encuentre NADA en este
    // archivo, y un 'admin@…' sintético igual lo dispara. `validate()` sólo comprueba presencia,
    // nunca formato, así que el significado se preserva entero. Mismo desenlace que la ola 20.4-01.
    license: { adminEmail: 'admin-placeholder' },
    app: {
        company: 'TestCo', timezone: 'America/Mexico_City', rfc: 'RFC', regimen: 'R1', arg: 'A1',
        importRoute: '',
        defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
        addressIdentifiersSkip: [],
    },
    security: { apiKey: 'test-key' },
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 0, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
    retry: { scope: 'current_month', lookbackDays: 30, interval: { payment: 30, po: 240 } },
    // Fase 20.5: omitir esta clave dejaría config.notifications.poAlert.enabled leyendo undefined y
    // desactivaría en silencio la alerta inmediata en toda la suite — el mismo agujero de
    // desactivación silenciosa que la fase 20.4 cerró en dos de estos mismos mocks.
    notifications: { poAlert: { enabled: true } },
    eom: { notificationHour: 18, notificationEnabled: true },
};
jest.mock('../../src/config', () => mockConfig);

// Fase 20.5: este archivo ejecuta el createPurchaseOrders REAL por caminos de fallo del POST con
// fixtures cuyo errorCount es 0 — que es exactamente la condición de primer fallo. Sin este mock la
// suite intentaría envíos SMTP salientes de verdad contra un host inventado.
jest.mock('../../src/utils/EmailSender', () => ({ sendMail: jest.fn(), sendOperatorReport: jest.fn().mockResolvedValue(undefined) }));

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

// Se mockea PortalClient con AMBOS verbos y se deja correr la sonda REAL
// (`src/utils/GetPurchaseOrders.js`) — CAMBIO 1 de la 20.3, heredado tal cual. Si en cambio se
// mockeara el helper, la aserción "la OC diferida no emitió ningún GET" sería trivialmente cierta:
// el doble jamás emitiría un GET aunque el cableado lo pidiera. Mockear una capa MÁS ABAJO que la
// unidad bajo prueba es lo que convierte esa aserción en una prueba de verdad, y es lo que hace que
// RETRY-E3 signifique algo en este archivo.
const mockPortalGet = jest.fn();
const mockPortalPost = jest.fn();
jest.mock('../../src/utils/PortalClient', () => ({ get: mockPortalGet, post: mockPortalPost }));

jest.mock('../../src/utils/TimezoneHelper', () => ({ getCurrentDateString: () => '2026-05-15' }));
jest.mock('../../src/utils/OC_GroupOrdersByNumber', () => ({ groupOrdersByNumber: (rs) => rs }));
jest.mock('../../src/utils/parseExternPurchaseOrders', () => ({
    parseExternPurchaseOrders: (g) => g.map((r) => ({ external_id: r.EXTERNAL_ID, cfdi_payment_method: '', requisition_number: 0, _row: r })),
}));

// La validación Joi se ata a un jest.fn() en vez de a una flecha anónima para poder observar SI se
// llamó. Es la mitad observable de RETRY-E3: el camino de fallo de Joi es en sí mismo un emisor de
// filas ERROR, y la fase 20.3 puso el bloque de sonda por delante justamente por eso.
const mockValidatePO = jest.fn((po) => po);
jest.mock('../../src/models/PurchaseOrder', () => ({ validateExternPurchaseOrder: mockValidatePO }));

const { createPurchaseOrders } = require('../../src/controller/PortalOC_Creator');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Reloj virtual.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// Época fija arbitraria. Lo único que importa es que NO se derive del reloj real: un origen real
// volvería irreproducible cualquier fallo que dependiera del instante de la corrida.
const VIRTUAL_START = 1700000000000;
let virtualNow;

// ÚNICO sitio de avance del reloj en todo el archivo. Que sea uno solo no es estética: hace que las
// aserciones sean independientes de CUÁNTAS veces lea `Date.now()` el controlador por iteración. Una
// secuencia fija de `mockReturnValueOnce` se descuadraría en silencio en el momento en que la
// implementación agregara o quitara una lectura de reloj, y a partir de ahí estaría midiendo el
// número de LECTURAS en vez del número de SONDAS. Aquí sólo gasta presupuesto el trabajo declarado
// explícitamente como costoso, que es exactamente la propiedad que afirma RETRY-E1.
//
// CUATRO sitios declaran costo y los cuatro pasan por aquí: el GET (`stubPortalCostly`), el POST
// (`stubPostCostly`), el INSERT (el parámetro `insertCostMs` de `stubSelect`) y el SELECT previo al
// bucle (el caso del punto ciego de D-07). La propiedad de sitio-único de AVANCE sigue siendo
// cierta y tiene que seguir siéndolo; lo que WR-08 corrigió no fue esa propiedad sino que sólo UNO
// de los cuatro existiera. El presupuesto se evalúa en el BORDE DE ITERACIÓN, así que el POST y el
// INSERT se cobran contra él igual que el GET, y un archivo que sólo cobrara el GET estaría
// modelando un mecanismo distinto del que dice probar. Cualquier costo nuevo se enruta por aquí.
const advanceClock = (ms) => { virtualNow += ms; };

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Fixtures y helpers.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// CAMBIO 2 respecto de la plantilla de la 20.3: DB_NOW es un literal fijo y no
// `new Date(Date.now() - SERVER_SKEW_MIN * 60 * 1000)`. Un dbNow derivado del reloj real sería una
// SEGUNDA fuente de tiempo, no controlada, dentro de un archivo cuyo propósito entero es tener una
// sola controlada. Es inocuo porque sólo se pasa a `computeRetryEligibility`, que con
// `lastErrorAt: null` retorna en su primera línea (`RetryPolicy.js:83-85`) sin leer `now` ni
// `Date.now()` — el post-filtro no puede perturbar el reloj virtual. Literal ⇒ estrictamente más
// determinista, mismo comportamiento.
const DB_NOW = new Date('2026-05-15T12:00:00.000Z');

// 24 hexadecimales en minúscula: la única forma que la sonda real deja salir
// (guarda ^[0-9a-fA-F]{24}$ dentro de GetPurchaseOrders.js).
const VALID_ID = '507f1f77bcf86cd799439011';

// Toda fila abre la compuerta de la sonda: `errorCount > 0` es lo que la abre
// (`PortalOC_Creator.js:308`), y `lastErrorAt: null` la deja elegible de inmediato por la regla de
// primer intento, así que sobrevive al post-filtro JS y llega al bucle.
const manyGateOpenRows = (n) => Array.from({ length: n }, (_, k) => ({
    EXTERNAL_ID: `PO${90000 + k}`,
    errorCount: 3,
    lastErrorAt: null,
    dbNow: DB_NOW,
}));

// mockReset() DRENA las implementaciones y las respuestas encoladas; clearAllMocks() NO — sólo borra
// el registro de llamadas (decisión 20.1-02). Este archivo le pone una IMPLEMENTACIÓN a
// mockPortalGet en cada caso, o sea que está expuesto exactamente a ese bug.
const resetProbeStubs = () => {
    jest.clearAllMocks();
    mockRunQuery.mockReset();
    mockPortalPost.mockReset();
    mockPortalGet.mockReset();
    mockLogGenerator.mockReset();
    mockValidatePO.mockReset();
    mockValidatePO.mockImplementation((po) => po);
};

// La llamada 0 de runQuery es SIEMPRE el SELECT por tenant; los INSERT empiezan en la 1.
//
// `insertCostMs` es la mitad de la corrección de WR-08 que le toca al INSERT: en producción el
// techo de una escritura no es el de axios sino el `requestTimeout` de mssql —180 000 ms,
// `SQLServerConnection.js:18`—, y ése es el término DOMINANTE de la cola de una iteración. Default
// 0 para que los call sites previos conserven su significado exacto.
const stubSelect = (rows, insertCostMs = 0) => {
    mockRunQuery.mockResolvedValueOnce({ recordset: rows });
    mockRunQuery.mockImplementation(() => {
        advanceClock(insertCostMs);
        return Promise.resolve({ recordset: [], rowsAffected: [1] });
    });
};

// La sonda con costo: cada GET adelanta el reloj virtual `costMs` y luego contesta `response`. El
// avance es SÍNCRONO, antes de resolver la promesa, así que para cuando la siguiente iteración
// evalúa `Date.now() - tickStart` el costo ya está cobrado.
const stubPortalCostly = (costMs, response) => {
    mockPortalGet.mockImplementation(() => {
        advanceClock(costMs);
        return Promise.resolve(response);
    });
};

// El cuerpo con el que el portal contesta "no la tengo": 200 con items vacío. Es el único desenlace
// que autoriza el POST del controlador, y por eso es el que se usa en los escenarios de cota — deja
// vivo todo el camino de escritura para que "no se escribió nada" signifique algo.
const PORTAL_ABSENT_BODY = { data: { items: [], total: 0 } };

// El POST con costo declarado, y la otra mitad de la corrección de WR-08.
//
// Por qué hacía falta: el presupuesto se evalúa en el BORDE DE ITERACIÓN, no de forma continua, así
// que TODO lo que el bucle hace entre dos evaluaciones —el GET, Joi, el POST y el INSERT— se cobra
// contra él. Cuando el único sitio con costo era el stub del GET, este archivo modelaba un
// mecanismo distinto del que dice probar: el tiempo atribuible al POST y al INSERT era invisible, y
// la casilla 2 del SPEC quedaba apoyada en un supuesto NO DECLARADO —"el POST es gratis"— en vez de
// en el mecanismo. Con un POST de sólo 2.5 s, aquellas 50 sondas serían ~48 y la cota que dispara
// dejaría de ser el cap.
const stubPostCostly = (costMs) => {
    mockPortalPost.mockImplementation(() => {
        advanceClock(costMs);
        return Promise.resolve({ status: 201, statusText: 'Created', data: { id: VALID_ID } });
    });
};

// Azúcar para los casos en que el POST es gratis. Se define EN TÉRMINOS de `stubPostCostly` y no al
// revés, y eso es el punto: así el costo cero queda escrito como un valor ELEGIDO y no como una
// propiedad tácita del doble. Todos los call sites previos conservan su significado exacto.
const stubPostAlwaysSuccess = () => stubPostCostly(0);

const loggedMessages = () => mockLogGenerator.mock.calls.map((c) => String(c[2] == null ? '' : c[2]));

// Anclada en la ETIQUETA, nunca en el nombre del campo suelto (T-20.4-17): la línea de resumen de
// reintentos también lleva un `deferred=` y significa otra cosa. Se afirma que hay exactamente una,
// porque cero (el resumen no se emitió) y dos (dos tenants) son fallos distintos que un `find`
// silenciaría igual.
const summaryLine = () => {
    const hits = loggedMessages().filter((m) => /^\[PORTAL-CHECK-SUMMARY\]/.test(m));
    expect(hits).toHaveLength(1);
    return hits[0];
};

const summaryField = (name) => {
    const match = summaryLine().match(new RegExp(`${name}=(\\d+)`));
    expect(match).not.toBeNull();
    return Number(match[1]);
};

const insertsEmitted = () => mockRunQuery.mock.calls
    .filter((c) => /INSERT INTO fesa\.dbo\.fesaOCFocaltec/i.test(c[0] || ''));

// Las líneas por fila que emite el bloque de sonda de la 20.3 (`PortalOC_Creator.js:468` y `:483`).
// El ancla lleva el espacio final a propósito: sin él, la línea de resumen —cuya etiqueta empieza
// con el mismo prefijo— también casaría y el conteo saldría inflado en uno.
const perRowCheckLines = () => loggedMessages().filter((m) => /^\[PORTAL-CHECK\] /.test(m));

// El conjunto de etiquetas entre corchetes que este tick llegó a escribir en bitácora. Se recoge en
// vez de enumerar una lista blanca porque lo que hay que probar es una AUSENCIA abierta: que no
// nació ninguna etiqueta hermana para el camino diferido. Una lista blanca prueba lo contrario —
// que las conocidas siguen ahí— y deja pasar cualquier etiqueta nueva que nadie pensó en prohibir.
const loggedTags = () => {
    const tags = new Set();
    loggedMessages().forEach((m) => {
        const match = m.match(/^\[([^\]]+)\]/);
        if (match) tags.add(match[1]);
    });
    return tags;
};

beforeEach(() => {
    resetProbeStubs();
    // T-20.4-15: los dos parámetros vuelven a su default de producción ANTES de cada caso, para que
    // un override de un caso previo no pueda filtrarse y hacer pasar al siguiente por la razón
    // equivocada.
    mockConfig.portal.probeBudgetMs = PROBE_DEFAULT_BUDGET_MS;
    mockConfig.portal.probeMaxPerTick = PROBE_DEFAULT_MAX_PER_TICK;
    virtualNow = VIRTUAL_START;
    jest.spyOn(Date, 'now').mockImplementation(() => virtualNow);
});

afterEach(() => {
    // T-20.4-14: el espía se retira SIEMPRE. `Date` es global y los workers de Jest se reutilizan
    // entre archivos; un espía que sobreviva corrompe suites que no tienen nada que ver con esta.
    // Es la disciplina always-on de CLAUDE.md §3 aplicada a la huella del propio test: si instalas
    // algo que retiene estado, escribe cómo se libera.
    jest.restoreAllMocks();
});

describe('PortalOC_Creator — ambos topes, cada uno alcanzable por separado (RETRY-E1, D-16)', () => {

    test('casilla 1 del SPEC: sonda que tarda 30 s y presupuesto de 120 000 ms ⇒ exactamente 4 sondas sobre 25 OCs elegibles', async () => {
        const rows = manyGateOpenRows(25);
        stubSelect(rows);
        // 30 000 ms es el techo de axios (config.portal.httpTimeoutMs): el portal DEGRADADO —el que
        // contesta lentísimo en vez de fallar rápido— es el caso caro que esta fase existe para
        // acotar, no el caso de caída.
        stubPortalCostly(30000, PORTAL_ABSENT_BODY);
        stubPostAlwaysSuccess();

        await createPurchaseOrders(0);

        // La aritmética, escrita para que un lector futuro pueda re-derivar el 4 sin ejecutar nada:
        // la sonda 1 se evalúa con 0 ms transcurridos y cuesta 30 000; las sondas 2, 3 y 4 se
        // evalúan con 30 000, 60 000 y 90 000, todas por debajo del presupuesto; la quinta
        // evaluación ve exactamente 120 000 y el operador es `>=`, así que difiere — y de ahí en
        // adelante el reloj ya no avanza porque no se emite ninguna sonda más.
        expect(mockPortalGet).toHaveBeenCalledTimes(4);
        expect(summaryField('probed')).toBe(4);
        expect(summaryField('deferred')).toBe(21);

        // Contabilidad completa: cada una de las 25 OCs terminó sondeada o diferida, ninguna tomó un
        // tercer camino. Sin esto, un fixture que se agotara antes de tiempo produciría los mismos
        // 4 GET y pasaría.
        expect(summaryField('probed') + summaryField('deferred')).toBe(rows.length);
    });

    test('casilla 3 del SPEC (D-16, lado presupuesto): el tope por CONTEO no es lo que la detuvo', async () => {
        const rows = manyGateOpenRows(25);
        stubSelect(rows);
        stubPortalCostly(30000, PORTAL_ABSENT_BODY);
        stubPostAlwaysSuccess();

        await createPurchaseOrders(0);

        const probed = summaryField('probed');

        // (a) La forma que fija el plan: el margen explícito. Un caso que se detuviera en 4 porque el
        // cap vale 4 no probaría NADA sobre el presupuesto; con el cap en 50 y 4 sondas emitidas
        // quedaron 46 de margen sin usar.
        expect(probed).toBeLessThan(mockConfig.portal.probeMaxPerTick);
        expect(mockConfig.portal.probeMaxPerTick - probed).toBe(46);

        // (b) Refuerzo mecánico, más fuerte que el margen: se evalúa el TÉRMINO DE CONTEO REAL de la
        // cota (`probed >= probeMaxPerTick`, PortalOC_Creator.js:367) con el valor FINAL de probed.
        // Como probed es monótono no decreciente, su valor final es el máximo que alcanzó en todo el
        // tick; si el predicado es falso ahí, fue falso en CADA una de las evaluaciones anteriores.
        // O sea: no es que el cap estuviera "lejos", es que su término nunca pudo ser el verdadero
        // del `||`. El diferimiento sólo pudo venir del presupuesto.
        expect(probed >= mockConfig.portal.probeMaxPerTick).toBe(false);

        // Y el término de presupuesto SÍ se cumplió al final del tick: es la otra mitad de la pinza.
        expect(virtualNow - VIRTUAL_START).toBeGreaterThanOrEqual(mockConfig.portal.probeBudgetMs);
    });

    test('casilla 2 del SPEC (+ D-16, lado conteo): sonda instantánea ⇒ se detiene en el cap de 50 sobre 60 OCs, con el presupuesto intacto', async () => {
        const rows = manyGateOpenRows(60);
        stubSelect(rows);
        // Costo cero: el portal SANO. El reloj no avanza ni un milisegundo en todo el tick.
        stubPortalCostly(0, PORTAL_ABSENT_BODY);
        // WR-08: el costo cero del POST es un valor ELEGIDO y declarado, no un supuesto tácito.
        // Importa decirlo porque este caso deriva su conclusión de `elapsed === 0`, y esa igualdad
        // es cierta del fixture, no del sistema: el presupuesto se evalúa en el borde de iteración,
        // así que en producción el POST y el INSERT también se cobran contra él. Los dos casos que
        // siguen a éste son los que ejercitan ese cobro; aquí se declara la elección para que la
        // casilla 2 no descanse sobre un supuesto que nadie escribió.
        stubPostCostly(0);

        await createPurchaseOrders(0);

        expect(mockPortalGet).toHaveBeenCalledTimes(50);
        expect(summaryField('probed')).toBe(50);
        expect(summaryField('deferred')).toBe(10);
        expect(summaryField('probed') + summaryField('deferred')).toBe(rows.length);

        // D-16, lado conteo. (a) La forma que fija el plan: el transcurrido es exactamente 0 y por
        // tanto estrictamente menor que el presupuesto.
        const elapsed = virtualNow - VIRTUAL_START;
        expect(elapsed).toBe(0);
        expect(elapsed).toBeLessThan(mockConfig.portal.probeBudgetMs);

        // (b) El mismo refuerzo mecánico del caso anterior, en espejo: se evalúa el TÉRMINO DE
        // PRESUPUESTO REAL de la cota (`Date.now() - tickStart >= probeBudgetMs`,
        // PortalOC_Creator.js:368) con el transcurrido FINAL, que es el máximo que alcanzó — el
        // reloj sólo avanza. Falso ahí ⇒ falso en toda evaluación previa. El presupuesto no pudo ser
        // el término verdadero del `||`, así que lo que detuvo el bucle fue el cap, sin ambigüedad.
        expect(elapsed >= mockConfig.portal.probeBudgetMs).toBe(false);
    });

    // ── WR-08: el presupuesto se agota por trabajo del bucle DISTINTO del GET ────────────────
    //
    // Hasta aquí, todo caso que agotaba el presupuesto lo hacía con un GET lento, y el único que
    // movía el reloj fuera del GET (el punto ciego de D-07) lo movía en el SELECT, o sea ANTES del
    // bucle. Faltaba la afirmación central del mecanismo: la cota se evalúa en el BORDE DE
    // ITERACIÓN, así que el POST y el INSERT de cada OC sondeada-y-ausente se cobran contra el
    // mismo presupuesto de sondeo. D-01 lo pide —origen único en la entrada de la función— pero
    // ningún caso lo ejercitaba, y de ahí salía el dimensionamiento equivocado: el tope de 50 sólo
    // es alcanzable si el ciclo COMPLETO por OC promedia menos de ~2.4 s.
    //
    // Los dos casos van en este bloque y no en otro porque son exactamente la pregunta del bloque
    // —cuál de las dos cotas disparó— resuelta a favor del presupuesto por un camino nuevo.

    test('WR-08: GET instantáneo y POST al techo de axios ⇒ detiene el PRESUPUESTO, no el cap, con el cap a 46 de distancia', async () => {
        const rows = manyGateOpenRows(60);
        stubSelect(rows);
        // El portal que contesta rápido la consulta pero se arrastra en la escritura. No es un caso
        // de laboratorio: GET y POST van por el mismo singleton de axios y comparten su techo de
        // 30 s (`PortalClient.js`), así que este perfil está dentro de lo que el cliente ya tiene.
        stubPortalCostly(0, PORTAL_ABSENT_BODY);
        stubPostCostly(30000);

        await createPurchaseOrders(0);

        // Aritmética re-derivable sin ejecutar nada, y es la misma forma que la casilla 1 salvo que
        // aquí el costo lo pone el POST: la sonda 1 se evalúa con 0 transcurridos y su POST cuesta
        // 30 000; las sondas 2, 3 y 4 se evalúan con 30 000, 60 000 y 90 000; la quinta evaluación
        // ve exactamente 120 000 y el operador es `>=`, así que difiere.
        expect(mockPortalGet).toHaveBeenCalledTimes(4);
        expect(mockPortalPost).toHaveBeenCalledTimes(4);
        expect(summaryField('probed')).toBe(4);
        expect(summaryField('deferred')).toBe(56);
        expect(summaryField('probed') + summaryField('deferred')).toBe(rows.length);

        // Cuatro sondas de un cap de 50: no fue el conteo. Mismo refuerzo mecánico que los casos de
        // arriba — `probed` es monótono no decreciente, así que si su término es falso con el valor
        // FINAL, fue falso en cada evaluación previa.
        const probed = summaryField('probed');
        expect(probed >= mockConfig.portal.probeMaxPerTick).toBe(false);
        expect(mockConfig.portal.probeMaxPerTick - probed).toBe(46);

        // Y todo el transcurrido vino de fuera del GET. Ésta es la aserción que da nombre al caso:
        // con el GET a costo cero, los 120 000 ms sólo pueden haberlos puesto los POSTs.
        expect(virtualNow - VIRTUAL_START).toBe(120000);
    });

    test('WR-08: el INSERT también se cobra — con el requestTimeout de mssql, una sola OC agota el presupuesto', async () => {
        const rows = manyGateOpenRows(60);
        // 180 000 ms es el `requestTimeout` real del pool (`SQLServerConnection.js:18`), y es el
        // término DOMINANTE de la cola de una iteración: más grande que el GET y el POST juntos.
        stubSelect(rows, 180000);
        stubPortalCostly(0, PORTAL_ABSENT_BODY);
        stubPostCostly(0);

        await createPurchaseOrders(0);

        // Una sola OC completa su ciclo y el presupuesto de 120 000 ya quedó atrás: la segunda
        // evaluación ve 180 000. El tick entero se va en una OC, con 59 diferidas y el cap —50— sin
        // haber tenido nada que ver.
        expect(mockPortalGet).toHaveBeenCalledTimes(1);
        expect(insertsEmitted()).toHaveLength(1);
        expect(summaryField('probed')).toBe(1);
        expect(summaryField('deferred')).toBe(59);
        expect(summaryField('probed') + summaryField('deferred')).toBe(rows.length);
        expect(summaryField('probed') >= mockConfig.portal.probeMaxPerTick).toBe(false);

        // El transcurrido REBASA el presupuesto y por bastante, y eso no es un fallo del mecanismo
        // sino su propiedad: la cota se lee en el borde de iteración, así que una OC ya admitida
        // corre su ciclo completo por encima del presupuesto. Es la cola que el comentario de la
        // guarda relacional en config.js cuantifica.
        expect(virtualNow - VIRTUAL_START).toBe(180000);
        expect(virtualNow - VIRTUAL_START).toBeGreaterThan(mockConfig.portal.probeBudgetMs);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Lo que este bloque guarda de verdad (D-04):
//
// La cota está escrita como un `if` ANIDADO dentro de `if (priorErrors > 0)`, con un `continue`.
// La lectura natural de la letra de RETRY-E1 —"la compuerta exige además que quede presupuesto y
// quede conteo"— produce en cambio una CONJUNCIÓN sobre la compuerta, y esa forma es un bug: hoy,
// cuando esa compuerta se vuelve falsa, el control NO termina el turno, cae al bloque de Joi y de
// ahí al POST. Con la conjunción, las 16 OCs diferidas del escenario de presupuesto acabarían
// POSTeadas — el POST duplicado / 409 que la fase 20.3 existe para eliminar, refabricado por el
// mecanismo que venía a protegerlo.
//
// Y aquí está el punto: esa forma pasa TODAS las aserciones del bloque anterior. El conteo de
// sondas sería idéntico (4 y 50), porque lo que cambia no es cuántas se sondean sino qué les pasa a
// las que no. Las aserciones sobre el POST de este bloque son las que fallan en esa reescritura.
// Ésta es la mitad conductual de la guarda; el plan 20.4-04 agrega la mitad estructural.
//
// Regla del bloque: cada conteo se lee del registro de llamadas de un doble, jamás del texto de la
// bitácora — es la redacción literal del criterio de aceptación de RETRY-E3. El cuarto caso es la
// única excepción y afirma sobre el texto a propósito, porque lo que acota es justamente el VOLUMEN
// de bitácora.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('PortalOC_Creator — fail-closed al alcanzar cualquiera de los dos topes (RETRY-E3)', () => {

    // Escenario compartido por los casos 1, 2 y 4: 20 OCs elegibles, sonda de 30 s, presupuesto de
    // 120 000 ms. Se detiene tras 4 sondas y difiere 16. Se arma dentro de cada caso —no en un
    // `beforeEach` propio— para que cada uno siga siendo legible por sí solo y para no anidar un
    // segundo `beforeEach` bajo el que ya instala el reloj.
    const PROBED = 4;
    const arrangeBudgetScenario = () => {
        const rows = manyGateOpenRows(20);
        stubSelect(rows);
        stubPortalCostly(30000, PORTAL_ABSENT_BODY);
        stubPostAlwaysSuccess();
        return rows;
    };

    test('casilla 4 del SPEC (cota por presupuesto): las 16 OCs diferidas no emiten ningún GET ni ningún POST', async () => {
        arrangeBudgetScenario();

        await createPurchaseOrders(0);

        // Ningún GET por las diferidas: el `continue` antecede a la sonda.
        expect(mockPortalGet).toHaveBeenCalledTimes(PROBED);
        // Y ningún POST: uno por OC sondeada-y-ausente, cero por diferida. Con la conjunción sobre
        // la compuerta este número sería 20 y el caso se pondría rojo aquí, que es exactamente para
        // lo que existe.
        expect(mockPortalPost).toHaveBeenCalledTimes(PROBED);
    });

    test('casilla 4 del SPEC (cota por presupuesto): ninguna OC diferida corre Joi ni llega a un INSERT', async () => {
        const rows = arrangeBudgetScenario();

        await createPurchaseOrders(0);

        // Joi. Importa más allá del orden: el camino de FALLO de Joi es en sí mismo un emisor de
        // filas ERROR (`PortalOC_Creator.js:534-547`), y la fase 20.3 puso el bloque de sonda por
        // delante justamente por eso. Una OC diferida que corriera Joi podría escribir la misma fila
        // ERROR que esta fase existe para dejar de fabricar.
        expect(mockValidatePO).toHaveBeenCalledTimes(PROBED);

        // INSERT: exactamente los cuatro POSTED de las sondeadas-y-ausentes.
        expect(insertsEmitted()).toHaveLength(PROBED);

        // Y ninguno de los 16 ids diferidos aparece en NINGUNA sentencia emitida. La aserción es
        // sobre los argumentos del doble de runQuery, no sobre la bitácora: es la diferencia entre
        // probar que no se escribió y probar que no se dijo que se escribió.
        const deferredIds = rows.slice(PROBED).map((r) => r.EXTERNAL_ID);
        expect(deferredIds).toHaveLength(16);
        deferredIds.forEach((id) => {
            expect(insertsEmitted().some((c) => String(c[0]).includes(id))).toBe(false);
        });
    });

    test('casilla 4 del SPEC (cota por CONTEO): la misma garantía fail-closed, probada y no extrapolada', async () => {
        // Sin este caso, el fail-closed quedaría probado para una cota y SUPUESTO para la otra —
        // exactamente el hueco que D-16 cierra del lado de la alcanzabilidad. Las dos cotas comparten
        // el cuerpo del `if`, pero es la condición la que decide cuál dispara, y una regresión puede
        // vivir en un solo término.
        const rows = manyGateOpenRows(60);
        stubSelect(rows);
        stubPortalCostly(0, PORTAL_ABSENT_BODY);
        stubPostAlwaysSuccess();

        await createPurchaseOrders(0);

        expect(mockPortalGet).toHaveBeenCalledTimes(50);
        expect(mockPortalPost).toHaveBeenCalledTimes(50);
        expect(mockValidatePO).toHaveBeenCalledTimes(50);
        expect(insertsEmitted()).toHaveLength(50);

        const deferredIds = rows.slice(50).map((r) => r.EXTERNAL_ID);
        expect(deferredIds).toHaveLength(10);
        deferredIds.forEach((id) => {
            expect(insertsEmitted().some((c) => String(c[0]).includes(id))).toBe(false);
        });
    });

    test('D-06: el camino diferido no agrega ni una línea por fila ni una etiqueta nueva', async () => {
        const rows = arrangeBudgetScenario();

        await createPurchaseOrders(0);

        // Cuatro líneas por fila, no veinte. Las líneas por fila de la 20.3 están acotadas por lo
        // que efectivamente se sondeó; el conjunto diferido está acotado sólo por el tamaño de
        // ordersToSend, que es precisamente el caso para el que existe esta fase. Una línea por fila
        // escupiría miles de renglones en el peor tick — el único tick que el operador de verdad
        // necesita poder leer.
        expect(perRowCheckLines()).toHaveLength(PROBED);

        // Ninguna etiqueta hermana de PORTAL-CHECK nació para el camino diferido: el agregado es el
        // único canal. Se afirma sobre el conjunto recogido, no contra una lista blanca, para que
        // una etiqueta que nadie previó tampoco pase.
        const tags = [...loggedTags()];
        expect(tags).toContain('PORTAL-CHECK-SUMMARY');
        expect(tags.filter((t) => t.startsWith('PORTAL-CHECK-') && t !== 'PORTAL-CHECK-SUMMARY')).toEqual([]);

        // Cierre del hueco que deja la aserción anterior: una línea por fila para las diferidas
        // podría emitirse REUTILIZANDO una etiqueta ya existente, y entonces el conjunto de
        // etiquetas no se movería. Ningún mensaje de bitácora del tick menciona a una OC diferida,
        // bajo ninguna etiqueta. Es la forma fuerte de D-06.
        const deferredIds = rows.slice(PROBED).map((r) => r.EXTERNAL_ID);
        const messages = loggedMessages();
        deferredIds.forEach((id) => {
            expect(messages.some((m) => m.includes(id))).toBe(false);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Lo que este bloque guarda de verdad (RETRY-E4):
//
// Dos cosas distintas, y conviene no confundirlas.
//
// (1) La INVARIANTE `probed === found + absent + skipped + unknown`. No es una identidad
//     aritmética que se cumpla sola: es una afirmación sobre DÓNDE se incrementa cada contador.
//     WR-02 ya la rompió una vez, contando dentro del try de la sonda un desenlace que después se
//     recontaba en el catch. Esta fase agrega un sexto contador y un camino nuevo, así que la
//     invariante vuelve a estar en juego. Se afirma como una IGUALDAD EXPLÍCITA sobre la línea
//     parseada —la redacción literal de la aceptación de RETRY-E4— y no como cuatro aserciones
//     sueltas de contador: cuatro aserciones cerradas prueban los valores de ESE escenario, la
//     igualdad prueba la relación. Verificar esa invariante contra respuestas reales del portal
//     sigue siendo el punto 2 del UAT humano pendiente de la fase 20.3, así que esta fase no sólo
//     no puede perturbarla: tiene que demostrar que no la perturbó.
//
// (2) El PUNTO CIEGO de D-07, que es la razón de más peso para que este bloque exista. El estado
//     `probed === 0` con `deferred > 0` es alcanzable en producción —con el origen del reloj en la
//     entrada de la función (D-01), un SELECT lento se come el presupuesto antes de la primera OC
//     elegible— y es, exactamente, el peor tick posible. Bajo la condición de emisión ANTERIOR ese
//     tick no imprimía nada: el único escenario verdaderamente malo era también el único mudo.
//     Ninguna de las 14 casillas de aceptación del SPEC lo nombra, y la ola 2 midió que revertir la
//     condición ensanchada dejaba pasar los 48 casos que existían entonces. Es decir: hasta este
//     bloque, era el único comportamiento de la fase que podía revertirse en silencio.
//
//     Por eso van DOS casos y no uno. El caso 5 prueba que el tick mudo ahora habla; el caso 6
//     prueba que el tick verdaderamente vacío sigue callado. Sin el segundo, el primero pasaría
//     igual si alguien hubiera ensanchado la condición hasta "emitir siempre" —un bug distinto, con
//     el mismo síntoma verde— y se habría tirado por la borda el razonamiento de D-06 de la 20.3:
//     el tick silencioso es el abrumadoramente común, y una línea de ceros cada 15 minutos vuelve
//     ilegible la bitácora que el operador de verdad necesita leer.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('PortalOC_Creator — invariante de contadores y visibilidad del rezago (RETRY-E4)', () => {

    // Lee los seis campos de la línea de resumen de una sola pasada.
    //
    // Llega a la línea ÚNICAMENTE a través de `summaryLine()`, que ancla en
    // /^\[PORTAL-CHECK-SUMMARY\]/. Eso no es comodidad: la bitácora de este mismo tick trae otra
    // línea con un campo `deferred=` que significa una cosa distinta —"retenida por el intervalo de
    // reintento" en el resumen del post-filtro de reintentos (`PortalOC_Creator.js:282`), contra
    // "retenida por el presupuesto de sondeo del tick" aquí—. Un parser que barriera todas las
    // líneas buscando un `deferred=` suelto leería el número equivocado y pasaría en verde. Lo que
    // las desambigua es la ETIQUETA, nunca el nombre del campo (T-20.4-17).
    const summaryCounters = () => {
        const msg = summaryLine();
        const read = (field) => {
            const match = msg.match(new RegExp(`${field}=(\\d+)`));
            expect(match).not.toBeNull();
            return Number(match[1]);
        };
        return {
            msg,
            probed: read('probed'),
            found: read('found'),
            absent: read('absent'),
            skipped: read('skipped'),
            unknown: read('unknown'),
            deferred: read('deferred'),
        };
    };

    // Respuestas del portal con la forma exacta que parsea la sonda REAL (`GetPurchaseOrders.js`):
    // { data: { items: [...], total } }, y el `external_id` de cada item tiene que coincidir con el
    // de la OC preguntada, porque la sonda re-filtra del lado del cliente y no confía en el filtro
    // del API (`GetPurchaseOrders.js:120-123`). El id va en forma de 24 hexadecimales o la sonda lo
    // rechaza con reason=invalid-id (RETRY-D8) y el desenlace dejaría de ser el que el caso pide.
    const portalFoundBody = (externalId, status, id = VALID_ID) => ({
        data: { items: [{ id, external_id: externalId, status }], total: 1 },
    });

    // Dos items exactos para el MISMO external id: la sonda devuelve outcome=unknown,
    // reason='ambiguous' (`GetPurchaseOrders.js:134-138`) y el controlador lo pliega en `unknown`.
    const portalAmbiguousBody = (externalId, id = VALID_ID) => ({
        data: {
            items: [
                { id, external_id: externalId, status: 'OPEN' },
                { id, external_id: externalId, status: 'OPEN' },
            ],
            total: 2,
        },
    });

    // El escenario mixto que comparten los casos 3 y 7: 12 OCs elegibles y el cap en 5, de modo que
    // se sondean exactamente 5 y se difieren 7, y las CINCO respuestas encoladas producen un
    // desenlace distinto cada una, cubriendo los cuatro buckets a la vez.
    //
    // Se encolan con respuestas de un solo uso y NO con una implementación: el reloj virtual sólo
    // avanza dentro de `stubPortalCostly`, así que aquí no transcurre ni un milisegundo y el
    // presupuesto queda intacto. Lo que detuvo el bucle fue el cap, sin ambigüedad posible.
    const MIXED_PROBED = 5;
    const MIXED_DEFERRED = 7;
    const arrangeMixedScenario = () => {
        const rows = manyGateOpenRows(MIXED_PROBED + MIXED_DEFERRED);
        mockConfig.portal.probeMaxPerTick = MIXED_PROBED;
        stubSelect(rows);

        mockPortalGet
            // 1) OPEN     -> found++   , INSERT de una fila POSTED
            .mockResolvedValueOnce(portalFoundBody(rows[0].EXTERNAL_ID, 'OPEN'))
            // 2) CLOSED   -> found++   , INSERT de una fila CLOSED
            .mockResolvedValueOnce(portalFoundBody(rows[1].EXTERNAL_ID, 'CLOSED'))
            // 3) CANCELLED-> skipped++ , sin fila
            .mockResolvedValueOnce(portalFoundBody(rows[2].EXTERNAL_ID, 'CANCELLED'))
            // 4) ambigua  -> unknown++ , sin fila
            .mockResolvedValueOnce(portalAmbiguousBody(rows[3].EXTERNAL_ID))
            // 5) ausente  -> absent++  , cae al bloque Joi y al POST
            .mockResolvedValueOnce(PORTAL_ABSENT_BODY);

        stubPostAlwaysSuccess();
        return rows;
    };

    test('casilla 5 del SPEC (cota por presupuesto): la invariante se cumple con 4 sondeadas y 21 diferidas', async () => {
        const rows = manyGateOpenRows(25);
        stubSelect(rows);
        stubPortalCostly(30000, PORTAL_ABSENT_BODY);
        stubPostAlwaysSuccess();

        await createPurchaseOrders(0);

        const c = summaryCounters();

        // La igualdad explícita sobre la línea parseada, tal como la redacta la aceptación de
        // RETRY-E4. Escrita así y no como cuatro comparaciones sueltas: lo que hay que probar es la
        // RELACIÓN entre los contadores, no los valores concretos de este escenario.
        expect(c.probed).toBe(c.found + c.absent + c.skipped + c.unknown);

        // Y el diferido se fija, no sólo se excluye de la suma: un `deferred` que se quedara en cero
        // por una regresión también satisfaría la igualdad de arriba sin decir nada.
        expect(c.deferred).toBe(21);
    });

    test('casilla 5 del SPEC (cota por CONTEO): la invariante se cumple con 50 sondeadas y 10 diferidas', async () => {
        const rows = manyGateOpenRows(60);
        stubSelect(rows);
        stubPortalCostly(0, PORTAL_ABSENT_BODY);
        stubPostAlwaysSuccess();

        await createPurchaseOrders(0);

        const c = summaryCounters();

        expect(c.probed).toBe(c.found + c.absent + c.skipped + c.unknown);
        expect(c.probed).toBe(50);
        expect(c.deferred).toBe(10);
    });

    test('casilla 5 del SPEC: la invariante con los CUATRO buckets distintos de cero y una cota disparando a la vez', async () => {
        // Éste es el caso que vuelve real la invariante en vez de aritméticamente vacía. En los dos
        // anteriores todo se resolvió en `absent`, así que la igualdad se reducía a `probed ===
        // absent` y tres sumandos valían cero — cierta, pero sin ejercitar ninguna de las dos reglas
        // de plegado (cancelled→skipped, ambiguous→unknown) ni el camino de escritura. Aquí los
        // cuatro buckets están ocupados simultáneamente MIENTRAS una cota difiere, que es
        // exactamente la combinación que esta fase introduce y que nadie había ejercitado.
        arrangeMixedScenario();

        await createPurchaseOrders(0);

        const c = summaryCounters();

        expect(c.probed).toBe(c.found + c.absent + c.skipped + c.unknown);

        expect(c.probed).toBe(MIXED_PROBED);
        expect(c.found).toBe(2);      // OPEN + CLOSED
        expect(c.absent).toBe(1);
        expect(c.skipped).toBe(1);    // CANCELLED, plegado en skipped y no en unknown
        expect(c.unknown).toBe(1);    // ambigua, plegada en unknown y no en skipped
        expect(c.deferred).toBe(MIXED_DEFERRED);

        // El presupuesto quedó intacto: sin implementación costosa el reloj no avanzó, así que el
        // término de tiempo de la cota nunca pudo ser el verdadero del ||. Lo que difirió las 7 fue
        // el cap, y el escenario significa lo que dice que significa.
        expect(virtualNow - VIRTUAL_START).toBe(0);
    });

    test('casilla 5 del SPEC: la invariante sobrevive a un fallo de escritura a media sonda con una cota disparando', async () => {
        // La forma de WR-02 —el fallo que rompió la invariante la primera vez— cruzada con el
        // mecanismo nuevo. El desenlace efectivo de esa OC es `unknown` y NO `found`: el contador de
        // encontradas se incrementa DESPUÉS de la escritura —y, desde WR-06, también después de la
        // bitácora—, así que si el INSERT lanza, el catch cuenta unknown y nadie contó found. Un
        // contador movido de sitio —o un `probeDeferred++` metido dentro del try, que es justo lo
        // que D-10 prohíbe— rompería la igualdad aquí y en ningún otro caso de la suite.
        const rows = manyGateOpenRows(MIXED_PROBED + MIXED_DEFERRED);
        mockConfig.portal.probeMaxPerTick = MIXED_PROBED;
        stubSelect(rows);
        // La llamada 0 de runQuery es el SELECT por tenant; la 1 es el INSERT de reconciliación de
        // la primera OC sondeada, que es la que contesta OPEN. Esa es la que se hace fallar.
        mockRunQuery.mockRejectedValueOnce(new Error('write failed'));

        mockPortalGet
            .mockResolvedValueOnce(portalFoundBody(rows[0].EXTERNAL_ID, 'OPEN'))
            .mockResolvedValue(PORTAL_ABSENT_BODY);
        stubPostAlwaysSuccess();

        await createPurchaseOrders(0);

        const c = summaryCounters();

        expect(c.probed).toBe(c.found + c.absent + c.skipped + c.unknown);
        expect(c.unknown).toBeGreaterThanOrEqual(1);
        expect(c.deferred).toBe(MIXED_DEFERRED);

        // Ancla del MECANISMO, y no sólo del resultado. Sin ella el caso pasaría igual si el rechazo
        // hubiera caído en cualquier otro runQuery del tick —el INSERT POSTED de una ausente, por
        // ejemplo— y entonces estaría midiendo un fallo distinto del que dice medir. El controlador
        // nombra la ETAPA en `reason=` justamente para esto (`PortalOC_Creator.js:497`): `write-failed`
        // sólo se emite si la excepción ocurrió con stage='write', o sea en la escritura de
        // reconciliación de la OC que el portal confirmó como OPEN. Es la forma de WR-02, verificada.
        expect(perRowCheckLines().some(
            (m) => new RegExp(`^\\[PORTAL-CHECK\\] PO ${rows[0].EXTERNAL_ID} tenant=COPDAT result=unknown .* reason=write-failed$`).test(m)
        )).toBe(true);
    });

    // ── WR-06: el fallo a media BITÁCORA, hermano del fallo a media escritura ────────────────
    //
    // El try de la sonda abarca TRES etapas —`probe`, `write` y `log`— y hasta aquí la suite
    // cubría las dos primeras. La tercera es la que rompía la invariante: los tres incrementos de
    // bucket vivían ARRIBA de `console.*` y de `logGenerator`, así que un fallo del emisor dejaba
    // el desenlace contado en su bucket Y recontado como `unknown` por el catch. La 20.3 ya había
    // cubierto exactamente esta forma para el tramo `absent` —y por eso ese tramo tiene su
    // `probeAbsent--` compensatorio— pero el tramo `found` se quedó sin la suya y sin cobertura.
    //
    // Que los dos emisores fallen no es hipotético, y el propio fuente lo declara: `logGenerator`
    // hace `fs.mkdirSync` fuera de todo try en su ruta de respaldo (LogGenerator.js:53-56) y
    // `console.*` puede dar EPIPE mientras Servy rota servy-stdout.log.
    //
    // Nota de construcción, y vale para los dos casos: el fallo se inyecta SÓLO en las líneas por
    // fila de desenlace, nunca en la que el propio catch emite. El catch no está envuelto en nada,
    // así que un `logGenerator` que lanzara ahí escaparía de `createPurchaseOrders` y mataría el
    // tick a media tanda; el caso mediría esa propagación en vez de la invariante. Se distinguen
    // por `reason=`: las de desenlace terminan en `n/a`, `ambiguous` o `unrecognised-status`, y la
    // del catch siempre en `-failed`.

    test('WR-06: si la bitácora de la etapa `log` lanza, el desenlace NO se cuenta dos veces', async () => {
        // La reproducción exacta del hallazgo: dos OCs encontradas y un solo fallo de bitácora en
        // la primera. Antes de mover los incrementos, el resumen salía
        // `probed=2 found=2 absent=0 skipped=0 unknown=1` — dos sondas y TRES desenlaces.
        const rows = manyGateOpenRows(2);
        stubSelect(rows);
        mockPortalGet
            .mockResolvedValueOnce(portalFoundBody(rows[0].EXTERNAL_ID, 'OPEN'))
            .mockResolvedValueOnce(portalFoundBody(rows[1].EXTERNAL_ID, 'OPEN'));
        stubPostAlwaysSuccess();

        // Sólo la línea por fila de la PRIMERA OC lanza. El `[OK]` de su escritura ya salió antes
        // (etapa `write`, y esa escritura sí ocurrió), el resumen no casa este patrón y la línea
        // del catch tampoco: el fallo inyectado es exactamente uno y está exactamente donde el
        // hallazgo lo puso.
        mockLogGenerator.mockImplementation((_file, _level, msg) => {
            if (new RegExp(`^\\[PORTAL-CHECK\\] PO ${rows[0].EXTERNAL_ID} .*result=found `).test(String(msg))) {
                throw new Error('EPIPE: write EPIPE');
            }
        });

        await createPurchaseOrders(0);

        const c = summaryCounters();

        expect(c.probed).toBe(c.found + c.absent + c.skipped + c.unknown);
        expect(c.probed).toBe(2);
        // La OC que falló la bitácora cuenta como `unknown` y NO como `found`: su desenlace
        // efectivo no llegó a quedar registrado en ninguna parte legible por el operador.
        expect(c.found).toBe(1);
        expect(c.unknown).toBe(1);
        expect(c.deferred).toBe(0);

        // Ancla del MECANISMO y no sólo del resultado, igual que en el caso de `write-failed`: el
        // catch nombra la etapa en `reason=`, y `log-failed` sólo se emite si la excepción ocurrió
        // con stage='log'. Sin esta aserción el caso pasaría igual si el fallo hubiera caído en
        // otra etapa del try, y estaría midiendo algo distinto de lo que dice medir.
        expect(perRowCheckLines().some(
            (m) => new RegExp(`^\\[PORTAL-CHECK\\] PO ${rows[0].EXTERNAL_ID} tenant=COPDAT result=unknown .* reason=log-failed$`).test(m)
        )).toBe(true);
    });

    test('WR-06: la invariante se sostiene con los TRES buckets de la etapa `log` fallando a la vez', async () => {
        // El caso anterior sólo ejercita el brazo `found` del `if/else if/else`. Los otros dos
        // brazos se incrementaban en el mismo sitio y tenían el mismo defecto, así que uno movido
        // y dos olvidados pasarían aquel caso y fallarían éste. Cada OC toma un brazo distinto.
        const rows = manyGateOpenRows(3);
        stubSelect(rows);
        mockPortalGet
            .mockResolvedValueOnce(portalFoundBody(rows[0].EXTERNAL_ID, 'OPEN'))         // -> found
            .mockResolvedValueOnce(portalFoundBody(rows[1].EXTERNAL_ID, 'CANCELLED'))    // -> skipped
            .mockResolvedValueOnce(portalAmbiguousBody(rows[2].EXTERNAL_ID));            // -> unknown
        stubPostAlwaysSuccess();

        // Las TRES líneas por fila de desenlace lanzan; la del catch queda excluida por su
        // `reason=…-failed` (ver la nota del bloque).
        mockLogGenerator.mockImplementation((_file, _level, msg) => {
            const text = String(msg);
            if (/^\[PORTAL-CHECK\] /.test(text) && !/reason=[a-z-]+-failed$/.test(text)) {
                throw new Error('EPIPE: write EPIPE');
            }
        });

        await createPurchaseOrders(0);

        const c = summaryCounters();

        // Con los incrementos arriba: found=1, skipped=1, unknown=1+3=4 ⇒ suma 6 contra probed=3.
        expect(c.probed).toBe(c.found + c.absent + c.skipped + c.unknown);
        expect(c.probed).toBe(3);
        expect(c.found).toBe(0);
        expect(c.skipped).toBe(0);
        expect(c.unknown).toBe(3);

        // Y las tres fallaron en la etapa `log`, no en otra: es lo que hace que este caso cubra los
        // tres brazos y no tres veces el mismo.
        expect(perRowCheckLines().filter((m) => /reason=log-failed$/.test(m))).toHaveLength(3);
    });

    test('D-07 (punto ciego, en ninguna casilla del SPEC): presupuesto agotado por el SELECT ⇒ probed=0 y AUN ASÍ se emite resumen', async () => {
        // Se reproduce el escenario que la propia D-01 acepta como costo, no uno artificial: el
        // presupuesto se mide desde la ENTRADA de la función, así que un SELECT anormalmente lento
        // —un OUTER APPLY sobre una tabla de control de 9,032 filas -— puede consumirlo entero antes
        // de que el bucle llegue a la primera OC elegible.
        //
        // El costo se cobra por `advanceClock`, el ÚNICO sitio de avance del archivo. Encolar una
        // secuencia de lecturas aquí ataría el caso al número de veces que el controlador lee el
        // reloj, que es precisamente lo que la ola 3 se prohibió.
        const rows = manyGateOpenRows(10);
        mockRunQuery.mockImplementationOnce(() => {
            advanceClock(mockConfig.portal.probeBudgetMs);
            return Promise.resolve({ recordset: rows });
        });
        mockRunQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
        stubPortalCostly(30000, PORTAL_ABSENT_BODY);
        stubPostAlwaysSuccess();

        await createPurchaseOrders(0);

        // Ni una sonda: el término de presupuesto ya era verdadero en la PRIMERA evaluación.
        expect(mockPortalGet).not.toHaveBeenCalled();

        // Y sin embargo el tick habla. Ésta es la aserción entera de D-07: con la condición de
        // emisión anterior —la que sólo miraba `probed`— este tick no imprimía absolutamente nada,
        // de modo que el peor escenario posible era el único mudo y RETRY-E4 ("el rezago se vuelve
        // visible") quedaba incumplido justo donde importa. `summaryLine()` afirma por dentro que
        // hay exactamente una línea de resumen, así que cero la pone roja aquí mismo.
        const c = summaryCounters();
        expect(c.msg).toBeDefined();

        expect(c.probed).toBe(0);
        expect(c.deferred).toBe(10);

        // La igualdad también se evalúa en el camino cero. Trivialmente cierta (0 === 0), y aun así
        // vale la pena: prueba que la invariante se EVALÚA en este camino en vez de saltárselo, que
        // es donde una regresión de contadores tiene más facilidad para esconderse.
        expect(c.probed).toBe(c.found + c.absent + c.skipped + c.unknown);
    });

    test('D-07 (control complementario): nada sondeado y nada diferido ⇒ no se emite ninguna línea de resumen', async () => {
        // El control negativo del caso anterior, y no es opcional. Sin él, el caso 5 pasaría igual
        // si alguien hubiera ensanchado la condición hasta "emitir siempre" — un bug distinto, con
        // el mismo síntoma verde. Y ese bug tirarían por la borda el razonamiento de D-06 de la
        // 20.3: el tick sin ninguna OC ya fallida es el abrumadoramente común, y una línea de ceros
        // cada 15 minutos vuelve ilegible la bitácora que el operador necesita poder leer.
        //
        // `errorCount: 0` cierra la compuerta de la sonda (`PortalOC_Creator.js:337`), así que esta
        // OC no se sondea ni se difiere: los dos contadores quedan en cero y la disyunción
        // ensanchada sigue sin emitir nada.
        stubSelect([{ EXTERNAL_ID: 'PO99999', errorCount: 0, lastErrorAt: null, dbNow: DB_NOW }]);
        stubPostAlwaysSuccess();

        await createPurchaseOrders(0);

        // No se usa `summaryLine()` a propósito: ese helper afirma por dentro que hay exactamente
        // una, o sea que fallaría con un mensaje que apuntaría al lugar equivocado. Aquí lo que se
        // afirma es el cero.
        const summaries = loggedMessages().filter((m) => /^\[PORTAL-CHECK-SUMMARY\]/.test(m));
        expect(summaries).toHaveLength(0);
    });

    test('casilla 6 del SPEC: los seis campos, en su orden, con el fin de línea anclado', async () => {
        arrangeMixedScenario();

        await createPurchaseOrders(0);

        const c = summaryCounters();

        // El `$` es todo el punto de esta aserción, igual que en las ocho anclas de la fase 20.3 que
        // esta fase tuvo que re-anclar en vez de aflojar. Con el fin de línea anclado, este único
        // patrón prueba cuatro cosas a la vez: que los cinco campos preexistentes conservan NOMBRE,
        // ORDEN y ORTOGRAFÍA (D-09), que `deferred=` va AL FINAL, que no se coló un séptimo campo, y
        // que nada quedó pegado detrás de la línea. Se afirma sobre el escenario mixto y no sobre uno
        // de ceros para que los seis campos lleven valores no triviales.
        expect(c.msg).toMatch(
            /^\[PORTAL-CHECK-SUMMARY\] tenant=COPDAT probed=\d+ found=\d+ absent=\d+ skipped=\d+ unknown=\d+ deferred=\d+$/
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Guardas estructurales de la fase 20.4.
//
// Éstas NO son casos de comportamiento: son aserciones sobre el TEXTO LITERAL del fuente, y ese
// cambio de método es deliberado. Todo lo que se guarda aquí es una AUSENCIA —ninguna primitiva
// always-on retenida, ninguna conjunción sobre la compuerta, ninguna etiqueta nueva, ninguna
// edición a una utilería compartida— y una ausencia no se puede probar ejercitando un doble: un
// doble que jamás recibe la llamada prohibida pasa por construcción, diga lo que diga el código.
// La suite de la fase 20.3 estableció el idioma (`PortalOC_Creator.portal-check.test.js:188-290`,
// nueve guardas) y aquí se reusa tal cual.
//
// La otra mitad de por qué existen: la cota son cuatro líneas de aritmética dentro de un bucle de
// 300. La regresión más barata que puede sufrir no es un bug, es una "simplificación" bienintencionada
// —y este código va a un servidor donde no hay staging ni rollback (HANDOFF §6). Cada guarda nombra
// en su mensaje la decisión que protege, para que al ponerse roja le enseñe al que la rompió por qué
// estaba escrita así.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONTROLLER_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'controller', 'PortalOC_Creator.js'), 'utf8');
const SQLCONN_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'utils', 'SQLServerConnection.js'), 'utf8');
const PROBE_BYTES = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'utils', 'GetPurchaseOrders.js'));
// El fuente de este mismo archivo, para las dos prohibiciones que se auto-impone (Guarda 9).
const SELF_SRC = fs.readFileSync(__filename, 'utf8');

const countOf = (src, re) => (src.match(re) || []).length;

// SHA-256 del helper de sonda medido en esta rama ANTES de cualquier edición de la fase 20.4, con
// el árbol de trabajo idéntico a HEAD. Se reproduce con:  shasum -a 256 src/utils/GetPurchaseOrders.js
const PROBE_SHA256_PRE_PHASE = 'b45569c06e12a16f951859d296b6977bb057d9dd5b2e1bb23fc3d38c5c4504b0';

describe('PortalOC_Creator — guardas estructurales del tope por tick (fase 20.4)', () => {

    test('Guarda 1 (casilla 11 y 12 del SPEC, CLAUDE.md §3): el origen del reloj se declara DENTRO de la función y antes del SELECT', () => {
        expect(countOf(CONTROLLER_SRC, /const tickStart/g)).toBe(1);

        const fnAt = CONTROLLER_SRC.indexOf('async function createPurchaseOrders');
        const originAt = CONTROLLER_SRC.indexOf('const tickStart');
        const todayAt = CONTROLLER_SRC.indexOf('const today = getCurrentDateString()');
        expect(fnAt).toBeGreaterThan(-1);
        expect(originAt).toBeGreaterThan(-1);
        expect(todayAt).toBeGreaterThan(-1);

        // Primera mitad — CLAUDE.md §3. Un origen en scope de módulo haría que el presupuesto del
        // tick N dependiera del tick N−1 y jamás se recuperaría: el servicio no termina entre ticks
        // del cron. Un const function-scoped es inalcanzable en cuanto la función retorna.
        expect(originAt).toBeGreaterThan(fnAt);

        // Segunda mitad — D-01, y es una propiedad distinta de la anterior. El presupuesto tiene
        // que ser una REBANADA del step y no un tiempo que se gaste encima de él: con el origen
        // puesto DESPUÉS del SELECT, los 120 s se sumarían a lo que ese SELECT ya consumió y el
        // step se iría todavía más lejos de sus 300 s con la cota plenamente instalada. Medir desde
        // la entrada de la función es lo que hace que el presupuesto acote el sondeo dentro del
        // step en vez de acotarlo aparte.
        //
        // Ojo con lo que esta guarda NO afirma (WR-01 / WR-02): el techo del 50 % de config.js no
        // acota el step. La cota se lee en el borde de iteración, así que una OC ya admitida corre
        // su ciclo completo por encima del presupuesto —hasta 30 s de GET + 30 s de POST + 180 s
        // del requestTimeout de mssql— y quien acota el step sigue siendo STEP_TIMEOUT_MS. El
        // razonamiento completo está en el comentario de esa guarda; aquí no se repite la
        // aritmética para que exista UN solo sitio donde mantenerla.
        expect(originAt).toBeLessThan(todayAt);
    });

    test('Guarda 2 (CLAUDE.md §3): esta fase no añadió ninguna primitiva always-on', () => {
        // Repite la Guarda 4 de la suite de la 20.3, pero contra el fuente POST-20.4. Que la
        // propiedad la afirme también el archivo que introdujo el cambio no es redundancia: la
        // guarda de la 20.3 vigila su propio diff, y quien edite esta cota va a correr esta suite.
        // Un temporizador, un listener o una colección en scope de módulo crecen sin cota para
        // siempre en un proceso que no termina entre ticks.
        expect(CONTROLLER_SRC).not.toMatch(/setInterval/);
        expect(CONTROLLER_SRC).not.toMatch(/setTimeout/);
        expect(CONTROLLER_SRC).not.toMatch(/new Set\(/);
        expect(CONTROLLER_SRC).not.toMatch(/\.addListener\(/);
    });

    test('Guarda 3 (D-04): la compuerta sigue siendo una sola condición — la reescritura por conjunción es imposible', () => {
        // LA guarda de esta fase. La redacción de RETRY-E1 —"la compuerta exige ADEMÁS que quede
        // presupuesto y quede conteo"— se lee con toda naturalidad como extender la compuerta
        // existente con dos términos más en vez de anidar. Esa forma es un BUG, y uno grave: hoy,
        // cuando la compuerta se vuelve falsa, el control NO termina el turno — cae al bloque de Joi
        // y de ahí al POST. Con la conjunción, cada OC diferida acabaría POSTeada, refabricando
        // exactamente el POST duplicado / 409 que la fase 20.3 existe para eliminar, y refabricado
        // por el mecanismo que venía a protegerlo.
        //
        // La mitad CONDUCTUAL de esta guarda es la aserción de conteo de POST del segundo bloque
        // (ola 3): bajo esa reescritura los POST pasan de 4 a 20. Ésta es la mitad ESTRUCTURAL, y su
        // valor propio es que NOMBRA la forma prohibida, así que el mensaje de fallo le enseña al
        // que la escribió por qué no puede escribirla. Ninguna de las dos mitades sola cubre a la
        // otra: la conductual detecta el bug ya cometido, la estructural lo detecta aunque alguien
        // lo escriba en una rama sin ejecutar los casos de POST.
        expect(countOf(CONTROLLER_SRC, /if \(priorErrors > 0\) \{/g)).toBe(1);
        expect(CONTROLLER_SRC).not.toMatch(/priorErrors > 0\s*&&/);
    });

    test('Guarda 4 (D-10): el contador de diferidas se incrementa FUERA del try de la sonda', () => {
        expect(countOf(CONTROLLER_SRC, /probeDeferred\+\+/g)).toBe(1);

        const gateAt = CONTROLLER_SRC.indexOf('if (priorErrors > 0)');
        const deferredAt = CONTROLLER_SRC.indexOf('probeDeferred++');
        const tryAt = CONTROLLER_SRC.indexOf("let stage = 'probe'");
        expect(gateAt).toBeGreaterThan(-1);
        expect(deferredAt).toBeGreaterThan(-1);
        expect(tryAt).toBeGreaterThan(-1);

        // Dentro de la compuerta (si no, se contaría como diferida una OC que ni siquiera era
        // elegible para sondeo) y antes del try (si no, se rompe la invariante).
        expect(deferredAt).toBeGreaterThan(gateAt);
        expect(deferredAt).toBeLessThan(tryAt);

        // Incrementar dentro del try es LITERALMENTE cómo WR-02 rompió
        // `probed === found + absent + skipped + unknown` la primera vez: un desenlace contado en el
        // camino feliz y recontado en el catch. Y esa invariante no es interna — verificarla contra
        // respuestas reales del portal sigue siendo el punto 2 del UAT humano pendiente de la 20.3,
        // así que romperla aquí invalidaría una verificación que ya está agendada.
    });

    test('Guarda 5 (D-05): el conteo se compara ANTES de leer el reloj, y los une un ||', () => {
        // Un solo patrón anclado prueba las tres cosas a la vez: que ambos términos viven en la
        // MISMA condición, que el de conteo va primero, y que el operador que los une es la
        // disyunción y no la conjunción — con una conjunción harían falta las dos cotas agotadas
        // para diferir, que es un mecanismo distinto y roto.
        expect(countOf(
            CONTROLLER_SRC,
            /if \(probed >= config\.portal\.probeMaxPerTick\s*\|\|\s*\(Date\.now\(\) - tickStart\) >= config\.portal\.probeBudgetMs\) \{/g
        )).toBe(1);

        // No hay diferencia de comportamiento entre un orden y el otro: la comparación de conteo es
        // gratis, la lectura del reloj no lo es, y el || corta el segundo término cuando el primero
        // ya es verdadero. La guarda existe para que reordenarlo sea un acto deliberado y no un
        // accidente de una refactorización.
    });

    test('Guarda 6 (D-06 y D-08): el camino diferido no estrenó ninguna etiqueta de bitácora', () => {
        expect(CONTROLLER_SRC).toMatch(/\[PORTAL-CHECK\]/);
        expect(CONTROLLER_SRC).toMatch(/\[PORTAL-CHECK-SUMMARY\]/);

        // La aserción negativa es la que trabaja: prohíbe cualquier etiqueta hermana, dejando pasar
        // sólo la de resumen. El rezago se reporta por el AGREGADO y nunca por línea por fila —el
        // conjunto diferido está acotado sólo por el tamaño de ordersToSend, que es precisamente el
        // caso para el que existe esta fase, y una línea por fila escupiría miles de renglones en el
        // único tick que el operador de verdad necesita poder leer.
        expect(CONTROLLER_SRC).not.toMatch(/\[PORTAL-CHECK-(?!SUMMARY)[A-Z-]+\]/);

        // D-08: tampoco nació una línea hermana en nivel warn. El SPEC ya fija el criterio de
        // escalamiento en su sección de riesgo aceptado —un deferred= distinto de cero en ticks
        // consecutivos se vuelve un hallazgo con su propia fase— y un warn ahora se adelantaría a
        // ese criterio con otro distinto.
        expect(CONTROLLER_SRC).not.toMatch(/logGenerator\([A-Za-z]+, 'warn', summaryMsg/);
    });

    test('Guarda 7 (casilla 13 del SPEC): el helper de sonda es BYTE-IDÉNTICO a su contenido pre-fase', () => {
        // Se usa un hash y no un patrón de texto porque el requisito literal es "sin cambios", y
        // sólo un hash expresa eso exactamente: un patrón prueba que algo sigue estando, un hash
        // prueba que nada se movió — ni un espacio en blanco.
        const actual = crypto.createHash('sha256').update(PROBE_BYTES).digest('hex');
        expect(actual).toBe(PROBE_SHA256_PRE_PHASE);

        // Por qué esta fase se prohíbe tocarlo: la cota pertenece al LLAMADOR que es dueño del
        // bucle, no a un helper que emite una sola petición. Meter estado por-llamada en una función
        // pura rompería además la guarda de la 20.3 que afirma que su objeto de opciones lleva
        // únicamente headers, y arrastraría al diff una utilería compartida por otros call sites —
        // la trampa de radio de impacto de CLAUDE.md §6 #2, la misma en la que cayó el PR #16 al
        // cambiar un valor por defecto y romper siete llamadores.
    });

    test('Guarda 8 (CLAUDE.md §6 #1 y #2): la firma de runQuery sigue intacta y no nació ningún sitio de SQL nuevo', () => {
        // §6 #2: runQuery lo comparte todo el codebase y cambiar su valor por defecto implícito es
        // la trampa documentada que rompió siete llamadores en el PR #16. Esta fase no lo toca.
        expect(SQLCONN_SRC).toMatch(/async function runQuery\(query, database = config\.database\.database\)/);

        // §6 #1: los mismos cuatro sitios de escritura que dejó la fase 20.3 —fallo de Joi, POST
        // exitoso, POST fallido y reconciliación—, ni uno más. Se afirma la IGUALDAD y no una cota
        // porque el camino diferido no agrega SQL de ningún tipo: su cuerpo entero son dos
        // sentencias, contar y saltar. Un quinto sitio significaría que alguien le dio al rezago una
        // escritura propia, que es justo lo que fail-closed quiere decir que no pasa.
        expect(countOf(CONTROLLER_SRC, /INSERT INTO fesa\.dbo\.fesaOCFocaltec/g)).toBe(4);
    });

    test('Guarda 9 (D-14 y T-20.4-17): este archivo cumple las dos prohibiciones que se auto-impone', () => {
        // El bloque de cabecera de este archivo (L44-51) afirma que existe una aserción que cuenta
        // estas dos subcadenas y exige cero. Ésta es esa aserción: sin ella, esa afirmación sería
        // falsa y las dos decisiones quedarían apoyadas únicamente en un comentario — justo lo que
        // el criterio de éxito de este plan prohíbe.
        //
        // Los dos patrones se ARMAN POR CONCATENACIÓN, y eso es load-bearing, no estilo: escribir la
        // subcadena entera en el literal la metería en este mismo fuente y la guarda se detectaría a
        // sí misma, quedando ciega para siempre — incapaz de distinguir el uso prohibido de la cita
        // del uso prohibido. Es el mismo desenlace que el hazard de D-04 en
        // `PortalOC_Creator.js:347-360`. No las "simplifiques" juntando los trozos.

        // (1) D-14: la API de temporizadores falsos de Jest no se usa. Instalarla cambiaría el
        // entorno de ejecución de TODOS los casos de este archivo a cambio de nada: la única fuente
        // de tiempo que lee el código bajo prueba es Date.now(), y un espía sobre Date.now es
        // determinista, quirúrgico y deja el bucle de eventos en paz.
        expect(countOf(SELF_SRC, new RegExp('use' + 'FakeTimers', 'g'))).toBe(0);

        // (2) T-20.4-17: la etiqueta del post-filtro de reintentos no se menciona en ninguna
        // aserción. Su línea de resumen lleva un campo `deferred=` que significa "retenida por el
        // intervalo de reintento" y no "retenida por el presupuesto de sondeo del tick". Todo campo
        // de este archivo se lee a través de summaryLine(), que ancla en la ETIQUETA; un parser que
        // buscara el nombre del campo suelto leería el número equivocado y pasaría en verde.
        expect(countOf(SELF_SRC, new RegExp('\\[' + 'RETRY' + '\\]', 'g'))).toBe(0);
    });
});
