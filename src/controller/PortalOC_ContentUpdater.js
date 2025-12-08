// src/controller/PortalOC_ContentUpdater.js

const axios = require('axios');
const dotenv = require('dotenv');

// Load credentials for Portal de Proveedores
const creds = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const config = dotenv.config({ path: '.env' }).parsed;

const {
    TENANT_ID,
    API_KEY,
    API_SECRET,
    URL,
    DATABASES,
    EXTERNAL_IDS
} = creds;

// Address configuration
const addressConfig = {
    DEFAULT_ADDRESS_CITY: config?.DEFAULT_ADDRESS_CITY || '',
    DEFAULT_ADDRESS_COUNTRY: config?.DEFAULT_ADDRESS_COUNTRY || '',
    DEFAULT_ADDRESS_IDENTIFIER: config?.DEFAULT_ADDRESS_IDENTIFIER || '',
    DEFAULT_ADDRESS_MUNICIPALITY: config?.DEFAULT_ADDRESS_MUNICIPALITY || '',
    DEFAULT_ADDRESS_STATE: config?.DEFAULT_ADDRESS_STATE || '',
    DEFAULT_ADDRESS_STREET: config?.DEFAULT_ADDRESS_STREET || '',
    DEFAULT_ADDRESS_ZIP: config?.DEFAULT_ADDRESS_ZIP || '',
    ADDRESS_IDENTIFIERS_SKIP: config?.ADDRESS_IDENTIFIERS_SKIP || ''
};

// Utilities
const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { PortalOCPayloadBuilder } = require('../services/PortalOC_PayloadBuilder');

// Prepare arrays of tenants/keys/etc.
const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const databases = DATABASES.split(',');
const externalIds = EXTERNAL_IDS.split(',');

const urlBase = (index) => `${URL}/api/1.0/extern/tenants/${tenantIds[index]}`;

/**
 * Controller for updating purchase order content via PUT /purchase-orders/{id}
 * Handles partial cancellations, quantity updates, and line modifications
 */
class PortalOCContentUpdater {
    constructor() {
        this.payloadBuilder = new PortalOCPayloadBuilder({
            databases,
            externalIds,
            addressConfig
        });
        this.logFileName = 'PortalOC_ContentUpdater';
    }

    /**
     * Update purchase order content for orders with partial cancellations
     * @param {number} tenantIndex - Index of the tenant to process
     * @returns {Promise<Object>} Results summary
     */
    async updateOrdersWithPartialCancellations(tenantIndex) {
        logGenerator(this.logFileName, 'info', 
            `[START] Processing partial cancellations for tenant ${tenantIds[tenantIndex]}`);

        try {
            // Get orders with partial cancellations
            const updatedOrders = await this.payloadBuilder.getUpdatedOrderPayloads(tenantIndex);
            
            if (updatedOrders.length === 0) {
                logGenerator(this.logFileName, 'info', 
                    `[INFO] No orders with partial cancellations found for tenant ${tenantIds[tenantIndex]}`);
                return { processed: 0, updated: 0, errors: 0 };
            }

            logGenerator(this.logFileName, 'info', 
                `[INFO] Found ${updatedOrders.length} orders with partial cancellations`);

            let updatedCount = 0;
            let errorCount = 0;

            // Process each order
            for (let i = 0; i < updatedOrders.length; i++) {
                const order = updatedOrders[i];
                
                try {
                    const result = await this.updateSingleOrder(tenantIndex, order);
                    if (result.success) {
                        updatedCount++;
                        logGenerator(this.logFileName, 'info', 
                            `[SUCCESS] [${i + 1}/${updatedOrders.length}] Updated order ${order.external_id}`);
                    } else {
                        errorCount++;
                        logGenerator(this.logFileName, 'error', 
                            `[ERROR] [${i + 1}/${updatedOrders.length}] Failed to update order ${order.external_id}: ${result.error}`);
                    }
                } catch (error) {
                    errorCount++;
                    logGenerator(this.logFileName, 'error', 
                        `[ERROR] [${i + 1}/${updatedOrders.length}] Exception updating order ${order.external_id}: ${error.message}`);
                }
            }

            const summary = {
                processed: updatedOrders.length,
                updated: updatedCount,
                errors: errorCount
            };

            logGenerator(this.logFileName, 'info', 
                `[COMPLETE] Partial cancellation updates - Processed: ${summary.processed}, Updated: ${summary.updated}, Errors: ${summary.errors}`);

            return summary;

        } catch (error) {
            logGenerator(this.logFileName, 'error', 
                `[ERROR] Failed to process partial cancellations for tenant ${tenantIds[tenantIndex]}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Update a single purchase order via Portal de Proveedores API
     * @param {number} tenantIndex - Index of the tenant
     * @param {Object} orderPayload - The order payload to send
     * @returns {Promise<Object>} Update result
     */
    async updateSingleOrder(tenantIndex, orderPayload) {
        try {
            // Get the idFocaltec for this order
            const idFocaltec = await this.getFocaltecId(orderPayload.external_id, tenantIndex);
            
            if (!idFocaltec) {
                return {
                    success: false,
                    error: `Order ${orderPayload.external_id} not found in FESA database`
                };
            }

            // Send PUT request to update the order
            const endpoint = `${urlBase(tenantIndex)}/purchase-orders/${idFocaltec}`;
            
            const response = await axios.put(
                endpoint,
                orderPayload,
                {
                    headers: {
                        'PDPTenantKey': apiKeys[tenantIndex],
                        'PDPTenantSecret': apiSecrets[tenantIndex],
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            // Update the lastUpdate timestamp in FESA
            await this.updateFesaTimestamp(orderPayload.external_id, tenantIndex);

            logGenerator(this.logFileName, 'info', 
                `[API] PUT ${endpoint} responded with ${response.status} ${response.statusText}`);

            return {
                success: true,
                status: response.status,
                data: response.data
            };

        } catch (error) {
            let errorMessage = '';
            if (error.response) {
                errorMessage = `${error.response.status} ${error.response.statusText}: ${JSON.stringify(error.response.data)}`;
            } else {
                errorMessage = error.message;
            }

            return {
                success: false,
                error: errorMessage
            };
        }
    }

    /**
     * Get the idFocaltec for a purchase order
     * @param {string} ocSage - The SAGE purchase order number
     * @param {number} tenantIndex - Index of the tenant
     * @returns {Promise<string|null>} The idFocaltec or null if not found
     */
    async getFocaltecId(ocSage, tenantIndex) {
        const sql = `
            SELECT RTRIM(idFocaltec) AS idFocaltec
            FROM fesa.dbo.fesaOCFocaltec
            WHERE ocSage = '${ocSage}'
              AND idDatabase = '${databases[tenantIndex]}'
              AND idFocaltec IS NOT NULL
              AND status = 'POSTED'
        `;

        try {
            const { recordset } = await runQuery(sql, 'FESA');
            if (recordset.length > 0) {
                return recordset[0].idFocaltec;
            }
            return null;
        } catch (error) {
            logGenerator(this.logFileName, 'error', 
                `[ERROR] Failed to get idFocaltec for order ${ocSage}: ${error.message}`);
            return null;
        }
    }

    /**
     * Update the lastUpdate timestamp in FESA database
     * @param {string} ocSage - The SAGE purchase order number
     * @param {number} tenantIndex - Index of the tenant
     */
    async updateFesaTimestamp(ocSage, tenantIndex) {
        const sql = `
            UPDATE dbo.fesaOCFocaltec
            SET lastUpdate = GETDATE()
            WHERE ocSage = '${ocSage}'
              AND idDatabase = '${databases[tenantIndex]}'
              AND idFocaltec IS NOT NULL
              AND status = 'POSTED'
        `;

        try {
            await runQuery(sql, 'FESA');
            logGenerator(this.logFileName, 'info', 
                `[FESA] Updated timestamp for order ${ocSage}`);
        } catch (error) {
            logGenerator(this.logFileName, 'error', 
                `[ERROR] Failed to update FESA timestamp for order ${ocSage}: ${error.message}`);
        }
    }

    /**
     * Update a specific purchase order by external ID
     * @param {string} ocSage - The SAGE purchase order number
     * @param {number} tenantIndex - Index of the tenant
     * @returns {Promise<Object>} Update result
     */
    async updateSpecificOrder(ocSage, tenantIndex) {
        logGenerator(this.logFileName, 'info', 
            `[START] Updating specific order ${ocSage} for tenant ${tenantIds[tenantIndex]}`);

        try {
            // Get the updated order payload
            const whereCondition = `AND A.PONUMBER = '${ocSage}'`;
            const records = await this.payloadBuilder.getPurchaseOrdersData(tenantIndex, whereCondition, true);
            
            if (records.length === 0) {
                return {
                    success: false,
                    error: `Order ${ocSage} not found or not eligible for update`
                };
            }

            const orderPayloads = await this.payloadBuilder.buildPayloads(records, { filterZeroQuantities: true });
            
            if (orderPayloads.length === 0) {
                return {
                    success: false,
                    error: `Order ${ocSage} has no valid lines after filtering zero quantities`
                };
            }

            const result = await this.updateSingleOrder(tenantIndex, orderPayloads[0]);
            
            if (result.success) {
                logGenerator(this.logFileName, 'info', 
                    `[SUCCESS] Successfully updated order ${ocSage}`);
            } else {
                logGenerator(this.logFileName, 'error', 
                    `[ERROR] Failed to update order ${ocSage}: ${result.error}`);
            }

            return result;

        } catch (error) {
            logGenerator(this.logFileName, 'error', 
                `[ERROR] Exception updating order ${ocSage}: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// Function exports for backward compatibility
async function updateOrdersWithPartialCancellations(tenantIndex) {
    const updater = new PortalOCContentUpdater();
    return await updater.updateOrdersWithPartialCancellations(tenantIndex);
}

async function updateSpecificOrder(ocSage, tenantIndex) {
    const updater = new PortalOCContentUpdater();
    return await updater.updateSpecificOrder(ocSage, tenantIndex);
}

module.exports = {
    PortalOCContentUpdater,
    updateOrdersWithPartialCancellations,
    updateSpecificOrder
};