const nodeMailer = require('nodemailer');
const dotenv = require('dotenv');

async function sendMail(subject, data) {
    dotenv.config({ path: '.env.credentials.mailing' });
    dotenv.config({ path: '.env.mail' });

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
                user: process.env.USER_MAIL_SENDER,
                clientId: process.env.CLIENT_ID,
                clientSecret: process.env.SECRET_CLIENT,
                refreshToken: process.env.REFRESH_TOKEN,
                accessToken: process.env.accessToken
            }
        });
        const mailOptions = {
            from: process.env.USER_MAIL_SENDER,
            to: process.env.USER_MAIL_RECEIVER,
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