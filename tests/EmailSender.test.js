// tests/EmailSender.test.js

// Mock config to prevent process.exit(1) from config validation
jest.mock('../src/config', () => ({
    portal: {
        url: 'http://localhost',
        tenants: [
            { id: 'tenant1', key: 'key1', secret: 'secret1', database: 'TESTDB', externalId: 'ext1' }
        ]
    },
    database: { user: '', password: '', server: '', database: '' },
    mailing: {
        server: 'smtp.test',
        port: 587,
        ssl: false,
        from: 'noreply@test',
        notices: ['ops1@test.com', 'ops2@test.com', 'ops3@test.com'],
        cc: ['cc1@test.com', 'cc2@test.com'],
        password: '',
    },
    paths: { downloads: '', providers: '', logs: '' },
    app: {
        importRoute: '', arg: '', company: '', rfc: '', regimen: '', timezone: '',
        defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
        addressIdentifiersSkip: []
    },
    license: { adminEmail: 'admin@test.com' }
}));

const mockTransportSendMail = jest.fn();
jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({ sendMail: mockTransportSendMail })),
}));

const mockLogGenerator = jest.fn();
jest.mock('../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

// EmailSender loads its own config internally via require('../config')
const { sendMail, sendOperatorReport } = require('../src/utils/EmailSender');

describe('sendMail util', () => {
    // Integration test -- requires real SMTP credentials in .env
    // Run manually: npx jest tests/EmailSender.test.js (with .env populated)
    test.skip('should send email successfully with valid data', async () => {
        const data = {
            h1: 'Prueba de envio',
            p: 'Este es un correo de prueba desde Jest.',
            status: 200,
            message: 'OK',
            position: 0,      // elegira el primer MAILING_NOTICES
            idCia: 'TESTCOMP'
        };

        const result = await sendMail(data);
        console.log('sendMail result:', result);
        // nodemailer devuelve accepted[] con direcciones que acepto
        expect(Array.isArray(result.accepted)).toBe(true);
        expect(result.accepted.length).toBeGreaterThan(0);
        expect(result.rejected).toEqual([]);
    });
});

describe('sendOperatorReport', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTransportSendMail.mockResolvedValue({ accepted: ['ops1@test.com'], rejected: [] });
    });

    test('(a) module.exports has both sendMail and sendOperatorReport', () => {
        expect(typeof sendMail).toBe('function');
        expect(typeof sendOperatorReport).toBe('function');
    });

    test('(b) REQ EOM-02: sends to FULL MAILING_NOTICES list (not notices[position])', async () => {
        await sendOperatorReport({
            subject: '[SageConnect] Test subject',
            html: '<p>Test body</p>',
            callerLogFile: 'TestCaller',
        });
        expect(mockTransportSendMail).toHaveBeenCalledTimes(1);
        const opts = mockTransportSendMail.mock.calls[0][0];
        // Full list joined with comma — not just notices[0]
        expect(opts.to).toBe('ops1@test.com,ops2@test.com,ops3@test.com');
        // Confirm it is NOT a single recipient (regression guard)
        expect(opts.to).not.toBe('ops1@test.com');
    });

    test('(c) cc = MAILING_CC (full list)', async () => {
        await sendOperatorReport({
            subject: '[SageConnect] Test',
            html: '<p>x</p>',
            callerLogFile: 'TestCaller',
        });
        const opts = mockTransportSendMail.mock.calls[0][0];
        expect(opts.cc).toEqual(['cc1@test.com', 'cc2@test.com']);
    });

    test('(d) CONTEXT D-06: does NOT include LICENSE_ADMIN_EMAIL in to or cc (operator channel only)', async () => {
        await sendOperatorReport({
            subject: '[SageConnect] Test',
            html: '<p>x</p>',
            callerLogFile: 'TestCaller',
        });
        const opts = mockTransportSendMail.mock.calls[0][0];
        // Admin email must not appear in either field — operator/admin channels are strictly separated
        expect(opts.to).not.toContain('admin@test.com');
        if (Array.isArray(opts.cc)) {
            expect(opts.cc).not.toContain('admin@test.com');
        } else {
            expect(opts.cc || '').not.toContain('admin@test.com');
        }
    });

    test('(e) REQ EOM-06: SMTP failure → warn log + Promise resolves (no throw)', async () => {
        mockTransportSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));
        // Must NOT throw
        await expect(sendOperatorReport({
            subject: '[SageConnect] Will fail',
            html: '<p>x</p>',
            callerLogFile: 'TestCaller',
        })).resolves.toBeUndefined();
        // warn log emitted with [OPERATOR-EMAIL] prefix and the error message
        const warnCall = mockLogGenerator.mock.calls.find(c => c[1] === 'warn' && /\[OPERATOR-EMAIL\]/.test(c[2]));
        expect(warnCall).toBeDefined();
        expect(warnCall[2]).toMatch(/SMTP connection refused/);
    });

    test('(f) callerLogFile routes the log entry to the caller LOG_FILE name', async () => {
        await sendOperatorReport({
            subject: '[SageConnect] Routing test',
            html: '<p>x</p>',
            callerLogFile: 'EomNotification',
        });
        // Success log call: first arg is the callerLogFile name
        const successCall = mockLogGenerator.mock.calls.find(c => c[1] === 'info' && /\[OPERATOR-EMAIL\]/.test(c[2]));
        expect(successCall).toBeDefined();
        expect(successCall[0]).toBe('EomNotification');
    });

    test('(f.2) callerLogFile fallback to "EmailSender" when arg is missing', async () => {
        await sendOperatorReport({
            subject: '[SageConnect] Fallback test',
            html: '<p>x</p>',
            // callerLogFile intentionally omitted
        });
        const successCall = mockLogGenerator.mock.calls.find(c => c[1] === 'info' && /\[OPERATOR-EMAIL\]/.test(c[2]));
        expect(successCall).toBeDefined();
        expect(successCall[0]).toBe('EmailSender');
    });

    test('(g) regression: sendMail signature/shape unchanged (still defined as function)', () => {
        // sendMail itself remains a function with arity >= 1; deeper behavior covered by the existing skipped integration test
        expect(typeof sendMail).toBe('function');
        expect(sendMail.length).toBeGreaterThanOrEqual(1);
    });
});
