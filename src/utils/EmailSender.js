const nodeMailer = require('nodemailer');
const { getEmailConfig } = require('./EmailConfig');
require('dotenv').config({ path: '.env.credentials.mailing' });

async function sendMail(subject, data, mailReciver) {
    console.log(mailReciver);
    const html = `<h1>${data.h1}</h1>
    <p>${data.p}</p>
    <table>
        <tr>
            <th>Status</th>
            <th>Message</th>
        </tr>
        <tr>
            <td>${data.status}</td>
            <td>${data.message}</td>
        </tr>
    </table>`;

    //const mailConfig = await getEmailConfig();

    try {
        const transport = nodeMailer.createTransport({
            service: 'gmail',
            auth: {
                type: 'OAuth2',
                user: process.env.CORREO_ENVIO,
                clientId: process.env.CLIENT_ID,
                clientSecret: process.env.SECRET_CLIENT,
                refreshToken: process.env.REFRESH_TOKEN,
            }
        });
        const mailOptions = {
            from: process.env.CORREO_ENVIO,
            to: mailReciver || process.env.CORREO_AVISOS,
            subject: subject,
            html: html,
        }

        const result = await transport.sendMail(mailOptions);
        console.log(result);
        return result;

    } catch (error) {
        console.log(error);
        return error;
    }
}

module.exports = {
    sendMail
}