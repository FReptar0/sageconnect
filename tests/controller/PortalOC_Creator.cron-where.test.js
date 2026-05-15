/**
 * Integration tests for src/controller/PortalOC_Creator.js — Phase 20 cron WHERE rewrite.
 *
 * Covers CONTEXT D-12 Layer 2 (3 cases) — runQuery is mocked to return canned recordsets;
 * the assertions verify controller behavior across the three retry states:
 *   1  POSTED skip            — WHERE NOT EXISTS POSTED filtered the row at SQL level (empty recordset).
 *   2  ERROR-in-backoff skip  — 1 ERROR row 5 min ago; JS post-filter defers it (15-min backoff not elapsed).
 *   3  ERROR-out-of-backoff   — 1 ERROR row 20 min ago; JS post-filter keeps it; upload loop runs.
 *
 * RetryPolicy.js is intentionally NOT mocked — the tests assert the real SQL shape
 * (OUTER APPLY, NOT EXISTS, sargable scope) that the helpers emit into the query string.
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');

jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://test',
        tenants: [{ id: 'T1', key: 'k1', secret: 's1', database: 'COPDAT', externalId: 'ext1' }],
        httpTimeoutMs: 30000,
    },
    paths: { downloads: '/tmp/downloads', logs: '/tmp/logs', providers: '/tmp/p' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', notices: [], cc: [], password: '' },
    license: { adminEmail: 'admin@test.com' },
    app: {
        company: 'TestCo', timezone: 'America/Mexico_City', rfc: 'RFC', regimen: 'R1', arg: 'A1',
        importRoute: '',
        defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
        addressIdentifiersSkip: [],
    },
    security: { apiKey: 'test-key' },
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 0, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
    retry: { scope: 'current_month', lookbackDays: 30, backoff: { initialMin: 15, multiplier: 2, maxMin: 1440 } },
    eom: { notificationHour: 18, notificationEnabled: true },
}));

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

const mockPortalPost = jest.fn();
jest.mock('../../src/utils/PortalClient', () => ({ post: mockPortalPost }));

jest.mock('../../src/utils/TimezoneHelper', () => ({ getCurrentDateString: () => '2026-05-15' }));
jest.mock('../../src/utils/OC_GroupOrdersByNumber', () => ({ groupOrdersByNumber: (rs) => rs }));
jest.mock('../../src/utils/parseExternPurchaseOrders', () => ({
    parseExternPurchaseOrders: (g) => g.map((r) => ({ external_id: r.EXTERNAL_ID, cfdi_payment_method: '', requisition_number: 0, _row: r })),
}));
jest.mock('../../src/models/PurchaseOrder', () => ({ validateExternPurchaseOrder: (po) => po }));

const { createPurchaseOrders } = require('../../src/controller/PortalOC_Creator');

describe('PortalOC_Creator cron WHERE rewrite (Phase 20)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('POSTED rows filtered by WHERE — recordset empty, no portal POST', async () => {
        mockRunQuery.mockResolvedValueOnce({ recordset: [] });
        await createPurchaseOrders(0);

        const sqlPassed = mockRunQuery.mock.calls[0][0];
        expect(sqlPassed).toMatch(/NOT EXISTS/);
        expect(sqlPassed).toMatch(/OUTER APPLY/);
        expect(sqlPassed).toMatch(/DATEFROMPARTS|DATEADD\(month/);
        expect(sqlPassed).toMatch(/status = 'POSTED'/);
        expect(mockRunQuery.mock.calls[0][1]).toBe('COPDAT');

        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[BACKOFF\] tenant=COPDAT candidates=0 deferred=0 processing=0$/));
    });

    test('ERROR row in backoff window dropped — [BACKOFF-DEFER] log, no portal POST', async () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [{
                EXTERNAL_ID: 'PO0083449',
                errorCount: 1,
                lastErrorAt: fiveMinAgo,
            }],
        });
        await createPurchaseOrders(0);

        const sqlPassed = mockRunQuery.mock.calls[0][0];
        expect(sqlPassed).toMatch(/OUTER APPLY/);
        expect(sqlPassed).toMatch(/NOT EXISTS/);

        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[BACKOFF-DEFER\] PO PO0083449 tenant=COPDAT attempts=1 nextEligibleAt=/));
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[BACKOFF\] tenant=COPDAT candidates=1 deferred=1 processing=0$/));
    });

    test('ERROR row out of backoff window included — [BACKOFF] processing=1', async () => {
        const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [{
                EXTERNAL_ID: 'PO0083500',
                errorCount: 1,
                lastErrorAt: twentyMinAgo,
            }],
        });
        // Subsequent FESA INSERT calls (ERROR row after the forced POST failure).
        mockRunQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
        mockPortalPost.mockRejectedValueOnce(new Error('mock portal failure'));

        await createPurchaseOrders(0);

        expect(mockPortalPost).toHaveBeenCalledTimes(1);
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[BACKOFF\] tenant=COPDAT candidates=1 deferred=0 processing=1$/));

        const deferCalls = mockLogGenerator.mock.calls.filter((c) => /\[BACKOFF-DEFER\] PO PO0083500/.test(c[2] || ''));
        expect(deferCalls.length).toBe(0);
    });
});
