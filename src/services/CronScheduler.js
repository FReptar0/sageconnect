/**
 * CronScheduler - Wraps node-cron v4 for recurring background cycle execution.
 *
 * Integrates with OperationManager for:
 * - Lock acquisition/release (background-cycle)
 * - Progress event emission (consumed by SSE in Plan 03)
 * - Execution history recording
 *
 * Usage:
 *   const { initScheduler, getSchedulerStatus } = require('./services/CronScheduler');
 *   initScheduler(); // starts the cron loop
 */

const cron = require('node-cron');
const crypto = require('crypto');
const config = require('../config');
const operationManager = require('./OperationManager');
const licenseValidator = require('./LicenseValidator');
const { forResponse, startChildProcess } = require('../background');
const { logGenerator } = require('../utils/LogGenerator');
const { formatDurationMin } = require('../utils/duration');
const {
    sendAdminAlert: _sendAdminAlertImpl,
    findLastOpenStep,
} = require('../utils/AdminEmailSender');

const LOG_FILE = 'CronScheduler';

// ---------------------------------------------------------------------------
// Helpers (Phase 18, REC-02) — sendAdminAlert + findLastOpenStep extracted to
// src/utils/AdminEmailSender.js per PATTERNS.md §S-6 third-use trigger
// (Quick task 260502-i7l). Local 2-arg wrapper preserves the existing call-site
// signature and threads LOG_FILE='CronScheduler' so [ADMIN-EMAIL] log entries
// continue to appear in CronScheduler.log (no log routing change).
// ---------------------------------------------------------------------------

/**
 * @param {string} subject  — already includes the [SageConnect] prefix when called.
 * @param {string} html     — full HTML body of the message.
 */
function sendAdminAlert(subject, html) {
    return _sendAdminAlertImpl(subject, html, LOG_FILE);
}

/** @type {import('node-cron').ScheduledTask|null} */
let scheduledTask = null;

/** @type {string|null} ISO timestamp of last completed run */
let lastRun = null;

/**
 * Initialize the cron scheduler for background cycle execution.
 * Creates a node-cron task with noOverlap and timezone support.
 */
function initScheduler() {
    const expression = config.schedule.cronExpression;
    const timezone = config.app.timezone;

    const task = cron.schedule(
        expression,
        async () => {
            const operationId = crypto.randomUUID();
            const startedAt = new Date();
            let success = true;
            let errors = [];

            // Safety net: acquire lock before running (noOverlap should prevent concurrent, but belt-and-suspenders)
            const locked = operationManager.acquireLock('background-cycle', operationId);
            if (!locked) {
                logGenerator(LOG_FILE, 'warn', `[OVERLAP] background-cycle lock not acquired for ${operationId} -- skipping`);
                return;
            }

            // Re-validate license each cycle (updates cached state)
            try {
                await licenseValidator.validate();
            } catch (err) {
                logGenerator(LOG_FILE, 'warn', `[LICENSE] Re-validation error: ${err.message} -- using cached state`);
            }

            // License guard: skip cycle if license is invalid
            if (!licenseValidator.isValid()) {
                logGenerator(LOG_FILE, 'warn', '[LICENSE] Ciclo omitido: licencia inactiva -- ' + operationId);
                console.warn('[LICENSE] Ciclo omitido: licencia inactiva');
                operationManager.addHistory({
                    taskId: 'background-cycle',
                    operationId,
                    startedAt: startedAt.toISOString(),
                    finishedAt: new Date().toISOString(),
                    success: false,
                    errors: ['Licencia inactiva'],
                    summary: 'Ciclo omitido: licencia inactiva',
                });
                operationManager.releaseLock('background-cycle');
                return;
            }

            try {
                logGenerator(LOG_FILE, 'info', `[START] Background cycle ${operationId} started`);
                await forResponse({ operationId, emitter: operationManager });

                // Phase 17 (D-12): startChildProcess is cron-only (manual trigger does NOT call it).
                // Instrument here so cron-tick stepProgress has 8 entries (7 per-tenant from forResponse + 1 global startChildProcess).
                // Phase 19 (ROOT-02 / D-15): catch detects /Child process timeout/ wording sentinel
                // emitted by background.js startChildProcess reject() and dispatches admin email.
                let __scpError = null;
                try {
                    operationManager.startStep('background-cycle', 'startChildProcess', null);
                    await startChildProcess();
                } catch (scpErr) {
                    __scpError = scpErr.message || String(scpErr);

                    // ROOT-02 / D-15: detect child process timeout via wording sentinel and dispatch admin email.
                    // Wording sentinel `'Child process timeout'` is set in src/background.js startChildProcess reject().
                    // ROOT-04 / D-15 explicit: ONLY child timeouts dispatch email — axios/step timeouts (Plan 19-01/19-03) do NOT.
                    const isChildTimeout = /Child process timeout/.test(__scpError);
                    if (isChildTimeout) {
                        const childDurationMs = config.schedule.childProcessTimeoutMs;
                        const childDurationLabel = formatDurationMin(childDurationMs);

                        // ROOT-04 / D-14: log [TIMEOUT] entry to CronScheduler.log indicando dispatch del admin email.
                        // The ChildProcess.log entry was already emitted by startChildProcess itself (background.js timer).
                        // Dual destination paridad with endStep that also writes to CronScheduler.log.
                        logGenerator(LOG_FILE, 'error',
                            `[TIMEOUT] step=startChildProcess operationId=${operationId} ` +
                            `durationMs=${childDurationMs} action=admin-email-dispatched`);

                        // ROOT-04 / D-15: admin email — fire-and-forget. sendAdminAlert wraps try/catch internally; never throws.
                        // .catch(() => {}) is belt-and-suspenders against unexpected rejection (Phase 18 PATTERNS S-6 pattern).
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

                    throw scpErr;       // re-throw — preserva el flujo Phase 17 / outer catch + addHistory entrada
                } finally {
                    operationManager.endStep('background-cycle', 'startChildProcess', null, { error: __scpError });
                }

                logGenerator(LOG_FILE, 'info', `[COMPLETE] Background cycle ${operationId} finished`);
            } catch (error) {
                success = false;
                errors = [error.message];
                logGenerator(LOG_FILE, 'error', `[ERROR] Background cycle ${operationId} failed: ${error.message}`);
            } finally {
                operationManager.releaseLock('background-cycle');
                const finishedAt = new Date();
                const durationMs = finishedAt.getTime() - startedAt.getTime();
                operationManager.addHistory({
                    taskId: 'background-cycle',
                    operationId,
                    startedAt: startedAt.toISOString(),
                    finishedAt: finishedAt.toISOString(),
                    success,
                    errors,
                    summary: success
                        ? `Completed in ${durationMs}ms`
                        : `Failed after ${durationMs}ms: ${errors.join(', ')}`,
                });
                lastRun = finishedAt.toISOString();
            }
        },
        {
            name: 'background-cycle',
            noOverlap: true,
            timezone,
        }
    );

    // Wire lifecycle events to logging
    task.on('execution:started', () => {
        logGenerator(LOG_FILE, 'info', '[CRON] execution:started');
    });

    task.on('execution:finished', () => {
        logGenerator(LOG_FILE, 'info', '[CRON] execution:finished');
    });

    task.on('execution:failed', (err) => {
        logGenerator(LOG_FILE, 'error', `[CRON] execution:failed: ${err?.message || err}`);
    });

    task.on('execution:overlap', () => {
        logGenerator(LOG_FILE, 'warn', '[CRON] execution:overlap -- previous cycle still running');
    });

    scheduledTask = task;

    // REC-01 / REC-02 (D-02, D-04, D-08): handle auto-released locks.
    // Registered ONCE inside initScheduler (which is called once from src/index.js) — never at module load.
    // Module-load registration would accumulate listeners under jest.isolateModules and any future
    // hot-reload path; placing it here scopes registration to the single boot-time call site.
    operationManager.on('lock:timeout', async ({ operationType, operationId, startedAt, stepProgress, durationMs }) => {
        const lastOpenStep = findLastOpenStep(stepProgress);
        const stuckOnStep = lastOpenStep ? lastOpenStep.step : null;
        const stuckOnTenant = lastOpenStep ? (lastOpenStep.tenant || null) : null;
        const durationLabel = formatDurationMin(durationMs);

        // 1. Audit history (REC-02 / D-04)
        operationManager.addHistory({
            taskId: operationType,
            operationId,
            startedAt,
            finishedAt: new Date().toISOString(),
            success: false,
            errors: ['Timeout'],
            summary: `Timeout — lock forzosamente liberado después de ${durationLabel}`,
            stuckOnStep,
            stuckOnTenant,
        });

        // 2. Operator log (REC-02)
        logGenerator(LOG_FILE, 'warn',
            `[TIMEOUT] Auto-released lock ${operationType} after ${durationLabel} -- ` +
            `operationId=${operationId}, stuckOnStep=${stuckOnStep || '(none)'}, stuckOnTenant=${stuckOnTenant || '(none)'}`
        );

        // 3. Admin email (REC-02 / D-08) — fire-and-forget, never blocks (sendAdminAlert wraps try/catch).
        const subject = `[SageConnect] Auto-timeout: lock ${operationType} liberado después de ${durationLabel}`;
        const html = (
            `<h2>Auto-timeout en SageConnect</h2>` +
            `<p>Un lock de <code>OperationManager</code> se mantuvo activo más tiempo del permitido y fue liberado automáticamente.</p>` +
            `<table border="1" cellpadding="6" cellspacing="0">` +
            `<tr><th align="left">operationType</th><td>${operationType}</td></tr>` +
            `<tr><th align="left">operationId</th><td><code>${operationId}</code></td></tr>` +
            `<tr><th align="left">startedAt</th><td>${startedAt}</td></tr>` +
            `<tr><th align="left">duration</th><td>${durationLabel}</td></tr>` +
            `<tr><th align="left">stuckOnStep</th><td>${stuckOnStep || '(ninguno — array vacío)'}</td></tr>` +
            `<tr><th align="left">stuckOnTenant</th><td>${stuckOnTenant || '(no aplicable)'}</td></tr>` +
            `</table>` +
            `<p><small>Company: ${config.app.company || 'Unknown'} | Time: ${new Date().toISOString()}</small></p>` +
            `<p><em>Phase 18 NO aborta el work en vuelo (axios/child process siguen corriendo). Si el ciclo eventualmente termina, su entrada de history aparecerá DESPUÉS de esta entrada de timeout — esto es informativo, no contradictorio.</em></p>`
        );
        await sendAdminAlert(subject, html);
    });

    logGenerator(LOG_FILE, 'info', `[INIT] Scheduler initialized with expression "${expression}" (timezone: ${timezone})`);
}

/**
 * Get current scheduler status.
 * @returns {{ cronExpression: string, status: string, nextRun: string|null, lastRun: string|null }}
 */
function getSchedulerStatus() {
    return {
        cronExpression: config.schedule.cronExpression,
        status: scheduledTask?.getStatus() || 'stopped',
        nextRun: scheduledTask?.getNextRun()?.toISOString() || null,
        lastRun,
    };
}

/**
 * Get the underlying node-cron task (for manual trigger in Plan 03).
 * @returns {import('node-cron').ScheduledTask|null}
 */
function getTask() {
    return scheduledTask;
}

module.exports = { initScheduler, getSchedulerStatus, getTask };
