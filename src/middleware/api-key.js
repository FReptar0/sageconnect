/**
 * API Key Authentication Middleware
 *
 * Validates x-api-key header against SAGECONNECT_API_KEY using
 * constant-time comparison (crypto.timingSafeEqual) to prevent timing attacks.
 */

const crypto = require('crypto');
const config = require('../config');
const { errorResult } = require('../utils/ResultEnvelope');

/**
 * Express middleware that requires a valid API key in the x-api-key header.
 *
 * - If SAGECONNECT_API_KEY is not configured, rejects all requests with 401.
 * - Uses crypto.timingSafeEqual for constant-time comparison.
 */
function requireApiKey(req, res, next) {
    const configuredKey = config.security.apiKey;

    if (!configuredKey) {
        console.warn('[API-KEY] Rejecting request -- SAGECONNECT_API_KEY not configured');
        return res.status(401).json(
            errorResult(['Invalid or missing API key'], 'Unauthorized')
        );
    }

    const providedKey = req.headers['x-api-key'];

    if (!providedKey) {
        return res.status(401).json(
            errorResult(['Invalid or missing API key'], 'Unauthorized')
        );
    }

    // Constant-time comparison -- both buffers must be the same length
    const configuredBuf = Buffer.from(configuredKey, 'utf8');
    const providedBuf = Buffer.from(String(providedKey), 'utf8');

    if (configuredBuf.length !== providedBuf.length ||
        !crypto.timingSafeEqual(configuredBuf, providedBuf)) {
        return res.status(401).json(
            errorResult(['Invalid or missing API key'], 'Unauthorized')
        );
    }

    next();
}

module.exports = { requireApiKey };
