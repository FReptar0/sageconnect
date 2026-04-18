// tests/regression-verification.test.js
// REGR-01: Verify all source modules load correctly after config migration
// This test confirms existing functionality still works with centralized config.

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Mocks (must be defined BEFORE any require that triggers source modules)
// ---------------------------------------------------------------------------

jest.mock('../src/config', () => ({
    portal: {
        url: 'http://localhost',
        tenants: [
            { id: 'tenant1', key: 'key1', secret: 'secret1', database: 'TESTDB', externalId: 'ext1' }
        ]
    },
    database: { user: '', password: '', server: '', database: '' },
    mailing: {},
    paths: { downloads: '/tmp/downloads', providers: '/tmp/providers', logs: '/tmp/logs' },
    app: {
        importRoute: '', arg: '', company: '', rfc: '', regimen: '', timezone: 'America/Mexico_City',
        defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
        addressIdentifiersSkip: []
    }
}));

jest.mock('../src/utils/SQLServerConnection', () => ({
    runQuery: jest.fn()
}));

jest.mock('axios');

jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({
        sendMail: jest.fn()
    }))
}));

jest.mock('node-notifier', () => ({
    notify: jest.fn()
}));

// ---------------------------------------------------------------------------
// REGR-01: Module loading after config migration
// ---------------------------------------------------------------------------

describe('REGR-01: Module loading after config migration', () => {
    // Some modules (e.g. PortalOC_StatusUpdater) call main() at module load time,
    // which calls process.exit(1) when CLI args are missing. We spy on process.exit
    // to prevent it from killing the test process during require() verification.
    let exitSpy;

    beforeAll(() => {
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterAll(() => {
        exitSpy.mockRestore();
    });

    // Controllers (9 modules)
    test('SagePaymentController loads without error', () => {
        expect(() => require('../src/controller/SagePaymentController')).not.toThrow();
    });

    test('CFDI_Downloader loads without error', () => {
        expect(() => require('../src/controller/CFDI_Downloader')).not.toThrow();
    });

    test('PortalOC_Canceller loads without error', () => {
        expect(() => require('../src/controller/PortalOC_Canceller')).not.toThrow();
    });

    test('PortalOC_Closer loads without error', () => {
        expect(() => require('../src/controller/PortalOC_Closer')).not.toThrow();
    });

    test('PortalOC_ContentUpdater loads without error', () => {
        expect(() => require('../src/controller/PortalOC_ContentUpdater')).not.toThrow();
    });

    test('PortalOC_Creator loads without error', () => {
        expect(() => require('../src/controller/PortalOC_Creator')).not.toThrow();
    });

    test('PortalOC_LifecycleManager loads without error', () => {
        expect(() => require('../src/controller/PortalOC_LifecycleManager')).not.toThrow();
    });

    test('PortalPaymentController loads without error', () => {
        expect(() => require('../src/controller/PortalPaymentController')).not.toThrow();
    });

    test('PortalOC_StatusUpdater loads without error', () => {
        expect(() => require('../src/controller/PortalOC_StatusUpdater')).not.toThrow();
    });

    // Utils (key modules)
    test('EmailSender loads without error', () => {
        expect(() => require('../src/utils/EmailSender')).not.toThrow();
    });

    test('TimezoneHelper loads without error', () => {
        expect(() => require('../src/utils/TimezoneHelper')).not.toThrow();
    });

    test('GetProviders loads without error', () => {
        expect(() => require('../src/utils/GetProviders')).not.toThrow();
    });

    test('GetTypesCFDI loads without error', () => {
        expect(() => require('../src/utils/GetTypesCFDI')).not.toThrow();
    });

    test('LogGenerator loads without error', () => {
        expect(() => require('../src/utils/LogGenerator')).not.toThrow();
    });

    test('TransformTime loads without error', () => {
        expect(() => require('../src/utils/TransformTime')).not.toThrow();
    });

    // Scripts (key operational scripts)
    test('payment-reconciliation loads without error', () => {
        expect(() => require('../src/scripts/payment-reconciliation')).not.toThrow();
    });

    test('get-payment-cfdis loads without error', () => {
        expect(() => require('../src/scripts/get-payment-cfdis')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// REGR-01: Config structure validation
// ---------------------------------------------------------------------------

describe('REGR-01: Config structure validation', () => {
    const config = require('../src/config');

    test('config has all 5 top-level sections', () => {
        expect(config).toHaveProperty('database');
        expect(config).toHaveProperty('portal');
        expect(config).toHaveProperty('mailing');
        expect(config).toHaveProperty('paths');
        expect(config).toHaveProperty('app');
    });

    test('portal.tenants is an array', () => {
        expect(Array.isArray(config.portal.tenants)).toBe(true);
    });

    test('portal.tenants has at least one tenant with expected shape', () => {
        expect(config.portal.tenants.length).toBeGreaterThan(0);
        const tenant = config.portal.tenants[0];
        expect(tenant).toHaveProperty('id');
        expect(tenant).toHaveProperty('key');
        expect(tenant).toHaveProperty('secret');
        expect(tenant).toHaveProperty('database');
        expect(tenant).toHaveProperty('externalId');
    });

    test('database section has expected keys', () => {
        expect(config.database).toHaveProperty('user');
        expect(config.database).toHaveProperty('password');
        expect(config.database).toHaveProperty('server');
        expect(config.database).toHaveProperty('database');
    });

    test('paths section has expected keys', () => {
        expect(config.paths).toHaveProperty('downloads');
        expect(config.paths).toHaveProperty('providers');
        expect(config.paths).toHaveProperty('logs');
    });

    test('app section has expected keys', () => {
        expect(config.app).toHaveProperty('timezone');
        expect(config.app).toHaveProperty('defaultAddress');
        expect(config.app).toHaveProperty('addressIdentifiersSkip');
    });

    test('app.defaultAddress has expected shape', () => {
        const addr = config.app.defaultAddress;
        expect(addr).toHaveProperty('city');
        expect(addr).toHaveProperty('country');
        expect(addr).toHaveProperty('identifier');
        expect(addr).toHaveProperty('municipality');
        expect(addr).toHaveProperty('state');
        expect(addr).toHaveProperty('street');
        expect(addr).toHaveProperty('zip');
    });
});

// ---------------------------------------------------------------------------
// REGR-01: No dotenv references outside config.js
// ---------------------------------------------------------------------------

describe('REGR-01: No dotenv references outside config.js', () => {
    test('zero dotenv references remain outside src/config.js', () => {
        const srcRoot = path.join(__dirname, '..', 'src');
        const dirsToScan = ['controller', 'utils', 'services', 'scripts'];
        const dotenvPattern = /require\s*\(\s*['"]dotenv['"]\s*\)|dotenv\.config/;
        const matches = [];

        for (const dir of dirsToScan) {
            const dirPath = path.join(srcRoot, dir);
            if (!fs.existsSync(dirPath)) continue;

            const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.js'));
            for (const file of files) {
                // Exclude config.js -- it's the one file that SHOULD use dotenv
                if (file === 'config.js') continue;

                const filePath = path.join(dirPath, file);
                const stat = fs.statSync(filePath);
                if (!stat.isFile()) continue;

                const content = fs.readFileSync(filePath, 'utf8');
                if (dotenvPattern.test(content)) {
                    matches.push(`${dir}/${file}`);
                }
            }
        }

        expect(matches).toEqual([]);
    });
});
