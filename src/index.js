const express = require('express');
const { minutesToMilliseconds } = require('./utils/TransformTime');
const { checkPayments } = require('./controller/SagePaymentController');
const { uploadPayments } = require('./controller/PortalPaymentController');
const { downloadCFDI } = require('./controller/CFDI_Downloader');
const { createPurchaseOrders } = require('./controller/PortalOC_Creation');
const { spawn } = require('child_process');
const { sendMail } = require('./utils/EmailSender');
const { buildProvidersXML } = require('./controller/Providers_Downloader');
const { cancellationPurchaseOrders } = require('./controller/PortalOC_Cancellation');
const { closePurchaseOrders } = require('./controller/PortalOC_Close'); // Uncomment if you have a closePurchaseOrders function
const { logGenerator } = require('./utils/LogGenerator');

const dotenv = require('dotenv');
const credentials = dotenv.config({ path: '.env.credentials.focaltec' });
const env = dotenv.config({ path: '.env' });

const notifier = require('node-notifier');

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(require('./routes/routes'))

app.use(function (req, res) {
    res.status(404).sendFile(process.cwd() + '/public/404.html');
});

const server = app.listen(3030, () => {
    console.log('Server is up on port 3030');
    const msg = 'El servidor se inició correctamente en el puerto 3030';
    console.log(msg);
    logGenerator('server_start', 'info', msg);
});

try {
    notifier.notify({
        title: 'Bienvenido!',
        message: 'El servidor se inicio correctamente en el puerto 3030',
        sound: true,
        wait: true
    });
} catch (error) {
    console.log(error)
}

forResponse = async () => {
    // imprimir la fecha y hora actual en formato ISO
    const date = new Date();
    console.log(date.toISOString());
    const tenantIds = credentials.parsed.TENANT_ID.split(',');
    for (let i = 0; i < tenantIds.length; i++) {

        // buildProvidersXML function
        await buildProvidersXML(i);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // CFDI_Downloader function
        await downloadCFDI(i);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Function to check payments in Sage and upload timbrados data
        await checkPayments(i);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Function to upload payments to the portal de proveedores
        await uploadPayments(i);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Function to upload purchase orders to the portal de proveedores
        await createPurchaseOrders(i);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Function to cancel purchase orders in the portal de proveedores
        await cancellationPurchaseOrders(i);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Function to close purchase orders in the portal de proveedores
        // await closePurchaseOrders(i);
        // await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

forResponse().then(() => {
    // The spawn function is used to execute the import process
    console.log(`[INFO] IMPORT_CFDIS_ROUTE: ${env.parsed.IMPORT_CFDIS_ROUTE}`);
    console.log(`[INFO] ARG: ${env.parsed.ARG}`);

    if (typeof env.parsed.IMPORT_CFDIS_ROUTE !== "undefined" || typeof env.parsed.ARG !== "undefined") {
        const childProcess = spawn(env.parsed.IMPORT_CFDIS_ROUTE, [env.parsed.ARG]);

        // Stdout is used to capture the data messages
        childProcess.stdout.on('data', (data) => {
            console.log(`[INFO] Proceso de importación STDOUT: ${data}`);
        });

        // Stderr is used to capture the error messages
        childProcess.stderr.on('data', (data) => {
            console.error(`[ERROR] Proceso de importación STDERR: ${data}`);
            const dataMail = {
                h1: 'Error en el proceso de importación',
                p: 'El proceso de importación de CFDIs ha fallado',
                status: 500,
                message: `[ERROR] STDERR: ${data}`,
                position: 1,
                idCia: 'Global'
            }

            sendMail(dataMail).catch((error) => {
                console.error('[ERROR] Fallo al enviar correo de error de importación:', error);
            });
        });

        // Close is used to capture the close event
        childProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`[OK] Proceso de importación finalizado correctamente con código ${code}`);
            } else {
                console.error(`[ERROR] Proceso de importación finalizó con código ${code}`);
            }
        });
    } else {
        console.warn('[WARN] No se ha definido la variable de entorno IMPORT_CFDIS_ROUTE o ARG. El proceso de importación de CFDIs no se ejecutará.');

        const data = {
            h1: 'Error en el proceso de importación',
            p: 'El proceso de importación de CFDIs ha fallado',
            status: 500,
            message: '[WARN] No se ha definido la variable de entorno IMPORT_CFDIS_ROUTE o ARG',
            position: 1,
            idCia: 'Global'
        }

        sendMail(data).catch((error) => {
            console.error('[ERROR] Fallo al enviar correo de error de importación:', error);
        });
    }

}).catch((error) => {
    console.log(error);
}).finally(() => {
    server.close(() => {
        console.log('[INFO] Server is closed');
    });
});