const nodeMailer = require('nodemailer');
require('dotenv').config({ path: '.env.credentials.mailing' });

async function sendMail(subject, data) {
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
            to: process.env.CORREOS_AVISOS.split(',')[data.position] || process.env.CORREOS_AVISOS.split(',')[0],
            subject: `${data.idCia} - ${subject}`,
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