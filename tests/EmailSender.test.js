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
    mailing: {},
    paths: { downloads: '', providers: '', logs: '' },
    app: {
        importRoute: '', arg: '', company: '', rfc: '', regimen: '', timezone: '',
        defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
        addressIdentifiersSkip: []
    }
}));

// EmailSender loads its own config internally via require('../config')
const { sendMail } = require('../src/utils/EmailSender');

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
