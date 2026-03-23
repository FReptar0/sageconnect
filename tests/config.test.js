const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

/**
 * Tests for src/config.js - Centralized Config Loader
 *
 * Testing approach:
 * - Set process.env vars directly in beforeEach (simulates dotenv loaded values)
 * - Use jest.isolateModules() to re-require config.js fresh per test
 * - Spy on process.exit to capture validation failures
 * - Spy on console.error to capture error messages
 */

// Full set of required env vars for a valid config
const VALID_ENV = {
    // database
    USER: 'db_user',
    PASSWORD: 'db_pass',
    SERVER: 'localhost',
    DATABASE: 'FESA',
    // portal
    URL: 'https://api.portaldeproveedores.mx',
    TENANT_ID: 'tenant1',
    API_KEY: 'key1',
    API_SECRET: 'secret1',
    DATABASES: 'DB1',
    EXTERNAL_IDS: 'RFC1',
    // paths
    PATH: '/downloads',
    PROVIDERS_PATH: '/providers',
    LOG_PATH: '/logs',
    // app
    IMPORT_CFDIS_ROUTE: '/usr/bin/import',
    ARG: 'FESA',
    NOMBRE: 'Test Company',
    RFC: 'ABC123456DEF',
    REGIMEN: '601',
    TIMEZONE: 'America/Mexico_City',
    DEFAULT_ADDRESS_CITY: 'Monterrey',
    DEFAULT_ADDRESS_COUNTRY: 'Mexico',
    DEFAULT_ADDRESS_IDENTIFIER: 'ID1',
    DEFAULT_ADDRESS_MUNICIPALITY: 'Monterrey',
    DEFAULT_ADDRESS_STATE: 'Nuevo Leon',
    DEFAULT_ADDRESS_STREET: 'Calle Test 123',
    DEFAULT_ADDRESS_ZIP: '64000',
    ADDRESS_IDENTIFIERS_SKIP: 'LOC1,LOC2',
};

// Snapshot of original env so we can restore cleanly
let originalEnv;

beforeEach(() => {
    originalEnv = { ...process.env };
    // Set all valid env vars
    Object.assign(process.env, VALID_ENV);
});

afterEach(() => {
    // Restore original environment completely
    process.env = originalEnv;
    // Clear require cache so config.js is re-evaluated each test
    Object.keys(require.cache).forEach((key) => {
        if (key.includes('src/config')) {
            delete require.cache[key];
        }
    });
    jest.restoreAllMocks();
});

// Helper: require config.js freshly inside jest.isolateModules
function loadConfig() {
    let config;
    jest.isolateModules(() => {
        // Mock dotenv.config so it doesn't try to read .env file during tests
        jest.mock('dotenv', () => ({
            config: jest.fn(),
        }));
        config = require('../src/config');
    });
    return config;
}

// Helper: attempt to load config and capture exit/error
function loadConfigWithCapture() {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    let config;
    jest.isolateModules(() => {
        jest.mock('dotenv', () => ({
            config: jest.fn(),
        }));
        config = require('../src/config');
    });

    return { config, exitSpy, errorSpy };
}

// ============================================================
// 1. Structure tests
// ============================================================
describe('Config Structure', () => {
    test('config has all five top-level sections', () => {
        const config = loadConfig();
        expect(config).toHaveProperty('database');
        expect(config).toHaveProperty('portal');
        expect(config).toHaveProperty('mailing');
        expect(config).toHaveProperty('paths');
        expect(config).toHaveProperty('app');
    });

    test('config.database has correct keys mapped from env vars', () => {
        const config = loadConfig();
        expect(config.database).toEqual({
            user: 'db_user',
            password: 'db_pass',
            server: 'localhost',
            database: 'FESA',
        });
    });

    test('config.portal.url is a string', () => {
        const config = loadConfig();
        expect(typeof config.portal.url).toBe('string');
        expect(config.portal.url).toBe('https://api.portaldeproveedores.mx');
    });

    test('config.portal.tenants is array of objects for single tenant', () => {
        const config = loadConfig();
        expect(Array.isArray(config.portal.tenants)).toBe(true);
        expect(config.portal.tenants).toHaveLength(1);
        expect(config.portal.tenants[0]).toEqual({
            id: 'tenant1',
            key: 'key1',
            secret: 'secret1',
            database: 'DB1',
            externalId: 'RFC1',
        });
    });

    test('config.portal.tenants parses multi-tenant comma-separated values', () => {
        process.env.TENANT_ID = 't1,t2';
        process.env.API_KEY = 'k1,k2';
        process.env.API_SECRET = 's1,s2';
        process.env.DATABASES = 'DB1,DB2';
        process.env.EXTERNAL_IDS = 'RFC1,RFC2';

        const config = loadConfig();
        expect(config.portal.tenants).toHaveLength(2);
        expect(config.portal.tenants[0]).toEqual({
            id: 't1',
            key: 'k1',
            secret: 's1',
            database: 'DB1',
            externalId: 'RFC1',
        });
        expect(config.portal.tenants[1]).toEqual({
            id: 't2',
            key: 'k2',
            secret: 's2',
            database: 'DB2',
            externalId: 'RFC2',
        });
    });

    test('config.paths has correct keys mapped from env vars', () => {
        const config = loadConfig();
        expect(config.paths).toEqual({
            downloads: '/downloads',
            providers: '/providers',
            logs: '/logs',
        });
    });

    test('config.app.defaultAddress is nested object with 7 keys', () => {
        const config = loadConfig();
        expect(config.app.defaultAddress).toEqual({
            city: 'Monterrey',
            country: 'Mexico',
            identifier: 'ID1',
            municipality: 'Monterrey',
            state: 'Nuevo Leon',
            street: 'Calle Test 123',
            zip: '64000',
        });
    });

    test('config.app.addressIdentifiersSkip is array split from comma-separated', () => {
        const config = loadConfig();
        expect(Array.isArray(config.app.addressIdentifiersSkip)).toBe(true);
        expect(config.app.addressIdentifiersSkip).toEqual(['LOC1', 'LOC2']);
    });

    test('config.app.autoTerminate is boolean (defaults to false)', () => {
        const config = loadConfig();
        expect(typeof config.app.autoTerminate).toBe('boolean');
        expect(config.app.autoTerminate).toBe(false);
    });

    test('config.app.autoTerminate is true when AUTO_TERMINATE=true', () => {
        process.env.AUTO_TERMINATE = 'true';
        const config = loadConfig();
        expect(config.app.autoTerminate).toBe(true);
    });

    test('config.app has all expected scalar keys', () => {
        const config = loadConfig();
        expect(config.app.importRoute).toBe('/usr/bin/import');
        expect(config.app.arg).toBe('FESA');
        expect(config.app.company).toBe('Test Company');
        expect(config.app.rfc).toBe('ABC123456DEF');
        expect(config.app.regimen).toBe('601');
        expect(config.app.timezone).toBe('America/Mexico_City');
    });
});

// ============================================================
// 2. Mailing structure tests
// ============================================================
describe('Config Mailing Structure', () => {
    test('config.mailing.notices is array split from MAILING_NOTICES', () => {
        process.env.MAIL_TRANSPORT = 'smtp';
        process.env.eFrom = 'test@test.com';
        process.env.ePass = 'pass123';
        process.env.eServer = 'smtp.test.com';
        process.env.ePuerto = '587';
        process.env.eSSL = 'TRUE';
        process.env.MAILING_NOTICES = 'admin@test.com,ops@test.com';
        process.env.MAILING_CC = 'cc1@test.com,cc2@test.com';

        const config = loadConfig();
        expect(Array.isArray(config.mailing.notices)).toBe(true);
        expect(config.mailing.notices).toEqual(['admin@test.com', 'ops@test.com']);
    });

    test('config.mailing.cc is array split from MAILING_CC', () => {
        process.env.MAIL_TRANSPORT = 'smtp';
        process.env.eFrom = 'test@test.com';
        process.env.ePass = 'pass123';
        process.env.eServer = 'smtp.test.com';
        process.env.ePuerto = '587';
        process.env.eSSL = 'TRUE';
        process.env.MAILING_NOTICES = 'admin@test.com';
        process.env.MAILING_CC = 'cc1@test.com,cc2@test.com';

        const config = loadConfig();
        expect(Array.isArray(config.mailing.cc)).toBe(true);
        expect(config.mailing.cc).toEqual(['cc1@test.com', 'cc2@test.com']);
    });

    test('config.mailing.port is number parsed from ePuerto', () => {
        process.env.MAIL_TRANSPORT = 'smtp';
        process.env.eFrom = 'test@test.com';
        process.env.ePass = 'pass123';
        process.env.eServer = 'smtp.test.com';
        process.env.ePuerto = '587';
        process.env.eSSL = 'TRUE';
        process.env.MAILING_NOTICES = 'admin@test.com';
        process.env.MAILING_CC = '';

        const config = loadConfig();
        expect(typeof config.mailing.port).toBe('number');
        expect(config.mailing.port).toBe(587);
    });

    test('config.mailing.ssl is boolean parsed from eSSL', () => {
        process.env.MAIL_TRANSPORT = 'smtp';
        process.env.eFrom = 'test@test.com';
        process.env.ePass = 'pass123';
        process.env.eServer = 'smtp.test.com';
        process.env.ePuerto = '587';
        process.env.eSSL = 'TRUE';
        process.env.MAILING_NOTICES = 'admin@test.com';
        process.env.MAILING_CC = '';

        const config = loadConfig();
        expect(typeof config.mailing.ssl).toBe('boolean');
        expect(config.mailing.ssl).toBe(true);
    });

    test('config.mailing.transport is string from MAIL_TRANSPORT', () => {
        process.env.MAIL_TRANSPORT = 'smtp';
        process.env.eFrom = 'test@test.com';
        process.env.ePass = 'pass123';
        process.env.eServer = 'smtp.test.com';
        process.env.ePuerto = '587';
        process.env.eSSL = 'TRUE';
        process.env.MAILING_NOTICES = 'admin@test.com';
        process.env.MAILING_CC = '';

        const config = loadConfig();
        expect(config.mailing.transport).toBe('smtp');
    });
});

// ============================================================
// 3. Validation tests
// ============================================================
describe('Config Validation', () => {
    test('missing required database var exits with code 1 and includes var name and (database)', () => {
        delete process.env.USER;
        const { exitSpy, errorSpy } = loadConfigWithCapture();

        expect(exitSpy).toHaveBeenCalledWith(1);
        // Check that error message includes the var name and section
        const errorOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(errorOutput).toContain('USER');
        expect(errorOutput).toContain('(database)');
    });

    test('missing required portal var exits with code 1 and includes var name and (portal)', () => {
        delete process.env.TENANT_ID;
        const { exitSpy, errorSpy } = loadConfigWithCapture();

        expect(exitSpy).toHaveBeenCalledWith(1);
        const errorOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(errorOutput).toContain('TENANT_ID');
        expect(errorOutput).toContain('(portal)');
    });

    test('missing required paths var exits with code 1 and includes var name and (paths)', () => {
        delete process.env.LOG_PATH;
        const { exitSpy, errorSpy } = loadConfigWithCapture();

        expect(exitSpy).toHaveBeenCalledWith(1);
        const errorOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(errorOutput).toContain('LOG_PATH');
        expect(errorOutput).toContain('(paths)');
    });

    test('missing required app var exits with code 1 and includes var name and (app)', () => {
        delete process.env.RFC;
        const { exitSpy, errorSpy } = loadConfigWithCapture();

        expect(exitSpy).toHaveBeenCalledWith(1);
        const errorOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(errorOutput).toContain('RFC');
        expect(errorOutput).toContain('(app)');
    });

    test('empty string for required var treated as missing', () => {
        process.env.PASSWORD = '   ';
        const { exitSpy, errorSpy } = loadConfigWithCapture();

        expect(exitSpy).toHaveBeenCalledWith(1);
        const errorOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(errorOutput).toContain('PASSWORD');
        expect(errorOutput).toContain('(database)');
    });

    test('multiple missing vars all listed in single error message', () => {
        delete process.env.USER;
        delete process.env.TENANT_ID;
        delete process.env.LOG_PATH;
        const { exitSpy, errorSpy } = loadConfigWithCapture();

        expect(exitSpy).toHaveBeenCalledWith(1);
        const errorOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(errorOutput).toContain('USER');
        expect(errorOutput).toContain('TENANT_ID');
        expect(errorOutput).toContain('LOG_PATH');
    });

    test('error message format starts with [CONFIG ERROR]', () => {
        delete process.env.USER;
        const { errorSpy } = loadConfigWithCapture();

        const errorOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(errorOutput).toContain('[CONFIG ERROR] Missing required environment variables:');
    });

    test('error message ends with .env.example reference and Process exiting', () => {
        delete process.env.USER;
        const { errorSpy } = loadConfigWithCapture();

        const errorOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(errorOutput).toContain('See .env.example for reference.');
        expect(errorOutput).toContain('Process exiting.');
    });
});

// ============================================================
// 4. Mailing optional tests
// ============================================================
describe('Config Mailing Optional', () => {
    test('all mailing vars missing - no exit, config.mailing has defaults', () => {
        // Ensure no mailing vars are set
        delete process.env.MAIL_TRANSPORT;
        delete process.env.eFrom;
        delete process.env.ePass;
        delete process.env.eServer;
        delete process.env.ePuerto;
        delete process.env.eSSL;
        delete process.env.MAILING_NOTICES;
        delete process.env.MAILING_CC;
        delete process.env.CLIENT_ID;
        delete process.env.SECRET_CLIENT;
        delete process.env.REFRESH_TOKEN;
        delete process.env.REDIRECT_URI;

        const { exitSpy, config } = loadConfigWithCapture();

        // Should NOT have called process.exit
        expect(exitSpy).not.toHaveBeenCalled();
        // Mailing section should exist but with empty/default values
        expect(config).toHaveProperty('mailing');
    });

    test('some mailing vars present - config.mailing populated with available data', () => {
        process.env.MAIL_TRANSPORT = 'smtp';
        process.env.eFrom = 'test@test.com';
        process.env.eServer = 'smtp.test.com';
        process.env.ePuerto = '465';
        process.env.eSSL = 'FALSE';
        // Intentionally missing ePass, MAILING_NOTICES, MAILING_CC

        const { exitSpy, config } = loadConfigWithCapture();

        expect(exitSpy).not.toHaveBeenCalled();
        expect(config.mailing.transport).toBe('smtp');
        expect(config.mailing.from).toBe('test@test.com');
        expect(config.mailing.server).toBe('smtp.test.com');
        expect(config.mailing.port).toBe(465);
        expect(config.mailing.ssl).toBe(false);
    });
});

// ============================================================
// 5. Backward compatibility test
// ============================================================
describe('Config Backward Compatibility', () => {
    test('dotenv.config() is called internally so process.env is populated', () => {
        // This test verifies that requiring config.js calls dotenv.config()
        let dotenvConfigCalled = false;
        jest.isolateModules(() => {
            jest.mock('dotenv', () => ({
                config: jest.fn(() => {
                    dotenvConfigCalled = true;
                }),
            }));
            require('../src/config');
        });
        expect(dotenvConfigCalled).toBe(true);
    });
});
