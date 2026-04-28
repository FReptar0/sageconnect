/**
 * Joi Validation Schemas for Schedule Endpoints
 *
 * Validates params/body for schedule endpoints. taskId is restricted to known
 * task IDs only. The force-release endpoint additionally accepts an optional
 * reason field in the request body (max 200 chars).
 */

const Joi = require('joi');

// ---------------------------------------------------------------------------
// POST /schedule/:taskId/trigger (params)
// ---------------------------------------------------------------------------
const triggerSchema = Joi.object({
    taskId: Joi.string().valid('background-cycle').required(),
});

// ---------------------------------------------------------------------------
// POST /schedule/:taskId/force-release (params) — REC-04 (D-07)
// Identical shape to triggerSchema today, kept as a separate export for
// divergence headroom (a future phase may tighten one schema independently).
// ---------------------------------------------------------------------------
const forceReleaseParamsSchema = Joi.object({
    taskId: Joi.string().valid('background-cycle').required(),
});

// ---------------------------------------------------------------------------
// POST /schedule/:taskId/force-release (body) — REC-04 (D-07)
// Body is optional (empty object accepted). When `reason` is provided, max
// 200 chars. Empty string is allowed so a future UI can send body:{reason:''}
// without 400. `stripUnknown:true` (src/middleware/validate.js) silently
// drops any extra fields, consistent with project convention.
// ---------------------------------------------------------------------------
const forceReleaseBodySchema = Joi.object({
    reason: Joi.string().max(200).allow('', null).optional(),
});

module.exports = {
    triggerSchema,
    forceReleaseParamsSchema,
    forceReleaseBodySchema,
};
