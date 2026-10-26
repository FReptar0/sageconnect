/**
 * Alerta inmediata de OCs que fallaron al subir al portal — fase 20.5, Q3-01 / Q3-02 / Q3-04.
 *
 * Archivo NUEVO y no una extensión de las suites de la 20.3 o la 20.4. Aquellas cargan 45 y 41
 * casos bajo un setup compartido, y los casos de aquí necesitan afinar los recordsets de
 * mockRunQuery y los rechazos de portalClient.post caso por caso. Mezclarlos es exactamente la
 * contaminación de beforeEach contra la que advierte el D-15 de la fase 20.4.
 *
 * `src/utils/EomNotification.js` se deja REAL a propósito: las aserciones sobre el cuerpo del
 * correo corren contra el HTML que el operador recibiría de verdad, no contra un doble. Es lo que
 * convierte el caso del escapado y el caso de la variante en pruebas del camino completo
 * controlador → correo, y no en una repetición de las pruebas unitarias del constructor.
 *
 * Todo valor de fixture es sintético: ni un id de tenant real, ni un número de OC real, ni un
 * nombre de proveedor, ni una clave, ni un secreto, ni un host, ni un correo (HANDOFF §1 y §2).
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Preámbulo de dobles. El mock de config es un objeto de módulo MUTABLE, como en la suite de la
// 20.4: el controlador lee `config.notifications.poAlert.enabled` en tiempo de LLAMADA, al final
// de la función, así que afinar este objeto entre casos surte efecto sin volver a requerir nada.
// El prefijo `mock` del nombre es lo que permite que babel-plugin-jest-hoist acepte la referencia
// fuera de alcance dentro de la fábrica.
//
// Dos tenants a propósito: el caso de aislamiento necesita dos bases distintas para probar que el
// acumulador es por invocación. El mock va COMPLETO porque PortalOC_Creator.js lee siete claves de
// config.app.defaultAddress AL CARGAR EL MÓDULO, y un mock mínimo rompe el require.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const DB_UNO = 'DBALFA';
const DB_DOS = 'DBBETA';

const mockConfig = {
    portal: {
        url: 'http://test',
        tenants: [
            { id: 'T1', key: 'k1', secret: 's1', database: DB_UNO, externalId: 'ext1' },
            { id: 'T2', key: 'k2', secret: 's2', database: DB_DOS, externalId: 'ext2' },
        ],
        httpTimeoutMs: 30000,
        probeBudgetMs: 120000,
        probeMaxPerTick: 50,
    },
    paths: { downloads: '/tmp/downloads', logs: '/tmp/logs', providers: '/tmp/p' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply', notices: [], cc: [], password: '' },
    // El placeholder NO tiene forma de correo, igual que en la suite de la 20.4: el criterio de
    // redacción exige que un regex genérico de correo no encuentre NADA en este archivo.
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
    // El interruptor de apagado de la alerta de OCs (Q3-04). Arranca encendido en cada caso y el
    // beforeEach lo reinstala: un override que sobreviviera al caso siguiente lo haría pasar por la
    // razón equivocada.
    notifications: { poAlert: { enabled: true } },
    eom: { notificationHour: 18, notificationEnabled: true },
};
jest.mock('../../src/config', () => mockConfig);

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

// Se mockea PortalClient con AMBOS verbos y se deja correr la sonda REAL
// (`src/utils/GetPurchaseOrders.js`), heredado de la 20.3. Los fixtures con errorCount > 0 abren la
// compuerta de la sonda, y responder `absent` es lo que deja que el POST proceda y que el caso
// pruebe lo que dice probar en vez de morir en el fail-closed de la sonda.
const mockPortalGet = jest.fn();
const mockPortalPost = jest.fn();
jest.mock('../../src/utils/PortalClient', () => ({ get: mockPortalGet, post: mockPortalPost }));

const mockSendMail = jest.fn();
const mockSendOperatorReport = jest.fn();
jest.mock('../../src/utils/EmailSender', () => ({
    sendMail: mockSendMail,
    sendOperatorReport: mockSendOperatorReport,
}));

jest.mock('../../src/utils/TimezoneHelper', () => ({ getCurrentDateString: () => '2026-05-15' }));
jest.mock('../../src/utils/OC_GroupOrdersByNumber', () => ({ groupOrdersByNumber: (rs) => rs }));
jest.mock('../../src/utils/parseExternPurchaseOrders', () => ({
    parseExternPurchaseOrders: (g) => g.map((r) => ({ external_id: r.EXTERNAL_ID, cfdi_payment_method: '', requisition_number: 0, _row: r })),
}));

// Atado a un jest.fn() en vez de a una flecha anónima para poder hacerlo LANZAR en el caso del
// sitio de fallo de Joi. Es la única forma de llegar a ese sitio de captura sin tocar el modelo.
const mockValidatePO = jest.fn((po) => po);
jest.mock('../../src/models/PurchaseOrder', () => ({ validateExternPurchaseOrder: mockValidatePO }));

const { createPurchaseOrders } = require('../../src/controller/PortalOC_Creator');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Ayudantes. Cada caso se lee como DATOS y no como plomería.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// Una fila del recordset del SELECT del cron. lastErrorAt va nulo a propósito: la consulta real NO
// proyecta ef.lastErrorAt (D-ITEM-03), así que en producción toda OC candidata resulta elegible de
// inmediato y el filtro por intervalo nunca difiere una OC. Un fixture con lastErrorAt fabricaría
// un diferimiento que la producción no puede producir y taparía el caso que se quiere probar.
const poRow = (externalIdValue, errorCount) => ({
    EXTERNAL_ID: externalIdValue,
    errorCount,
    lastErrorAt: null,
    dbNow: new Date(),
});

// Ceba el tick por FORMA del SQL en vez de por cola de mockResolvedValueOnce. Una cola que el
// controlador no consuma por completo se derrama al caso siguiente, que entonces asegura en
// silencio contra el recordset equivocado — el peligro que documenta la suite de cron-where. Por
// forma, el mismo cebado sirve para un tick o para tres.
const primeTick = (rows) => {
    mockRunQuery.mockImplementation(async (sql) => {
        if (/INSERT INTO/i.test(String(sql))) return { recordset: [], rowsAffected: [1] };
        return { recordset: rows };
    });
};

// Un error de axios con la forma que el controlador sabe leer: respAPI queda en `code: description`.
const portalError = (code, description) => {
    const err = new Error('portal rejected');
    err.response = { status: 400, statusText: 'Bad Request', data: { code, description } };
    return err;
};

// La sonda responde "el portal NO tiene esta OC", que es lo que deja pasar el POST.
const probeAbsent = () => ({ data: { items: [], total: 0 } });

// La respuesta de un POST exitoso: el controlador lee status, statusText y data.id.
const postOk = () => ({ status: 201, statusText: 'Created', data: { id: 'a'.repeat(24) } });

// Lee el único envío registrado. Falla con un mensaje útil si hubo cero o más de uno.
const onlyCall = () => {
    expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
    return mockSendOperatorReport.mock.calls[0][0];
};

const logLines = () => mockLogGenerator.mock.calls.map((c) => String(c[2] || ''));

describe('PortalOC_Creator — alerta inmediata de OCs con fallo de carga (fase 20.5, Q3-01/Q3-02/Q3-04)', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        // clearAllMocks() limpia los registros de llamada pero NO las implementaciones ni las colas.
        // mockReset() las drena para que cada caso sea autocontenido.
        mockRunQuery.mockReset();
        mockPortalPost.mockReset();
        mockPortalGet.mockReset();
        mockSendOperatorReport.mockReset();
        // D-14 de la 20.6: el doble refleja lo que la función hace DE VERDAD. Desde el plan 20.6-01
        // sendOperatorReport resuelve `{ delivered, error }` en sus dos desenlaces y nunca rechaza;
        // un doble que resolviera `undefined` caería del lado NO entregado bajo la regla fail-closed
        // del controlador y volvería roja, por la razón equivocada, cada caso de éxito de abajo.
        mockSendOperatorReport.mockResolvedValue({ delivered: true, error: null });
        mockValidatePO.mockReset();
        mockValidatePO.mockImplementation((po) => po);
        // El interruptor vuelve a encendido: el caso que lo apaga no debe contaminar a los demás.
        mockConfig.notifications.poAlert.enabled = true;
    });

    test('casilla 1 del SPEC: tres OCs que fallan por primera vez producen UN solo correo con las tres', async () => {
        // Éste es el caso que la implementación desde el `catch` que proponía DEVIATIONS.md
        // reprobaría con tres llamadas. Un envío por tick, sin importar cuántas OCs fallaron.
        primeTick([poRow('OC-AAA-001', 0), poRow('OC-AAA-002', 0), poRow('OC-AAA-003', 0)]);
        mockPortalPost
            .mockRejectedValueOnce(portalError('E100', 'proveedor sin cuenta bancaria'))
            .mockRejectedValueOnce(portalError('E200', 'moneda no soportada'))
            .mockRejectedValueOnce(portalError('E300', 'la ubicacion no existe'));

        await createPurchaseOrders(0);

        const sent = onlyCall();
        expect(sent.html).toContain('OC-AAA-001');
        expect(sent.html).toContain('OC-AAA-002');
        expect(sent.html).toContain('OC-AAA-003');
        expect(sent.html).toContain('proveedor sin cuenta bancaria');
        expect(sent.html).toContain('moneda no soportada');
        expect(sent.html).toContain('la ubicacion no existe');
        expect(sent.subject).toContain(DB_UNO);
        expect(sent.subject).toContain('3');
        // El correo sale por el canal de OPERADOR y se enruta a la bitácora del controlador.
        expect(sent.callerLogFile).toBe('PortalOC_Creator');
        expect(logLines()).toContainEqual(expect.stringMatching(/^\[PO-ALERT\] tenant=DBALFA pos=3 sent=true$/));
    });

    test('casilla 2 del SPEC: un tick sin ningun fallo no manda ningun correo', async () => {
        primeTick([poRow('OC-BBB-001', 0), poRow('OC-BBB-002', 0)]);
        mockPortalPost.mockResolvedValue(postOk());

        await createPurchaseOrders(0);

        expect(mockPortalPost).toHaveBeenCalledTimes(2);
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        // Un tick limpio tampoco deja la linea de la etiqueta: ni sent=true ni sent=false.
        expect(logLines().filter((l) => /\[PO-ALERT\]/.test(l))).toHaveLength(0);
    });

    test('casilla 4 del SPEC (D-04): el rezago de 3,313 filas ERROR de produccion no inunda al operador en el primer tick', async () => {
        // Toda OC detrás de esas filas llega al primer tick tras el despliegue con errorCount > 0.
        // Ésta es esa forma exacta. Si esta prueba se pone roja, el despliegue manda un correo por
        // cada OC del rezago acumulado: el modo de falla que Q3-02 existe para impedir.
        primeTick([poRow('OC-CCC-001', 1), poRow('OC-CCC-002', 7)]);
        mockPortalGet.mockResolvedValue(probeAbsent());
        mockPortalPost.mockRejectedValue(portalError('E400', 'el portal la rechazo otra vez'));

        await createPurchaseOrders(0);

        // Las dos llegaron al POST y las dos fallaron: la ausencia de correo es por la condición
        // derivada, no porque el camino se haya quedado corto antes de fallar.
        expect(mockPortalPost).toHaveBeenCalledTimes(2);
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
    });

    test('casilla 3 del SPEC: la misma OC fallando en tres ticks seguidos se menciona en UN solo correo, el del primer tick', async () => {
        mockPortalGet.mockResolvedValue(probeAbsent());
        mockPortalPost.mockRejectedValue(portalError('E500', 'sigue fallando'));

        // Tick 1: primer fallo registrado.
        primeTick([poRow('OC-DDD-001', 0)]);
        await createPurchaseOrders(0);
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);

        // Ticks 2 y 3: la tabla de control ya guarda las filas ERROR de los ticks previos, que es lo
        // que estos errorCount representan. Prueba que el estado derivado se comporta como un
        // mecanismo de supresión sin ser uno.
        primeTick([poRow('OC-DDD-001', 1)]);
        await createPurchaseOrders(0);
        primeTick([poRow('OC-DDD-001', 2)]);
        await createPurchaseOrders(0);

        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(mockPortalPost).toHaveBeenCalledTimes(3);
    });

    test('tick mixto: solo la OC que falla por primera vez entra al correo', async () => {
        primeTick([poRow('OC-EEE-NUEVA', 0), poRow('OC-EEE-VIEJA', 3)]);
        mockPortalGet.mockResolvedValue(probeAbsent());
        mockPortalPost.mockRejectedValue(portalError('E600', 'rechazo generico'));

        await createPurchaseOrders(0);

        const sent = onlyCall();
        expect(sent.html).toContain('OC-EEE-NUEVA');
        expect(sent.html).not.toContain('OC-EEE-VIEJA');
        expect(sent.subject).toContain('1');
    });

    test('sitio de fallo de Joi: una OC rechazada por validacion tambien alerta', async () => {
        // Los dos sitios escriben una fila ERROR, así que los dos son "la subida falló". Cubrir sólo
        // el POST dejaría muda toda rechazo de validación.
        primeTick([poRow('OC-FFF-001', 0)]);
        mockValidatePO.mockImplementation(() => {
            const err = new Error('joi');
            err.details = [{ message: 'total debe ser mayor que cero' }];
            throw err;
        });

        await createPurchaseOrders(0);

        const sent = onlyCall();
        expect(sent.html).toContain('OC-FFF-001');
        expect(sent.html).toContain('total debe ser mayor que cero');
        // El POST no se alcanzó: este correo salió del sitio de Joi y de ningún otro.
        expect(mockPortalPost).not.toHaveBeenCalled();
    });

    test('casilla 8 del SPEC (Q3-04): con el interruptor apagado no sale correo, pero si queda rastro', async () => {
        mockConfig.notifications.poAlert.enabled = false;
        primeTick([poRow('OC-GGG-001', 0), poRow('OC-GGG-002', 0), poRow('OC-GGG-003', 0)]);
        mockPortalPost.mockRejectedValue(portalError('E700', 'rechazo con el interruptor apagado'));

        await createPurchaseOrders(0);

        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        // Una alerta silenciada que no deja rastro es indistinguible de una rota.
        expect(logLines()).toContainEqual(expect.stringMatching(/\[PO-ALERT\].*sent=false reason=disabled/));
    });

    test('resiliencia: el envio no rompe el tick, y la linea de resumen del tick se emite igual', async () => {
        // Un fixture con las dos formas a la vez: la OC con errorCount 2 abre la sonda y produce la
        // línea de resumen; la OC con errorCount 0 produce la alerta. Sin la primera no habría
        // resumen que asegurar, porque el resumen se omite cuando el tick no sondeó nada.
        primeTick([poRow('OC-HHH-VIEJA', 2), poRow('OC-HHH-NUEVA', 0)]);
        mockPortalGet.mockResolvedValue(probeAbsent());
        mockPortalPost.mockRejectedValue(portalError('E800', 'rechazo'));

        await expect(createPurchaseOrders(0)).resolves.toBeUndefined();

        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(logLines()).toContainEqual(expect.stringMatching(/^\[PORTAL-CHECK-SUMMARY\] tenant=DBALFA probed=1 /));
    });

    test('el transporte no entrega: la bitacora no dice que si, y nombra las OCs afectadas', async () => {
        // Requisito 6 del SPEC de la 20.6 y decisión D-13. Éste es el escenario del servidor de
        // correo muerto, y desde el contrato del plan 20.6-01 se alcanza por VALOR DE RETORNO y no
        // por un rechazo simulado (D-14): producción no puede producir un rechazo aquí, así que una
        // prueba escrita con uno pasaría en verde siendo compatible con el defecto.
        //
        // Hasta esta fase el tick registraba una entrega que no constaba y la alerta se perdía en
        // silencio. Como la supresión es derivada y la fila ERROR se escribe ANTES del envío, esa OC
        // queda con errorCount = 1 y no vuelve a alertar: el operador necesita poder encontrar con
        // un grep cuáles fueron, para saber que su rezago sólo reaparecerá al cierre de mes.
        primeTick([poRow('OC-MMM-001', 0), poRow('OC-MMM-002', 0)]);
        mockPortalPost.mockRejectedValue(portalError('ED00', 'rechazo'));
        mockSendOperatorReport.mockResolvedValue({ delivered: false, error: 'SMTP connection refused' });

        await expect(createPurchaseOrders(0)).resolves.toBeUndefined();

        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        // La afirmación falsa que esta fase existe para quitar: NINGUNA línea puede decir que salió.
        expect(logLines().filter((l) => /sent=true/.test(l))).toHaveLength(0);
        // El nivel se asegura sobre los TRES argumentos y NO con el ayudante logLines(), que mapea
        // únicamente c[2] y pierde justo el dato que el requisito 6 exige comprobar: que la línea
        // sea encontrable en warn. En info se ahogaría en la bitácora de un tick sano.
        expect(mockLogGenerator).toHaveBeenCalledWith(
            'PortalOC_Creator',
            'warn',
            expect.stringMatching(
                /^\[PO-ALERT\] tenant=DBALFA pos=2 sent=false reason=undelivered ocs=OC-MMM-001,OC-MMM-002 err=SMTP connection refused$/
            ),
        );
    });

    test('la lista de OCs de la linea de no entrega esta acotada (T-20.6-11)', async () => {
        // Una línea por tick y jamás una por fila era ya la propiedad del acumulador. Lo que fija
        // este caso es la otra mitad de la mitigación: que la línea tampoco crezca sin techo cuando
        // el lote es grande. Con 25 OCs se enumeran las primeras 20 y se cuenta el excedente.
        const veinticinco = Array.from({ length: 25 }, (_, n) => poRow(`OC-NNN-${String(n).padStart(3, '0')}`, 0));
        primeTick(veinticinco);
        mockPortalPost.mockRejectedValue(portalError('EE00', 'rechazo'));
        mockSendOperatorReport.mockResolvedValue({ delivered: false, error: 'SMTP connection refused' });

        await createPurchaseOrders(0);

        const linea = logLines().find((l) => /sent=false reason=undelivered/.test(l));
        expect(linea).toBeDefined();
        // El conteo que se reporta sigue siendo el REAL: se acota lo que se ENUMERA, no lo que se
        // cuenta. Un pos= recortado convertiría la mitigación en otra afirmación falsa.
        expect(linea).toContain('pos=25');
        expect(linea).toContain(',+5');
        expect(linea).not.toContain('OC-NNN-020');
        expect(linea.length).toBeLessThan(700);
    });

    test('violacion del contrato: si el camino de notificacion LANZA, el tick tampoco se cae', async () => {
        // OJO: éste ya NO es el caso del servidor de correo caído. Desde el contrato del plan
        // 20.6-01, un SMTP muerto produce un VALOR y no un rechazo, y ese escenario es el caso de
        // arriba. Lo que este caso documenta es lo que sigue siendo real y sigue valiendo la pena:
        // que una VIOLACIÓN del contrato —o una excepción de cualquier otra parte del camino de
        // notificación: el armado del HTML, el del asunto, o el propio logGenerator, que según la
        // nota S-3 de la 20.3 sí puede lanzar— no puede tumbar un tick que YA escribió sus filas en
        // la tabla de control. El envío vive al final de createPurchaseOrders, que corre dentro de
        // withStepTimeout dentro de forResponse: una excepción aquí reprobaría el paso completo del
        // tenant DESPUÉS de que los INSERT ya se comprometieron, a cambio de un correo.
        //
        // El texto del error simulado es irrelevante; lo que se simula es el RECHAZO, que es la
        // violación. Que producción no pueda alcanzar ese estado (WR-09 de la 20.5) es justamente
        // el punto del caso: no lo conviertas de vuelta en un caso de SMTP.
        primeTick([poRow('OC-III-001', 0)]);
        mockPortalPost.mockRejectedValue(portalError('E900', 'rechazo'));
        mockSendOperatorReport.mockRejectedValue(new Error('smtp caido'));

        await expect(createPurchaseOrders(0)).resolves.toBeUndefined();

        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(logLines()).toContainEqual(expect.stringMatching(/\[PO-ALERT\].*sent=false reason=error/));
    });

    test('el cuerpo es el de la variante po-alert del constructor real, no el de cierre de mes', async () => {
        // Lo que impide que alguien pase la variante por omisión más adelante y mande un encabezado
        // de cierre de mes en un correo urgente.
        primeTick([poRow('OC-JJJ-001', 0)]);
        mockPortalPost.mockRejectedValue(portalError('EA00', 'rechazo'));

        await createPurchaseOrders(0);

        const sent = onlyCall();
        expect(sent.html).toContain('OCs que fallaron al subir al portal');
        expect(sent.html).toContain('Fecha del fallo');
        expect(sent.html).not.toContain('Pendientes fin de mes');
        expect(sent.html).not.toContain('Fecha autorización');
    });

    test('escapado en el camino vivo: el texto de error del portal llega escapado al cuerpo', async () => {
        // El escapado vive en buildEomEmailHtml, pero esto lo asegura sobre el camino real
        // controlador → correo. El texto del portal es entrada de un tercero que hoy no se sanea en
        // el origen (T-20.5-17).
        primeTick([poRow('OC-KKK-001', 0)]);
        mockPortalPost.mockRejectedValue(portalError('EB00', '<script>alert(1)</script>'));

        await createPurchaseOrders(0);

        const sent = onlyCall();
        expect(sent.html).toContain('&lt;script&gt;');
        expect(sent.html).not.toContain('<script>');
    });

    test('aislamiento entre tenants: dos ticks de dos bases producen dos correos sin contaminacion cruzada', async () => {
        // El acumulador es POR INVOCACIÓN. Un acumulador en scope de módulo reprobaría este caso:
        // el segundo correo arrastraría la OC del primero.
        mockPortalPost.mockRejectedValue(portalError('EC00', 'rechazo'));

        primeTick([poRow('OC-LLL-UNO', 0)]);
        await createPurchaseOrders(0);
        primeTick([poRow('OC-LLL-DOS', 0)]);
        await createPurchaseOrders(1);

        expect(mockSendOperatorReport).toHaveBeenCalledTimes(2);
        const first = mockSendOperatorReport.mock.calls[0][0];
        const second = mockSendOperatorReport.mock.calls[1][0];

        expect(first.subject).toContain(DB_UNO);
        expect(first.html).toContain('OC-LLL-UNO');
        expect(first.html).not.toContain('OC-LLL-DOS');

        expect(second.subject).toContain(DB_DOS);
        expect(second.html).toContain('OC-LLL-DOS');
        expect(second.html).not.toContain('OC-LLL-UNO');
    });

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Fase 20.6 / WR-04 — la lectura en cerrado del desenlace, fijada por aserción.
    //
    // Éste es el TERCER sitio de llamada de sendOperatorReport, y su expresión es IDÉNTICA a la
    // de los dos despachadores de src/background.js — lo verificó la revisión y lo re-verificó la
    // verificación leyendo cada uno directamente. La frase «un valor ausente o malformado cae del
    // lado de la no entrega» está escrita VERBATIM en cuatro comentarios del código
    // —src/background.js:412 y :517, src/controller/PortalOC_Creator.js:778-779 y
    // src/utils/EmailSender.js:118-120— y hasta este bloque no la sostenía NINGUNA aserción:
    // todos los dobles de la fase resolvían dentro de las dos formas canónicas.
    //
    // La medida de lo que faltaba: mutar los sitios de llamada a
    //     if (!delivery || delivery.delivered !== false)
    // —un undefined contado como ENTREGADO— dejaba las 120 pruebas de la fase EN VERDE, y con
    // ellas reinstalado el centinela mentiroso que esta fase existe para quitar.
    //
    // Hacen falta DOS dobles porque el segundo mutante —cambiar el === por ==, que es lo que
    // produce un refactor cosmético— sobrevive a un undefined: con igualdad laxa
    // { delivered: 1 } pasa por entregado, ya que 1 == true es verdadero en JavaScript.
    //
    // El respaldo 'sin detalle' que estos casos vuelven ALCANZABLE POR PRUEBA es IN-05 de la
    // revisión: se conserva a propósito como defensa fail-closed barata, y volverlo alcanzable es
    // lo que lo protege de una auditoría futura de código muerto.
    //
    // D-03 de la 20.5 sigue intacto: estos casos no agregan estado, no re-alertan y no tocan el
    // catch. Lo que fijan es la AFIRMACIÓN, no la pérdida — una OC cuya alerta se perdió sigue
    // sin re-alertar y reaparece en el correo consolidado de cierre de mes.
    // ─────────────────────────────────────────────────────────────────────────────────────────
    describe('Fase 20.6 / WR-04 — ausente o malformado cuenta como NO entregado', () => {
        test('resultado AUSENTE: la bitacora no dice que si, y el respaldo del texto de error entra', async () => {
            // Mismo montaje que el caso de la no entrega; lo único que cambia es lo que resuelve el
            // doble. El del mutante literal de la revisión: el canal resuelve sin decir nada.
            primeTick([poRow('OC-PPP-001', 0), poRow('OC-PPP-002', 0)]);
            mockPortalPost.mockRejectedValue(portalError('EF00', 'rechazo'));
            mockSendOperatorReport.mockResolvedValue(undefined);

            // La notificación jamás reprueba el paso del tenant: la restricción rectora de la fase.
            await expect(createPurchaseOrders(0)).resolves.toBeUndefined();

            expect(logLines().filter((l) => /sent=true/.test(l))).toHaveLength(0);
            // El nivel se asegura sobre los TRES argumentos y NO con logLines(), que mapea sólo c[2]
            // y pierde justo el dato que el requisito 6 exige: que la línea sea encontrable en warn.
            expect(mockLogGenerator).toHaveBeenCalledWith(
                'PortalOC_Creator',
                'warn',
                expect.stringMatching(
                    /^\[PO-ALERT\] tenant=DBALFA pos=2 sent=false reason=undelivered ocs=OC-PPP-001,OC-PPP-002 err=sin detalle$/
                ),
            );
        });

        test('resultado MALFORMADO-VERDADERO: un 1 no cuenta como entregado', async () => {
            primeTick([poRow('OC-QQQ-001', 0), poRow('OC-QQQ-002', 0)]);
            mockPortalPost.mockRejectedValue(portalError('EF01', 'rechazo'));
            // Por qué 1 y no 'true' ni {}: 1 == true es VERDADERO en JavaScript, así que éste es
            // justo el valor que la igualdad laxa dejaría pasar por entregado y que el === del
            // código rechaza. Es el único doble que mata ese mutante; el de arriba no lo toca.
            // El error:null no es adorno: hace entrar el mismo respaldo que en el caso de arriba.
            mockSendOperatorReport.mockResolvedValue({ delivered: 1, error: null });

            await expect(createPurchaseOrders(0)).resolves.toBeUndefined();

            expect(logLines().filter((l) => /sent=true/.test(l))).toHaveLength(0);
            expect(mockLogGenerator).toHaveBeenCalledWith(
                'PortalOC_Creator',
                'warn',
                expect.stringMatching(
                    /^\[PO-ALERT\] tenant=DBALFA pos=2 sent=false reason=undelivered ocs=OC-QQQ-001,OC-QQQ-002 err=sin detalle$/
                ),
            );
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Guardas estructurales de la fase 20.5.
//
// La cobertura de comportamiento atrapa el error que YA se cometió; la estructural lo atrapa
// aunque una edición futura venga escrita de una forma que los fixtures no ejerciten. Hacen falta
// las dos y ninguna sustituye a la otra — el mismo razonamiento que abre el bloque estructural de
// la 20.4.
//
// Toda expresión regular de este bloque ancla en un IDENTIFICADOR o en una etiqueta entre
// corchetes, jamás en un número de renglón. La lección del §9 de la 20.4 vale igual para las
// aserciones que para la documentación: un rango desactualizado es la manera en que una guarda
// deja de guardar en silencio.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const CONTROLLER_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'controller', 'PortalOC_Creator.js'), 'utf8');

const countOf = (src, re) => (src.match(re) || []).length;

// Anclas de posición, leídas una sola vez. Son las mismas formas de código que usan las guardas de
// la 20.3 y la 20.4, para que las tres suites se rompan juntas si alguien reescribe el bucle.
const FN_AT = CONTROLLER_SRC.indexOf('async function createPurchaseOrders');
const LOOP_AT = CONTROLLER_SRC.indexOf('for (let i = 0; i < ordersToSend.length; i++)');
const SUMMARY_BLOCK_AT = CONTROLLER_SRC.indexOf('if (probed > 0 || probeDeferred > 0)');
const SUMMARY_TAG_AT = CONTROLLER_SRC.indexOf('[PORTAL-CHECK-SUMMARY]');

describe('PortalOC_Creator — guardas estructurales de la alerta inmediata (fase 20.5)', () => {

    test('Guarda 1 (D-01, casilla 17 del SPEC): no se emite ningun envio desde DENTRO del bucle de OCs', () => {
        // La rebanada entre la cabecera del bucle y el bloque de resumen es, literalmente, todo el
        // cuerpo del bucle. Un await a SMTP ahí multiplicaría los viajes de red por el número de OCs
        // fallidas y gastaría el presupuesto de paso que la fase 20.4 existe para proteger.
        expect(FN_AT).toBeGreaterThan(-1);
        expect(LOOP_AT).toBeGreaterThan(-1);
        expect(SUMMARY_BLOCK_AT).toBeGreaterThan(LOOP_AT);

        const loopBody = CONTROLLER_SRC.slice(LOOP_AT, SUMMARY_BLOCK_AT);
        // La rebanada NO es vacua: contiene los dos sitios de captura y los dos catch donde
        // DEVIATIONS.md quería poner el envío. Sin estas cuatro aserciones, un refactor que moviera
        // el bucle dejaría la rebanada vacía y las prohibiciones de abajo pasarían por no encontrar
        // nada — una guarda verde que ya no guarda nada.
        expect(loopBody).toContain('catch (valErr)');
        expect(loopBody).toContain('catch (err)');
        expect(countOf(loopBody, /poAlerts\.push/g)).toBe(2);
        expect(loopBody.length).toBeGreaterThan(1000);

        expect(loopBody).not.toMatch(/sendOperatorReport/);
        expect(loopBody).not.toMatch(/sendMail/);
        expect(loopBody).not.toMatch(/sendAdminAlert/);
        expect(loopBody).not.toMatch(/nodemailer/);
        expect(loopBody).not.toMatch(/createTransport/);
    });

    test('Guarda 2 (D-01): un solo envio en todo el archivo, y va DESPUES de la linea de resumen', () => {
        // Dos envíos significarían que alguien volvió a añadir un disparo por sitio de fallo; un
        // envío ANTES del resumen significaría que se coló de vuelta dentro del bucle.
        expect(countOf(CONTROLLER_SRC, /await sendOperatorReport\(/g)).toBe(1);
        const sendAt = CONTROLLER_SRC.indexOf('await sendOperatorReport(');
        expect(SUMMARY_TAG_AT).toBeGreaterThan(-1);
        expect(sendAt).toBeGreaterThan(SUMMARY_TAG_AT);
    });

    test('Guarda 3 (CLAUDE.md §3): esta fase tampoco anadio ninguna primitiva always-on', () => {
        // Repite la Guarda 4 de la suite de la 20.3 y la Guarda 2 de la 20.4 contra el fuente
        // POST-20.5. Que la guarda ya pasara antes es justamente el punto: la propiedad es sobre el
        // archivo TAL COMO ESTÁ HOY, no sobre el cambio que la introdujo.
        expect(CONTROLLER_SRC).not.toMatch(/setInterval/);
        expect(CONTROLLER_SRC).not.toMatch(/setTimeout/);
        expect(CONTROLLER_SRC).not.toMatch(/new Set\(/);
        expect(CONTROLLER_SRC).not.toMatch(/\.addListener\(/);
        expect(countOf(CONTROLLER_SRC, /new Map\(/g)).toBe(1);
        expect(CONTROLLER_SRC.indexOf('new Map(')).toBeGreaterThan(FN_AT);
    });

    test('Guarda 4 (D-03): no se almacena NADA — ni centinela por OC ni lectura de disco', () => {
        // Los dos diseños rechazados —un archivo por OC y un Map en scope de módulo— se verían
        // exactamente así. Ésta es la guarda que vuelve permanente el rechazo en vez de dejarlo como
        // una decisión de una sola vez.
        expect(CONTROLLER_SRC).not.toMatch(/writeFileSync/);
        expect(CONTROLLER_SRC).not.toMatch(/writeSentinelAtomically/);
        expect(CONTROLLER_SRC).not.toMatch(/existsSync/);
        expect(CONTROLLER_SRC).not.toMatch(/readFileSync/);
    });

    test('Guarda 5 (D-03): el acumulador se declara DENTRO de la funcion y antes del bucle', () => {
        // Una declaración en scope de módulo haría que las alertas del tick N dependieran del tick
        // N−1 y se derramaría entre tenants. El caso de aislamiento del bloque de arriba es su
        // mitad de comportamiento.
        const declAt = CONTROLLER_SRC.indexOf('const poAlerts = [];');
        expect(declAt).toBeGreaterThan(-1);
        expect(declAt).toBeGreaterThan(FN_AT);
        expect(declAt).toBeLessThan(LOOP_AT);
    });

    test('Guarda 6 (D-03): la condicion es DERIVADA y esta en los DOS sitios de fallo', () => {
        // Una sola aparición significaría que un sitio de fallo se quedó mudo: o los rechazos de Joi
        // o los del POST dejarían de alertar, y nada más lo delataría.
        expect(countOf(CONTROLLER_SRC, /priorErrors === 0/g)).toBe(2);
        const first = CONTROLLER_SRC.indexOf('priorErrors === 0');
        const second = CONTROLLER_SRC.indexOf('priorErrors === 0', first + 1);
        expect(first).toBeGreaterThan(LOOP_AT);
        expect(second).toBeLessThan(SUMMARY_BLOCK_AT);
    });

    test('Guarda 7 (Guarda 9 de la 20.3): sigue sin nacer ninguna etiqueta hermana del prefijo de la sonda', () => {
        // La etiqueta de la alerta se eligió a propósito FUERA de ese espacio de nombres.
        expect(CONTROLLER_SRC).not.toMatch(/\[PORTAL-CHECK-(?!SUMMARY)[A-Z-]+\]/);
        // CUATRO sitios de emisión, uno solo de los cuales corre por tick: entregada, silenciada por
        // el interruptor de apagado, NO ENTREGADA, y fallida por excepción. Ninguno vive dentro del
        // bucle — eso lo prueba la Guarda 1.
        //
        // El conteo se movió DE TRES A CUATRO en la fase 20.6, a propósito y no por deriva: hasta
        // entonces sendOperatorReport resolvía lo mismo entregara o no, así que el caso de la
        // entrega perdida no existía y la línea de éxito se emitía pase lo que pase. El cuarto sitio
        // es el requisito 6 del SPEC de la 20.6 (decisión D-13) y es el único que sube a warn.
        // Si este número vuelve a moverse, que sea con la misma deliberación: una emisión de más es
        // una línea que alguien metió en el bucle o una rama que nadie documentó.
        expect(countOf(CONTROLLER_SRC, /\[PO-ALERT\]/g)).toBe(4);
        expect(CONTROLLER_SRC).toMatch(/\[PO-ALERT\][^`]*sent=true/);
        expect(CONTROLLER_SRC).toMatch(/\[PO-ALERT\][^`]*sent=false reason=disabled/);
        expect(CONTROLLER_SRC).toMatch(/\[PO-ALERT\][^`]*sent=false reason=error/);
        expect(CONTROLLER_SRC).toMatch(/\[PO-ALERT\][^`]*sent=false reason=undelivered/);
    });

    test('Guarda 8 (Q3-04): el interruptor se lee UNA vez, en el sitio del envio y en ningun otro', () => {
        // Una segunda lectura dentro del bucle sería una rama por fila que nadie pidió; una lectura
        // antes del bucle congelaría un valor que el arnés de pruebas muta entre casos.
        expect(countOf(CONTROLLER_SRC, /config\.notifications\.poAlert\.enabled/g)).toBe(1);
        expect(CONTROLLER_SRC.indexOf('config.notifications.poAlert.enabled')).toBeGreaterThan(SUMMARY_TAG_AT);
    });

    test('Guarda 9 (CLAUDE.md §6 #1 y #2): la utileria de consulta compartida sigue intacta', () => {
        // Los dos números vienen de la Guarda 2 de la suite de la 20.3, medidos contra el fuente
        // pre-20.5 y sin cambio en esta fase: CUATRO sitios de escritura (fallo de Joi, POST
        // exitoso, POST fallido y reconciliación) que pasan el literal FESA, más UNA lectura, el
        // SELECT por tenant, que pasa databases[index]. Total cinco. Si el primero sube sin que suba
        // el segundo, alguien añadió una escritura que va a caer en la base por omisión de runQuery
        // — el modo de falla exacto del PR #16, que rompió 7 llamadores.
        expect(countOf(CONTROLLER_SRC, /runQuery\(/g)).toBe(5);
        expect(countOf(CONTROLLER_SRC, /runQuery\([A-Za-z]+,\s*'FESA'\)/g)).toBe(4);
        expect(countOf(CONTROLLER_SRC, /INSERT INTO fesa\.dbo\.fesaOCFocaltec/g)).toBe(4);
        // El valor por omisión implícito no debe aparecer escrito nunca en este controlador.
        expect(CONTROLLER_SRC).not.toMatch(/config\.database\.database/);
        // Ninguna sentencia de actualización contra la tabla de control, por ningún camino.
        expect(CONTROLLER_SRC).not.toMatch(/UPDATE\s+fesa\.dbo\.fesaOCFocaltec/i);
    });
});
