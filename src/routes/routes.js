const express = require('express');
const router = express.Router();
const { sendMail } = require('../utils/EmailSender');
const dotenv = require('dotenv');

router.post('/send-mail', (req, res) => {
    dotenv.config({ path: '.env.credentials.mailing' });

    const { data } = req.body;

    if (!data) {
        res.status(500).json({ message: 'Error sending email', error: 'Empty fields' });
        return;
    }

    sendMail(data).then((result) => {
        res.status(200).json({ message: 'Email sent successfully', result });
    }).catch((error) => {
        res.status(500).json({ message: 'Error sending email', error });
        console.log(error);
    });

});

module.exports = router;