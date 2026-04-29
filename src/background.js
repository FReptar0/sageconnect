const { spawn, exec } = require('child_process');
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
const { formatDurationMin } = require('./utils/duration');
const config = require('./config');
const notifier = require('node-notifier');

/**
 * SageConnect Background Processes
 * Handles all CFDI processing, imports, and background tasks
 */

/**
 * Main background process that handles all CFDI operations.
 *
 * @param {Object} [options={}] - Optional parameters for progress emission
 * @param {string|null} [options.operationId=null] - Unique operation ID for progress tracking
 * @param {Object|null} [options.emitter=null] - OperationManager instance with emitProgress()
 */
async function forResponse(options = {}) {
    const { operationId = null, emitter = null } = options;
    const logFileName = 'ForResponse';
    const date = getCurrentDate();
    const delay = config.schedule?.operationDelayMs ?? 5000;
    logGenerator(logFileName, 'info', `[START] Inicio del proceso forResponse a las ${date.toISOString()}`);

    const tenantIds = config.portal.tenants.map(t => t.id);
    for (let i = 0; i < tenantIds.length; i++) {
        try {
            logGenerator(logFileName, 'info', `[INFO] Procesando tenant con índice ${i}`);

            {
                const __step = 'buildProviders';
                let __stepError = null;
                try {
                    if (emitter && operationId) {
                        emitter.startStep('background-cycle', __step, tenantIds[i]);
                        emitter.emitProgress(operationId, {
                            type: 'progress',
                            operation: 'background-cycle',
                            tenant: tenantIds[i],
                            step: __step,
                            message: `Iniciando buildProvidersXML para tenant ${i}`,
                            timestamp: new Date().toISOString(),
                        });
                    }
                    logGenerator(logFileName, 'info', `[START] Iniciando buildProvidersXML para el índice ${i}`);
                    await buildProvidersXML(i);
                    logGenerator(logFileName, 'info', `[COMPLETE] buildProvidersXML completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    throw stepErr; // re-throw so the EXISTING tenant-level try/catch at background.js:145 still fires
                } finally {
                    if (emitter && operationId) {
                        emitter.endStep('background-cycle', __step, tenantIds[i], { error: __stepError });
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, delay));

            {
                const __step = 'downloadCFDI';
                let __stepError = null;
                try {
                    if (emitter && operationId) {
                        emitter.startStep('background-cycle', __step, tenantIds[i]);
                        emitter.emitProgress(operationId, {
                            type: 'progress',
                            operation: 'background-cycle',
                            tenant: tenantIds[i],
                            step: __step,
                            message: `Iniciando downloadCFDI para tenant ${i}`,
                            timestamp: new Date().toISOString(),
                        });
                    }
                    logGenerator(logFileName, 'info', `[START] Iniciando downloadCFDI para el índice ${i}`);
                    await downloadCFDI(i);
                    logGenerator(logFileName, 'info', `[COMPLETE] downloadCFDI completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    throw stepErr; // re-throw so the EXISTING tenant-level try/catch at background.js:145 still fires
                } finally {
                    if (emitter && operationId) {
                        emitter.endStep('background-cycle', __step, tenantIds[i], { error: __stepError });
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, delay));

            {
                const __step = 'checkPayments';
                let __stepError = null;
                try {
                    if (emitter && operationId) {
                        emitter.startStep('background-cycle', __step, tenantIds[i]);
                        emitter.emitProgress(operationId, {
                            type: 'progress',
                            operation: 'background-cycle',
                            tenant: tenantIds[i],
                            step: __step,
                            message: `Iniciando checkPayments para tenant ${i}`,
                            timestamp: new Date().toISOString(),
                        });
                    }
                    logGenerator(logFileName, 'info', `[START] Iniciando checkPayments para el índice ${i}`);
                    await checkPayments(i);
                    logGenerator(logFileName, 'info', `[COMPLETE] checkPayments completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    throw stepErr; // re-throw so the EXISTING tenant-level try/catch at background.js:145 still fires
                } finally {
                    if (emitter && operationId) {
                        emitter.endStep('background-cycle', __step, tenantIds[i], { error: __stepError });
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, delay));

            {
                const __step = 'uploadPayments';
                let __stepError = null;
                try {
                    if (emitter && operationId) {
                        emitter.startStep('background-cycle', __step, tenantIds[i]);
                        emitter.emitProgress(operationId, {
                            type: 'progress',
                            operation: 'background-cycle',
                            tenant: tenantIds[i],
                            step: __step,
                            message: `Iniciando uploadPayments para tenant ${i}`,
                            timestamp: new Date().toISOString(),
                        });
                    }
                    logGenerator(logFileName, 'info', `[START] Iniciando uploadPayments para el índice ${i}`);
                    await uploadPayments(i);
                    logGenerator(logFileName, 'info', `[COMPLETE] uploadPayments completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    throw stepErr; // re-throw so the EXISTING tenant-level try/catch at background.js:145 still fires
                } finally {
                    if (emitter && operationId) {
                        emitter.endStep('background-cycle', __step, tenantIds[i], { error: __stepError });
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, delay));

            {
                const __step = 'createPurchaseOrders';
                let __stepError = null;
                try {
                    if (emitter && operationId) {
                        emitter.startStep('background-cycle', __step, tenantIds[i]);
                        emitter.emitProgress(operationId, {
                            type: 'progress',
                            operation: 'background-cycle',
                            tenant: tenantIds[i],
                            step: __step,
                            message: `Iniciando createPurchaseOrders para tenant ${i}`,
                            timestamp: new Date().toISOString(),
                        });
                    }
                    logGenerator(logFileName, 'info', `[START] Iniciando createPurchaseOrders para el índice ${i}`);
                    await createPurchaseOrders(i);
                    logGenerator(logFileName, 'info', `[COMPLETE] createPurchaseOrders completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    throw stepErr; // re-throw so the EXISTING tenant-level try/catch at background.js:145 still fires
                } finally {
                    if (emitter && operationId) {
                        emitter.endStep('background-cycle', __step, tenantIds[i], { error: __stepError });
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, delay));

            {
                const __step = 'processOrderChanges';
                let __stepError = null;
                try {
                    if (emitter && operationId) {
                        emitter.startStep('background-cycle', __step, tenantIds[i]);
                        emitter.emitProgress(operationId, {
                            type: 'progress',
                            operation: 'background-cycle',
                            tenant: tenantIds[i],
                            step: __step,
                            message: `Iniciando processOrderChanges para tenant ${i}`,
                            timestamp: new Date().toISOString(),
                        });
                    }
                    logGenerator(logFileName, 'info', `[START] Iniciando processOrderChanges para el índice ${i}`);
                    await processOrderChanges(i);
                    logGenerator(logFileName, 'info', `[COMPLETE] processOrderChanges completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    throw stepErr; // re-throw so the EXISTING tenant-level try/catch at background.js:145 still fires
                } finally {
                    if (emitter && operationId) {
                        emitter.endStep('background-cycle', __step, tenantIds[i], { error: __stepError });
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, delay));

            {
                const __step = 'closePurchaseOrders';
                let __stepError = null;
                try {
                    if (emitter && operationId) {
                        emitter.startStep('background-cycle', __step, tenantIds[i]);
                        emitter.emitProgress(operationId, {
                            type: 'progress',
                            operation: 'background-cycle',
                            tenant: tenantIds[i],
                            step: __step,
                            message: `Iniciando closePurchaseOrders para tenant ${i}`,
                            timestamp: new Date().toISOString(),
                        });
                    }
                    logGenerator(logFileName, 'info', `[START] Iniciando closePurchaseOrders para el índice ${i}`);
                    await closePurchaseOrders(i);
                    logGenerator(logFileName, 'info', `[COMPLETE] closePurchaseOrders completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    throw stepErr; // re-throw so the EXISTING tenant-level try/catch at background.js:145 still fires
                } finally {
                    if (emitter && operationId) {
                        emitter.endStep('background-cycle', __step, tenantIds[i], { error: __stepError });
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, delay));

            logGenerator(logFileName, 'info', `[TENANT-COMPLETE] Todos los procesos completados para el tenant índice ${i}`);
        } catch (error) {
            logGenerator(logFileName, 'error', `[ERROR] Error procesando el índice ${i}: ${error.message}`);
            logGenerator(logFileName, 'error', `[ERROR] Stack trace: ${error.stack}`);
            if (emitter && operationId) {
                emitter.emitProgress(operationId, {
                    type: 'error',
                    operation: 'background-cycle',
                    tenant: tenantIds[i],
                    step: 'tenant-error',
                    message: error.message,
                    timestamp: new Date().toISOString(),
                });
            }
            // Continue with next tenant even if current one fails
        }
    }

    // Emit completion event
    if (emitter && operationId) {
        emitter.emitProgress(operationId, {
            type: 'complete',
            operation: 'background-cycle',
            tenant: null,
            step: null,
            message: 'Proceso forResponse completado',
            timestamp: new Date().toISOString(),
        });
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

        // ROOT-02 / D-06: closure-scoped state for the kill cascade.
        // hasSettled prevents double-settle if `close` fires during the grace period
        // (process terminated cleanly between SIGTERM and taskkill — must settle exactly once).
        // killTimer + graceTimer are cleared in the settle wrapper BEFORE invoking resolve/reject
        // to avoid fire-after-resolve (timer firing on an already-finalized PID).
        let hasSettled = false;
        let killTimer = null;
        let graceTimer = null;
        const settle = (fn) => {
            if (hasSettled) return;
            hasSettled = true;
            if (killTimer) clearTimeout(killTimer);
            if (graceTimer) clearTimeout(graceTimer);
            fn();
        };

        console.log(`[INFO] IMPORT_CFDIS_ROUTE: ${config.app.importRoute}`);
        console.log(`[INFO] ARG: ${config.app.arg}`);
        logGenerator(logFileName, 'info', `[INFO] Iniciando proceso de importación - ROUTE: ${config.app.importRoute}, ARG: ${config.app.arg}`);

        if (config.app.importRoute && config.app.arg) {
            const childProcess = spawn(config.app.importRoute, [config.app.arg]);
            logGenerator(logFileName, 'info', `[INFO] Child process iniciado con PID: ${childProcess.pid}`);

            // ROOT-02 / D-05 / D-06: kill cascade — SIGTERM → 30s grace hardcoded → taskkill /F /T
            // The reject error message wording `'Child process timeout'` is LOAD-BEARING:
            // CronScheduler.js detects it via /Child process timeout/ regex to dispatch admin email (D-15).
            killTimer = setTimeout(() => {
                const durationMs = config.schedule.childProcessTimeoutMs;
                const durationLabel = formatDurationMin(durationMs);

                // ROOT-04 / D-13 / D-14: log [TIMEOUT] entry to ChildProcess.log con context (D-16: step + tenant=global + pid + durationMs).
                logGenerator(logFileName, 'error',
                    `[TIMEOUT] step=startChildProcess tenant=global pid=${childProcess.pid} ` +
                    `durationMs=${durationMs} action=SIGTERM`);

                childProcess.kill();    // SIGTERM (Unix) / mapped exit signal (Windows via Node)

                // 30s grace period — hardcoded, NOT env-configurable (D-05 specifics).
                // Gives the exe a chance to close cleanly (file handles, buffer flush) before hard kill.
                graceTimer = setTimeout(() => {
                    if (childProcess.exitCode === null) {
                        logGenerator(logFileName, 'error',
                            `[TIMEOUT] step=startChildProcess pid=${childProcess.pid} action=taskkill /F /T`);
                        // /T: tree kill (matches PowerShell Stop-Process -Force semantics; kills helpers spawneados por el exe).
                        // /F: force without prompt.
                        // PID is integer-typed by Node — no shell injection risk (T-19-02-02).
                        // Fire-and-forget callback — reject already dispatched via settle.
                        exec(`taskkill /F /T /PID ${childProcess.pid}`, (err) => {
                            if (err) {
                                logGenerator(logFileName, 'warn',
                                    `[TIMEOUT] taskkill exec failed: ${err.message}`);
                            }
                        });
                    }
                }, 30000);

                // Settle (reject) — wording sentinel `Child process timeout` is load-bearing (see CronScheduler.js).
                settle(() => reject(new Error(
                    `Child process timeout after ${durationLabel} — killed (PID was ${childProcess.pid})`
                )));
            }, config.schedule.childProcessTimeoutMs);

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
                    settle(() => resolve(code));
                } else {
                    console.error(`[ERROR] Proceso de importación finalizó con código ${code}`);
                    logGenerator(logFileName, 'error', `[CLOSE] Proceso de importación finalizó con código de error ${code}`);
                    settle(() => reject(new Error(`Child process failed with code ${code}`)));
                }

                // Mark that child process is complete
                global.childProcessComplete = true;
            });

            // Handle process errors
            childProcess.on('error', (error) => {
                console.error(`[ERROR] Error iniciando proceso de importación: ${error.message}`);
                logGenerator(logFileName, 'error', `[ERROR] Error iniciando proceso de importación: ${error.message}`);
                settle(() => reject(error));
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

            // Resolve immediately since no child process will run.
            // settle wrapper ensures idempotent semantics (no timer was armed in this branch).
            settle(() => resolve(null));
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
        
    } catch (error) {
        console.log(error);
        logGenerator(logFileName, 'error', `[ERROR] Error en proceso principal: ${error.message}`);
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