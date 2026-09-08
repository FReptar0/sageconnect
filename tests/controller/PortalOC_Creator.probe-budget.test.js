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
    eom: { notificationHour: 18, notificationEnabled: true },
};
jest.mock('../../src/config', () => mockConfig);

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
// El plan 20.4-04 agrega un segundo sitio de costo (un SELECT lento) y debe enrutarlo por aquí: esta
// propiedad de sitio-único tiene que seguir siendo cierta en el archivo terminado.
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
const stubSelect = (rows) => {
    mockRunQuery.mockResolvedValueOnce({ recordset: rows });
    mockRunQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
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

const stubPostAlwaysSuccess = () => {
    mockPortalPost.mockResolvedValue({ status: 201, statusText: 'Created', data: { id: VALID_ID } });
};

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
        stubPostAlwaysSuccess();

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
});
