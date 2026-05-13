/**
 * PO Cron Diagnostic
 *
 * For each PO passed as CLI arg, explains why the every-15-min cron is
 * NOT picking it up (when the manual po-upload.js works fine).
 *
 * Replicates the exact WHERE used by src/controller/PortalOC_Creator.js
 * and exposes each filter clause independently so the verdict is
 * caso-por-caso, not a guess.
 *
 * Read-only. No INSERT, no UPDATE, no DELETE.
 *
 * Usage:
 *   node src/scripts/po-cron-diagnostic.js PO0083449
 *   node src/scripts/po-cron-diagnostic.js PO0083449 PO0083450
 *   node src/scripts/po-cron-diagnostic.js PO0083449 COPDAT
 *   node src/scripts/po-cron-diagnostic.js PO0083449 COPDAT 0
 *
 * Args:
 *   - PO numbers: anything starting with "PO" (one or more, required)
 *   - DATABASE:   non-PO, non-numeric arg (optional, defaults to tenant DB)
 *   - TENANT_IDX: numeric arg (optional, defaults to 0)
 */

const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { successResult, errorResult } = require('../utils/ResultEnvelope');
const config = require('../config');

const LOG_FILE = 'PO_Cron_Diagnostic';

const tenantDatabases = config.portal.tenants.map(t => t.database);
const tenantIds = config.portal.tenants.map(t => t.id);
const DEFAULT_DATABASE = tenantDatabases[0] || 'COPDAT';

const skipIdentifiers = (config.app.addressIdentifiersSkip || []).filter(id => id && id.length > 0);

async function safeRun(label, fn) {
    try {
        return await fn();
    } catch (err) {
        console.log(`[!] ${label} -> ERROR: ${err.message}`);
        logGenerator(LOG_FILE, 'error', `${label}: ${err.message}`);
        return { __error: err.message };
    }
}

/**
 * Diagnose one PO: runs each filter independently and emits a verdict.
 */
async function diagnoseOne(poNumber, database, tenantIndex) {
    console.log(`\n========================================================`);
    console.log(`PO: ${poNumber}`);
    console.log(`Database: ${database} | Tenant idx: ${tenantIndex} (${tenantIds[tenantIndex] || 'n/a'})`);
    console.log(`Hoy: ${new Date().toISOString().slice(0, 10)}`);
    console.log(`========================================================`);

    const verdict = {
        po: poNumber,
        database,
        tenantIndex,
        existsInPOPORH1: null,
        poStatus: null,
        isAuthorized: null,
        lastAuthDate: null,
        lastAuthDateIsToday: null,
        cronWouldMatch: null,
        cronRowCount: null,
        fesaRowCount: null,
        fesaStatus: null,
        fesaResponseAPI: null,
        fesaIdFocaltec: null,
        reason: null,
    };

    // 1. Existe en POPORH1?
    console.log('\n1. EXISTE EN POPORH1?');
    const r1 = await safeRun('POPORH1 lookup', async () => {
        const sql = `
            SELECT
                RTRIM(PONUMBER)  AS PONUMBER,
                PORHSEQ,
                [DATE]           AS PO_DATE,
                ONHOLD,
                PORHSTAT
            FROM ${database}.dbo.POPORH1
            WHERE PONUMBER = '${poNumber}'
        `;
        const { recordset } = await runQuery(sql, database);
        console.table(recordset);
        return recordset;
    });
    if (r1 && !r1.__error) {
        verdict.existsInPOPORH1 = r1.length > 0;
        verdict.poStatus = r1[0] ? r1[0].PORHSTAT : null;
        if (!verdict.existsInPOPORH1) {
            verdict.reason = 'PO no existe en POPORH1 (numero invalido o DB equivocada)';
            return verdict;
        }
    }

    // 2. Esta autorizada en Autoriza_OC?
    console.log('\n2. AUTORIZADA EN Autoriza_OC?');
    const r2 = await safeRun('Autoriza_OC lookup', async () => {
        const sql = `
            SELECT
                PONumber,
                Empresa,
                Autorizada
            FROM Autorizaciones_electronicas.dbo.Autoriza_OC
            WHERE PONumber = '${poNumber}'
              AND Empresa  = '${database}'
        `;
        const { recordset } = await runQuery(sql, database);
        console.table(recordset);
        return recordset;
    });
    if (r2 && !r2.__error) {
        verdict.isAuthorized = r2.length > 0 && r2[0].Autorizada === 1;
        if (r2.length === 0) {
            verdict.reason = 'No existe fila en Autoriza_OC para esta PO+Empresa';
            return verdict;
        }
        if (!verdict.isAuthorized) {
            verdict.reason = `Autoriza_OC.Autorizada = ${r2[0].Autorizada} (cron exige = 1)`;
            return verdict;
        }
    }

    // 3. MAX(Fecha) en Autoriza_OC_detalle (este es el filtro letal del cron)
    console.log('\n3. MAX(Fecha) EN Autoriza_OC_detalle vs HOY?');
    const r3 = await safeRun('Autoriza_OC_detalle max(Fecha)', async () => {
        const sql = `
            SELECT
                MAX(Fecha)                    AS LastAuthDate,
                CAST(GETDATE() AS DATE)       AS Today,
                CASE
                    WHEN MAX(Fecha) = CAST(GETDATE() AS DATE) THEN 'SI'
                    ELSE 'NO'
                END                            AS IsToday,
                COUNT(*)                      AS DetailRowCount
            FROM Autorizaciones_electronicas.dbo.Autoriza_OC_detalle
            WHERE Empresa  = '${database}'
              AND PONumber = '${poNumber}'
        `;
        const { recordset } = await runQuery(sql, database);
        console.table(recordset);
        return recordset;
    });
    if (r3 && !r3.__error && r3.length > 0) {
        const row = r3[0];
        verdict.lastAuthDate = row.LastAuthDate ? new Date(row.LastAuthDate).toISOString().slice(0, 10) : null;
        verdict.lastAuthDateIsToday = row.IsToday === 'SI';
    }

    // 4. Replica del WHERE del cron — devuelve cuantas filas levantaria
    console.log('\n4. EL WHERE DEL CRON LA LEVANTARIA HOY? (replica exacta)');
    const skipCondition = skipIdentifiers.length > 0
        ? `AND B.[LOCATION] NOT IN (${skipIdentifiers.map(id => `'${id}'`).join(',')})`
        : '';
    const r4 = await safeRun('cron WHERE replica', async () => {
        const sql = `
            SELECT COUNT(*) AS RowsCronWouldSee
            FROM ${database}.dbo.POPORH1 A
            LEFT OUTER JOIN ${database}.dbo.POPORL B
              ON A.PORHSEQ = B.PORHSEQ
            LEFT OUTER JOIN Autorizaciones_electronicas.dbo.Autoriza_OC X
              ON A.PONUMBER = X.PONumber
            WHERE A.PONUMBER = '${poNumber}'
              AND X.Autorizada = 1
              AND X.Empresa = '${database}'
              AND (
                SELECT MAX(Fecha)
                  FROM Autorizaciones_electronicas.dbo.Autoriza_OC_detalle
                 WHERE Empresa = '${database}'
                   AND PONumber = A.PONUMBER
              ) = CAST(GETDATE() AS DATE)
              ${skipCondition}
        `;
        const { recordset } = await runQuery(sql, database);
        console.table(recordset);
        return recordset;
    });
    if (r4 && !r4.__error && r4.length > 0) {
        verdict.cronRowCount = r4[0].RowsCronWouldSee;
        verdict.cronWouldMatch = r4[0].RowsCronWouldSee > 0;
    }

    // 5. Estado en fesaOCFocaltec
    console.log('\n5. ESTADO EN fesaOCFocaltec');
    const r5 = await safeRun('fesaOCFocaltec lookup', async () => {
        const sql = `
            SELECT
                idFocaltec,
                ocSage,
                status,
                idDatabase,
                createdAt,
                lastUpdate,
                responseAPI
            FROM fesa.dbo.fesaOCFocaltec
            WHERE ocSage     = '${poNumber}'
              AND idDatabase = '${database}'
            ORDER BY createdAt DESC
        `;
        const { recordset } = await runQuery(sql, 'FESA');
        console.table(recordset);
        return recordset;
    });
    if (r5 && !r5.__error) {
        verdict.fesaRowCount = r5.length;
        if (r5.length > 0) {
            verdict.fesaStatus = r5[0].status;
            verdict.fesaResponseAPI = r5[0].responseAPI;
            verdict.fesaIdFocaltec = r5[0].idFocaltec || null;
        }
    }

    // 6. Verdict
    if (!verdict.reason) {
        if (verdict.fesaStatus === 'POSTED') {
            verdict.reason = 'Ya esta POSTED en fesaOCFocaltec — el cron la salta correctamente';
        } else if (verdict.cronWouldMatch === false) {
            if (verdict.lastAuthDateIsToday === false) {
                verdict.reason = `Cron filtra por MAX(Fecha)=hoy. Ultima autorizacion fue ${verdict.lastAuthDate} != hoy → cron la ignora.`;
            } else if (skipIdentifiers.length > 0) {
                verdict.reason = 'Cron no la levanta — revisar si todas las lineas (POPORL.LOCATION) caen en addressIdentifiersSkip';
            } else {
                verdict.reason = 'Cron no la levanta — causa desconocida, revisar JOINs (POPORL puede no tener lineas)';
            }
        } else if (verdict.cronWouldMatch === true) {
            verdict.reason = 'Cron SI la levantaria. Si no se sube, es timeout/lock en el step, no filtro.';
        } else {
            verdict.reason = 'Inconcluso (alguno de los checks falló)';
        }
    }

    console.log(`\n>>> VERDICTO: ${verdict.reason}`);
    return verdict;
}

async function runDiagnostic(poNumbers, database, tenantIndex) {
    const startTime = Date.now();

    console.log('========================================================');
    console.log('PO CRON DIAGNOSTIC');
    console.log('========================================================');
    console.log(`POs a diagnosticar: ${poNumbers.join(', ')}`);
    console.log(`Database:           ${database}`);
    console.log(`Tenant idx:         ${tenantIndex} (${tenantIds[tenantIndex] || 'n/a'})`);
    console.log(`Hoy:                ${new Date().toISOString().slice(0, 10)}`);
    console.log(`Ubicaciones skip:   ${skipIdentifiers.length ? skipIdentifiers.join(', ') : '(ninguna)'}`);
    logGenerator(LOG_FILE, 'info', `[START] diagnostic for ${poNumbers.join(',')} db=${database} tenant=${tenantIndex}`);

    const verdicts = [];
    for (const po of poNumbers) {
        try {
            const v = await diagnoseOne(po, database, tenantIndex);
            verdicts.push(v);
            logGenerator(LOG_FILE, 'info', `[VERDICT] ${po}: ${v.reason}`);
        } catch (err) {
            console.error(`[FATAL] ${po}: ${err.message}`);
            logGenerator(LOG_FILE, 'error', `[FATAL] ${po}: ${err.message}`);
            verdicts.push({ po, fatal: err.message });
        }
    }

    console.log('\n========================================================');
    console.log('RESUMEN');
    console.log('========================================================');
    console.table(verdicts.map(v => ({
        PO: v.po,
        existsPOPORH1: v.existsInPOPORH1,
        authorized: v.isAuthorized,
        lastAuthDate: v.lastAuthDate,
        authIsToday: v.lastAuthDateIsToday,
        cronWouldMatch: v.cronWouldMatch,
        fesaStatus: v.fesaStatus,
        verdict: v.reason || v.fatal,
    })));

    return successResult(
        { verdicts },
        `Diagnostico completado para ${poNumbers.length} PO(s)`,
        { tenant: tenantIds[tenantIndex] || null, startTime }
    );
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('ERROR: debes proporcionar al menos un numero de PO');
        console.log('');
        console.log('Uso:');
        console.log('  node src/scripts/po-cron-diagnostic.js PO0083449');
        console.log('  node src/scripts/po-cron-diagnostic.js PO0083449 PO0083450');
        console.log('  node src/scripts/po-cron-diagnostic.js PO0083449 COPDAT');
        console.log('  node src/scripts/po-cron-diagnostic.js PO0083449 COPDAT 0');
        process.exitCode = 1;
        return;
    }

    const poNumbers = [];
    let database = null;
    let tenantIndex = 0;

    for (const arg of args) {
        if (/^PO/i.test(arg)) {
            poNumbers.push(arg.toUpperCase());
        } else if (/^\d+$/.test(arg)) {
            tenantIndex = parseInt(arg, 10);
        } else {
            database = arg;
        }
    }

    if (poNumbers.length === 0) {
        console.log('ERROR: no se detectaron numeros de PO (deben empezar con "PO")');
        process.exitCode = 1;
        return;
    }

    if (tenantIndex < 0 || tenantIndex >= tenantDatabases.length) {
        console.log(`ERROR: tenantIndex ${tenantIndex} fuera de rango (0..${tenantDatabases.length - 1})`);
        process.exitCode = 1;
        return;
    }

    const dbToUse = database || tenantDatabases[tenantIndex] || DEFAULT_DATABASE;

    try {
        const envelope = await runDiagnostic(poNumbers, dbToUse, tenantIndex);
        if (!envelope.success) process.exitCode = 1;
    } catch (err) {
        console.error('FATAL:', err.message);
        logGenerator(LOG_FILE, 'error', `[FATAL] ${err.message}`);
        process.exitCode = 1;
    }
}

module.exports = { diagnoseOne, runDiagnostic };

if (require.main === module) {
    main().catch(err => {
        console.error('FATAL:', err);
        process.exitCode = 1;
    });
}
