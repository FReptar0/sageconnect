// src/utils/EmailSender.js
const nodeMailer = require('nodemailer');
require('dotenv').config({ path: '.env.credentials.mailing' });
const { logGenerator } = require('./LogGenerator');

async function sendMail(data) {
    const html = `<h1>${data.h1}</h1>
    <p>${data.p}</p>
    <table>
        <tr><th>Status</th><th>Message</th></tr>
        <tr><td>${data.status}</td><td>${data.message}</td></tr>
    </table>`;

    // lee tus vars
    const host = process.env.eServer;
    const port = parseInt(process.env.ePuerto, 10);
    const secure = (process.env.eSSL === 'TRUE');

    // construye la config mínima
    const transportConfig = {
        host,
        port,
        secure,
    };
    if (process.env.ePass) {
        transportConfig.auth = {
            user: process.env.eFrom,
            pass: process.env.ePass
        };
    }

    try {
        const transport = nodeMailer.createTransport(transportConfig);
        const to = process.env.MAILING_NOTICES
            .split(',')[data.position]
            || process.env.MAILING_NOTICES.split(',')[0];

        const mailOptions = {
            from: process.env.eFrom,
            to,
            subject: `${data.idCia || 'NOT FOUND'} - ${data.h1}`,
            html
        };

        const result = await transport.sendMail(mailOptions);
        return result;
    } catch (error) {
        const simple = new Error(err.message);
        logGenerator('EmailSender', 'error', err.stack);
        throw simple;
    }
}

module.exports = { sendMail };
