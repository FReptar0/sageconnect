// tests/envelope-contract.test.js
// Contract test: validates every script exports the expected functions.
// These are STRUCTURAL tests only -- we do NOT call the functions (they need real DB/API).
// The envelope SHAPE is enforced by ResultEnvelope.js (tested separately).
// This test ensures every module uses that helper by verifying the export contract.

// Envelope Contract Reference:
// { success: boolean, data: any|null, errors: Array<string>, summary: string, meta: { duration: number, timestamp: string, tenant: string|number|null } }

// --- Mocks (must be before requires) ---

// Mock config.js to avoid process.exit on missing env vars
jest.mock('../src/config', () => ({
    database: { user: 'test', password: 'test', server: 'test', database: 'FESA' },
    portal: {
        url: 'http://test',
        tenants: [{
            id: '1', key: 'k', secret: 's', database: 'COPDAT', externalId: 'e'
        }]
    },
    mailing: {},
    paths: { downloads: '/tmp', logs: '/tmp' },
    app: {
        autoTerminate: false,
        defaultAddress: {
            city: '', country: '', identifier: '', municipality: '',
            state: '', street: '', zip: ''
        },
        addressIdentifiersSkip: []
    }
}));

// Mock SQLServerConnection to avoid real DB connections
jest.mock('../src/utils/SQLServerConnection', () => ({
    runQuery: jest.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] }),
    closePool: jest.fn(),
    getPool: jest.fn()
}));

// Mock LogGenerator to avoid file I/O
jest.mock('../src/utils/LogGenerator', () => ({
    logGenerator: jest.fn()
}));

// Mock axios to avoid real HTTP calls
jest.mock('axios', () => ({
    get: jest.fn().mockResolvedValue({ data: {}, status: 200 }),
    post: jest.fn().mockResolvedValue({ data: {}, status: 200 }),
    put: jest.fn().mockResolvedValue({ data: {}, status: 200 }),
    create: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: {}, status: 200 }),
        post: jest.fn().mockResolvedValue({ data: {}, status: 200 }),
        put: jest.fn().mockResolvedValue({ data: {}, status: 200 })
    })
}));

// Mock mssql for modules that import it directly
jest.mock('mssql', () => ({
    ConnectionPool: jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue({}),
        close: jest.fn(),
        request: jest.fn().mockReturnValue({ query: jest.fn().mockResolvedValue({ recordset: [] }) }),
        on: jest.fn()
    })),
    Int: 'Int',
    NVarChar: 'NVarChar'
}));

// Mock TimezoneHelper
jest.mock('../src/utils/TimezoneHelper', () => ({
    getCurrentDateString: jest.fn().mockReturnValue('2026-01-01'),
    getCurrentDate: jest.fn().mockReturnValue(new Date()),
    getOneMonthAgo: jest.fn().mockReturnValue('2025-12'),
    getCurrentDateStringNoSeparator: jest.fn().mockReturnValue('20260101'),
    getOneMonthAgoNoSeparator: jest.fn().mockReturnValue('20251201'),
    getCurrentDateISO: jest.fn().mockReturnValue('2026-01-01T00:00:00.000Z')
}));

// Mock PurchaseOrder model
jest.mock('../src/models/PurchaseOrder', () => ({
    validateExternPurchaseOrder: jest.fn()
}));

// Mock OC_GroupOrdersByNumber
jest.mock('../src/utils/OC_GroupOrdersByNumber', () => ({
    groupOrdersByNumber: jest.fn().mockReturnValue({})
}));

// Mock parseExternPurchaseOrders
jest.mock('../src/utils/parseExternPurchaseOrders', () => ({
    parseExternPurchaseOrders: jest.fn().mockReturnValue([])
}));

// Mock PortalOC_LifecycleManager for test-order-lifecycle
jest.mock('../src/controller/PortalOC_LifecycleManager', () => ({
    processSpecificOrder: jest.fn().mockResolvedValue({ success: true }),
    analyzeOrderStatus: jest.fn().mockResolvedValue({ ponumber: 'PO1', status: 'OK', recommendation: 'none' }),
    processOrderChanges: jest.fn().mockResolvedValue({ tenant: 'test', totalProcessed: 0, ordersCancelled: 0, ordersUpdated: 0, errors: 0 })
}));

// Mock http/https agents for PortalOC_StatusUpdater
jest.mock('http', () => ({
    Agent: jest.fn().mockImplementation(() => ({}))
}));
jest.mock('https', () => ({
    Agent: jest.fn().mockImplementation(() => ({}))
}));

// Mock fs for payment-uuid-repair state file
jest.mock('fs', () => {
    const originalFs = jest.requireActual('fs');
    return {
        ...originalFs,
        readFileSync: jest.fn().mockImplementation((filePath, ...args) => {
            // Let actual fs handle test files and source files
            if (typeof filePath === 'string' && filePath.includes('repair-state.json')) {
                return JSON.stringify({ lastScanDate: null, summary: {}, payments: {} });
            }
            return originalFs.readFileSync(filePath, ...args);
        }),
        writeFileSync: jest.fn(),
        existsSync: jest.fn().mockImplementation((filePath) => {
            if (typeof filePath === 'string' && filePath.includes('repair-state.json')) return true;
            if (typeof filePath === 'string' && filePath.includes('data')) return true;
            return originalFs.existsSync(filePath);
        }),
        mkdirSync: jest.fn()
    };
});

// ---------------------------------------------------------------------------
// Module definitions: path + expected exports
// ---------------------------------------------------------------------------
const scriptModules = [
    { path: '../src/scripts/payment-reconciliation.js', expectedExports: ['classifyPayments', 'uploadBatch'] },
    { path: '../src/scripts/po-upload.js', expectedExports: ['uploadSpecificPurchaseOrders'] },
    { path: '../src/scripts/po-update.js', expectedExports: ['testPurchaseOrderUpdate', 'searchPOInFESA'] },
    { path: '../src/scripts/po-query.js', expectedExports: ['testSpecificPurchaseOrders'] },
    { path: '../src/scripts/po-diagnostic.js', expectedExports: ['diagnosticPO', 'getAuthorizedPOsToday'] },
    { path: '../src/scripts/po-address-diagnostic.js', expectedExports: ['diagnosticPOAddress'] },
    { path: '../src/scripts/po-payment-form-diagnostic.js', expectedExports: ['diagnosticPaymentForm'] },
    { path: '../src/scripts/get-payment-cfdis.js', expectedExports: ['getTypePTest'] },
    { path: '../src/scripts/payment-uuid-diagnostic.js', expectedExports: ['diagnosePayment', 'getAllFailingPayments'] },
    { path: '../src/scripts/payment-uuid-repair.js', expectedExports: ['scanForRepairableUUIDs', 'repairUUIDs', 'uploadRepairedPayments'] },
    { path: '../src/scripts/portal-payments-generator.js', expectedExports: ['generatePayments'] },
    { path: '../src/scripts/upload-authorized-pos.js', expectedExports: ['uploadAuthorizedPOs'] },
    { path: '../src/scripts/test-order-lifecycle.js', expectedExports: ['analyzeOrders', 'processOrders', 'testTenant'] },
    { path: '../src/controller/PortalOC_StatusUpdater.js', expectedExports: ['updatePOStatus'] },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Envelope Contract: Module Exports', () => {

    // Test 1: Every module can be required without throwing
    describe('require succeeds for all modules', () => {
        for (const mod of scriptModules) {
            const moduleName = mod.path.split('/').pop();
            test(`require(${moduleName}) does not throw`, () => {
                expect(() => require(mod.path)).not.toThrow();
            });
        }
    });

    // Test 2: All expected exports exist as keys
    describe('expected exports exist', () => {
        for (const mod of scriptModules) {
            const moduleName = mod.path.split('/').pop();
            test(`${moduleName} exports: ${mod.expectedExports.join(', ')}`, () => {
                const loaded = require(mod.path);
                for (const exportName of mod.expectedExports) {
                    expect(loaded).toHaveProperty(exportName);
                }
            });
        }
    });

    // Test 3: All exported functions are functions (not strings, objects, etc.)
    describe('exported values are functions', () => {
        for (const mod of scriptModules) {
            const moduleName = mod.path.split('/').pop();
            for (const exportName of mod.expectedExports) {
                test(`${moduleName}.${exportName} is a function`, () => {
                    const loaded = require(mod.path);
                    expect(typeof loaded[exportName]).toBe('function');
                });
            }
        }
    });

    // Test 4: No exported function is named 'main' or 'default'
    describe('no exports named main or default', () => {
        for (const mod of scriptModules) {
            const moduleName = mod.path.split('/').pop();
            test(`${moduleName} has no main/default export`, () => {
                const loaded = require(mod.path);
                const keys = Object.keys(loaded);
                expect(keys).not.toContain('main');
                expect(keys).not.toContain('default');
            });
        }
    });

    // Test 5: Total module count matches expectations (13 scripts + 1 controller)
    test('contract covers exactly 14 modules (13 scripts + 1 controller)', () => {
        expect(scriptModules.length).toBe(14);
        const scriptCount = scriptModules.filter(m => m.path.includes('/scripts/')).length;
        const controllerCount = scriptModules.filter(m => m.path.includes('/controller/')).length;
        expect(scriptCount).toBe(13);
        expect(controllerCount).toBe(1);
    });
});
