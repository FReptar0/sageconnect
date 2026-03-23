/**
 * PO Route Handlers
 *
 * 8 endpoints for purchase order operations:
 *   GET  /diagnostic            - PO diagnostic
 *   GET  /query                 - Query specific POs
 *   POST /upload                - Upload specific POs
 *   PUT  /update                - Update a PO (dryRun=true by default)
 *   GET  /address-diagnostic    - PO address diagnostic
 *   GET  /payment-form-diagnostic - Payment form diagnostic
 *   POST /upload-authorized     - Upload authorized POs
 *   POST /lifecycle             - Lifecycle management (analyze/process/tenant)
 *
 * All routes are mounted behind requireApiKey in routes.js.
 * PO scripts use positional args -- handlers map request params inline.
 */

const express = require('express');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const { validate } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/async-handler');
const { sendResult } = require('../middleware/send-result');

const {
    diagnosticSchema,
    querySchema,
    uploadSchema,
    updateSchema,
    addressDiagnosticSchema,
    paymentFormDiagnosticSchema,
    uploadAuthorizedSchema,
    lifecycleSchema,
} = require('./schemas/po-schemas');

// Write rate limiter -- local instance to avoid circular dependency with server.js
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
// a. GET /diagnostic -- PO diagnostic
// ---------------------------------------------------------------------------
router.get(
    '/diagnostic',
    validate(diagnosticSchema, 'query'),
    asyncHandler(async (req, res) => {
        const { diagnosticPO } = require('../scripts/po-diagnostic');
        const result = await diagnosticPO(
            req.query.poNumber,
            req.query.database,
            req.query.empresa
        );
        sendResult(res, result);
    })
);

// ---------------------------------------------------------------------------
// b. GET /query -- Query specific POs
// ---------------------------------------------------------------------------
router.get(
    '/query',
    validate(querySchema, 'query'),
    asyncHandler(async (req, res) => {
        const { testSpecificPurchaseOrders } = require('../scripts/po-query');
        let poNumbers = req.query.poNumbers;
        if (typeof poNumbers === 'string') {
            poNumbers = poNumbers.split(',').map((s) => s.trim());
        }
        const result = await testSpecificPurchaseOrders(
            poNumbers,
            req.query.database,
            req.query.tenantIndex
        );
        sendResult(res, result);
    })
);

// ---------------------------------------------------------------------------
// c. POST /upload -- Upload specific POs
// ---------------------------------------------------------------------------
router.post(
    '/upload',
    validate(uploadSchema, 'body'),
    writeLimiter,
    asyncHandler(async (req, res) => {
        const { uploadSpecificPurchaseOrders } = require('../scripts/po-upload');
        let poNumbers = req.body.poNumbers;
        if (typeof poNumbers === 'string') {
            poNumbers = poNumbers.split(',').map((s) => s.trim());
        }
        const result = await uploadSpecificPurchaseOrders(
            poNumbers,
            req.body.database,
            req.body.tenantIndex
        );
        sendResult(res, result);
    })
);

// ---------------------------------------------------------------------------
// d. PUT /update -- Update a PO (dryRun=true by default)
// ---------------------------------------------------------------------------
router.put(
    '/update',
    validate(updateSchema, 'body'),
    writeLimiter,
    asyncHandler(async (req, res) => {
        const { testPurchaseOrderUpdate } = require('../scripts/po-update');
        const result = await testPurchaseOrderUpdate(
            req.body.poNumber,
            req.body.database,
            req.body.tenantIndex,
            req.body.dryRun
        );
        sendResult(res, result);
    })
);

// ---------------------------------------------------------------------------
// e. GET /address-diagnostic -- PO address diagnostic
// ---------------------------------------------------------------------------
router.get(
    '/address-diagnostic',
    validate(addressDiagnosticSchema, 'query'),
    asyncHandler(async (req, res) => {
        const { diagnosticPOAddress } = require('../scripts/po-address-diagnostic');
        const result = await diagnosticPOAddress(
            req.query.poNumber,
            req.query.database
        );
        sendResult(res, result);
    })
);

// ---------------------------------------------------------------------------
// f. GET /payment-form-diagnostic -- Payment form diagnostic
// ---------------------------------------------------------------------------
router.get(
    '/payment-form-diagnostic',
    validate(paymentFormDiagnosticSchema, 'query'),
    asyncHandler(async (req, res) => {
        const { diagnosticPaymentForm } = require('../scripts/po-payment-form-diagnostic');
        const result = await diagnosticPaymentForm(
            req.query.poNumber,
            req.query.database
        );
        sendResult(res, result);
    })
);

// ---------------------------------------------------------------------------
// g. POST /upload-authorized -- Upload authorized POs
// ---------------------------------------------------------------------------
router.post(
    '/upload-authorized',
    validate(uploadAuthorizedSchema, 'body'),
    writeLimiter,
    asyncHandler(async (req, res) => {
        const { uploadAuthorizedPOs } = require('../scripts/upload-authorized-pos');
        const result = await uploadAuthorizedPOs({
            tenantIndex: req.body.tenantIndex,
        });
        sendResult(res, result);
    })
);

// ---------------------------------------------------------------------------
// h. POST /lifecycle -- Lifecycle management (analyze/process/tenant)
// ---------------------------------------------------------------------------
router.post(
    '/lifecycle',
    validate(lifecycleSchema, 'body'),
    writeLimiter,
    asyncHandler(async (req, res) => {
        const { analyzeOrders, processOrders, testTenant } = require('../scripts/test-order-lifecycle');
        const { mode, tenantIndex, database } = req.body;
        let result;
        switch (mode) {
            case 'analyze':
                result = await analyzeOrders({ tenantIndex, database });
                break;
            case 'process':
                result = await processOrders({ tenantIndex, database });
                break;
            case 'tenant':
                result = await testTenant({ tenantIndex });
                break;
        }
        sendResult(res, result);
    })
);

module.exports = router;
