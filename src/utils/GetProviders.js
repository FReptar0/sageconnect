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

/**
 * Consulta la información de proveedores desde el API aplicando filtros por estado y fechas.
 * @param {number} index - Índice del tenant a procesar.
 * @returns {Promise<Array>} - Arreglo de proveedores filtrados.
 */
async function getProviders(index) {
    // Se usa el mes actual como referencia para las fechas de aceptación
    let today = new Date().toISOString().slice(0, 10);
    console.log('Today:', today);
    try {
        const response = await axios.get(
            `${url}/api/1.0/extern/tenants/${tenantIds[index]}/providers`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );
        
    
        if (response.data.total === 0) {
            console.log('No providers found');
            logGenerator('getProviders', 'INFO', 'No providers found');
            return [];
        }
    
        // Aquí se pueden agregar filtros adicionales según sea necesario.
        const filteredProviders = response.data.items.filter(provider => {
            // Ejemplo de filtro adicional:
            // return provider.someField === 'valorDeseado';
            return true; // Actualmente se retornan todos los proveedores
        });
        console.log('Providers:', filteredProviders);
        return filteredProviders;
    } catch (error) {
        console.error('Error fetching providers:', error);
        logGenerator('getProviders', 'ERROR', error);
        notifier.notify({
            title: 'Focaltec',
            message: `Error fetching providers: ${error.message}`,
            sound: true,
            wait: true
        });
        return [];
    }
}

module.exports = { getProviders };
