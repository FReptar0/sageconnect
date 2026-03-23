/**
 * Async Handler Wrapper
 *
 * Wraps async route handlers so rejected promises are forwarded to
 * Express error-handling middleware via next(err).
 */

/**
 * @param {Function} fn - Async Express route handler
 * @returns {Function} Express middleware that catches promise rejections
 */
const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asyncHandler };
