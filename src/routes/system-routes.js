const express = require('express');
const router = express.Router();
const config = require('../config');
const { successResult } = require('../utils/ResultEnvelope');
const licenseValidator = require('../services/LicenseValidator');

/**
 * GET /health
 * Returns service health status for monitoring and load balancer checks.
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        data: {
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        },
        errors: [],
        summary: 'Service healthy',
        meta: {},
    });
});

/**
 * GET /tenants
 * Returns the list of configured tenants (index, name, id).
 * No API key required -- tenant names are not secrets.
 */
router.get('/tenants', (_req, res) => {
    const tenants = config.portal.tenants.map((t, i) => ({
        index: i,
        name: t.database || `Tenant ${i}`,
        id: t.id,
    }));
    res.json(successResult({ tenants }, 'Tenant list'));
});

/**
 * GET /license
 * Returns the current license validation state for UI consumption.
 * Always accessible -- no API key or license middleware required.
 * Includes hmacConfigured boolean for diagnostics (presence, not value).
 */
router.get('/license', (_req, res) => {
    const status = licenseValidator.getStatus();
    res.json(successResult({
        ...status,
        hmacConfigured: Boolean(config.license && config.license.hmacSecret),
    }, 'License status'));
});

module.exports = router;
