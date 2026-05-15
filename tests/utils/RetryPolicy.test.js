// tests/utils/RetryPolicy.test.js
// RETRY-04 / RETRY-05 — unit coverage for the pure cron-retry helpers.

// Mock config to prevent process.exit(1) from config validation. RetryPolicy.js
// itself does not require config, but the test runner may load it transitively;
// the full shim includes the Phase 20 `retry` + `eom` namespaces for forward
// compatibility with the 20-03 EomNotification test mock shape.
jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://localhost',
        tenants: [
            { id: 'tenant1', key: 'key1', secret: 'secret1', database: 'TESTDB', externalId: 'ext1' }
        ]
    },
    database: { user: '', password: '', server: '', database: '' },
    mailing: { notices: [], cc: '' },
    paths: { downloads: '', providers: '', logs: '' },
    app: {
        importRoute: '', arg: '', company: '', rfc: '', regimen: '', timezone: 'America/Mexico_City',
        defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
        addressIdentifiersSkip: []
    },
    license: {},
    retry: {
        scope: 'current_month',
        lookbackDays: 30,
        backoff: { initialMin: 15, multiplier: 2, maxMin: 1440 }
    },
    eom: { notificationHour: 18, notificationEnabled: true }
}));

const { computeBackoffWaitMinutes, buildScopeWhere, buildErrorStatsApply } = require('../../src/utils/RetryPolicy');

describe('computeBackoffWaitMinutes', () => {
    const cfg = { initialMin: 15, multiplier: 2, maxMin: 1440 };

    test('returns canonical curve 0,15,30,60,120,240,480,960,1440 for n=0..8', () => {
        const expected = [0, 15, 30, 60, 120, 240, 480, 960, 1440];
        for (let n = 0; n <= 8; n++) {
            expect(computeBackoffWaitMinutes(n, cfg)).toBe(expected[n]);
        }
    });

    test('caps at maxMin (1440) for high n', () => {
        expect(computeBackoffWaitMinutes(20, cfg)).toBe(1440);
        expect(computeBackoffWaitMinutes(100, cfg)).toBe(1440);
    });

    test('returns 0 defensively for invalid input', () => {
        const bad = [-1, NaN, Infinity, -Infinity, null, undefined, 'abc'];
        bad.forEach((value) => {
            expect(computeBackoffWaitMinutes(value, cfg)).toBe(0);
        });
    });

    test('respects custom backoffConfig', () => {
        const custom = { initialMin: 5, multiplier: 3, maxMin: 600 };
        expect(computeBackoffWaitMinutes(1, custom)).toBe(5);
        expect(computeBackoffWaitMinutes(2, custom)).toBe(15);
        expect(computeBackoffWaitMinutes(3, custom)).toBe(45);
        expect(computeBackoffWaitMinutes(4, custom)).toBe(135);
        expect(computeBackoffWaitMinutes(5, custom)).toBe(405);
        expect(computeBackoffWaitMinutes(6, custom)).toBe(600); // capped
    });
});

describe('buildScopeWhere', () => {
    test('current_month with default dateField "Fecha"', () => {
        const sql = buildScopeWhere({ scope: 'current_month' });
        expect(sql).toMatch(/DATEFROMPARTS/);
        expect(sql).toMatch(/DATEADD\(month, 1/);
        expect(sql).toMatch(/YEAR\(GETDATE\(\)\)/);
        expect(sql).toMatch(/MONTH\(GETDATE\(\)\)/);
        expect(sql).toMatch(/Fecha >=/);
        expect(sql).toMatch(/Fecha </);
    });

    test('current_month with custom dateField "P.AUDTDATE"', () => {
        const sql = buildScopeWhere({ scope: 'current_month' }, { dateField: 'P.AUDTDATE' });
        expect(sql).toMatch(/P\.AUDTDATE >=/);
        expect(sql).toMatch(/P\.AUDTDATE </);
    });

    test('last_n_days with lookbackDays=30', () => {
        const sql = buildScopeWhere({ scope: 'last_n_days', lookbackDays: 30 });
        expect(sql).toMatch(/DATEADD\(day, -30/);
        expect(sql).toMatch(/CAST\(GETDATE\(\) AS DATE\)/);
    });

    test('last_n_days with custom dateField + lookbackDays=7', () => {
        const sql = buildScopeWhere({ scope: 'last_n_days', lookbackDays: 7 }, { dateField: 'P.AUDTDATE' });
        expect(sql).toMatch(/P\.AUDTDATE >= DATEADD\(day, -7/);
    });

    test('throws for invalid scope', () => {
        expect(() => buildScopeWhere({ scope: 'invalid' })).toThrow(/invalid scope/i);
    });
});

describe('buildErrorStatsApply', () => {
    test('POs case — default dbColumn "idDatabase"', () => {
        const sql = buildErrorStatsApply({
            fesaTable: 'fesa.dbo.fesaOCFocaltec',
            joinColumn: 'ocSage',
            joinKey: 'A.PONUMBER',
            dbAlias: 'COPDAT'
        });
        expect(sql).toMatch(/OUTER APPLY/);
        expect(sql).toMatch(/COUNT\(\*\) AS errorCount/);
        expect(sql).toMatch(/MAX\(lastUpdate\) AS lastErrorAt/);
        expect(sql).toMatch(/idDatabase = 'COPDAT'/);
        expect(sql).toMatch(/status = 'ERROR'/);
        expect(sql).toMatch(/ocSage = A\.PONUMBER/);
        expect(sql).toMatch(/AS ef/);
    });

    test('payments case — explicit dbColumn "idCia"', () => {
        const sql = buildErrorStatsApply({
            fesaTable: 'fesa.dbo.fesaPagosFocaltec',
            joinColumn: 'NoPagoSage',
            joinKey: 'P.DOCNBR',
            dbAlias: 'COPDAT',
            dbColumn: 'idCia'
        });
        expect(sql).toMatch(/idCia = 'COPDAT'/);
        expect(sql).toMatch(/NoPagoSage = P\.DOCNBR/);
        expect(sql).not.toMatch(/idDatabase/);
        expect(sql).not.toMatch(/ocSage/);
    });
});
