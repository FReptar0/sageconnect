const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { getCurrentDateCompact } = require('../utils/TimezoneHelper');
const { getPendingToPayInvoices } = require('../utils/GetTypesCFDI');
const axios = require('axios');
const dotenv = require('dotenv');

const credentials = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const { DATABASES, TENANT_ID, API_KEY, API_SECRET, URL } = credentials;

const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const database = DATABASES.split(',');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const cliArgs = process.argv.slice(2);
let index = 0;
let fromDate = null;
let batchLimit = 20;
let pyFilter = null;
let shouldUpload = false;

for (let i = 0; i < cliArgs.length; i++) {
    const a = cliArgs[i];
    if (a.startsWith('--index=')) {
        index = parseInt(a.split('=')[1], 10);
    } else if (a.startsWith('--from=')) {
        fromDate = a.split('=')[1];
    } else if (a.startsWith('--batch=')) {
        batchLimit = parseInt(a.split('=')[1], 10);
    } else if (a === '--py' && cliArgs[i + 1]) {
        pyFilter = cliArgs[i + 1];
        i++;
    } else if (a === '--upload') {
        shouldUpload = true;
    }
}

const logFileName = 'PaymentReconciliation';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const currentDate = getCurrentDateCompact();
    console.log('=== PAYMENT RECONCILIATION ===');
    console.log(`Tenant: ${tenantIds[index]} | DB: ${database[index]} | Today: ${currentDate}`);
    console.log(`Mode: ${shouldUpload ? 'UPLOAD' : 'REPORT'} | Portal: ALL PENDING_TO_PAY (no date filter)`);
    if (fromDate) console.log(`Sage --from: ${fromDate}`);
    if (pyFilter) console.log(`Sage --py: ${pyFilter}`);
    console.log('');

    // -----------------------------------------------------------------------
    // Step 1: Fetch portal PENDING_TO_PAY invoices
    // -----------------------------------------------------------------------
    console.log('[Step 1] Fetching portal PENDING_TO_PAY invoices...');
    const portalItems = await getPendingToPayInvoices(index);

    // Build lookup map: uuid -> portal item info
    const portalUuidMap = new Map();
    for (const item of portalItems) {
        const uuid = item.cfdi?.timbre?.uuid;
        if (uuid) {
            portalUuidMap.set(uuid.toUpperCase(), {
                folio: item.cfdi.folio,
                serie: item.cfdi.serie,
                total: item.cfdi.total,
                currency: item.cfdi.moneda,
                provider_id: item.metadata?.provider_id
            });
        }
    }
    console.log(`  Portal PENDING_TO_PAY invoices: ${portalUuidMap.size}`);

    // -----------------------------------------------------------------------
    // Step 2: Query Sage for PY payments matching portal UUIDs
    // -----------------------------------------------------------------------
    console.log('\n[Step 2] Querying Sage for PY payments matching portal UUIDs...');

    const portalUuids = Array.from(portalUuidMap.keys());
    if (!portalUuids.length) {
        console.log('\n[OK] No portal UUIDs to search for in Sage.');
        return;
    }

    // Chunk UUIDs at 500 per query
    const UUID_CHUNK_SIZE = 500;
    const uuidChunks = [];
    for (let i = 0; i < portalUuids.length; i += UUID_CHUNK_SIZE) {
        uuidChunks.push(portalUuids.slice(i, i + UUID_CHUNK_SIZE));
    }

    let dateConditions = `AND P.AUDTDATE < ${currentDate}`;
    if (fromDate) {
        dateConditions += `\n      AND P.AUDTDATE >= ${fromDate}`;
    }
    if (pyFilter) {
        dateConditions += `\n      AND P.DOCNBR = '${pyFilter}'`;
    }

    const allRows = [];
    for (const chunk of uuidChunks) {
        const inClause = chunk.map(u => `'${u}'`).join(',');
        const query = `
SELECT DISTINCT
    P.CNTBTCH AS LotePago, P.CNTENTR AS AsientoPago,
    RTRIM(BK.ADDR1) AS bank_account_id, B.IDBANK,
    P.DATEBUS AS FechaAsentamiento, RTRIM(P.DOCNBR) AS external_id,
    P.TEXTRMIT AS comments, P.TXTRMITREF AS reference,
    CASE BK.CURNSTMT WHEN 'MXP' THEN 'MXN' ELSE BK.CURNSTMT END AS bk_currency,
    P.DATERMIT AS payment_date, RTRIM(P.IDVEND) AS provider_external_id,
    P.AMTRMIT AS total_amount, 'TRANSFER' AS operation_type,
    P.RATEEXCHHC AS TipoCambioPago,
    ISNULL((SELECT [VALUE] FROM APVENO WHERE OPTFIELD='RFC' AND VENDORID=P.IDVEND), '') AS RFC,
    ISNULL((SELECT [VALUE] FROM APVENO WHERE OPTFIELD='PROVIDERID' AND VENDORID=P.IDVEND), '') AS PROVIDERID
FROM APIBHO O
JOIN APIBH H   ON O.CNTBTCH = H.CNTBTCH AND O.CNTITEM = H.CNTITEM AND H.ERRENTRY = 0
JOIN APIBC C   ON H.CNTBTCH = C.CNTBTCH AND C.BTCHSTTS = 3
JOIN APTCP DP  ON DP.IDVEND = H.IDVEND AND DP.IDINVC = H.IDINVC
               AND DP.BATCHTYPE = 'PY' AND DP.DOCTYPE = 1
JOIN APTCR P   ON P.CNTBTCH = DP.CNTBTCH AND P.CNTENTR = DP.CNTRMIT
JOIN APBTA B   ON B.PAYMTYPE = P.BTCHTYPE AND B.CNTBTCH = P.CNTBTCH
JOIN BKACCT BK ON B.IDBANK = BK.BANK
WHERE O.OPTFIELD = 'FOLIOCFD'
  AND UPPER(RTRIM(O.[VALUE])) IN (${inClause})
  AND B.PAYMTYPE = 'PY' AND B.BATCHSTAT = 3
  AND P.ERRENTRY = 0 AND P.RMITTYPE = 1
  ${dateConditions}
  AND P.DOCNBR NOT IN (
      SELECT NoPagoSage
      FROM fesa.dbo.fesaPagosFocaltec
      WHERE idCia = P.AUDTORG AND NoPagoSage = P.DOCNBR
  )
  AND P.DOCNBR NOT IN (
      SELECT IDINVC
      FROM APPYM
      WHERE IDBANK = B.IDBANK
        AND CNTBTCH = P.CNTBTCH
        AND CNTITEM = P.CNTENTR
        AND SWCHKCLRD = 2
  )
`;

        const result = await runQuery(query, database[index])
            .catch(err => {
                logGenerator(logFileName, 'error', `Error UUID-driven query (chunk): ${err.message}`);
                console.error('  Error fetching Sage payments (chunk):', err.message);
                return { recordset: [] };
            });

        allRows.push(...result.recordset);
    }

    // Deduplicate by LotePago + AsientoPago + external_id
    const seen = new Set();
    const deduped = [];
    for (const row of allRows) {
        const key = `${row.LotePago}-${row.AsientoPago}-${row.external_id}`;
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(row);
        }
    }

    console.log(`  Sage PY payments matching portal UUIDs: ${deduped.length} (from ${uuidChunks.length} chunk(s))`);

    if (!deduped.length) {
        console.log('\n[OK] No matching payments found to reconcile.');
        return;
    }

    // -----------------------------------------------------------------------
    // Step 3 & 4: For each PY, get invoices and categorize
    // -----------------------------------------------------------------------
    console.log('\n[Step 3-4] Fetching invoices and categorizing...');

    const categories = {
        ready: [],
        no_providerid: [],
        no_uuid: [],
        not_in_portal: []
    };

    for (const hdr of deduped) {
        const providerid = hdr.PROVIDERID ? hdr.PROVIDERID.trim() : '';
        const rfc = hdr.RFC ? hdr.RFC.trim() : '';

        // Check PROVIDERID first
        if (!providerid) {
            categories.no_providerid.push({
                hdr,
                rfc,
                reason: 'no PROVIDERID in APVENO'
            });
            continue;
        }

        // Fetch invoices for this payment
        const queryFacturasPagadas = `
SELECT DISTINCT
    DP.CNTBTCH        AS LotePago,
    DP.CNTRMIT        AS AsientoPago,
    RTRIM(DP.IDINVC)  AS invoice_external_id,
    H.CNTBTCH         AS inv_batch,
    H.CNTITEM         AS inv_entry,
    H.AMTGROSDST      AS invoice_amount,
    CASE H.CODECURN WHEN 'MXP' THEN 'MXN' ELSE H.CODECURN END AS invoice_currency,
    H.EXCHRATEHC      AS invoice_exchange_rate,
    DP.AMTPAYM        AS payment_amount,
    ISNULL(
        (SELECT SWPAID
         FROM APOBL
         WHERE IDINVC = DP.IDINVC
           AND IDVEND = DP.IDVEND),
        0
    ) AS FULL_PAID,
    ISNULL(
        (SELECT RTRIM([VALUE])
         FROM APIBHO
         WHERE CNTBTCH = H.CNTBTCH
           AND CNTITEM = H.CNTITEM
           AND OPTFIELD = 'FOLIOCFD'),
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
    AND DP.DOCTYPE   = 1`;

        const invoices = await runQuery(queryFacturasPagadas, database[index])
            .catch(err => {
                logGenerator(logFileName, 'error', `Error queryFacturasPagadas for ${hdr.external_id}: ${err.message}`);
                console.error(`  Error fetching invoices for ${hdr.external_id}:`, err.message);
                return { recordset: [] };
            });

        if (!invoices.recordset.length) {
            continue;
        }

        // Check for missing UUIDs
        const missingUuid = invoices.recordset.filter(inv => !inv.UUID || inv.UUID.trim() === '');
        if (missingUuid.length > 0) {
            categories.no_uuid.push({
                hdr,
                invoices: invoices.recordset,
                missingCount: missingUuid.length,
                totalCount: invoices.recordset.length
            });
            continue;
        }

        // All invoices have UUIDs — check if they exist in portal PENDING_TO_PAY
        const allInPortal = invoices.recordset.every(inv => {
            const uuid = inv.UUID.trim().toUpperCase();
            return portalUuidMap.has(uuid);
        });

        if (!allInPortal) {
            categories.not_in_portal.push({
                hdr,
                invoices: invoices.recordset
            });
            continue;
        }

        // All good — ready to upload
        categories.ready.push({
            hdr,
            invoices: invoices.recordset
        });
    }

    // -----------------------------------------------------------------------
    // Step 5: Generate report
    // -----------------------------------------------------------------------
    console.log('\n=== PAYMENT RECONCILIATION REPORT ===');
    console.log(`Portal PENDING_TO_PAY invoices: ${portalUuidMap.size}`);
    console.log(`Sage PY payments matching portal UUIDs: ${deduped.length}`);

    // --- READY ---
    console.log(`\n--- READY TO UPLOAD (${categories.ready.length}) ---`);
    for (const entry of categories.ready) {
        const { hdr, invoices } = entry;
        const invCount = invoices.length;
        const amount = typeof hdr.total_amount === 'number' ? hdr.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 }) : hdr.total_amount;
        console.log(`  ${hdr.external_id}  | vendor: ${hdr.provider_external_id} | $${amount} ${hdr.bk_currency} | ${invCount} invoice${invCount > 1 ? 's' : ''} | all UUIDs matched`);
    }

    // --- MISSING PROVIDERID ---
    console.log(`\n--- MISSING PROVIDERID (${categories.no_providerid.length}) ---`);
    for (const entry of categories.no_providerid) {
        const { hdr, rfc } = entry;
        console.log(`  ${hdr.external_id}  | vendor: ${hdr.provider_external_id} | RFC: ${rfc || 'N/A'} | no PROVIDERID in APVENO`);
    }

    // --- MISSING UUID ---
    console.log(`\n--- MISSING UUID (${categories.no_uuid.length}) ---`);
    for (const entry of categories.no_uuid) {
        const { hdr, invoices, missingCount, totalCount } = entry;
        console.log(`  ${hdr.external_id}  | vendor: ${hdr.provider_external_id} | ${missingCount}/${totalCount} invoices missing UUID`);
        for (const inv of invoices) {
            const uuid = inv.UUID ? inv.UUID.trim() : '';
            const status = uuid ? 'UUID present' : 'MISSING UUID';
            console.log(`    - ${inv.invoice_external_id}: ${status}`);
        }
    }

    // --- NOT IN PORTAL ---
    console.log(`\n--- NOT IN PORTAL (${categories.not_in_portal.length}) ---`);
    for (const entry of categories.not_in_portal) {
        const { hdr, invoices } = entry;
        const notFound = invoices.filter(inv => !portalUuidMap.has((inv.UUID || '').trim().toUpperCase()));
        console.log(`  ${hdr.external_id}  | vendor: ${hdr.provider_external_id} | ${notFound.length}/${invoices.length} UUIDs not found as PENDING_TO_PAY (may already be paid)`);
    }

    // --- SUMMARY ---
    const totalProcessed = categories.ready.length + categories.no_providerid.length + categories.no_uuid.length + categories.not_in_portal.length;
    console.log('\n=== SUMMARY ===');
    console.log(`  Ready to upload:    ${categories.ready.length}`);
    console.log(`  Missing PROVIDERID: ${categories.no_providerid.length}`);
    console.log(`  Missing UUID:       ${categories.no_uuid.length}`);
    console.log(`  Not in portal:      ${categories.not_in_portal.length}`);
    console.log(`  TOTAL:              ${totalProcessed}`);

    if (!shouldUpload) {
        if (categories.ready.length > 0) {
            console.log(`\nUse --upload to send the ${categories.ready.length} ready payments to the portal.`);
        }
        return;
    }

    // -----------------------------------------------------------------------
    // Step 6: Batch upload ready payments
    // -----------------------------------------------------------------------
    const toUpload = categories.ready.slice(0, batchLimit);
    console.log(`\n=== UPLOADING ${toUpload.length} of ${categories.ready.length} ready payments (batch limit: ${batchLimit}) ===`);

    // Build all payment payloads
    const paymentPayloads = toUpload.map(entry => {
        const { hdr, invoices } = entry;

        const cfdis = invoices.map(inv => {
            const sameCurrency = inv.invoice_currency === hdr.bk_currency;
            const UUID_Capitalized = inv.UUID ? inv.UUID.trim().toUpperCase() : '';
            return {
                amount: inv.payment_amount,
                currency: inv.invoice_currency,
                exchange_rate: sameCurrency ? 1 : inv.invoice_exchange_rate,
                payment_amount: inv.payment_amount,
                payment_currency: hdr.bk_currency,
                uuid: UUID_Capitalized
            };
        });

        const d = hdr.payment_date.toString();
        const payment_date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T10:00:00.000Z`;

        return {
            bank_account_id: hdr.bank_account_id,
            cfdis,
            comments: hdr.comments,
            currency: hdr.bk_currency,
            external_id: hdr.external_id,
            ignore_amounts: false,
            operation_type: hdr.operation_type,
            payment_date,
            provider_external_id: hdr.provider_external_id,
            reference: hdr.reference,
            total_amount: hdr.total_amount
        };
    });

    // Send single batch POST
    const endpoint = `${URL}/api/1.0/batch/tenants/${tenantIds[index]}/payments`;
    console.log(`\n  [POST] Sending ${paymentPayloads.length} payments in batch to portal...`);

    let successCount = 0;
    let errorCount = 0;

    try {
        const resp = await axios.post(endpoint, { payments: paymentPayloads }, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index],
                'Content-Type': 'application/json'
            }
        });

        const results = resp.data && resp.data.results ? resp.data.results : [];
        console.log(`  [OK] Batch response received: ${results.length} result(s)`);

        for (const result of results) {
            const matchEntry = toUpload.find(e => e.hdr.external_id === result.item?.external_id);
            const externalId = result.item?.external_id || 'unknown';

            if (result.error_code === 0) {
                const idPortal = result.id || undefined;
                console.log(`  [OK] ${externalId} sent successfully | portal ID: ${idPortal ?? 'N/A'}`);
                logGenerator(logFileName, 'info', `Reconciliation upload OK: ${externalId}, portal ID: ${idPortal ?? 'N/A'}`);

                // Determine PAID vs PARTIAL status
                const allFull = matchEntry
                    ? matchEntry.invoices.every(inv => inv.FULL_PAID === 1 || inv.FULL_PAID === '1')
                    : false;
                const statusTag = allFull ? 'PAID' : 'PARTIAL';

                // Insert into control table
                const insertSql = `
INSERT INTO fesa.dbo.fesaPagosFocaltec
    (idCia, NoPagoSage, status, idFocaltec)
VALUES
    ('${database[index]}',
     '${externalId}',
     '${statusTag}',
     ${idPortal ? `'${idPortal}'` : 'NULL'})
`;
                const insertResult = await runQuery(insertSql)
                    .catch(err => {
                        logGenerator(logFileName, 'error', `Insert control table failed for ${externalId}: ${err.message}`);
                        console.error(`  [ERROR] Control table insert failed for ${externalId}: ${err.message}`);
                        return { rowsAffected: [0] };
                    });

                if (insertResult.rowsAffected[0]) {
                    console.log(`  [OK] Control table updated for ${externalId} (status: ${statusTag})`);
                } else {
                    console.warn(`  [WARN] Control table NOT updated for ${externalId}`);
                }
                successCount++;
            } else {
                console.error(`  [ERROR] ${externalId} failed: error_code=${result.error_code}, message=${result.error_message}`);
                logGenerator(logFileName, 'error', `Batch upload failed ${externalId}: code=${result.error_code} msg=${result.error_message}`);
                errorCount++;
            }
        }
    } catch (err) {
        const status = err.response ? err.response.status : 'N/A';
        const data = err.response ? JSON.stringify(err.response.data) : err.message;
        console.error(`  [ERROR] Batch upload failed: HTTP ${status} - ${data}`);
        logGenerator(logFileName, 'error', `Batch upload error: ${status} ${data}`);
        errorCount = toUpload.length;
    }

    console.log(`\n=== UPLOAD COMPLETE ===`);
    console.log(`  Success: ${successCount}`);
    console.log(`  Errors:  ${errorCount}`);
    if (categories.ready.length > batchLimit) {
        console.log(`  Remaining: ${categories.ready.length - batchLimit} (run again to process next batch)`);
    }
}

main().catch(err => {
    console.error('[FATAL] Unexpected error:', err);
    logGenerator(logFileName, 'error', `Fatal: ${err.message}\n${err.stack}`);
    process.exit(1);
});
