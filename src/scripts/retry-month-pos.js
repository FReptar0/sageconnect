/**
 * Retry-Month POs Sweep
 *
 * Operator CLI tool for previewing/applying the new cron WHERE shape against
 * all pending POs in the configured retry scope. Default --dry-run (HANDOFF.md §6 +
 * Convention A); --apply opt-in for actual upload.
 *
 * On --dry-run: prints aligned table of POs the cron would process, with retry
 * state per row (errorCount, nextEligibleAt, verdict). No mutations.
 * On --apply: iterates tenants and calls createPurchaseOrders(tenantIndex) —
 * REUSES the rewritten Wave 2 cron path. Same SQL, same JS post-filter, same
 * INSERT POSTED/ERROR semantics.
 *
 * Usage:
 *   node src/scripts/retry-month-pos.js                  # dry-run, all tenants
 *   node src/scripts/retry-month-pos.js --apply          # apply, all tenants
 *   node src/scripts/retry-month-pos.js --tenant=0        # dry-run, tenant 0
 *   node src/scripts/retry-month-pos.js --tenant=0 --apply # apply, tenant 0
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
const { createPurchaseOrders } = require('../controller/PortalOC_Creator');

const LOG_FILE = 'RetryMonthPOs';

const tenantIds = config.portal.tenants.map(t => t.id);
const databases = config.portal.tenants.map(t => t.database);

// --- Console → Log File Interceptor ---
// Mirrors ALL console output to the winston log file so nothing is lost.
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
    let tenantIndex = null; // null = all tenants

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
 * Per-tenant sweep: assembles candidate POs using the SAME WHERE shape as the cron path.
 * Returns {candidates, eligible, deferred} arrays.
 */
async function sweepTenantPOs(tenantIndex) {
    const tenantDb = databases[tenantIndex];
    const dateFieldExpr = `(SELECT MAX(Fecha) FROM Autorizaciones_electronicas.dbo.Autoriza_OC_detalle WHERE Empresa = '${tenantDb}' AND PONumber = A.PONUMBER)`;
    const sql = `
        SELECT
            RTRIM(A.PONUMBER) AS po,
            '${tenantDb}' AS tenant,
            ${dateFieldExpr} AS fechaAuth,
            COALESCE(ef.errorCount, 0) AS errorCount,
            ef.lastErrorAt
        FROM ${tenantDb}.dbo.POPORH1 A
        LEFT OUTER JOIN ${tenantDb}.dbo.POPORL B
          ON A.PORHSEQ = B.PORHSEQ
        LEFT OUTER JOIN Autorizaciones_electronicas.dbo.Autoriza_OC X
          ON A.PONUMBER = X.PONumber
        ${buildErrorStatsApply({ fesaTable: 'fesa.dbo.fesaOCFocaltec', joinColumn: 'ocSage', joinKey: 'A.PONUMBER', dbAlias: tenantDb, dbColumn: 'idDatabase' })}
        WHERE X.Autorizada = 1
          AND X.Empresa = '${tenantDb}'
          AND ${buildScopeWhere(config.retry, { dateField: dateFieldExpr })}
          AND NOT EXISTS (
            SELECT 1 FROM fesa.dbo.fesaOCFocaltec
            WHERE ocSage = A.PONUMBER
              AND idDatabase = '${tenantDb}'
              AND status IN ('CLOSED', 'POSTED')
          )
        GROUP BY A.PONUMBER, ef.errorCount, ef.lastErrorAt
    `;
    const { recordset } = await runQuery(sql, tenantDb);
    const now = new Date();
    // Intervalo fijo por tipo de documento (D-02); constante para todo el barrido, así que
    // se resuelve una sola vez fuera del bucle — igual que en el cron (PortalOC_Creator.js).
    const intervalMin = getRetryIntervalMinutes(config.retry.interval, 'po');
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
            po: row.po,
            tenant: row.tenant,
            fechaAuth: row.fechaAuth ? new Date(row.fechaAuth).toISOString().slice(0, 10) : null,
            errorCount,
            nextEligibleAt: nextEligibleAt ? nextEligibleAt.toISOString() : null,
            verdict: null, // filled below
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

async function runRetryMonthPOs(apply, tenantIndex) {
    const startTime = Date.now();
    const indices = tenantIndex !== null ? [tenantIndex] : tenantIds.map((_, i) => i);

    console.log('========================================================');
    console.log(`RETRY-MONTH POS — Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
    console.log(`Tenants:           ${indices.map(i => tenantIds[i]).join(', ')}`);
    console.log(`Scope:             ${config.retry.scope}${config.retry.scope === 'last_n_days' ? ' (' + config.retry.lookbackDays + ' days)' : ''}`);
    console.log(`Interval:          po=${config.retry.interval.po} min`);
    console.log('========================================================');

    const perTenant = [];
    let totalEligible = 0;
    let totalDeferred = 0;

    for (const i of indices) {
        console.log(`\n--- Tenant ${i}: ${tenantIds[i]} (DB=${databases[i]}) ---`);
        let sweep;
        try {
            sweep = await sweepTenantPOs(i);
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
            console.log('(No pending POs in scope.)');
        }

        // Per-row log lines per CONTEXT D-13 / D-05 (mismo shape de campos que las [RETRY*] del cron)
        const prefix = apply ? '[APPLY]' : '[DRY-RUN]';
        sweep.eligible.forEach(e => {
            logGenerator(LOG_FILE, 'info',
                `${prefix} eligible PO ${e.po} tenant=${e.tenant} fechaAuth=${e.fechaAuth} attempts=${e.errorCount} verdict=${e.verdict}`);
        });
        sweep.deferred.forEach(d => {
            logGenerator(LOG_FILE, 'info',
                `${prefix} deferred PO ${d.po} tenant=${d.tenant} attempts=${d.errorCount} nextEligibleAt=${d.nextEligibleAt} verdict=in-interval`);
        });

        if (apply && sweep.eligible.length > 0) {
            console.log(`\n[APPLY] Calling createPurchaseOrders(${i}) — uses the rewritten cron path...`);
            try {
                await createPurchaseOrders(i);
                console.log(`[APPLY] Tenant ${tenantIds[i]} completed.`);
            } catch (err) {
                console.error(`[APPLY] Tenant ${tenantIds[i]} createPurchaseOrders failed: ${err.message}`);
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
        `Retry-month-pos ${apply ? 'apply' : 'dry-run'}: ${totalEligible} eligible, ${totalDeferred} deferred (interval)`,
        { startTime }
    );
}

async function main() {
    const { apply, tenantIndex } = parseArgs();
    try {
        const envelope = await runRetryMonthPOs(apply, tenantIndex);
        if (!envelope.success) {
            process.exitCode = 1;
        }
    } catch (err) {
        console.error('FATAL:', err.message);
        logGenerator(LOG_FILE, 'error', `[FATAL] ${err.message}`);
        process.exitCode = 1;
    }
}

module.exports = { runRetryMonthPOs, sweepTenantPOs, parseArgs };

if (require.main === module) {
    main().catch(err => {
        console.error('FATAL:', err);
        process.exitCode = 1;
    });
}
