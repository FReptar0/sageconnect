const notifier = require('node-notifier');
require('dotenv').config({ path: '.env.credentials.focaltec' });
const axios = require('axios');
const { getCurrentDateString } = require('./TimezoneHelper');
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
    const logFileName = 'GetProviders';
    // Se usa el mes actual como referencia para las fechas de aceptación
    let today = getCurrentDateString();
    console.log('[INFO] Today:', today);
    try {
        const response = await axios.get(
            urlBase(index) +
            `?statusExpedient=ACCEPTED&expedientAcceptedFrom=${today}&expedientAcceptedTo=${today}&status=ENABLED&pageSize=-1`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );
        
        if (response.data.total === 0) {
            console.log('[INFO] No providers found');
            logGenerator(logFileName, 'INFO', 'No providers found');
            return [];
        }

        return response.data.items;
    } catch (error) {
        console.error('[ERROR] Error fetching providers:', error);
        logGenerator(logFileName, 'ERROR', error);
        notifier.notify({
            title: 'Focaltec',
            message: `[ERROR] Error fetching providers: ${error.message}`,
            sound: true,
            wait: true
        });
        return [];
    }
}

module.exports = { getProviders };
