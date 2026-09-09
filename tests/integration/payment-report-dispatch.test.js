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
        mockSendOperatorReport.mockResolvedValue(undefined);
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
        mockSendOperatorReport.mockResolvedValue(undefined);
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
        mockSendOperatorReport.mockResolvedValue(undefined);
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
    test('SMTP caído: el centinela se escribe igual con success:false y NO se avisa al buzón de administración', async () => {
        mockRunQuery.mockResolvedValue({ recordset: [ROW('PAY00005555', '2026-05-13')] });
        mockSendOperatorReport.mockRejectedValueOnce(new Error('SMTP connection refused'));

        await expect(dispatchPaymentReportIfDue(new Date(2026, 4, 16, 18, 5, 0), config)).resolves.toBeUndefined();

        const payload = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'payment-report-2026-05-2.sent'), 'utf8'));
        expect(payload.success).toBe(false);
        expect(payload.error).toMatch(/SMTP connection refused/);
        expect(payload.rowCount).toBe(1);

        expect(mockSendAdminAlert).not.toHaveBeenCalled();
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
});
