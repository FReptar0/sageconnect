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
        mockSendOperatorReport.mockResolvedValue(undefined);
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

    test('resiliencia: aunque el envio RECHACE, createPurchaseOrders resuelve y el tick no se cae', async () => {
        // sendOperatorReport de producción no rechaza jamás: traga los fallos de SMTP y los registra
        // en warn. Este caso NO prueba SMTP; prueba que el camino de notificación entero —el
        // constructor de HTML incluido— no puede tumbar un tick que ya escribió sus filas en la
        // tabla de control. El envío vive al final de createPurchaseOrders, que corre dentro de
        // withStepTimeout dentro de forResponse: una excepción aquí reprobaría el paso completo del
        // tenant DESPUÉS de que los INSERT ya se comprometieron, a cambio de un correo.
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
});
