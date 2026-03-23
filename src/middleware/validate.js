/**
 * Joi Validation Middleware Factory
 *
 * Creates Express middleware that validates req[source] against a Joi schema.
 * On failure: returns 400 with validation errors in ResultEnvelope format.
 * On success: replaces req[source] with validated/converted value and calls next().
 */

const { errorResult } = require('../utils/ResultEnvelope');

/**
 * Returns Express middleware that validates the given request source against a Joi schema.
 *
 * @param {import('joi').Schema} schema - Joi schema to validate against
 * @param {'query'|'body'|'params'} [source='query'] - Request property to validate
 * @returns {Function} Express middleware
 */
function validate(schema, source = 'query') {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[source], {
            abortEarly: false,
            stripUnknown: true,
            convert: true,
        });

        if (error) {
            const errors = error.details.map((d) => d.message);
            return res.status(400).json(
                errorResult(errors, 'Validation failed')
            );
        }

        req[source] = value;
        next();
    };
}

module.exports = { validate };
