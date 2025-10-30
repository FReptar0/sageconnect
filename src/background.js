const { spawn } = require('child_process');
const { checkPayments } = require('./controller/SagePaymentController');
const { uploadPayments } = require('./controller/PortalPaymentController');
const { downloadCFDI } = require('./controller/CFDI_Downloader');
const { createPurchaseOrders } = require('./controller/PortalOC_Creator');
const { closePurchaseOrders } = require('./controller/PortalOC_Closer');
const { processOrderChanges } = require('./controller/PortalOC_LifecycleManager');
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

            logGenerator(logFileName, 'info', `[START] Iniciando buildProvidersXML para el índice ${i}`);
            await buildProvidersXML(i);
            logGenerator(logFileName, 'info', `[COMPLETE] buildProvidersXML completado para el índice ${i}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            logGenerator(logFileName, 'info', `[START] Iniciando downloadCFDI para el índice ${i}`);
            await downloadCFDI(i);
            logGenerator(logFileName, 'info', `[COMPLETE] downloadCFDI completado para el índice ${i}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            logGenerator(logFileName, 'info', `[START] Iniciando checkPayments para el índice ${i}`);
            await checkPayments(i);
            logGenerator(logFileName, 'info', `[COMPLETE] checkPayments completado para el índice ${i}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            logGenerator(logFileName, 'info', `[START] Iniciando uploadPayments para el índice ${i}`);
            await uploadPayments(i);
            logGenerator(logFileName, 'info', `[COMPLETE] uploadPayments completado para el índice ${i}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            logGenerator(logFileName, 'info', `[START] Iniciando createPurchaseOrders para el índice ${i}`);
            await createPurchaseOrders(i);
            logGenerator(logFileName, 'info', `[COMPLETE] createPurchaseOrders completado para el índice ${i}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            logGenerator(logFileName, 'info', `[START] Iniciando processOrderChanges para el índice ${i}`);
            await processOrderChanges(i);
            logGenerator(logFileName, 'info', `[COMPLETE] processOrderChanges completado para el índice ${i}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            logGenerator(logFileName, 'info', `[START] Iniciando closePurchaseOrders para el índice ${i}`);
            await closePurchaseOrders(i);
            logGenerator(logFileName, 'info', `[COMPLETE] closePurchaseOrders completado para el índice ${i}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            logGenerator(logFileName, 'info', `[TENANT-COMPLETE] Todos los procesos completados para el tenant índice ${i}`);
        } catch (error) {
            logGenerator(logFileName, 'error', `[ERROR] Error procesando el índice ${i}: ${error.message}`);
            logGenerator(logFileName, 'error', `[ERROR] Stack trace: ${error.stack}`);
            // Continue with next tenant even if current one fails
        }
    }

    logGenerator(logFileName, 'info', '[END] Proceso forResponse completado.');
}

/**
 * Handles the child process for CFDI import
 * @returns {Promise} Promise that resolves when child process completes
 */
function startChildProcess() {
    return new Promise((resolve, reject) => {
        const logFileName = 'ChildProcess';
        
        console.log(`[INFO] IMPORT_CFDIS_ROUTE: ${env.parsed.IMPORT_CFDIS_ROUTE}`);
        console.log(`[INFO] ARG: ${env.parsed.ARG}`);
        logGenerator(logFileName, 'info', `[INFO] Iniciando proceso de importación - ROUTE: ${env.parsed.IMPORT_CFDIS_ROUTE}, ARG: ${env.parsed.ARG}`);

        if (typeof env.parsed.IMPORT_CFDIS_ROUTE !== "undefined" && typeof env.parsed.ARG !== "undefined") {
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
                    resolve(code);
                } else {
                    console.error(`[ERROR] Proceso de importación finalizó con código ${code}`);
                    logGenerator(logFileName, 'error', `[CLOSE] Proceso de importación finalizó con código de error ${code}`);
                    reject(new Error(`Child process failed with code ${code}`));
                }
                
                // Mark that child process is complete
                global.childProcessComplete = true;
            });

            // Handle process errors
            childProcess.on('error', (error) => {
                console.error(`[ERROR] Error iniciando proceso de importación: ${error.message}`);
                logGenerator(logFileName, 'error', `[ERROR] Error iniciando proceso de importación: ${error.message}`);
                reject(error);
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

            // Resolve immediately since no child process will run
            resolve(null);
        }
    });
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
async function startBackgroundProcesses() {
    const logFileName = 'MainProcess';
    
    // Show startup notification
    showStartupNotification();
    
    try {
        // Start main CFDI processing and wait for completion
        logGenerator(logFileName, 'info', '[START] Iniciando proceso forResponse');
        await forResponse();
        logGenerator(logFileName, 'info', '[COMPLETE] Proceso forResponse completado, iniciando child process');
        
        // Start child process and wait for completion
        await startChildProcess();
        logGenerator(logFileName, 'info', '[COMPLETE] Child process completado, todos los procesos finalizados');
        
        // Auto-terminate after all processes complete (for scheduled tasks)
        if (process.env.AUTO_TERMINATE === 'true') {
            logGenerator(logFileName, 'info', '[AUTO-TERMINATE] Finalizando proceso automáticamente después de completar todas las tareas');
            setTimeout(() => {
                process.exit(0);
            }, 2000); // Brief delay to ensure logs are written
        }
    } catch (error) {
        console.log(error);
        logGenerator(logFileName, 'error', `[ERROR] Error en proceso principal: ${error.message}`);
        
        // Exit on error if auto-terminate is enabled
        if (process.env.AUTO_TERMINATE === 'true') {
            setTimeout(() => {
                logGenerator(logFileName, 'error', '[AUTO-TERMINATE] Finalizando proceso debido a error');
                process.exit(1);
            }, 2000);
        }
    }
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