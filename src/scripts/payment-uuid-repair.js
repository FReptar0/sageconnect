/**
 * Payment UUID Repair & Upload Script
 *
 * Repairs missing UUIDs (FOLIOCFD) in APIBHO for PY payments that are stuck failing,
 * then uploads repaired payments to the portal.
 *
 * Usage:
 *   node src/scripts/payment-uuid-repair.js scan
 *   node src/scripts/payment-uuid-repair.js repair                   # dry-run, batch of 50
 *   node src/scripts/payment-uuid-repair.js repair --apply            # actually write UUIDs
 *   node src/scripts/payment-uuid-repair.js repair --apply --batch=100
 *   node src/scripts/payment-uuid-repair.js repair --apply --py PY0061652
 *   node src/scripts/payment-uuid-repair.js upload                    # dry-run
 *   node src/scripts/payment-uuid-repair.js upload --apply            # actually POST
 *   node src/scripts/payment-uuid-repair.js upload --apply --batch=20
 *   node src/scripts/payment-uuid-repair.js upload --apply --py PY0061652
 *
 * Common flags:
 *   --index=N        Tenant index (default: 0)
 *   --batch=N        Batch size (default: 50 for repair, 20 for upload)
 */

const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { getOneMonthAgoString, getCurrentDateString } = require('../utils/TimezoneHelper');
const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

const LOG_FILE = 'PaymentUUIDRepair';
const STATE_FILE = path.join(__dirname, 'data', 'repair-state.json');

// --- Credentials ---
const credentials = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const { DATABASES, TENANT_ID, API_KEY, API_SECRET, URL } = credentials;

const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const databases = DATABASES.split(',');

// --- CLI parsing ---
function parseArgs() {
    const args = process.argv.slice(2);
    const mode = args[0]; // scan | repair | upload
    let apply = false;
    let batchSize = null;
    let pyFilter = null;
    let tenantIndex = 0;

    for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (a === '--apply') {
            apply = true;
        } else if (a.startsWith('--batch=')) {
            batchSize = parseInt(a.split('=')[1], 10);
        } else if (a === '--py' && args[i + 1]) {
            pyFilter = args[i + 1];
            i++;
        } else if (a.startsWith('--index=')) {
            tenantIndex = parseInt(a.split('=')[1], 10);
        }
    }

    return { mode, apply, batchSize, pyFilter, tenantIndex };
}

// --- State file helpers ---
function loadState() {
    try {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        return JSON.parse(raw);
    } catch {
        return {
            lastScanDate: null,
            summary: { total: 0, scanned: 0, repaired: 0, uploaded: 0, failed: 0 },
            payments: {}
        };
    }
}

function saveState(state) {
    // Recompute summary from payments
    const payments = Object.values(state.payments);
    state.summary.total = payments.length;
    state.summary.scanned = payments.length;
    state.summary.repaired = payments.filter(p => ['uuid_repaired', 'uploaded', 'done'].includes(p.status)).length;
    state.summary.uploaded = payments.filter(p => ['uploaded', 'done'].includes(p.status)).length;
    state.summary.failed = payments.filter(p => ['repair_failed', 'upload_failed', 'no_match'].includes(p.status)).length;

    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ============================================================================
// MODE: SCAN
// ============================================================================
async function modeScan(DB) {
    console.log('\n=== MODE: SCAN ===');
    console.log('Finding all failing PY payments not in control table...\n');

    const state = loadState();

    // 1) Get all failing PYs (not in control table)
    const queryFailingPYs = `
    SELECT
        P.CNTBTCH    AS LotePago,
        P.CNTENTR    AS AsientoPago,
        RTRIM(P.DOCNBR)   AS external_id,
        RTRIM(P.IDVEND)   AS provider_external_id,
        P.AMTRMIT    AS total_amount,
        CASE BK.CURNSTMT WHEN 'MXP' THEN 'MXN' ELSE BK.CURNSTMT END AS bk_currency,
        ISNULL(
            (SELECT RTRIM([VALUE]) FROM APVENO WHERE OPTFIELD='PROVIDERID' AND VENDORID=P.IDVEND),
            ''
        ) AS PROVIDERID
    FROM APBTA B
    JOIN BKACCT BK ON B.IDBANK = BK.BANK
    JOIN APTCR P ON B.PAYMTYPE = P.BTCHTYPE AND B.CNTBTCH = P.CNTBTCH
    WHERE B.PAYMTYPE = 'PY'
        AND B.BATCHSTAT = 3
        AND P.ERRENTRY = 0
        AND P.RMITTYPE = 1
        AND P.DOCNBR NOT IN (
            SELECT NoPagoSage
            FROM fesa.dbo.fesaPagosFocaltec
            WHERE idCia = P.AUDTORG AND NoPagoSage = P.DOCNBR
        )
    ORDER BY P.DOCNBR
    `;

    let headers;
    try {
        const result = await runQuery(queryFailingPYs, DB);
        headers = result.recordset;
    } catch (err) {
        console.error(`[ERROR] Failed to query failing PYs: ${err.message}`);
        logGenerator(LOG_FILE, 'error', `SCAN failed: ${err.message}`);
        return;
    }

    console.log(`Found ${headers.length} PY payments not in control table.`);

    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const hdr of headers) {
        const docNbr = hdr.external_id.trim();

        // 2) Get invoices + UUID status for this PY
        const invoiceQuery = `
        SELECT DISTINCT
            RTRIM(DP.IDINVC)  AS invoice_external_id,
            H.CNTBTCH         AS inv_batch,
            H.CNTITEM         AS inv_entry,
            H.AMTGROSDST      AS invoice_amount,
            CASE H.CODECURN WHEN 'MXP' THEN 'MXN' ELSE H.CODECURN END AS invoice_currency,
            H.EXCHRATEHC      AS invoice_exchange_rate,
            DP.AMTPAYM        AS payment_amount,
            ISNULL(
                (SELECT RTRIM([VALUE])
                 FROM APIBHO
                 WHERE CNTBTCH = H.CNTBTCH
                   AND CNTITEM = H.CNTITEM
                   AND OPTFIELD = 'FOLIOCFD'
                ),
                ''
            ) AS UUID_APIBHO,
            (SELECT COUNT(*)
             FROM APIBHO
             WHERE CNTBTCH = H.CNTBTCH
               AND CNTITEM = H.CNTITEM
               AND OPTFIELD = 'FOLIOCFD'
            ) AS FOLIOCFD_ROW_EXISTS
        FROM APTCP DP
        JOIN APTCR R ON R.CNTBTCH = DP.CNTBTCH AND R.CNTENTR = DP.CNTRMIT
        JOIN APIBH H ON DP.IDVEND = H.IDVEND
                AND DP.IDINVC = H.IDINVC
                AND H.ERRENTRY = 0
        JOIN APIBC C ON H.CNTBTCH = C.CNTBTCH
                AND C.BTCHSTTS = 3
        WHERE DP.BATCHTYPE = 'PY'
            AND DP.CNTBTCH   = ${hdr.LotePago}
            AND DP.CNTRMIT   = ${hdr.AsientoPago}
            AND DP.DOCTYPE   = 1
        `;

        let invoices;
        try {
            const invResult = await runQuery(invoiceQuery, DB);
            invoices = invResult.recordset;
        } catch (err) {
            console.error(`  [ERROR] Failed to query invoices for ${docNbr}: ${err.message}`);
            continue;
        }

        // Check if at least one invoice has missing UUID
        const hasMissingUUID = invoices.some(inv =>
            !inv.UUID_APIBHO || inv.UUID_APIBHO.trim() === ''
        );

        if (!hasMissingUUID) {
            // If already tracked and was pending, update to reflect UUIDs are now set
            if (state.payments[docNbr] && state.payments[docNbr].status === 'pending') {
                state.payments[docNbr].status = 'uuid_repaired';
                state.payments[docNbr].repairDate = new Date().toISOString();
                updatedCount++;
            }
            continue;
        }

        // If already tracked with a non-pending status, don't overwrite
        if (state.payments[docNbr] && state.payments[docNbr].status !== 'pending') {
            skippedCount++;
            continue;
        }

        // Add or update as pending
        const isNew = !state.payments[docNbr];
        state.payments[docNbr] = {
            vendor: hdr.provider_external_id,
            providerExternalId: hdr.PROVIDERID || '',
            status: 'pending',
            invoices: invoices.map(inv => ({
                idinvc: inv.invoice_external_id,
                invBatch: inv.inv_batch,
                invEntry: inv.inv_entry,
                amount: inv.invoice_amount,
                currency: inv.invoice_currency,
                exchangeRate: inv.invoice_exchange_rate,
                paymentAmount: inv.payment_amount,
                uuidStatus: (!inv.UUID_APIBHO || inv.UUID_APIBHO.trim() === '')
                    ? (inv.FOLIOCFD_ROW_EXISTS === 0 ? 'no_row' : 'empty')
                    : 'present',
                currentUuid: inv.UUID_APIBHO || '',
                matchedUuid: null,
                matchScore: null,
                matchConfidence: null,
                matchDetails: []
            })),
            repairDate: null,
            uploadDate: null,
            uploadResult: null,
            portalPaymentId: null,
            error: null
        };

        if (isNew) newCount++;

        if (newCount % 100 === 0 && newCount > 0) {
            process.stdout.write(`  Scanned ${newCount} new payments...\r`);
        }
    }

    state.lastScanDate = new Date().toISOString();
    saveState(state);

    const pending = Object.values(state.payments).filter(p => p.status === 'pending').length;

    console.log(`\n--- SCAN COMPLETE ---`);
    console.log(`  Total PYs not in control table: ${headers.length}`);
    console.log(`  New payments added:              ${newCount}`);
    console.log(`  Updated (UUIDs now present):     ${updatedCount}`);
    console.log(`  Skipped (already processed):     ${skippedCount}`);
    console.log(`  Total pending in state file:     ${pending}`);
    console.log(`  State file: ${STATE_FILE}`);
    logGenerator(LOG_FILE, 'info', `SCAN complete: ${headers.length} found, ${newCount} new, ${pending} pending`);
}

// ============================================================================
// MODE: REPAIR
// ============================================================================
async function modeRepair(DB, tenantIndex, apply, batchSize, pyFilter) {
    const defaultBatch = 50;
    const batch = batchSize || defaultBatch;

    console.log(`\n=== MODE: REPAIR ${apply ? '(APPLY)' : '(DRY-RUN)'} ===`);
    console.log(`Batch size: ${batch}\n`);

    const state = loadState();

    // Filter payments to process
    let toProcess;
    if (pyFilter) {
        if (!state.payments[pyFilter]) {
            console.error(`[ERROR] Payment ${pyFilter} not found in state file. Run scan first.`);
            return;
        }
        toProcess = [[pyFilter, state.payments[pyFilter]]];
    } else {
        toProcess = Object.entries(state.payments)
            .filter(([, p]) => p.status === 'pending')
            .slice(0, batch);
    }

    if (toProcess.length === 0) {
        console.log('No pending payments to repair. Run scan first or check state file.');
        return;
    }

    console.log(`Processing ${toProcess.length} payments...\n`);

    // Fetch portal CFDIs (INVOICE type) grouped by provider_id
    console.log('[STEP 1] Fetching portal CFDIs (INVOICE)...');
    let portalCfdis = [];
    try {
        const dateFrom = getOneMonthAgoString();
        const dateUntil = getCurrentDateString();
        const cfdiUrl = `${URL}/api/1.0/extern/tenants/${tenantIds[tenantIndex]}/cfdis`
            + `?from=${dateFrom}-01&to=${dateUntil}`
            + `&documentTypes=CFDI`
            + `&offset=0&pageSize=0`
            + `&cfdiType=INVOICE`;

        const resp = await axios.get(cfdiUrl, {
            headers: {
                'PDPTenantKey': apiKeys[tenantIndex],
                'PDPTenantSecret': apiSecrets[tenantIndex]
            }
        });

        portalCfdis = resp.data.items || [];
        console.log(`  Fetched ${portalCfdis.length} INVOICE CFDIs from portal.`);
    } catch (err) {
        console.error(`[ERROR] Failed to fetch portal CFDIs: ${err.message}`);
        logGenerator(LOG_FILE, 'error', `REPAIR: Failed to fetch portal CFDIs: ${err.message}`);
        return;
    }

    // Group CFDIs by provider_id for fast lookup
    const cfdisByProvider = {};
    for (const cfdi of portalCfdis) {
        const providerId = cfdi.metadata?.provider_id;
        if (!providerId) continue;
        if (!cfdisByProvider[providerId]) cfdisByProvider[providerId] = [];
        cfdisByProvider[providerId].push(cfdi);
    }

    // Discover APIBHO schema for INSERT (only if --apply)
    let apibhoSchema = null;
    if (apply) {
        console.log('[STEP 2] Discovering APIBHO schema...');
        try {
            const schemaResult = await runQuery(
                `SELECT TOP 1 * FROM APIBHO WHERE OPTFIELD = 'FOLIOCFD'`,
                DB
            );
            if (schemaResult.recordset.length > 0) {
                apibhoSchema = schemaResult.recordset[0];
                console.log('  APIBHO schema discovered successfully.');
            } else {
                console.log('  [WARN] No FOLIOCFD rows found in APIBHO. Will use default schema for INSERTs.');
            }
        } catch (err) {
            console.error(`  [ERROR] Failed to discover APIBHO schema: ${err.message}`);
            logGenerator(LOG_FILE, 'error', `REPAIR: APIBHO schema discovery failed: ${err.message}`);
        }
    }

    // Process each payment
    let repairedCount = 0;
    let noMatchCount = 0;
    let errorCount = 0;

    for (const [docNbr, payment] of toProcess) {
        console.log(`\n--- ${docNbr} (vendor: ${payment.vendor}, PROVIDERID: ${payment.providerExternalId || 'EMPTY'}) ---`);

        if (!payment.providerExternalId) {
            console.log(`  [SKIP] No PROVIDERID for vendor ${payment.vendor}`);
            payment.status = 'repair_failed';
            payment.error = 'No PROVIDERID for vendor';
            errorCount++;
            continue;
        }

        // Get portal CFDI candidates for this provider
        const candidates = cfdisByProvider[payment.providerExternalId] || [];
        if (candidates.length === 0) {
            console.log(`  [WARN] No portal CFDIs found for provider ${payment.providerExternalId}`);
        }

        let allMatched = true;

        for (const inv of payment.invoices) {
            if (inv.uuidStatus === 'present' && inv.currentUuid) {
                console.log(`  Invoice ${inv.idinvc}: UUID already present (${inv.currentUuid})`);
                continue;
            }

            // Try to match this invoice against portal CFDIs
            const matchResult = await matchInvoiceToCfdi(inv, candidates, DB, tenantIndex);

            inv.matchDetails = matchResult.details;
            inv.matchScore = matchResult.bestScore;
            inv.matchConfidence = matchResult.confidence;
            inv.matchedUuid = matchResult.uuid;

            if (matchResult.confidence === 'high' || matchResult.confidence === 'medium') {
                console.log(`  Invoice ${inv.idinvc}: MATCH [${matchResult.confidence}] score=${matchResult.bestScore} uuid=${matchResult.uuid}`);

                if (apply) {
                    const writeOk = await writeUuidToApibho(DB, inv, matchResult.uuid, apibhoSchema);
                    if (writeOk) {
                        inv.uuidStatus = 'repaired';
                        inv.currentUuid = matchResult.uuid;
                        console.log(`    -> UUID written to APIBHO`);
                    } else {
                        inv.uuidStatus = 'write_failed';
                        console.log(`    -> FAILED to write UUID to APIBHO`);
                    }
                } else {
                    console.log(`    -> DRY-RUN: Would write UUID to APIBHO`);
                }
            } else {
                console.log(`  Invoice ${inv.idinvc}: NO MATCH (best score=${matchResult.bestScore || 0})`);
                if (matchResult.details.length > 0) {
                    console.log(`    Top candidates:`);
                    matchResult.details.slice(0, 3).forEach(d => {
                        console.log(`      score=${d.score} uuid=${d.uuid} folio=${d.folio || 'N/A'} total=${d.total || 'N/A'}`);
                    });
                }
                allMatched = false;
            }
        }

        // Update payment status
        const allInvoicesFixed = payment.invoices.every(inv =>
            inv.uuidStatus === 'present' || inv.uuidStatus === 'repaired'
        );
        const anyWriteFailed = payment.invoices.some(inv => inv.uuidStatus === 'write_failed');

        if (allInvoicesFixed && apply) {
            payment.status = 'uuid_repaired';
            payment.repairDate = new Date().toISOString();
            repairedCount++;
        } else if (anyWriteFailed) {
            payment.status = 'repair_failed';
            payment.error = 'One or more APIBHO writes failed';
            errorCount++;
        } else if (!allMatched && !allInvoicesFixed) {
            // Some invoices have no match
            const hasSomeMatch = payment.invoices.some(inv => inv.matchedUuid);
            if (!hasSomeMatch) {
                payment.status = 'no_match';
                noMatchCount++;
            }
            // If partial match, keep as pending for now
        } else if (!apply) {
            // Dry-run: keep as pending but show results
            repairedCount++;
        }
    }

    saveState(state);

    const remaining = Object.values(state.payments).filter(p => p.status === 'pending').length;
    console.log(`\n--- REPAIR ${apply ? 'APPLY' : 'DRY-RUN'} COMPLETE ---`);
    console.log(`  Processed:  ${toProcess.length}`);
    console.log(`  Repaired:   ${repairedCount}`);
    console.log(`  No match:   ${noMatchCount}`);
    console.log(`  Errors:     ${errorCount}`);
    console.log(`  Remaining:  ${remaining} pending`);
    if (remaining > 0) {
        console.log(`  Run again for next batch.`);
    }
    logGenerator(LOG_FILE, 'info', `REPAIR ${apply ? 'APPLY' : 'DRY-RUN'}: ${repairedCount} repaired, ${noMatchCount} no_match, ${errorCount} errors, ${remaining} remaining`);
}

// --- Matching Logic ---
async function matchInvoiceToCfdi(inv, candidates, DB, tenantIndex) {
    const result = { uuid: null, bestScore: 0, confidence: null, details: [] };

    for (const cfdi of candidates) {
        let score = 0;
        const detail = {
            cfdiId: cfdi.id,
            uuid: cfdi.cfdi?.timbre?.uuid || null,
            folio: cfdi.cfdi?.folio || null,
            serie: cfdi.cfdi?.serie || null,
            total: cfdi.cfdi?.total || null,
            currency: cfdi.cfdi?.moneda || null,
            score: 0
        };

        if (!detail.uuid) continue;

        // Check if this UUID is already in APIBHO (skip if so)
        try {
            const checkResult = await runQuery(
                `SELECT COUNT(*) AS NREG FROM APIBH H
                 JOIN APIBHO O ON H.CNTBTCH = O.CNTBTCH AND H.CNTITEM = O.CNTITEM
                 WHERE H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND O.[VALUE] = '${detail.uuid}'`,
                DB
            );
            if (checkResult.recordset[0].NREG > 0) continue; // Already in APIBHO
        } catch {
            // If check fails, still try to match
        }

        // Folio matching
        const folio = (detail.folio || '').toString().trim();
        const serie = (detail.serie || '').toString().trim();
        const idinvc = inv.idinvc.trim();

        if (folio && folio === idinvc) {
            score += 50;
        } else if (serie && folio && `${serie}${folio}` === idinvc) {
            score += 45;
        } else if (folio && idinvc.includes(folio)) {
            score += 20;
        } else if (folio && folio.includes(idinvc)) {
            score += 20;
        }

        // Amount matching
        const cfdiTotal = parseFloat(detail.total) || 0;
        const invAmount = parseFloat(inv.amount) || 0;
        if (cfdiTotal > 0 && invAmount > 0) {
            const diff = Math.abs(cfdiTotal - invAmount);
            if (diff === 0) {
                score += 30;
            } else if (diff < 1) {
                score += 15;
            }
        }

        // Currency matching
        const cfdiCurrency = (detail.currency || '').replace('MXP', 'MXN');
        if (cfdiCurrency && cfdiCurrency === inv.currency) {
            score += 20;
        }

        detail.score = score;
        result.details.push(detail);
    }

    // Sort by score descending
    result.details.sort((a, b) => b.score - a.score);

    if (result.details.length > 0) {
        const best = result.details[0];
        result.bestScore = best.score;
        result.uuid = best.uuid;

        if (best.score >= 80) {
            result.confidence = 'high';
        } else if (best.score >= 50) {
            result.confidence = 'medium';
        } else {
            result.confidence = 'low';
            result.uuid = null; // Don't auto-apply low confidence
        }
    }

    return result;
}

// --- Write UUID to APIBHO ---
async function writeUuidToApibho(DB, inv, uuid, schemaRow) {
    try {
        if (inv.uuidStatus === 'no_row') {
            // Need to INSERT
            const audtdate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            // Use schema from discovered row or defaults
            const type = schemaRow ? schemaRow.TYPE : 1;
            const length = schemaRow ? schemaRow.LENGTH : 60;
            const decimals = schemaRow ? schemaRow.DECIMALS : 0;
            const allownull = schemaRow ? schemaRow.ALLOWNULL : 0;
            const validate = schemaRow ? schemaRow.VALIDATE : 0;
            const audtuser = schemaRow ? `'${schemaRow.AUDTUSER}'` : `'ADMIN'`;
            const audtorg = schemaRow ? `'${schemaRow.AUDTORG}'` : `''`;

            const insertSql = `
                INSERT INTO APIBHO
                    (CNTBTCH, CNTITEM, OPTFIELD, AUDTDATE, AUDTTIME, AUDTUSER, AUDTORG,
                     [VALUE], [TYPE], [LENGTH], DECIMALS, ALLOWNULL, VALIDATE, SWSET)
                VALUES
                    (${inv.invBatch}, ${inv.invEntry}, 'FOLIOCFD',
                     ${audtdate}, 0, ${audtuser}, ${audtorg},
                     '${uuid}', ${type}, ${length}, ${decimals}, ${allownull}, ${validate}, 1)
            `;

            const result = await runQuery(insertSql, DB);
            return result.rowsAffected[0] > 0;
        } else {
            // Row exists but empty -> UPDATE
            const updateSql = `
                UPDATE APIBHO
                SET [VALUE] = '${uuid}'
                WHERE CNTBTCH = ${inv.invBatch}
                  AND CNTITEM = ${inv.invEntry}
                  AND OPTFIELD = 'FOLIOCFD'
            `;

            const result = await runQuery(updateSql, DB);
            return result.rowsAffected[0] > 0;
        }
    } catch (err) {
        console.error(`    [ERROR] APIBHO write failed for ${inv.idinvc}: ${err.message}`);
        logGenerator(LOG_FILE, 'error', `APIBHO write failed for ${inv.idinvc}: ${err.message}`);
        return false;
    }
}

// ============================================================================
// MODE: UPLOAD
// ============================================================================
async function modeUpload(DB, tenantIndex, apply, batchSize, pyFilter) {
    const defaultBatch = 20;
    const batch = batchSize || defaultBatch;

    console.log(`\n=== MODE: UPLOAD ${apply ? '(APPLY)' : '(DRY-RUN)'} ===`);
    console.log(`Batch size: ${batch}\n`);

    const state = loadState();

    // Filter payments to process
    let toProcess;
    if (pyFilter) {
        if (!state.payments[pyFilter]) {
            console.error(`[ERROR] Payment ${pyFilter} not found in state file.`);
            return;
        }
        toProcess = [[pyFilter, state.payments[pyFilter]]];
    } else {
        toProcess = Object.entries(state.payments)
            .filter(([, p]) => p.status === 'uuid_repaired')
            .slice(0, batch);
    }

    if (toProcess.length === 0) {
        console.log('No repaired payments ready for upload. Run repair --apply first.');
        return;
    }

    console.log(`Processing ${toProcess.length} payments for upload...\n`);

    let uploadedCount = 0;
    let failedCount = 0;

    for (const [docNbr, payment] of toProcess) {
        console.log(`\n--- Uploading ${docNbr} ---`);

        // Re-fetch payment header + invoices from DB (to get current UUID values)
        const headerQuery = `
        SELECT
            P.CNTBTCH    AS LotePago,
            P.CNTENTR    AS AsientoPago,
            RTRIM(BK.ADDR1)   AS bank_account_id,
            B.IDBANK,
            P.DATEBUS    AS FechaAsentamiento,
            RTRIM(P.DOCNBR)   AS external_id,
            P.TEXTRMIT   AS comments,
            P.TXTRMITREF AS reference,
            CASE BK.CURNSTMT WHEN 'MXP' THEN 'MXN' ELSE BK.CURNSTMT END AS bk_currency,
            P.DATERMIT   AS payment_date,
            RTRIM(P.IDVEND)   AS provider_external_id,
            P.AMTRMIT    AS total_amount,
            'TRANSFER'   AS operation_type,
            P.RATEEXCHHC AS TipoCambioPago,
            ISNULL(
                (SELECT RTRIM([VALUE]) FROM APVENO WHERE OPTFIELD='PROVIDERID' AND VENDORID=P.IDVEND),
                ''
            ) AS PROVIDERID
        FROM APBTA B
        JOIN BKACCT BK ON B.IDBANK = BK.BANK
        JOIN APTCR P ON B.PAYMTYPE = P.BTCHTYPE AND B.CNTBTCH = P.CNTBTCH
        WHERE B.PAYMTYPE = 'PY'
            AND P.ERRENTRY = 0
            AND P.RMITTYPE = 1
            AND RTRIM(P.DOCNBR) = '${docNbr}'
        `;

        let hdr;
        try {
            const result = await runQuery(headerQuery, DB);
            if (result.recordset.length === 0) {
                console.error(`  [ERROR] Payment ${docNbr} not found in DB`);
                payment.status = 'upload_failed';
                payment.error = 'Payment not found in DB';
                failedCount++;
                continue;
            }
            hdr = result.recordset[0];
        } catch (err) {
            console.error(`  [ERROR] Header query failed: ${err.message}`);
            payment.status = 'upload_failed';
            payment.error = `Header query failed: ${err.message}`;
            failedCount++;
            continue;
        }

        // Fetch invoices with current UUIDs
        const invoiceQuery = `
        SELECT DISTINCT
            DP.CNTBTCH        AS LotePago,
            DP.CNTRMIT        AS AsientoPago,
            RTRIM(DP.IDINVC)  AS invoice_external_id,
            H.AMTGROSDST      AS invoice_amount,
            CASE H.CODECURN WHEN 'MXP' THEN 'MXN' ELSE H.CODECURN END AS invoice_currency,
            H.EXCHRATEHC      AS invoice_exchange_rate,
            DP.AMTPAYM        AS payment_amount,
            ISNULL(
                (SELECT SWPAID FROM APOBL WHERE IDINVC = DP.IDINVC AND IDVEND = DP.IDVEND),
                0
            ) AS FULL_PAID,
            ISNULL(
                (SELECT RTRIM([VALUE])
                 FROM APIBHO
                 WHERE CNTBTCH = H.CNTBTCH
                   AND CNTITEM = H.CNTITEM
                   AND OPTFIELD = 'FOLIOCFD'
                ),
                ''
            ) AS UUID,
            R.RATEEXCHHC AS exchange_rate
        FROM APTCP DP
        JOIN APTCR R ON R.CNTBTCH = DP.CNTBTCH AND R.CNTENTR = DP.CNTRMIT
        JOIN APIBH H ON DP.IDVEND = H.IDVEND
                AND DP.IDINVC = H.IDINVC
                AND H.ERRENTRY = 0
        JOIN APIBC C ON H.CNTBTCH = C.CNTBTCH
                AND C.BTCHSTTS = 3
        WHERE DP.BATCHTYPE = 'PY'
            AND DP.CNTBTCH   = ${hdr.LotePago}
            AND DP.CNTRMIT   = ${hdr.AsientoPago}
            AND DP.DOCTYPE   = 1
        `;

        let invoices;
        try {
            const invResult = await runQuery(invoiceQuery, DB);
            invoices = invResult.recordset;
        } catch (err) {
            console.error(`  [ERROR] Invoice query failed: ${err.message}`);
            payment.status = 'upload_failed';
            payment.error = `Invoice query failed: ${err.message}`;
            failedCount++;
            continue;
        }

        if (invoices.length === 0) {
            console.error(`  [ERROR] No invoices found for ${docNbr}`);
            payment.status = 'upload_failed';
            payment.error = 'No invoices found';
            failedCount++;
            continue;
        }

        // Verify all invoices have UUIDs
        const missingUuids = invoices.filter(inv => !inv.UUID || inv.UUID.trim() === '');
        if (missingUuids.length > 0) {
            console.error(`  [ERROR] ${missingUuids.length} invoice(s) still missing UUID. Cannot upload.`);
            missingUuids.forEach(inv => console.error(`    - ${inv.invoice_external_id}`));
            payment.status = 'upload_failed';
            payment.error = `${missingUuids.length} invoices still missing UUID`;
            failedCount++;
            continue;
        }

        // Build payload (matching PortalPaymentController / portal-payments-generator pattern)
        const cfdis = invoices.map(inv => {
            const sameCurrency = inv.invoice_currency === hdr.bk_currency;
            return {
                amount: inv.payment_amount,
                currency: inv.invoice_currency,
                exchange_rate: sameCurrency ? 1 : inv.invoice_exchange_rate,
                payment_amount: inv.payment_amount,
                payment_currency: hdr.bk_currency,
                uuid: inv.UUID.toUpperCase()
            };
        });

        const allFull = invoices.every(inv => inv.FULL_PAID === 1 || inv.FULL_PAID === '1');
        const payStatus = allFull ? 'PAID' : 'PARTIAL';

        const d = hdr.payment_date.toString();
        const payment_date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T10:00:00.000Z`;

        const payload = {
            bank_account_id: hdr.bank_account_id,
            cfdis,
            comments: hdr.comments,
            currency: hdr.bk_currency,
            external_id: hdr.external_id,
            ignore_amounts: false,
            open: false,
            operation_type: hdr.operation_type,
            payment_date,
            provider_external_id: hdr.provider_external_id,
            reference: hdr.reference,
            total_amount: hdr.total_amount
        };

        if (!apply) {
            console.log(`  [DRY-RUN] Payload for ${docNbr} (status: ${payStatus}):`);
            console.log(JSON.stringify(payload, null, 2));
            continue;
        }

        // POST to portal
        const endpoint = `${URL}/api/1.0/extern/tenants/${tenantIds[tenantIndex]}/payments`;
        console.log(`  [POST] ${endpoint}`);

        try {
            const resp = await axios.post(endpoint, payload, {
                headers: {
                    'PDPTenantKey': apiKeys[tenantIndex],
                    'PDPTenantSecret': apiSecrets[tenantIndex],
                    'Content-Type': 'application/json'
                }
            });

            if (resp.status === 200) {
                const idPortal = resp.data?.id || null;
                console.log(`  [OK] Payment ${docNbr} uploaded successfully (200)`);
                if (idPortal) console.log(`    Portal ID: ${idPortal}`);

                logGenerator(LOG_FILE, 'info',
                    `UPLOAD: ${docNbr} sent OK. Tenant: ${tenantIds[tenantIndex]}, Portal ID: ${idPortal || 'N/A'}`
                );

                // Insert into control table
                const insertSql = `
                    INSERT INTO fesa.dbo.fesaPagosFocaltec
                        (idCia, NoPagoSage, status, idFocaltec)
                    VALUES
                        ('${DB}',
                         '${hdr.external_id}',
                         '${payStatus}',
                         ${idPortal ? `'${idPortal}'` : 'NULL'}
                        )
                `;

                const ctResult = await runQuery(insertSql).catch(err => {
                    logGenerator(LOG_FILE, 'error', `Control table insert failed for ${docNbr}: ${err.message}`);
                    console.error(`  [ERROR] Control table insert failed: ${err.message}`);
                    return { rowsAffected: [0] };
                });

                if (ctResult.rowsAffected[0]) {
                    console.log(`  [OK] Control table updated for ${docNbr}`);
                } else {
                    console.warn(`  [WARN] Control table insert returned 0 rows for ${docNbr}`);
                }

                payment.status = 'uploaded';
                payment.uploadDate = new Date().toISOString();
                payment.uploadResult = 'success';
                payment.portalPaymentId = idPortal;
                uploadedCount++;
            } else {
                console.error(`  [ERROR] Upload failed: ${resp.status}`);
                console.error('    Response:', resp.data);
                payment.status = 'upload_failed';
                payment.error = `HTTP ${resp.status}: ${JSON.stringify(resp.data)}`;
                failedCount++;
                logGenerator(LOG_FILE, 'error',
                    `UPLOAD failed for ${docNbr}: ${resp.status} ${JSON.stringify(resp.data)}`
                );
            }
        } catch (err) {
            const status = err.response?.status;
            const data = err.response?.data;
            console.error(`  [ERROR] POST failed: ${err.message}`);
            if (status) console.error(`    Status: ${status}`);
            if (data) console.error(`    Data:`, data);

            payment.status = 'upload_failed';
            payment.error = `${status || 'NETWORK'}: ${err.message}`;
            if (data) payment.error += ` | ${JSON.stringify(data)}`;
            failedCount++;
            logGenerator(LOG_FILE, 'error',
                `UPLOAD POST failed for ${docNbr}: ${err.message}`
            );
        }
    }

    saveState(state);

    const remainingRepaired = Object.values(state.payments).filter(p => p.status === 'uuid_repaired').length;
    console.log(`\n--- UPLOAD ${apply ? 'APPLY' : 'DRY-RUN'} COMPLETE ---`);
    console.log(`  Processed:  ${toProcess.length}`);
    console.log(`  Uploaded:   ${uploadedCount}`);
    console.log(`  Failed:     ${failedCount}`);
    console.log(`  Remaining:  ${remainingRepaired} repaired & ready`);
    if (remainingRepaired > 0) {
        console.log(`  Run again for next batch.`);
    }
    logGenerator(LOG_FILE, 'info', `UPLOAD ${apply ? 'APPLY' : 'DRY-RUN'}: ${uploadedCount} uploaded, ${failedCount} failed, ${remainingRepaired} remaining`);
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
    const { mode, apply, batchSize, pyFilter, tenantIndex } = parseArgs();
    const DB = databases[tenantIndex];

    if (!mode || !['scan', 'repair', 'upload'].includes(mode)) {
        console.log('Payment UUID Repair & Upload Script');
        console.log('');
        console.log('Usage:');
        console.log('  node src/scripts/payment-uuid-repair.js scan');
        console.log('  node src/scripts/payment-uuid-repair.js repair                   # dry-run');
        console.log('  node src/scripts/payment-uuid-repair.js repair --apply            # write UUIDs');
        console.log('  node src/scripts/payment-uuid-repair.js repair --apply --batch=100');
        console.log('  node src/scripts/payment-uuid-repair.js repair --apply --py PY0061652');
        console.log('  node src/scripts/payment-uuid-repair.js upload                    # dry-run');
        console.log('  node src/scripts/payment-uuid-repair.js upload --apply            # POST to portal');
        console.log('  node src/scripts/payment-uuid-repair.js upload --apply --batch=20');
        console.log('  node src/scripts/payment-uuid-repair.js upload --apply --py PY0061652');
        console.log('');
        console.log('Flags:');
        console.log('  --index=N   Tenant index (default: 0)');
        console.log('  --batch=N   Batch size (default: 50 for repair, 20 for upload)');
        process.exit(1);
    }

    console.log(`Tenant index: ${tenantIndex}, DB: ${DB}`);

    switch (mode) {
        case 'scan':
            await modeScan(DB);
            break;
        case 'repair':
            await modeRepair(DB, tenantIndex, apply, batchSize, pyFilter);
            break;
        case 'upload':
            await modeUpload(DB, tenantIndex, apply, batchSize, pyFilter);
            break;
    }

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    logGenerator(LOG_FILE, 'error', `Fatal error: ${err.message}`);
    process.exit(1);
});
