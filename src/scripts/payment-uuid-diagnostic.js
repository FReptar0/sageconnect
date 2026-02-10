/**
 * Diagnostic script: Check if invoices linked to PY payments have UUIDs (FOLIOCFD) set in APIBHO.
 *
 * Usage:
 *   node src/scripts/payment-uuid-diagnostic.js PY0061652
 *   node src/scripts/payment-uuid-diagnostic.js PY0061652 PY0061666 PY0061691
 *   node src/scripts/payment-uuid-diagnostic.js --all-failing     (checks all PYs not in control table)
 */
const { runQuery } = require('../utils/SQLServerConnection');
const dotenv = require('dotenv');

const credentials = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const database = credentials.DATABASES.split(',');
const DB = database[0]; // Use first database by default

async function diagnosePayment(docNbr) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`  DIAGNOSTIC FOR: ${docNbr}`);
    console.log(`${'='.repeat(80)}`);

    // 1) Get payment header info
    const headerQuery = `
    SELECT
        P.CNTBTCH    AS LotePago,
        P.CNTENTR    AS AsientoPago,
        RTRIM(P.DOCNBR)   AS external_id,
        RTRIM(P.IDVEND)   AS provider_external_id,
        P.AMTRMIT    AS total_amount,
        RTRIM(BK.ADDR1)   AS bank_account_id,
        CASE BK.CURNSTMT WHEN 'MXP' THEN 'MXN' ELSE BK.CURNSTMT END AS bk_currency,
        ISNULL(
            (SELECT RTRIM([VALUE]) FROM APVENO WHERE OPTFIELD='PROVIDERID' AND VENDORID=P.IDVEND),
            ''
        ) AS PROVIDERID,
        ISNULL(
            (SELECT RTRIM([VALUE]) FROM APVENO WHERE OPTFIELD='RFC' AND VENDORID=P.IDVEND),
            ''
        ) AS RFC
    FROM APBTA B
    JOIN BKACCT BK ON B.IDBANK = BK.BANK
    JOIN APTCR P ON B.PAYMTYPE = P.BTCHTYPE AND B.CNTBTCH = P.CNTBTCH
    WHERE B.PAYMTYPE = 'PY'
        AND P.ERRENTRY = 0
        AND P.RMITTYPE = 1
        AND RTRIM(P.DOCNBR) = '${docNbr}'
    `;

    let header;
    try {
        const result = await runQuery(headerQuery, DB);
        if (result.recordset.length === 0) {
            console.log(`  [NOT FOUND] Payment ${docNbr} not found in APTCR.`);
            return;
        }
        header = result.recordset[0];
    } catch (err) {
        console.error(`  [ERROR] Failed to query header: ${err.message}`);
        return;
    }

    console.log(`\n  --- Payment Header ---`);
    console.log(`  Vendor:       ${header.provider_external_id}`);
    console.log(`  RFC:          ${header.RFC || '(empty)'}`);
    console.log(`  PROVIDERID:   ${header.PROVIDERID || '** EMPTY - This vendor will be skipped **'}`);
    console.log(`  Amount:       ${header.total_amount} ${header.bk_currency}`);
    console.log(`  Bank Account: ${header.bank_account_id}`);
    console.log(`  Batch/Entry:  ${header.LotePago} / ${header.AsientoPago}`);

    // 2) Check control table
    const controlQuery = `
    SELECT NoPagoSage, status, idFocaltec
    FROM fesa.dbo.fesaPagosFocaltec
    WHERE NoPagoSage = '${docNbr}'
    `;

    try {
        const controlResult = await runQuery(controlQuery);
        if (controlResult.recordset.length > 0) {
            const ctrl = controlResult.recordset[0];
            console.log(`\n  --- Control Table ---`);
            console.log(`  Status:      ${ctrl.status}`);
            console.log(`  idFocaltec:  ${ctrl.idFocaltec || 'NULL'}`);
            console.log(`  ** This payment IS in the control table - it will NOT be retried **`);
        } else {
            console.log(`\n  --- Control Table ---`);
            console.log(`  ** NOT in control table - this payment WILL be retried every cycle **`);
        }
    } catch (err) {
        console.error(`  [ERROR] Failed to check control table: ${err.message}`);
    }

    // 3) Get associated invoices and their UUID status
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
            '** NOT SET **'
        ) AS UUID_APIBHO,
        -- Check if FOLIOCFD optional field record exists at all
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
        AND DP.CNTBTCH   = ${header.LotePago}
        AND DP.CNTRMIT   = ${header.AsientoPago}
        AND DP.DOCTYPE   = 1
    `;

    let invoices;
    try {
        const invResult = await runQuery(invoiceQuery, DB);
        invoices = invResult.recordset;
    } catch (err) {
        console.error(`  [ERROR] Failed to query invoices: ${err.message}`);
        return;
    }

    if (invoices.length === 0) {
        console.log(`\n  --- Invoices ---`);
        console.log(`  ** NO invoices found for this payment **`);
        return;
    }

    console.log(`\n  --- Invoices (${invoices.length}) ---`);

    let hasEmptyUUID = false;
    let hasNoRow = false;

    for (const inv of invoices) {
        const uuidStatus = inv.UUID_APIBHO === '** NOT SET **'
            ? (inv.FOLIOCFD_ROW_EXISTS === 0 ? 'NO ROW IN APIBHO' : 'ROW EXISTS BUT EMPTY')
            : inv.UUID_APIBHO;

        const isEmpty = inv.UUID_APIBHO === '** NOT SET **' || inv.UUID_APIBHO.trim() === '';
        if (isEmpty) hasEmptyUUID = true;
        if (inv.FOLIOCFD_ROW_EXISTS === 0) hasNoRow = true;

        const paidLabel = (inv.FULL_PAID === 1 || inv.FULL_PAID === '1') ? 'FULLY PAID' : 'PARTIAL/UNPAID';

        console.log(`\n  Invoice: ${inv.invoice_external_id}`);
        console.log(`    Batch/Entry:     ${inv.inv_batch} / ${inv.inv_entry}`);
        console.log(`    Amount:          ${inv.invoice_amount} ${inv.invoice_currency}`);
        console.log(`    Exchange Rate:   ${inv.invoice_exchange_rate}`);
        console.log(`    Payment Amount:  ${inv.payment_amount}`);
        console.log(`    Paid Status:     ${paidLabel}`);
        console.log(`    FOLIOCFD row:    ${inv.FOLIOCFD_ROW_EXISTS > 0 ? 'EXISTS' : '** MISSING **'}`);
        console.log(`    UUID (APIBHO):   ${isEmpty ? `** EMPTY ** (${uuidStatus})` : uuidStatus}`);
    }

    // 4) Summary & diagnosis
    console.log(`\n  --- DIAGNOSIS ---`);

    if (!header.PROVIDERID) {
        console.log(`  [PROBLEM] Vendor ${header.provider_external_id} has no PROVIDERID.`);
        console.log(`            -> Fix: Set PROVIDERID optional field in Sage AP > Vendors > Optional Fields.`);
    }

    if (hasEmptyUUID) {
        console.log(`  [PROBLEM] One or more invoices have EMPTY UUID (FOLIOCFD) in APIBHO.`);
        console.log(`            -> This causes API error 400, code 2390: "Undefined document type for cfdis"`);
        console.log(`            -> The portal API cannot determine documentType without a valid UUID.`);
        if (hasNoRow) {
            console.log(`  [DETAIL]  Some invoices don't even have the FOLIOCFD row in APIBHO.`);
            console.log(`            -> This means the external import process (exe) never set it,`);
            console.log(`               or the invoice was entered directly in Sage without going`);
            console.log(`               through the CFDI_Downloader -> exe import flow.`);
        }
        console.log(`            -> Fix: The FOLIOCFD must be set either by the import exe or manually.`);
    }

    if (!hasEmptyUUID && header.PROVIDERID) {
        console.log(`  [OK] All invoices have UUIDs and vendor has PROVIDERID.`);
        console.log(`       If this payment still fails, the issue may be:`);
        console.log(`       - 404 (1800): UUIDs not registered in Portal de Proveedores`);
        console.log(`       - 406 (1827): CFDIs already marked as paid in the portal`);
    }
}

async function getAllFailingPayments() {
    console.log(`\nSearching for all PY payments NOT in control table (potential infinite retriers)...\n`);

    const query = `
    SELECT RTRIM(P.DOCNBR) AS external_id
    FROM APBTA B
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

    try {
        const result = await runQuery(query, DB);
        const docs = result.recordset.map(r => r.external_id.trim());
        console.log(`Found ${docs.length} payments not in control table:`);
        docs.forEach(d => console.log(`  - ${d}`));
        return docs;
    } catch (err) {
        console.error(`Error querying failing payments: ${err.message}`);
        return [];
    }
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Usage:');
        console.log('  node src/scripts/payment-uuid-diagnostic.js PY0061652');
        console.log('  node src/scripts/payment-uuid-diagnostic.js PY0061652 PY0061666 PY0061691');
        console.log('  node src/scripts/payment-uuid-diagnostic.js --all-failing');
        process.exit(1);
    }

    let paymentIds;

    if (args[0] === '--all-failing') {
        paymentIds = await getAllFailingPayments();
        if (paymentIds.length === 0) {
            console.log('No failing payments found.');
            process.exit(0);
        }
    } else {
        paymentIds = args;
    }

    for (const pyId of paymentIds) {
        await diagnosePayment(pyId);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('  DIAGNOSTIC COMPLETE');
    console.log(`${'='.repeat(80)}\n`);
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
