const express = require('express');
const { google } = require('googleapis');
const router = express.Router();
const dotenv = require('dotenv');
const { sendMail } = require('../utils/EmailSender');

router.post('/send-mail', (req, res) => {
    dotenv.config({ path: '.env.credentials.mailing' });

    const { subject, text } = req.body;
    const CLIENT_ID = process.env.CLIENT_ID;
    const SECRET_CLIENT = process.env.SECRET_CLIENT;
    const REFRESH_TOKEN = process.env.REFRESH_TOKEN;
    const REDIRECT_URI = process.env.REDIRECT_URI;

    const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, SECRET_CLIENT, REDIRECT_URI);

    oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

    sendMail(subject, text, oAuth2Client).then((result) => {
        res.status(200).json({ message: 'Email sent successfully', result });
    }).catch((error) => {
        res.status(500).json({ message: 'Error sending email', error });
    });

});

module.exports = router;