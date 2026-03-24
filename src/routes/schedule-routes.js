/**
 * Schedule Routes
 *
 * 3 endpoints for schedule operations:
 * - GET /         : View current schedule status (cron, next run, last run)
 * - GET /history  : View last 24 hours of execution history
 * - POST /:taskId/trigger : Manually trigger a scheduled task
 *
 * The trigger endpoint requires API key authentication and applies
 * write rate limiting. Returns 409 if the task is already running.
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
const { triggerSchema } = require('./schemas/schedule-schemas');
const { forResponse } = require('../background');

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

module.exports = router;
