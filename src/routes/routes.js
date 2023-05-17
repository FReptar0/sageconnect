const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { sendMail } = require('../utils/EmailSender');
const { updateFocaltecConfig } = require('../utils/FocaltecConfig');
const dotenv = require('dotenv');

/* router.post('/send-mail', (req, res) => {
    dotenv.config({ path: '.env.credentials.mailing' });
    const { subject, text } = req.body;

    sendMail(subject, text).then((result) => {
        res.status(200).json({ message: 'Email sent successfully', result });
    }).catch((error) => {
        res.status(500).json({ message: 'Error sending email', error });
    });

}); */

router.get('/', (req, res) => {
    res.status(200).sendFile(process.cwd() + '/public/index.html');
});

router.get('/time', (req, res) => {
    res.status(200).sendFile(process.cwd() + '/public/time.html');
});

router.get('/database', (req, res) => {
    res.status(200).sendFile(process.cwd() + '/public/database.html');
});

router.get('/focaltec', (req, res) => {
    res.status(200).sendFile(process.cwd() + '/public/focaltec.html');
})

router.get('/results', (req, res) => {
    res.status(200).sendFile(process.cwd() + '/public/results.html');
});


router.post('/send-time', (req, res) => {
    const { time } = req.body;
    const data = `WAIT_TIME=${time}`;

    if (!time) {
        res.status(500).redirect('/results?message=Error writing file&error=Empty fields');
        return;
    } else if (isNaN(time)) {
        res.status(500).redirect('/results?message=Error writing file&error=Time must be a number');
        return;
    } else if (time < 1) {
        res.status(500).redirect('/results?message=Error writing file&error=Time must be greater than 0');
        return;
    }

    const filePath = path.join(process.cwd(), '.env');

    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }

    fs.writeFile(filePath, data, (err) => {
        if (err) {
            res.status(500).redirect('/results?message=Error writing file&error=' + err);
        } else {
            res.status(200).redirect('/results?message=File written successfully');
        }
    });

});

router.post('/send-database', (req, res) => {
    const { user, password, servername } = req.body;

    if (!user || !password || !servername) {
        res.status(500).redirect('/results?message=Error writing file&error=Empty fields');
        return;
    }

    const data = `USER=${user}\nPASSWORD=${password}\nSERVER=${servername}\nDATABASE=FESA`;

    const filePath = path.join(process.cwd(), '.env.credentials.database');

    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }

    fs.writeFile(filePath, data, (err) => {
        if (err) {
            res.status(500).redirect('/results?message=Error writing file&error=' + err);
        } else {
            res.status(200).redirect('/results?message=File written successfully');
        }
    });
});

router.post('/send-focaltec', (req, res) => {
    const { tenantId, apiKey, apiSecret } = req.body;

    if (!tenantId || !apiKey || !apiSecret) {
        res.status(500).redirect('/results?message=Error updating the database&error=Empty fields');
        return;
    }

    const data = `URL=https://api-stg.portaldeproveedores.mx\nTENANT_ID=${tenantId}\nAPI_KEY=${apiKey}\nAPI_SECRET=${apiSecret}`;

    const filePath = path.join(process.cwd(), '.env.credentials.focaltec');

    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }

    fs.writeFile(filePath, data, (err) => {
        if (err) {
            res.status(500).redirect('/results?message=Error writing file&error=' + err);
        } else {
            res.status(200).redirect('/results?message=File written successfully');
        }
    });
});

module.exports = router;