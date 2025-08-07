const notifier = require('node-notifier');
require('dotenv').config({ path: '.env.credentials.focaltec' });
const axios = require('axios');
const { logGenerator } = require('./LogGenerator');

const url = process.env.URL;

// Arrays para soportar múltiples tenants
const tenantIds = [];
const apiKeys = [];
const apiSecrets = [];
const databases = [];

// Separar los valores de las variables de entorno
const tenantIdValues = process.env.TENANT_ID.split(',');
const apiKeyValues = process.env.API_KEY.split(',');
const apiSecretValues = process.env.API_SECRET.split(',');
const databaseValues = process.env.DATABASES.split(',');

tenantIds.push(...tenantIdValues);
apiKeys.push(...apiKeyValues);
apiSecrets.push(...apiSecretValues);
databases.push(...databaseValues);

const urlBase = (index) => `${url}/api/1.0/extern/tenants/${tenantIds[index]}/providers`;

/**
 * Consulta la información de proveedores desde el API aplicando filtros por estado y fechas.
 * @param {number} index - Índice del tenant a procesar.
 * @returns {Promise<Array>} - Arreglo de proveedores filtrados.
 */
async function getProviders(index) {
    // Se usa desde hace un mes hasta hoy como referencia para las fechas de aceptación
    let today = new Date();
    let oneMonthAgo = new Date(today);
    oneMonthAgo.setMonth(today.getMonth() - 1);
    
    let fromDate = oneMonthAgo.toISOString().slice(0, 10);
    let toDate = today.toISOString().slice(0, 10);
    
    console.log('[INFO] Today:', toDate);
    console.log('[INFO] From date (one month ago):', fromDate);
    console.log('[INFO] To date (today):', toDate);
    
    try {
        const response = await axios.get(
            urlBase(index) +
            `?statusExpedient=ACCEPTED&expedientAcceptedFrom=${fromDate}&expedientAcceptedTo=${toDate}&status=ENABLED&pageSize=-1`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );
        
        if (response.data.total === 0) {
            console.log(`[INFO] No providers found from ${fromDate} to ${toDate}`);
            logGenerator('getProviders', 'info', `No providers found from ${fromDate} to ${toDate}`);
            return [];
        }

        console.log(`[INFO] Found ${response.data.total} providers from ${fromDate} to ${toDate}`);
        logGenerator('getProviders', 'info', `Found ${response.data.total} providers from ${fromDate} to ${toDate}`);
        return response.data.items;
    } catch (error) {
        console.error(`[ERROR] Error fetching providers from ${fromDate} to ${toDate}:`, error);
        logGenerator('getProviders', 'error', `Error fetching providers from ${fromDate} to ${toDate}: ${error.message}`);
        notifier.notify({
            title: 'Focaltec',
            message: `[ERROR] Error fetching providers from ${fromDate} to ${toDate}: ${error.message}`,
            sound: true,
            wait: true
        });
        return [];
    }
}

module.exports = { getProviders };
