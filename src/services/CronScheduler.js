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

const LOG_FILE = 'CronScheduler';

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
                await startChildProcess();
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
