/**
 * Tests for src/utils/GetProviders.js (Quick task 260502-i7l).
 *
 * Verifies the post-fix contract:
 *   1.1 RED→GREEN: getProviders re-throws on portalClient axios failure (no more swallow).
 *   1.2 Empty-legítimo path PRESERVED — total=0 still returns [].
 *   1.3 Happy path PRESERVED — total>0 returns response.data.items.
 *   1.4 Source-grep regression guard — file does NOT contain node-notifier require or notifier.notify call.
 *
 * Pattern S-9: jest.mock('../../src/config', ...) prevents process.exit(1) on missing env vars.
 * Test 1.4 mirrors tests/services/CronScheduler.timeout-listener.test.js:297-303 (literal source assertion).
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const fs = require('fs');
const path = require('path');

jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://test',
        tenants: [{ id: 'T1', key: 'k1', secret: 's1', database: 'DB1' }],
        httpTimeoutMs: 30000,
    },
    paths: { logs: '/tmp/logs' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', notices: [], cc: [] },
    license: { adminEmail: 'admin@test.com' },
    app: { company: 'TestCo', timezone: 'America/Mexico_City' },
    security: { apiKey: 'test-key' },
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 5000, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
}));

const mockGet = jest.fn();
jest.mock('../../src/utils/PortalClient', () => ({ get: mockGet }));

jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: jest.fn() }));
jest.mock('../../src/utils/TimezoneHelper', () => ({ getCurrentDateString: () => '2026-04-29' }));

describe('GetProviders (Quick task 260502-i7l)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Test 1.1: getProviders re-throws on portalClient axios failure', async () => {
        mockGet.mockRejectedValueOnce(new Error('Portal HTTP 500'));
        const { getProviders } = require('../../src/utils/GetProviders');
        await expect(getProviders(0)).rejects.toThrow('Portal HTTP 500');
    });

    test('Test 1.2: getProviders returns [] when response.data.total === 0', async () => {
        mockGet.mockResolvedValueOnce({ data: { total: 0, items: [] } });
        const { getProviders } = require('../../src/utils/GetProviders');
        const result = await getProviders(0);
        expect(result).toEqual([]);
    });

    test('Test 1.3: getProviders returns items when total > 0', async () => {
        const items = [{ id: 'p1', name: 'Acme' }];
        mockGet.mockResolvedValueOnce({ data: { total: 1, items } });
        const { getProviders } = require('../../src/utils/GetProviders');
        const result = await getProviders(0);
        expect(result).toEqual(items);
    });

    test('Test 1.4 (source-grep regression guard): GetProviders.js source NO contains node-notifier require or notifier.notify call', () => {
        // Mirror of tests/services/CronScheduler.timeout-listener.test.js:297-303 pattern.
        // Source-string assertion (NO runtime mock) — pin "no node-notifier in source".
        // Tautological if done as runtime mock (the require was removed entirely),
        // so we verify literal source content instead.
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'utils', 'GetProviders.js'), 'utf8');
        expect(src).not.toMatch(/require\(['"]node-notifier['"]\)/);
        expect(src).not.toMatch(/notifier\.notify/);
    });
});
