/**
 * AdminEmailSender — extracted helper module for admin alert emails (Quick task 260502-i7l).
 *
 * PATTERNS.md §S-6 third-use trigger: sendAdminAlert was inlined in CronScheduler.js
 * (Phase 18 Plan 18-01) and schedule-routes.js (Phase 18 Plan 18-02). Providers_Downloader.js
 * (Quick task 260502-i7l, 3rd call site) triggers refactor-just-in-time per the convention.
 *
 * Mirrors LicenseValidator.sendLicenseAlert pattern — uses nodemailer directly (NOT the
 * project's operator-facing email-sender utility). The operator utility routes to
 * config.mailing.notices (operator mailbox); admin alerts route to config.license.adminEmail.
 *
 * The `callerLogFile` parameter PRESERVES the existing [ADMIN-EMAIL] log routing — each
 * caller passes its own LOG_FILE name so log entries appear in the same file they did
 * before the refactor (CronScheduler.log, ScheduleRoutes.log, Providers_Downloader.log).
 * Operators who grep for [ADMIN-EMAIL] in a specific log file continue to find them.
 *
 * Email failures are swallowed (warn log) and MUST NOT block the caller's flow —
 * lock-recovery, force-release, and XML generation all rely on this contract.
 */

const nodemailer = require('nodemailer');
const config = require('../config');
const { logGenerator } = require('./LogGenerator');

/**
 * CR-01 (fase 20.6): los tres timeouts de nodemailer -- el de la conexion TCP, el del saludo
 * 220 y el de inactividad del socket, tal como se declaran abajo en el unico transportConfig
 * de este modulo -- salen de una sola variable, MAIL_TIMEOUT_MS, igual que en los dos call
 * sites de src/utils/EmailSender.js desde la fase 20.5 (Q3-06).
 *
 * Esto NO agrega un tier a la invariante de CLAUDE.md §9: mete este remitente en el tier SMTP
 * que ya existia. Hasta la fase 20.6 el unico `await sendAdminAlert(...)` que corria dentro de
 * un paso vivia en una rama inalcanzable, de modo que la invariante se sostenia por vacio;
 * volver alcanzable esa rama la puso a prueba de verdad. Sin estas tres opciones el envio
 * hereda los defaults de la libreria, y el mas largo de ellos es mayor que el presupuesto de
 * paso: un SMTP que acepta el TCP y se queda mudo se come el paso entero y le sobrevive como
 * continuacion fantasma.
 *
 * Los nombres de las tres opciones se escriben UNICAMENTE en el transportConfig y no en este
 * comentario, a proposito: la fase verifica por conteo de OCURRENCIAS que cada nombre aparezca
 * exactamente una vez -- este modulo tiene un solo call site, a diferencia de EmailSender.js,
 * que tiene dos y por eso su guarda vale 2 -- y ese conteo es la guarda que detectaria un call
 * site al que le falte una opcion. Mencionarlos aqui inflaria el conteo y la cegaria.
 *
 * La conjuncion `config.notifications && ...` es load-bearing, no defensiva por gusto:
 * tests/controller/Providers_Downloader.xml-error.test.js mockea ../../src/config SIN la llave
 * `notifications` y carga este modulo REAL. Con un acceso directo esa suite verde de 5 casos
 * se pondria roja con un TypeError. El respaldo NO es fail-open: src/config.js sale con exit 1
 * al arranque salvo que la llave sea entera, >= 1000 y estrictamente < STEP_TIMEOUT_MS, asi que
 * en un servicio corriendo esta rama es inalcanzable.
 *
 * Se lee POR ENVIO y no se captura al cargar el modulo, por la misma razon que en
 * EmailSender.js: toda otra lectura de configuracion de este codigo resuelve en el punto de
 * uso, y congelarla en el require la volveria materialmente mas dificil de ejercitar desde una
 * prueba.
 *
 * El numero de respaldo de abajo es el default DOCUMENTADO y debe seguir siendo igual al
 * default de MAIL_TIMEOUT_MS en src/config.js y al de .env.example. Si uno de los tres se
 * mueve, se mueven los tres.
 *
 * El accesor es PRIVADO del modulo: no se exporta, asi que no hay llamador rio abajo.
 *
 * @returns {number} milisegundos para los tres timeouts de nodemailer
 */
function mailTimeoutMs() {
    const configured = config.notifications && config.notifications.mailTimeoutMs;
    return Number.isInteger(configured) ? configured : 30000;
}

/**
 * Send an alert email to the LICENSE_ADMIN_EMAIL recipient.
 *
 * @param {string} subject       — already includes the [SageConnect] prefix when called.
 * @param {string} html          — full HTML body of the message.
 * @param {string} callerLogFile — log file name for [ADMIN-EMAIL] entries (e.g.,
 *                                  'CronScheduler', 'ScheduleRoutes', 'Providers_Downloader').
 *                                  Defaults to 'AdminEmailSender' if missing (safety fallback).
 */
async function sendAdminAlert(subject, html, callerLogFile) {
    const logFile = callerLogFile || 'AdminEmailSender';
    try {
        // CR-01: un solo valor por envio, para que un mismo send no use tres numeros distintos.
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
        const transport = nodemailer.createTransport(transportConfig);
        await transport.sendMail({
            from: config.mailing.from,
            to: config.license.adminEmail,
            subject,
            html,
        });
        logGenerator(logFile, 'info', '[ADMIN-EMAIL] Sent to ' + config.license.adminEmail + ': ' + subject);
    } catch (err) {
        logGenerator(logFile, 'warn', '[ADMIN-EMAIL] Failed to send admin alert: ' + err.message);
    }
}

/**
 * Find the most recent stepProgress entry whose finishedAt is null/missing.
 * Returns null if stepProgress is empty or every entry is closed.
 *
 * Extracted from CronScheduler.js (Phase 18 Plan 18-01) and schedule-routes.js
 * (Phase 18 Plan 18-02). Both call sites used identical 5-line iteration; centralized
 * here at the same time as sendAdminAlert (related purpose: both helpers feed admin
 * email body fields stuckOnStep + stuckOnTenant).
 *
 * @param {Array<{step: string, tenant: string|null, startedAt: string, finishedAt: string|null, error: string|null}>} stepProgress
 * @returns {object|null}
 */
function findLastOpenStep(stepProgress) {
    if (!Array.isArray(stepProgress)) return null;
    for (let i = stepProgress.length - 1; i >= 0; i--) {
        if (!stepProgress[i].finishedAt) return stepProgress[i];
    }
    return null;
}

module.exports = { sendAdminAlert, findLastOpenStep };
