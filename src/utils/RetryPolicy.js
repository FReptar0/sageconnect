// RETRY-04 / RETRY-05 / D-01 / D-02 / D-05: pure helpers for the cron retry policy — used by both controllers, the diagnostic script, and the retry-month operator scripts. Single source of truth for backoff math + scope-WHERE SQL + OUTER APPLY error-stats fragment.

// Internal defaults — used only when a backoffConfig member is missing or invalid.
// The authoritative values live in config.retry.backoff.* (range-guarded at boot by 20-01);
// these mirror the customer-confirmed curve 15→30→60→…→1440 and exist purely as a
// defensive fallback so a malformed caller-supplied config never yields NaN/Infinity.
const DEFAULT_INITIAL_MIN = 15;
const DEFAULT_MULTIPLIER = 2;
const DEFAULT_MAX_MIN = 1440;

/**
 * Compute the backoff wait (in minutes) before a failed row becomes eligible for retry.
 *
 * Geometric backoff: wait = initialMin * multiplier^(errorCount - 1), capped at maxMin.
 * With the customer-confirmed defaults (initialMin=15, multiplier=2, maxMin=1440) the
 * canonical curve is: 0→0, 1→15, 2→30, 3→60, 4→120, 5→240, 6→480, 7→960, 8→1440,
 * and 1440 thereafter (capped at the 24h ceiling).
 *
 * Defensive: a non-finite/negative `errorCount` returns 0 (treated as "never failed",
 * eligible immediately) — prevents `wait=Infinity` from poisoning the JS post-filter loop.
 * Missing/invalid `backoffConfig` members fall back to the module defaults; the function
 * never throws — callers interpolate the result into timing math, not SQL.
 *
 * @param {number} errorCount - Count of prior ERROR rows for this PO/payment.
 * @param {{initialMin:number, multiplier:number, maxMin:number}} backoffConfig - Backoff tuning (typically config.retry.backoff).
 * @returns {number} Minutes to wait. 0 for errorCount=0. Example curve: 1→15, 2→30, 3→60, …, 8→1440.
 */
function computeBackoffWaitMinutes(errorCount, backoffConfig) {
    if (typeof errorCount !== 'number' || !Number.isFinite(errorCount) || errorCount < 0) {
        return 0;
    }
    if (errorCount === 0) {
        return 0;
    }

    const cfg = backoffConfig || {};
    const initialMin = (typeof cfg.initialMin === 'number' && Number.isFinite(cfg.initialMin) && cfg.initialMin > 0)
        ? cfg.initialMin
        : DEFAULT_INITIAL_MIN;
    const multiplier = (typeof cfg.multiplier === 'number' && Number.isFinite(cfg.multiplier) && cfg.multiplier >= 1)
        ? cfg.multiplier
        : DEFAULT_MULTIPLIER;
    const maxMin = (typeof cfg.maxMin === 'number' && Number.isFinite(cfg.maxMin) && cfg.maxMin > 0)
        ? cfg.maxMin
        : DEFAULT_MAX_MIN;

    const wait = initialMin * Math.pow(multiplier, errorCount - 1);
    return Math.min(wait, maxMin);
}

/**
 * Build the sargable scope WHERE-clause fragment for the cron retry query.
 *
 * Two branches, driven by `scopeConfig.scope`:
 *   - 'current_month' → bounds the date column to the current calendar month using
 *     DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) as the lower bound and
 *     DATEADD(month, 1, ...) as the exclusive upper bound. Sargable — the column is
 *     never wrapped in a function, so an index on it can be used.
 *   - 'last_n_days' → `<dateField> >= DATEADD(day, -N, CAST(GETDATE() AS DATE))`.
 *
 * `options.dateField` lets the caller name the column or supply a qualified expression:
 * POs default to `'Fecha'`; payments override with `'P.AUDTDATE'`. `lookbackDays` is
 * range-guarded by the boot config (20-01) so it is safe to interpolate per CLAUDE.md §6 #1.
 *
 * An invalid `scope` throws — the boot-time guard in src/config.js already validates the
 * env value, so a runtime fallthrough here is a programmer error worth surfacing loudly.
 *
 * @param {{scope:string, lookbackDays?:number}} scopeConfig - Scope tuning (typically config.retry).
 * @param {{dateField?:string}} [options] - Optional overrides; `dateField` defaults to 'Fecha'.
 * @returns {string} A SQL boolean expression suitable for embedding in a WHERE clause.
 * @throws {Error} If `scopeConfig.scope` is neither 'current_month' nor 'last_n_days'.
 */
function buildScopeWhere(scopeConfig, options = {}) {
    const cfg = scopeConfig || {};
    const opts = options || {};
    const dateField = opts.dateField || 'Fecha';

    if (cfg.scope === 'current_month') {
        const monthStart = 'DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)';
        return `${dateField} >= ${monthStart} AND ${dateField} < DATEADD(month, 1, ${monthStart})`;
    }

    if (cfg.scope === 'last_n_days') {
        return `${dateField} >= DATEADD(day, -${cfg.lookbackDays}, CAST(GETDATE() AS DATE))`;
    }

    throw new Error('buildScopeWhere: invalid scope ' + cfg.scope);
}

/**
 * Build the OUTER APPLY fragment that pulls per-row error stats (D-02 / D-05).
 *
 * Produces a sub-select aliased `ef` that the consuming controller references as
 * `ef.errorCount` and `ef.lastErrorAt` after the OUTER APPLY. The fragment counts
 * ERROR rows in the FESA control table for a single PO/payment and reports the most
 * recent failure timestamp — the JS post-filter then feeds `errorCount` into
 * `computeBackoffWaitMinutes` and `lastErrorAt` into the next-eligible calculation.
 *
 * The alias `ef` is fixed — all consumers reference `ef.errorCount` / `ef.lastErrorAt`.
 *
 * Field-name discipline (PATTERNS.md CRITICAL FIELD-NAME NOTE):
 *   - POs       → fesaTable 'fesa.dbo.fesaOCFocaltec', joinColumn 'ocSage',     dbColumn 'idDatabase'
 *   - Payments  → fesaTable 'fesa.dbo.fesaPagosFocaltec', joinColumn 'NoPagoSage', dbColumn 'idCia'
 * `dbColumn` defaults to 'idDatabase' and `joinColumn` to 'ocSage' (the POs case).
 *
 * All five params are hardcoded SQL identifiers / controlled tenant values chosen by the
 * caller — none are user input — so template-literal interpolation is the established
 * codebase pattern here (CLAUDE.md §6 #1; do not migrate to parameterized queries).
 *
 * @param {object} params
 * @param {string} params.fesaTable - Fully-qualified FESA control table (e.g., 'fesa.dbo.fesaOCFocaltec').
 * @param {string} [params.joinColumn='ocSage'] - Control-table column joined to `joinKey`.
 * @param {string} params.joinKey - Outer-query SQL identifier to join on (e.g., 'A.PONUMBER').
 * @param {string} params.dbAlias - Tenant DB alias from the controlled tenant list (e.g., 'COPDAT').
 * @param {string} [params.dbColumn='idDatabase'] - Control-table DB-discriminator column ('idDatabase' for POs, 'idCia' for payments).
 * @returns {string} A multi-line `OUTER APPLY (...) AS ef` SQL fragment.
 */
function buildErrorStatsApply({ fesaTable, joinColumn, joinKey, dbAlias, dbColumn } = {}) {
    const resolvedJoinColumn = joinColumn || 'ocSage';
    const resolvedDbColumn = dbColumn || 'idDatabase';

    return `OUTER APPLY (
    SELECT COUNT(*) AS errorCount, MAX(lastUpdate) AS lastErrorAt
    FROM ${fesaTable}
    WHERE ${resolvedJoinColumn} = ${joinKey}
      AND ${resolvedDbColumn} = '${dbAlias}'
      AND status = 'ERROR'
) AS ef`;
}

module.exports = { computeBackoffWaitMinutes, buildScopeWhere, buildErrorStatsApply };
