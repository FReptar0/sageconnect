// tests/EmailSender.test.js
require('dotenv').config({ path: '.env.credentials.mailing' });
const { sendMail } = require('../src/utils/EmailSender');

describe('sendMail util', () => {
    test('should send email successfully with valid data', async () => {
        const data = {
            h1: 'Prueba de envío',
            p: 'Este es un correo de prueba desde Jest.',
            status: 200,
            message: 'OK',
            position: 0,      // elegirá el primer MAILING_NOTICES
            idCia: 'TESTCOMP'
        };

        const result = await sendMail(data);
        console.log('sendMail result:', result);
        // nodemailer devuelve accepted[] con direcciones que aceptó
        expect(Array.isArray(result.accepted)).toBe(true);
        expect(result.accepted.length).toBeGreaterThan(0);
        expect(result.rejected).toEqual([]);
    });
});
