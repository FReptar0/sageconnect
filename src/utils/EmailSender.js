const nodeMailer = require('nodemailer');
const dotenv = require('dotenv');

async function sendMail(subject, text) {
    dotenv.config({ path: '.env.credentials.mailing' });
    dotenv.config({ path: '.env.mail' });
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
            text: text,
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