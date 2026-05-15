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
    retry: { scope: 'current_month', lookbackDays: 30, backoff: { initialMin: 15, multiplier: 2, maxMin: 1440 } },
    eom: { notificationHour: 18, notificationEnabled: true },
}));

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

const mockUploadPayments = jest.fn();
jest.mock('../../src/controller/PortalPaymentController', () => ({ uploadPayments: mockUploadPayments }));

const { runRetryMonthPayments } = require('../../src/scripts/retry-month-payments');

describe('retry-month-payments script', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    test('dry-run mode: does NOT call uploadPayments, returns mode=dry-run; SQL preserves 60-min filter + idCia', async () => {
        const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [
                { payment_id: 'PAY00001234', tenant: 'COPDAT', fechaAuth: '20260507', errorCount: 1, lastErrorAt: twentyMinAgo },
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
    });

    test('apply mode: calls uploadPayments(0)', async () => {
        const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [
                { payment_id: 'PAY00001234', tenant: 'COPDAT', fechaAuth: '20260507', errorCount: 1, lastErrorAt: twentyMinAgo },
            ],
        });
        mockUploadPayments.mockResolvedValue(undefined);

        const envelope = await runRetryMonthPayments(true, 0);

        expect(mockUploadPayments).toHaveBeenCalledWith(0);
        expect(envelope.data.mode).toBe('apply');
    });
});
