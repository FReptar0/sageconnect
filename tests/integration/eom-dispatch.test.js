// tests/integration/eom-dispatch.test.js (NEW — Phase 20 Plan 20-07)
//
// Integration coverage for SPEC EOM-04's 3 acceptance scenarios, exercising the
// dispatchEomIfDue() path inserted at the top of forResponse() in src/background.js:
//   (a) first tick of the last day  → two emails sent + sentinels success:true
//   (b) second tick same month      → sentinel-present silent skip, no resend
//   (c) first tick with SMTP failure→ sentinel success:false + admin alert + no resend
//
// Strategy: mock src/config (with retry.scope='last_n_days' to PROVE the EOM data
// query ignores it and HARDCODES current_month per CONTEXT D-09), mock LogGenerator,
// mock SQLServerConnection.runQuery for canned recordsets, and mock the two email
// senders (EmailSender.sendOperatorReport + AdminEmailSender.sendAdminAlert) directly
// — those helpers swallow SMTP failures internally, so to drive the success/failure
// branches of dispatchEomIfDue we control the senders themselves. Sentinel files are
// written to a real temp dir and asserted via fs.readFileSync + JSON.parse.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { describe, test, expect, beforeEach, afterAll } = require('@jest/globals');

const tmpRoot = path.join(os.tmpdir(), `sageconnect-eom-integration-${process.pid}`);

// Shared mock for src/config — needed BEFORE requires so nested utility loads see it.
jest.mock('../../src/config', () => {
    const nodePath = require('path');
    const nodeOs = require('os');
    const tmpLogs = nodePath.join(nodeOs.tmpdir(), `sageconnect-eom-integration-${process.pid}`);
    return {
        portal: {
            url: 'http://test',
            tenants: [{ id: 'T1', key: 'k1', secret: 's1', database: 'COPDAT', externalId: 'ext1' }],
            httpTimeoutMs: 30000,
        },
        paths: { downloads: '/tmp/dl', providers: '/tmp/p', logs: tmpLogs },
        database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
        mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', notices: ['ops@test.com', 'ops2@test.com'], cc: ['cc@test.com'], password: '' },
        license: { adminEmail: 'admin@test.com' },
        app: {
            company: 'TestCo', timezone: 'America/Mexico_City', rfc: 'RFC', regimen: 'R1', arg: 'A1', importRoute: '',
            baseUrl: 'http://localhost:3030',
            defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
            addressIdentifiersSkip: [],
        },
        security: { apiKey: 'test-key' },
        schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 0, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
        // Intentionally NOT current_month — proves the EOM data query HARDCODES current_month per D-09.
        retry: { scope: 'last_n_days', lookbackDays: 7, backoff: { initialMin: 15, multiplier: 2, maxMin: 1440 } },
        eom: { notificationHour: 18, notificationEnabled: true },
    };
});

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

// dispatchEomIfDue drives sendOperatorReport (operator email) and, on its failure,
// sendAdminAlert (admin fallback). Mock both directly so we can control success/failure.
const mockSendOperatorReport = jest.fn();
jest.mock('../../src/utils/EmailSender', () => ({
    sendMail: jest.fn(),
    sendOperatorReport: mockSendOperatorReport,
}));

const mockSendAdminAlert = jest.fn();
jest.mock('../../src/utils/AdminEmailSender', () => ({
    sendAdminAlert: mockSendAdminAlert,
    findLastOpenStep: jest.fn(),
}));

// dispatchEomIfDue is exported from background.js for testability.
// buildEomDataQuery comes from the same module and is a pure string builder — the
// RETRY-S3 shape assertions below call it directly, no DB and no extra mocks needed.
const { dispatchEomIfDue, buildEomDataQuery } = require('../../src/background');
const config = require('../../src/config');

describe('EOM dispatch integration (Phase 20, SPEC EOM-04)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
        fs.mkdirSync(tmpRoot, { recursive: true });
        // Por omisión el correo del operador SE ENTREGA. El doble refleja el contrato real
        // (D-14 de la 20.6): el canal devuelve el desenlace de la entrega y nunca rechaza,
        // así que un valor ausente contaría como NO entregado en el sitio de llamada, que
        // lee en cerrado. Antes de la 20.6 este doble resolvía vacío y era inerte porque
        // nadie leía el retorno; hoy lo leen los tres despachadores.
        mockSendOperatorReport.mockResolvedValue({ delivered: true, error: null });
        // El escalamiento SÍ resuelve vacío, y se queda así a propósito: sendAdminAlert no
        // cambió de contrato en la fase 20.6. No lo "alinees" con el de arriba.
        mockSendAdminAlert.mockResolvedValue(undefined);
    });

    afterAll(() => {
        if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    test('REQ EOM-04 (a): first tick of last day → emails sent + sentinels created with success:true', async () => {
        const lastDayLateHour = new Date(2026, 4, 31, 18, 5, 0); // May 31, 18:05 local
        // runQuery returns 1 row per tenant per category (1 tenant × 2 categories = 2 calls).
        mockRunQuery
            .mockResolvedValueOnce({ recordset: [{ tenant: 'COPDAT', idOrPo: 'PO0083449', fechaAuth: '2026-05-07', attempts: 3, lastError: 'CFDI VENDOR_NOT_FOUND' }] }) // POs
            // Payments rows carry no error description — the fixed query cannot produce one (RETRY-S3).
            .mockResolvedValueOnce({ recordset: [{ tenant: 'COPDAT', idOrPo: 'PAY00001234', fechaAuth: '2026-05-12', attempts: 1 }] }); // payments

        await dispatchEomIfDue(lastDayLateHour, config);

        // Both emails sent (1 per category) to the operator mailbox.
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(2);
        const posCall = mockSendOperatorReport.mock.calls[0][0];
        expect(posCall.subject).toMatch(/Pendientes fin de mes — POs — 2026-05/);
        expect(posCall.callerLogFile).toBe('EomNotification');
        const payCall = mockSendOperatorReport.mock.calls[1][0];
        expect(payCall.subject).toMatch(/Pendientes fin de mes — Pagos — 2026-05/);
        // No admin alert on the success path.
        expect(mockSendAdminAlert).not.toHaveBeenCalled();
        // Sentinels exist with success:true.
        const sentinelPos = path.join(tmpRoot, 'eom-2026-05-pos.sent');
        const sentinelPay = path.join(tmpRoot, 'eom-2026-05-payments.sent');
        expect(fs.existsSync(sentinelPos)).toBe(true);
        expect(fs.existsSync(sentinelPay)).toBe(true);
        const posPayload = JSON.parse(fs.readFileSync(sentinelPos, 'utf8'));
        expect(posPayload.success).toBe(true);
        expect(posPayload.rowCount).toBe(1);
        const payPayload = JSON.parse(fs.readFileSync(sentinelPay, 'utf8'));
        expect(payPayload.success).toBe(true);
        expect(payPayload.rowCount).toBe(1);
        // Log entries.
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/^\[EOM-DISPATCH\] category=pos rows=1 sent=true$/));
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/^\[EOM-GATE\] category=pos /));
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/^\[EOM-SENTINEL\] path=.*eom-2026-05-pos\.sent.*payload=/));
    });

    test('REQ EOM-04 (b): second tick same month → no resend, [EOM-SKIP] sentinel-present', async () => {
        const lastDayLaterTick = new Date(2026, 4, 31, 18, 10, 0); // May 31, 18:10 local
        // Pre-write both sentinels (simulating a previous successful tick).
        const sentinelPos = path.join(tmpRoot, 'eom-2026-05-pos.sent');
        const sentinelPay = path.join(tmpRoot, 'eom-2026-05-payments.sent');
        fs.writeFileSync(sentinelPos, JSON.stringify({ timestamp: '2026-05-31T18:05:00.000Z', success: true, rowCount: 1 }));
        fs.writeFileSync(sentinelPay, JSON.stringify({ timestamp: '2026-05-31T18:05:00.000Z', success: true, rowCount: 1 }));
        const posBefore = fs.readFileSync(sentinelPos, 'utf8');

        await dispatchEomIfDue(lastDayLaterTick, config);

        // No emails sent (sentinel blocks the gate).
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(mockSendAdminAlert).not.toHaveBeenCalled();
        // No runQuery calls (skip happened before any query).
        expect(mockRunQuery).not.toHaveBeenCalled();
        // [EOM-SKIP] log entries for both categories.
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/^\[EOM-SKIP\] category=pos reason=gate-false$/));
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/^\[EOM-SKIP\] category=payments reason=gate-false$/));
        // Sentinel content unchanged.
        expect(fs.readFileSync(sentinelPos, 'utf8')).toBe(posBefore);
    });

    test('REQ EOM-04 (c): el transporte NO ENTREGA → sentinel success:false + admin alert + no resend on subsequent ticks', async () => {
        const lastDayLateHour = new Date(2026, 4, 31, 18, 5, 0);
        // El correo del operador NO SE ENTREGA en ninguna de las dos categorías; el
        // escalamiento sí sale. El doble devuelve el desenlace en vez de rechazar: ése es
        // el contrato real desde la 20.6 (D-01 / D-14), y un rechazo simulado describía un
        // estado que producción no puede alcanzar — hallazgo WR-09 de la revisión de la 20.5.
        // Las aserciones de abajo no se tocaron: lo que estaba mal era el doble, no ellas.
        mockSendOperatorReport
            .mockResolvedValueOnce({ delivered: false, error: 'SMTP connection refused' }) // POs — no entregado
            .mockResolvedValueOnce({ delivered: false, error: 'SMTP connection refused' }); // payments — no entregado
        mockRunQuery
            .mockResolvedValueOnce({ recordset: [{ tenant: 'COPDAT', idOrPo: 'PO0083449', fechaAuth: '2026-05-07', attempts: 3, lastError: 'X' }] })
            // Payments rows carry no error description — the fixed query cannot produce one (RETRY-S3).
            .mockResolvedValueOnce({ recordset: [{ tenant: 'COPDAT', idOrPo: 'PAY00001234', fechaAuth: '2026-05-12', attempts: 1 }] });

        await dispatchEomIfDue(lastDayLateHour, config);

        // Operator email attempted twice; admin alert fired twice (one per category).
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(2);
        expect(mockSendAdminAlert).toHaveBeenCalledTimes(2);
        const adminSubjects = mockSendAdminAlert.mock.calls.map(c => c[0]);
        expect(adminSubjects[0]).toMatch(/EOM email FAILED for 2026-05 - pos/);
        expect(adminSubjects[1]).toMatch(/EOM email FAILED for 2026-05 - payments/);
        // Sentinels created with success:false.
        const sentinelPos = path.join(tmpRoot, 'eom-2026-05-pos.sent');
        const sentinelPay = path.join(tmpRoot, 'eom-2026-05-payments.sent');
        const posPayload = JSON.parse(fs.readFileSync(sentinelPos, 'utf8'));
        expect(posPayload.success).toBe(false);
        expect(posPayload.error).toMatch(/SMTP connection refused/);
        const payPayload = JSON.parse(fs.readFileSync(sentinelPay, 'utf8'));
        expect(payPayload.success).toBe(false);
        // Subsequent tick: sentinel-present blocks resend.
        jest.clearAllMocks();
        mockSendOperatorReport.mockResolvedValue({ delivered: true, error: null });
        await dispatchEomIfDue(new Date(2026, 4, 31, 18, 30, 0), config);
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(mockRunQuery).not.toHaveBeenCalled();
    });

    // Fase 20.6, requisito 7 — la evidencia directa de que el escalamiento de REQ EOM-04
    // dejó de ser código muerto. El caso (c) de arriba ya recorre la rama, pero sobre dos
    // categorías a la vez; éste la reduce a una sola para que, si se pone rojo, el dedo
    // apunte a la rama y no al arnés. La otra categoría se cierra con su propio centinela,
    // que es el mecanismo que el despachador ya tiene, no un mock nuevo.
    test('requisito 7: la rama de fallo es alcanzable con el contrato real (una sola categoría)', async () => {
        const lastDayLateHour = new Date(2026, 4, 31, 18, 5, 0);
        // Cierra la compuerta de payments: sólo pos queda en juego.
        fs.writeFileSync(path.join(tmpRoot, 'eom-2026-05-payments.sent'),
            JSON.stringify({ timestamp: '2026-05-31T18:00:00.000Z', success: true, rowCount: 0 }));
        mockSendOperatorReport.mockResolvedValue({ delivered: false, error: 'mailbox unavailable' });
        mockRunQuery.mockResolvedValueOnce({ recordset: [{ tenant: 'COPDAT', idOrPo: 'PO0083449', fechaAuth: '2026-05-07', attempts: 2, lastError: 'X' }] });

        // RESUELVE, no rechaza: la rama corre entera y nada escapa hacia forResponse. La
        // restricción rectora de la fase — la notificación jamás reprueba el tick — se
        // sostiene también ahora que la rama se ejecuta de verdad.
        await expect(dispatchEomIfDue(lastDayLateHour, config)).resolves.toBeUndefined();

        // Un solo envío (payments quedó fuera por su centinela) y un solo escalamiento.
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(1);
        expect(mockSendAdminAlert).toHaveBeenCalledTimes(1);
        expect(mockSendAdminAlert.mock.calls[0][0]).toMatch(/EOM email FAILED for 2026-05 - pos/);
        expect(mockSendAdminAlert.mock.calls[0][1]).toMatch(/mailbox unavailable/);
        expect(mockSendAdminAlert.mock.calls[0][2]).toBe('EomNotification');

        // La línea de bitácora en nivel error es la prueba de que el código dejó de estar
        // muerto: antes de la 20.6 era inalcanzable y nunca se emitió en producción.
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'error',
            expect.stringMatching(/^\[EOM-DISPATCH\] category=pos rows=1 sent=false err=mailbox unavailable$/));
        // Y la de éxito NO se emitió: el sistema deja de afirmar una entrega que no consta.
        expect(mockLogGenerator).not.toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/sent=true/));

        // El centinela se escribe igual (REQ EOM-04 / D-07), ahora con payload honesto.
        const posPayload = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'eom-2026-05-pos.sent'), 'utf8'));
        expect(posPayload.success).toBe(false);
        expect(posPayload.error).toBe('mailbox unavailable');
        expect(posPayload.rowCount).toBe(1);
    });

    // -------------------------------------------------------------------------------
    // Fase 20.6 / WR-04 — la lectura en cerrado del desenlace, fijada por aserción.
    //
    // La frase «un valor ausente o malformado cae del lado de la no entrega» está escrita
    // VERBATIM en cuatro comentarios del código — src/background.js:412 y :517,
    // src/controller/PortalOC_Creator.js:778-779 y src/utils/EmailSender.js:118-120 — y hasta
    // este bloque no la sostenía NINGUNA aserción. Todos los dobles de la fase resolvían o
    // { delivered: true, error: null } o { delivered: false, error: '…' }: ninguno salía de las
    // dos formas canónicas, así que la lectura fail-closed no la ejercitaba nadie.
    //
    // Lo que eso costaba, y no es una hipótesis: mutar los sitios de llamada a
    //     if (!delivery || delivery.delivered !== false)
    // —que trata un undefined como ENTREGADO— dejaba las 120 pruebas de la fase EN VERDE y
    // reinstalaba exactamente el centinela mentiroso que esta fase existe para quitar.
    //
    // Por qué hacen falta DOS dobles y no uno. Ese mutante lo mata un resultado ausente. Pero
    // hay un segundo, que un refactor cosmético produce con toda naturalidad —cambiar el ===
    // por ==— y que un undefined NO distingue: con la igualdad laxa, { delivered: 1 } pasa por
    // entregado, porque 1 == true es verdadero en JavaScript, mientras que el === del código lo
    // rechaza. De ahí el segundo caso del par.
    //
    // De paso, los dos vuelven ALCANZABLE POR PRUEBA el texto de respaldo
    // 'unknown delivery failure' (src/background.js:466), que hasta hoy era rama muerta. Es
    // IN-05 de la revisión: el respaldo se conserva a propósito como defensa fail-closed barata,
    // y volverlo alcanzable es lo que lo protege de una futura auditoría de código muerto que lo
    // confunda con el patrón que esta fase sí eliminó.
    // -------------------------------------------------------------------------------
    describe('Fase 20.6 / WR-04 — ausente o malformado cuenta como NO entregado', () => {
        // Misma técnica que el caso del requisito 7: la compuerta de payments se cierra con su
        // propio centinela para que sólo pos quede en juego y, si el caso se pone rojo, el dedo
        // apunte a la rama y no al arnés.
        const cerrarCompuertaDePayments = () => {
            fs.writeFileSync(path.join(tmpRoot, 'eom-2026-05-payments.sent'),
                JSON.stringify({ timestamp: '2026-05-31T18:00:00.000Z', success: true, rowCount: 0 }));
        };

        test('resultado AUSENTE: centinela success:false, respaldo exacto y escalamiento igual', async () => {
            cerrarCompuertaDePayments();
            // El doble del mutante literal de la revisión: el canal resuelve sin decir nada.
            mockSendOperatorReport.mockResolvedValue(undefined);
            mockRunQuery.mockResolvedValueOnce({ recordset: [{ tenant: 'COPDAT', idOrPo: 'PO0083501', fechaAuth: '2026-05-09', attempts: 4, lastError: 'X' }] });

            // RESUELVE: la notificación jamás reprueba el paso, tampoco por esta puerta.
            await expect(dispatchEomIfDue(new Date(2026, 4, 31, 18, 5, 0), config)).resolves.toBeUndefined();

            const posPayload = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'eom-2026-05-pos.sent'), 'utf8'));
            expect(posPayload.success).toBe(false);
            // El respaldo EXACTO, no un toMatch laxo: es la rama que este caso vuelve alcanzable.
            expect(posPayload.error).toBe('unknown delivery failure');

            // El escalamiento de REQ EOM-04 corre igual: una no entrega es una no entrega.
            expect(mockSendAdminAlert).toHaveBeenCalledTimes(1);

            // Y el sistema no afirma una entrega que no consta.
            expect(mockLogGenerator).not.toHaveBeenCalledWith('EomNotification', 'info',
                expect.stringMatching(/sent=true/));
        });

        test('resultado MALFORMADO-VERDADERO: un 1 no cuenta como entregado', async () => {
            cerrarCompuertaDePayments();
            // Por qué 1 y no 'true' ni {}: 1 == true es VERDADERO en JavaScript, así que éste es
            // justo el valor que la igualdad laxa dejaría pasar por entregado y que el === del
            // código rechaza. Es el único doble que mata ese mutante; el de arriba no lo toca.
            mockSendOperatorReport.mockResolvedValue({ delivered: 1, error: null });
            mockRunQuery.mockResolvedValueOnce({ recordset: [{ tenant: 'COPDAT', idOrPo: 'PO0083502', fechaAuth: '2026-05-10', attempts: 2, lastError: 'X' }] });

            await expect(dispatchEomIfDue(new Date(2026, 4, 31, 18, 5, 0), config)).resolves.toBeUndefined();

            const posPayload = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'eom-2026-05-pos.sent'), 'utf8'));
            expect(posPayload.success).toBe(false);
            // El error:null no es adorno: hace entrar el mismo respaldo que en el caso de arriba.
            expect(posPayload.error).toBe('unknown delivery failure');

            expect(mockSendAdminAlert).toHaveBeenCalledTimes(1);

            expect(mockLogGenerator).not.toHaveBeenCalledWith('EomNotification', 'info',
                expect.stringMatching(/sent=true/));
        });
    });
});

describe('buildEomDataQuery SQL shape (Phase 20.2, SPEC RETRY-S3)', () => {
    test('payments branch references only columns that exist on fesa.dbo.fesaPagosFocaltec', () => {
        const sql = buildEomDataQuery('payments', 'COPDAT');

        // fesa.dbo.fesaPagosFocaltec has exactly four columns — idCia, NoPagoSage, status,
        // idFocaltec (production schema read 2026-07-27 on ZCL-SQL-01). Selecting an error
        // description or ordering by an update timestamp made SQL Server abort the whole
        // statement; the try/catch at background.js:398 swallowed it, so the month-end
        // payments email always read "Sin pendientes" and the failure was invisible.
        expect(sql).not.toMatch(/responseAPI/);
        expect(sql).not.toMatch(/lastUpdate/);
        expect(sql).not.toMatch(/lastError/);

        // What the query must keep: a real attempt count and the pending-payment predicate.
        expect(sql).toMatch(/OUTER APPLY/);
        expect(sql).toMatch(/COUNT\(\*\) AS errorCount/);
        expect(sql).toMatch(/COALESCE\(ef\.errorCount, 0\) AS attempts/);
        expect(sql).toMatch(/status NOT IN \('PAID', ?'PARTIAL'\)/);
        expect(sql).toMatch(/fesa\.dbo\.fesaPagosFocaltec/);
    });

    test('POs branch is unchanged — still selects responseAPI and orders by lastUpdate (D-11)', () => {
        const sql = buildEomDataQuery('pos', 'COPDAT');

        // fesaOCFocaltec genuinely has responseAPI and lastUpdate and carries real data, so
        // the two branches are deliberately asymmetric. This is the D-11 regression guard.
        expect(sql).toMatch(/responseAPI/);
        expect(sql).toMatch(/ORDER BY lastUpdate DESC/);
        expect(sql).toMatch(/ef\.lastError AS lastError/);
    });
});
