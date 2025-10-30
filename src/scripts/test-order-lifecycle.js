// src/scripts/test-order-lifecycle.js

/**
 * CLI script to test the new order lifecycle management
 * Usage: node test-order-lifecycle.js <action> <ponumber> <tenantIndex>
 * 
 * Actions:
 *   analyze    - Analyze order cancellation status
 *   process    - Process specific order (update/cancel based on status)
 *   tenant     - Process all orders for a tenant
 */

const { processSpecificOrder, analyzeOrderStatus, processOrderChanges } = require('../controller/PortalOC_LifecycleManager');

async function main() {
    const [, , action, ponumber, tenantIndex] = process.argv;

    if (!action) {
        console.log('Usage: node test-order-lifecycle.js <action> [ponumber] [tenantIndex]');
        console.log('');
        console.log('Actions:');
        console.log('  analyze <ponumber> <tenantIndex>  - Analyze order cancellation status');
        console.log('  process <ponumber> <tenantIndex>  - Process specific order');
        console.log('  tenant <tenantIndex>              - Process all orders for tenant');
        process.exit(1);
    }

    try {
        switch (action) {
            case 'analyze':
                if (!ponumber || tenantIndex === undefined) {
                    console.error('Error: analyze requires ponumber and tenantIndex');
                    process.exit(1);
                }
                await analyzeOrder(ponumber, parseInt(tenantIndex));
                break;

            case 'process':
                if (!ponumber || tenantIndex === undefined) {
                    console.error('Error: process requires ponumber and tenantIndex');
                    process.exit(1);
                }
                await processOrder(ponumber, parseInt(tenantIndex));
                break;

            case 'tenant':
                if (tenantIndex === undefined) {
                    console.error('Error: tenant requires tenantIndex');
                    process.exit(1);
                }
                await processTenant(parseInt(tenantIndex));
                break;

            default:
                console.error(`Error: Unknown action '${action}'`);
                process.exit(1);
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

async function analyzeOrder(ponumber, tenantIndex) {
    console.log(`🔍 Analyzing order ${ponumber} for tenant index ${tenantIndex}...`);
    
    const analysis = await analyzeOrderStatus(ponumber, tenantIndex);
    
    console.log('\n📊 Analysis Results:');
    console.log(`  Order Number: ${analysis.ponumber}`);
    console.log(`  Status: ${analysis.status}`);
    console.log(`  Recommendation: ${analysis.recommendation}`);
    
    if (analysis.totalOrdered !== undefined) {
        console.log(`  Total Ordered: ${analysis.totalOrdered}`);
        console.log(`  Total Cancelled: ${analysis.totalCancelled}`);
        console.log(`  Line Count: ${analysis.lineCount}`);
        console.log(`  Fully Cancelled Lines: ${analysis.fullyCancelledLines}`);
        console.log(`  Partially Cancelled Lines: ${analysis.partiallyCancelledLines}`);
    }
    
    if (analysis.error) {
        console.log(`  Error: ${analysis.error}`);
    }
}

async function processOrder(ponumber, tenantIndex) {
    console.log(`⚡ Processing order ${ponumber} for tenant index ${tenantIndex}...`);
    
    const result = await processSpecificOrder(ponumber, tenantIndex);
    
    console.log('\n📋 Processing Results:');
    console.log(`  Success: ${result.success}`);
    
    if (result.success) {
        console.log(`  Action: ${result.action || 'Order processed'}`);
        if (result.reason) {
            console.log(`  Reason: ${result.reason}`);
        }
    } else {
        console.log(`  Error: ${result.error}`);
    }
    
    if (result.analysis) {
        console.log('\n📊 Analysis:');
        console.log(`  Status: ${result.analysis.status}`);
        console.log(`  Recommendation: ${result.analysis.recommendation}`);
    }
}

async function processTenant(tenantIndex) {
    console.log(`🏢 Processing all orders for tenant index ${tenantIndex}...`);
    
    const summary = await processOrderChanges(tenantIndex);
    
    console.log('\n📈 Processing Summary:');
    console.log(`  Tenant: ${summary.tenant}`);
    console.log(`  Date: ${summary.date}`);
    console.log(`  Total Processed: ${summary.totalProcessed}`);
    console.log('');
    console.log('📊 Breakdown:');
    console.log(`  Fully Cancelled Orders: ${summary.fullyCancelledOrders} (${summary.ordersCancelled} success)`);
    console.log(`  Partially Cancelled Orders: ${summary.partiallyCancelledOrders} (${summary.ordersUpdated} success)`);
    console.log(`  Total Errors: ${summary.errors}`);
    
    const successRate = summary.totalProcessed > 0 
        ? ((summary.ordersCancelled + summary.ordersUpdated) / summary.totalProcessed * 100).toFixed(1)
        : 0;
    console.log(`  Success Rate: ${successRate}%`);
}

main();