const express = require('express');
const router = express.Router();
const dotenv = require('dotenv');
const { sendMail } = require('../utils/EmailSender');

router.post('/send-mail', (req, res) => {
    dotenv.config({ path: '.env.credentials.mailing' });
    const { subject, text } = req.body;

    sendMail(subject, text).then((result) => {
        res.status(200).json({ message: 'Email sent successfully', result });
    }).catch((error) => {
        res.status(500).json({ message: 'Error sending email', error });
    });

});

router.get('/credentials', (req, res) => {
    res.send('<form><input type="text" placeholder="hola"></form>')
})

module.exports = router;