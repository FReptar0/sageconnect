// tests/AdminEmailSender.test.js
//
// La mitad de CABLEADO de CR-01 (fase 20.6). Este archivo MOCKEA nodemailer y asserta
// sobre nodeMailer.createTransport.mock.calls: comprueba que las tres opciones LLEGAN al
// transporte y con que valor, sin abrir un socket.
//
// La mitad de COMPORTAMIENTO vive en tests/AdminEmailSender.timeout.test.js, que NO mockea
// nodemailer y levanta un servidor TCP real que acepta y jamas saluda. Las dos mitades NO
// PUEDEN CONVIVIR EN UN ARCHIVO: jest.mock tiene alcance de archivo, asi que mockear
// nodemailer aqui haria imposible medir alla el tiempo real de un envio. Es la misma razon
// por la que EmailSender ya tiene dos archivos (tests/EmailSender.timeout.test.js:1-10).
// Si algun dia parece buena idea fusionarlos, esta nota es la respuesta: no lo es.
//
// A diferencia del fuente, este archivo SI puede nombrar las tres opciones con todas sus
// letras: la guarda de conteo de ocurrencias mide src/utils/AdminEmailSender.js, no tests/.

jest.mock('../src/config', () => ({
    mailing: {
        server: 'smtp.test',
        port: 587,
        ssl: false,
        from: 'noreply@test',
        notices: ['ops1@test.com', 'ops2@test.com'],
        cc: ['cc1@test.com'],
        // password vacio a proposito: con clave, sendAdminAlert adjunta `auth` al
        // transportConfig y el caso (6) tendria que razonar sobre un campo mas.
        password: '',
    },
    license: { adminEmail: 'admin@test.com' },
    // Sin esta llave TODOS los casos ejercitarian el respaldo del accesor en vez de la
    // ruta de config, y (1) pasaria por la razon equivocada. El caso (4) la quita a
    // proposito, y solo ahi.
    notifications: { mailTimeoutMs: 30000 },
}));

const mockTransportSendMail = jest.fn();
jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({ sendMail: mockTransportSendMail })),
}));

const mockLogGenerator = jest.fn();
jest.mock('../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const { sendAdminAlert } = require('../src/utils/AdminEmailSender');

// Mismas instancias que ve el modulo bajo prueba.
const nodeMailer = require('nodemailer');
const mockedConfig = require('../src/config');

describe('AdminEmailSender — cableado de MAIL_TIMEOUT_MS (CR-01, fase 20.6)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTransportSendMail.mockResolvedValue({ accepted: ['admin@test.com'], rejected: [] });
    });

    test('(1) sendAdminAlert entrega a createTransport los tres timeouts de nodemailer', async () => {
        await sendAdminAlert('asunto', '<p>x</p>', 'TestCaller');

        const transportConfig = nodeMailer.createTransport.mock.calls[0][0];
        expect(transportConfig.connectionTimeout).toBe(30000);
        expect(transportConfig.greetingTimeout).toBe(30000);
        expect(transportConfig.socketTimeout).toBe(30000);
    });

    test('(2) el valor viene de config y no de un literal: 7777 llega hasta nodemailer', async () => {
        // Guarda anti-hardcode. Si alguien reemplaza la llamada al accesor por la constante
        // 30000, este caso se pone rojo. Sin el, la conexion podria revertirse a un literal
        // sin que nada fallara.
        const saved = mockedConfig.notifications.mailTimeoutMs;
        mockedConfig.notifications.mailTimeoutMs = 7777;
        try {
            await sendAdminAlert('asunto', '<p>x</p>', 'TestCaller');

            const transportConfig = nodeMailer.createTransport.mock.calls[0][0];
            expect(transportConfig.connectionTimeout).toBe(7777);
            expect(transportConfig.greetingTimeout).toBe(7777);
            expect(transportConfig.socketTimeout).toBe(7777);
        } finally {
            // Se restaura dentro del mismo caso, nunca en un afterEach: es lo que impide
            // que un caso contamine al siguiente.
            mockedConfig.notifications.mailTimeoutMs = saved;
        }
    });

    test('(3) regresion: socketTimeout esta presente y NO es el default 600000 de nodemailer', async () => {
        // 600000 ms es el numero que este arreglo existe para desplazar: el doble de
        // STEP_TIMEOUT_MS e igual a CHILD_PROCESS_TIMEOUT_MS. Un envio que lo herede se
        // come el paso completo y le sobrevive como continuacion fantasma.
        await sendAdminAlert('asunto', '<p>x</p>', 'TestCaller');

        const transportConfig = nodeMailer.createTransport.mock.calls[0][0];
        expect(transportConfig.socketTimeout).toBeDefined();
        expect(transportConfig.socketTimeout).not.toBe(600000);
    });

    test('(4) el respaldo del accesor es una ruta intencional, no codigo muerto', async () => {
        // La conjuncion `config.notifications && ...` del accesor es lo que mantiene verde a
        // tests/controller/Providers_Downloader.xml-error.test.js, cuyo mock de config NO
        // declara la llave `notifications` y que carga el AdminEmailSender REAL. Con un
        // acceso directo, esa suite de 5 casos se pondria roja con un TypeError. Este caso
        // fija esa forma para que nadie la "simplifique".
        const saved = mockedConfig.notifications.mailTimeoutMs;
        delete mockedConfig.notifications.mailTimeoutMs;
        try {
            await expect(sendAdminAlert('asunto', '<p>x</p>', 'TestCaller')).resolves.toBeUndefined();

            const transportConfig = nodeMailer.createTransport.mock.calls[0][0];
            expect(transportConfig.connectionTimeout).toBe(30000);
            expect(transportConfig.greetingTimeout).toBe(30000);
            expect(transportConfig.socketTimeout).toBe(30000);
        } finally {
            mockedConfig.notifications.mailTimeoutMs = saved;
        }
    });

    test('(5) el contrato de tragar sigue vivo: no lanza y registra el fallo en warn', async () => {
        // Este modulo NO devuelve {delivered, error}: eso es sendOperatorReport y es otra
        // decision (D-01). No lo alinees. Lock-recovery, force-release y la generacion de
        // XML dependen de que sendAdminAlert nunca lance.
        mockTransportSendMail.mockRejectedValue(new Error('SMTP connection refused'));

        await expect(sendAdminAlert('asunto', '<p>x</p>', 'TestCaller')).resolves.toBeUndefined();

        const warns = mockLogGenerator.mock.calls.filter((c) => c[1] === 'warn');
        expect(warns).toHaveLength(1);
        expect(warns[0][0]).toBe('TestCaller');
        expect(warns[0][2]).toMatch(/^\[ADMIN-EMAIL\] Failed to send admin alert:/);
    });

    test('(6) canal de administracion, no de operador', async () => {
        // Contraparte del caso (d) de tests/EmailSender.test.js. Evita que un refactor
        // "unifique" los dos remitentes: este va a config.license.adminEmail, el otro a
        // config.mailing.notices, y son buzones distintos a proposito.
        await sendAdminAlert('asunto', '<p>x</p>', 'TestCaller');

        const mailOptions = mockTransportSendMail.mock.calls[0][0];
        expect(mailOptions.to).toBe('admin@test.com');

        const destinatarios = JSON.stringify(mailOptions);
        mockedConfig.mailing.notices.forEach((notice) => {
            expect(destinatarios).not.toContain(notice);
        });
    });
});
