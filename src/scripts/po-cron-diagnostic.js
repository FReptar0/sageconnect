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
const { buildScopeWhere, buildErrorStatsApply, getRetryIntervalMinutes, computeRetryEligibility } = require('../utils/RetryPolicy');

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
        isAuthorized: null,
        lastAuthDate: null,
        lastAuthDateIsToday: null,
        cronWouldMatch: null,
        cronRowCount: null,
        fesaRowCount: null,
        fesaStatus: null,
        fesaResponseAPI: null,
        fesaIdFocaltec: null,
        errorCount: null,
        lastErrorAt: null,
        retryIntervalMin: null,
        nextEligibleAt: null,
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
                ONHOLD
            FROM ${database}.dbo.POPORH1
            WHERE PONUMBER = '${poNumber}'
        `;
        const { recordset } = await runQuery(sql, database);
        console.table(recordset);
        return recordset;
    });
    if (r1 && !r1.__error) {
        verdict.existsInPOPORH1 = r1.length > 0;
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
    const dateFieldExpr = `(SELECT MAX(Fecha) FROM Autorizaciones_electronicas.dbo.Autoriza_OC_detalle WHERE Empresa = '${database}' AND PONumber = A.PONUMBER)`;
    const r4 = await safeRun('cron WHERE replica', async () => {
        const sql = `
            SELECT COUNT(*) AS RowsCronWouldSee
            FROM ${database}.dbo.POPORH1 A
            LEFT OUTER JOIN ${database}.dbo.POPORL B
              ON A.PORHSEQ = B.PORHSEQ
            LEFT OUTER JOIN Autorizaciones_electronicas.dbo.Autoriza_OC X
              ON A.PONUMBER = X.PONumber
            ${buildErrorStatsApply({ fesaTable: 'fesa.dbo.fesaOCFocaltec', joinColumn: 'ocSage', joinKey: 'A.PONUMBER', dbAlias: database, dbColumn: 'idDatabase', timestampColumn: 'lastUpdate' })}
            WHERE A.PONUMBER = '${poNumber}'
              AND X.Autorizada = 1
              AND X.Empresa = '${database}'
              AND ${buildScopeWhere(config.retry, { dateField: dateFieldExpr })}
              AND NOT EXISTS (
                SELECT 1 FROM fesa.dbo.fesaOCFocaltec
                WHERE ocSage = A.PONUMBER
                  AND idDatabase = '${database}'
                  AND status = 'POSTED'
              )
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

    // 6. Estado de retry-interval (errorCount + lastErrorAt + retryIntervalMin + nextEligibleAt)
    //    RETRY-C5 / D-06: el intervalo es FIJO por tipo de documento (config.retry.interval.po),
    //    ya no crece con el numero de intentos. errorCount es solo contexto de operador.
    console.log('\n6. ESTADO DE RETRY-INTERVAL');
    const r6 = await safeRun('retry-interval state', async () => {
        const sql = `
            SELECT
                COUNT(*) AS errorCount,
                MAX(lastUpdate) AS lastErrorAt,
                GETDATE() AS dbNow -- D-01: reloj unico del veredicto, del MISMO SELECT que lastErrorAt (sin GROUP BY, la constante de runtime es legal junto a los agregados)
            FROM fesa.dbo.fesaOCFocaltec
            WHERE ocSage = '${poNumber}'
              AND idDatabase = '${database}'
              AND status = 'ERROR'
        `;
        const { recordset } = await runQuery(sql, 'FESA');
        return recordset;
    });
    if (r6 && !r6.__error && r6.length > 0) {
        const errorCount = r6[0].errorCount || 0;
        const lastErrorAt = r6[0].lastErrorAt;
        // 20.2 D-01: el instante de evaluacion sale del mismo SELECT que lastErrorAt, no del
        // reloj del proceso. Con el reloj de Node el diagnostico reportaria "lista para
        // reintentar" para una OC que el cron difiere — exactamente la divergencia que el
        // helper compartido existe para impedir.
        const dbNow = r6[0].dbNow || null;
        if (!dbNow) {
            console.log('   ⚠ Reloj del servidor no disponible (dbNow ausente) — usando el reloj del proceso.');
        }
        // La regla de elegibilidad vive completa en computeRetryEligibility (D-01), la misma
        // que usa el cron en PortalOC_Creator.js — asi el veredicto del diagnostico no puede
        // divergir de lo que el cron realmente hace.
        const retryIntervalMin = getRetryIntervalMinutes(config.retry.interval, 'po');
        // Se conserva el veredicto `eligible` del helper, no solo nextEligibleAt: la seccion 7
        // debe REUSARLO, nunca recomparar nextEligibleAt contra new Date(). Ambos operandos de
        // esa comparacion tienen que salir del mismo reloj, y nextEligibleAt deriva de dbNow
        // (hora local del servidor etiquetada UTC) mientras new Date() es UTC real.
        const { eligible: retryEligible, nextEligibleAt } = computeRetryEligibility({
            lastErrorAt,
            intervalMinutes: retryIntervalMin,
            now: dbNow,
        });
        verdict.retryEligible = retryEligible;
        verdict.errorCount = errorCount;
        verdict.lastErrorAt = lastErrorAt ? new Date(lastErrorAt).toISOString() : null;
        verdict.retryIntervalMin = retryIntervalMin;
        verdict.nextEligibleAt = nextEligibleAt ? nextEligibleAt.toISOString() : null;
        console.table([{
            errorCount,
            lastErrorAt: verdict.lastErrorAt,
            retryIntervalMin,
            nextEligibleAt: verdict.nextEligibleAt,
            // El reloj contra el que se calculo el veredicto, visible para el operador.
            // D-04: se renderiza hora local del servidor con sufijo Z — leerla como hora de
            // Mexico, no como UTC.
            dbNow: dbNow ? new Date(dbNow).toISOString() : null,
        }]);
    }

    // 7. Verdict — 5-priority order per SPEC RETRY-C5 / D-06 (amends RETRY-07) + HANDOFF.md §7 (BOTH portal POSTED + fesa.* control table)
    if (!verdict.reason) {
        // Priority 1: POSTED — already processed by cron
        if (verdict.fesaStatus === 'POSTED') {
            verdict.reason = 'Ya está POSTED en fesaOCFocaltec — ya está procesada por el cron.';
        }
        // Priority 2: ERROR + dentro del intervalo — el cron está esperando a propósito.
        // Se reusa el veredicto que el helper ya calculó contra dbNow (20.2 D-01). Recomparar
        // aquí con new Date() mezclaría relojes: nextEligibleAt deriva de la hora local del
        // servidor y new Date() es UTC real, así que con el desfase medido de -360 min y un
        // intervalo de 240 el máximo de nextEligibleAt es (ahora - 120 min) y esta rama sería
        // INALCANZABLE — el diagnóstico diría "lista para reintentar" para una OC que el cron
        // difiere, justo la divergencia que el helper compartido existe para impedir.
        else if (verdict.errorCount > 0 && verdict.nextEligibleAt && verdict.retryEligible === false) {
            verdict.reason = `ERROR previo (${verdict.errorCount} intentos). Esperando reintento hasta ${verdict.nextEligibleAt}.`;
        }
        // Priority 3: ERROR + intervalo cumplido — lista para reintentar
        else if (verdict.errorCount > 0 && verdict.nextEligibleAt && verdict.retryEligible === true) {
            verdict.reason = `ERROR previo (${verdict.errorCount} intentos), intervalo cumplido. Lista para reintentar en el próximo tick.`;
        }
        // Priority 4: zero rows in fesa — never tried
        else if (verdict.fesaRowCount === 0) {
            verdict.reason = 'Nunca intentada (cero filas en fesaOCFocaltec). Debe entrar en el próximo tick.';
        }
        // Priority 5: outside RETRY_SCOPE — cron filter excludes it
        else if (verdict.cronWouldMatch === false) {
            verdict.reason = `Fuera de RETRY_SCOPE=${config.retry.scope}. Ignorada por el filtro de scope del cron.`;
        }
        // Fallback
        else if (verdict.cronWouldMatch === true) {
            verdict.reason = 'Cron SÍ la levantaría. Si no se sube, es timeout/lock en el step, no filtro.';
        }
        else {
            verdict.reason = 'Inconcluso (alguno de los checks falló).';
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
        errorCount: v.errorCount,
        nextEligibleAt: v.nextEligibleAt,
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
