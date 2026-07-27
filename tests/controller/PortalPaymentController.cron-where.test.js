/**
 * Integration tests for src/controller/PortalPaymentController.js — Phase 20.1 fixed-interval retry.
 *
 * Covers CONTEXT D-08 Layer 2 (4 cases) — runQuery is mocked to return canned recordsets;
 * the assertions verify controller behavior across the four eligibility outcomes, evaluated
 * against the payment interval (config.retry.interval.payment = 30 min):
 *   1  POSTED skip            — existing NOT IN dedupe filtered the row at SQL level (empty recordset).
 *   2  ERROR inside interval  — 1 ERROR row 5 min ago; JS post-filter defers it (30 min not elapsed).
 *   3  ERROR past interval    — 1 ERROR row 40 min ago; JS post-filter keeps it; upload loop runs.
 *   4  First attempt          — no lastErrorAt; eligible immediately (RETRY-C4, highest blast radius).
 *
 * RetryPolicy.js is intentionally NOT mocked — the tests assert the real SQL shape
 * (OUTER APPLY, sargable scope, idCia discriminator) that the helpers emit into the query string,
 * and the real eligibility math from computeRetryEligibility.
 * Test 1 also asserts the 60-min antiquity filter (>= 60), the NOT IN POSTED dedupe and the
 * AUDTDATE CONVERT wrapping are preserved verbatim — REQ RETRY-02 boundary + CONTEXT D-03.
 * Phase 20.1 does not touch this query at all; those guards must survive untouched.
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
    app: { company: 'TestCo', timezone: 'America/Mexico_City', rfc: 'RFC', regimen: 'R1', arg: 'A1', importRoute: '' },
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

jest.mock('node-notifier', () => ({ notify: jest.fn() }));
jest.mock('../../src/services/ProviderIdResolver', () => ({ resolveProviderIdByExternalId: jest.fn() }));
jest.mock('../../src/services/UuidResolver', () => ({ resolveUuidByFolio: jest.fn() }));
jest.mock('../../src/utils/TimezoneHelper', () => ({ getCurrentDateCompact: () => '20260515' }));

const { uploadPayments } = require('../../src/controller/PortalPaymentController');

// Payment interval under test — mirrors the config mock above (config.retry.interval.payment).
const PAYMENT_INTERVAL_MIN = 30;

// Full payment field set so the row survives the PROVIDERID / DIFERENCIA_MINUTOS branches
// downstream and actually reaches the upload loop.
const paymentRow = (overrides) => ({
    external_id: 'PAY00000000',
    LotePago: 100,
    AsientoPago: 1,
    bank_account_id: 'BANK-001',
    IDBANK: 'B1',
    FechaAsentamiento: '20260515',
    comments: '',
    reference: '',
    bk_currency: 'MXN',
    payment_date: '20260515',
    provider_external_id: 'V001',
    total_amount: 100,
    operation_type: 'TRANSFER',
    TipoCambioPago: 1,
    PROVIDERID: 'PROV-1', // not empty — survives the PROVIDERID-resolution filter
    DIFERENCIA_MINUTOS: 120,
    errorCount: 0,
    lastErrorAt: null,
    ...overrides,
});

describe('PortalPaymentController cron WHERE + fixed-interval retry (Phase 20.1)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // clearAllMocks() clears call records but NOT queued mockResolvedValueOnce
        // implementations. A test whose stubs the controller does not fully consume would
        // leak the remainder into the next test, which then silently asserts against the
        // wrong recordset. mockReset() drains the queue so each case is self-contained.
        mockRunQuery.mockReset();
        mockPortalPost.mockReset();
    });

    test('NOT IN POSTED dedupe filters POSTED payments — recordset empty, no portal POST', async () => {
        mockRunQuery.mockResolvedValueOnce({ recordset: [] }); // queryEncabezadosPago returns empty

        await uploadPayments(0);

        const sqlPassed = mockRunQuery.mock.calls[0][0];
        // Assert WHERE rewrite shape
        expect(sqlPassed).toMatch(/OUTER APPLY/);
        expect(sqlPassed).toMatch(/DATEFROMPARTS|DATEADD\(month/);
        // RETRY-02 regression guard (Phase 20 gap closure): AUDTDATE is a Sage YYYYMMDD
        // integer — comparing it bare against DATEFROMPARTS(...) triggers an int->date
        // implicit conversion that errors at runtime. The scope filter MUST wrap AUDTDATE
        // in the same CONVERT(Date, CONVERT(VARCHAR(8), ...)) expression used elsewhere
        // in this query so the comparison is date-vs-date.
        expect(sqlPassed).toMatch(/CONVERT\(Date, CONVERT\(VARCHAR\(8\), P\.AUDTDATE\)\)\s*>=\s*DATEFROMPARTS/);
        expect(sqlPassed).not.toMatch(/P\.AUDTDATE\s*>=\s*DATEFROMPARTS/);
        // Assert PRESERVED 60-min antiquity filter (REQ RETRY-02 boundary)
        expect(sqlPassed).toMatch(/>= 60/);
        // Assert PRESERVED NOT IN POSTED dedupe (CONTEXT D-03). Payments have no CLOSED
        // lifecycle in fesaPagosFocaltec, so RETRY-C7 does NOT apply here.
        expect(sqlPassed).toMatch(/NOT IN\s*\(\s*SELECT NoPagoSage/);
        // Assert OUTER APPLY uses idCia (NOT idDatabase)
        expect(sqlPassed).toMatch(/idCia\s*=/);
        // Tenant-DB query passes database[index] explicit (CLAUDE.md §6 #2)
        expect(mockRunQuery.mock.calls[0][1]).toBe('COPDAT');
        // No portal POST happened (recordset empty)
        expect(mockPortalPost).not.toHaveBeenCalled();
        // Summary log shows zero candidates
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalPaymentController', 'info',
            expect.stringMatching(/^\[RETRY\] tenant=COPDAT candidates=0 deferred=0 processing=0$/));
    });

    test('ERROR payment inside the payment interval deferred — [RETRY-DEFER] log, no portal POST', async () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [paymentRow({ external_id: 'PAY00001234', errorCount: 1, lastErrorAt: fiveMinAgo })],
        });

        await uploadPayments(0);

        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalPaymentController', 'info',
            expect.stringMatching(/^\[RETRY-DEFER\] Pago PAY00001234 tenant=COPDAT attempts=1 nextEligibleAt=/));
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalPaymentController', 'info',
            expect.stringMatching(/^\[RETRY\] tenant=COPDAT candidates=1 deferred=1 processing=0$/));
    });

    test('ERROR payment past the payment interval included — [RETRY] processing=1', async () => {
        // 40 min ago — must exceed the 30-min payment interval, otherwise this row would defer.
        const pastIntervalAt = new Date(Date.now() - (PAYMENT_INTERVAL_MIN + 10) * 60 * 1000);
        mockRunQuery
            .mockResolvedValueOnce({
                recordset: [paymentRow({
                    external_id: 'PAY00005678',
                    LotePago: 200,
                    AsientoPago: 2,
                    provider_external_id: 'V002',
                    total_amount: 200,
                    PROVIDERID: 'PROV-2',
                    errorCount: 1,
                    lastErrorAt: pastIntervalAt,
                })],
            })
            .mockResolvedValueOnce({ recordset: [] })  // queryPagosRegistrados — no prior dedupe hits
            .mockResolvedValueOnce({ recordset: [] }); // queryFacturasPagadas — no invoices, controller continues

        await uploadPayments(0);

        expect(mockLogGenerator).toHaveBeenCalledWith('PortalPaymentController', 'info',
            expect.stringMatching(/^\[RETRY\] tenant=COPDAT candidates=1 deferred=0 processing=1$/));
        // Assert no [RETRY-DEFER] for this payment
        const deferCalls = mockLogGenerator.mock.calls.filter((c) => /\[RETRY-DEFER\] Pago PAY00005678/.test(c[2] || ''));
        expect(deferCalls.length).toBe(0);
    });

    test('first-attempt payment (no lastErrorAt) included immediately — [RETRY] processing=1', async () => {
        // RETRY-C4: a never-failed payment is not a retry. Deferring it would stall normal uploads.
        mockRunQuery
            .mockResolvedValueOnce({
                recordset: [paymentRow({
                    external_id: 'PAY00009999',
                    LotePago: 300,
                    AsientoPago: 3,
                    provider_external_id: 'V003',
                    total_amount: 300,
                    PROVIDERID: 'PROV-3',
                    errorCount: 0,
                    lastErrorAt: null,
                })],
            })
            .mockResolvedValueOnce({ recordset: [] })  // queryPagosRegistrados
            .mockResolvedValueOnce({ recordset: [] }); // queryFacturasPagadas

        await uploadPayments(0);

        expect(mockLogGenerator).toHaveBeenCalledWith('PortalPaymentController', 'info',
            expect.stringMatching(/^\[RETRY\] tenant=COPDAT candidates=1 deferred=0 processing=1$/));
        const deferCalls = mockLogGenerator.mock.calls.filter((c) => /\[RETRY-DEFER\] Pago PAY00009999/.test(c[2] || ''));
        expect(deferCalls.length).toBe(0);
    });
});
