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
const nodemailer = require('nodemailer');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const { validate } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/async-handler');
const { requireApiKey } = require('../middleware/api-key');
const { successResult, errorResult } = require('../utils/ResultEnvelope');
const operationManager = require('../services/OperationManager');
const config = require('../config');
const { triggerSchema, forceReleaseParamsSchema, forceReleaseBodySchema } = require('./schemas/schedule-schemas');
const { forResponse } = require('../background');
const { logGenerator } = require('../utils/LogGenerator');
const { formatDurationMin } = require('../utils/duration');

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
// Helpers (Phase 18, REC-04 + REC-05) — INLINE COPY of CronScheduler#sendAdminAlert
// (PATTERNS.md §5: inline-twice strategy. If a third use case appears, refactor
// to src/utils/AdminEmailS' + 'ender.js — until then duplication keeps blast radius
// tight and decouples the route module from CronScheduler.)
// ---------------------------------------------------------------------------

/**
 * Send an alert email to the LICENSE_ADMIN_EMAIL recipient.
 * Mirrors LicenseValidator.sendLicenseAlert and the inline copy in
 * src/services/CronScheduler.js#sendAdminAlert added by Plan 18-01 — uses
 * nodemailer directly (NOT the project's operator-facing email-sender utility,
 * which routes to config.mailing.notices).
 *
 * D-08 in 18-CONTEXT.md originally said admin emails go via the project's
 * generic mail utility; PATTERNS.md §S-6 overrides this because that utility
 * routes to operator mailbox, NOT config.license.adminEmail (admin mailbox).
 * Using nodemailer-direct honors D-08's intent — admin gets email on both
 * paths with the specified subjects. Implementation mechanism only.
 *
 * Email failures are swallowed (warn log) and MUST NOT block the response.
 *
 * @param {string} subject  — already includes the [SageConnect] prefix.
 * @param {string} html     — full HTML body of the message.
 */
async function sendAdminAlert(subject, html) {
    try {
        const transportConfig = {
            host: config.mailing.server,
            port: config.mailing.port,
            secure: config.mailing.ssl,
        };
        if (config.mailing.password) {
            transportConfig.auth = {
                user: config.mailing.from,
                pass: config.mailing.password,
            };
        }
        const transport = nodemailer.createTransport(transportConfig);
        await transport.sendMail({
            from: config.mailing.from,
            to: config.license.adminEmail,
            subject,
            html,
        });
        logGenerator(LOG_FILE, 'info', '[ADMIN-EMAIL] Sent to ' + config.license.adminEmail + ': ' + subject);
    } catch (err) {
        logGenerator(LOG_FILE, 'warn', '[ADMIN-EMAIL] Failed to send force-release alert: ' + err.message);
    }
}

/**
 * Inline copy of CronScheduler#findLastOpenStep — derives stuckOnStep / stuckOnTenant
 * from a slot's stepProgress array. Iterates backwards to find the most recent entry
 * with finishedAt:null. Kept inline to avoid a cross-module dependency for a 5-line
 * helper.
 *
 * @param {Array<{step:string, tenant:string|null, startedAt:string, finishedAt:string|null, error:string|null}>} stepProgress
 * @returns {{step:string, tenant:string|null}|null}
 */
function findLastOpenStep(stepProgress) {
    if (!Array.isArray(stepProgress)) return null;
    for (let i = stepProgress.length - 1; i >= 0; i--) {
        if (!stepProgress[i].finishedAt) return stepProgress[i];
    }
    return null;
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
        forResponse({ operationId, emitter: operationManager })
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
                operationManager.releaseLock(taskId);
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
