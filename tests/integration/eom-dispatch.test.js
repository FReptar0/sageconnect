// tests/integration/eom-dispatch.test.js (NEW — Phase 20 Plan 20-07)
//
// Integration coverage for SPEC EOM-04's 3 acceptance scenarios, exercising the
// dispatchEomIfDue() path inserted at the top of forResponse() in src/background.js:
//   (a) first tick of the last day  → two emails sent + sentinels success:true
//   (b) second tick same month      → sentinel-present silent skip, no resend
//   (c) first tick with SMTP failure→ sentinel success:false + admin alert + no resend
//
// Strategy: mock src/config (with retry.scope='last_n_days' to PROVE the EOM data
// query ignores it and HARDCODES current_month per CONTEXT D-09), mock LogGenerator,
// mock SQLServerConnection.runQuery for canned recordsets, and mock the two email
// senders (EmailSender.sendOperatorReport + AdminEmailSender.sendAdminAlert) directly
// — those helpers swallow SMTP failures internally, so to drive the success/failure
// branches of dispatchEomIfDue we control the senders themselves. Sentinel files are
// written to a real temp dir and asserted via fs.readFileSync + JSON.parse.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { describe, test, expect, beforeEach, afterAll } = require('@jest/globals');

const tmpRoot = path.join(os.tmpdir(), `sageconnect-eom-integration-${process.pid}`);

// Shared mock for src/config — needed BEFORE requires so nested utility loads see it.
jest.mock('../../src/config', () => {
    const nodePath = require('path');
    const nodeOs = require('os');
    const tmpLogs = nodePath.join(nodeOs.tmpdir(), `sageconnect-eom-integration-${process.pid}`);
    return {
        portal: {
            url: 'http://test',
            tenants: [{ id: 'T1', key: 'k1', secret: 's1', database: 'COPDAT', externalId: 'ext1' }],
            httpTimeoutMs: 30000,
        },
        paths: { downloads: '/tmp/dl', providers: '/tmp/p', logs: tmpLogs },
        database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
        mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', notices: ['ops@test.com', 'ops2@test.com'], cc: ['cc@test.com'], password: '' },
        license: { adminEmail: 'admin@test.com' },
        app: {
            company: 'TestCo', timezone: 'America/Mexico_City', rfc: 'RFC', regimen: 'R1', arg: 'A1', importRoute: '',
            baseUrl: 'http://localhost:3030',
            defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
            addressIdentifiersSkip: [],
        },
        security: { apiKey: 'test-key' },
        schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 0, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
        // Intentionally NOT current_month — proves the EOM data query HARDCODES current_month per D-09.
        retry: { scope: 'last_n_days', lookbackDays: 7, backoff: { initialMin: 15, multiplier: 2, maxMin: 1440 } },
        eom: { notificationHour: 18, notificationEnabled: true },
    };
});

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

// dispatchEomIfDue drives sendOperatorReport (operator email) and, on its failure,
// sendAdminAlert (admin fallback). Mock both directly so we can control success/failure.
const mockSendOperatorReport = jest.fn();
jest.mock('../../src/utils/EmailSender', () => ({
    sendMail: jest.fn(),
    sendOperatorReport: mockSendOperatorReport,
}));

const mockSendAdminAlert = jest.fn();
jest.mock('../../src/utils/AdminEmailSender', () => ({
    sendAdminAlert: mockSendAdminAlert,
    findLastOpenStep: jest.fn(),
}));

// dispatchEomIfDue is exported from background.js for testability.
const { dispatchEomIfDue } = require('../../src/background');
const config = require('../../src/config');

describe('EOM dispatch integration (Phase 20, SPEC EOM-04)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
        fs.mkdirSync(tmpRoot, { recursive: true });
        // Default: operator + admin emails succeed.
        mockSendOperatorReport.mockResolvedValue(undefined);
        mockSendAdminAlert.mockResolvedValue(undefined);
    });

    afterAll(() => {
        if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    test('REQ EOM-04 (a): first tick of last day → emails sent + sentinels created with success:true', async () => {
        const lastDayLateHour = new Date(2026, 4, 31, 18, 5, 0); // May 31, 18:05 local
        // runQuery returns 1 row per tenant per category (1 tenant × 2 categories = 2 calls).
        mockRunQuery
            .mockResolvedValueOnce({ recordset: [{ tenant: 'COPDAT', idOrPo: 'PO0083449', fechaAuth: '2026-05-07', attempts: 3, lastError: 'CFDI VENDOR_NOT_FOUND' }] }) // POs
            .mockResolvedValueOnce({ recordset: [{ tenant: 'COPDAT', idOrPo: 'PAY00001234', fechaAuth: '2026-05-12', attempts: 1, lastError: 'TIMEOUT 30s' }] }); // payments

        await dispatchEomIfDue(lastDayLateHour, config);

        // Both emails sent (1 per category) to the operator mailbox.
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(2);
        const posCall = mockSendOperatorReport.mock.calls[0][0];
        expect(posCall.subject).toMatch(/Pendientes fin de mes — POs — 2026-05/);
        expect(posCall.callerLogFile).toBe('EomNotification');
        const payCall = mockSendOperatorReport.mock.calls[1][0];
        expect(payCall.subject).toMatch(/Pendientes fin de mes — Pagos — 2026-05/);
        // No admin alert on the success path.
        expect(mockSendAdminAlert).not.toHaveBeenCalled();
        // Sentinels exist with success:true.
        const sentinelPos = path.join(tmpRoot, 'eom-2026-05-pos.sent');
        const sentinelPay = path.join(tmpRoot, 'eom-2026-05-payments.sent');
        expect(fs.existsSync(sentinelPos)).toBe(true);
        expect(fs.existsSync(sentinelPay)).toBe(true);
        const posPayload = JSON.parse(fs.readFileSync(sentinelPos, 'utf8'));
        expect(posPayload.success).toBe(true);
        expect(posPayload.rowCount).toBe(1);
        const payPayload = JSON.parse(fs.readFileSync(sentinelPay, 'utf8'));
        expect(payPayload.success).toBe(true);
        expect(payPayload.rowCount).toBe(1);
        // Log entries.
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/^\[EOM-DISPATCH\] category=pos rows=1 sent=true$/));
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/^\[EOM-GATE\] category=pos /));
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/^\[EOM-SENTINEL\] path=.*eom-2026-05-pos\.sent.*payload=/));
    });

    test('REQ EOM-04 (b): second tick same month → no resend, [EOM-SKIP] sentinel-present', async () => {
        const lastDayLaterTick = new Date(2026, 4, 31, 18, 10, 0); // May 31, 18:10 local
        // Pre-write both sentinels (simulating a previous successful tick).
        const sentinelPos = path.join(tmpRoot, 'eom-2026-05-pos.sent');
        const sentinelPay = path.join(tmpRoot, 'eom-2026-05-payments.sent');
        fs.writeFileSync(sentinelPos, JSON.stringify({ timestamp: '2026-05-31T18:05:00.000Z', success: true, rowCount: 1 }));
        fs.writeFileSync(sentinelPay, JSON.stringify({ timestamp: '2026-05-31T18:05:00.000Z', success: true, rowCount: 1 }));
        const posBefore = fs.readFileSync(sentinelPos, 'utf8');

        await dispatchEomIfDue(lastDayLaterTick, config);

        // No emails sent (sentinel blocks the gate).
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(mockSendAdminAlert).not.toHaveBeenCalled();
        // No runQuery calls (skip happened before any query).
        expect(mockRunQuery).not.toHaveBeenCalled();
        // [EOM-SKIP] log entries for both categories.
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/^\[EOM-SKIP\] category=pos reason=gate-false$/));
        expect(mockLogGenerator).toHaveBeenCalledWith('EomNotification', 'info',
            expect.stringMatching(/^\[EOM-SKIP\] category=payments reason=gate-false$/));
        // Sentinel content unchanged.
        expect(fs.readFileSync(sentinelPos, 'utf8')).toBe(posBefore);
    });

    test('REQ EOM-04 (c): SMTP failure → sentinel success:false + admin alert + no resend on subsequent ticks', async () => {
        const lastDayLateHour = new Date(2026, 4, 31, 18, 5, 0);
        // Operator email fails for both categories; admin alert succeeds.
        mockSendOperatorReport
            .mockRejectedValueOnce(new Error('SMTP connection refused')) // operator email POs — fail
            .mockRejectedValueOnce(new Error('SMTP connection refused')); // operator email payments — fail
        mockRunQuery
            .mockResolvedValueOnce({ recordset: [{ tenant: 'COPDAT', idOrPo: 'PO0083449', fechaAuth: '2026-05-07', attempts: 3, lastError: 'X' }] })
            .mockResolvedValueOnce({ recordset: [{ tenant: 'COPDAT', idOrPo: 'PAY00001234', fechaAuth: '2026-05-12', attempts: 1, lastError: 'Y' }] });

        await dispatchEomIfDue(lastDayLateHour, config);

        // Operator email attempted twice; admin alert fired twice (one per category).
        expect(mockSendOperatorReport).toHaveBeenCalledTimes(2);
        expect(mockSendAdminAlert).toHaveBeenCalledTimes(2);
        const adminSubjects = mockSendAdminAlert.mock.calls.map(c => c[0]);
        expect(adminSubjects[0]).toMatch(/EOM email FAILED for 2026-05 - pos/);
        expect(adminSubjects[1]).toMatch(/EOM email FAILED for 2026-05 - payments/);
        // Sentinels created with success:false.
        const sentinelPos = path.join(tmpRoot, 'eom-2026-05-pos.sent');
        const sentinelPay = path.join(tmpRoot, 'eom-2026-05-payments.sent');
        const posPayload = JSON.parse(fs.readFileSync(sentinelPos, 'utf8'));
        expect(posPayload.success).toBe(false);
        expect(posPayload.error).toMatch(/SMTP connection refused/);
        const payPayload = JSON.parse(fs.readFileSync(sentinelPay, 'utf8'));
        expect(payPayload.success).toBe(false);
        // Subsequent tick: sentinel-present blocks resend.
        jest.clearAllMocks();
        mockSendOperatorReport.mockResolvedValue(undefined);
        await dispatchEomIfDue(new Date(2026, 4, 31, 18, 30, 0), config);
        expect(mockSendOperatorReport).not.toHaveBeenCalled();
        expect(mockRunQuery).not.toHaveBeenCalled();
    });
});
