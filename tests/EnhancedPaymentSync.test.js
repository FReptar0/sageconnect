const { runQuery } = require('../src/utils/SQLServerConnection');
const { logGenerator } = require('../src/utils/LogGenerator');
const { uploadPayments } = require('../src/controller/PortalPaymentController');
const { checkPayments } = require('../src/controller/SagePaymentController');
const axios = require('axios');
const dotenv = require('dotenv');

const credentials = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;

const {
    TENANT_ID,
    API_KEY,
    API_SECRET,
    URL,
    DATABASES
} = credentials;

const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const database = DATABASES.split(',');

/**
 * Enhanced Payment Testing with Sync Validation
 * Features:
 * - Test specific PY payments
 * - Validate sync between Sage and Portal
 * - Add dry-run flag for safe testing
 * - Comprehensive status validation
 */
class EnhancedPaymentTester {
    constructor(options = {}) {
        this.dryRun = options.dryRun || false;
        this.forcePost = options.forcePost || false;
        this.index = options.index || 0;
        this.logFileName = 'EnhancedPaymentTester';
        this.testResults = [];
    }

    /**
     * Test specific PY payment by external_id
     */
    async testSpecificPayment(pyId, options = {}) {
        const testId = `TEST_${pyId}_${Date.now()}`;
        logGenerator(this.logFileName, 'info', `[${testId}] Starting specific payment test for PY: ${pyId}`);
        
        try {
            // 1. Validate payment exists in Sage
            const sagePayment = await this.validateSagePayment(pyId, testId);
            if (!sagePayment) {
                return this.recordTestResult(testId, 'FAILED', 'Payment not found in Sage', { pyId });
            }

            // 2. Check if payment already exists in Portal
            const portalStatus = await this.checkPortalPaymentStatus(pyId, testId);
            
            // 3. Check sync status in control table
            const syncStatus = await this.checkSyncControlStatus(pyId, testId);

            // 4. If force post or payment not synced, attempt sync
            if (this.forcePost || !syncStatus.exists) {
                const syncResult = await this.performPaymentSync(sagePayment, testId, options);
                return this.recordTestResult(testId, syncResult.success ? 'PASSED' : 'FAILED', syncResult.message, {
                    pyId,
                    sageData: sagePayment,
                    portalData: portalStatus,
                    syncData: syncResult
                });
            }

            return this.recordTestResult(testId, 'SKIPPED', 'Payment already synced', {
                pyId,
                sageData: sagePayment,
                portalData: portalStatus,
                syncData: syncStatus
            });

        } catch (error) {
            logGenerator(this.logFileName, 'error', `[${testId}] Error testing payment ${pyId}: ${error.message}`);
            return this.recordTestResult(testId, 'ERROR', error.message, { pyId });
        }
    }

    /**
     * Validate payment exists and get details from Sage
     */
    async validateSagePayment(pyId, testId) {
        const query = `
            SELECT TOP 1
                P.CNTBTCH    AS LotePago,
                P.CNTENTR    AS AsientoPago,
                RTRIM(BK.ADDR1)   AS bank_account_id,
                B.IDBANK,
                P.DATEBUS    AS FechaAsentamiento,
                RTRIM(P.DOCNBR)     AS external_id,
                P.TEXTRMIT   AS comments,
                P.TXTRMITREF AS reference,
                CASE BK.CURNSTMT WHEN 'MXP' THEN 'MXN' ELSE BK.CURNSTMT END AS bk_currency,
                P.DATERMIT   AS payment_date,
                RTRIM(P.IDVEND)   AS provider_external_id,
                P.AMTRMIT    AS total_amount,
                'TRANSFER'   AS operation_type,
                P.RATEEXCHHC AS TipoCambioPago,
                P.AUDTDATE   AS audit_date,
                P.AUDTTIME   AS audit_time,
                ISNULL(
                    (SELECT [VALUE] FROM APVENO WHERE OPTFIELD = 'RFC' AND VENDORID = P.IDVEND),
                    ''
                ) AS RFC,
                ISNULL(
                    (SELECT [VALUE] FROM APVENO WHERE OPTFIELD = 'PROVIDERID' AND VENDORID = P.IDVEND),
                    ''
                ) AS PROVIDERID
            FROM APBTA B
            JOIN BKACCT BK ON B.IDBANK = BK.BANK
            JOIN APTCR P ON B.PAYMTYPE = P.BTCHTYPE AND B.CNTBTCH = P.CNTBTCH
            WHERE B.PAYMTYPE = 'PY'
                AND B.BATCHSTAT = 3
                AND P.ERRENTRY = 0
                AND P.RMITTYPE = 1
                AND P.DOCNBR = '${pyId}'
        `;

        try {
            const result = await runQuery(query, database[this.index]);
            logGenerator(this.logFileName, 'info', `[${testId}] Sage payment validation: ${result.recordset.length > 0 ? 'FOUND' : 'NOT_FOUND'}`);
            return result.recordset.length > 0 ? result.recordset[0] : null;
        } catch (error) {
            logGenerator(this.logFileName, 'error', `[${testId}] Error validating Sage payment: ${error.message}`);
            throw error;
        }
    }

    /**
     * Check payment status in Portal
     */
    async checkPortalPaymentStatus(pyId, testId) {
        try {
            const endpoint = `${URL}/api/1.0/extern/tenants/${tenantIds[this.index]}/payments/${pyId}`;
            const response = await axios.get(endpoint, {
                headers: {
                    'PDPTenantKey': apiKeys[this.index],
                    'PDPTenantSecret': apiSecrets[this.index]
                }
            });

            logGenerator(this.logFileName, 'info', `[${testId}] Portal payment status: FOUND - Status: ${response.data.status}`);
            return {
                exists: true,
                status: response.data.status,
                data: response.data
            };
        } catch (error) {
            if (error.response && error.response.status === 404) {
                logGenerator(this.logFileName, 'info', `[${testId}] Portal payment status: NOT_FOUND`);
                return { exists: false, status: 'NOT_FOUND' };
            }
            logGenerator(this.logFileName, 'error', `[${testId}] Error checking Portal payment: ${error.message}`);
            return { exists: false, status: 'ERROR', error: error.message };
        }
    }

    /**
     * Check sync control table status
     */
    async checkSyncControlStatus(pyId, testId) {
        try {
            const query = `
                SELECT 
                    NoPagoSage,
                    status,
                    idFocaltec,
                    GETDATE() as check_time
                FROM fesa.dbo.fesaPagosFocaltec 
                WHERE NoPagoSage = '${pyId}'
            `;
            
            const result = await runQuery(query);
            const exists = result.recordset.length > 0;
            
            logGenerator(this.logFileName, 'info', `[${testId}] Sync control status: ${exists ? 'REGISTERED' : 'NOT_REGISTERED'}`);
            return {
                exists,
                data: exists ? result.recordset[0] : null
            };
        } catch (error) {
            logGenerator(this.logFileName, 'error', `[${testId}] Error checking sync control: ${error.message}`);
            throw error;
        }
    }

    /**
     * Perform payment synchronization
     */
    async performPaymentSync(sagePayment, testId, options = {}) {
        try {
            // Get invoice details for the payment
            const invoices = await this.getPaymentInvoices(sagePayment, testId);
            if (!invoices || invoices.length === 0) {
                return { 
                    success: false, 
                    message: 'No invoices found for payment',
                    step: 'GET_INVOICES'
                };
            }

            // Build payment payload
            const payload = this.buildPaymentPayload(sagePayment, invoices);
            
            logGenerator(this.logFileName, 'info', `[${testId}] Payment payload built: ${JSON.stringify(payload, null, 2)}`);

            if (this.dryRun) {
                return {
                    success: true,
                    message: 'DRY RUN - Payment payload validated but not sent',
                    payload,
                    step: 'DRY_RUN'
                };
            }

            // Send to Portal API
            const portalResult = await this.sendToPortal(payload, testId);
            if (!portalResult.success) {
                return portalResult;
            }

            // Update control table
            const controlResult = await this.updateControlTable(sagePayment, portalResult.portalId, testId);
            
            return {
                success: controlResult.success,
                message: controlResult.success ? 'Payment synced successfully' : 'Portal sync succeeded but control table update failed',
                payload,
                portalId: portalResult.portalId,
                step: 'COMPLETE'
            };

        } catch (error) {
            logGenerator(this.logFileName, 'error', `[${testId}] Error performing payment sync: ${error.message}`);
            return {
                success: false,
                message: `Sync error: ${error.message}`,
                step: 'ERROR'
            };
        }
    }

    /**
     * Get invoices associated with payment
     */
    async getPaymentInvoices(sagePayment, testId) {
        const query = `
            SELECT DISTINCT
                DP.CNTBTCH        AS LotePago,
                DP.CNTRMIT        AS AsientoPago,
                RTRIM(DP.IDINVC)  AS invoice_external_id,
                H.AMTGROSDST      AS invoice_amount,
                CASE H.CODECURN WHEN 'MXP' THEN 'MXN' ELSE H.CODECURN END AS invoice_currency,
                H.EXCHRATEHC      AS invoice_exchange_rate,
                DP.AMTPAYM        AS payment_amount,
                ISNULL((SELECT SWPAID FROM APOBL WHERE IDINVC = DP.IDINVC AND IDVEND = DP.IDVEND), 0) AS FULL_PAID,
                ISNULL((SELECT RTRIM([VALUE]) FROM APIBHO WHERE CNTBTCH = H.CNTBTCH AND CNTITEM = H.CNTITEM AND OPTFIELD = 'FOLIOCFD'), '') AS UUID,
                R.RATEEXCHHC as exchange_rate
            FROM APTCP DP
            JOIN APTCR R ON R.CNTBTCH = DP.CNTBTCH AND R.CNTENTR = DP.CNTRMIT
            JOIN APIBH H ON DP.IDVEND = H.IDVEND AND DP.IDINVC = H.IDINVC AND H.ERRENTRY = 0
            JOIN APIBC C ON H.CNTBTCH = C.CNTBTCH AND C.BTCHSTTS = 3
            WHERE DP.BATCHTYPE = 'PY'
                AND DP.CNTBTCH = ${sagePayment.LotePago}
                AND DP.CNTRMIT = ${sagePayment.AsientoPago}
                AND DP.DOCTYPE = 1
        `;

        try {
            const result = await runQuery(query, database[this.index]);
            logGenerator(this.logFileName, 'info', `[${testId}] Found ${result.recordset.length} invoices for payment`);
            return result.recordset;
        } catch (error) {
            logGenerator(this.logFileName, 'error', `[${testId}] Error getting payment invoices: ${error.message}`);
            throw error;
        }
    }

    /**
     * Build payment payload for Portal API
     */
    buildPaymentPayload(sagePayment, invoices) {
        const cfdis = invoices.map(inv => {
            const sameCurrency = inv.invoice_currency === sagePayment.bk_currency;
            const UUID_Capitalized = inv.UUID ? inv.UUID.toUpperCase() : '';
            return {
                amount: inv.payment_amount,
                currency: inv.invoice_currency,
                exchange_rate: sameCurrency ? 1 : inv.invoice_exchange_rate,
                payment_amount: inv.payment_amount,
                payment_currency: sagePayment.bk_currency,
                uuid: UUID_Capitalized
            };
        });

        const d = sagePayment.payment_date.toString();
        const payment_date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T10:00:00.000Z`;

        // Check if all invoices are fully paid
        const allFull = invoices.every(inv => inv.FULL_PAID === 1 || inv.FULL_PAID === '1');

        return {
            bank_account_id: sagePayment.bank_account_id,
            cfdis,
            comments: sagePayment.comments,
            currency: sagePayment.bk_currency,
            external_id: sagePayment.external_id,
            ignore_amounts: false,
            mark_existing_cfdi_as_payed: allFull,
            open: false,
            operation_type: sagePayment.operation_type,
            payment_date,
            provider_external_id: sagePayment.provider_external_id,
            reference: sagePayment.reference,
            total_amount: sagePayment.total_amount
        };
    }

    /**
     * Send payment to Portal API
     */
    async sendToPortal(payload, testId) {
        try {
            const endpoint = `${URL}/api/1.0/extern/tenants/${tenantIds[this.index]}/payments`;
            const response = await axios.post(endpoint, payload, {
                headers: {
                    'PDPTenantKey': apiKeys[this.index],
                    'PDPTenantSecret': apiSecrets[this.index],
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 200) {
                const portalId = response.data && response.data.id ? response.data.id : null;
                logGenerator(this.logFileName, 'info', `[${testId}] Payment sent to Portal successfully - Portal ID: ${portalId}`);
                return {
                    success: true,
                    portalId,
                    response: response.data
                };
            } else {
                logGenerator(this.logFileName, 'error', `[${testId}] Portal API returned status ${response.status}`);
                return {
                    success: false,
                    message: `Portal API error: ${response.status}`,
                    response: response.data
                };
            }
        } catch (error) {
            logGenerator(this.logFileName, 'error', `[${testId}] Error sending to Portal: ${error.message}`);
            return {
                success: false,
                message: `Portal send error: ${error.message}`,
                error: error.response?.data
            };
        }
    }

    /**
     * Update sync control table
     */
    async updateControlTable(sagePayment, portalId, testId) {
        try {
            const insertSql = `
                INSERT INTO fesa.dbo.fesaPagosFocaltec
                (idCia, NoPagoSage, status, idFocaltec)
                VALUES
                ('${database[this.index]}', '${sagePayment.external_id}', 'SYNCED', ${portalId ? `'${portalId}'` : 'NULL'})
            `;

            const result = await runQuery(insertSql);
            if (result.rowsAffected[0] > 0) {
                logGenerator(this.logFileName, 'info', `[${testId}] Control table updated successfully`);
                return { success: true };
            } else {
                logGenerator(this.logFileName, 'error', `[${testId}] Control table update failed - no rows affected`);
                return { success: false, message: 'No rows affected in control table' };
            }
        } catch (error) {
            logGenerator(this.logFileName, 'error', `[${testId}] Error updating control table: ${error.message}`);
            return { success: false, message: `Control table error: ${error.message}` };
        }
    }

    /**
     * Record test result
     */
    recordTestResult(testId, status, message, data = {}) {
        const result = {
            testId,
            status,
            message,
            timestamp: new Date().toISOString(),
            data
        };
        
        this.testResults.push(result);
        logGenerator(this.logFileName, 'info', `[${testId}] Test completed - Status: ${status} - Message: ${message}`);
        
        return result;
    }

    /**
     * Generate test report
     */
    generateReport() {
        const summary = this.testResults.reduce((acc, result) => {
            acc[result.status] = (acc[result.status] || 0) + 1;
            return acc;
        }, {});

        const report = {
            summary,
            totalTests: this.testResults.length,
            results: this.testResults,
            generatedAt: new Date().toISOString()
        };

        console.log('\n=== ENHANCED PAYMENT SYNC TEST REPORT ===');
        console.log(`Total Tests: ${report.totalTests}`);
        console.log(`Summary:`, summary);
        console.log('\nDetailed Results:');
        this.testResults.forEach(result => {
            console.log(`  ${result.testId}: ${result.status} - ${result.message}`);
        });
        console.log('==========================================\n');

        return report;
    }

    /**
     * Use existing controllers for full batch processing
     */
    async runFullSyncProcess(options = {}) {
        const testId = `FULL_SYNC_${Date.now()}`;
        logGenerator(this.logFileName, 'info', `[${testId}] Starting full sync process using existing controllers`);
        
        try {
            // Step 1: Process CFDIs from Portal (updates Sage with UUIDs/timestamps)
            logGenerator(this.logFileName, 'info', `[${testId}] Running checkPayments to process CFDIs`);
            await checkPayments(this.index);
            
            // Step 2: Upload payments to Portal (syncs Sage payments to Portal)
            logGenerator(this.logFileName, 'info', `[${testId}] Running uploadPayments to sync to Portal`);
            if (!this.dryRun) {
                await uploadPayments(this.index);
            } else {
                logGenerator(this.logFileName, 'info', `[${testId}] DRY RUN - Skipping actual uploadPayments`);
            }
            
            return this.recordTestResult(testId, 'PASSED', 'Full sync process completed', {
                cfdiProcessed: true,
                paymentsUploaded: !this.dryRun
            });
            
        } catch (error) {
            logGenerator(this.logFileName, 'error', `[${testId}] Full sync process failed: ${error.message}`);
            return this.recordTestResult(testId, 'FAILED', `Full sync error: ${error.message}`, {
                error: error.message
            });
        }
    }

    /**
     * Hybrid approach: Use controllers for batch + individual testing for specific payments
     */
    async runHybridSync(pyIds, options = {}) {
        logGenerator(this.logFileName, 'info', `Starting hybrid sync for ${pyIds.length} specific payments`);
        
        // First run full sync process
        await this.runFullSyncProcess(options);
        
        // Then test specific payments for validation
        for (const pyId of pyIds) {
            await this.testSpecificPayment(pyId, options);
        }

        return this.generateReport();
    }

    /**
     * Test multiple payments in batch
     */
    async testPaymentBatch(pyIds, options = {}) {
        logGenerator(this.logFileName, 'info', `Starting batch test for ${pyIds.length} payments`);
        
        for (const pyId of pyIds) {
            await this.testSpecificPayment(pyId, options);
        }

        return this.generateReport();
    }
}

/**
 * CLI Interface for testing
 */
async function main() {
    const args = process.argv.slice(2);
    
    // Parse index parameter
    let index = 0; // Default to first tenant
    const indexArg = args.find(arg => arg.startsWith('--index='));
    if (indexArg) {
        index = parseInt(indexArg.split('=')[1]) || 0;
    }
    
    const options = {
        dryRun: args.includes('--dry-run'),
        forcePost: args.includes('--force-post'),
        index
    };

    // Check for operation mode
    const fullSync = args.includes('--full-sync');
    const hybridSync = args.includes('--hybrid-sync');
    
    // Find PY payment IDs in arguments
    const pyIds = args.filter(arg => !arg.startsWith('--') && arg.match(/^PY/));
    
    if (!fullSync && !hybridSync && pyIds.length === 0) {
        console.log('Usage Options:');
        console.log('  Individual: node EnhancedPaymentSync.test.js [PY_ID] [--dry-run] [--force-post] [--index=N]');
        console.log('  Full Sync:  node EnhancedPaymentSync.test.js --full-sync [--dry-run] [--index=N]');
        console.log('  Hybrid:     node EnhancedPaymentSync.test.js PY0060684 PY0060683 --hybrid-sync [--dry-run] [--index=N]');
        console.log('');
        console.log('Parameters:');
        console.log('  --index=N   : Select tenant/database index (0=default, 1=second tenant, etc.)');
        console.log('  --dry-run   : Test without making changes');
        console.log('  --force-post: Force sync even if already registered');
        console.log('');
        console.log('Examples:');
        console.log('  node EnhancedPaymentSync.test.js PY0060684 --dry-run --index=0');
        console.log('  node EnhancedPaymentSync.test.js --full-sync --dry-run --index=1');
        console.log('  node EnhancedPaymentSync.test.js PY0060684 PY0060683 --hybrid-sync --index=0');
        process.exit(1);
    }

    const tester = new EnhancedPaymentTester(options);
    
    // Display tenant information
    console.log(`🏢 Using Tenant Index: ${index} (${tenantIds[index]} - ${database[index]})`);
    
    if (options.dryRun) {
        console.log('🧪 Running in DRY RUN mode - no actual syncing will occur');
    }
    
    if (options.forcePost) {
        console.log('🚀 Force post enabled - will attempt sync even if already registered');
    }

    try {
        let report;
        
        if (fullSync) {
            console.log('🔄 Running full sync process using existing controllers...');
            await tester.runFullSyncProcess(options);
            report = tester.generateReport();
            
        } else if (hybridSync && pyIds.length > 0) {
            console.log(`🔀 Running hybrid sync for ${pyIds.length} specific payments...`);
            report = await tester.runHybridSync(pyIds, options);
            
        } else {
            console.log(`🎯 Testing ${pyIds.length} specific payments...`);
            report = await tester.testPaymentBatch(pyIds, options);
        }
        
        // Save report to file
        const fs = require('fs');
        const reportPath = `./reports/payment_sync_test_${Date.now()}.json`;
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`📄 Test report saved to: ${reportPath}`);
        
    } catch (error) {
        console.error('❌ Test execution failed:', error.message);
        process.exit(1);
    }
}

// Export for use in other modules
module.exports = { EnhancedPaymentTester };

// Run if called directly
if (require.main === module) {
    main();
}