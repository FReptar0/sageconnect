// RETRY-C2 / RETRY-C4 / D-01 / D-02 / D-05 / RETRY-S1 / D-06 / D-07 / RETRY-S4 / 20.2 D-01 / D-04 / D-05: pure helpers for the cron retry policy — used by both controllers, the diagnostic script, and the retry-month operator scripts. Single source of truth for the fixed retry interval + eligibility rule + scope-WHERE SQL + OUTER APPLY error-stats fragment.

// Minutes → milliseconds. The interval values are minutes everywhere (config, logs, operator
// docs); only this module converts, so no call site has to remember the factor.
const MS_PER_MINUTE = 60000;

/**
 * Resolve the fixed retry interval (in minutes) for a document type.
 *
 * The wait between retries is FIXED per document type — payments 30 min (client, 2026-05-20),
 * POs 240 min (team, 2026-06-11) — and deliberately does NOT grow with the attempt count.
 * There is no error-count parameter: a document that failed eight times waits exactly as long
 * as one that failed once. `errorCount` survives only as operator log context (`attempts=`).
 *
 * The authoritative values live in `config.retry.interval.{payment, po}`, range-guarded at boot
 * ([10,60] / [30,1440]) — so callers pass `config.retry.interval` straight in.
 *
 * An unknown `docType` throws: the two call sites are hardcoded ('payment' in the payment
 * controller, 'po' in the PO controller/diagnostic), so a third value is a programmer error
 * worth surfacing loudly — same posture as buildScopeWhere's invalid-scope throw.
 *
 * @param {{payment:number, po:number}} intervalConfig - Interval tuning (typically config.retry.interval).
 * @param {'payment'|'po'} docType - Which document type is being retried.
 * @returns {number} Fixed interval in minutes.
 * @throws {Error} If `docType` is neither 'payment' nor 'po'.
 */
function getRetryIntervalMinutes(intervalConfig, docType) {
    const cfg = intervalConfig || {};

    if (docType === 'payment') {
        return cfg.payment;
    }

    if (docType === 'po') {
        return cfg.po;
    }

    throw new Error('getRetryIntervalMinutes: invalid docType ' + docType);
}

/**
 * Decide whether a candidate row may be (re)uploaded now, and when it next becomes eligible.
 *
 * The whole retry-eligibility rule lives here so it cannot drift between the two controllers
 * and po-cron-diagnostic.js (D-01):
 *   - No `lastErrorAt` (no prior ERROR row) → eligible IMMEDIATELY. A first upload is not a
 *     retry; deferring it would stall normal traffic, which is the highest-blast-radius
 *     regression in this policy (RETRY-C4).
 *   - With `lastErrorAt` → eligible once `now - lastErrorAt >= intervalMinutes`. The comparison
 *     is INCLUSIVE (`>=`): a row that failed exactly one interval ago goes in this tick, not the
 *     next one — with a 15-min cron cadence an exclusive test would silently add a whole tick.
 *
 * Fails OPEN, never throws — for ALL THREE inputs (RETRY-S4). An unusable `intervalMinutes`
 * (missing/NaN/negative), an unparseable `lastErrorAt`, or an unusable `now` (missing, null,
 * empty string, 0, NaN, unparseable) each yield "eligible now" rather than a permanently
 * deferred row: a bad `now` falls back to the process clock, so the verdict is eligible *per
 * that clock* — never a permanent defer, and never a throw (an exception here aborts a cron
 * tick mid-batch on an always-on service). Retrying too eagerly is a portal 409 at worst; a
 * stuck row is invisible and unbounded.
 *
 * Clock basis (D-01): `now` MUST originate from the SAME SELECT statement that produced
 * `lastErrorAt` — the `GETDATE() AS dbNow` column each caller adds to its projection. Both
 * operands then come off the same SQL Server, so any driver-level timezone reinterpretation
 * applies identically to both and cancels out of the subtraction. `GETDATE()` in a SELECT list
 * is a per-statement runtime constant (D-05), so every row in one tick shares one identical
 * `dbNow` — no intra-batch drift. This helper cannot detect a caller that violates the rule;
 * the SQL-shape tests on the call sites are the net for that half.
 *
 * Operator warning (D-04): both operands live in "server-local wall clock labelled UTC" space,
 * so the `nextEligibleAt` that `[RETRY-DEFER]` prints via `.toISOString()` renders SERVER-LOCAL
 * time carrying a `Z` suffix. Read it as Mexico time, not as UTC. Measured 2026-07-27 on the
 * deployed SQL Server host (`ZCL-SQL-01`): `DATEDIFF(mi, GETUTCDATE(), GETDATE())` = -360, i.e.
 * six hours. Documented rather than corrected on purpose — the `[RETRY*]` log labels are
 * anchored by `^...$` regexes in the controller tests, so the log line itself must not change.
 *
 * @param {object} params
 * @param {Date|string|null} [params.lastErrorAt] - Most recent ERROR timestamp (ef.lastErrorAt), null when never failed.
 * @param {number} params.intervalMinutes - Fixed interval for this document type (see getRetryIntervalMinutes).
 * @param {Date|string} [params.now=new Date()] - Evaluation instant, SQL-sourced (`GETDATE() AS dbNow`, row.dbNow) so it shares a clock with `lastErrorAt`; still injectable so tests pin the boundary. Falls back to the process clock when omitted or unusable.
 * @returns {{eligible:boolean, nextEligibleAt:Date|null}} `nextEligibleAt` is null only for the never-failed case.
 */
function computeRetryEligibility({ lastErrorAt, intervalMinutes, now = new Date() } = {}) {
    if (!lastErrorAt) {
        return { eligible: true, nextEligibleAt: null };
    }

    const lastErrorMs = new Date(lastErrorAt).getTime();
    if (!Number.isFinite(lastErrorMs)) {
        return { eligible: true, nextEligibleAt: null };
    }

    const interval = (typeof intervalMinutes === 'number' && Number.isFinite(intervalMinutes) && intervalMinutes > 0)
        ? intervalMinutes
        : 0;

    const nextEligibleAt = new Date(lastErrorMs + interval * MS_PER_MINUTE);

    // Fail OPEN on an unusable `now`, same posture as the two guards above (20.1-01).
    // `now` is now SQL-sourced (row.dbNow), so a null/absent column — driver quirk, hand-edited
    // fixture, future query variant — would land the evaluation instant on the Unix epoch:
    // `0 >= nextEligibleAt` is never true, so EVERY candidate row would defer forever behind
    // normal-looking [RETRY-DEFER] lines. Falling back to the process clock is the deliberate
    // choice: an over-eager retry is a portal 409 at worst, a stuck row is invisible and unbounded.
    // Both tests are needed — the falsy test catches null/''/0 (each yields a *finite* epoch
    // timestamp), Number.isFinite catches NaN and unparseable strings such as 'not-a-date'.
    const candidateNowMs = (now instanceof Date ? now : new Date(now)).getTime();
    const nowMs = (!now || !Number.isFinite(candidateNowMs)) ? Date.now() : candidateNowMs;

    return {
        eligible: nowMs >= nextEligibleAt.getTime(),
        nextEligibleAt,
    };
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
 * Build the OUTER APPLY fragment that pulls per-row error stats (D-02 / D-05 / RETRY-S1).
 *
 * Produces a sub-select aliased `ef` that the consuming controller references as
 * `ef.errorCount` and `ef.lastErrorAt` after the OUTER APPLY. The fragment counts
 * ERROR rows in the FESA control table for a single PO/payment and reports the most
 * recent failure timestamp — the JS post-filter feeds `lastErrorAt` into
 * `computeRetryEligibility`. Since 20.1 the interval is fixed, so `errorCount` no longer
 * drives any timing math (D-04); it survives purely as operator log context (`attempts=`).
 *
 * The alias `ef` is fixed — all consumers reference `ef.errorCount` / `ef.lastErrorAt`.
 *
 * Field-name discipline (PATTERNS.md CRITICAL FIELD-NAME NOTE, reconciled against the
 * 2026-07-27 production read of fesa.INFORMATION_SCHEMA.COLUMNS):
 *   - POs       → fesaTable 'fesa.dbo.fesaOCFocaltec',    joinColumn 'ocSage',     dbColumn 'idDatabase', timestampColumn 'lastUpdate'
 *   - Payments  → fesaTable 'fesa.dbo.fesaPagosFocaltec', joinColumn 'NoPagoSage', dbColumn 'idCia',      timestampColumn 'none'
 * `dbColumn` defaults to 'idDatabase' and `joinColumn` to 'ocSage' (the POs case).
 *
 * `timestampColumn` deliberately has NO default (D-06). fesa.dbo.fesaPagosFocaltec has only
 * FOUR columns — idCia, NoPagoSage, status, idFocaltec — so it has no lastUpdate at all: a
 * 'lastUpdate' default would be right for OCs and silently invalid for payments, aborting the
 * whole payment cron query with `Invalid column name` (RETRY-S1). That is precisely the
 * implicit-default trap CLAUDE.md §6 pitfall #2 records, so an omitted or unknown value throws
 * before any SQL string is built (D-07) and every caller must state its table shape (D-08).
 *
 * The five interpolated params are hardcoded SQL identifiers / controlled tenant values chosen
 * by the caller — none are user input — so template-literal interpolation is the established
 * codebase pattern here (CLAUDE.md §6 #1; do not migrate to parameterized queries).
 * `timestampColumn` is NOT interpolated: it is a closed two-value set that selects between two
 * fixed literal SELECT lines, so no caller string ever reaches the emitted SQL for this column.
 *
 * @param {object} params
 * @param {string} params.fesaTable - Fully-qualified FESA control table (e.g., 'fesa.dbo.fesaOCFocaltec').
 * @param {string} [params.joinColumn='ocSage'] - Control-table column joined to `joinKey`.
 * @param {string} params.joinKey - Outer-query SQL identifier to join on (e.g., 'A.PONUMBER').
 * @param {string} params.dbAlias - Tenant DB alias from the controlled tenant list (e.g., 'COPDAT').
 * @param {string} [params.dbColumn='idDatabase'] - Control-table DB-discriminator column ('idDatabase' for POs, 'idCia' for payments).
 * @param {'lastUpdate'|'none'} params.timestampColumn - REQUIRED, closed set, no default. 'lastUpdate' emits `MAX(lastUpdate) AS lastErrorAt` (fesaOCFocaltec); 'none' emits `CAST(NULL AS datetime) AS lastErrorAt` (fesaPagosFocaltec, which has no timestamp column).
 * @returns {string} A multi-line `OUTER APPLY (...) AS ef` SQL fragment.
 * @throws {Error} If `timestampColumn` is anything other than 'lastUpdate' or 'none' — missing, null, empty and wrong-cased values all throw, before any SQL is built.
 */
function buildErrorStatsApply({ fesaTable, joinColumn, joinKey, dbAlias, dbColumn, timestampColumn } = {}) {
    if (timestampColumn !== 'lastUpdate' && timestampColumn !== 'none') {
        throw new Error('buildErrorStatsApply: invalid timestampColumn ' + timestampColumn);
    }

    const resolvedJoinColumn = joinColumn || 'ocSage';
    const resolvedDbColumn = dbColumn || 'idDatabase';
    // Both branches hand `computeRetryEligibility` the same JS type: a Date for the OC case,
    // null for payments — which the helper already treats as "never failed" (eligible now).
    const errorStatsSelect = timestampColumn === 'lastUpdate'
        ? 'SELECT COUNT(*) AS errorCount, MAX(lastUpdate) AS lastErrorAt'
        : 'SELECT COUNT(*) AS errorCount, CAST(NULL AS datetime) AS lastErrorAt';

    return `OUTER APPLY (
    ${errorStatsSelect}
    FROM ${fesaTable}
    WHERE ${resolvedJoinColumn} = ${joinKey}
      AND ${resolvedDbColumn} = '${dbAlias}'
      AND status = 'ERROR'
) AS ef`;
}

module.exports = { getRetryIntervalMinutes, computeRetryEligibility, buildScopeWhere, buildErrorStatsApply };
