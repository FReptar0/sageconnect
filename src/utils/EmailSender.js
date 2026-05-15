// src/utils/EmailSender.js
const nodeMailer = require('nodemailer');
const config = require('../config');
const { logGenerator } = require('./LogGenerator');

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

    // construye la config mínima
    const transportConfig = {
        host,
        port,
        secure,
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
 */
async function sendOperatorReport({ subject, html, callerLogFile }) {
    const logFile = callerLogFile || 'EmailSender';
    try {
        const transportConfig = {
            host: config.mailing.server,
            port: config.mailing.port,
            secure: config.mailing.ssl,
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
