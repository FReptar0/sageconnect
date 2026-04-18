/**
 * Mark Payment Invoices as Paid (without generating payment CFDI)
 *
 * For a given PY payment, fetches all its invoices from Sage and calls
 * the portal's mark-as-paid endpoint to flag them as paid without
 * requiring the provider to upload the complemento de pago.
 *
 * Use case: partial payments where some invoices reached the portal
 * and some didn't. The portal's /cfdis/mark-as-paid handles per-invoice
 * results (paid vs failed), so we can send all invoices and trust the
 * portal to skip the ones it cannot process.
 *
 * Endpoint: POST /api/1.0/extern/tenants/{tenantId}/cfdis/mark-as-paid
 * Body: BatchCfdisAsPaidRequest { cfdis: [{document_type, provider_external_id, uuid}] }
 *
 * Usage:
 *   node src/scripts/mark-payment-invoices-paid.js --index=0 --py PY0061148
 *   node src/scripts/mark-payment-invoices-paid.js --index=0 --py PY0061148 --dry-run
 */

const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const axios = require('axios');
const config = require('../config');

const LOG_FILE = 'MarkPaymentInvoicesPaid';

// --- Console -> Log mirror ---
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;
console.log = (...args) => { _origLog.apply(console, args); logGenerator(LOG_FILE, 'info', args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')); };
console.warn = (...args) => { _origWarn.apply(console, args); logGenerator(LOG_FILE, 'warn', args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')); };
console.error = (...args) => { _origError.apply(console, args); logGenerator(LOG_FILE, 'error', args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')); };

const tenantIds = config.portal.tenants.map(t => t.id);
const apiKeys = config.portal.tenants.map(t => t.key);
const apiSecrets = config.portal.tenants.map(t => t.secret);
const databases = config.portal.tenants.map(t => t.database);

// --- CLI parsing ---
const cliArgs = process.argv.slice(2);
let index = 0;
let pyDoc = null;
let dryRun = false;

for (let i = 0; i < cliArgs.length; i++) {
    const a = cliArgs[i];
    if (a.startsWith('--index=')) {
        index = parseInt(a.split('=')[1], 10);
    } else if (a === '--py' && cliArgs[i + 1]) {
        pyDoc = cliArgs[i + 1];
        i++;
    } else if (a === '--dry-run') {
        dryRun = true;
    }
}

if (!pyDoc) {
    console.error('[ERROR] Falta --py <DOCNBR>. Ejemplo: --py PY0061148');
    process.exit(1);
}

const DB = databases[index];

async function main() {
    console.log('=== MARK PAYMENT INVOICES AS PAID ===');
    console.log(`Tenant: ${tenantIds[index]} | DB: ${DB}`);
    console.log(`Payment: ${pyDoc} | Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
    console.log('');

    // Step 1: Fetch payment header + vendor info
    console.log(`[Step 1] Consultando pago ${pyDoc} en Sage...`);
    const headerQuery = `
SELECT
    P.CNTBTCH AS LotePago,
    P.CNTENTR AS AsientoPago,
    RTRIM(P.DOCNBR) AS external_id,
    RTRIM(P.IDVEND) AS provider_external_id,
    P.AMTRMIT AS total_amount,
    CASE BK.CURNSTMT WHEN 'MXP' THEN 'MXN' ELSE BK.CURNSTMT END AS bk_currency
FROM APBTA B
JOIN BKACCT BK ON B.IDBANK = BK.BANK
JOIN APTCR P ON B.PAYMTYPE = P.BTCHTYPE AND B.CNTBTCH = P.CNTBTCH
WHERE B.PAYMTYPE = 'PY'
    AND B.BATCHSTAT = 3
    AND P.ERRENTRY = 0
    AND P.RMITTYPE = 1
    AND P.DOCNBR = '${pyDoc}'
`;
    const headerResult = await runQuery(headerQuery, DB);
    if (headerResult.recordset.length === 0) {
        console.error(`[ERROR] No se encontró pago ${pyDoc} en Sage (asentado, sin errores).`);
        process.exit(1);
    }
    if (headerResult.recordset.length > 1) {
        console.error(`[ERROR] Múltiples registros para ${pyDoc} (${headerResult.recordset.length}). Abortando.`);
        process.exit(1);
    }
    const hdr = headerResult.recordset[0];
    console.log(`  Vendor: ${hdr.provider_external_id}`);
    console.log(`  Monto: ${hdr.total_amount} ${hdr.bk_currency}`);
    console.log(`  Lote/Asiento: ${hdr.LotePago}/${hdr.AsientoPago}`);

    // Step 2: Fetch all invoices of the payment with UUIDs
    console.log('\n[Step 2] Consultando facturas del pago con UUIDs...');
    const invoicesQuery = `
SELECT DISTINCT
    RTRIM(DP.IDINVC) AS invoice_external_id,
    DP.AMTPAYM AS payment_amount,
    CASE H.CODECURN WHEN 'MXP' THEN 'MXN' ELSE H.CODECURN END AS invoice_currency,
    ISNULL(
        (SELECT RTRIM([VALUE]) FROM APIBHO
         WHERE CNTBTCH = H.CNTBTCH AND CNTITEM = H.CNTITEM AND OPTFIELD = 'FOLIOCFD'),
        ''
    ) AS UUID
FROM APTCP DP
JOIN APTCR R ON R.CNTBTCH = DP.CNTBTCH AND R.CNTENTR = DP.CNTRMIT
JOIN APIBH H ON DP.IDVEND = H.IDVEND AND DP.IDINVC = H.IDINVC AND H.ERRENTRY = 0
JOIN APIBC C ON H.CNTBTCH = C.CNTBTCH AND C.BTCHSTTS = 3
WHERE DP.BATCHTYPE = 'PY'
    AND DP.CNTBTCH = ${hdr.LotePago}
    AND DP.CNTRMIT = ${hdr.AsientoPago}
    AND DP.DOCTYPE = 1
`;
    const invoicesResult = await runQuery(invoicesQuery, DB);
    if (invoicesResult.recordset.length === 0) {
        console.error(`[ERROR] No hay facturas asociadas a ${pyDoc}.`);
        process.exit(1);
    }
    console.log(`  Facturas encontradas: ${invoicesResult.recordset.length}`);

    const withUuid = invoicesResult.recordset.filter(inv => inv.UUID && inv.UUID.trim());
    const withoutUuid = invoicesResult.recordset.filter(inv => !inv.UUID || !inv.UUID.trim());

    if (withoutUuid.length > 0) {
        console.warn(`  [WARN] ${withoutUuid.length} factura(s) sin UUID -- se omitirán:`);
        for (const inv of withoutUuid) {
            console.warn(`    - ${inv.invoice_external_id}`);
        }
    }
    console.log(`  Facturas con UUID a procesar: ${withUuid.length}`);

    if (withUuid.length === 0) {
        console.error('[ERROR] No hay facturas con UUID para marcar como pagadas.');
        process.exit(1);
    }

    // Step 3: Build payload
    const cfdis = withUuid.map(inv => ({
        document_type: 'CFDI',
        provider_external_id: hdr.provider_external_id,
        uuid: inv.UUID.toUpperCase()
    }));

    const payload = { cfdis };

    console.log('\n[Step 3] Payload construido:');
    console.log(JSON.stringify(payload, null, 2));

    if (dryRun) {
        console.log('\n[DRY-RUN] Sin envío al portal. Corre sin --dry-run para marcar.');
        process.exit(0);
    }

    // Step 4: Send to portal
    const endpoint = `${config.portal.url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis/mark-as-paid`;
    console.log(`\n[Step 4] POST ${endpoint}`);

    let resp;
    try {
        resp = await axios.post(endpoint, payload, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index],
                'Content-Type': 'application/json'
            }
        });
    } catch (err) {
        const status = err.response?.status || 'N/A';
        const body = err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message;
        console.error(`[ERROR] Portal rechazó la petición: HTTP ${status}`);
        console.error(`  Body: ${body}`);
        process.exit(1);
    }

    if (resp.status !== 200) {
        console.error(`[ERROR] Respuesta inesperada: HTTP ${resp.status}`);
        console.error(`  Body: ${JSON.stringify(resp.data)}`);
        process.exit(1);
    }

    // Step 5: Parse response
    const data = resp.data || {};
    const paidInvoices = data.paid_invoices || [];
    const failedInvoices = data.failed_invoices || [];
    const batchId = data.id || 'N/A';

    console.log(`\n[Step 5] Respuesta del portal (batch id: ${batchId}):`);
    console.log(`  Paid invoices:   ${paidInvoices.length}`);
    console.log(`  Failed invoices: ${failedInvoices.length}`);

    if (paidInvoices.length > 0) {
        console.log('\n  --- MARCADAS COMO PAGADAS ---');
        for (const inv of paidInvoices) {
            console.log(`    [OK] UUID: ${inv.uuid || inv.cfdi?.timbre?.uuid || '(sin uuid)'} | folio: ${inv.cfdi?.folio || ''} | id: ${inv.id || ''}`);
        }
    }

    if (failedInvoices.length > 0) {
        console.log('\n  --- FALLIDAS ---');
        for (const f of failedInvoices) {
            console.log(`    [FAIL] UUID: ${f.uuid || '(sin uuid)'} | code: ${f.error_code} | msg: ${f.error_message}`);
        }
    }

    // Step 6: Update control table if all succeeded
    if (failedInvoices.length === 0 && paidInvoices.length > 0) {
        console.log('\n[Step 6] Todas marcadas exitosamente. Actualizando control table a PAID...');
        const updateSql = `
UPDATE fesa.dbo.fesaPagosFocaltec
SET status = 'PAID'
WHERE idCia = '${DB}' AND NoPagoSage = '${pyDoc}' AND status <> 'PAID'
`;
        const updateResult = await runQuery(updateSql);
        if (updateResult.rowsAffected[0]) {
            console.log(`  [OK] Control table actualizada (${updateResult.rowsAffected[0]} fila).`);
        } else {
            console.log(`  [INFO] Control table ya estaba en PAID o el pago no está registrado.`);
        }
    } else if (failedInvoices.length > 0) {
        console.log('\n[Step 6] Hay fallas; control table no se actualiza. Revisa manualmente.');
    }

    console.log('\n=== COMPLETE ===');
}

main().catch(err => {
    console.error('[FATAL]', err.message);
    console.error(err.stack);
    process.exit(1);
});
