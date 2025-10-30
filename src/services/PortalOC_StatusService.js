// src/services/PortalOC_StatusService.js

const axios = require('axios');
const dotenv = require('dotenv');

// Load credentials
const creds = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const {
    TENANT_ID,
    API_KEY,
    API_SECRET,
    URL,
    DATABASES
} = creds;

// Utilities
const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');

// Prepare arrays
const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const databases = DATABASES.split(',');

const urlBase = (index) => `${URL}/api/1.0/extern/tenants/${tenantIds[index]}`;

/**
 * Service for updating purchase order status via Portal de Proveedores
 * Uses PUT /purchase-orders/{id}/status endpoint
 */
class PortalOCStatusService {
    constructor() {
        this.logFileName = 'PortalOC_StatusService';
        this.VALID_STATUSES = new Set(['OPEN', 'CLOSED', 'CANCELLED', 'GENERATED']);
    }

    /**
     * Update purchase order status
     * @param {string} ocSage - SAGE purchase order number
     * @param {string} status - New status (OPEN, CLOSED, CANCELLED, GENERATED)
     * @param {string} idDatabase - Database identifier
     * @returns {Promise<Object>} Update result
     */
    async updateStatus(ocSage, status, idDatabase) {
        logGenerator(this.logFileName, 'info', 
            `[START] Updating order ${ocSage} to status ${status} in database ${idDatabase}`);

        try {
            // Validate status
            if (!this.VALID_STATUSES.has(status)) {
                return {
                    success: false,
                    error: `Invalid status: ${status}. Must be one of: ${[...this.VALID_STATUSES].join(', ')}`
                };
            }

            // Find database index
            const dbIndex = databases.indexOf(idDatabase);
            if (dbIndex < 0) {
                return {
                    success: false,
                    error: `Unknown database: ${idDatabase}`
                };
            }

            // Get idFocaltec
            const idFocaltec = await this.getFocaltecId(ocSage, idDatabase);
            if (!idFocaltec) {
                return {
                    success: false,
                    error: `Order ${ocSage} not found in FESA database or not in valid status`
                };
            }

            // Send PUT request to Portal de Proveedores
            const endpoint = `${urlBase(dbIndex)}/purchase-orders/${idFocaltec}/status`;
            
            const response = await axios.put(
                endpoint,
                { status },
                {
                    headers: {
                        'PDPTenantKey': apiKeys[dbIndex],
                        'PDPTenantSecret': apiSecrets[dbIndex],
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            logGenerator(this.logFileName, 'info', 
                `[API] Portal responded ${response.status} for order ${ocSage}`);

            // Update FESA control table
            await this.updateFesaStatus(ocSage, status, idDatabase);

            logGenerator(this.logFileName, 'info', 
                `[SUCCESS] Order ${ocSage} updated to ${status}`);

            return {
                success: true,
                status: response.status,
                data: response.data
            };

        } catch (error) {
            let errorMessage = '';
            if (error.response) {
                errorMessage = `${error.response.status} ${JSON.stringify(error.response.data)}`;
            } else {
                errorMessage = error.message;
            }

            logGenerator(this.logFileName, 'error', 
                `[ERROR] Failed to update order ${ocSage}: ${errorMessage}`);

            return {
                success: false,
                error: errorMessage
            };
        }
    }

    /**
     * Get idFocaltec for a purchase order
     * @param {string} ocSage - SAGE purchase order number
     * @param {string} idDatabase - Database identifier
     * @returns {Promise<string|null>} idFocaltec or null if not found
     */
    async getFocaltecId(ocSage, idDatabase) {
        const sql = `
            SELECT RTRIM(idFocaltec) AS idFocaltec
            FROM dbo.fesaOCFocaltec
            WHERE ocSage = '${ocSage}'
              AND idDatabase = '${idDatabase}'
              AND idFocaltec IS NOT NULL
              AND status <> 'ERROR'
            ORDER BY createdAt DESC
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
     * Update status in FESA control table
     * @param {string} ocSage - SAGE purchase order number
     * @param {string} status - New status
     * @param {string} idDatabase - Database identifier
     */
    async updateFesaStatus(ocSage, status, idDatabase) {
        const sql = `
            UPDATE dbo.fesaOCFocaltec
            SET status = '${status}',
                lastUpdate = GETDATE()
            WHERE ocSage = '${ocSage}'
              AND idDatabase = '${idDatabase}'
              AND idFocaltec IS NOT NULL
        `;

        try {
            await runQuery(sql, 'FESA');
            logGenerator(this.logFileName, 'info', 
                `[FESA] Control updated for order ${ocSage} to ${status}`);
        } catch (error) {
            logGenerator(this.logFileName, 'error', 
                `[ERROR] Failed to update FESA for order ${ocSage}: ${error.message}`);
            // Don't throw - this is not critical for the API operation
        }
    }

    /**
     * Update status for multiple orders
     * @param {Array<Object>} orders - Array of {ocSage, status, idDatabase}
     * @returns {Promise<Object>} Batch update summary
     */
    async updateMultipleStatuses(orders) {
        logGenerator(this.logFileName, 'info', 
            `[START] Batch updating ${orders.length} orders`);

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        for (let i = 0; i < orders.length; i++) {
            const { ocSage, status, idDatabase } = orders[i];
            
            try {
                const result = await this.updateStatus(ocSage, status, idDatabase);
                if (result.success) {
                    successCount++;
                    logGenerator(this.logFileName, 'info', 
                        `[SUCCESS] [${i + 1}/${orders.length}] Updated ${ocSage} to ${status}`);
                } else {
                    errorCount++;
                    errors.push({ ocSage, error: result.error });
                    logGenerator(this.logFileName, 'error', 
                        `[ERROR] [${i + 1}/${orders.length}] Failed to update ${ocSage}: ${result.error}`);
                }
            } catch (error) {
                errorCount++;
                errors.push({ ocSage, error: error.message });
                logGenerator(this.logFileName, 'error', 
                    `[ERROR] [${i + 1}/${orders.length}] Exception updating ${ocSage}: ${error.message}`);
            }
        }

        const summary = {
            total: orders.length,
            success: successCount,
            errors: errorCount,
            errorDetails: errors
        };

        logGenerator(this.logFileName, 'info', 
            `[COMPLETE] Batch update - Total: ${summary.total}, Success: ${summary.success}, Errors: ${summary.errors}`);

        return summary;
    }
}

// Function exports for backward compatibility
async function updateStatus(ocSage, status, idDatabase) {
    const service = new PortalOCStatusService();
    return await service.updateStatus(ocSage, status, idDatabase);
}

async function updateMultipleStatuses(orders) {
    const service = new PortalOCStatusService();
    return await service.updateMultipleStatuses(orders);
}

module.exports = {
    PortalOCStatusService,
    updateStatus,
    updateMultipleStatuses
};