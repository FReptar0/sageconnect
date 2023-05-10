const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { sendMail } = require('../utils/EmailSender');
const { updateConfig } = require('../utils/FocaltecConfig');
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
        const data = {
            h1: 'Error writing configuration file',
            p: 'The following fields cannot be empty:<br/><b>- User</b><br/><b>- Password</b><br/><b>- Servername</b>',
            status: 'Error',
            message: 'The fields cannot be empty'
        }
        sendMail('Error writing configuration file', data).then((result) => {
            res.status(500).redirect('/results?message=Error writing file&error=Empty fields');
        }).catch((error) => {
            res.status(500).redirect('/results?message=Error sending email and the some fields are emptyfile+&error=' + error);
        });
        return;
    }

    const data = `USER=${user}\nPASSWORD=${password}\nSERVER=${servername}\nDATABASE=FESA`;

    const filePath = path.join(process.cwd(), '.env.credentials.database');

    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }

    fs.writeFile(filePath, data, (err) => {
        if (err) {
            const data = {
                h1: 'Error writing configuration file',
                p: 'Something went wrong while writing the configuration file. Please try again later.',
                status: 'Error',
                message: 'Error writing file: ' + err
            }

            sendMail('Error writing configuration file', data).then((result) => {
                res.status(500).redirect('/results?message=Error writing file&error=' + err);
            }).catch((error) => {
                res.status(500).redirect('/results?message=Error sending email and writting the file+&error=' + error);
            });
        } else {
            const data = {
                h1: 'Configuration file written successfully',
                p: 'The configuration file was written successfully. Please restart the server to apply the changes.',
                status: 'Success',
                message: 'File written successfully'
            }
            sendMail('Configuration file written successfully', data).then((result) => {
                res.status(200).redirect('/results?message=File written successfully');
            }).catch((error) => {
                res.status(500).redirect('/results?message=Error sending email but the configuration was applied+&error=' + error);
            });
        }
    });
});

router.post('/send-focaltec', (req, res) => {
    const { tenantId, apiKey, apiSecret } = req.body;

    if (!tenantId || !apiKey || !apiSecret) {
        res.status(500).redirect('/results?message=Error updating the database&error=Empty fields');
        return;
    }

    // Query para insertar en la base de datos
    // const query = `INSERT INTO FESA.dbo.fesaParam ([URL], [TenantId], [ApiKey], [ApiSecret]) VALUES ('https://api-stg.portaldeproveedores.mx', '${tenantId}', '${apiKey}', '${apiSecret}')`;

    // Query para actualizar en la base de datos
    const updateQuery = `UPDATE FESA.dbo.fesaParam SET [URL] = 'https://api-stg.portaldeproveedores.mx', [TenantId] = '${tenantId}', [ApiKey] = '${apiKey}', [ApiSecret] = '${apiSecret}' WHERE [idCia] = 'GRUPO'`;

    updateConfig(updateQuery).then((result) => {
        // verificar que hayan sido afectadas las filas
        if (result.rowsAffected[0] > 0) {
            const data = {
                h1: 'Configuration updated successfully',
                p: 'The configuration was updated successfully. Please restart the server to apply the changes.',
                status: 'Success',
                message: 'Configuration updated successfully'
            }
            sendMail('Configuration updated successfully', data).then((result) => {
                res.status(200).redirect('/results?message=Configuration updated successfully');
            }).catch((error) => {
                res.status(500).redirect('/results?message=Error sending email but the configuration was applied+&error=' + error);
            });
        } else {
            const data = {
                h1: 'Error updating the database',
                p: 'Something went wrong while updating the database. Please try again later.',
                status: 'Error',
                message: 'Error updating the database'
            }
            sendMail('Error updating the database', data).then((result) => {
                res.status(500).redirect('/results?message=Error updating the database&error=No rows affected');
            }).catch((error) => {
                res.status(500).redirect('/results?message=Error sending email and updating the database+&error=' + error);
            });

        }
    }).catch((error) => {
        const data = {
            h1: 'Error updating the database',
            p: 'Something went wrong while updating the database. Please try again later.',
            status: 'Error',
            message: 'Error updating the database'
        }
        sendMail('Error updating the database', data).then((result) => {
            res.status(500).redirect('/results?message=Error updating the database&error=' + error);
        }).catch((error) => {
            res.status(500).redirect('/results?message=Error sending email and updating the database+&error=' + error);
        });
    });
});

module.exports = router;