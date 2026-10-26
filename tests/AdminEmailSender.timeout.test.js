// tests/AdminEmailSender.timeout.test.js
//
// La mitad de COMPORTAMIENTO de CR-01 (fase 20.6).
//
// Este archivo NO mockea nodemailer -- esa es su unica razon de existir. La mitad de
// cableado, que si lo mockea y asserta sobre createTransport.mock.calls, vive en
// tests/AdminEmailSender.test.js; jest.mock tiene alcance de archivo, asi que las dos
// mitades no pueden convivir. Aqui se levanta un socket TCP real que acepta la conexion y
// jamas escribe el saludo 220 de SMTP: es el fallo que, sin los tres timeouts explicitos,
// dejaria a nodemailer colgado su default de inactividad de socket.
//
// Si algun dia parece buena idea fusionar los dos archivos "para que corra mas rapido",
// esta nota es la respuesta: mockear nodemailer aqui borraria justo lo que se mide.

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
    license: { adminEmail: 'admin@example.test' },
    notifications: {
        // 1500 es un valor DE PRUEBA elegido por tiempo de ejecucion. En produccion el
        // piso es 1000 y el default 30000; este archivo prueba la PLOMERIA, no el default.
        mailTimeoutMs: 1500,
    },
}));

const mockLogGenerator = jest.fn();
jest.mock('../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const { sendAdminAlert } = require('../src/utils/AdminEmailSender');
// El withStepTimeout REAL, sin mockear: el caso (3) no probaria nada contra un doble.
const { withStepTimeout } = require('../src/utils/duration');
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

describe('AdminEmailSender contra un SMTP que acepta y nunca saluda (CR-01)', () => {
    test('(1) sendAdminAlert se resuelve en segundos, no en diez minutos', async () => {
        const started = Date.now();

        await expect(
            sendAdminAlert('[SageConnect] Prueba de timeout', '<p>cuerpo</p>', 'TestCaller')
        ).resolves.toBeUndefined();

        const elapsed = Date.now() - started;
        // Cota generosa sobre 1500 ms a proposito: lo que importa es "cierra en segundos".
        // El timeout explicito de Jest hace que una regresion falle como timeout en vez de
        // colgar la corrida entera.
        expect(elapsed).toBeLessThan(6000);
    }, 15000);

    test('(2) el contrato de tragar el error sigue vivo en la ruta que crea el timeout', async () => {
        // Que el modulo trague, y que trague POR ESTA RUTA, son dos hechos distintos.
        // El caso (5) de la mitad de cableado asegura el primero contra un rechazo
        // fabricado; este asegura el segundo contra un socket real que se queda mudo.
        await sendAdminAlert('[SageConnect] Prueba de timeout', '<p>cuerpo</p>', 'TestCaller');

        const warnCall = mockLogGenerator.mock.calls.find(
            (c) => c[1] === 'warn' && /^\[ADMIN-EMAIL\] Failed to send admin alert:/.test(c[2])
        );
        expect(warnCall).toBeDefined();
        expect(warnCall[0]).toBe('TestCaller');
    }, 15000);

    test('(3) el envio cabe dentro de un presupuesto de paso real', async () => {
        // ESTE es el caso que convierte el cierre en algo reutilizable, y la aritmetica que
        // origino CR-01 vive aqui y en ningun otro comentario del archivo -- una aritmetica
        // escrita en dos lugares es una que va a divergir:
        //
        //   socketTimeout por omision de nodemailer 6.9.16 = 600000 ms
        //     (node_modules/nodemailer/lib/smtp-connection/index.js)
        //   STEP_TIMEOUT_MS por omision                     = 300000 ms
        //     (src/config.js:237)
        //
        // 600000 > 300000: antes del arreglo este caso habria RECHAZADO, porque el envio se
        // habria colgado y la carrera la habria ganado el temporizador del presupuesto.
        //
        // Sobre el temporizador que withStepTimeout NO cancela (src/utils/duration.js:45-48,
        // deliberado por D-10, tolerancia a continuacion fantasma): con un presupuesto de
        // 4000 ms y un envio que cierra en ~1500, queda un temporizador vivo ~2.5 s despues
        // de este caso, y Jest tarda ese pelo mas en cerrar el archivo. Es ESPERADO y no es
        // un defecto: no "arregles" duration.js, que es archivo critico y esta fuera del
        // alcance de este plan. Se eligen 4000 y no un numero mayor precisamente por eso:
        // holgado frente a 1500 y corto frente a la paciencia de la suite.
        //
        // El Promise.race de withStepTimeout engancha manejadores a las DOS promesas, asi
        // que el rechazo tardio del temporizador queda atendido por la carrera y no produce
        // un unhandledRejection.
        const PRESUPUESTO_MS = 4000;

        let resultado;
        let errorCapturado = null;
        try {
            resultado = await withStepTimeout(
                sendAdminAlert('[SageConnect] Prueba de timeout', '<p>cuerpo</p>', 'TestCaller'),
                PRESUPUESTO_MS,
                'step=prueba'
            );
        } catch (err) {
            errorCapturado = err;
        }

        // El centinela 'Step timeout' es load-bearing (PATTERNS.md S-5): si aparece aqui,
        // el envio se desbordo del presupuesto y la invariante de CLAUDE.md 9 esta rota.
        expect(errorCapturado === null ? '' : errorCapturado.message).not.toMatch(/Step timeout/);
        expect(errorCapturado).toBeNull();
        expect(resultado).toBeUndefined();
    }, 15000);
});
