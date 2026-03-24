/**
 * Joi Validation Schemas for Schedule Endpoints
 *
 * Validates params for the manual trigger endpoint.
 * taskId is restricted to known task IDs only.
 */

const Joi = require('joi');

// ---------------------------------------------------------------------------
// POST /schedule/:taskId/trigger (params)
// ---------------------------------------------------------------------------
const triggerSchema = Joi.object({
    taskId: Joi.string().valid('background-cycle').required(),
});

module.exports = {
    triggerSchema,
};
