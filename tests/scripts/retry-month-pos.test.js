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
    retry: { scope: 'current_month', lookbackDays: 30, interval: { payment: 30, po: 240 } },
    eom: { notificationHour: 18, notificationEnabled: true },
}));

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

const mockCreatePurchaseOrders = jest.fn();
jest.mock('../../src/controller/PortalOC_Creator', () => ({ createPurchaseOrders: mockCreatePurchaseOrders }));

const { runRetryMonthPOs } = require('../../src/scripts/retry-month-pos');

// Mirrors config.retry.interval.po in the mock above. Fixtures derive from it (+10 min) so the
// "must exceed the interval" intent survives a retune of the default (20.1: fixed 240-min PO interval).
const PO_INTERVAL_MIN = 240;

// Single-clock fixtures (20.2 D-01 / hazard H-2).
// SERVER_SKEW_MIN is the measured DATEDIFF(mi, GETUTCDATE(), GETDATE()) on the deployed SQL host,
// 2026-07-27. DB_NOW stands in for the `GETDATE() AS dbNow` column the sweep now projects.
// Every lastErrorAt below derives from DB_NOW, never from Date.now(): a fixture that leaves dbNow
// unset falls through to the process clock and keeps passing whatever the script does.
const SERVER_SKEW_MIN = 360;
const DB_NOW = new Date(Date.now() - SERVER_SKEW_MIN * 60 * 1000);

describe('retry-month-pos script', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    test('dry-run mode: does NOT call createPurchaseOrders, returns mode=dry-run', async () => {
        // Both derived from DB_NOW: 5 min old on the SERVER clock, 365 on the process clock.
        // Under a Node-clock implementation row 1 reads as past the 240-min interval and the
        // totalDeferred: 1 assertion below fails — that is what makes this the skew proof.
        const fiveMinAgo = new Date(DB_NOW.getTime() - 5 * 60 * 1000);
        const pastIntervalAt = new Date(DB_NOW.getTime() - (PO_INTERVAL_MIN + 10) * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [
                { po: 'PO0083449', tenant: 'COPDAT', fechaAuth: '2026-05-07', errorCount: 1, lastErrorAt: fiveMinAgo, dbNow: DB_NOW }, // in-interval → defer
                { po: 'PO0083500', tenant: 'COPDAT', fechaAuth: '2026-05-12', errorCount: 1, lastErrorAt: pastIntervalAt, dbNow: DB_NOW }, // past interval → eligible
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
        // RETRY-C7: the dry-run preview dedupe must mirror PortalOC_Creator's — excluding CLOSED
        // as well as POSTED — or the preview stops matching what --apply actually processes.
        expect(sqlPassed).toMatch(/status IN \('CLOSED', 'POSTED'\)/);
        expect(sqlPassed).not.toMatch(/AND status = 'POSTED'/);
        // D-12 #1 (20.2 D-01): the single clock, projected by the same statement as lastErrorAt.
        // Only this catches removal of the column — the helper's fallback to the process clock
        // is silent, which is the divergence this preview exists to avoid.
        expect(sqlPassed).toMatch(/GETDATE\(\)\s+AS\s+dbNow/);
        // fesaOCFocaltec DOES have lastUpdate, so the OC branch must keep emitting MAX(lastUpdate).
        expect(sqlPassed).toMatch(/MAX\(lastUpdate\) AS lastErrorAt/);
        // GETDATE() is a per-statement runtime constant, not a column reference, so it is legal
        // in the SELECT of a grouped query and belongs OUTSIDE the grouping key list. Adding it
        // there would make it a grouping key and change the result cardinality.
        expect(sqlPassed).not.toMatch(/GROUP BY[^\n]*dbNow/);
    });

    test('apply mode: calls createPurchaseOrders(0), returns mode=apply', async () => {
        const pastIntervalAt = new Date(DB_NOW.getTime() - (PO_INTERVAL_MIN + 10) * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [
                { po: 'PO0083500', tenant: 'COPDAT', fechaAuth: '2026-05-12', errorCount: 1, lastErrorAt: pastIntervalAt, dbNow: DB_NOW },
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
        const fiveMinAgo = new Date(DB_NOW.getTime() - 5 * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [
                { po: 'PO0083449', tenant: 'COPDAT', fechaAuth: '2026-05-07', errorCount: 1, lastErrorAt: fiveMinAgo, dbNow: DB_NOW }, // all in-interval
            ],
        });

        const envelope = await runRetryMonthPOs(true, 0);

        expect(mockCreatePurchaseOrders).not.toHaveBeenCalled();
        expect(envelope.data.totalEligible).toBe(0);
        expect(envelope.data.totalDeferred).toBe(1);
    });
});
