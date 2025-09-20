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
const { getCurrentDate } = require('./utils/TimezoneHelper');

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
    const logFileName = 'ServerStart';
    const msg = 'El servidor se inició correctamente en el puerto 3030';
    console.log(msg);
    logGenerator(logFileName, 'info', msg);
});

try {
    const logFileName = 'ServerStart';
    notifier.notify({
        title: 'Bienvenido!',
        message: 'El servidor se inició correctamente en el puerto 3030',
        sound: true,
        wait: true
    });
    logGenerator(logFileName, 'info', '[INFO] Notificación enviada correctamente.');
} catch (error) {
    const logFileName = 'ServerStart';
    console.error('[ERROR] Fallo al enviar la notificación:', error);
    logGenerator(logFileName, 'error', `[ERROR] Fallo al enviar la notificación: ${error.message}`);
}

forResponse = async () => {
    const logFileName = 'ForResponse';
    const date = getCurrentDate();
    logGenerator(logFileName, 'info', `[START] Inicio del proceso forResponse a las ${date.toISOString()}`);

    const tenantIds = credentials.parsed.TENANT_ID.split(',');
    for (let i = 0; i < tenantIds.length; i++) {
        try {
            logGenerator(logFileName, 'info', `[INFO] Procesando tenant con índice ${i}`);

            await buildProvidersXML(i);
            logGenerator(logFileName, 'info', `[INFO] buildProvidersXML completado para el índice ${i}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            await downloadCFDI(i);
            logGenerator(logFileName, 'info', `[INFO] downloadCFDI completado para el índice ${i}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            await checkPayments(i);
            logGenerator(logFileName, 'info', `[INFO] checkPayments completado para el índice ${i}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            await uploadPayments(i);
            logGenerator(logFileName, 'info', `[INFO] uploadPayments completado para el índice ${i}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            await createPurchaseOrders(i);
            logGenerator(logFileName, 'info', `[INFO] createPurchaseOrders completado para el índice ${i}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            await cancellationPurchaseOrders(i);
            logGenerator(logFileName, 'info', `[INFO] cancellationPurchaseOrders completado para el índice ${i}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            await closePurchaseOrders(i);
            logGenerator(logFileName, 'info', `[INFO] closePurchaseOrders completado para el índice ${i}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logGenerator(logFileName, 'error', `[ERROR] Error procesando el índice ${i}: ${error.message}`);
        }
    }

    logGenerator(logFileName, 'info', '[END] Proceso forResponse completado.');
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