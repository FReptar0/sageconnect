/**
 * Result Envelope Helper
 *
 * Enforces consistent response shape across all scripts:
 * { success, data, errors, summary, meta: { duration, timestamp, tenant } }
 *
 * Single source of truth for envelope shape. Used by all 13 scripts
 * and PortalOC_StatusUpdater in subsequent phases.
 */

/**
 * Create a structured result envelope.
 *
 * @param {boolean} success - Whether the operation succeeded
 * @param {object} [opts] - Optional fields
 * @param {*} [opts.data=null] - Result payload
 * @param {string|string[]} [opts.errors=[]] - Error messages (single string is wrapped in array)
 * @param {string} [opts.summary=''] - Human-readable summary
 * @param {string|null} [opts.tenant=null] - Tenant identifier
 * @param {number|null} [startTime] - Date.now() from operation start (for duration calc)
 * @returns {{ success: boolean, data: *, errors: string[], summary: string, meta: { duration: number, timestamp: string, tenant: string|null } }}
 */
function createResult(success, { data = null, errors = [], summary = '', tenant = null } = {}, startTime) {
    return {
        success,
        data,
        errors: Array.isArray(errors) ? errors : [errors],
        summary,
        meta: {
            duration: startTime ? Date.now() - startTime : 0,
            timestamp: new Date().toISOString(),
            tenant,
        },
    };
}

/**
 * Shorthand for a successful result.
 *
 * @param {*} data - Result payload
 * @param {string} summary - Human-readable summary
 * @param {object} [opts] - Optional meta fields
 * @param {string|null} [opts.tenant=null] - Tenant identifier
 * @param {number|null} [opts.startTime=null] - Date.now() from operation start
 * @returns {object} Result envelope with success=true
 */
function successResult(data, summary, { tenant = null, startTime = null } = {}) {
    return createResult(true, { data, errors: [], summary, tenant }, startTime);
}

/**
 * Shorthand for a failed result.
 *
 * @param {string|string[]} errors - Error messages
 * @param {string} summary - Human-readable summary
 * @param {object} [opts] - Optional meta fields
 * @param {string|null} [opts.tenant=null] - Tenant identifier
 * @param {number|null} [opts.startTime=null] - Date.now() from operation start
 * @returns {object} Result envelope with success=false, data=null
 */
function errorResult(errors, summary, { tenant = null, startTime = null } = {}) {
    return createResult(false, { data: null, errors, summary, tenant }, startTime);
}

module.exports = { createResult, successResult, errorResult };
