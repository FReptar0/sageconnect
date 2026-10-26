// tests/integration/payment-report-dispatch.test.js (NEW — Phase 20.5 Plan 20.5-05)
//
// Integration coverage for Q3-03 (reporte quincenal de pagos pendientes), la mitad de
// pagos de Q3-04 (interruptores de apagado independientes) y Q3-05 (el correo de cierre
// de mes se conserva tal cual), ejercitando dispatchPaymentReportIfDue() de src/background.js.
//
// Archivo NUEVO en vez de una extensión de tests/integration/eom-dispatch.test.js: ese
// archivo es el artefacto que prueba Q3-05 y su diff debe quedar vacío, y además su
// beforeEach fija de antemano los dos mocks de correo de una forma que estos casos
// necesitan variar (el de SMTP caído, el de los dos interruptores).
//
// Estrategia, calcada del harness de eom-dispatch.test.js: se mockea src/config (con el
// namespace notifications completo), LogGenerator, SQLServerConnection.runQuery y los dos
// remitentes de correo. EomNotification NO se mockea: la compuerta, el HTML y la escritura
// del centinela son justamente lo que se está probando, así que los centinelas se escriben
// de verdad a un directorio temporal y se leen con fs.readFileSync + JSON.parse.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { describe, test, expect, beforeEach, afterAll } = require('@jest/globals');

const tmpRoot = path.join(os.tmpdir(), `sageconnect-payreport-integration-${process.pid}`);

// Mock de src/config — antes de cualquier require, para que las utilidades anidadas lo vean.
jest.mock('../../src/config', () => {
    const nodePath = require('path');
    const nodeOs = require('os');
    const tmpLogs = nodePath.join(nodeOs.tmpdir(), `sageconnect-payreport-integration-${process.pid}`);
    return {
        portal: {
            url: 'http://test',
            tenants: [{ id: 'T1', key: 'k1', secret: 's1', database: 'COPDAT', externalId: 'ext1' }],
            httpTimeoutMs: 30000,
        },
        paths: { downloads: '/tmp/dl', providers: '/tmp/p', logs: tmpLogs },
        database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
        mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', notices: ['ops@test.com'], cc: ['cc@test.com'], password: '' },
        license: { adminEmail: 'admin@test.com' },
        app: {
            company: 'TestCo', timezone: 'America/Mexico_City', rfc: 'RFC', regimen: 'R1', arg: 'A1', importRoute: '',
            baseUrl: 'http://localhost:3030',
            defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
            addressIdentifiersSkip: [],
        },
        security: { apiKey: 'test-key' },
        schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 0, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
        retry: { scope: 'last_n_days', lookbackDays: 7, backoff: { initialMin: 15, multiplier: 2, maxMin: 1440 } },
        // Fase 20.5 — los tres interruptores viven aquí; los casos 9 y 10 los mueven uno a uno.
        notifications: {
            poAlert: { enabled: true },
            paymentReport: { enabled: true, hour: 18, lookbackDays: 365 },
            mailTimeoutMs: 30000,
        },
        eom: { notificationHour: 18, notificationEnabled: true },
    };
});

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

const mockSendOperatorReport = jest.fn();
jest.mock('../../src/utils/EmailSender', () => ({
    sendMail: jest.fn(),
    sendOperatorReport: mockSendOperatorReport,
}));

// Se mockea sólo para poder afirmar la NEGATIVA de D-15: esta ruta nunca debe usarlo.
const mockSendAdminAlert = jest.fn();
jest.mock('../../src/utils/AdminEmailSender', () => ({
    sendAdminAlert: mockSendAdminAlert,
    findLastOpenStep: jest.fn(),
}));

const { dispatchPaymentReportIfDue, dispatchEomIfDue, buildEomDataQuery } = require('../../src/background');
const config = require('../../src/config');

const ROW = (idOrPo, fechaAuth, attempts = 1) => ({ tenant: 'COPDAT', idOrPo, fechaAuth, attempts });

describe('Reporte quincenal de pagos pendientes (Fase 20.5, Q3-03)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
        fs.mkdirSync(tmpRoot, { recursive: true });
        // Fase 20.6 — el canal de correo del operador devuelve el desenlace de la entrega y el
        // sitio de llamada lo lee en cerrado, así que el doble por omisión tiene que AFIRMAR la
        // entrega: un valor ausente cae del lado de la no entrega y todos los casos de éxito
        // pasarían a escribir un centinela de fallo.
        mockSendOperatorReport.mockResolvedValue({ delivered: true, error: null });
        // Este otro se queda como está a propósito: el remitente del buzón de administración no
        // cambió de contrato en esta fase y aquí sólo existe para la aserción NEGATIVA de D-15.
        mockSendAdminAlert.mockResolvedValue(undefined);
        mockRunQuery.mockResolvedValue({ recordset: [] });
    });

    afterAll(() => {
        if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    test('SPEC 5: día 16 a las 18:05 sin centinela → un solo correo y el centinela del periodo escrito', async () => {
        mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00001234', '2026-05-12', 3)] });

        await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config);

        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        const call = mockSendOperatorReport.mock.calls[0][0];
        expect(call.subject).toMatch(/quincena 2/);
        expect(call.subject).toMatch(/2026-05/);
        expect(call.callerLogFile).toBe('EomNotification');

        const sentinel = path.join(tmpRoot, 'payment-report-2026-05-2.sent');
        expect(fs.existsSync(sentinel)).toBe(true);
        const payload = JSON.parse(fs.readFileSync(sentinel, 'utf8'));
        expect(payload.success).toBe(true);
        expect(payload.rowCount).toBe(1);

        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/^\[PAYREPORT-DISPATCH\] period=2 rows=1 sent=true$/));
    });

    test('SPEC 6: un segundo tick del mismo periodo no manda nada', async () => {
        mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00001234', '2026-05-12')] });
        await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config);
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);

        jest.clearAllMocks();
        mockSendOperatorReport.mockResolvedValue({ delivered: true, error: null });
        mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00001234', '2026-05-12')] });

        await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 19, 0, 0), config);

        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(mockRunQuery).not.toHaveBeenCalled();
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/^\[PAYREPORT-SKIP\] period=2 reason=gate-false$/));
    });

    // D-07, el caso clave: el servicio estuvo caído el 16. Un término de día exacto
    // (`day === 1 || day === 16`) perdería el reporte del periodo en silencio y para
    // siempre; esta prueba se pone en rojo si alguien lo reintroduce.
    test('D-07: un primer tick tardío (día 20) sigue reportando la quincena', async () => {
        mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00005678', '2026-05-18')] });

        await dispatchPaymentReportIfDue(new Date(2026, 4, 20, 18, 5, 0), config);

        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(mockSendOperatorReport.mock.calls[0][0].subject).toMatch(/quincena 2/);
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/^\[PAYREPORT-GATE\] period=2 day=20 /));
    });

    test('D-06: el día 1 abre la quincena 1, y el día 15 con su centinela ya no manda', async () => {
        mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00000001', '2026-04-28')] });

        await dispatchPaymentReportIfDue(new Date(2026, 4, 1, 18, 5, 0), config);

        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(mockSendOperatorReport.mock.calls[0][0].subject).toMatch(/quincena 1/);
        expect(fs.existsSync(path.join(tmpRoot, 'payment-report-2026-05-1.sent'))).toBe(true);

        // El día 15 sigue siendo la quincena 1: mismo centinela, silencio.
        jest.clearAllMocks();
        mockSendOperatorReport.mockResolvedValue({ delivered: true, error: null });
        await dispatchPaymentReportIfDue(new Date(2026, 4, 15, 18, 5, 0), config);
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
    });

    // El caso que se rompería si el centinela se nombrara sólo por mes.
    test('D-06: con el centinela de la quincena 1 presente, el día 16 sí manda — es otro periodo', async () => {
        fs.writeFileSync(
            path.join(tmpRoot, 'payment-report-2026-05-1.sent'),
            JSON.stringify({ timestamp: '2026-05-01T18:05:00.000Z', success: true, rowCount: 0 })
        );
        mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00002222', '2026-05-16')] });

        await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config);

        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(mockSendOperatorReport.mock.calls[0][0].subject).toMatch(/quincena 2/);
        expect(fs.existsSync(path.join(tmpRoot, 'payment-report-2026-05-2.sent'))).toBe(true);
    });

    // Una compuerta que escribiera el centinela mientras se niega a mandar consumiría el
    // periodo en silencio: a las 18:05 ya no habría reporte porque el archivo existiría.
    test('la hora acota: a las 17:55 no manda y NO escribe centinela', async () => {
        await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 17, 55, 0), config);

        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(mockRunQuery).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(tmpRoot, 'payment-report-2026-05-2.sent'))).toBe(false);
    });

    // SPEC 7 / D-08. Las dos mitades son necesarias: la del SQL prueba que la consulta lo
    // pide, la del fixture prueba que nada aguas abajo lo vuelve a filtrar.
    test('SPEC 7 / D-08: la ventana se amplía a last_n_days y un pendiente de hace dos meses llega al correo', async () => {
        mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00007731', '2026-03-11', 4)] });

        await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config);

        const sql = mockRunQuery.mock.calls[0][0];
        expect(sql).toMatch(/DATEADD\(day, -365,/);
        expect(sql).not.toMatch(/DATEFROMPARTS/);

        const html = mockSendOperatorReport.mock.calls[0][0].html;
        expect(html).toMatch(/PAY00007731/);
    });

    // SPEC 16 / Q3-05. Sin tercer argumento, la consulta de cierre de mes es la de antes de
    // la fase 20.5. Ninguna aserción previa habría atrapado un cambio incondicional aquí:
    // eom-dispatch.test.js sólo comprueba ausencias de columnas, y un fragmento
    // `DATEADD(day, -365, ...)` las satisface todas.
    test('SPEC 16 / Q3-05: sin el tercer argumento, ambas ramas conservan el alcance del mes en curso', () => {
        const pagos = buildEomDataQuery('payments', 'COPDAT');
        expect(pagos).toMatch(/DATEFROMPARTS\(YEAR\(GETDATE\(\)\), MONTH\(GETDATE\(\)\), 1\)/);
        expect(pagos).not.toMatch(/DATEADD\(day, -/);

        const ocs = buildEomDataQuery('pos', 'COPDAT');
        expect(ocs).toMatch(/DATEFROMPARTS\(YEAR\(GETDATE\(\)\), MONTH\(GETDATE\(\)\), 1\)/);
        expect(ocs).not.toMatch(/DATEADD\(day, -/);
    });

    test('SPEC 9 / Q3-04: apagar el reporte quincenal NO apaga el correo de cierre de mes', async () => {
        config.notifications.paymentReport.enabled = false;
        try {
            await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config);
            expect(mockSendOperatorReport).not.toHaveBeenCalled();

            // El otro flujo sigue vivo: último día del mes, sus dos correos salen.
            mockRunQuery.mockResolvedValue({ recordset: [] });
            await dispatchEomIfDue(new Date(2026, 4, 31, 18, 5, 0), config);
            expect(mockSendOperatorReport).toHaveBeenCalledTimes(2);
        } finally {
            config.notifications.paymentReport.enabled = true;
        }
    });

    test('SPEC 10 / Q3-04: apagar el cierre de mes NO apaga el reporte quincenal', async () => {
        config.eom.notificationEnabled = false;
        try {
            await dispatchEomIfDue(new Date(2026, 4, 31, 18, 5, 0), config);
            expect(mockSendOperatorReport).not.toHaveBeenCalled();

            mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00003333', '2026-05-10')] });
            await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config);
            expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
            expect(mockSendOperatorReport.mock.calls[0][0].subject).toMatch(/quincena 2/);
        } finally {
            config.eom.notificationEnabled = true;
        }
    });

    // Datos parciales valen más que ningún dato: la base muerta de un tenant no puede
    // silenciar a los demás.
    test('el fallo de consulta de un tenant no silencia a los otros', async () => {
        const originalTenants = config.portal.tenants;
        config.portal.tenants = [
            { id: 'T1', key: 'k1', secret: 's1', database: 'COPDAT', externalId: 'ext1' },
            { id: 'T2', key: 'k2', secret: 's2', database: 'TENANTDB2', externalId: 'ext2' },
        ];
        try {
            mockRunQuery
                .mockRejectedValueOnce(new Error('Login failed for user'))
                .mockResolvedValueOnce({ recordset: [ROW('PAY00004444', '2026-05-09')] });

            await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config);

            expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
            expect(mockSendOperatorReport.mock.calls[0][0].html).toMatch(/PAY00004444/);
            expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'warn',
                expect.stringMatching(/\[PAYREPORT-DISPATCH\].*query-failed/));

            const payload = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'payment-report-2026-05-2.sent'), 'utf8'));
            expect(payload.success).toBe(true);
            expect(payload.rowCount).toBe(1);
        } finally {
            config.portal.tenants = originalTenants;
        }
    });

    // D-15: LICENSE_ADMIN_EMAIL está reservado al timeout del proceso hijo. La aserción
    // negativa es la que se pone en rojo si alguien copia aquí el respaldo del cierre de mes.
    //
    // Fase 20.6 / D-14: el doble ya no simula un RECHAZO, simula una NO ENTREGA. WR-09 de la
    // revisión de la 20.5 señaló que el rechazo describe un estado que producción no puede
    // alcanzar —el canal de correo del operador nunca lanza—, así que una prueba verde era
    // compatible con el defecto en vivo. Ahora el doble refleja lo que la función hace de veras.
    test('correo no entregado: el centinela se escribe igual con success:false y NO se avisa al buzón de administración', async () => {
        mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00005555', '2026-05-13')] });
        mockSendOperatorReport.mockResolvedValueOnce({ delivered: false, error: 'SMTP connection refused' });

        await expect(dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config)).resolves.toBeUndefined();

        const payload = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'payment-report-2026-05-2.sent'), 'utf8'));
        expect(payload.success).toBe(false);
        expect(payload.error).toMatch(/SMTP connection refused/);
        expect(payload.rowCount).toBe(1);

        expect(mockSendAdminAlert).not.toHaveBeenCalled();

        // El desenlace tiene que constar en un nivel que un operador encuentre, y la línea de
        // éxito no puede haberse emitido: afirmar una entrega que no consta es exactamente el
        // defecto que esta fase viene a quitar.
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'error',
            expect.stringMatching(/^\[PAYREPORT-DISPATCH\] period=2 rows=1 sent=false err=SMTP connection refused$/));
        expect(mockLogGenerator).not.toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/sent=true/));
    });

    // Un periodo vacío es justo cuando un operador podría concluir que no falló nada; el pie
    // de nota 20.2-05 es lo que se lo impide.
    test('periodo sin pendientes: el correo sale igual, con "Sin pendientes" y el pie de nota', async () => {
        mockRunQuery.mockResolvedValue({ recordset: [] });

        await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config);

        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        const html = mockSendOperatorReport.mock.calls[0][0].html;
        expect(html).toMatch(/Sin pendientes/);
        expect(html).toMatch(/no registra el detalle del error de cada pago/);

        const payload = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'payment-report-2026-05-2.sent'), 'utf8'));
        expect(payload.success).toBe(true);
        expect(payload.rowCount).toBe(0);
    });

    // Fase 20.6 — el cuerpo de quincena cableado y el centinela honesto, medidos en el sitio de
    // llamada real y no en el constructor. Todos los dobles de aquí van por VALOR DE RETORNO y
    // no por rechazo simulado (D-14).
    describe('Fase 20.6 — cuerpo de quincena y centinela honesto', () => {
        // Requisito 1. Hasta esta fase el reporte pedía la variante por omisión y salía vestido
        // con el cuerpo del cierre de mes, contradiciendo su propio asunto.
        test('el cuerpo es el de quincena, no el del cierre de mes', async () => {
            mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00006001', '2026-05-14')] });

            await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config);

            const html = mockSendOperatorReport.mock.calls[0][0].html;
            expect(html).not.toContain('fin de mes');
            expect(html).not.toContain('al cierre del mes');
            expect(html).not.toContain('este mes');
            expect(html).toContain('Pagos pendientes');
            expect(html).toContain('en esta quincena');
        });

        // Requisito 2, y el caso que hoy falla en producción: el rótulo del cuerpo salía de la
        // fecha de la PRIMERA fila del lote —una fila arbitraria de una ventana de 365 días—
        // mientras el asunto anunciaba la quincena en curso.
        //
        // La aserción negativa va sobre el ENCABEZADO y no sobre el cuerpo entero: la tabla
        // renderiza esa fecha en su propia celda y debe hacerlo, así que exigir su ausencia
        // global sería exigir que la tabla no muestre sus datos. Sobre el encabezado se refuerza
        // a igualdad byte a byte, más estricta que la ausencia pedida: con la variante por
        // omisión este mismo lote produce «SageConnect: Pendientes fin de mes — 2025-11».
        test('el rótulo del cuerpo es el mismo que el del asunto', async () => {
            mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00006002', '2025-11-03')] });

            await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config);

            const { subject, html } = mockSendOperatorReport.mock.calls[0][0];
            const heading = html.split('\n')[0];

            expect(subject).toContain('quincena 2 — 2026-05');
            expect(html).toContain('quincena 2 — 2026-05');
            expect(heading).toBe('<h1>SageConnect: Pagos pendientes — quincena 2 — 2026-05</h1>');
            expect(heading).not.toContain('2025-11');
        });

        // El lote vacío es donde «este mes» sí discrimina: el caso vacío del cierre de mes dice
        // «Sin pendientes en esta categoría este mes». Con filas, esa cadena no aparece en
        // ninguna de las dos variantes.
        test('lote vacío: el cuerpo de quincena sigue saliendo, con su pie de nota', async () => {
            mockRunQuery.mockResolvedValue({ recordset: [] });

            await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config);

            const html = mockSendOperatorReport.mock.calls[0][0].html;
            expect(html).toContain('Sin pendientes en esta quincena');
            expect(html).toContain('no registra el detalle del error de cada pago');
            expect(html).not.toContain('este mes');

            const payload = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'payment-report-2026-05-2.sent'), 'utf8'));
            expect(payload.success).toBe(true);
            expect(payload.rowCount).toBe(0);
        });

        // Requisito 5 por el lado del éxito. El archivo ya tenía idempotencia por periodo, pero
        // ningún caso encadenaba «éxito → centinela honesto → no-op» en uno solo.
        test('transporte sano: el centinela dice success:true y el segundo tick es no-op', async () => {
            mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00006004', '2026-05-17')] });

            await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config);

            const sentinel = path.join(tmpRoot, 'payment-report-2026-05-2.sent');
            const payload = JSON.parse(fs.readFileSync(sentinel, 'utf8'));
            expect(payload.success).toBe(true);
            expect(payload.error).toBeUndefined();

            jest.clearAllMocks();
            mockSendOperatorReport.mockResolvedValue({ delivered: true, error: null });
            mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00006004', '2026-05-17')] });

            await dispatchPaymentReportIfDue(new Date(2026, 4, 16, 20, 30, 0), config);

            expect(mockSendOperatorReport).not.toHaveBeenCalled();
            expect(mockRunQuery).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------------
    // Fase 20.6 / WR-04 — la lectura en cerrado del desenlace, fijada por aserción.
    //
    // Gemelos de los dos casos de tests/integration/eom-dispatch.test.js, sobre el segundo de
    // los tres sitios de llamada. La frase «un valor ausente o malformado cae del lado de la no
    // entrega» está escrita VERBATIM en cuatro comentarios del código —src/background.js:412 y
    // :517, src/controller/PortalOC_Creator.js:778-779 y src/utils/EmailSender.js:118-120— y
    // hasta este bloque no la sostenía NINGUNA aserción: todos los dobles de la fase resolvían
    // dentro de las dos formas canónicas, así que la lectura fail-closed no la ejercitaba nadie.
    //
    // La medida exacta de lo que faltaba: mutar los sitios de llamada a
    //     if (!delivery || delivery.delivered !== false)
    // —un undefined contado como ENTREGADO— dejaba las 120 pruebas de la fase EN VERDE, y con
    // ellas reinstalado el centinela mentiroso que esta fase existe para quitar.
    //
    // Hacen falta DOS dobles porque el segundo mutante —cambiar el === por ==, que es lo que
    // produce un refactor cosmético— sobrevive a un undefined: con igualdad laxa
    // { delivered: 1 } pasa por entregado, ya que 1 == true es verdadero en JavaScript. El ===
    // del código lo rechaza, y el segundo caso del par es lo único que lo fija.
    //
    // La aserción NEGATIVA sobre el buzón de administración va en los dos: D-12 mantiene el
    // reporte quincenal sin ese respaldo —LICENSE_ADMIN_EMAIL sigue reservado al timeout del
    // proceso hijo, D-15 de la 20.5— y este bloque lo fija también en el camino del valor
    // ausente, que es por donde entraría una copia distraída del despachador de cierre de mes.
    //
    // De paso vuelven alcanzable por prueba el respaldo 'unknown delivery failure'
    // (src/background.js:583), que hasta hoy era rama muerta: es IN-05 de la revisión, que pide
    // conservarlo y volverlo alcanzable para que nadie lo borre confundiéndolo con el código
    // muerto que esta fase sí eliminó.
    // -------------------------------------------------------------------------------
    describe('Fase 20.6 / WR-04 — ausente o malformado cuenta como NO entregado', () => {
        test('resultado AUSENTE: centinela success:false con el respaldo exacto, y el buzón de administración intacto', async () => {
            mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00007001', '2026-05-14')] });
            // El doble del mutante literal de la revisión: el canal resuelve sin decir nada.
            mockSendOperatorReport.mockResolvedValueOnce(undefined);

            // RESUELVE: la notificación jamás reprueba el paso, tampoco por esta puerta.
            await expect(dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config)).resolves.toBeUndefined();

            const payload = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'payment-report-2026-05-2.sent'), 'utf8'));
            expect(payload.success).toBe(false);
            // El respaldo EXACTO, no un toMatch laxo: es la rama que este caso vuelve alcanzable.
            expect(payload.error).toBe('unknown delivery failure');
            expect(payload.rowCount).toBe(1);

            // D-12: aquí NO va respaldo al buzón de administración, tampoco por el valor ausente.
            expect(mockSendAdminAlert).not.toHaveBeenCalled();

            expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'error',
                expect.stringMatching(/^\[PAYREPORT-DISPATCH\] period=2 rows=1 sent=false err=unknown delivery failure$/));
        });

        test('resultado MALFORMADO-VERDADERO: un 1 no cuenta como entregado', async () => {
            mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00007002', '2026-05-15')] });
            // Por qué 1 y no 'true' ni {}: 1 == true es VERDADERO en JavaScript, así que éste es
            // justo el valor que la igualdad laxa dejaría pasar por entregado y que el === del
            // código rechaza. Es el único doble que mata ese mutante; el de arriba no lo toca.
            mockSendOperatorReport.mockResolvedValueOnce({ delivered: 1, error: null });

            await expect(dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config)).resolves.toBeUndefined();

            const payload = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'payment-report-2026-05-2.sent'), 'utf8'));
            expect(payload.success).toBe(false);
            // El error:null no es adorno: hace entrar el mismo respaldo que en el caso de arriba.
            expect(payload.error).toBe('unknown delivery failure');
            expect(payload.rowCount).toBe(1);

            expect(mockSendAdminAlert).not.toHaveBeenCalled();

            expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'error',
                expect.stringMatching(/^\[PAYREPORT-DISPATCH\] period=2 rows=1 sent=false err=unknown delivery failure$/));
        });
    });
});
