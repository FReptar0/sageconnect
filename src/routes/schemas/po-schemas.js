/**
 * PO Route Validation Schemas
 *
 * Joi schemas for all 9 PO endpoints. Each schema defines the expected
 * request parameters with types, defaults, and constraints.
 *
 * tenantIndex is validated against config.portal.tenants.length so
 * out-of-range indices are rejected at the validation layer.
 */

const Joi = require('joi');
const config = require('../../config');

const tenantMax = Math.max(config.portal.tenants.length - 1, 0);

// ---------------------------------------------------------------------------
// Reusable field definitions
// ---------------------------------------------------------------------------

const poNumberField = Joi.string().trim().required();
const databaseField = Joi.string().trim();
const tenantIndexField = Joi.number().integer().min(0).max(tenantMax).default(0);

/**
 * Accepts a single comma-separated string or an array of strings.
 * Route handlers normalize to array after validation.
 */
const poNumbersField = Joi.alternatives()
    .try(
        Joi.string().trim().required(),
        Joi.array().items(Joi.string().trim()).min(1).required()
    )
    .required();

// ---------------------------------------------------------------------------
// Endpoint schemas
// ---------------------------------------------------------------------------

/** GET /api/pos/diagnostic -- query params */
const diagnosticSchema = Joi.object({
    poNumber: poNumberField,
    database: databaseField.default('COPDAT'),
    empresa: databaseField.default('COPDAT'),
});

/** GET /api/pos/query -- query params */
const querySchema = Joi.object({
    poNumbers: poNumbersField,
    database: databaseField.optional().default(null),
    tenantIndex: tenantIndexField,
});

/** POST /api/pos/upload -- body */
const uploadSchema = Joi.object({
    poNumbers: poNumbersField,
    database: databaseField.optional().default(null),
    tenantIndex: tenantIndexField,
});

/** PUT /api/pos/update -- body */
const updateSchema = Joi.object({
    poNumber: poNumberField,
    database: databaseField.optional().default(null),
    tenantIndex: tenantIndexField,
    dryRun: Joi.boolean().default(true),
});

/** GET /api/pos/address-diagnostic -- query params */
const addressDiagnosticSchema = Joi.object({
    poNumber: poNumberField,
    database: databaseField.default('COPDAT'),
});

/** GET /api/pos/payment-form-diagnostic -- query params */
const paymentFormDiagnosticSchema = Joi.object({
    poNumber: poNumberField,
    database: databaseField.optional().default(null),
});

/** POST /api/pos/upload-authorized -- body */
const uploadAuthorizedSchema = Joi.object({
    tenantIndex: tenantIndexField,
});

/** POST /api/pos/lifecycle -- body */
const lifecycleSchema = Joi.object({
    mode: Joi.string().valid('analyze', 'process', 'tenant').required(),
    tenantIndex: tenantIndexField,
    database: databaseField.optional().default(null),
});

/** PUT /api/pos/status -- body */
const statusUpdateSchema = Joi.object({
    poNumber: poNumberField,
    status: Joi.string().valid('OPEN', 'CLOSED', 'CANCELLED', 'GENERATED').required(),
    tenantIndex: tenantIndexField,
});

module.exports = {
    diagnosticSchema,
    querySchema,
    uploadSchema,
    updateSchema,
    addressDiagnosticSchema,
    paymentFormDiagnosticSchema,
    uploadAuthorizedSchema,
    lifecycleSchema,
    statusUpdateSchema,
};
