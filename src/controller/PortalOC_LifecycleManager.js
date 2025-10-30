// src/controller/PortalOC_LifecycleManager.js

const dotenv = require('dotenv');

// Load credentials
const creds = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const config = dotenv.config({ path: '.env' }).parsed;

const {
    TENANT_ID,
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

// Utilities and services
const { runQuery } = require('../utils/SQLServerConnection');
const { getCurrentDateCompact } = require('../utils/TimezoneHelper');
const { logGenerator } = require('../utils/LogGenerator');
const { PortalOCPayloadBuilder } = require('../services/PortalOC_PayloadBuilder');
const { PortalOCContentUpdater } = require('./PortalOC_ContentUpdater');

// Prepare arrays
const tenantIds = TENANT_ID.split(',');
const databases = DATABASES.split(',');
const externalIds = EXTERNAL_IDS.split(',');

/**
 * Orchestrator for Purchase Order lifecycle management
 * Analyzes order changes and routes to appropriate handlers
 */
class PortalOCLifecycleManager {
    constructor() {
        this.payloadBuilder = new PortalOCPayloadBuilder({
            databases,
            externalIds,
            addressConfig
        });
        this.contentUpdater = new PortalOCContentUpdater();
        this.logFileName = 'PortalOC_LifecycleManager';
    }

    /**
     * Process all order changes for a specific tenant
     * @param {number} tenantIndex - Index of the tenant to process
     * @returns {Promise<Object>} Processing summary
     */
    async processOrderChanges(tenantIndex) {
        const today = getCurrentDateCompact();
        
        logGenerator(this.logFileName, 'info', 
            `[START] Processing order changes for tenant ${tenantIds[tenantIndex]} - Date: ${today}`);

        try {
            const summary = {
                tenant: tenantIds[tenantIndex],
                date: today,
                fullyCancelledOrders: 0,
                partiallyCancelledOrders: 0,
                ordersUpdated: 0,
                ordersCancelled: 0,
                errors: 0,
                totalProcessed: 0
            };

            // 1. Process fully cancelled orders
            logGenerator(this.logFileName, 'info', `[STEP 1] Processing fully cancelled orders`);
            const cancelResults = await this.processFullyCancelledOrders(tenantIndex);
            summary.fullyCancelledOrders = cancelResults.found;
            summary.ordersCancelled = cancelResults.cancelled;
            summary.errors += cancelResults.errors;

            // 2. Process partially cancelled orders (updates)
            logGenerator(this.logFileName, 'info', `[STEP 2] Processing partially cancelled orders`);
            const updateResults = await this.processPartiallyCancelledOrders(tenantIndex);
            summary.partiallyCancelledOrders = updateResults.found;
            summary.ordersUpdated = updateResults.updated;
            summary.errors += updateResults.errors;

            summary.totalProcessed = summary.fullyCancelledOrders + summary.partiallyCancelledOrders;

            logGenerator(this.logFileName, 'info', 
                `[COMPLETE] Order lifecycle processing summary:\n` +
                `  - Total processed: ${summary.totalProcessed}\n` +
                `  - Fully cancelled: ${summary.fullyCancelledOrders} (${summary.ordersCancelled} success)\n` +
                `  - Partially cancelled: ${summary.partiallyCancelledOrders} (${summary.ordersUpdated} success)\n` +
                `  - Total errors: ${summary.errors}`);

            return summary;

        } catch (error) {
            logGenerator(this.logFileName, 'error', 
                `[ERROR] Failed to process order changes for tenant ${tenantIds[tenantIndex]}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Process orders that are fully cancelled
     * @param {number} tenantIndex - Index of the tenant
     * @returns {Promise<Object>} Processing results
     */
    async processFullyCancelledOrders(tenantIndex) {
        try {
            const ordersToCancel = await this.payloadBuilder.getOrdersToCancel(tenantIndex);
            
            if (ordersToCancel.length === 0) {
                logGenerator(this.logFileName, 'info', 
                    `[INFO] No fully cancelled orders found for tenant ${tenantIds[tenantIndex]}`);
                return { found: 0, cancelled: 0, errors: 0 };
            }

            logGenerator(this.logFileName, 'info', 
                `[INFO] Found ${ordersToCancel.length} fully cancelled orders`);

            let cancelledCount = 0;
            let errorCount = 0;

            for (let i = 0; i < ordersToCancel.length; i++) {
                const ponumber = ordersToCancel[i];
                
                try {
                    const result = await this.cancelSingleOrder(ponumber, tenantIndex);
                    if (result.success) {
                        cancelledCount++;
                        logGenerator(this.logFileName, 'info', 
                            `[SUCCESS] [${i + 1}/${ordersToCancel.length}] Cancelled order ${ponumber}`);
                    } else {
                        errorCount++;
                        logGenerator(this.logFileName, 'error', 
                            `[ERROR] [${i + 1}/${ordersToCancel.length}] Failed to cancel order ${ponumber}: ${result.error}`);
                    }
                } catch (error) {
                    errorCount++;
                    logGenerator(this.logFileName, 'error', 
                        `[ERROR] [${i + 1}/${ordersToCancel.length}] Exception cancelling order ${ponumber}: ${error.message}`);
                }
            }

            return {
                found: ordersToCancel.length,
                cancelled: cancelledCount,
                errors: errorCount
            };

        } catch (error) {
            logGenerator(this.logFileName, 'error', 
                `[ERROR] Failed to process fully cancelled orders: ${error.message}`);
            return { found: 0, cancelled: 0, errors: 1 };
        }
    }

    /**
     * Process orders that are partially cancelled
     * @param {number} tenantIndex - Index of the tenant
     * @returns {Promise<Object>} Processing results
     */
    async processPartiallyCancelledOrders(tenantIndex) {
        try {
            const updateSummary = await this.contentUpdater.updateOrdersWithPartialCancellations(tenantIndex);
            
            return {
                found: updateSummary.processed,
                updated: updateSummary.updated,
                errors: updateSummary.errors
            };

        } catch (error) {
            logGenerator(this.logFileName, 'error', 
                `[ERROR] Failed to process partially cancelled orders: ${error.message}`);
            return { found: 0, updated: 0, errors: 1 };
        }
    }

    /**
     * Cancel a single purchase order
     * @param {string} ponumber - Purchase order number
     * @param {number} tenantIndex - Index of the tenant
     * @returns {Promise<Object>} Cancellation result
     */
    async cancelSingleOrder(ponumber, tenantIndex) {
        try {
            // Get idFocaltec
            const idFocaltec = await this.getFocaltecId(ponumber, tenantIndex);
            
            if (!idFocaltec) {
                return {
                    success: false,
                    error: `Order ${ponumber} not found in FESA database`
                };
            }

            // Import and use status service for cancellation
            const { updateStatus } = require('../services/PortalOC_StatusService');
            const result = await updateStatus(ponumber, 'CANCELLED', databases[tenantIndex]);

            if (result.success) {
                logGenerator(this.logFileName, 'info', 
                    `[CANCEL] Successfully cancelled order ${ponumber}`);
                return { success: true };
            } else {
                return {
                    success: false,
                    error: result.error || 'Unknown cancellation error'
                };
            }

        } catch (error) {
            return {
                success: false,
                error: error.message
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
            FROM dbo.fesaOCFocaltec
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
     * Analyze a specific order's cancellation status
     * @param {string} ponumber - Purchase order number
     * @param {number} tenantIndex - Index of the tenant
     * @returns {Promise<Object>} Analysis result
     */
    async analyzeOrderStatus(ponumber, tenantIndex) {
        const sql = `
            SELECT 
                A.PONUMBER,
                SUM(B.SQORDERED) as TOTAL_ORDERED,
                SUM(B.OQCANCELED) as TOTAL_CANCELLED,
                COUNT(B.PORLSEQ) as LINE_COUNT,
                SUM(CASE WHEN B.OQCANCELED = B.SQORDERED THEN 1 ELSE 0 END) as FULLY_CANCELLED_LINES,
                SUM(CASE WHEN B.OQCANCELED > 0 AND B.OQCANCELED < B.SQORDERED THEN 1 ELSE 0 END) as PARTIALLY_CANCELLED_LINES
            FROM ${databases[tenantIndex]}.dbo.POPORH1 A
            INNER JOIN ${databases[tenantIndex]}.dbo.POPORL B ON A.PORHSEQ = B.PORHSEQ
            WHERE A.PONUMBER = '${ponumber}'
            GROUP BY A.PONUMBER
        `;

        try {
            const { recordset } = await runQuery(sql, databases[tenantIndex]);
            
            if (recordset.length === 0) {
                return {
                    ponumber,
                    status: 'NOT_FOUND',
                    recommendation: 'NO_ACTION'
                };
            }

            const data = recordset[0];
            let status, recommendation;

            if (data.TOTAL_CANCELLED === 0) {
                status = 'NO_CANCELLATIONS';
                recommendation = 'NO_ACTION';
            } else if (data.TOTAL_CANCELLED === data.TOTAL_ORDERED) {
                status = 'FULLY_CANCELLED';
                recommendation = 'CANCEL_ORDER';
            } else {
                status = 'PARTIALLY_CANCELLED';
                recommendation = 'UPDATE_ORDER';
            }

            return {
                ponumber,
                status,
                recommendation,
                totalOrdered: data.TOTAL_ORDERED,
                totalCancelled: data.TOTAL_CANCELLED,
                lineCount: data.LINE_COUNT,
                fullyCancelledLines: data.FULLY_CANCELLED_LINES,
                partiallyCancelledLines: data.PARTIALLY_CANCELLED_LINES
            };

        } catch (error) {
            logGenerator(this.logFileName, 'error', 
                `[ERROR] Failed to analyze order ${ponumber}: ${error.message}`);
            return {
                ponumber,
                status: 'ERROR',
                recommendation: 'NO_ACTION',
                error: error.message
            };
        }
    }

    /**
     * Process a specific order by purchase order number
     * @param {string} ponumber - Purchase order number
     * @param {number} tenantIndex - Index of the tenant
     * @returns {Promise<Object>} Processing result
     */
    async processSpecificOrder(ponumber, tenantIndex) {
        logGenerator(this.logFileName, 'info', 
            `[START] Processing specific order ${ponumber} for tenant ${tenantIds[tenantIndex]}`);

        try {
            // Analyze the order first
            const analysis = await this.analyzeOrderStatus(ponumber, tenantIndex);
            
            logGenerator(this.logFileName, 'info', 
                `[ANALYSIS] Order ${ponumber} status: ${analysis.status}, recommendation: ${analysis.recommendation}`);

            let result;

            switch (analysis.recommendation) {
                case 'CANCEL_ORDER':
                    result = await this.cancelSingleOrder(ponumber, tenantIndex);
                    break;
                    
                case 'UPDATE_ORDER':
                    result = await this.contentUpdater.updateSpecificOrder(ponumber, tenantIndex);
                    break;
                    
                case 'NO_ACTION':
                default:
                    result = {
                        success: true,
                        action: 'NO_ACTION',
                        reason: `Order status: ${analysis.status}`
                    };
                    break;
            }

            logGenerator(this.logFileName, 'info', 
                `[COMPLETE] Processing order ${ponumber}: ${result.success ? 'SUCCESS' : 'FAILED'}`);

            return {
                ...result,
                analysis
            };

        } catch (error) {
            logGenerator(this.logFileName, 'error', 
                `[ERROR] Failed to process order ${ponumber}: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// Function exports for backward compatibility
async function processOrderChanges(tenantIndex) {
    const manager = new PortalOCLifecycleManager();
    return await manager.processOrderChanges(tenantIndex);
}

async function processSpecificOrder(ponumber, tenantIndex) {
    const manager = new PortalOCLifecycleManager();
    return await manager.processSpecificOrder(ponumber, tenantIndex);
}

async function analyzeOrderStatus(ponumber, tenantIndex) {
    const manager = new PortalOCLifecycleManager();
    return await manager.analyzeOrderStatus(ponumber, tenantIndex);
}

module.exports = {
    PortalOCLifecycleManager,
    processOrderChanges,
    processSpecificOrder,
    analyzeOrderStatus
};