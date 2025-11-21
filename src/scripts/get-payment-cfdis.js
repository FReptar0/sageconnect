// src/scripts/get-payment-cfdis.js
// Script to fetch and process CFDI Payment Type (Type P) from Portal de Proveedores

const axios = require('axios');
require('dotenv').config({ path: '.env.credentials.focaltec' });
const { logGenerator } = require('../utils/LogGenerator');

const url = process.env.URL;
const tenantIds = process.env.TENANT_ID.split(',');
const apiKeys = process.env.API_KEY.split(',');
const apiSecrets = process.env.API_SECRET.split(',');

const urlBase = (index) => `${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis`;
const urlPayments = (index, paymentId) => `${url}/api/1.0/extern/tenants/${tenantIds[index]}/payments/${paymentId}`;

async function getTypePTest(index) {
    const logFileName = 'GetTypePTest';
    let date = new Date();
    let dateFrom = new Date(date.setMonth(date.getMonth() - 1)).toISOString().slice(0, 7);
    let dateUntil = new Date().toISOString().slice(0, 10);

    try {
        const response = await axios.get(
            urlBase(index) +
            `?to=${dateUntil}` +
            `&from=${dateFrom}-01` +
            `&documentTypes=CFDI` +
            `&offset=0&pageSize=0` +
            `&cfdiType=PAYMENT_CFDI`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );

        if (response.data.total === 0) {
            console.log('[INFO] No hay CFDI de tipo P');
            return [];
        }

        const data = [];
        for (const item of response.data.items) {
            if (!item.metadata.payment_info || item.metadata.payment_info.payments.length === 0) {
                if (item.payment_complement_info && item.payment_complement_info[0].payment_id) {
                    const paymentId = item.payment_complement_info[0].payment_id;
                    try {
                        const paymentResponse = await axios.get(
                            urlPayments(index, paymentId),
                            {
                                headers: {
                                    'PDPTenantKey': apiKeys[index],
                                    'PDPTenantSecret': apiSecrets[index]
                                }
                            }
                        );

                        if (paymentResponse.data) {
                            item.metadata.payment_info = {
                                payments: [
                                    {
                                        external_id: paymentResponse.data.external_id
                                    }
                                ]
                            };
                        }
                    } catch (error) {
                        console.log(`[ERROR] No se pudo obtener información del pago con ID ${paymentId}:`, error.message);
                        logGenerator(logFileName, 'error', `Error al obtener información del pago con ID ${paymentId}: ${error.message}`);
                        continue;
                    }
                } else {
                    console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por no tener pagos ni payment_id`);
                    logGenerator(logFileName, 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por no tener pagos ni payment_id`);
                    continue;
                }
            }

            data.push(item);
        }

        console.log('[INFO] CFDI de tipo P procesados:', data);
        return data;
    } catch (error) {
        console.log('[ERROR] Error al obtener CFDI de tipo P:', error.message);
        logGenerator(logFileName, 'error', `Error al obtener CFDI de tipo P: ${error.message}`);
        return [];
    }
}

// Main execution
(async () => {
    const args = process.argv.slice(2);

    // Parse tenant index from arguments (default to 0)
    let index = 0;
    const indexArg = args.find(arg => arg.startsWith('--index='));
    if (indexArg) {
        index = parseInt(indexArg.split('=')[1]) || 0;
    } else if (args.length > 0 && !isNaN(args[0])) {
        index = parseInt(args[0]);
    }

    console.log(`📊 Fetching CFDI Type P for tenant index: ${index} (${tenantIds[index]})`);
    console.log('==================================================\n');

    const result = await getTypePTest(index);
    console.log('\n[RESULT] Resultado final:', JSON.stringify(result, null, 2));
    console.log(`\n✅ Total CFDIs procesados: ${result.length}`);
})();

// Export for use in other modules
module.exports = { getTypePTest };
