/**
 * Retry-Month Payments Sweep
 *
 * Operator CLI tool for previewing/applying the new cron WHERE shape against
 * all pending payments in the configured retry scope. Default --dry-run
 * (HANDOFF.md §6 + Convention A); --apply opt-in for actual upload.
 *
 * On --dry-run: prints aligned table of payments the cron would process, with
 * retry state per row (errorCount, nextEligibleAt, verdict). No mutations.
 * On --apply: iterates tenants and calls uploadPayments(tenantIndex) — REUSES
 * the rewritten Wave 2 cron path. Same SQL, same JS post-filter, same INSERT
 * control-table semantics. The 60-min antiquity filter is PRESERVED per
 * REQ RETRY-02 boundary.
 *
 * Usage:
 *   node src/scripts/retry-month-payments.js                  # dry-run, all tenants
 *   node src/scripts/retry-month-payments.js --apply          # apply, all tenants
 *   node src/scripts/retry-month-payments.js --tenant=0        # dry-run, tenant 0
 *   node src/scripts/retry-month-payments.js --tenant=0 --apply # apply, tenant 0
 *
 * Args:
 *   --apply        — opt-in. Without it: dry-run only (default)
 *   --tenant=N     — process only tenant index N (default: all tenants)
 */

const config = require('../config');
const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { successResult, errorResult } = require('../utils/ResultEnvelope');
const { buildScopeWhere, buildErrorStatsApply, getRetryIntervalMinutes, computeRetryEligibility } = require('../utils/RetryPolicy');
const { uploadPayments } = require('../controller/PortalPaymentController');

const LOG_FILE = 'RetryMonthPayments';

const tenantIds = config.portal.tenants.map(t => t.id);
const databases = config.portal.tenants.map(t => t.database);

// --- Console → Log File Interceptor ---
// (Identical to retry-month-pos.js — mirrors ALL console output to winston log file)
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;
const _origTable = console.table;

console.log = (...args) => {
    _origLog.apply(console, args);
    logGenerator(LOG_FILE, 'info', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};
console.warn = (...args) => {
    _origWarn.apply(console, args);
    logGenerator(LOG_FILE, 'warn', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};
console.error = (...args) => {
    _origError.apply(console, args);
    logGenerator(LOG_FILE, 'error', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};
console.table = (...args) => {
    _origTable.apply(console, args);
    logGenerator(LOG_FILE, 'info', '[TABLE] ' + JSON.stringify(args[0]));
};

function parseArgs() {
    const args = process.argv.slice(2);
    let apply = false;
    let tenantIndex = null;
    for (const a of args) {
        if (a === '--apply') {
            apply = true;
        } else if (a.startsWith('--tenant=')) {
            const n = parseInt(a.split('=')[1], 10);
            if (Number.isInteger(n) && n >= 0 && n < tenantIds.length) {
                tenantIndex = n;
            } else {
                console.error(`[ERROR] --tenant=${a.split('=')[1]} fuera de rango (0..${tenantIds.length - 1})`);
                process.exit(1);
            }
        }
    }
    return { apply, tenantIndex };
}

/**
 * Per-tenant sweep: assembles candidate payments using the SAME WHERE shape as the cron path.
 * Preserves the 60-min antiquity filter (REQ RETRY-02 boundary).
 * Returns {candidates, eligible, deferred} arrays.
 */
async function sweepTenantPayments(tenantIndex) {
    const tenantDb = databases[tenantIndex];
    const sql = `
        SELECT
            RTRIM(P.DOCNBR) AS payment_id,
            '${tenantDb}' AS tenant,
            P.AUDTDATE AS fechaAuth,
            COALESCE(ef.errorCount, 0) AS errorCount,
            ef.lastErrorAt
        FROM APBTA B
        JOIN BKACCT BK ON B.IDBANK = BK.BANK
        JOIN APTCR P ON B.PAYMTYPE = P.BTCHTYPE
            AND B.CNTBTCH = P.CNTBTCH
        ${buildErrorStatsApply({ fesaTable: 'fesa.dbo.fesaPagosFocaltec', joinColumn: 'NoPagoSage', joinKey: 'P.DOCNBR', dbAlias: tenantDb, dbColumn: 'idCia', timestampColumn: 'none' })}
        WHERE B.PAYMTYPE = 'PY'
            AND B.BATCHSTAT = 3
            AND P.ERRENTRY = 0
            AND P.RMITTYPE = 1
            AND ${buildScopeWhere(config.retry, { dateField: 'P.AUDTDATE' })}
            AND P.DOCNBR NOT IN (
                SELECT NoPagoSage
                FROM fesa.dbo.fesaPagosFocaltec
                WHERE idCia = P.AUDTORG AND NoPagoSage = P.DOCNBR
                  AND status IN ('PAID', 'PARTIAL')
            )
            -- Filtro para solo procesar pagos con al menos 60 minutos de antigüedad — REQ RETRY-02 boundary (preserved)
            AND DATEDIFF(
                MINUTE,
                DATEADD(
                    mi,
                    DATEDIFF(mi, GETUTCDATE(), GETDATE()),
                    CONVERT(VARCHAR(10), CONVERT(Date, CONVERT(VARCHAR(8), P.AUDTDATE)))
                    + ' ' +
                    LEFT(LEFT(RIGHT('00000000' + CONVERT(varchar(8), P.AUDTTIME), 8), 4), 2) + ':' +
                    RIGHT(LEFT(RIGHT('00000000' + CONVERT(varchar(8), P.AUDTTIME), 8), 4), 2) + ':' +
                    RIGHT(LEFT(RIGHT('00000000' + CONVERT(varchar(8), P.AUDTTIME), 8), 6), 2)
                ),
                SYSDATETIME()
            ) >= 60
    `;
    const { recordset } = await runQuery(sql, tenantDb);
    const now = new Date();
    // Intervalo fijo por tipo de documento (D-02); constante para todo el barrido, así que
    // se resuelve una sola vez fuera del bucle — igual que en el cron (PortalPaymentController.js).
    const intervalMin = getRetryIntervalMinutes(config.retry.interval, 'payment');
    const eligible = [];
    const deferred = [];
    for (const row of recordset) {
        const errorCount = row.errorCount || 0;
        // `isEligible`, no `eligible`: `eligible` ya es el arreglo acumulador de esta función.
        // La regla completa (incluido "primer intento => elegible ya") vive en el helper (D-01).
        const { eligible: isEligible, nextEligibleAt } = computeRetryEligibility({
            lastErrorAt: row.lastErrorAt,
            intervalMinutes: intervalMin,
            now,
        });
        const entry = {
            payment_id: row.payment_id,
            tenant: row.tenant,
            fechaAuth: row.fechaAuth ? String(row.fechaAuth) : null,
            errorCount,
            nextEligibleAt: nextEligibleAt ? nextEligibleAt.toISOString() : null,
            verdict: null,
        };
        if (!row.lastErrorAt) {
            entry.verdict = 'never-tried';
            eligible.push(entry);
        } else if (!isEligible) {
            entry.verdict = 'in-interval';
            deferred.push(entry);
        } else {
            entry.verdict = 'ready-to-retry';
            eligible.push(entry);
        }
    }
    return { candidates: recordset.length, eligible, deferred };
}

async function runRetryMonthPayments(apply, tenantIndex) {
    const startTime = Date.now();
    const indices = tenantIndex !== null ? [tenantIndex] : tenantIds.map((_, i) => i);

    console.log('========================================================');
    console.log(`RETRY-MONTH PAYMENTS — Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
    console.log(`Tenants:           ${indices.map(i => tenantIds[i]).join(', ')}`);
    console.log(`Scope:             ${config.retry.scope}${config.retry.scope === 'last_n_days' ? ' (' + config.retry.lookbackDays + ' days)' : ''}`);
    console.log(`Interval:          payment=${config.retry.interval.payment} min`);
    console.log('60-min antiquity filter: PRESERVED (REQ RETRY-02 boundary)');
    console.log('========================================================');

    const perTenant = [];
    let totalEligible = 0;
    let totalDeferred = 0;

    for (const i of indices) {
        console.log(`\n--- Tenant ${i}: ${tenantIds[i]} (DB=${databases[i]}) ---`);
        let sweep;
        try {
            sweep = await sweepTenantPayments(i);
        } catch (err) {
            console.error(`[ERROR] Tenant ${i} sweep failed: ${err.message}`);
            perTenant.push({ tenant: tenantIds[i], error: err.message });
            continue;
        }
        console.log(`Candidates: ${sweep.candidates} | Eligible: ${sweep.eligible.length} | Deferred (interval): ${sweep.deferred.length}`);

        const allRows = [...sweep.eligible, ...sweep.deferred];
        if (allRows.length > 0) {
            console.table(allRows);
        } else {
            console.log('(No pending payments in scope.)');
        }

        const prefix = apply ? '[APPLY]' : '[DRY-RUN]';
        sweep.eligible.forEach(e => {
            logGenerator(LOG_FILE, 'info',
                `${prefix} eligible Pago ${e.payment_id} tenant=${e.tenant} fechaAuth=${e.fechaAuth} attempts=${e.errorCount} verdict=${e.verdict}`);
        });
        sweep.deferred.forEach(d => {
            logGenerator(LOG_FILE, 'info',
                `${prefix} deferred Pago ${d.payment_id} tenant=${d.tenant} attempts=${d.errorCount} nextEligibleAt=${d.nextEligibleAt} verdict=in-interval`);
        });

        if (apply && sweep.eligible.length > 0) {
            console.log(`\n[APPLY] Calling uploadPayments(${i}) — uses the rewritten cron path...`);
            try {
                await uploadPayments(i);
                console.log(`[APPLY] Tenant ${tenantIds[i]} completed.`);
            } catch (err) {
                console.error(`[APPLY] Tenant ${tenantIds[i]} uploadPayments failed: ${err.message}`);
            }
        }

        perTenant.push({
            tenant: tenantIds[i],
            candidates: sweep.candidates,
            eligible: sweep.eligible.length,
            deferred: sweep.deferred.length,
        });
        totalEligible += sweep.eligible.length;
        totalDeferred += sweep.deferred.length;
    }

    console.log(`\n--- ${apply ? 'APPLY' : 'DRY-RUN'} SUMMARY ---`);
    console.log(`Total eligible: ${totalEligible} | Total deferred (interval): ${totalDeferred}`);

    return successResult(
        {
            mode: apply ? 'apply' : 'dry-run',
            perTenant,
            totalEligible,
            totalDeferred,
        },
        `Retry-month-payments ${apply ? 'apply' : 'dry-run'}: ${totalEligible} eligible, ${totalDeferred} deferred (interval)`,
        { startTime }
    );
}

async function main() {
    const { apply, tenantIndex } = parseArgs();
    try {
        const envelope = await runRetryMonthPayments(apply, tenantIndex);
        if (!envelope.success) {
            process.exitCode = 1;
        }
    } catch (err) {
        console.error('FATAL:', err.message);
        logGenerator(LOG_FILE, 'error', `[FATAL] ${err.message}`);
        process.exitCode = 1;
    }
}

module.exports = { runRetryMonthPayments, sweepTenantPayments, parseArgs };

if (require.main === module) {
    main().catch(err => {
        console.error('FATAL:', err);
        process.exitCode = 1;
    });
}
