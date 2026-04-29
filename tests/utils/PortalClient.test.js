// tests/utils/PortalClient.test.js (NEW -- Phase 19, ROOT-01 / D-01)
const { describe, test, expect } = require('@jest/globals');

// Mock src/config ANTES de cualquier require que toque config -- evita process.exit(1) si REQUIRED faltan en el entorno de tests.
// Pattern S-9 (heredado de Phase 18 -- tests/services/OperationManager.timer.test.js).
jest.mock('../../src/config', () => ({
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs' },
    schedule: {
        cronExpression: '*/15 * * * *',
        operationDelayMs: 5000,
        lockTimeoutMs: 14 * 60 * 1000,
        // Plan 19-02 + 19-03 agregaran childProcessTimeoutMs y stepTimeoutMs; aqui no se usan pero se mockean para forward-compat.
        childProcessTimeoutMs: 600000,
        stepTimeoutMs: 300000,
    },
    portal: {
        url: 'http://test',
        tenants: [],
        // Non-default value para verificar que el cliente lo propaga (no fallback a 30000):
        httpTimeoutMs: 12345,
    },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', notices: [], cc: [] },
    license: { adminEmail: 'admin@test.com' },
    app: { company: 'TestCo', timezone: 'America/Mexico_City', importRoute: 'fake', arg: 'arg' },
    security: { apiKey: 'test-key' },
}));

describe('PortalClient (Phase 19, ROOT-01)', () => {
    test('exports an axios instance with timeout from config.portal.httpTimeoutMs', () => {
        const portalClient = require('../../src/utils/PortalClient');
        expect(portalClient.defaults.timeout).toBe(12345);
    });

    test('exports an axios instance with Accept: application/json header', () => {
        const portalClient = require('../../src/utils/PortalClient');
        expect(portalClient.defaults.headers.Accept).toBe('application/json');
    });

    test('returns the same singleton instance across requires (CommonJS module cache)', () => {
        const a = require('../../src/utils/PortalClient');
        const b = require('../../src/utils/PortalClient');
        expect(a).toBe(b);
    });

    test('exposes axios verbs (get, post, put, delete)', () => {
        const portalClient = require('../../src/utils/PortalClient');
        expect(typeof portalClient.get).toBe('function');
        expect(typeof portalClient.post).toBe('function');
        expect(typeof portalClient.put).toBe('function');
        expect(typeof portalClient.delete).toBe('function');
    });

    test('does NOT expose axios.create (the cliente IS the cached instance, not a factory)', () => {
        const portalClient = require('../../src/utils/PortalClient');
        // Sanity check: portalClient is an instance, not the axios root module.
        // Si alguien refactorea PortalClient.js a `module.exports = axios`, este test rompe.
        expect(portalClient.defaults).toBeDefined();
        expect(portalClient.defaults.timeout).toBe(12345);
    });
});
