/**
 * Pending Payments Diagnostic Script
 *
 * Cruza los 3 sistemas (Portal PENDING_TO_PAY, Sage APIBHO/PY, Control Table)
 * para determinar POR QUÉ cada CFDI sigue pendiente de pago.
 *
 * Genera un CSV con la razón para cada CFDI.
 *
 * Usage:
 *   node src/scripts/pending-payments-diagnostic.js --index=0 --months=15
 */

const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { getCurrentDateString } = require('../utils/TimezoneHelper');
const { getPendingToPayInvoices } = require('../utils/GetTypesCFDI');
const { appendCsv } = require('../utils/CsvWriter');
const config = require('../config');

const LOG_FILE = 'PendingPaymentsDiagnostic';

// --- Console → Log File Interceptor ---
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;
console.log = (...args) => { _origLog.apply(console, args); logGenerator(LOG_FILE, 'info', args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')); };
console.warn = (...args) => { _origWarn.apply(console, args); logGenerator(LOG_FILE, 'warn', args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')); };
console.error = (...args) => { _origError.apply(console, args); logGenerator(LOG_FILE, 'error', args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')); };

const tenantIds = config.portal.tenants.map(t => t.id);
const databases = config.portal.tenants.map(t => t.database);

// --- CLI args ---
const cliArgs = process.argv.slice(2);
let index = 0;
let months = 6;

for (const a of cliArgs) {
    if (a.startsWith('--index=')) index = parseInt(a.split('=')[1], 10);
    if (a.startsWith('--months=')) months = parseInt(a.split('=')[1], 10);
}

const DB = databases[index];

async function main() {
    console.log(`=== DIAGNOSTICO DE PAGOS PENDIENTES ===`);
    console.log(`Tenant: ${tenantIds[index]} | DB: ${DB} | Meses: ${months}`);
    console.log('');

    // Step 1: Fetch portal PENDING_TO_PAY
    console.log('[PASO 1] Obteniendo CFDIs PENDING_TO_PAY del portal...');
    const to = new Date().toISOString().split('T')[0];

    // Try with requested months first; if portal returns 400, retry with shorter range
    let portalItems = [];
    let usedMonths = months;
    for (const tryMonths of [months, 3, 1]) {
        const fromDate = new Date();
        fromDate.setMonth(fromDate.getMonth() - tryMonths);
        const from = fromDate.toISOString().split('T')[0];

        console.log(`  Intentando con rango: ${from} a ${to} (${tryMonths} meses)...`);
        portalItems = await getPendingToPayInvoices(index, { from, to, pageSize: 200 });

        if (portalItems.length > 0 || tryMonths === 1) {
            usedMonths = tryMonths;
            break;
        }
        console.warn(`  [WARN] Portal retornó 0 con ${tryMonths} meses, intentando rango más corto...`);
    }
    console.log(`  Portal: ${portalItems.length} CFDIs PENDING_TO_PAY (rango: ${usedMonths} meses)\n`);

    if (portalItems.length === 0) {
        console.log('No hay CFDIs pendientes. Fin.');
        process.exit(0);
    }

    // Extract UUIDs from portal
    const portalCfdis = portalItems.map(item => ({
        uuid: (item.cfdi?.timbre?.uuid || '').trim().toUpperCase(),
        folio: item.cfdi?.folio || '',
        serie: item.cfdi?.serie || '',
        total: item.cfdi?.total || 0,
        moneda: item.cfdi?.moneda || '',
        rfcEmisor: item.cfdi?.emisor?.rfc || '',
        nombreEmisor: item.cfdi?.emisor?.nombre || '',
        providerId: item.metadata?.provider_id || '',
        portalId: item._id || item.id || '',
    }));

    const allUuids = portalCfdis.map(c => c.uuid).filter(u => u.length > 0);
    console.log(`[PASO 2] Verificando ${allUuids.length} UUIDs en Sage APIBHO...`);

    // Step 2: Check which UUIDs exist in APIBHO
    const uuidChunks = [];
    const CHUNK_SIZE = 200;
    for (let i = 0; i < allUuids.length; i += CHUNK_SIZE) {
        uuidChunks.push(allUuids.slice(i, i + CHUNK_SIZE));
    }

    const uuidsInApibho = new Set();
    for (const chunk of uuidChunks) {
        const inList = chunk.map(u => `'${u}'`).join(',');
        try {
            const result = await runQuery(`
                USE [${DB}];
                SELECT DISTINCT UPPER(RTRIM(O.[VALUE])) AS UUID
                FROM APIBHO O
                JOIN APIBH H ON O.CNTBTCH = H.CNTBTCH AND O.CNTITEM = H.CNTITEM
                WHERE O.OPTFIELD = 'FOLIOCFD'
                  AND H.ERRENTRY = 0
                  AND UPPER(RTRIM(O.[VALUE])) IN (${inList})
            `, DB);
            for (const row of result.recordset) {
                uuidsInApibho.add(row.UUID);
            }
        } catch (err) {
            console.error(`  Error consultando APIBHO chunk: ${err.message}`);
        }
    }
    console.log(`  UUID en APIBHO: ${uuidsInApibho.size} de ${allUuids.length}\n`);

    // Step 3: Find PY payments for UUIDs that ARE in APIBHO
    console.log(`[PASO 3] Buscando pagos PY en Sage para UUIDs con match...`);

    const uuidsWithPayment = new Map(); // uuid -> { docNbr, vendor, amount }
    const apibhoUuids = [...uuidsInApibho];

    for (let i = 0; i < apibhoUuids.length; i += CHUNK_SIZE) {
        const chunk = apibhoUuids.slice(i, i + CHUNK_SIZE);
        const inList = chunk.map(u => `'${u}'`).join(',');
        try {
            const result = await runQuery(`
                USE [${DB}];
                SELECT DISTINCT
                    UPPER(RTRIM(O.[VALUE])) AS UUID,
                    RTRIM(R.DOCNBR) AS DOCNBR,
                    RTRIM(R.IDVEND) AS VENDOR,
                    R.AMTRMIT AS AMOUNT,
                    CASE BK.CURNSTMT WHEN 'MXP' THEN 'MXN' ELSE BK.CURNSTMT END AS CURRENCY
                FROM APIBHO O
                JOIN APIBH H ON O.CNTBTCH = H.CNTBTCH AND O.CNTITEM = H.CNTITEM AND H.ERRENTRY = 0
                JOIN APIBC C ON H.CNTBTCH = C.CNTBTCH AND C.BTCHSTTS = 3
                JOIN APTCP DP ON DP.IDVEND = H.IDVEND AND DP.IDINVC = H.IDINVC
                    AND DP.BATCHTYPE = 'PY' AND DP.DOCTYPE = 1
                JOIN APTCR R ON R.CNTBTCH = DP.CNTBTCH AND R.CNTENTR = DP.CNTRMIT
                JOIN APBTA B ON B.PAYMTYPE = R.BTCHTYPE AND B.CNTBTCH = R.CNTBTCH
                JOIN BKACCT BK ON B.IDBANK = BK.BANK
                WHERE O.OPTFIELD = 'FOLIOCFD'
                    AND UPPER(RTRIM(O.[VALUE])) IN (${inList})
                    AND B.PAYMTYPE = 'PY'
                    AND B.BATCHSTAT = 3
                    AND R.ERRENTRY = 0
                    AND R.RMITTYPE = 1
            `, DB);
            for (const row of result.recordset) {
                uuidsWithPayment.set(row.UUID, {
                    docNbr: row.DOCNBR,
                    vendor: row.VENDOR,
                    amount: row.AMOUNT,
                    currency: row.CURRENCY
                });
            }
        } catch (err) {
            console.error(`  Error buscando pagos PY chunk: ${err.message}`);
        }
    }
    console.log(`  UUIDs con pago PY: ${uuidsWithPayment.size}\n`);

    // Step 4: Check control table for all found payments
    console.log(`[PASO 4] Verificando control table fesaPagosFocaltec...`);

    const paymentDocNbrs = [...new Set([...uuidsWithPayment.values()].map(p => p.docNbr))];
    const inControlTable = new Set();

    if (paymentDocNbrs.length > 0) {
        for (let i = 0; i < paymentDocNbrs.length; i += CHUNK_SIZE) {
            const chunk = paymentDocNbrs.slice(i, i + CHUNK_SIZE);
            const inList = chunk.map(d => `'${d}'`).join(',');
            try {
                const result = await runQuery(`
                    SELECT DISTINCT RTRIM(NoPagoSage) AS DOCNBR
                    FROM fesa.dbo.fesaPagosFocaltec
                    WHERE idCia = '${DB}'
                      AND NoPagoSage IN (${inList})
                `);
                for (const row of result.recordset) {
                    inControlTable.add(row.DOCNBR);
                }
            } catch (err) {
                console.error(`  Error consultando control table: ${err.message}`);
            }
        }
    }
    console.log(`  Pagos en control table: ${inControlTable.size} de ${paymentDocNbrs.length}\n`);

    // Step 5: Classify each portal CFDI
    console.log(`[PASO 5] Clasificando ${portalCfdis.length} CFDIs...\n`);

    const csvRows = [];
    const categories = {
        'SIN_UUID_EN_SAGE': 0,          // UUID no existe en APIBHO
        'SIN_PAGO_EN_SAGE': 0,          // UUID existe pero no hay PY payment
        'PAGO_YA_SUBIDO': 0,            // Pago existe Y está en control table (portal-side issue)
        'PAGO_PENDIENTE_SUBIR': 0,      // Pago existe pero NO está en control table
        'SIN_UUID_PORTAL': 0,           // No tiene UUID
    };

    for (const cfdi of portalCfdis) {
        let reason = '';
        let category = '';
        let sagePago = '';
        let sageVendor = '';
        let sageAmount = '';
        let sageCurrency = '';
        let enControlTable = '';

        if (!cfdi.uuid) {
            category = 'SIN_UUID_PORTAL';
            reason = 'CFDI no tiene UUID en el portal';
        } else if (!uuidsInApibho.has(cfdi.uuid)) {
            category = 'SIN_UUID_EN_SAGE';
            reason = 'UUID no encontrado en APIBHO de Sage — factura no capturada o UUID no registrado';
        } else if (!uuidsWithPayment.has(cfdi.uuid)) {
            category = 'SIN_PAGO_EN_SAGE';
            reason = 'UUID existe en Sage pero no tiene pago PY asociado — factura pendiente de pago';
        } else {
            const payment = uuidsWithPayment.get(cfdi.uuid);
            sagePago = payment.docNbr;
            sageVendor = payment.vendor;
            sageAmount = payment.amount;
            sageCurrency = payment.currency;

            if (inControlTable.has(payment.docNbr)) {
                category = 'PAGO_YA_SUBIDO';
                reason = `Pago ${payment.docNbr} YA fue subido al portal (en control table) — pendiente del lado del portal/proveedor`;
                enControlTable = 'SI';
            } else {
                category = 'PAGO_PENDIENTE_SUBIR';
                reason = `Pago ${payment.docNbr} existe en Sage pero NO ha sido subido al portal (falta en control table)`;
                enControlTable = 'NO';
            }
        }

        categories[category]++;

        csvRows.push([
            cfdi.uuid,
            cfdi.folio,
            cfdi.serie,
            cfdi.total,
            cfdi.moneda,
            cfdi.rfcEmisor,
            cfdi.nombreEmisor,
            category,
            reason,
            sagePago,
            sageVendor,
            sageAmount,
            sageCurrency,
            enControlTable,
        ]);
    }

    // Print summary
    console.log('=== RESUMEN DE DIAGNOSTICO ===');
    console.log(`  Total CFDIs PENDING_TO_PAY:         ${portalCfdis.length}`);
    console.log('');
    console.log(`  SIN_UUID_EN_SAGE:                   ${categories.SIN_UUID_EN_SAGE}`);
    console.log(`    → UUID del portal no existe en Sage. Factura no capturada.`);
    console.log(`  SIN_PAGO_EN_SAGE:                   ${categories.SIN_PAGO_EN_SAGE}`);
    console.log(`    → Factura existe en Sage pero no tiene pago PY. Pendiente de pago real.`);
    console.log(`  PAGO_PENDIENTE_SUBIR:               ${categories.PAGO_PENDIENTE_SUBIR}`);
    console.log(`    → Pago existe pero no fue subido. ACCION: subir al portal.`);
    console.log(`  PAGO_YA_SUBIDO:                     ${categories.PAGO_YA_SUBIDO}`);
    console.log(`    → Pago ya fue subido. Pendiente del lado del portal/proveedor.`);
    console.log(`  SIN_UUID_PORTAL:                    ${categories.SIN_UUID_PORTAL}`);
    console.log(`    → CFDI sin UUID en el portal.`);

    // Write CSV
    const csvHeaders = [
        'UUID', 'Folio', 'Serie', 'Total', 'Moneda',
        'RFC_Emisor', 'Nombre_Emisor',
        'Categoria', 'Razon',
        'Pago_Sage', 'Vendor_Sage', 'Monto_Pago', 'Moneda_Pago',
        'En_Control_Table'
    ];

    const csvPath = appendCsv('PendingPayments-Diagnostic', csvHeaders, csvRows);
    console.log(`\n  [CSV] Reporte: ${csvPath}`);
    console.log(`  [LOG] Log: logs/sageconnect/${getCurrentDateString()}/${LOG_FILE}.log`);
}

main().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});
