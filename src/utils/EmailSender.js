const nodeMailer = require('nodemailer');
const { getEmailConfig } = require('./EmailConfig');

async function sendMail(subject, data, mailReciver) {
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

    const mailConfig = await getEmailConfig();

    try {
        const transport = nodeMailer.createTransport({
            service: 'gmail',
            auth: {
                type: 'OAuth2',
                user: mailConfig.CorreoEnvio,
                clientId: mailConfig.CLIENT_ID,
                clientSecret: mailConfig.SECRET_CLIENT,
                refreshToken: mailConfig.REFRESH_TOKEN
            }
        });
        const mailOptions = {
            from: mailConfig.CorreoEnvio,
            to: (mailReciver == undefined || mailReciver == '') ? mailConfig.CorreoAvisos : mailReciver,
            subject: subject,
            html: html,
        }

        const result = await transport.sendMail(mailOptions);
        return result;

    } catch (error) {
        return error;
    }
}

module.exports = {
    sendMail
}