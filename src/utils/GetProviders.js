const config = require('../config');
const portalClient = require('./PortalClient');
const { getCurrentDateString } = require('./TimezoneHelper');
const { logGenerator } = require('./LogGenerator');

const url = config.portal.url;

// Arrays para soportar múltiples tenants
const tenantIds = config.portal.tenants.map(t => t.id);
const apiKeys = config.portal.tenants.map(t => t.key);
const apiSecrets = config.portal.tenants.map(t => t.secret);
const databases = config.portal.tenants.map(t => t.database);

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
        const response = await portalClient.get(
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
        throw error;
    }
}

/**
 * Busca un proveedor en el portal por external_id.
 * @param {number} index - Índice del tenant.
 * @param {string} externalId - Identificador del proveedor en ERP.
 * @returns {Promise<Object|null>} - Datos del proveedor o null si no hay match único.
 */
async function getProviderByExternalId(index, externalId) {
    const logFileName = 'GetProviders';
    try {
        const externalIdClean = (externalId || '').trim();
        if (!externalIdClean) {
            console.warn('[WARN] Empty externalId provided');
            logGenerator(logFileName, 'warn', 'Empty externalId provided');
            return null;
        }

        const response = await portalClient.get(
            urlBase(index) + `?externalId=${encodeURIComponent(externalIdClean)}&pageSize=-1`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );

        const items = response.data.items || [];
        const exactMatches = items.filter(item => {
            const currentExternalId = (item.external_id || '').toString().trim();
            return currentExternalId === externalIdClean;
        });

        if (exactMatches.length === 0) {
            console.log(`[INFO] No provider found with externalId: ${externalIdClean}`);
            logGenerator(logFileName, 'info', `No provider found with externalId: ${externalIdClean}`);
            return null;
        }

        if (exactMatches.length > 1) {
            console.warn(`[WARN] Ambiguous provider search by externalId "${externalIdClean}": ${exactMatches.length} matches`);
            logGenerator(logFileName, 'warn', `Ambiguous provider search by externalId "${externalIdClean}": ${exactMatches.length} matches`);
            return null;
        }

        return exactMatches[0];
    } catch (error) {
        const externalIdClean = (externalId || '').trim();
        console.error(`[ERROR] Error fetching provider by externalId ${externalIdClean}:`, error.message);
        logGenerator(logFileName, 'error', `Error fetching provider by externalId ${externalIdClean}: ${error.message}`);
        return null;
    }
}

module.exports = { getProviders, getProviderByExternalId };
