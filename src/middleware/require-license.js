/**
 * License Enforcement Middleware
 *
 * Blocks requests with HTTP 503 when the license is not valid.
 * Applied to operational routes (schedule, operations, payments, POs)
 * but NOT to system/dashboard routes.
 *
 * Uses LicenseValidator.isValid() synchronous check against cached state.
 * Must be mounted BEFORE requireApiKey so invalid license returns 503, not 401.
 */

const { isValid } = require('../services/LicenseValidator');
const { errorResult } = require('../utils/ResultEnvelope');

/**
 * Express middleware that requires a valid license.
 *
 * - If license is valid: calls next()
 * - If license is invalid: returns 503 with error envelope
 */
function requireLicense(req, res, next) {
    if (!isValid()) {
        return res.status(503).json(
            errorResult(['Licencia inactiva. Contacte a su proveedor.'], 'License required')
        );
    }
    next();
}

module.exports = { requireLicense };
