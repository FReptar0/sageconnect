/**
 * Operations Routes
 *
 * 2 endpoints for operation monitoring:
 * - GET /status              : View all currently running operations (with per-step progress)
 * - GET /:operationId/stream : SSE endpoint for real-time progress events
 *
 * GET /status response shape (Phase 17 — OBS-04):
 *   {
 *     success: true,
 *     data: {
 *       operations: {
 *         [operationType]: {
 *           operationId: string,
 *           startedAt:   string (ISO),
 *           stepProgress: Array<{ step, tenant, startedAt, finishedAt, error }>
 *         }
 *       }
 *     },
 *     ...
 *   }
 * Note: `operations` is a MAP keyed by operationType (NOT an array). UI consumers
 *       must use `operations[type]` or `Object.values(operations)`, never `.find()`.
 *
 * The SSE endpoint subscribes to OperationManager progress events
 * and streams them to connected clients. Cleanup occurs on disconnect.
 */

const express = require('express');
const router = express.Router();
const { successResult } = require('../utils/ResultEnvelope');
const operationManager = require('../services/OperationManager');

// ---------------------------------------------------------------------------
// GET /status (maps to GET /api/operations/status)
// Returns running operations (map keyed by operationType) with stepProgress.
// stepProgress shape is owned by OperationManager.startStep / endStep (Phase 17).
// ---------------------------------------------------------------------------
router.get('/status', (_req, res) => {
    const operations = operationManager.getRunningOperations();
    const result = successResult(
        { operations },
        'Running operations retrieved'
    );
    res.json(result);
});

// ---------------------------------------------------------------------------
// GET /:operationId/stream (maps to GET /api/operations/:operationId/stream)
// SSE endpoint -- does NOT use asyncHandler or sendResult
// ---------------------------------------------------------------------------
router.get('/:operationId/stream', (req, res) => {
    const { operationId } = req.params;

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // Write retry interval
    res.write('retry: 10000\n\n');

    // Progress event handler
    const onProgress = (event) => {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);

        // Auto-cleanup after complete event (delay to ensure delivery)
        if (event.type === 'complete') {
            setTimeout(() => {
                cleanup();
            }, 1000);
        }
    };

    // Subscribe to progress events for this operation
    operationManager.on(`progress:${operationId}`, onProgress);

    // 30-second heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 30000);

    // Cleanup function
    function cleanup() {
        operationManager.off(`progress:${operationId}`, onProgress);
        clearInterval(heartbeat);
        res.end();
    }

    // Clean up on client disconnect
    req.on('close', () => {
        cleanup();
    });
});

module.exports = router;
