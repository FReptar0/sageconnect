jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://test',
        tenants: [
            { id: 'T1', key: 'k1', secret: 's1', database: 'COPDAT', externalId: 'ext1' },
        ],
        httpTimeoutMs: 30000,
    },
    paths: { downloads: '/tmp/d', logs: '/tmp/l', providers: '/tmp/p' },
    database: { user: 't', password: 't', server: 'localhost', database: 'T' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'n@t', notices: [], cc: [], password: '' },
    license: { adminEmail: 'a@t' },
    app: { company: 'TestCo', timezone: 'America/Mexico_City', rfc: '', regimen: '', arg: '', importRoute: '' },
    security: { apiKey: 'k' },
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 0, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
    retry: { scope: 'current_month', lookbackDays: 30, interval: { payment: 30, po: 240 } },
    eom: { notificationHour: 18, notificationEnabled: true },
}));

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

const mockUploadPayments = jest.fn();
jest.mock('../../src/controller/PortalPaymentController', () => ({ uploadPayments: mockUploadPayments }));

const { runRetryMonthPayments } = require('../../src/scripts/retry-month-payments');

// Mirrors config.retry.interval.payment in the mock above. Fixtures derive from it (+10 min) so the
// "must exceed the interval" intent survives a retune of the default (20.1: fixed 30-min payment interval).
const PAYMENT_INTERVAL_MIN = 30;

// Single-clock fixtures (20.2 D-01 / hazard H-2).
// SERVER_SKEW_MIN is the measured DATEDIFF(mi, GETUTCDATE(), GETDATE()) on the deployed SQL host,
// 2026-07-27. DB_NOW stands in for the `GETDATE() AS dbNow` column the sweep now projects.
// Every lastErrorAt below derives from DB_NOW, never from Date.now(): a fixture that leaves dbNow
// unset falls through to the process clock and keeps passing whatever the script does.
const SERVER_SKEW_MIN = 360;
const DB_NOW = new Date(Date.now() - SERVER_SKEW_MIN * 60 * 1000);

describe('retry-month-payments script', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    test('dry-run mode: does NOT call uploadPayments, returns mode=dry-run; SQL preserves 60-min filter + idCia', async () => {
        // Derived from DB_NOW, not Date.now() — 40 min old on the SERVER clock, past the 30-min
        // interval either way here, but the derivation is what keeps the fixture honest (H-2).
        const pastIntervalAt = new Date(DB_NOW.getTime() - (PAYMENT_INTERVAL_MIN + 10) * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [
                { payment_id: 'PAY00001234', tenant: 'COPDAT', fechaAuth: '20260507', errorCount: 1, lastErrorAt: pastIntervalAt, dbNow: DB_NOW },
            ],
        });

        const envelope = await runRetryMonthPayments(false, 0);

        expect(mockUploadPayments).not.toHaveBeenCalled();
        expect(envelope.data.mode).toBe('dry-run');
        expect(envelope.data.totalEligible).toBe(1);
        // Verify 60-min antiquity filter PRESERVED (REQ RETRY-02 boundary)
        const sqlPassed = mockRunQuery.mock.calls[0][0];
        expect(sqlPassed).toMatch(/>=\s*60/);
        // Verify dbColumn='idCia' (CRITICAL — fesaPagosFocaltec discriminator per PATTERNS.md line 616)
        expect(sqlPassed).toMatch(/idCia\s*=/);
        // Verify scope filter applied
        expect(sqlPassed).toMatch(/DATEFROMPARTS|DATEADD\(month/);
        // D-12 #1 (20.2 D-01): the single clock, projected by the same statement as lastErrorAt.
        // Only this catches removal of the column — the helper's fallback is silent, and a
        // preview running on a different clock than the cron is the exact failure this avoids.
        expect(sqlPassed).toMatch(/GETDATE\(\)\s+AS\s+dbNow/);
        // RETRY-S1 guard: fesa.dbo.fesaPagosFocaltec has only FOUR columns (idCia, NoPagoSage,
        // status, idFocaltec). Any lastUpdate reference makes the whole sweep query invalid.
        expect(sqlPassed).not.toMatch(/lastUpdate/);
    });

    test('apply mode: calls uploadPayments(0)', async () => {
        const pastIntervalAt = new Date(DB_NOW.getTime() - (PAYMENT_INTERVAL_MIN + 10) * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [
                { payment_id: 'PAY00001234', tenant: 'COPDAT', fechaAuth: '20260507', errorCount: 1, lastErrorAt: pastIntervalAt, dbNow: DB_NOW },
            ],
        });
        mockUploadPayments.mockResolvedValue(undefined);

        const envelope = await runRetryMonthPayments(true, 0);

        expect(mockUploadPayments).toHaveBeenCalledWith(0);
        expect(envelope.data.mode).toBe('apply');
    });
});
