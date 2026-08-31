/**
 * Schedule Routes
 *
 * 4 endpoints for schedule operations:
 * - GET /                       : View current schedule status (cron, next run, last run)
 * - GET /history                : View last 24 hours of execution history
 * - POST /:taskId/trigger       : Manually trigger a scheduled task (409 if already running)
 * - POST /:taskId/force-release : Force-release a stuck OperationManager lock (REC-04 / D-07)
 *
 * Write endpoints require API key authentication and apply write rate limiting.
 * Force-release is idempotent — always returns 200 (released:true | released:false).
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const { validate } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/async-handler');
const { requireApiKey } = require('../middleware/api-key');
const { successResult, errorResult } = require('../utils/ResultEnvelope');
const operationManager = require('../services/OperationManager');
const config = require('../config');
const { triggerSchema, forceReleaseParamsSchema, forceReleaseBodySchema } = require('./schemas/schedule-schemas');
const { forResponse, startChildProcess } = require('../background');
const { logGenerator } = require('../utils/LogGenerator');
const { formatDurationMin } = require('../utils/duration');
const {
    sendAdminAlert: _sendAdminAlertImpl,
    findLastOpenStep,
} = require('../utils/AdminEmailSender');

const LOG_FILE = 'ScheduleRoutes';

// Lazy-load CronScheduler (may not exist if Plan 02 not yet executed)
let cronScheduler = null;
try {
    cronScheduler = require('../services/CronScheduler');
} catch (_e) {
    // Plan 02 (CronScheduler) not yet executed -- use defaults
}

// Write rate limiter -- inline to avoid circular dependency with server.js
const writeLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        success: false,
        data: null,
        errors: ['Too many write requests, please try again later'],
        summary: 'Rate limited',
        meta: {
            duration: 0,
            timestamp: new Date().toISOString(),
            tenant: null,
        },
    },
});

// ---------------------------------------------------------------------------
// Helpers (Phase 18, REC-04 + REC-05) — sendAdminAlert + findLastOpenStep
// extracted to src/utils/AdminEmailSender.js per PATTERNS.md §S-6 third-use
// trigger (Quick task 260502-i7l). Local 2-arg wrapper preserves the existing
// call-site signature and threads LOG_FILE='ScheduleRoutes' so [ADMIN-EMAIL]
// log entries continue to appear in ScheduleRoutes.log (no log routing change).
// ---------------------------------------------------------------------------

/**
 * @param {string} subject  — already includes the [SageConnect] prefix.
 * @param {string} html     — full HTML body of the message.
 */
function sendAdminAlert(subject, html) {
    return _sendAdminAlertImpl(subject, html, LOG_FILE);
}

// ---------------------------------------------------------------------------
// GET / (maps to GET /api/schedule)
// ---------------------------------------------------------------------------
router.get(
    '/',
    asyncHandler(async (_req, res) => {
        let schedulerStatus;

        if (cronScheduler && typeof cronScheduler.getSchedulerStatus === 'function') {
            schedulerStatus = cronScheduler.getSchedulerStatus();
        } else {
            schedulerStatus = {
                cronExpression: config.schedule.cronExpression,
                status: 'not-initialized',
                nextRun: null,
                lastRun: null,
            };
        }

        const result = successResult(
            {
                tasks: [{
                    taskId: 'background-cycle',
                    ...schedulerStatus,
                }],
            },
            'Schedule retrieved'
        );

        res.json(result);
    })
);

// ---------------------------------------------------------------------------
// GET /history (maps to GET /api/schedule/history)
// ---------------------------------------------------------------------------
router.get(
    '/history',
    asyncHandler(async (_req, res) => {
        const history = operationManager.getHistory(24);
        const result = successResult(
            {
                executions: history,
                count: history.length,
            },
            'History retrieved'
        );

        res.json(result);
    })
);

// ---------------------------------------------------------------------------
// POST /:taskId/trigger (maps to POST /api/schedule/:taskId/trigger)
// ---------------------------------------------------------------------------
router.post(
    '/:taskId/trigger',
    requireApiKey,
    validate(triggerSchema, 'params'),
    writeLimiter,
    asyncHandler(async (req, res) => {
        const { taskId } = req.params;
        const operationId = crypto.randomUUID();

        const locked = operationManager.acquireLock(taskId, operationId);
        if (!locked) {
            return res.status(409).json(
                errorResult(
                    ['Background cycle is already running'],
                    'Conflict'
                )
            );
        }

        // Start background cycle without awaiting -- return immediately
        const startedAt = new Date().toISOString();

        // -------------------------------------------------------------------
        // Fase 23 (plan 23-04, REQ-23-10) — GUARDA DE PROPIEDAD DEL CANDADO.
        //
        // POR QUÉ EXISTE: operationManager.releaseLock(operationType)
        // (src/services/OperationManager.js:63) borra el slot y cancela su
        // watchdog SIN comparar el operationId. Al encadenar el importador
        // (hasta 10 min) esta cadena dura ~23 min contra un candado que se
        // auto-libera a los 14 (LOCK_TIMEOUT_MS), así que la secuencia
        // auto-release (t=14) → tick del cron que toma un candado NUEVO (t=15)
        // → .finally() tardío de ESTA cadena (t=23) terminaría borrando el slot
        // del cron y cancelándole su watchdog: ciclo sin red, estado reportando
        // idle, botón rehabilitado y un clic más = tercer ciclo concurrente.
        // Hallazgo CR-01 de
        // .planning/phases/23-boton-invoca-importador/23-REVIEW.md.
        //
        // La guarda vive AQUÍ, en el llamador, y NO en releaseLock: cambiar la
        // firma o el comportamiento de una utilidad compartida rompe a sus otros
        // llamadores (CLAUDE.md §6 pitfall #2, el PR #16 que rompió 7).
        // -------------------------------------------------------------------
        const ownsLock = () => {
            const current = operationManager.getRunningOperations()[taskId];
            return Boolean(current) && current.operationId === operationId;
        };

        forResponse({ operationId, emitter: operationManager })
            .then(async () => {
                // -------------------------------------------------------------------
                // Fase 23 (REQ-23-01..REQ-23-04 / D-01, D-02, D-04): el disparo manual
                // encadena el importador DESPUÉS de forResponse y DENTRO del lock
                // 'background-cycle' que este handler ya tomó. Sin este eslabón el XML
                // se descarga y se queda en la carpeta de descargas sin llegar a Sage.
                //
                // RÉPLICA DELIBERADA de src/services/CronScheduler.js:106-150.
                // NO se extrajo a un helper compartido: cuatro tests afirman sobre el
                // CÓDIGO FUENTE de CronScheduler.js
                // (tests/integration/timeout-logging.test.js:84-99 y
                // tests/services/CronScheduler.timeout-listener.test.js:288-303) y
                // extraerlo los rompería. Contador de PATTERNS.md §S-6 (extraer en el
                // 3.er uso, no en el 2.º) para este bloque: 2 de 3.
                //
                // Quien toque un lado DEBE tocar el otro. Los tests de paridad sobre el
                // fuente de este archivo (timeout-logging.test.js, describe ROOT-02) son
                // la red que convierte esta duplicación en copia verificada.
                // -------------------------------------------------------------------
                let __scpError = null;
                // REQ-23-10: propiedad del candado AL ENTRAR al eslabón del importador.
                // Si forResponse se pasó del auto-release y el slot ya es de otra
                // operación, no escribimos en su stepProgress.
                const instrument = ownsLock();
                try {
                    // Literal 'background-cycle' a propósito, NO la variable taskId: esa
                    // clave es la del LOCK, que es invariante, no el parámetro de la
                    // request. triggerSchema hoy fija taskId a ese mismo valor, así que
                    // coinciden, pero el literal mantiene la paridad byte a byte con el
                    // cron y sobrevive si un endpoint futuro acepta otros nombres de
                    // tarea sobre el mismo lock compartido.
                    if (instrument) {
                        operationManager.startStep('background-cycle', 'startChildProcess', null);
                    }
                    await startChildProcess();
                } catch (scpErr) {
                    __scpError = scpErr.message || String(scpErr);

                    // ROOT-02 / D-15: detect child process timeout via wording sentinel and dispatch admin email.
                    // Wording sentinel `'Child process timeout'` is set in src/background.js startChildProcess reject().
                    // ROOT-04 / D-15 explicit: ONLY child timeouts dispatch email — axios/step timeouts do NOT.
                    const isChildTimeout = /Child process timeout/.test(__scpError);
                    if (isChildTimeout) {
                        const childDurationMs = config.schedule.childProcessTimeoutMs;
                        const childDurationLabel = formatDurationMin(childDurationMs);

                        // Fase 23 D-06: esta entrada va a ScheduleRoutes.log (el wrapper local de
                        // sendAdminAlert inyecta LOG_FILE), no a CronScheduler.log. Un operador que
                        // hace grep de [TIMEOUT] sabe por el archivo si vino del botón o del cron.
                        logGenerator(LOG_FILE, 'error',
                            `[TIMEOUT] step=startChildProcess operationId=${operationId} ` +
                            `durationMs=${childDurationMs} action=admin-email-dispatched`);

                        // Fase 23 D-05: MISMO asunto que el cron, sin sufijos ni variantes — los
                        // filtros de correo del admin siguen funcionando. Quién lo disparó se
                        // distingue por el archivo de log de origen (D-06), no por el asunto.
                        // fire-and-forget: sendAdminAlert envuelve su propio try/catch y nunca lanza;
                        // el .catch() es belt-and-suspenders (Phase 18 PATTERNS S-6 pattern).
                        const subject = `[SageConnect] Child process timeout: ImportaFacturasFocaltec.exe killed después de ${childDurationLabel}`;
                        const html = (
                            `<h2>Child process timeout en SageConnect</h2>` +
                            `<p>El proceso hijo <code>ImportaFacturasFocaltec.exe</code> excedió el límite ` +
                            `de <strong>${childDurationLabel}</strong> y fue forzosamente terminado.</p>` +
                            `<table border="1" cellpadding="6" cellspacing="0">` +
                            `<tr><th align="left">step</th><td>startChildProcess</td></tr>` +
                            `<tr><th align="left">operationId</th><td><code>${operationId}</code></td></tr>` +
                            `<tr><th align="left">duration</th><td>${childDurationLabel}</td></tr>` +
                            `<tr><th align="left">importRoute</th><td><code>${config.app.importRoute}</code></td></tr>` +
                            `<tr><th align="left">error</th><td>${__scpError}</td></tr>` +
                            `</table>` +
                            `<p><small>Company: ${config.app.company || 'Unknown'} | Time: ${new Date().toISOString()}</small></p>`
                        );
                        sendAdminAlert(subject, html).catch(() => { /* sendAdminAlert ya swallow internamente */ });
                    }

                    throw scpErr;       // re-throw — cae al .catch() de abajo: addHistory success:false + .finally releaseLock
                } finally {
                    // Se re-verifica la propiedad: el slot pudo reciclarse DURANTE los
                    // hasta 10 min del importador. Un endStep tardío cerraría la entrada
                    // abierta de la operación ajena (endStep busca por step+tenant en el
                    // slot vigente, sin mirar el dueño) y dejaría mintiendo al stuckOnStep
                    // del correo de auto-timeout y al estado del botón.
                    if (instrument && ownsLock()) {
                        operationManager.endStep('background-cycle', 'startChildProcess', null, { error: __scpError });
                    }
                }
            })
            .then(() => {
                operationManager.addHistory({
                    taskId,
                    operationId,
                    startedAt,
                    finishedAt: new Date().toISOString(),
                    success: true,
                    errors: [],
                    summary: 'Background cycle completed',
                });
            })
            .catch((err) => {
                operationManager.addHistory({
                    taskId,
                    operationId,
                    startedAt,
                    finishedAt: new Date().toISOString(),
                    success: false,
                    errors: [err.message],
                    summary: 'Background cycle failed',
                });
            })
            .finally(() => {
                if (ownsLock()) {
                    operationManager.releaseLock(taskId);
                } else {
                    // La entrada [LOCK] es la señal operativa de que el desbordamiento
                    // del candado ocurrió de verdad en producción: hoy no existe ninguna
                    // otra. Si aparece en ScheduleRoutes.log, el ciclo manual duró más
                    // que LOCK_TIMEOUT_MS y hubo otra operación corriendo en paralelo.
                    logGenerator(LOG_FILE, 'warn',
                        `[LOCK] releaseLock(${taskId}) omitido: el slot ya no pertenece a ` +
                        `operationId=${operationId} (auto-release + reciclado). Evitado ` +
                        `liberar el candado de otra operación.`);
                }
            })
            .catch((fatal) => {
                // Red final. Sin este .catch, un throw dentro del .catch del historial o
                // del .finally deja una promesa rechazada sin manejador; Node 22 por
                // defecto (--unhandled-rejections=throw) tumba el proceso, y no hay
                // process.on('unhandledRejection') en todo src/. En un servicio always-on
                // eso es un reinicio a mitad de ciclo, no un error aislado (CLAUDE.md §3).
                logGenerator(LOG_FILE, 'error',
                    `[FATAL] Excepción no manejada en la cadena del disparo manual ` +
                    `operationId=${operationId}: ${fatal && fatal.message ? fatal.message : String(fatal)}`);
            });

        const result = successResult(
            {
                operationId,
                taskId,
                message: 'Task triggered',
            },
            'Task triggered successfully'
        );

        res.json(result);
    })
);

// ---------------------------------------------------------------------------
// POST /:taskId/force-release (maps to POST /api/schedule/:taskId/force-release)
//
// REC-04 (D-07) + REC-05 (D-08): force-release a stuck OperationManager lock.
//
// Always returns HTTP 200 (idempotent — `released:false` when no lock is held;
// never 404, never 409). Side-effects on the released:true path:
//   1. operationManager.releaseLock(taskId)  — also cancels the auto-release timer (Plan 18-01).
//   2. operationManager.addHistory({ ... })   — audit entry: success:false, ['ManualForceRelease'].
//   3. sendAdminAlert(...)                    — fire-and-forget email to LICENSE_ADMIN_EMAIL.
//   4. logGenerator('warn', '[FORCE-RELEASE] ...') — operator log.
// Side-effects on the released:false path: only logGenerator('warn', '[FORCE-RELEASE-NOOP] ...').
// (No addHistory, no email — avoids polluting the audit trail with no-op events.)
//
// Phase 18 boundary held: this endpoint does NOT abort the in-flight axios call
// or the running child process. Per D-03, the "phantom continuation" is acceptable
// — the next cron tick or operator click can acquire a fresh lock. Phase 19
// (ROOT-01/02/03) will replace this with real abort.
// ---------------------------------------------------------------------------
router.post(
    '/:taskId/force-release',
    requireApiKey,
    validate(forceReleaseParamsSchema, 'params'),
    validate(forceReleaseBodySchema, 'body'),
    writeLimiter,
    asyncHandler(async (req, res) => {
        const { taskId } = req.params;
        const reason = (req.body && req.body.reason) || null;

        // Snapshot the current lock BEFORE releasing — needed for previousLock
        // payload, the audit history entry, and the email body. After releaseLock
        // the slot is gone and this information is unrecoverable.
        const running = operationManager.getRunningOperations() || {};
        const slot = running[taskId] || null;

        if (!slot) {
            // Idempotent path — D-07 case 2: no lock active.
            // Do NOT call addHistory (no event to audit) or sendAdminAlert.
            logGenerator(
                LOG_FILE,
                'warn',
                '[FORCE-RELEASE-NOOP] No active lock for ' + taskId +
                ' (already released or never held)' +
                (reason ? " -- reason='" + reason + "'" : '')
            );
            return res.json(successResult(
                { released: false, previousLock: null },
                'Sin lock activo para liberar'
            ));
        }

        // Derive previousLock fields from the snapshot
        const lastOpenStep = findLastOpenStep(slot.stepProgress);
        const stuckOnStep = lastOpenStep ? lastOpenStep.step : null;
        const stuckOnTenant = lastOpenStep ? (lastOpenStep.tenant || null) : null;
        const durationMs = Date.now() - new Date(slot.startedAt).getTime();
        const durationLabel = formatDurationMin(durationMs);

        const previousLock = {
            operationId: slot.operationId,
            startedAt: slot.startedAt,
            durationMs,
            stuckOnStep,
            stuckOnTenant,
        };

        // Side-effect 1: release the lock (Plan 18-01: also cancels the auto-release timer)
        operationManager.releaseLock(taskId);

        // Side-effect 2: audit history entry (REC-05 / D-04 shape)
        operationManager.addHistory({
            taskId,
            operationId: slot.operationId,
            startedAt: slot.startedAt,
            finishedAt: new Date().toISOString(),
            success: false,
            errors: ['ManualForceRelease'],
            summary: 'Lock forzado manualmente por operador' +
                (reason ? ' (motivo: ' + reason + ')' : '') +
                ' — duración ' + durationLabel,
            stuckOnStep,
            stuckOnTenant,
        });

        // Side-effect 3: operator log
        logGenerator(
            LOG_FILE,
            'warn',
            '[FORCE-RELEASE] Manual force-release of lock ' + taskId + ' -- ' +
            'operationId=' + slot.operationId + ', duration=' + durationLabel + ', ' +
            'stuckOnStep=' + (stuckOnStep || '(none)') + ', ' +
            'stuckOnTenant=' + (stuckOnTenant || '(none)') +
            (reason ? ", reason='" + reason + "'" : '')
        );

        // Side-effect 4: fire-and-forget admin email (REC-05 + D-08 parity with auto-release).
        // We DO NOT await — the response should not block on SMTP. sendAdminAlert wraps its
        // own try/catch and logs failures. The .catch() below is a defensive belt-and-suspenders
        // guard against any unhandled-rejection escape — sendAdminAlert never throws today.
        const subject = '[SageConnect] Liberación manual: lock ' + taskId + ' forzado por operador';
        const html = (
            '<h2>Liberación manual de lock en SageConnect</h2>' +
            '<p>Un operador disparó una liberación manual del lock ' + taskId +
            ' vía endpoint <code>POST /api/schedule/' + taskId + '/force-release</code>.</p>' +
            '<table border="1" cellpadding="6" cellspacing="0">' +
            '<tr><th align="left">operationType</th><td>' + taskId + '</td></tr>' +
            '<tr><th align="left">operationId</th><td><code>' + slot.operationId + '</code></td></tr>' +
            '<tr><th align="left">startedAt</th><td>' + slot.startedAt + '</td></tr>' +
            '<tr><th align="left">duration</th><td>' + durationLabel + '</td></tr>' +
            '<tr><th align="left">stuckOnStep</th><td>' + (stuckOnStep || '(ninguno — array vacío)') + '</td></tr>' +
            '<tr><th align="left">stuckOnTenant</th><td>' + (stuckOnTenant || '(no aplicable)') + '</td></tr>' +
            '<tr><th align="left">reason</th><td>' + (reason || '(no proporcionado)') + '</td></tr>' +
            '</table>' +
            '<p><small>Company: ' + (config.app.company || 'Unknown') +
            ' | Time: ' + new Date().toISOString() + '</small></p>' +
            '<p><em>Phase 18 NO aborta el work en vuelo (axios/child process pueden seguir corriendo). ' +
            'El siguiente cron tick podrá ejecutar normalmente.</em></p>'
        );
        sendAdminAlert(subject, html).catch((err) => {
            logGenerator(LOG_FILE, 'warn', '[FORCE-RELEASE] Unexpected sendAdminAlert error after handler: ' + err.message);
        });

        return res.json(successResult(
            { released: true, previousLock },
            'Lock ' + taskId + ' liberado'
        ));
    })
);

module.exports = router;
