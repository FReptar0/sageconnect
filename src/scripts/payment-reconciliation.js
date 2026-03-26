const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { getCurrentDateCompact } = require('../utils/TimezoneHelper');
const { getPendingToPayInvoices } = require('../utils/GetTypesCFDI');
const { getProviderByExternalId } = require('../utils/GetProviders');
const { resolveProviderIdByExternalId } = require('../services/ProviderIdResolver');
const axios = require('axios');
const config = require('../config');
const { appendCsv } = require('../utils/CsvWriter');

const LOG_FILE = 'PaymentReconciliation';
const CSV_FILE = 'PaymentReconciliation-uploads';

// --- Console → Log File Interceptor ---
// Mirrors ALL console output to the winston log file so nothing is lost
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;
const _origTable = console.table;

console.log = (...args) => {
    _origLog.apply(console, args);
    logGenerator(LOG_FILE, 'info', args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
};
console.warn = (...args) => {
    _origWarn.apply(console, args);
    logGenerator(LOG_FILE, 'warn', args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
};
console.error = (...args) => {
    _origError.apply(console, args);
    logGenerator(LOG_FILE, 'error', args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
};
console.table = (data, columns) => {
    _origTable.call(console, data, columns);
    logGenerator(LOG_FILE, 'info', '[TABLE] ' + JSON.stringify(data, null, 2));
};

const tenantIds = config.portal.tenants.map(t => t.id);
const apiKeys = config.portal.tenants.map(t => t.key);
const apiSecrets = config.portal.tenants.map(t => t.secret);
const database = config.portal.tenants.map(t => t.database);

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

function compactToDashed(compactDate) {
    if (!compactDate || !/^\d{8}$/.test(compactDate)) return null;
    return `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
}

function oneYearAgoDashed() {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classifies deduplicated Sage PY payments into categories.
 * @param {Array} deduped - Deduplicated payment header rows from Sage.
 * @param {Map} portalUuidMap - Map of UUID -> portal item info (folio, serie, total, currency, provider_id).
 * @param {number} index - Tenant index.
 * @param {string} db - Sage database name.
 * @returns {Promise<{categories: Object, autoResolvedCount: number, autoResolvedSet: Set}>}
 */
async function classifyPayments(deduped, portalUuidMap, index, db) {
    const categories = {
        ready: [],
        no_providerid: [],
        no_uuid: [],
        not_in_portal: [],
        provider_mismatch: []
    };

    let autoResolvedCount = 0;
    const autoResolvedSet = new Set();

    for (const hdr of deduped) {
        let effectiveProviderId = hdr.PROVIDERID ? hdr.PROVIDERID.trim() : '';
        const rfc = hdr.RFC ? hdr.RFC.trim() : '';

        // Check PROVIDERID first -- attempt auto-resolution if missing (RSOL-01, RSOL-02)
        if (!effectiveProviderId) {
            const vendorId = hdr.provider_external_id ? hdr.provider_external_id.trim() : '';
            if (!vendorId) {
                categories.no_providerid.push({
                    hdr,
                    rfc,
                    reason: 'no PROVIDERID and no IDVEND to resolve'
                });
                continue;
            }

            // Attempt auto-resolution: first get the provider to capture the ID
            console.log(`  [INFO] Attempting auto-resolve PROVIDERID for vendor ${vendorId} (payment ${hdr.external_id})...`);
            const provider = await getProviderByExternalId(index, vendorId);

            if (provider && provider.id) {
                // Write to Sage DB via resolver
                const writeOk = await resolveProviderIdByExternalId(
                    vendorId, vendorId, index, db
                );
                if (writeOk) {
                    effectiveProviderId = provider.id;
                    autoResolvedCount++;
                    autoResolvedSet.add(hdr.external_id);
                    logGenerator(logFileName, 'info',
                        `Auto-resolved PROVIDERID for ${hdr.external_id}: ${provider.id}`
                    );
                } else {
                    categories.no_providerid.push({
                        hdr,
                        rfc,
                        reason: `auto-resolution DB write failed for externalId: ${vendorId}`
                    });
                    logGenerator(logFileName, 'warn',
                        `Auto-resolution DB write failed for ${hdr.external_id}, externalId: ${vendorId}`
                    );
                    continue;
                }
            } else {
                categories.no_providerid.push({
                    hdr,
                    rfc,
                    reason: `auto-resolution failed for externalId: ${vendorId}`
                });
                logGenerator(logFileName, 'warn',
                    `Auto-resolution failed for ${hdr.external_id}, externalId: ${vendorId}`
                );
                continue;
            }
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

        const invoices = await runQuery(queryFacturasPagadas, db)
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

        // Split invoices: those in portal PENDING_TO_PAY vs those not
        const invoicesInPortal = [];
        const invoicesNotInPortal = [];
        for (const inv of invoices.recordset) {
            const uuid = inv.UUID.trim().toUpperCase();
            if (portalUuidMap.has(uuid)) {
                invoicesInPortal.push(inv);
            } else {
                invoicesNotInPortal.push(inv);
            }
        }

        if (invoicesInPortal.length === 0) {
            categories.not_in_portal.push({
                hdr,
                invoices: invoices.recordset
            });
            continue;
        }

        // Check provider_id match only for invoices that ARE in portal
        const mismatchDetails = [];
        const sageProviderId = effectiveProviderId.toLowerCase();

        for (const inv of invoicesInPortal) {
            const uuid = inv.UUID.trim().toUpperCase();
            const portalItem = portalUuidMap.get(uuid);
            const portalProviderId = (portalItem?.provider_id || '').trim().toLowerCase();

            if (!portalProviderId || portalProviderId !== sageProviderId) {
                mismatchDetails.push({
                    invoice_external_id: inv.invoice_external_id,
                    portal_provider_id: portalItem?.provider_id || '(empty)',
                    sage_providerid: effectiveProviderId
                });
            }
        }

        if (mismatchDetails.length > 0) {
            categories.provider_mismatch.push({
                hdr,
                invoices: invoices.recordset,
                mismatchDetails
            });
            logGenerator(logFileName, 'warn',
                `Provider mismatch for ${hdr.external_id}: ${mismatchDetails.length} invoice(s) with mismatched provider_id`
            );
            continue;
        }

        // Ready to upload — use only invoices that are in portal PENDING_TO_PAY
        if (invoicesNotInPortal.length > 0) {
            console.log(`  [PARTIAL] ${hdr.external_id}: ${invoicesInPortal.length}/${invoices.recordset.length} invoices in PENDING_TO_PAY (${invoicesNotInPortal.length} already paid/not found)`);
            logGenerator(logFileName, 'info',
                `Partial upload for ${hdr.external_id}: ${invoicesInPortal.length} of ${invoices.recordset.length} invoices`
            );
        }
        categories.ready.push({
            hdr,
            invoices: invoicesInPortal
        });
    }

    return { categories, autoResolvedCount, autoResolvedSet };
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Uploads classified "ready" payments in batch to the portal API.
 * Extracted from main() for independent testability.
 * @param {Object} categories - Classified payment categories (from classifyPayments).
 * @param {Object} options - Upload configuration.
 * @param {boolean} options.shouldUpload - Whether to actually upload (--upload flag).
 * @param {number} options.batchLimit - Maximum payments per batch.
 * @param {number} options.index - Tenant index.
 * @param {string} options.logFileName - Log file identifier.
 * @param {string[]} options.tenantIds - Tenant ID array.
 * @param {string[]} options.apiKeys - API key array.
 * @param {string[]} options.apiSecrets - API secret array.
 * @param {string[]} options.database - Database name array.
 * @param {string} options.URL - Portal base URL.
 */
async function uploadBatch(categories, { shouldUpload, batchLimit, index, logFileName, tenantIds, apiKeys, apiSecrets, database, URL }) {
    if (!shouldUpload) {
        if (categories.ready.length > 0) {
            console.log(`\nUse --upload to send the ${categories.ready.length} ready payments to the portal.`);
        }
        return;
    }

    // UPLOAD mode: empty guard (BTCH-02)
    if (categories.ready.length === 0) {
        console.log('\nNo payments ready to upload.');
        logGenerator(logFileName, 'info', 'Upload skipped: no payments ready to upload');
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
    let missingCount = 0;
    const respondedIds = new Set();
    const csvRows = [];

    try {
        const resp = await axios.post(endpoint, { payments: paymentPayloads }, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index],
                'Content-Type': 'application/json'
            }
        });

        const results = Array.isArray(resp.data?.results)
            ? resp.data.results
            : Array.isArray(resp.data?.items)
                ? resp.data.items
                : Array.isArray(resp.data?.data?.results)
                    ? resp.data.data.results
                    : Array.isArray(resp.data)
                        ? resp.data
                        : [];
        console.log(`  [OK] Batch response received: ${results.length} result(s)`);

        for (let i = 0; i < results.length; i++) {
            const result = results[i] || {};
            const fallbackExternalId = toUpload[i]?.hdr?.external_id;
            const externalId =
                result.item?.external_id ||
                result.external_id ||
                result.externalId ||
                result.payment_external_id ||
                fallbackExternalId;
            if (externalId) {
                respondedIds.add(externalId);
            }
            const displayId = externalId || 'unknown';
            const matchEntry = toUpload.find(e => e.hdr.external_id === displayId) || toUpload[i];

            const errorCode = result.error_code ?? result.errorCode;
            const errorMessage =
                result.error_message ??
                result.errorMessage ??
                result.message ??
                (Array.isArray(result.errors) && result.errors.length > 0 ? JSON.stringify(result.errors) : undefined);
            const statusText = typeof result.status === 'string' ? result.status.toLowerCase() : '';

            const hasExplicitError =
                (errorCode !== undefined && Number(errorCode) !== 0) ||
                result.error === true ||
                (Array.isArray(result.errors) && result.errors.length > 0) ||
                statusText === 'error' ||
                statusText === 'failed' ||
                statusText === 'failure' ||
                (result.status_code !== undefined && Number(result.status_code) >= 400) ||
                (result.statusCode !== undefined && Number(result.statusCode) >= 400);

            const isSuccess = !hasExplicitError;

            if (isSuccess) {
                const idPortal = result.id || result.payment_id || result.data?.id || undefined;
                console.log(`  [OK] ${displayId} sent successfully | portal ID: ${idPortal ?? 'N/A'}`);
                logGenerator(logFileName, 'info', `Reconciliation upload OK: ${displayId}, portal ID: ${idPortal ?? 'N/A'}`);

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
     '${displayId}',
     '${statusTag}',
     ${idPortal ? `'${idPortal}'` : 'NULL'})
`;
                const insertResult = await runQuery(insertSql)
                    .catch(err => {
                        logGenerator(logFileName, 'error', `Insert control table failed for ${displayId}: ${err.message}`);
                        console.error(`  [ERROR] Control table insert failed for ${displayId}: ${err.message}`);
                        return { rowsAffected: [0] };
                    });

                if (insertResult.rowsAffected[0]) {
                    console.log(`  [OK] Control table updated for ${displayId} (status: ${statusTag})`);
                } else {
                    console.warn(`  [WARN] Control table NOT updated for ${displayId}`);
                }
                csvRows.push([
                    displayId, idPortal || '', 'SUCCESS', '', '',
                    matchEntry?.hdr?.total_amount || '', matchEntry?.hdr?.bk_currency || '',
                    matchEntry?.invoices?.length || '', statusTag,
                    insertResult.rowsAffected[0] ? 'YES' : 'NO',
                    new Date().toISOString()
                ]);
                successCount++;
            } else {
                const details = errorMessage || JSON.stringify(result);
                console.error(`  [ERROR] ${displayId} failed: error_code=${errorCode ?? 'N/A'}, message=${details}`);
                logGenerator(logFileName, 'error', `Batch upload failed ${displayId}: code=${errorCode ?? 'N/A'} msg=${details}`);
                csvRows.push([
                    displayId, '', 'ERROR', errorCode || '', details,
                    matchEntry?.hdr?.total_amount || '', matchEntry?.hdr?.bk_currency || '',
                    matchEntry?.invoices?.length || '', '', 'NO',
                    new Date().toISOString()
                ]);
                errorCount++;
            }
        }

        // Detect missing results -- payments sent but not in API response (BTCH-01)
        if (results.length > 0) {
            for (const entry of toUpload) {
                if (!respondedIds.has(entry.hdr.external_id)) {
                    console.warn(`  [WARN] ${entry.hdr.external_id} MISSING RESULT -- not in API response`);
                    logGenerator(logFileName, 'warn',
                        `Batch upload missing result: ${entry.hdr.external_id} not in API response`
                    );
                    csvRows.push([
                        entry.hdr.external_id, '', 'MISSING', '', 'Not in API response',
                        entry.hdr.total_amount || '', entry.hdr.bk_currency || '',
                        entry.invoices?.length || '', '', 'NO',
                        new Date().toISOString()
                    ]);
                    missingCount++;
                }
            }
        }
    } catch (err) {
        const status = err.response ? err.response.status : 'N/A';
        const data = err.response ? JSON.stringify(err.response.data) : err.message;
        console.error(`  [ERROR] Batch upload failed: HTTP ${status} - ${data}`);
        logGenerator(logFileName, 'error', `Batch upload error: ${status} ${data}`);
        errorCount = toUpload.length;
    }

    // Write CSV audit file
    if (csvRows.length > 0) {
        const csvHeaders = [
            'PaymentId', 'PortalId', 'Status', 'ErrorCode', 'ErrorMessage',
            'Amount', 'Currency', 'InvoiceCount', 'PaymentStatus', 'ControlTableInsert', 'Timestamp'
        ];
        const csvPath = appendCsv(CSV_FILE, csvHeaders, csvRows);
        console.log(`\n  [CSV] Audit file: ${csvPath}`);
        logGenerator(logFileName, 'info', `CSV audit written: ${csvPath} (${csvRows.length} rows)`);
    }

    console.log(`\n=== UPLOAD COMPLETE ===`);
    console.log(`  Sent:    ${toUpload.length}`);
    console.log(`  Success: ${successCount}`);
    console.log(`  Errors:  ${errorCount}`);
    if (missingCount > 0) {
        console.log(`  Missing: ${missingCount}`);
    }
    if (categories.ready.length > batchLimit) {
        console.log(`  Remaining: ${categories.ready.length - batchLimit} (run again to process next batch)`);
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const currentDate = getCurrentDateCompact();
    const portalFrom = compactToDashed(fromDate) || oneYearAgoDashed();
    const portalTo = compactToDashed(currentDate);

    console.log('=== PAYMENT RECONCILIATION ===');
    console.log(`Tenant: ${tenantIds[index]} | DB: ${database[index]} | Today: ${currentDate}`);
    console.log(`Mode: ${shouldUpload ? 'UPLOAD' : 'REPORT'} | Portal: PENDING_TO_PAY from ${portalFrom} to ${portalTo}`);
    if (fromDate) console.log(`Sage --from: ${fromDate}`);
    if (pyFilter) console.log(`Sage --py: ${pyFilter}`);
    console.log('');

    // -----------------------------------------------------------------------
    // Step 1: Fetch portal PENDING_TO_PAY invoices
    // -----------------------------------------------------------------------
    console.log('[Step 1] Fetching portal PENDING_TO_PAY invoices...');
    const portalItems = await getPendingToPayInvoices(index, {
        from: portalFrom,
        to: portalTo,
        pageSize: 200
    });

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

    const { categories, autoResolvedCount, autoResolvedSet } = await classifyPayments(deduped, portalUuidMap, index, database[index]);

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
        const tag = autoResolvedSet.has(hdr.external_id) ? ' [AUTO-FIX]' : '';
        console.log(`  ${hdr.external_id}${tag}  | vendor: ${hdr.provider_external_id} | $${amount} ${hdr.bk_currency} | ${invCount} invoice${invCount > 1 ? 's' : ''} | all UUIDs matched`);
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

    // --- PROVIDER MISMATCH ---
    console.log(`\n--- PROVIDER MISMATCH (${categories.provider_mismatch.length}) ---`);
    for (const entry of categories.provider_mismatch) {
        const { hdr, mismatchDetails } = entry;
        const amount = typeof hdr.total_amount === 'number'
            ? hdr.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })
            : hdr.total_amount;
        console.log(`  ${hdr.external_id}  | vendor: ${hdr.provider_external_id} | $${amount} ${hdr.bk_currency}`);
        for (const d of mismatchDetails) {
            console.log(`    - ${d.invoice_external_id}: portal=${d.portal_provider_id} vs sage=${d.sage_providerid}`);
        }
    }

    // --- SUMMARY ---
    const totalProcessed = categories.ready.length + categories.no_providerid.length
        + categories.no_uuid.length + categories.not_in_portal.length
        + categories.provider_mismatch.length;
    console.log('\n=== SUMMARY ===');
    console.log(`  Ready to upload:    ${categories.ready.length}`);
    console.log(`  Missing PROVIDERID: ${categories.no_providerid.length}`);
    console.log(`  Missing UUID:       ${categories.no_uuid.length}`);
    console.log(`  Not in portal:      ${categories.not_in_portal.length}`);
    console.log(`  Provider mismatch:  ${categories.provider_mismatch.length}`);
    console.log(`  Auto-resolved:      ${autoResolvedCount}`);
    console.log(`  TOTAL:              ${totalProcessed}`);

    if (categories.provider_mismatch.length > 0) {
        logGenerator(logFileName, 'warn',
            `Reconciliation summary: ${categories.provider_mismatch.length} payments with provider mismatch`
        );
    }
    if (autoResolvedCount > 0) {
        logGenerator(logFileName, 'info',
            `Reconciliation summary: ${autoResolvedCount} payments auto-resolved`
        );
    }

    await uploadBatch(categories, {
        shouldUpload, batchLimit, index, logFileName,
        tenantIds, apiKeys, apiSecrets, database, URL: config.portal.url
    });
}

// Run only when executed directly (not when required for testing)
if (require.main === module) {
    main().catch(err => {
        console.error('[FATAL] Unexpected error:', err);
        logGenerator(logFileName, 'error', `Fatal: ${err.message}\n${err.stack}`);
        process.exit(1);
    });
}

module.exports = { classifyPayments, uploadBatch };
