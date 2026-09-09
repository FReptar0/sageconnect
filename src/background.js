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
const { formatDurationMin, withStepTimeout } = require('./utils/duration');
const config = require('./config');
const notifier = require('node-notifier');
const fs = require('fs');
const path = require('path');
const { runQuery } = require('./utils/SQLServerConnection');
const { shouldDispatchEom, shouldDispatchPaymentReport, paymentPeriodOf, buildEomEmailHtml, writeSentinelAtomically } = require('./utils/EomNotification');
const { sendOperatorReport } = require('./utils/EmailSender');
const { sendAdminAlert } = require('./utils/AdminEmailSender');
const { buildScopeWhere } = require('./utils/RetryPolicy');

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

    // EOM-01..05 (D-08, D-09, D-10, D-11, D-14): cron-tick guard for end-of-month operator email.
    // Runs BEFORE the tenant loop so a slow EOM query doesn't block the rest of the tick.
    // Failure does NOT re-throw — EOM is best-effort, the cron tick must continue.
    if (!config.eom.notificationEnabled) {
        logGenerator('EomNotification', 'info', '[EOM-SKIP] reason=enabled-false');
    } else {
        const __step = 'eomDispatch';
        try {
            await withStepTimeout(
                dispatchEomIfDue(date, config),
                config.schedule.stepTimeoutMs,
                `step=${__step}`
            );
        } catch (stepErr) {
            const __stepError = stepErr.message || String(stepErr);
            if (/Step timeout/.test(__stepError)) {
                logGenerator(logFileName, 'error',
                    `[TIMEOUT] step=${__step} tenant=global url=n/a ` +
                    `durationMs=${config.schedule.stepTimeoutMs} err=${__stepError}`);
            }
            // Per PATTERNS.md + SPEC Constraints "SMTP error budget":
            // EOM failure must NOT block the cron tick — log and continue.
            logGenerator('EomNotification', 'error', `[EOM-DISPATCH] Failed: ${__stepError}`);
        }
    }

    // Q3-03 / Q3-04: la misma compuerta, ahora para el reporte quincenal de pagos pendientes.
    // Va en su PROPIO bloque y no dentro del try de arriba a proposito: si dispatchEomIfDue
    // lanza, ese catch se dispara y el reporte quincenal nunca correria — un fallo del cierre
    // de mes silenciaria un reporte que no tiene nada que ver con el. Q3-04 pide interruptores
    // de apagado independientes, y dominios de fallo independientes son ese mismo requisito
    // expresado en tiempo de ejecucion.
    //
    // El nombre del paso, paymentReport, es distinto del de cierre de mes a proposito, para que
    // una linea [TIMEOUT] nombre el flujo que de verdad se atoro. withStepTimeout por paso es
    // el patron ya establecido aqui — forResponse envuelve cada uno de sus siete pasos
    // por tenant — asi que esto no anade ningun nivel a la cadena de CLAUDE.md §9:
    // STEP_TIMEOUT_MS sigue acotando cada paso y LOCK_TIMEOUT_MS sigue acotando el tick.
    //
    // Reutiliza `date`, el reloj ya capturado al inicio del tick. Dos lecturas dentro de un
    // mismo tick podrian caer a distintos lados de la medianoche o de la hora y poner a los dos
    // despachadores en dias distintos: un bug que asomaria una vez al ano y no se reproduciria.
    if (!config.notifications.paymentReport.enabled) {
        logGenerator('EomNotification', 'info', '[PAYREPORT-SKIP] reason=enabled-false');
    } else {
        const __step = 'paymentReport';
        try {
            await withStepTimeout(
                dispatchPaymentReportIfDue(date, config),
                config.schedule.stepTimeoutMs,
                `step=${__step}`
            );
        } catch (stepErr) {
            const __stepError = stepErr.message || String(stepErr);
            if (/Step timeout/.test(__stepError)) {
                logGenerator(logFileName, 'error',
                    `[TIMEOUT] step=${__step} tenant=global url=n/a ` +
                    `durationMs=${config.schedule.stepTimeoutMs} err=${__stepError}`);
            }
            // Mismo criterio que el bloque de cierre de mes: el reporte es best-effort y el
            // tick del cron debe continuar. No se re-lanza.
            logGenerator('EomNotification', 'error', `[PAYREPORT-DISPATCH] Failed: ${__stepError}`);
        }
    }

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
                    // ROOT-03 (D-12): per-step timeout via Promise.race wrapping.
                    // Phantom continuation aceptada (D-10) — la promise original sigue corriendo en background
                    // si el timeout dispara; ROOT-01 axios timeout (Plan 19-01) corta HTTP requests colgados.
                    await withStepTimeout(buildProvidersXML(i), config.schedule.stepTimeoutMs, `step=${__step} tenant=${tenantIds[i]}`);
                    logGenerator(logFileName, 'info', `[COMPLETE] buildProvidersXML completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    // ROOT-04 (D-13/D-16): log [TIMEOUT] entry IF this was a step timeout (else logs as normal step error).
                    // Wording sentinel `'Step timeout'` is set in src/utils/duration.js withStepTimeout.
                    if (/Step timeout/.test(__stepError)) {
                        logGenerator(logFileName, 'error',
                            `[TIMEOUT] step=${__step} tenant=${tenantIds[i]} url=n/a ` +
                            `durationMs=${config.schedule.stepTimeoutMs} err=${__stepError}`);
                    }
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
                    // ROOT-03 (D-12): per-step timeout via Promise.race wrapping.
                    await withStepTimeout(downloadCFDI(i), config.schedule.stepTimeoutMs, `step=${__step} tenant=${tenantIds[i]}`);
                    logGenerator(logFileName, 'info', `[COMPLETE] downloadCFDI completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    // ROOT-04 (D-13/D-16): log [TIMEOUT] entry IF this was a step timeout.
                    if (/Step timeout/.test(__stepError)) {
                        logGenerator(logFileName, 'error',
                            `[TIMEOUT] step=${__step} tenant=${tenantIds[i]} url=n/a ` +
                            `durationMs=${config.schedule.stepTimeoutMs} err=${__stepError}`);
                    }
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
                    // ROOT-03 (D-12): per-step timeout via Promise.race wrapping.
                    await withStepTimeout(checkPayments(i), config.schedule.stepTimeoutMs, `step=${__step} tenant=${tenantIds[i]}`);
                    logGenerator(logFileName, 'info', `[COMPLETE] checkPayments completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    // ROOT-04 (D-13/D-16): log [TIMEOUT] entry IF this was a step timeout.
                    if (/Step timeout/.test(__stepError)) {
                        logGenerator(logFileName, 'error',
                            `[TIMEOUT] step=${__step} tenant=${tenantIds[i]} url=n/a ` +
                            `durationMs=${config.schedule.stepTimeoutMs} err=${__stepError}`);
                    }
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
                    // ROOT-03 (D-12): per-step timeout via Promise.race wrapping.
                    await withStepTimeout(uploadPayments(i), config.schedule.stepTimeoutMs, `step=${__step} tenant=${tenantIds[i]}`);
                    logGenerator(logFileName, 'info', `[COMPLETE] uploadPayments completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    // ROOT-04 (D-13/D-16): log [TIMEOUT] entry IF this was a step timeout.
                    if (/Step timeout/.test(__stepError)) {
                        logGenerator(logFileName, 'error',
                            `[TIMEOUT] step=${__step} tenant=${tenantIds[i]} url=n/a ` +
                            `durationMs=${config.schedule.stepTimeoutMs} err=${__stepError}`);
                    }
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
                    // ROOT-03 (D-12): per-step timeout via Promise.race wrapping.
                    await withStepTimeout(createPurchaseOrders(i), config.schedule.stepTimeoutMs, `step=${__step} tenant=${tenantIds[i]}`);
                    logGenerator(logFileName, 'info', `[COMPLETE] createPurchaseOrders completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    // ROOT-04 (D-13/D-16): log [TIMEOUT] entry IF this was a step timeout.
                    if (/Step timeout/.test(__stepError)) {
                        logGenerator(logFileName, 'error',
                            `[TIMEOUT] step=${__step} tenant=${tenantIds[i]} url=n/a ` +
                            `durationMs=${config.schedule.stepTimeoutMs} err=${__stepError}`);
                    }
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
                    // ROOT-03 (D-12): per-step timeout via Promise.race wrapping.
                    await withStepTimeout(processOrderChanges(i), config.schedule.stepTimeoutMs, `step=${__step} tenant=${tenantIds[i]}`);
                    logGenerator(logFileName, 'info', `[COMPLETE] processOrderChanges completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    // ROOT-04 (D-13/D-16): log [TIMEOUT] entry IF this was a step timeout.
                    if (/Step timeout/.test(__stepError)) {
                        logGenerator(logFileName, 'error',
                            `[TIMEOUT] step=${__step} tenant=${tenantIds[i]} url=n/a ` +
                            `durationMs=${config.schedule.stepTimeoutMs} err=${__stepError}`);
                    }
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
                    // ROOT-03 (D-12): per-step timeout via Promise.race wrapping.
                    await withStepTimeout(closePurchaseOrders(i), config.schedule.stepTimeoutMs, `step=${__step} tenant=${tenantIds[i]}`);
                    logGenerator(logFileName, 'info', `[COMPLETE] closePurchaseOrders completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    // ROOT-04 (D-13/D-16): log [TIMEOUT] entry IF this was a step timeout.
                    if (/Step timeout/.test(__stepError)) {
                        logGenerator(logFileName, 'error',
                            `[TIMEOUT] step=${__step} tenant=${tenantIds[i]} url=n/a ` +
                            `durationMs=${config.schedule.stepTimeoutMs} err=${__stepError}`);
                    }
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
 * EOM dispatch — sends two consolidated emails (POs + payments) to the operator
 * mailbox if the cron-tick gate is open (last day of month, hour >= notificationHour,
 * sentinel missing). Per CONTEXT D-08, D-09, D-10, D-11, D-14.
 *
 * Best-effort: SMTP failures fall back to AdminEmailSender; sentinel always written;
 * does NOT re-throw — caller (forResponse) catches and continues.
 *
 * @param {Date} now - current time (injected for testability per D-16)
 * @param {object} cfg - config object (injected for testability)
 * @returns {Promise<void>}
 */
async function dispatchEomIfDue(now, cfg) {
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyyMm = `${yyyy}-${mm}`;
    const tenantsList = cfg.portal.tenants;

    for (const category of ['pos', 'payments']) {
        const sentinelPath = path.join(cfg.paths.logs, `eom-${yyyyMm}-${category}.sent`);
        if (!shouldDispatchEom(now, sentinelPath, cfg.eom)) {
            logGenerator('EomNotification', 'info', `[EOM-SKIP] category=${category} reason=gate-false`);
            continue;
        }
        logGenerator('EomNotification', 'info',
            `[EOM-GATE] category=${category} day=last hour=${now.getHours()} sentinel=missing`);

        // Aggregate rows across all tenants. Per CONTEXT D-09: HARDCODED current_month scope.
        const allRows = [];
        for (let i = 0; i < tenantsList.length; i++) {
            const tenantDb = tenantsList[i].database;
            try {
                const sql = buildEomDataQuery(category, tenantDb);
                const { recordset } = await runQuery(sql, tenantDb);
                if (recordset && recordset.length > 0) {
                    allRows.push(...recordset);
                }
            } catch (qErr) {
                logGenerator('EomNotification', 'warn',
                    `[EOM-DISPATCH] category=${category} tenant=${tenantDb} query-failed err=${qErr.message}`);
                // Continue to next tenant; partial data better than no data
            }
        }

        // Per CONTEXT D-10: empty categories STILL send the email (with "Sin pendientes" body)
        const html = buildEomEmailHtml(allRows, category);
        const subject = `[SageConnect] Pendientes fin de mes — ${category === 'pos' ? 'POs' : 'Pagos'} — ${yyyyMm}`;
        let sentinelPayload;
        try {
            await sendOperatorReport({ subject, html, callerLogFile: 'EomNotification' });
            sentinelPayload = { timestamp: new Date().toISOString(), success: true, rowCount: allRows.length };
            logGenerator('EomNotification', 'info',
                `[EOM-DISPATCH] category=${category} rows=${allRows.length} sent=true`);
        } catch (smtpErr) {
            sentinelPayload = {
                timestamp: new Date().toISOString(),
                success: false,
                error: smtpErr.message,
                rowCount: allRows.length,
            };
            logGenerator('EomNotification', 'error',
                `[EOM-DISPATCH] category=${category} rows=${allRows.length} sent=false err=${smtpErr.message}`);
            // SMTP failure fallback per REQ EOM-04
            await sendAdminAlert(
                `[SageConnect] EOM email FAILED for ${yyyyMm} - ${category}`,
                `<p>EOM dispatch failed for category ${category} on ${yyyyMm}.</p><p>Error: ${smtpErr.message}</p><p>Row count was ${allRows.length}.</p>`,
                'EomNotification'
            );
        }

        // ALWAYS write sentinel (success or fail) per SPEC EOM-04 + CONTEXT D-07
        try {
            writeSentinelAtomically(sentinelPath, sentinelPayload);
            logGenerator('EomNotification', 'info',
                `[EOM-SENTINEL] path=${sentinelPath} payload=${JSON.stringify(sentinelPayload)}`);
        } catch (fsErr) {
            logGenerator('EomNotification', 'error',
                `[EOM-SENTINEL] path=${sentinelPath} write-failed err=${fsErr.message}`);
        }
    }
}

/**
 * Q3-03 — despacho del reporte quincenal de pagos pendientes.
 *
 * Hermano de dispatchEomIfDue, no una rama suya: cadencia distinta (dos veces al mes contra
 * cierre de mes), ventana distinta (last_n_days contra el mes en curso) y su propio
 * interruptor de apagado, independiente del de cierre de mes (D-09 / Q3-04). Cuentas por
 * pagar paga dos veces al mes, así que el reporte sigue un ritmo que ya existe.
 *
 * El periodo lo lleva la RUTA del centinela — payment-report-YYYY-MM-{1|2}.sent, D-06 — y no
 * un término de día dentro del predicado. Por eso la compuerta abre en el PRIMER tick a
 * partir del inicio del periodo, no sólo el día 1 o el 16 exactos (D-07): un servicio caído
 * el 16 sigue reportando el 20, tarde pero completo. Por eso también el log de compuerta
 * incluye el día — un operador que lee period=2 day=20 ve que el reporte salió tarde, en vez
 * de preguntarse si salió.
 *
 * Sin respaldo al buzón de administración, a diferencia de dispatchEomIfDue, cuyo catch sí lo
 * usa: LICENSE_ADMIN_EMAIL está
 * reservado al timeout del proceso hijo (D-15) y no debe recibir correo de operación.
 * sendOperatorReport ya se traga los fallos de SMTP internamente, así que el try/catch del
 * envío conserva la forma más que una ruta viva; se mantiene para que el payload del
 * centinela siga siendo honesto si ese contrato llegara a cambiar.
 *
 * Best-effort: no re-lanza. El llamador (forResponse) atrapa y continúa.
 *
 * @param {Date} now - hora actual (inyectada para poder probarla, D-16)
 * @param {object} cfg - config (inyectada para poder probarla)
 * @returns {Promise<void>}
 */
async function dispatchPaymentReportIfDue(now, cfg) {
    const period = paymentPeriodOf(now);
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyyMm = `${yyyy}-${mm}`;

    const sentinelPath = path.join(cfg.paths.logs, `payment-report-${yyyyMm}-${period}.sent`);
    if (!shouldDispatchPaymentReport(now, sentinelPath, cfg.notifications.paymentReport)) {
        logGenerator('EomNotification', 'info', `[PAYREPORT-SKIP] period=${period} reason=gate-false`);
        return;
    }
    logGenerator('EomNotification', 'info',
        `[PAYREPORT-GATE] period=${period} day=${now.getDate()} hour=${now.getHours()} sentinel=missing`);

    // Agregación por tenant, con la misma forma que dispatchEomIfDue: la base muerta de un
    // tenant no puede silenciar a los demás. Datos parciales valen más que ningún dato.
    const tenantsList = cfg.portal.tenants;
    const allRows = [];
    for (let i = 0; i < tenantsList.length; i++) {
        const tenantDb = tenantsList[i].database;
        try {
            const sql = buildEomDataQuery('payments', tenantDb, {
                scope: 'last_n_days',
                lookbackDays: cfg.notifications.paymentReport.lookbackDays,
            });
            const { recordset } = await runQuery(sql, tenantDb);
            if (recordset && recordset.length > 0) {
                allRows.push(...recordset);
            }
        } catch (qErr) {
            logGenerator('EomNotification', 'warn',
                `[PAYREPORT-DISPATCH] period=${period} tenant=${tenantDb} query-failed err=${qErr.message}`);
            // Sigue con el siguiente tenant.
        }
    }

    // Variante por omisión a propósito. La tabla de pagos y su pie de nota 20.2-05 son
    // exactamente lo que este reporte necesita: el pie declara que el sistema de control
    // todavía no registra el detalle del error de cada pago (CR-03, diferido), así que el
    // correo es honesto sobre su propio hueco incluso cuando llega vacío.
    const html = buildEomEmailHtml(allRows, 'payments');
    const subject = `[SageConnect] Pagos pendientes — quincena ${period} — ${yyyyMm}`;
    let sentinelPayload;
    try {
        await sendOperatorReport({ subject, html, callerLogFile: 'EomNotification' });
        sentinelPayload = { timestamp: new Date().toISOString(), success: true, rowCount: allRows.length };
        logGenerator('EomNotification', 'info',
            `[PAYREPORT-DISPATCH] period=${period} rows=${allRows.length} sent=true`);
    } catch (smtpErr) {
        sentinelPayload = {
            timestamp: new Date().toISOString(),
            success: false,
            error: smtpErr.message,
            rowCount: allRows.length,
        };
        logGenerator('EomNotification', 'error',
            `[PAYREPORT-DISPATCH] period=${period} rows=${allRows.length} sent=false err=${smtpErr.message}`);
        // Aquí NO va un respaldo al buzón de administración: ver el encabezado (D-15).
    }

    // El centinela se escribe SIEMPRE, haya salido el correo o no — misma regla que EOM-04.
    // Un periodo que falló queda registrado como intentado, para que un servidor de correo
    // muerto no convierta el reporte en un reintento cada quince minutos contra el buzón del
    // operador.
    try {
        writeSentinelAtomically(sentinelPath, sentinelPayload);
        logGenerator('EomNotification', 'info',
            `[PAYREPORT-SENTINEL] path=${sentinelPath} payload=${JSON.stringify(sentinelPayload)}`);
    } catch (fsErr) {
        logGenerator('EomNotification', 'error',
            `[PAYREPORT-SENTINEL] path=${sentinelPath} write-failed err=${fsErr.message}`);
    }
}

/**
 * Build the pending-items query for a category.
 * Per CLAUDE.md §6 #1: template-literal SQL with controlled tenant DB interpolation.
 *
 * Q3-05 / D-08 — por qué el alcance es un parámetro OPCIONAL y no un cambio directo.
 * Esta función sirve a dos correos con cadencias distintas. El de cierre de mes omite el
 * tercer argumento y recibe exactamente la misma cadena que producía antes de la fase 20.5,
 * que es lo que Q3-05 exige al pie de la letra. El reporte quincenal pasa
 * { scope: 'last_n_days', lookbackDays: config.notifications.paymentReport.lookbackDays },
 * que es lo que D-08 pide: un pago pendiente desde un mes anterior hoy es invisible incluso
 * en el cierre de mes, porque la consulta se limita al mes en curso. Reemplazar el alcance
 * sin condición habría cambiado en silencio el contenido de un correo que la fase declara
 * fuera de alcance, y ninguna aserción existente lo habría detectado.
 *
 * Ambas ramas honran el parámetro, no sólo la de pagos. Un constructor que ignora en
 * silencio el alcance que le pasa quien lo llama es la trampa de valor por omisión implícito
 * que CLAUDE.md §6 #2 registra contra runQuery(query, db = ...), la misma que rompió siete
 * llamadores en el PR #16. La rama de OCs no recibe hoy ningún valor distinto al de omisión;
 * lo acepta de todos modos para no poder mentir al respecto más adelante.
 *
 * Por qué la ventana ampliada sigue acotada, sin mecanismo nuevo: buildScopeWhere LANZA ante
 * un alcance que no reconoce en vez de emitir SQL sin cota, y la guarda de arranque de
 * config.js encierra lookbackDays en [30, 3650]. Entre las dos, la consulta conserva siempre
 * su cota inferior DATEADD y no puede degenerar en un barrido completo del histórico de pagos
 * de Sage.
 *
 * RETRY-S3 / D-10 / D-11: the two branches are deliberately asymmetric. The POs branch reports
 * an error description per row because its own control table genuinely stores one, and stays
 * untouched. The payments branch reports pending payments WITHOUT one: its control table
 * `fesa.dbo.fesaPagosFocaltec` has only four columns (idCia, NoPagoSage, status, idFocaltec —
 * production schema read 2026-07-27), so no column can hold an error description or an error
 * timestamp. Recording payment failures is CR-03, deliberately deferred.
 */
function buildEomDataQuery(category, tenantDb, scope = { scope: 'current_month' }) {
    if (category === 'pos') {
        const dateField = `(SELECT MAX(Fecha) FROM Autorizaciones_electronicas.dbo.Autoriza_OC_detalle WHERE Empresa = '${tenantDb}' AND PONumber = A.PONUMBER)`;
        return `
            SELECT
                '${tenantDb}' AS tenant,
                RTRIM(A.PONUMBER) AS idOrPo,
                ${dateField} AS fechaAuth,
                COALESCE(ef.errorCount, 0) AS attempts,
                ef.lastError AS lastError
            FROM ${tenantDb}.dbo.POPORH1 A
            LEFT OUTER JOIN Autorizaciones_electronicas.dbo.Autoriza_OC X
              ON A.PONUMBER = X.PONumber
            OUTER APPLY (
                SELECT
                    COUNT(*) AS errorCount,
                    (SELECT TOP 1 responseAPI FROM fesa.dbo.fesaOCFocaltec
                     WHERE ocSage = A.PONUMBER AND idDatabase = '${tenantDb}' AND status = 'ERROR'
                     ORDER BY lastUpdate DESC) AS lastError
                FROM fesa.dbo.fesaOCFocaltec
                WHERE ocSage = A.PONUMBER
                  AND idDatabase = '${tenantDb}'
                  AND status = 'ERROR'
            ) AS ef
            WHERE X.Autorizada = 1
              AND X.Empresa = '${tenantDb}'
              AND ${buildScopeWhere(scope, { dateField })}
              AND NOT EXISTS (
                SELECT 1 FROM fesa.dbo.fesaOCFocaltec
                WHERE ocSage = A.PONUMBER AND idDatabase = '${tenantDb}' AND status = 'POSTED'
              )
        `;
    }
    // category === 'payments'
    const dateField = 'CONVERT(Date, CONVERT(VARCHAR(8), P.AUDTDATE))';
    // RETRY-S3 / D-10: este OUTER APPLY solo puede contar filas. `fesa.dbo.fesaPagosFocaltec`
    // tiene exactamente cuatro columnas (idCia, NoPagoSage, status, idFocaltec) segun la lectura
    // del esquema de produccion del 2026-07-27, asi que no existe columna alguna que pueda
    // guardar la descripcion de un error ni su fecha. El sub-select de descripcion de error y su
    // ordenamiento que vivian aqui referenciaban columnas inexistentes: SQL Server abortaba toda
    // la consulta, el try/catch de dispatchEomIfDue lo convertia en cero filas, y el correo de
    // pagos siempre decia "Sin pendientes". Registrar los fallos de pago es CR-03 (diferido);
    // el pie de nota del correo (EomNotification.buildEomEmailHtml) declara ese hueco.
    return `
        SELECT
            '${tenantDb}' AS tenant,
            RTRIM(P.DOCNBR) AS idOrPo,
            CONVERT(VARCHAR(10), CONVERT(Date, CONVERT(VARCHAR(8), P.AUDTDATE))) AS fechaAuth,
            COALESCE(ef.errorCount, 0) AS attempts
        FROM APBTA B
        JOIN BKACCT BK ON B.IDBANK = BK.BANK
        JOIN APTCR P ON B.PAYMTYPE = P.BTCHTYPE AND B.CNTBTCH = P.CNTBTCH
        OUTER APPLY (
            SELECT
                COUNT(*) AS errorCount
            FROM fesa.dbo.fesaPagosFocaltec
            WHERE NoPagoSage = P.DOCNBR
              AND idCia = '${tenantDb}'
              AND status NOT IN ('PAID', 'PARTIAL')
        ) AS ef
        WHERE B.PAYMTYPE = 'PY'
          AND B.BATCHSTAT = 3
          AND P.ERRENTRY = 0
          AND P.RMITTYPE = 1
          AND ${buildScopeWhere(scope, { dateField })}
          AND P.DOCNBR NOT IN (
            SELECT NoPagoSage FROM fesa.dbo.fesaPagosFocaltec
            WHERE idCia = P.AUDTORG AND NoPagoSage = P.DOCNBR
              AND status IN ('PAID', 'PARTIAL')
          )
    `;
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
        // settle clears killTimer (the primary timeout that triggered SIGTERM) to prevent
        // fire-after-resolve when the child closes BEFORE the timeout. graceTimer is NOT
        // cleared in settle because by D-05 design, the grace period must continue running
        // post-reject to fire taskkill — graceTimer is cleared only by close/error listeners
        // that indicate the child terminated on its own.
        let hasSettled = false;
        let killTimer = null;
        let graceTimer = null;
        const settle = (fn) => {
            if (hasSettled) return;
            hasSettled = true;
            if (killTimer) clearTimeout(killTimer);
            fn();
        };
        const cancelGraceTimer = () => {
            if (graceTimer) clearTimeout(graceTimer);
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

            // Close is used to capture the close event.
            // cancelGraceTimer() invoked unconditionally — child terminated, no need for taskkill.
            childProcess.on('close', (code) => {
                cancelGraceTimer();
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

            // Handle process errors.
            // cancelGraceTimer() invoked unconditionally — spawn errored, no PID to taskkill.
            childProcess.on('error', (error) => {
                cancelGraceTimer();
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
    showStartupNotification,
    dispatchEomIfDue,
    dispatchPaymentReportIfDue,
    buildEomDataQuery,
};