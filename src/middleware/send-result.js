/**
 * Send Result Helper
 *
 * Maps a ResultEnvelope to the appropriate HTTP status code and sends
 * it as a JSON response with proper charset header.
 */

/**
 * Determines HTTP status from envelope content and sends JSON response.
 *
 * Status mapping:
 * - success === true  -> 200
 * - errors match /not found/i -> 404
 * - errors match /validation/i -> 400
 * - otherwise failed  -> 500
 *
 * @param {import('express').Response} res - Express response object
 * @param {object} result - ResultEnvelope object
 * @returns {void}
 */
function sendResult(res, result) {
    let status = 500;

    if (result.success) {
        status = 200;
    } else if (Array.isArray(result.errors)) {
        const joined = result.errors.join(' ');
        if (/not found/i.test(joined)) {
            status = 404;
        } else if (/validation/i.test(joined)) {
            status = 400;
        }
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).json(result);
}

module.exports = { sendResult };
