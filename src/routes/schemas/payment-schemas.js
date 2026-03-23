/**
 * Joi Validation Schemas for Payment Endpoints
 *
 * Defines input validation rules for all 7 payment routes.
 * Each schema targets either req.body (POST) or req.query (GET).
 */

const Joi = require('joi');
const config = require('../../config');

const tenantMax = Math.max(config.portal.tenants.length - 1, 0);

// ---------------------------------------------------------------------------
// POST /reconciliation (body)
// ---------------------------------------------------------------------------
const reconciliationSchema = Joi.object({
    tenantIndex: Joi.number().integer().min(0).max(tenantMax).default(0),
    fromDate: Joi.string().pattern(/^\d{8}$/).optional(),
    pyFilter: Joi.string().pattern(/^PY\d+$/).optional(),
    batchLimit: Joi.number().integer().min(1).max(100).default(20),
    dryRun: Joi.boolean().default(true),
});

// ---------------------------------------------------------------------------
// GET /uuid-diagnostic (query)
// ---------------------------------------------------------------------------
const uuidDiagnosticSchema = Joi.object({
    docNbr: Joi.alternatives().try(
        Joi.string().pattern(/^PY\d+$/),
        Joi.array().items(Joi.string().pattern(/^PY\d+$/))
    ).required(),
    tenantIndex: Joi.number().integer().min(0).max(tenantMax).default(0),
});

// ---------------------------------------------------------------------------
// POST /uuid-repair/scan (body)
// ---------------------------------------------------------------------------
const uuidRepairScanSchema = Joi.object({
    tenantIndex: Joi.number().integer().min(0).max(tenantMax).default(0),
});

// ---------------------------------------------------------------------------
// POST /uuid-repair/repair (body)
// ---------------------------------------------------------------------------
const uuidRepairRepairSchema = Joi.object({
    tenantIndex: Joi.number().integer().min(0).max(tenantMax).default(0),
    dryRun: Joi.boolean().default(true),
});

// ---------------------------------------------------------------------------
// POST /uuid-repair/upload (body)
// ---------------------------------------------------------------------------
const uuidRepairUploadSchema = Joi.object({
    tenantIndex: Joi.number().integer().min(0).max(tenantMax).default(0),
});

// ---------------------------------------------------------------------------
// POST /generate (body)
// ---------------------------------------------------------------------------
const generatePaymentsSchema = Joi.object({
    tenantIndex: Joi.number().integer().min(0).max(tenantMax).default(0),
    pyFilter: Joi.string().pattern(/^PY\d+$/).optional(),
    dateFilter: Joi.string().pattern(/^\d{8}$/).optional(),
    dryRun: Joi.boolean().default(true),
});

// ---------------------------------------------------------------------------
// GET /cfdis (query)
// ---------------------------------------------------------------------------
const cfdisSchema = Joi.object({
    tenantIndex: Joi.number().integer().min(0).max(tenantMax).default(0),
});

module.exports = {
    reconciliationSchema,
    uuidDiagnosticSchema,
    uuidRepairScanSchema,
    uuidRepairRepairSchema,
    uuidRepairUploadSchema,
    generatePaymentsSchema,
    cfdisSchema,
};
