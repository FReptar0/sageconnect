const { spawn } = require('child_process');
const { checkPayments } = require('./controller/SagePaymentController');
const { uploadPayments } = require('./controller/PortalPaymentController');
const { downloadCFDI } = require('./controller/CFDI_Downloader');
const { createPurchaseOrders } = require('./controller/PortalOC_Creation');
const { cancellationPurchaseOrders } = require('./controller/PortalOC_Cancellation');
const { closePurchaseOrders } = require('./controller/PortalOC_Close');
const { buildProvidersXML } = require('./controller/Providers_Downloader');
const { sendMail } = require('./utils/EmailSender');
const { logGenerator } = require('./utils/LogGenerator');
const { getCurrentDate } = require('./utils/TimezoneHelper');
const dotenv = require('dotenv');
const notifier = require('node-notifier');

/**
 * SageConnect Background Processes
 * Handles all CFDI processing, imports, and background tasks
 */

// Load environment variables
const credentials = dotenv.config({ path: '.env.credentials.focaltec' });
const env = dotenv.config({ path: '.env' });

/**
 * Main background process that handles all CFDI operations
 */
async function forResponse() {
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

/**
 * Handles the child process for CFDI import
 */
function startChildProcess() {
    const logFileName = 'ChildProcess';
    
    console.log(`[INFO] IMPORT_CFDIS_ROUTE: ${env.parsed.IMPORT_CFDIS_ROUTE}`);
    console.log(`[INFO] ARG: ${env.parsed.ARG}`);
    logGenerator(logFileName, 'info', `[INFO] Iniciando proceso de importación - ROUTE: ${env.parsed.IMPORT_CFDIS_ROUTE}, ARG: ${env.parsed.ARG}`);

    if (typeof env.parsed.IMPORT_CFDIS_ROUTE !== "undefined" || typeof env.parsed.ARG !== "undefined") {
        const childProcess = spawn(env.parsed.IMPORT_CFDIS_ROUTE, [env.parsed.ARG]);
        logGenerator(logFileName, 'info', `[INFO] Child process iniciado con PID: ${childProcess.pid}`);

        // Stdout is used to capture the data messages
        childProcess.stdout.on('data', (data) => {
            console.log(`[INFO] Proceso de importación STDOUT: ${data}`);
            logGenerator(logFileName, 'info', `[STDOUT] ${data.toString().trim()}`);
        });

        // Stderr is used to capture the error messages
        childProcess.stderr.on('data', (data) => {
            console.error(`[ERROR] Proceso de importación STDERR: ${data}`);
            logGenerator(logFileName, 'error', `[STDERR] ${data.toString().trim()}`);
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
                logGenerator(logFileName, 'error', `[ERROR] Fallo al enviar correo de error de importación: ${error.message}`);
            });
        });

        // Close is used to capture the close event
        childProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`[OK] Proceso de importación finalizado correctamente con código ${code}`);
                logGenerator(logFileName, 'info', `[CLOSE] Proceso de importación finalizado correctamente con código ${code}`);
            } else {
                console.error(`[ERROR] Proceso de importación finalizó con código ${code}`);
                logGenerator(logFileName, 'error', `[CLOSE] Proceso de importación finalizó con código de error ${code}`);
            }
        });
    } else {
        console.warn('[WARN] No se ha definido la variable de entorno IMPORT_CFDIS_ROUTE o ARG. El proceso de importación de CFDIs no se ejecutará.');
        logGenerator(logFileName, 'warn', '[WARN] No se ha definido la variable de entorno IMPORT_CFDIS_ROUTE o ARG. El proceso de importación de CFDIs no se ejecutará.');

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
            logGenerator(logFileName, 'error', `[ERROR] Fallo al enviar correo de error de importación: ${error.message}`);
        });
    }
}

/**
 * Shows desktop notification for background process startup
 */
function showStartupNotification() {
    const logFileName = 'ServerStatus';
    
    try {
        notifier.notify({
            title: 'Bienvenido!',
            message: 'El servidor se inició correctamente en el puerto 3030',
            sound: true,
            wait: true
        });
        logGenerator(logFileName, 'info', '[START] Proceso automático iniciado - Notificación enviada correctamente.');
    } catch (error) {
        console.error('[ERROR] Fallo al enviar la notificación:', error);
        logGenerator(logFileName, 'error', `[ERROR] Fallo al enviar la notificación: ${error.message}`);
    }
}

/**
 * Starts all background processes
 */
function startBackgroundProcesses() {
    const logFileName = 'MainProcess';
    
    // Show startup notification
    showStartupNotification();
    
    // Start main CFDI processing
    forResponse().then(() => {
        startChildProcess();
    }).catch((error) => {
        console.log(error);
        logGenerator(logFileName, 'error', `[ERROR] Error en proceso principal: ${error.message}`);
    });
}

// If this file is run directly (background-only mode)
if (require.main === module) {
    console.log('🔄 Iniciando procesos automáticos de SageConnect...');
    console.log('📋 Solo los procesos de CFDI serán ejecutados');
    console.log('🚫 El servidor web NO será iniciado');
    console.log('─'.repeat(60));
    
    startBackgroundProcesses();
}

module.exports = {
    startBackgroundProcesses,
    forResponse,
    startChildProcess,
    showStartupNotification
};