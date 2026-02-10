/**
 * Payment UUID Repair & Upload Script
 *
 * Repairs missing UUIDs (FOLIOCFD) in APIBHO for PY payments that are stuck failing,
 * then uploads repaired payments to the portal.
 *
 * SCAN starts from the portal (PENDING_TO_PAY invoices) and traces back to Sage PY
 * payments, so only payments the portal actually expects are tracked.
 *
 * Usage:
 *   node src/scripts/payment-uuid-repair.js scan                      # portal-first scan
 *   node src/scripts/payment-uuid-repair.js scan --months=6           # look back 6 months
 *   node src/scripts/payment-uuid-repair.js repair                    # dry-run, batch of 50
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
 *   --months=N       How many months back to fetch portal CFDIs (default: 12, scan only)
 */

const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { getCurrentDateString } = require('../utils/TimezoneHelper');
const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

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
    let months = 12;

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
        } else if (a.startsWith('--months=')) {
            months = parseInt(a.split('=')[1], 10);
        }
    }

    return { mode, apply, batchSize, pyFilter, tenantIndex, months };
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
    const payments = Object.values(state.payments);
    state.summary.total = payments.length;
    state.summary.scanned = payments.length;
    state.summary.repaired = payments.filter(p => ['uuid_repaired', 'uploaded', 'done'].includes(p.status)).length;
    state.summary.uploaded = payments.filter(p => ['uploaded', 'done'].includes(p.status)).length;
    state.summary.failed = payments.filter(p => ['repair_failed', 'upload_failed', 'no_match'].includes(p.status)).length;

    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// --- Matching helper (portal CFDI → Sage invoice) ---
function scoreMatch(portalCfdi, sageInvoice) {
    let score = 0;

    const folio = (portalCfdi.cfdi?.folio || '').toString().trim();
    const serie = (portalCfdi.cfdi?.serie || '').toString().trim();
    const idinvc = sageInvoice.IDINVC.trim();

    // Folio matching
    if (folio && folio === idinvc) {
        score += 50;
    } else if (serie && folio && `${serie}${folio}` === idinvc) {
        score += 45;
    } else if (folio && (idinvc.includes(folio) || folio.includes(idinvc))) {
        score += 20;
    }

    // Amount matching
    const cfdiTotal = parseFloat(portalCfdi.cfdi?.total) || 0;
    const invAmount = parseFloat(sageInvoice.AMTGROSDST) || 0;
    if (cfdiTotal > 0 && invAmount > 0) {
        const diff = Math.abs(cfdiTotal - invAmount);
        if (diff === 0) score += 30;
        else if (diff < 1) score += 15;
    }

    // Currency matching
    const cfdiCurrency = (portalCfdi.cfdi?.moneda || '').replace('MXP', 'MXN');
    const invCurrency = (sageInvoice.CODECURN || '').replace('MXP', 'MXN');
    if (cfdiCurrency && cfdiCurrency === invCurrency) {
        score += 20;
    }

    return score;
}

function getConfidence(score) {
    if (score >= 80) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
}

// ============================================================================
// MODE: SCAN (Portal-first)
// ============================================================================
async function modeScan(DB, tenantIndex, months) {
    console.log('\n=== MODE: SCAN (Portal-first) ===');
    console.log(`Looking back ${months} months for PENDING_TO_PAY invoices...\n`);

    const state = loadState();

    // --- STEP 1: Fetch PENDING_TO_PAY invoices from portal ---
    console.log('[STEP 1] Fetching PENDING_TO_PAY invoices from portal...');

    const dateUntil = getCurrentDateString();
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - months);
    const dateFrom = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`;

    let portalCfdis = [];
    try {
        const cfdiUrl = `${URL}/api/1.0/extern/tenants/${tenantIds[tenantIndex]}/cfdis`
            + `?from=${dateFrom}-01&to=${dateUntil}`
            + `&documentTypes=CFDI&offset=0&pageSize=0`
            + `&cfdiType=INVOICE&stage=PENDING_TO_PAY`;

        const resp = await axios.get(cfdiUrl, {
            headers: {
                'PDPTenantKey': apiKeys[tenantIndex],
                'PDPTenantSecret': apiSecrets[tenantIndex]
            }
        });

        portalCfdis = resp.data.items || [];
        console.log(`  Found ${portalCfdis.length} PENDING_TO_PAY invoices in portal.`);
    } catch (err) {
        console.error(`[ERROR] Failed to fetch portal CFDIs: ${err.message}`);
        logGenerator(LOG_FILE, 'error', `SCAN: Failed to fetch portal CFDIs: ${err.message}`);
        return;
    }

    if (portalCfdis.length === 0) {
        console.log('  No pending invoices in portal. Nothing to do.');
        state.lastScanDate = new Date().toISOString();
        saveState(state);
        return;
    }

    // --- STEP 2: Get all known UUIDs from APIBHO (batch) ---
    console.log('[STEP 2] Fetching known UUIDs from APIBHO...');
    let knownUuids = new Set();
    try {
        const result = await runQuery(`
            SELECT RTRIM(O.[VALUE]) AS UUID
            FROM APIBHO O
            JOIN APIBH H ON O.CNTBTCH = H.CNTBTCH AND O.CNTITEM = H.CNTITEM
            WHERE O.OPTFIELD = 'FOLIOCFD' AND H.ERRENTRY = 0 AND O.[VALUE] != ''
        `, DB);
        knownUuids = new Set(result.recordset.map(r => r.UUID.toUpperCase()));
        console.log(`  ${knownUuids.size} UUIDs already known in APIBHO.`);
    } catch (err) {
        console.error(`  [WARN] Failed to fetch known UUIDs: ${err.message}. Proceeding without filter.`);
    }

    // --- STEP 3: Split portal CFDIs into two groups ---
    //   - needsRepair: UUID NOT in APIBHO (needs UUID written + payment uploaded)
    //   - uuidPresent: UUID already in APIBHO (just needs payment uploaded)
    const needsRepairByProvider = {};
    const uuidPresentByProvider = {};
    let alreadyKnownCount = 0;
    const allProviderIds = new Set();

    for (const cfdi of portalCfdis) {
        const uuid = cfdi.cfdi?.timbre?.uuid;
        const providerId = cfdi.metadata?.provider_id;
        if (!uuid || !providerId) continue;
        allProviderIds.add(providerId);

        if (knownUuids.has(uuid.toUpperCase())) {
            alreadyKnownCount++;
            if (!uuidPresentByProvider[providerId]) uuidPresentByProvider[providerId] = [];
            uuidPresentByProvider[providerId].push(cfdi);
        } else {
            if (!needsRepairByProvider[providerId]) needsRepairByProvider[providerId] = [];
            needsRepairByProvider[providerId].push(cfdi);
        }
    }

    const repairProviderIds = Object.keys(needsRepairByProvider);
    const missingCount = repairProviderIds.reduce((sum, pid) => sum + needsRepairByProvider[pid].length, 0);
    console.log(`  ${alreadyKnownCount} portal CFDIs have UUID in APIBHO (may need payment upload).`);
    console.log(`  ${missingCount} portal CFDIs need UUID repair across ${repairProviderIds.length} providers.`);

    // --- STEP 4: Resolve ALL provider_ids → Sage vendor IDs ---
    console.log('[STEP 3] Resolving portal provider IDs to Sage vendor IDs...');
    const providerToVendor = {};
    for (const pid of allProviderIds) {
        try {
            const result = await runQuery(
                `SELECT RTRIM(VENDORID) AS VENDORID FROM APVENO WHERE OPTFIELD='PROVIDERID' AND RTRIM([VALUE])='${pid}'`,
                DB
            );
            if (result.recordset.length > 0) {
                providerToVendor[pid] = result.recordset[0].VENDORID;
            } else {
                console.log(`  [WARN] Provider ${pid} not found in Sage (no VENDORID match)`);
            }
        } catch (err) {
            console.error(`  [ERROR] Vendor lookup failed for provider ${pid}: ${err.message}`);
        }
    }
    console.log(`  Resolved ${Object.keys(providerToVendor).length} of ${allProviderIds.size} providers to Sage vendors.`);

    // --- STEP 5: Diagnostic dump of unmatched portal CFDIs (needsRepair) ---
    if (missingCount > 0) {
        console.log(`\n[STEP 4a] Diagnostic: ${missingCount} portal CFDIs missing from APIBHO:`);
        for (const [providerId, cfdis] of Object.entries(needsRepairByProvider)) {
            const vendorId = providerToVendor[providerId] || '(NOT RESOLVED)';
            for (const cfdi of cfdis) {
                const uuid = cfdi.cfdi?.timbre?.uuid || 'N/A';
                const folio = cfdi.cfdi?.folio || 'N/A';
                const serie = cfdi.cfdi?.serie || '';
                const total = cfdi.cfdi?.total || 'N/A';
                const currency = cfdi.cfdi?.moneda || 'N/A';
                const rfcEmisor = cfdi.cfdi?.emisor?.rfc || 'N/A';
                console.log(`  - UUID: ${uuid}`);
                console.log(`    Folio: ${serie ? serie + ' ' : ''}${folio} | Total: ${total} ${currency} | RFC Emisor: ${rfcEmisor}`);
                console.log(`    Provider ID: ${providerId} | Sage Vendor: ${vendorId}`);
            }
        }
    }

    // --- STEP 6: For needsRepair vendors, match portal CFDIs to Sage invoices ---
    console.log(`\n[STEP 4b] Matching portal CFDIs (missing UUID) to Sage invoices...`);

    let newCount = 0;
    let skippedCount = 0;
    let matchedCfdiCount = 0;

    for (const [providerId, vendorId] of Object.entries(providerToVendor)) {
        const portalCfdisForVendor = needsRepairByProvider[providerId] || [];
        if (portalCfdisForVendor.length === 0) continue;

        // Get all invoices for this vendor
        let sageInvoices;
        try {
            const result = await runQuery(`
                SELECT
                    RTRIM(H.IDINVC) AS IDINVC,
                    H.CNTBTCH,
                    H.CNTITEM,
                    H.AMTGROSDST,
                    CASE H.CODECURN WHEN 'MXP' THEN 'MXN' ELSE H.CODECURN END AS CODECURN,
                    H.EXCHRATEHC,
                    ISNULL(
                        (SELECT RTRIM([VALUE]) FROM APIBHO
                         WHERE CNTBTCH = H.CNTBTCH AND CNTITEM = H.CNTITEM AND OPTFIELD = 'FOLIOCFD'),
                        ''
                    ) AS UUID_APIBHO,
                    (SELECT COUNT(*) FROM APIBHO
                     WHERE CNTBTCH = H.CNTBTCH AND CNTITEM = H.CNTITEM AND OPTFIELD = 'FOLIOCFD'
                    ) AS FOLIOCFD_ROW_EXISTS
                FROM APIBH H
                JOIN APIBC C ON H.CNTBTCH = C.CNTBTCH AND C.BTCHSTTS = 3
                WHERE H.IDVEND = '${vendorId}'
                  AND H.ERRENTRY = 0
            `, DB);
            sageInvoices = result.recordset;
        } catch (err) {
            console.error(`  [ERROR] Failed to query Sage invoices for vendor ${vendorId}: ${err.message}`);
            continue;
        }

        const cfdiToInvoice = {};

        for (const portalCfdi of portalCfdisForVendor) {
            const uuid = portalCfdi.cfdi?.timbre?.uuid;
            let bestInv = null;
            let bestScore = 0;

            for (const sageInv of sageInvoices) {
                if (sageInv.UUID_APIBHO && sageInv.UUID_APIBHO.trim() !== '') continue;
                const score = scoreMatch(portalCfdi, sageInv);
                if (score > bestScore) {
                    bestScore = score;
                    bestInv = sageInv;
                }
            }

            if (bestInv && bestScore >= 50) {
                cfdiToInvoice[portalCfdi.id] = {
                    sageInvoice: bestInv,
                    score: bestScore,
                    confidence: getConfidence(bestScore),
                    uuid,
                    portalCfdiId: portalCfdi.id,
                    folio: portalCfdi.cfdi?.folio || '',
                    serie: portalCfdi.cfdi?.serie || '',
                    total: portalCfdi.cfdi?.total || 0
                };
                matchedCfdiCount++;
            } else {
                const folio = portalCfdi.cfdi?.folio || 'N/A';
                console.log(`  [NO MATCH] Portal folio=${folio} uuid=${uuid} bestScore=${bestScore} (vendor ${vendorId} has ${sageInvoices.filter(s => !s.UUID_APIBHO || !s.UUID_APIBHO.trim()).length} invoices without UUID)`);
            }
        }

        if (Object.keys(cfdiToInvoice).length === 0) continue;

        // Find PY payments that reference the matched Sage invoices
        const matchedIdinvcs = Object.values(cfdiToInvoice).map(m => m.sageInvoice.IDINVC);
        const pyPayments = await findPyPaymentsForInvoices(DB, vendorId, matchedIdinvcs);
        if (pyPayments.length === 0) continue;

        // Build state entries for these PY payments (needs repair)
        for (const py of pyPayments) {
            const result = await buildPaymentStateEntry(DB, py, providerId, vendorId, state, cfdiToInvoice, 'pending');
            if (result === 'new') newCount++;
            else if (result === 'skipped') skippedCount++;
        }
    }

    // --- STEP 7: For uuidPresent vendors, find PY payments not yet uploaded ---
    console.log(`\n[STEP 5] Finding PY payments with UUIDs present but never uploaded to portal...`);

    let uploadReadyCount = 0;

    for (const [providerId, vendorId] of Object.entries(providerToVendor)) {
        const presentCfdis = uuidPresentByProvider[providerId] || [];
        if (presentCfdis.length === 0) continue;

        // Get the UUIDs from portal that are already in APIBHO
        const portalUuids = presentCfdis.map(c => c.cfdi?.timbre?.uuid).filter(Boolean);
        if (portalUuids.length === 0) continue;

        // Find Sage invoices that have these UUIDs
        const uuidList = portalUuids.map(u => `'${u.toUpperCase()}'`).join(',');
        let matchedInvoices;
        try {
            const result = await runQuery(`
                SELECT DISTINCT RTRIM(H.IDINVC) AS IDINVC
                FROM APIBH H
                JOIN APIBC C ON H.CNTBTCH = C.CNTBTCH AND C.BTCHSTTS = 3
                JOIN APIBHO O ON H.CNTBTCH = O.CNTBTCH AND H.CNTITEM = O.CNTITEM
                WHERE H.IDVEND = '${vendorId}'
                  AND H.ERRENTRY = 0
                  AND O.OPTFIELD = 'FOLIOCFD'
                  AND UPPER(RTRIM(O.[VALUE])) IN (${uuidList})
            `, DB);
            matchedInvoices = result.recordset.map(r => r.IDINVC);
        } catch (err) {
            console.error(`  [ERROR] Failed to find invoices by UUID for vendor ${vendorId}: ${err.message}`);
            continue;
        }

        if (matchedInvoices.length === 0) continue;

        // Find PY payments for these invoices, not in control table
        const pyPayments = await findPyPaymentsForInvoices(DB, vendorId, matchedInvoices);
        if (pyPayments.length === 0) continue;

        // Build state entries (these are upload-ready, all UUIDs present)
        for (const py of pyPayments) {
            const docNbr = py.external_id.trim();

            if (state.payments[docNbr] && state.payments[docNbr].status !== 'pending') {
                skippedCount++;
                continue;
            }

            // Get all invoices for this PY
            let pyInvoices;
            try {
                const result = await runQuery(`
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
                             WHERE CNTBTCH = H.CNTBTCH AND CNTITEM = H.CNTITEM AND OPTFIELD = 'FOLIOCFD'
                            ), ''
                        ) AS UUID_APIBHO,
                        (SELECT COUNT(*)
                         FROM APIBHO
                         WHERE CNTBTCH = H.CNTBTCH AND CNTITEM = H.CNTITEM AND OPTFIELD = 'FOLIOCFD'
                        ) AS FOLIOCFD_ROW_EXISTS
                    FROM APTCP DP
                    JOIN APTCR R ON R.CNTBTCH = DP.CNTBTCH AND R.CNTENTR = DP.CNTRMIT
                    JOIN APIBH H ON DP.IDVEND = H.IDVEND
                            AND DP.IDINVC = H.IDINVC AND H.ERRENTRY = 0
                    JOIN APIBC C ON H.CNTBTCH = C.CNTBTCH AND C.BTCHSTTS = 3
                    WHERE DP.BATCHTYPE = 'PY'
                        AND DP.CNTBTCH = ${py.LotePago}
                        AND DP.CNTRMIT = ${py.AsientoPago}
                        AND DP.DOCTYPE = 1
                `, DB);
                pyInvoices = result.recordset;
            } catch (err) {
                console.error(`  [ERROR] Failed to query invoices for ${docNbr}: ${err.message}`);
                continue;
            }

            if (pyInvoices.length === 0) continue;

            // Check if ALL invoices have UUIDs
            const allHaveUuid = pyInvoices.every(inv => inv.UUID_APIBHO && inv.UUID_APIBHO.trim() !== '');

            const invoiceEntries = pyInvoices.map(inv => ({
                idinvc: inv.invoice_external_id,
                invBatch: inv.inv_batch,
                invEntry: inv.inv_entry,
                amount: inv.invoice_amount,
                currency: inv.invoice_currency,
                exchangeRate: inv.invoice_exchange_rate,
                paymentAmount: inv.payment_amount,
                uuidStatus: (inv.UUID_APIBHO && inv.UUID_APIBHO.trim() !== '') ? 'present' :
                    (inv.FOLIOCFD_ROW_EXISTS === 0 ? 'no_row' : 'empty'),
                currentUuid: inv.UUID_APIBHO || '',
                matchedUuid: null,
                matchScore: null,
                matchConfidence: null,
                portalCfdiId: null,
                matchDetails: []
            }));

            const isNew = !state.payments[docNbr];

            // If all UUIDs present, mark as uuid_repaired (ready for upload)
            // If some missing, mark as pending (needs repair first)
            state.payments[docNbr] = {
                vendor: vendorId,
                providerExternalId: providerId,
                status: allHaveUuid ? 'uuid_repaired' : 'pending',
                invoices: invoiceEntries,
                repairDate: allHaveUuid ? new Date().toISOString() : null,
                uploadDate: null,
                uploadResult: null,
                portalPaymentId: null,
                error: null
            };

            if (isNew) {
                if (allHaveUuid) {
                    uploadReadyCount++;
                    console.log(`  [UPLOAD-READY] ${docNbr} (vendor: ${vendorId}, ${invoiceEntries.length} invoices, all UUIDs present)`);
                } else {
                    newCount++;
                    const missing = invoiceEntries.filter(i => i.uuidStatus !== 'present').length;
                    console.log(`  [NEW] ${docNbr} (vendor: ${vendorId}, ${invoiceEntries.length} invoices, ${missing} missing UUID)`);
                }
            }
        }
    }

    state.lastScanDate = new Date().toISOString();
    saveState(state);

    const pending = Object.values(state.payments).filter(p => p.status === 'pending').length;
    const readyForUpload = Object.values(state.payments).filter(p => p.status === 'uuid_repaired').length;

    console.log(`\n--- SCAN COMPLETE ---`);
    console.log(`  Portal PENDING_TO_PAY CFDIs:     ${portalCfdis.length}`);
    console.log(`  UUID in APIBHO (need upload):    ${alreadyKnownCount}`);
    console.log(`  UUID missing (need repair):      ${missingCount}`);
    console.log(`  Providers resolved to Sage:      ${Object.keys(providerToVendor).length} / ${allProviderIds.size}`);
    console.log(`  Portal CFDIs matched (repair):   ${matchedCfdiCount}`);
    console.log(`  New PY payments (need repair):   ${newCount}`);
    console.log(`  PY payments (upload-ready):      ${uploadReadyCount}`);
    console.log(`  Skipped (already processed):     ${skippedCount}`);
    console.log(`  Total pending (need repair):     ${pending}`);
    console.log(`  Total ready for upload:          ${readyForUpload}`);
    console.log(`  State file: ${STATE_FILE}`);
    logGenerator(LOG_FILE, 'info',
        `SCAN complete: ${portalCfdis.length} portal CFDIs, ${missingCount} missing UUID, ${matchedCfdiCount} matched, ${newCount} need repair, ${uploadReadyCount} upload-ready`
    );
}

// --- Helper: Find PY payments for a set of invoice IDs ---
async function findPyPaymentsForInvoices(DB, vendorId, idinvcs) {
    try {
        const idinvcList = idinvcs.map(id => `'${id}'`).join(',');
        const result = await runQuery(`
            SELECT DISTINCT
                RTRIM(R.DOCNBR)   AS external_id,
                R.CNTBTCH         AS LotePago,
                R.CNTENTR         AS AsientoPago,
                RTRIM(R.IDVEND)   AS vendor,
                R.AMTRMIT         AS total_amount
            FROM APTCP DP
            JOIN APTCR R ON R.CNTBTCH = DP.CNTBTCH AND R.CNTENTR = DP.CNTRMIT
            JOIN APBTA B ON B.PAYMTYPE = R.BTCHTYPE AND B.CNTBTCH = R.CNTBTCH
            WHERE DP.BATCHTYPE = 'PY'
              AND B.BATCHSTAT = 3
              AND R.ERRENTRY = 0
              AND R.RMITTYPE = 1
              AND DP.DOCTYPE = 1
              AND RTRIM(DP.IDVEND) = '${vendorId}'
              AND RTRIM(DP.IDINVC) IN (${idinvcList})
              AND R.DOCNBR NOT IN (
                  SELECT NoPagoSage
                  FROM fesa.dbo.fesaPagosFocaltec
                  WHERE idCia = R.AUDTORG AND NoPagoSage = R.DOCNBR
              )
        `, DB);
        return result.recordset;
    } catch (err) {
        console.error(`  [ERROR] Failed to query PY payments for vendor ${vendorId}: ${err.message}`);
        return [];
    }
}

// --- Helper: Build state entry for a PY payment (used for needsRepair path) ---
async function buildPaymentStateEntry(DB, py, providerId, vendorId, state, cfdiToInvoice, defaultStatus) {
    const docNbr = py.external_id.trim();

    if (state.payments[docNbr] && state.payments[docNbr].status !== 'pending') {
        return 'skipped';
    }

    let pyInvoices;
    try {
        const result = await runQuery(`
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
                     WHERE CNTBTCH = H.CNTBTCH AND CNTITEM = H.CNTITEM AND OPTFIELD = 'FOLIOCFD'
                    ), ''
                ) AS UUID_APIBHO,
                (SELECT COUNT(*)
                 FROM APIBHO
                 WHERE CNTBTCH = H.CNTBTCH AND CNTITEM = H.CNTITEM AND OPTFIELD = 'FOLIOCFD'
                ) AS FOLIOCFD_ROW_EXISTS
            FROM APTCP DP
            JOIN APTCR R ON R.CNTBTCH = DP.CNTBTCH AND R.CNTENTR = DP.CNTRMIT
            JOIN APIBH H ON DP.IDVEND = H.IDVEND
                    AND DP.IDINVC = H.IDINVC AND H.ERRENTRY = 0
            JOIN APIBC C ON H.CNTBTCH = C.CNTBTCH AND C.BTCHSTTS = 3
            WHERE DP.BATCHTYPE = 'PY'
                AND DP.CNTBTCH = ${py.LotePago}
                AND DP.CNTRMIT = ${py.AsientoPago}
                AND DP.DOCTYPE = 1
        `, DB);
        pyInvoices = result.recordset;
    } catch (err) {
        console.error(`  [ERROR] Failed to query invoices for ${docNbr}: ${err.message}`);
        return 'error';
    }

    if (pyInvoices.length === 0) return 'empty';

    const invoiceEntries = pyInvoices.map(inv => {
        const hasUuid = inv.UUID_APIBHO && inv.UUID_APIBHO.trim() !== '';
        let matchedUuid = null;
        let matchScore = null;
        let matchConfidence = null;
        let portalCfdiId = null;

        if (!hasUuid && cfdiToInvoice) {
            for (const match of Object.values(cfdiToInvoice)) {
                if (match.sageInvoice.IDINVC === inv.invoice_external_id.trim()) {
                    matchedUuid = match.uuid;
                    matchScore = match.score;
                    matchConfidence = match.confidence;
                    portalCfdiId = match.portalCfdiId;
                    break;
                }
            }
        }

        return {
            idinvc: inv.invoice_external_id,
            invBatch: inv.inv_batch,
            invEntry: inv.inv_entry,
            amount: inv.invoice_amount,
            currency: inv.invoice_currency,
            exchangeRate: inv.invoice_exchange_rate,
            paymentAmount: inv.payment_amount,
            uuidStatus: hasUuid ? 'present' :
                (inv.FOLIOCFD_ROW_EXISTS === 0 ? 'no_row' : 'empty'),
            currentUuid: inv.UUID_APIBHO || '',
            matchedUuid,
            matchScore,
            matchConfidence,
            portalCfdiId,
            matchDetails: []
        };
    });

    const isNew = !state.payments[docNbr];
    state.payments[docNbr] = {
        vendor: vendorId,
        providerExternalId: providerId,
        status: defaultStatus,
        invoices: invoiceEntries,
        repairDate: null,
        uploadDate: null,
        uploadResult: null,
        portalPaymentId: null,
        error: null
    };

    if (isNew) {
        const matched = invoiceEntries.filter(i => i.matchedUuid).length;
        const missing = invoiceEntries.filter(i => i.uuidStatus !== 'present' && !i.matchedUuid).length;
        const present = invoiceEntries.filter(i => i.uuidStatus === 'present').length;
        console.log(`  [NEW] ${docNbr} (vendor: ${vendorId}, invoices: ${invoiceEntries.length}, matched: ${matched}, present: ${present}, unmatched: ${missing})`);
        return 'new';
    }
    return 'existing';
}

// ============================================================================
// MODE: REPAIR
// ============================================================================
async function modeRepair(DB, tenantIndex, apply, batchSize, pyFilter) {
    const batch = batchSize || 50;

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

    // Discover APIBHO schema for INSERT (only if --apply)
    let apibhoSchema = null;
    if (apply) {
        console.log('[STEP 1] Discovering APIBHO schema...');
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

        let allInvoicesOk = true;

        for (const inv of payment.invoices) {
            // Already has UUID
            if (inv.uuidStatus === 'present' && inv.currentUuid) {
                console.log(`  Invoice ${inv.idinvc}: UUID already present (${inv.currentUuid})`);
                continue;
            }

            // Already repaired in a previous run
            if (inv.uuidStatus === 'repaired') {
                console.log(`  Invoice ${inv.idinvc}: Already repaired (${inv.currentUuid})`);
                continue;
            }

            // Check if scan pre-matched a UUID
            if (inv.matchedUuid && (inv.matchConfidence === 'high' || inv.matchConfidence === 'medium')) {
                console.log(`  Invoice ${inv.idinvc}: PRE-MATCHED [${inv.matchConfidence}] score=${inv.matchScore} uuid=${inv.matchedUuid}`);

                if (apply) {
                    const writeOk = await writeUuidToApibho(DB, inv, inv.matchedUuid, apibhoSchema);
                    if (writeOk) {
                        inv.uuidStatus = 'repaired';
                        inv.currentUuid = inv.matchedUuid;
                        console.log(`    -> UUID written to APIBHO`);
                    } else {
                        inv.uuidStatus = 'write_failed';
                        allInvoicesOk = false;
                        console.log(`    -> FAILED to write UUID to APIBHO`);
                    }
                } else {
                    console.log(`    -> DRY-RUN: Would write UUID to APIBHO`);
                }
            } else {
                console.log(`  Invoice ${inv.idinvc}: NO MATCH from scan (score=${inv.matchScore || 0}, confidence=${inv.matchConfidence || 'none'})`);
                allInvoicesOk = false;
            }
        }

        // Update payment status
        const allFixed = payment.invoices.every(inv =>
            inv.uuidStatus === 'present' || inv.uuidStatus === 'repaired'
        );
        const anyWriteFailed = payment.invoices.some(inv => inv.uuidStatus === 'write_failed');
        const anyNoMatch = payment.invoices.some(inv =>
            inv.uuidStatus !== 'present' && inv.uuidStatus !== 'repaired' && !inv.matchedUuid
        );

        if (allFixed && apply) {
            payment.status = 'uuid_repaired';
            payment.repairDate = new Date().toISOString();
            repairedCount++;
        } else if (anyWriteFailed) {
            payment.status = 'repair_failed';
            payment.error = 'One or more APIBHO writes failed';
            errorCount++;
        } else if (anyNoMatch) {
            payment.status = 'no_match';
            payment.error = 'One or more invoices have no portal match';
            noMatchCount++;
        } else if (!apply) {
            // Dry-run: keep as pending but count it
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
    logGenerator(LOG_FILE, 'info',
        `REPAIR ${apply ? 'APPLY' : 'DRY-RUN'}: ${repairedCount} repaired, ${noMatchCount} no_match, ${errorCount} errors, ${remaining} remaining`
    );
}

// --- Write UUID to APIBHO ---
async function writeUuidToApibho(DB, inv, uuid, schemaRow) {
    try {
        if (inv.uuidStatus === 'no_row') {
            const audtdate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
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
    const batch = batchSize || 20;

    console.log(`\n=== MODE: UPLOAD ${apply ? '(APPLY)' : '(DRY-RUN)'} ===`);
    console.log(`Batch size: ${batch}\n`);

    const state = loadState();

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

        // Re-fetch payment header from DB
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

        // Build payload (same as PortalPaymentController / portal-payments-generator)
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
    logGenerator(LOG_FILE, 'info',
        `UPLOAD ${apply ? 'APPLY' : 'DRY-RUN'}: ${uploadedCount} uploaded, ${failedCount} failed, ${remainingRepaired} remaining`
    );
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
    const { mode, apply, batchSize, pyFilter, tenantIndex, months } = parseArgs();
    const DB = databases[tenantIndex];

    if (!mode || !['scan', 'repair', 'upload'].includes(mode)) {
        console.log('Payment UUID Repair & Upload Script (Portal-first)');
        console.log('');
        console.log('Usage:');
        console.log('  node src/scripts/payment-uuid-repair.js scan                      # portal-first scan');
        console.log('  node src/scripts/payment-uuid-repair.js scan --months=6            # look back 6 months');
        console.log('  node src/scripts/payment-uuid-repair.js repair                     # dry-run');
        console.log('  node src/scripts/payment-uuid-repair.js repair --apply             # write UUIDs');
        console.log('  node src/scripts/payment-uuid-repair.js repair --apply --batch=100');
        console.log('  node src/scripts/payment-uuid-repair.js repair --apply --py PY0061652');
        console.log('  node src/scripts/payment-uuid-repair.js upload                     # dry-run');
        console.log('  node src/scripts/payment-uuid-repair.js upload --apply             # POST to portal');
        console.log('  node src/scripts/payment-uuid-repair.js upload --apply --batch=20');
        console.log('  node src/scripts/payment-uuid-repair.js upload --apply --py PY0061652');
        console.log('');
        console.log('Flags:');
        console.log('  --index=N    Tenant index (default: 0)');
        console.log('  --batch=N    Batch size (default: 50 for repair, 20 for upload)');
        console.log('  --months=N   Months back for portal scan (default: 12)');
        process.exit(1);
    }

    console.log(`Tenant index: ${tenantIndex}, DB: ${DB}`);

    switch (mode) {
        case 'scan':
            await modeScan(DB, tenantIndex, months);
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
