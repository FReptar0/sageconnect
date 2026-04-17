/**
 * Payment Status Check (read-only)
 *
 * Queries the portal for the CURRENT status of a list of payments by
 * their external_id (Sage DOCNBR). No side effects -- pure diagnostic.
 *
 * Useful for verifying that reported statuses (from emails, tickets) are
 * still current before taking action on stuck payments.
 *
 * Endpoint: GET /api/1.0/extern/tenants/{tenantId}/payments/{paymentId}?id_type=EXTERNAL
 *
 * Usage:
 *   node src/scripts/payment-status-check.js --index=0
 *   node src/scripts/payment-status-check.js --index=0 --py PY0061148,PY0061666
 *   node src/scripts/payment-status-check.js --index=0 --file path/to/list.txt
 */

const { logGenerator } = require('../utils/LogGenerator');
const { appendCsv } = require('../utils/CsvWriter');
const axios = require('axios');
const fs = require('fs');
const config = require('../config');

const LOG_FILE = 'PaymentStatusCheck';
const CSV_FILE = 'PaymentStatusCheck';

// Default list: the 12 payments Memo reported with partial invoices
const DEFAULT_PAYMENTS = [
    'PY0060654', 'PY0060686', 'PY0060822', 'PY0060971', 'PY0061666',
    'PY0060920', 'PY0061148', 'PY0061192', 'PY0061078', 'PY0062413',
    'PY0062320', 'PY0061691'
];

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

// --- CLI ---
const cliArgs = process.argv.slice(2);
let index = 0;
let pyList = null;
let filePath = null;

for (let i = 0; i < cliArgs.length; i++) {
    const a = cliArgs[i];
    if (a.startsWith('--index=')) {
        index = parseInt(a.split('=')[1], 10);
    } else if (a === '--py' && cliArgs[i + 1]) {
        pyList = cliArgs[i + 1].split(',').map(s => s.trim()).filter(Boolean);
        i++;
    } else if (a.startsWith('--py=')) {
        pyList = a.substring(5).split(',').map(s => s.trim()).filter(Boolean);
    } else if (a === '--file' && cliArgs[i + 1]) {
        filePath = cliArgs[i + 1];
        i++;
    } else if (a.startsWith('--file=')) {
        filePath = a.substring(7);
    }
}

let payments = DEFAULT_PAYMENTS;
if (pyList) {
    payments = pyList;
} else if (filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    payments = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

async function fetchPaymentStatus(py) {
    const url = `${config.portal.url}/api/1.0/extern/tenants/${tenantIds[index]}/payments/${encodeURIComponent(py)}?id_type=EXTERNAL`;
    try {
        const resp = await axios.get(url, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index]
            }
        });
        return { ok: true, data: resp.data };
    } catch (err) {
        const status = err.response?.status || 'N/A';
        const body = err.response?.data;
        return { ok: false, httpStatus: status, body };
    }
}

async function main() {
    console.log('=== PAYMENT STATUS CHECK (read-only) ===');
    console.log(`Tenant: ${tenantIds[index]}`);
    console.log(`Payments to check: ${payments.length}`);
    console.log('');

    const rows = [];
    const summary = {};

    for (const py of payments) {
        process.stdout.write(`  Querying ${py}... `);
        const result = await fetchPaymentStatus(py);

        if (!result.ok) {
            const errMsg = typeof result.body === 'object'
                ? JSON.stringify(result.body)
                : String(result.body || '');
            console.log(`HTTP ${result.httpStatus} -- ${errMsg.slice(0, 120)}`);
            rows.push([py, '', `HTTP_${result.httpStatus}`, '', '', '', errMsg]);
            summary[`HTTP_${result.httpStatus}`] = (summary[`HTTP_${result.httpStatus}`] || 0) + 1;
            continue;
        }

        const p = result.data;
        const status = p.status || '(sin status)';
        const totalAmount = p.total_amount ?? '';
        const currency = p.currency || '';
        const cfdiCount = Array.isArray(p.cfdis) ? p.cfdis.length : (p.count_cfdis || '');
        const paymentDate = p.payment_date || '';
        const providerName = p.provider_name || '';
        const providerExternalId = p.provider_external_id || '';
        const paymentCfdiId = p.payment_cfdi_id || '';

        console.log(`${status} | ${cfdiCount} cfdis | ${totalAmount} ${currency}`);
        rows.push([
            py, providerExternalId, status, cfdiCount, totalAmount, currency,
            paymentDate, providerName, paymentCfdiId
        ]);
        summary[status] = (summary[status] || 0) + 1;
    }

    console.log('\n=== RESUMEN POR STATUS ===');
    const sortedStatuses = Object.keys(summary).sort();
    for (const s of sortedStatuses) {
        console.log(`  ${s}: ${summary[s]}`);
    }

    const headers = [
        'Payment', 'Provider_External_Id', 'Status', 'CFDI_Count',
        'Total_Amount', 'Currency', 'Payment_Date', 'Provider_Name', 'Payment_CFDI_Id'
    ];
    const csvPath = appendCsv(CSV_FILE, headers, rows);
    console.log(`\n[CSV] Reporte: ${csvPath}`);
}

main().catch(err => {
    console.error('[FATAL]', err.message);
    console.error(err.stack);
    process.exit(1);
});
