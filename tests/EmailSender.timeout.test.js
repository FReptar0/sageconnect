// tests/EmailSender.timeout.test.js
//
// La mitad de COMPORTAMIENTO de Q3-06 (SPEC casilla 14).
//
// Este archivo NO mockea nodemailer -- esa es su unica razon de existir. La mitad de
// cableado, que si lo mockea y asserta sobre createTransport.mock.calls, vive en
// tests/EmailSender.test.js; jest.mock tiene alcance de archivo, asi que las dos mitades
// no pueden convivir. Aqui se levanta un socket TCP real que acepta la conexion y jamas
// escribe el saludo 220 de SMTP: es el fallo que, sin los timeouts, dejaria a nodemailer
// colgado sus 600000 ms de default.

const net = require('net');

jest.mock('../src/config', () => ({
    mailing: {
        server: '127.0.0.1',
        // Reasignado en beforeAll al puerto efimero real del stub.
        port: 0,
        ssl: false,
        from: 'sageconnect@example.test',
        notices: ['ops@example.test'],
        cc: [],
        // Sin password no se adjunta `auth`, asi que el stub no tiene que negociar nada.
        password: '',
    },
    notifications: {
        // 1500 es un valor DE PRUEBA elegido por tiempo de ejecucion. En produccion el
        // piso es 1000 y el default 30000; este caso prueba la PLOMERIA, no el default.
        mailTimeoutMs: 1500,
    },
}));

const mockLogGenerator = jest.fn();
jest.mock('../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const { sendOperatorReport } = require('../src/utils/EmailSender');
const mockedConfig = require('../src/config');

let stubServer;
const stubSockets = [];

beforeAll(async () => {
    await new Promise((resolve) => {
        stubServer = net.createServer((socket) => {
            // Acepta y no escribe NADA. Ni saludo, ni cierre. Se guarda la referencia
            // solo para poder destruirla en afterAll: net.Server.close() espera a que
            // toda conexion viva termine antes de invocar su callback.
            stubSockets.push(socket);
            socket.on('error', () => { /* el destroy del cliente al vencer es esperado */ });
        });
        stubServer.listen(0, '127.0.0.1', resolve);
    });
    mockedConfig.mailing.port = stubServer.address().port;
});

afterAll(async () => {
    stubSockets.forEach((socket) => socket.destroy());
    // CLAUDE.md 3: la disciplina de ciclo de vida aplica al propio rastro de la prueba.
    // Se asserta que el callback de close corrio, es decir que no queda listener vivo.
    const closed = await new Promise((resolve) => stubServer.close(() => resolve(true)));
    expect(closed).toBe(true);
});

beforeEach(() => {
    mockLogGenerator.mockClear();
});

describe('EmailSender contra un SMTP que acepta y nunca saluda (Q3-06)', () => {
    test('(1) SPEC casilla 14: sendOperatorReport se resuelve en segundos, no en diez minutos', async () => {
        const started = Date.now();
        await expect(sendOperatorReport({
            subject: '[SageConnect] Prueba de timeout',
            html: '<p>cuerpo</p>',
            callerLogFile: 'EmailSender',
        })).resolves.toBeUndefined();
        const elapsed = Date.now() - started;
        // Cota generosa sobre 1500 ms a proposito: lo que importa es "cierra en segundos"
        // frente a un default que lo habria dejado colgado 600000 ms. El timeout explicito
        // de Jest hace que una regresion falle como timeout en vez de colgar la corrida.
        expect(elapsed).toBeLessThan(6000);
    }, 15000);

    test('(2) el contrato de tragar el error sigue vivo en la ruta que crea el timeout', async () => {
        await sendOperatorReport({
            subject: '[SageConnect] Prueba de timeout',
            html: '<p>cuerpo</p>',
            callerLogFile: 'EmailSender',
        });
        const warnCall = mockLogGenerator.mock.calls.find(
            (c) => c[1] === 'warn' && /^\[OPERATOR-EMAIL\] Failed:/.test(c[2])
        );
        expect(warnCall).toBeDefined();
        expect(warnCall[0]).toBe('EmailSender');
    }, 15000);

    test('(3) resuelve a undefined y ningun rechazo se escapa', async () => {
        await expect(sendOperatorReport({
            subject: '[SageConnect] Prueba de timeout',
            html: '<p>cuerpo</p>',
            callerLogFile: 'EmailSender',
        })).resolves.toBeUndefined();
    }, 15000);

    test('(4) control: sin la llave en el mock, el respaldo del accesor tampoco truena', async () => {
        // Documenta el respaldo como ruta intencional y probada, no como codigo muerto.
        const savedTimeout = mockedConfig.notifications.mailTimeoutMs;
        const savedPort = mockedConfig.mailing.port;
        delete mockedConfig.notifications.mailTimeoutMs;

        // Se reserva un puerto efimero y se libera: nada escucha ahi, asi que el connect
        // termina en ECONNREFUSED de inmediato. Se elige la forma que RECHAZA en vez de
        // una que cuelga porque el respaldo son 30000 ms y esperarlos no probaria nada
        // extra, solo haria lenta la suite.
        const probe = net.createServer();
        await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
        const deadPort = probe.address().port;
        await new Promise((resolve) => probe.close(resolve));
        mockedConfig.mailing.port = deadPort;

        try {
            const started = Date.now();
            await expect(sendOperatorReport({
                subject: '[SageConnect] Respaldo',
                html: '<p>cuerpo</p>',
                callerLogFile: 'EmailSender',
            })).resolves.toBeUndefined();
            expect(Date.now() - started).toBeLessThan(2000);
        } finally {
            mockedConfig.notifications.mailTimeoutMs = savedTimeout;
            mockedConfig.mailing.port = savedPort;
        }
    }, 15000);
});
