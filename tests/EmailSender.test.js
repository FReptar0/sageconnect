// tests/EmailSender.test.js

// Mock config to prevent process.exit(1) from config validation
jest.mock('../src/config', () => ({
    portal: {
        url: 'http://localhost',
        tenants: [
            { id: 'tenant1', key: 'key1', secret: 'secret1', database: 'TESTDB', externalId: 'ext1' }
        ]
    },
    database: { user: '', password: '', server: '', database: '' },
    mailing: {
        server: 'smtp.test',
        port: 587,
        ssl: false,
        from: 'noreply@test',
        notices: ['ops1@test.com', 'ops2@test.com', 'ops3@test.com'],
        cc: ['cc1@test.com', 'cc2@test.com'],
        password: '',
    },
    paths: { downloads: '', providers: '', logs: '' },
    app: {
        importRoute: '', arg: '', company: '', rfc: '', regimen: '', timezone: '',
        defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
        addressIdentifiersSkip: []
    },
    license: { adminEmail: 'admin@test.com' },
    // Sin esta llave todos los casos ejercitarian el respaldo heredado del accesor
    // mailTimeoutMs() en vez de la ruta de config -- justo la forma de desactivado
    // silencioso que la fase 20.4 corrigio en dos mocks de controlador.
    notifications: { mailTimeoutMs: 30000 }
}));

const mockTransportSendMail = jest.fn();
jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({ sendMail: mockTransportSendMail })),
}));

const mockLogGenerator = jest.fn();
jest.mock('../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

// fs/path: la guarda estructural del ultimo describe lee el fuente de EmailSender.js
// en vez de su comportamiento, para volver permanentes D-02 y D-03.
const fs = require('fs');
const path = require('path');

// EmailSender loads its own config internally via require('../config')
const { sendMail, sendOperatorReport } = require('../src/utils/EmailSender');

// Mismas instancias que ve EmailSender: el modulo mockeado y el mock de nodemailer.
const nodeMailer = require('nodemailer');
const mockedConfig = require('../src/config');

describe('sendMail util', () => {
    // Integration test -- requires real SMTP credentials in .env
    // Run manually: npx jest tests/EmailSender.test.js (with .env populated)
    test.skip('should send email successfully with valid data', async () => {
        const data = {
            h1: 'Prueba de envio',
            p: 'Este es un correo de prueba desde Jest.',
            status: 200,
            message: 'OK',
            position: 0,      // elegira el primer MAILING_NOTICES
            idCia: 'TESTCOMP'
        };

        const result = await sendMail(data);
        console.log('sendMail result:', result);
        // nodemailer devuelve accepted[] con direcciones que acepto
        expect(Array.isArray(result.accepted)).toBe(true);
        expect(result.accepted.length).toBeGreaterThan(0);
        expect(result.rejected).toEqual([]);
    });
});

describe('sendOperatorReport', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTransportSendMail.mockResolvedValue({ accepted: ['ops1@test.com'], rejected: [] });
    });

    test('(a) module.exports has both sendMail and sendOperatorReport', () => {
        expect(typeof sendMail).toBe('function');
        expect(typeof sendOperatorReport).toBe('function');
    });

    test('(b) REQ EOM-02: sends to FULL MAILING_NOTICES list (not notices[position])', async () => {
        await sendOperatorReport({
            subject: '[SageConnect] Test subject',
            html: '<p>Test body</p>',
            callerLogFile: 'TestCaller',
        });
        expect(mockTransportSendMail).toHaveBeenCalledTimes(1);
        const opts = mockTransportSendMail.mock.calls[0][0];
        // Full list joined with comma — not just notices[0]
        expect(opts.to).toBe('ops1@test.com,ops2@test.com,ops3@test.com');
        // Confirm it is NOT a single recipient (regression guard)
        expect(opts.to).not.toBe('ops1@test.com');
    });

    test('(c) cc = MAILING_CC (full list)', async () => {
        await sendOperatorReport({
            subject: '[SageConnect] Test',
            html: '<p>x</p>',
            callerLogFile: 'TestCaller',
        });
        const opts = mockTransportSendMail.mock.calls[0][0];
        expect(opts.cc).toEqual(['cc1@test.com', 'cc2@test.com']);
    });

    test('(d) CONTEXT D-06: does NOT include LICENSE_ADMIN_EMAIL in to or cc (operator channel only)', async () => {
        await sendOperatorReport({
            subject: '[SageConnect] Test',
            html: '<p>x</p>',
            callerLogFile: 'TestCaller',
        });
        const opts = mockTransportSendMail.mock.calls[0][0];
        // Admin email must not appear in either field — operator/admin channels are strictly separated
        expect(opts.to).not.toContain('admin@test.com');
        if (Array.isArray(opts.cc)) {
            expect(opts.cc).not.toContain('admin@test.com');
        } else {
            expect(opts.cc || '').not.toContain('admin@test.com');
        }
    });

    test('(e) REQ EOM-06 + requisito 4 de la 20.6: SMTP failure → warn log + la promesa resuelve al resultado fail-closed (no throw)', async () => {
        mockTransportSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));
        // Must NOT throw — y ademas el resultado tiene que DISTINGUIR el fallo.
        await expect(sendOperatorReport({
            subject: '[SageConnect] Will fail',
            html: '<p>x</p>',
            callerLogFile: 'TestCaller',
        })).resolves.toEqual({ delivered: false, error: 'SMTP connection refused' });
        // warn log emitted with [OPERATOR-EMAIL] prefix and the error message
        const warnCall = mockLogGenerator.mock.calls.find(c => c[1] === 'warn' && /\[OPERATOR-EMAIL\]/.test(c[2]));
        expect(warnCall).toBeDefined();
        expect(warnCall[2]).toMatch(/SMTP connection refused/);
    });

    test('(f) callerLogFile routes the log entry to the caller LOG_FILE name', async () => {
        await sendOperatorReport({
            subject: '[SageConnect] Routing test',
            html: '<p>x</p>',
            callerLogFile: 'EomNotification',
        });
        // Success log call: first arg is the callerLogFile name
        const successCall = mockLogGenerator.mock.calls.find(c => c[1] === 'info' && /\[OPERATOR-EMAIL\]/.test(c[2]));
        expect(successCall).toBeDefined();
        expect(successCall[0]).toBe('EomNotification');
    });

    test('(f.2) callerLogFile fallback to "EmailSender" when arg is missing', async () => {
        await sendOperatorReport({
            subject: '[SageConnect] Fallback test',
            html: '<p>x</p>',
            // callerLogFile intentionally omitted
        });
        const successCall = mockLogGenerator.mock.calls.find(c => c[1] === 'info' && /\[OPERATOR-EMAIL\]/.test(c[2]));
        expect(successCall).toBeDefined();
        expect(successCall[0]).toBe('EmailSender');
    });

    test('(g) regression: sendMail signature/shape unchanged (still defined as function)', () => {
        // sendMail itself remains a function with arity >= 1; deeper behavior covered by the existing skipped integration test
        expect(typeof sendMail).toBe('function');
        expect(sendMail.length).toBeGreaterThanOrEqual(1);
    });
});

describe('MAIL_TIMEOUT_MS wiring (Q3-06)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTransportSendMail.mockResolvedValue({ accepted: ['ops1@test.com'], rejected: [] });
    });

    test('(1) sendMail entrega a createTransport los tres timeouts de nodemailer', async () => {
        await sendMail({
            h1: 'Prueba', p: 'cuerpo', status: 200, message: 'OK',
            position: 0, idCia: 'TESTCOMP',
        });
        const transportConfig = nodeMailer.createTransport.mock.calls[0][0];
        expect(transportConfig.connectionTimeout).toBe(30000);
        expect(transportConfig.greetingTimeout).toBe(30000);
        expect(transportConfig.socketTimeout).toBe(30000);
    });

    test('(2) sendOperatorReport pone las tres opciones en su PROPIO transportConfig', async () => {
        // Se asserta aparte de (1) a proposito: son dos objetos distintos y arreglar uno
        // no puede darse por hecho que arregla el otro.
        await sendOperatorReport({
            subject: '[SageConnect] Prueba',
            html: '<p>x</p>',
            callerLogFile: 'TestCaller',
        });
        const transportConfig = nodeMailer.createTransport.mock.calls[0][0];
        expect(transportConfig.connectionTimeout).toBe(30000);
        expect(transportConfig.greetingTimeout).toBe(30000);
        expect(transportConfig.socketTimeout).toBe(30000);
    });

    test('(3) el valor viene de config y no de un literal: 7777 llega hasta nodemailer', async () => {
        // Esta es la guarda anti-hardcode. Si alguien reemplaza la lectura de config por
        // la constante, este caso se pone rojo; sin el, la conexion podria revertirse a un
        // literal sin que nada fallara -- el hueco exacto que la revision de 20.4 marco.
        const saved = mockedConfig.notifications.mailTimeoutMs;
        mockedConfig.notifications.mailTimeoutMs = 7777;
        try {
            await sendOperatorReport({
                subject: '[SageConnect] Prueba',
                html: '<p>x</p>',
                callerLogFile: 'TestCaller',
            });
            const transportConfig = nodeMailer.createTransport.mock.calls[0][0];
            expect(transportConfig.connectionTimeout).toBe(7777);
            expect(transportConfig.greetingTimeout).toBe(7777);
            expect(transportConfig.socketTimeout).toBe(7777);
        } finally {
            // Se restaura dentro del mismo caso para no afectar a ningun otro.
            mockedConfig.notifications.mailTimeoutMs = saved;
        }
    });

    test('(4) regresion: socketTimeout esta presente y NO es el default 600000 de nodemailer', async () => {
        // 600000 ms es el numero especifico que este requisito existe para desplazar:
        // el doble de STEP_TIMEOUT_MS e igual a CHILD_PROCESS_TIMEOUT_MS.
        await sendOperatorReport({
            subject: '[SageConnect] Prueba',
            html: '<p>x</p>',
            callerLogFile: 'TestCaller',
        });
        const transportConfig = nodeMailer.createTransport.mock.calls[0][0];
        expect(transportConfig.socketTimeout).toBeDefined();
        expect(transportConfig.socketTimeout).not.toBe(600000);
    });
});

describe('contrato de entrega de sendOperatorReport (fase 20.6, D-01 / D-02 / D-03 / D-14)', () => {
    // D-14: el contrato se fija por el VALOR DE RETORNO, no por un rechazo simulado.
    // WR-09 de la revision de la 20.5 senalo que las pruebas de esa fase simulaban a
    // sendOperatorReport RECHAZANDO, un estado que produccion no puede alcanzar porque
    // la funcion nunca lanza: una prueba verde era compatible con el defecto en vivo.
    beforeEach(() => {
        jest.clearAllMocks();
        mockTransportSendMail.mockResolvedValue({ accepted: ['ops1@test.com'], rejected: [] });
    });

    test('(a) D-01: con el transporte sano el resultado es exactamente { delivered: true, error: null }', async () => {
        const result = await sendOperatorReport({
            subject: '[SageConnect] Entrega buena',
            html: '<p>x</p>',
            callerLogFile: 'TestCaller',
        });
        expect(result).toEqual({ delivered: true, error: null });
    });

    test('(b) D-01 + D-02: con el transporte caido el resultado trae el mensaje y la llamada RESUELVE', async () => {
        mockTransportSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));
        // .resolves falla si la promesa rechaza, asi que este caso fija las dos mitades del
        // contrato a la vez: el desenlace Y el hecho de que ninguna via nueva lo vuelva
        // lanzable. Es la aserta que se pondria roja si alguien agregara un interruptor.
        await expect(sendOperatorReport({
            subject: '[SageConnect] Entrega perdida',
            html: '<p>x</p>',
            callerLogFile: 'TestCaller',
        })).resolves.toEqual({ delivered: false, error: 'SMTP connection refused' });
    });

    test('(c) requisito 4: los dos desenlaces son DISTINGUIBLES por el valor de retorno', async () => {
        // La casilla literal del requisito 4, y no se deduce de (a) y (b) por separado:
        // dos casos que assertan formas correctas seguirian verdes si la funcion devolviera
        // la MISMA constante en las dos ramas. Aqui se comparan los dos desenlaces entre si.
        const ok = await sendOperatorReport({
            subject: '[SageConnect] Transporte sano',
            html: '<p>x</p>',
            callerLogFile: 'TestCaller',
        });

        mockTransportSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));
        const fail = await sendOperatorReport({
            subject: '[SageConnect] Transporte caido',
            html: '<p>x</p>',
            callerLogFile: 'TestCaller',
        });

        expect(ok.delivered).not.toBe(fail.delivered);
        expect(ok.delivered).toBe(true);
        expect(fail.delivered).toBe(false);
    });

    test('(d) T-20.6-01: la pila del error NO se filtra al resultado, solo el mensaje', async () => {
        const err = new Error('Invalid login');
        // Pila fabricada a mano: es la forma de meter un secreto en el error sin ponerlo en
        // el mock de config. El texto que sale de esta funcion viaja a un archivo de
        // bitacora y a un archivo centinela en el servidor del cliente.
        err.stack = 'Error: Invalid login\n    at SMTPConnection (auth user=noreply@test pass=p4ssw0rd-de-prueba)';
        mockTransportSendMail.mockRejectedValueOnce(err);

        const result = await sendOperatorReport({
            subject: '[SageConnect] Con secreto en la pila',
            html: '<p>x</p>',
            callerLogFile: 'TestCaller',
        });

        expect(result.error).toBe('Invalid login');
        expect(JSON.stringify(result)).not.toContain('p4ssw0rd-de-prueba');
    });

    test('(e) guarda estructural: D-02 y D-03 vueltos permanentes sobre el fuente', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'src', 'utils', 'EmailSender.js'),
            'utf8'
        );
        const start = source.indexOf('async function sendOperatorReport');
        const end = source.indexOf('module.exports');
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);

        const region = source.slice(start, end);
        // Una guarda que solo asserta ausencias esta a un refactor de pasar por estar
        // mirando una rebanada vacia (patron adoptado en la 20.5-04). Primero se prueba
        // que la rebanada NO es vacua.
        expect(region.length).toBeGreaterThan(500);
        expect(region).toContain('delivered: true');
        expect(region).toContain('delivered: false');

        // D-02: nada vuelve lanzable esta funcion, ni siquiera bajo un parametro.
        // D-03: nada retiene estado entre ticks para transportar el resultado.
        expect(region).not.toContain('throw');
        expect(region).not.toContain('throwOnFailure');
        expect(region).not.toContain('EventEmitter');

        // T-20.6-01. El criterio escrito del plan pedia que la region ENTERA no mencionara
        // la clave de correo, pero la funcion la lee de forma legitima para armar `auth` y
        // el plan prohibe tocar ese bloque: el criterio literal es insatisfacible. La region
        // que de verdad importa para la fuga es la que PRODUCE el campo `error`, y ahi la
        // guarda queda mas fuerte que la pedida: no menciona NINGUN campo del servidor de
        // correo, no solo la clave, ni lee propiedad alguna de la excepcion mas alla del
        // mensaje.
        const catchRegion = region.slice(region.indexOf('} catch (err) {'));
        expect(catchRegion.length).toBeGreaterThan(50);
        expect(catchRegion).toContain('delivered: false');
        expect(catchRegion).not.toContain('config.mailing');
        expect(catchRegion).not.toContain('.stack');
    });
});
