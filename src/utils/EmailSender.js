// src/utils/EmailSender.js
const nodeMailer = require('nodemailer');
const config = require('../config');
const { logGenerator } = require('./LogGenerator');

/**
 * Q3-06: los tres timeouts de nodemailer -- el de conexion TCP, el del saludo 220 y el
 * de inactividad del socket, tal como se declaran abajo en cada transportConfig -- salen
 * de una sola variable, MAIL_TIMEOUT_MS, para que los dos call sites de este modulo
 * (sendMail y sendOperatorReport) no puedan divergir.
 *
 * Los nombres de las tres opciones se escriben UNICAMENTE en los dos transportConfig y no
 * en este comentario, a proposito: la fase verifica con `grep -c` que cada nombre aparezca
 * exactamente dos veces, una por call site, y ese conteo es la guarda que detecta un call
 * site al que le falte una opcion. Mencionarlos aqui inflaria el conteo y cegaria la guarda.
 *
 * El respaldo NO es fail-open: src/config.js sale con exit 1 al arranque salvo que la
 * llave `notifications.mailTimeoutMs` sea entera, >= 1000 y estrictamente < STEP_TIMEOUT_MS,
 * de modo que en un servicio corriendo esa rama es inalcanzable. Existe solo para los mocks
 * de config de Jest anteriores a 20.5, que no declaran esa llave; quitarla fabricaria fallas
 * nuevas en suites que esta fase no posee.
 *
 * Se lee POR ENVIO y no se captura al cargar el modulo: toda otra lectura de configuracion
 * en este codigo resuelve en el punto de uso, y congelarla en el require dejaria el valor
 * fijo y seria materialmente mas dificil de ejercitar desde una prueba.
 *
 * El numero de respaldo de abajo es el default DOCUMENTADO y debe seguir siendo igual al
 * default de MAIL_TIMEOUT_MS en src/config.js y al de .env.example. Si uno de los tres se
 * mueve, se mueven los tres.
 *
 * @returns {number} milisegundos para los tres timeouts de nodemailer
 */
function mailTimeoutMs() {
    const configured = config.notifications && config.notifications.mailTimeoutMs;
    return Number.isInteger(configured) ? configured : 30000;
}

async function sendMail(data) {
    const logFileName = 'EmailSender';
    const html = `<h1>${data.h1}</h1>
    <p>${data.p}</p>
    <table>
        <tr><th>Status</th><th>Message</th></tr>
        <tr><td>${data.status}</td><td>${data.message}</td></tr>
    </table>`;

    // lee tus vars
    const host = config.mailing.server;
    const port = config.mailing.port;
    const secure = config.mailing.ssl;

    // Q3-06: un solo valor por envio, para que un mismo send no use dos numeros distintos.
    const mailTimeout = mailTimeoutMs();

    // construye la config mínima
    const transportConfig = {
        host,
        port,
        secure,
        connectionTimeout: mailTimeout,
        greetingTimeout: mailTimeout,
        socketTimeout: mailTimeout,
    };
    if (config.mailing.password) {
        transportConfig.auth = {
            user: config.mailing.from,
            pass: config.mailing.password
        };
    }

    try {
        const transport = nodeMailer.createTransport(transportConfig);
        const to = config.mailing.notices[data.position]
            || config.mailing.notices[0];

        // Obtener correos de copia (CC) desde la configuración centralizada
        const cc = config.mailing.cc || [];

        const mailOptions = {
            from: config.mailing.from,
            to,
            cc,
            subject: `${data.idCia || 'NOT FOUND'} - ${data.h1}`,
            html
        };

        const result = await transport.sendMail(mailOptions);
        return result;
    } catch (error) {
        const simple = new Error(error.message);
        logGenerator(logFileName, 'error', error.stack);
        throw simple;
    }
}

/**
 * Send an HTML report email to the operator mailbox (MAILING_NOTICES with MAILING_CC).
 * Mirrors AdminEmailSender.sendAdminAlert shape (CONTEXT D-06): operator channel instead of admin channel.
 *
 * @param {object} args
 * @param {string} args.subject - Already-formed subject line (e.g., "[SageConnect] Pendientes fin de mes — POs — 2026-05")
 * @param {string} args.html    - Full HTML body (typically from buildEomEmailHtml in EomNotification.js)
 * @param {string} args.callerLogFile - Log file name for [OPERATOR-EMAIL] entries (e.g., 'EomNotification', 'ForResponse').
 *                                       Defaults to 'EmailSender' if missing.
 * @returns {Promise<void>} — Always resolves; SMTP failures are swallowed (logged as warn).
 *                            Q3-06: el envío está acotado por MAIL_TIMEOUT_MS en los tres
 *                            timeouts de nodemailer, y al vencer sigue resolviendo (nunca
 *                            lanza): un servidor de correo muerto degrada las notificaciones
 *                            y nada más.
 */
async function sendOperatorReport({ subject, html, callerLogFile }) {
    const logFile = callerLogFile || 'EmailSender';
    try {
        // Q3-06: un solo valor por envio, igual que en sendMail.
        const mailTimeout = mailTimeoutMs();
        const transportConfig = {
            host: config.mailing.server,
            port: config.mailing.port,
            secure: config.mailing.ssl,
            connectionTimeout: mailTimeout,
            greetingTimeout: mailTimeout,
            socketTimeout: mailTimeout,
        };
        if (config.mailing.password) {
            transportConfig.auth = {
                user: config.mailing.from,
                pass: config.mailing.password,
            };
        }

        const transport = nodeMailer.createTransport(transportConfig);
        const to = config.mailing.notices.join(',');
        const cc = config.mailing.cc || [];
        await transport.sendMail({
            from: config.mailing.from,
            to,
            cc,
            subject,
            html,
        });
        logGenerator(logFile, 'info', '[OPERATOR-EMAIL] Sent to ' + to + ': ' + subject);
    } catch (err) {
        logGenerator(logFile, 'warn', '[OPERATOR-EMAIL] Failed: ' + err.message);
    }
}

module.exports = { sendMail, sendOperatorReport };
