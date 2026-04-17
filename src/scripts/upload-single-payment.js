/**
 * Targeted Single Payment Upload Script
 *
 * Uploads ONE specific PY payment to the portal bypassing the PENDING_TO_PAY
 * cross-reference. Use when the invoice is already in PENDING_PAYMENT_CFDI
 * status (e.g. split payments -- second exhibition of a partial payment)
 * or when the invoice is outside the 3-month portal window.
 *
 * Trusts portal validation: if the payment is invalid, the API returns an
 * error and NOTHING is recorded in the control table.
 *
 * Usage:
 *   node src/scripts/upload-single-payment.js --index=0 --py PY0062112
 *   node src/scripts/upload-single-payment.js --index=0 --py PY0062112 --dry-run
 */

const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const axios = require('axios');
const config = require('../config');

const LOG_FILE = 'UploadSinglePayment';

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
    console.error('[ERROR] Falta --py <DOCNBR>. Ejemplo: --py PY0062112');
    process.exit(1);
}

const DB = databases[index];

async function main() {
    console.log('=== UPLOAD SINGLE PAYMENT ===');
    console.log(`Tenant: ${tenantIds[index]} | DB: ${DB}`);
    console.log(`Payment: ${pyDoc} | Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
    console.log('');

    // Step 1: Check if payment is already in control table
    const controlCheck = await runQuery(
        `SELECT status, idFocaltec FROM fesa.dbo.fesaPagosFocaltec
         WHERE idCia = '${DB}' AND NoPagoSage = '${pyDoc}'`
    );
    if (controlCheck.recordset.length > 0) {
        const row = controlCheck.recordset[0];
        console.warn(`[ABORT] ${pyDoc} ya está en control table (status=${row.status}, idFocaltec=${row.idFocaltec || 'NULL'})`);
        console.warn('Si quieres reenviar, primero borra manualmente el registro de fesaPagosFocaltec.');
        process.exit(0);
    }

    // Step 2: Fetch payment header from Sage
    console.log(`[Step 1] Consultando pago ${pyDoc} en Sage...`);
    const headerQuery = `
SELECT
    P.CNTBTCH AS LotePago,
    P.CNTENTR AS AsientoPago,
    RTRIM(BK.ADDR1) AS bank_account_id,
    P.DATEBUS AS FechaAsentamiento,
    RTRIM(P.DOCNBR) AS external_id,
    P.TEXTRMIT AS comments,
    P.TXTRMITREF AS reference,
    CASE BK.CURNSTMT WHEN 'MXP' THEN 'MXN' ELSE BK.CURNSTMT END AS bk_currency,
    P.DATERMIT AS payment_date,
    RTRIM(P.IDVEND) AS provider_external_id,
    P.AMTRMIT AS total_amount,
    'TRANSFER' AS operation_type,
    P.RATEEXCHHC AS TipoCambioPago,
    ISNULL((SELECT [VALUE] FROM APVENO WHERE OPTFIELD = 'PROVIDERID' AND VENDORID = P.IDVEND), '') AS PROVIDERID
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
        console.error(`[ERROR] Múltiples registros para ${pyDoc}. Hay ${headerResult.recordset.length} resultados. Abortando.`);
        process.exit(1);
    }
    const hdr = headerResult.recordset[0];
    console.log(`  Pago encontrado: ${hdr.external_id}`);
    console.log(`  Vendor: ${hdr.provider_external_id} (PROVIDERID=${hdr.PROVIDERID || 'FALTA'})`);
    console.log(`  Monto: ${hdr.total_amount} ${hdr.bk_currency}`);
    console.log(`  Lote/Asiento: ${hdr.LotePago}/${hdr.AsientoPago}`);

    if (!hdr.PROVIDERID || !hdr.PROVIDERID.trim()) {
        console.error(`[ERROR] PROVIDERID vacío para vendor ${hdr.provider_external_id}. No se puede subir.`);
        process.exit(1);
    }

    // Step 3: Fetch invoices
    console.log('\n[Step 2] Consultando facturas del pago...');
    const invoicesQuery = `
SELECT DISTINCT
    RTRIM(DP.IDINVC) AS invoice_external_id,
    H.CNTBTCH AS inv_batch,
    H.CNTITEM AS inv_entry,
    CASE H.CODECURN WHEN 'MXP' THEN 'MXN' ELSE H.CODECURN END AS invoice_currency,
    H.EXCHRATEHC AS invoice_exchange_rate,
    DP.AMTPAYM AS payment_amount,
    ISNULL(
        (SELECT SWPAID FROM APOBL WHERE IDINVC = DP.IDINVC AND IDVEND = DP.IDVEND),
        0
    ) AS FULL_PAID,
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
        console.error(`[ERROR] No hay facturas para el pago ${pyDoc}.`);
        process.exit(1);
    }

    console.log(`  Facturas encontradas: ${invoicesResult.recordset.length}`);
    for (const inv of invoicesResult.recordset) {
        const uuid = inv.UUID || '(FALTA UUID)';
        console.log(`    - ${inv.invoice_external_id} | ${inv.payment_amount} ${inv.invoice_currency} | UUID: ${uuid}`);
    }

    const missing = invoicesResult.recordset.filter(inv => !inv.UUID || !inv.UUID.trim());
    if (missing.length > 0) {
        console.error(`[ERROR] ${missing.length} factura(s) sin UUID. No se puede subir sin UUIDs.`);
        process.exit(1);
    }

    // Step 4: Build payload
    const cfdis = invoicesResult.recordset.map(inv => {
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

    const allFull = invoicesResult.recordset.every(inv => inv.FULL_PAID === 1 || inv.FULL_PAID === '1');
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

    console.log('\n[Step 3] Payload construido:');
    console.log(JSON.stringify(payload, null, 2));

    if (dryRun) {
        console.log('\n[DRY-RUN] Sin envío al portal. Corre sin --dry-run para enviar.');
        process.exit(0);
    }

    // Step 5: Send to portal
    const endpoint = `${config.portal.url}/api/1.0/extern/tenants/${tenantIds[index]}/payments`;
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
        const body = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.error(`[ERROR] Portal rechazó el pago: HTTP ${status}`);
        console.error(`  Body: ${body}`);
        process.exit(1);
    }

    if (resp.status !== 200) {
        console.error(`[ERROR] Respuesta inesperada del portal: HTTP ${resp.status}`);
        console.error(`  Body: ${JSON.stringify(resp.data)}`);
        process.exit(1);
    }

    const idPortal = resp.data?.id;
    console.log(`  [OK] Pago ${pyDoc} enviado exitosamente (HTTP 200)`);
    if (idPortal) console.log(`  [INFO] ID asignado por portal: ${idPortal}`);

    // Step 6: Register in control table
    const statusTag = allFull ? 'PAID' : 'PARTIAL';
    const insertSql = `
INSERT INTO fesa.dbo.fesaPagosFocaltec (idCia, NoPagoSage, status, idFocaltec)
VALUES ('${DB}', '${pyDoc}', '${statusTag}', ${idPortal ? `'${idPortal}'` : 'NULL'})
`;
    console.log(`\n[Step 5] INSERT control table (status=${statusTag}, idFocaltec=${idPortal || 'NULL'})`);
    const insertResult = await runQuery(insertSql);
    if (insertResult.rowsAffected[0]) {
        console.log(`  [OK] Registro insertado en fesaPagosFocaltec.`);
    } else {
        console.warn(`  [WARN] INSERT no afectó filas. Verifica manualmente.`);
    }

    console.log('\n=== COMPLETE ===');
}

main().catch(err => {
    console.error('[FATAL]', err.message);
    console.error(err.stack);
    process.exit(1);
});
