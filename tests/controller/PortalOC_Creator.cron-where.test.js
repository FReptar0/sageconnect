/**
 * Integration tests for src/controller/PortalOC_Creator.js — Phase 20.1 fixed-interval retry.
 *
 * Covers CONTEXT D-08 Layer 2 (4 cases) — runQuery is mocked to return canned recordsets;
 * the assertions verify controller behavior across the four eligibility outcomes, evaluated
 * against the PO interval (config.retry.interval.po = 240 min):
 *   1  POSTED/CLOSED skip     — WHERE NOT EXISTS filtered the row at SQL level (empty recordset).
 *   2  ERROR inside interval  — 1 ERROR row 5 min ago; JS post-filter defers it (240 min not elapsed).
 *   3  ERROR past interval    — 1 ERROR row 250 min ago; JS post-filter keeps it; upload loop runs.
 *   4  First attempt          — no lastErrorAt; eligible immediately (RETRY-C4, highest blast radius).
 *
 * RetryPolicy.js is intentionally NOT mocked — the tests assert the real SQL shape
 * (OUTER APPLY, NOT EXISTS, sargable scope) that the helpers emit into the query string,
 * and the real eligibility math from computeRetryEligibility.
 *
 * RETRY-C7: the NOT EXISTS dedupe must exclude status IN ('CLOSED', 'POSTED') — a closed OC
 * has no POSTED row left (PortalOC_Closer UPDATEs it to CLOSED), so a POSTED-only dedupe
 * re-selects it and the portal answers 409.
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
    // scope stays 'current_month' here so the DATEFROMPARTS SQL-shape assertions below keep
    // their meaning; the last_n_days default flip is proven in tests/utils/RetryPolicy.test.js.
    retry: { scope: 'current_month', lookbackDays: 30, interval: { payment: 30, po: 240 } },
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

// PO interval under test — mirrors the config mock above (config.retry.interval.po).
const PO_INTERVAL_MIN = 240;

describe('PortalOC_Creator cron WHERE + fixed-interval retry (Phase 20.1)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('POSTED/CLOSED rows filtered by WHERE — recordset empty, no portal POST', async () => {
        mockRunQuery.mockResolvedValueOnce({ recordset: [] });
        await createPurchaseOrders(0);

        const sqlPassed = mockRunQuery.mock.calls[0][0];
        expect(sqlPassed).toMatch(/NOT EXISTS/);
        expect(sqlPassed).toMatch(/OUTER APPLY/);
        expect(sqlPassed).toMatch(/DATEFROMPARTS|DATEADD\(month/);
        // RETRY-C7: the dedupe excludes BOTH lifecycle end-states, not POSTED alone.
        expect(sqlPassed).toMatch(/status IN \('CLOSED', ?'POSTED'\)/);
        expect(sqlPassed).not.toMatch(/AND status = 'POSTED'/);
        expect(mockRunQuery.mock.calls[0][1]).toBe('COPDAT');

        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[RETRY\] tenant=COPDAT candidates=0 deferred=0 processing=0$/));
    });

    test('ERROR row inside the PO interval deferred — [RETRY-DEFER] log, no portal POST', async () => {
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
            expect.stringMatching(/^\[RETRY-DEFER\] PO PO0083449 tenant=COPDAT attempts=1 nextEligibleAt=/));
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[RETRY\] tenant=COPDAT candidates=1 deferred=1 processing=0$/));
    });

    test('ERROR row past the PO interval included — [RETRY] processing=1', async () => {
        // 250 min ago — must exceed the 240-min PO interval, otherwise this row would defer.
        const pastIntervalAt = new Date(Date.now() - (PO_INTERVAL_MIN + 10) * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [{
                EXTERNAL_ID: 'PO0083500',
                errorCount: 1,
                lastErrorAt: pastIntervalAt,
            }],
        });
        // Subsequent FESA INSERT calls (ERROR row after the forced POST failure).
        mockRunQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
        mockPortalPost.mockRejectedValueOnce(new Error('mock portal failure'));

        await createPurchaseOrders(0);

        expect(mockPortalPost).toHaveBeenCalledTimes(1);
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[RETRY\] tenant=COPDAT candidates=1 deferred=0 processing=1$/));

        const deferCalls = mockLogGenerator.mock.calls.filter((c) => /\[RETRY-DEFER\] PO PO0083500/.test(c[2] || ''));
        expect(deferCalls.length).toBe(0);
    });

    test('first-attempt row (no lastErrorAt) included immediately — [RETRY] processing=1', async () => {
        // RETRY-C4: a never-failed PO is not a retry. Deferring it would stall normal uploads.
        mockRunQuery.mockResolvedValueOnce({
            recordset: [{
                EXTERNAL_ID: 'PO0083600',
                errorCount: 0,
                lastErrorAt: null,
            }],
        });
        mockRunQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
        mockPortalPost.mockRejectedValueOnce(new Error('mock portal failure'));

        await createPurchaseOrders(0);

        expect(mockPortalPost).toHaveBeenCalledTimes(1);
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[RETRY\] tenant=COPDAT candidates=1 deferred=0 processing=1$/));

        const deferCalls = mockLogGenerator.mock.calls.filter((c) => /\[RETRY-DEFER\] PO PO0083600/.test(c[2] || ''));
        expect(deferCalls.length).toBe(0);
    });
});
