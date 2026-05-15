jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://test',
        tenants: [
            { id: 'T1', key: 'k1', secret: 's1', database: 'COPDAT', externalId: 'ext1' },
            { id: 'T2', key: 'k2', secret: 's2', database: 'DB2', externalId: 'ext2' },
        ],
        httpTimeoutMs: 30000,
    },
    paths: { downloads: '/tmp/d', logs: '/tmp/l', providers: '/tmp/p' },
    database: { user: 't', password: 't', server: 'localhost', database: 'T' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'n@t', notices: [], cc: [], password: '' },
    license: { adminEmail: 'a@t' },
    app: { company: 'TestCo', timezone: 'America/Mexico_City', rfc: '', regimen: '', arg: '', importRoute: '',
        defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
        addressIdentifiersSkip: [] },
    security: { apiKey: 'k' },
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 0, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
    retry: { scope: 'current_month', lookbackDays: 30, backoff: { initialMin: 15, multiplier: 2, maxMin: 1440 } },
    eom: { notificationHour: 18, notificationEnabled: true },
}));

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

const mockCreatePurchaseOrders = jest.fn();
jest.mock('../../src/controller/PortalOC_Creator', () => ({ createPurchaseOrders: mockCreatePurchaseOrders }));

const { runRetryMonthPOs } = require('../../src/scripts/retry-month-pos');

describe('retry-month-pos script', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    test('dry-run mode: does NOT call createPurchaseOrders, returns mode=dry-run', async () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [
                { po: 'PO0083449', tenant: 'COPDAT', fechaAuth: '2026-05-07', errorCount: 1, lastErrorAt: fiveMinAgo }, // in-backoff → defer
                { po: 'PO0083500', tenant: 'COPDAT', fechaAuth: '2026-05-12', errorCount: 1, lastErrorAt: twentyMinAgo }, // out-of-backoff → eligible
            ],
        });

        const envelope = await runRetryMonthPOs(false, 0);

        expect(mockCreatePurchaseOrders).not.toHaveBeenCalled();
        expect(envelope.success).toBe(true);
        expect(envelope.data.mode).toBe('dry-run');
        expect(envelope.data.totalEligible).toBe(1);
        expect(envelope.data.totalDeferred).toBe(1);
        // Verify SQL passed to runQuery uses new helpers (sargable scope + OUTER APPLY)
        const sqlPassed = mockRunQuery.mock.calls[0][0];
        expect(sqlPassed).toMatch(/OUTER APPLY/);
        expect(sqlPassed).toMatch(/DATEFROMPARTS|DATEADD\(month/);
        expect(sqlPassed).toMatch(/NOT EXISTS/);
    });

    test('apply mode: calls createPurchaseOrders(0), returns mode=apply', async () => {
        const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [
                { po: 'PO0083500', tenant: 'COPDAT', fechaAuth: '2026-05-12', errorCount: 1, lastErrorAt: twentyMinAgo },
            ],
        });
        mockCreatePurchaseOrders.mockResolvedValue(undefined);

        const envelope = await runRetryMonthPOs(true, 0);

        expect(mockCreatePurchaseOrders).toHaveBeenCalledWith(0);
        expect(mockCreatePurchaseOrders).toHaveBeenCalledTimes(1);
        expect(envelope.data.mode).toBe('apply');
        expect(envelope.data.totalEligible).toBe(1);
    });

    test('apply mode with empty eligible: does NOT call createPurchaseOrders', async () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [
                { po: 'PO0083449', tenant: 'COPDAT', fechaAuth: '2026-05-07', errorCount: 1, lastErrorAt: fiveMinAgo }, // all in-backoff
            ],
        });

        const envelope = await runRetryMonthPOs(true, 0);

        expect(mockCreatePurchaseOrders).not.toHaveBeenCalled();
        expect(envelope.data.totalEligible).toBe(0);
        expect(envelope.data.totalDeferred).toBe(1);
    });
});
