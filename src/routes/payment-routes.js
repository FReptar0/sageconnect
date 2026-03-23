/**
 * Payment Routes
 *
 * 7 endpoints for payment operations: reconciliation, UUID diagnostic,
 * UUID repair (scan/repair/upload), payment generation, and CFDI fetch.
 *
 * All endpoints are mounted behind requireApiKey in routes.js.
 * POST endpoints apply a write rate limiter (10 req/min).
 */

const express = require('express');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const { validate } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/async-handler');
const { sendResult } = require('../middleware/send-result');

// Script functions
const { runReconciliation } = require('../scripts/payment-reconciliation');
const { diagnosePayment } = require('../scripts/payment-uuid-diagnostic');
const { scanForRepairableUUIDs, repairUUIDs, uploadRepairedPayments } = require('../scripts/payment-uuid-repair');
const { generatePayments } = require('../scripts/portal-payments-generator');
const { getTypePTest } = require('../scripts/get-payment-cfdis');

// Validation schemas
const {
    reconciliationSchema,
    uuidDiagnosticSchema,
    uuidRepairScanSchema,
    uuidRepairRepairSchema,
    uuidRepairUploadSchema,
    generatePaymentsSchema,
    cfdisSchema,
} = require('./schemas/payment-schemas');

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
// POST /reconciliation
// ---------------------------------------------------------------------------
router.post(
    '/reconciliation',
    validate(reconciliationSchema, 'body'),
    writeLimiter,
    asyncHandler(async (req, res) => {
        const result = await runReconciliation(req.body);
        sendResult(res, result);
    })
);

// ---------------------------------------------------------------------------
// GET /uuid-diagnostic
// ---------------------------------------------------------------------------
router.get(
    '/uuid-diagnostic',
    validate(uuidDiagnosticSchema, 'query'),
    asyncHandler(async (req, res) => {
        const result = await diagnosePayment({
            docNbr: req.query.docNbr,
            tenantIndex: req.query.tenantIndex,
        });
        sendResult(res, result);
    })
);

// ---------------------------------------------------------------------------
// POST /uuid-repair/scan
// ---------------------------------------------------------------------------
router.post(
    '/uuid-repair/scan',
    validate(uuidRepairScanSchema, 'body'),
    writeLimiter,
    asyncHandler(async (req, res) => {
        const result = await scanForRepairableUUIDs({
            tenantIndex: req.body.tenantIndex,
        });
        sendResult(res, result);
    })
);

// ---------------------------------------------------------------------------
// POST /uuid-repair/repair
// ---------------------------------------------------------------------------
router.post(
    '/uuid-repair/repair',
    validate(uuidRepairRepairSchema, 'body'),
    writeLimiter,
    asyncHandler(async (req, res) => {
        const result = await repairUUIDs({
            tenantIndex: req.body.tenantIndex,
            dryRun: req.body.dryRun,
        });
        sendResult(res, result);
    })
);

// ---------------------------------------------------------------------------
// POST /uuid-repair/upload
// ---------------------------------------------------------------------------
router.post(
    '/uuid-repair/upload',
    validate(uuidRepairUploadSchema, 'body'),
    writeLimiter,
    asyncHandler(async (req, res) => {
        const result = await uploadRepairedPayments({
            tenantIndex: req.body.tenantIndex,
        });
        sendResult(res, result);
    })
);

// ---------------------------------------------------------------------------
// POST /generate
// ---------------------------------------------------------------------------
router.post(
    '/generate',
    validate(generatePaymentsSchema, 'body'),
    writeLimiter,
    asyncHandler(async (req, res) => {
        const result = await generatePayments({
            tenantIndex: req.body.tenantIndex,
            pyFilter: req.body.pyFilter,
            dateFilter: req.body.dateFilter,
            shouldPost: req.body.dryRun === false,
        });
        sendResult(res, result);
    })
);

// ---------------------------------------------------------------------------
// GET /cfdis
// ---------------------------------------------------------------------------
router.get(
    '/cfdis',
    validate(cfdisSchema, 'query'),
    asyncHandler(async (req, res) => {
        const result = await getTypePTest(req.query.tenantIndex);
        sendResult(res, result);
    })
);

module.exports = router;
