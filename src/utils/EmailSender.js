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

module.exports = { sendMail };
