// tests/utils/RetryPolicy.test.js
// RETRY-C1 / RETRY-C2 / RETRY-C4 / RETRY-C6 — unit coverage for the pure cron-retry helpers.
// The retry wait is a FIXED interval per document type (payments 30 min, POs 240 min); it does
// not grow with the attempt count. Eligibility lives in one shared helper so the first-attempt
// rule (RETRY-C4) cannot diverge between the two controllers and the diagnostic script.

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
        scope: 'last_n_days',
        lookbackDays: 30,
        interval: { payment: 30, po: 240 }
    },
    eom: { notificationHour: 18, notificationEnabled: true }
}));

const {
    getRetryIntervalMinutes,
    computeRetryEligibility,
    buildScopeWhere,
    buildErrorStatsApply
} = require('../../src/utils/RetryPolicy');

const MS_PER_MINUTE = 60000;

describe('getRetryIntervalMinutes', () => {
    const intervalCfg = { payment: 30, po: 240 };

    test('returns the payment interval (30) for docType "payment"', () => {
        expect(getRetryIntervalMinutes(intervalCfg, 'payment')).toBe(30);
    });

    test('returns the PO interval (240) for docType "po"', () => {
        expect(getRetryIntervalMinutes(intervalCfg, 'po')).toBe(240);
    });

    test('is fixed — identical regardless of any attempt-count argument', () => {
        [0, 1, 2, 3, 5, 8, 20, 100].forEach((attempts) => {
            expect(getRetryIntervalMinutes(intervalCfg, 'payment', attempts)).toBe(30);
            expect(getRetryIntervalMinutes(intervalCfg, 'po', attempts)).toBe(240);
        });
    });

    test('honors a custom interval config (env-tuned values)', () => {
        const custom = { payment: 45, po: 600 };
        expect(getRetryIntervalMinutes(custom, 'payment')).toBe(45);
        expect(getRetryIntervalMinutes(custom, 'po')).toBe(600);
    });

    test('throws for an unknown docType', () => {
        expect(() => getRetryIntervalMinutes(intervalCfg, 'invoice')).toThrow(/invalid docType/i);
        expect(() => getRetryIntervalMinutes(intervalCfg, undefined)).toThrow(/invalid docType/i);
        expect(() => getRetryIntervalMinutes(intervalCfg, 'PO')).toThrow(/invalid docType/i);
    });
});

describe('computeRetryEligibility', () => {
    // Fixed `now` so the >=-inclusive boundary is deterministic; every lastErrorAt is derived from it.
    const now = new Date('2026-07-20T12:00:00.000Z');

    test('first attempt (lastErrorAt null/undefined) is eligible immediately, nextEligibleAt null', () => {
        expect(computeRetryEligibility({ lastErrorAt: null, intervalMinutes: 240, now }))
            .toEqual({ eligible: true, nextEligibleAt: null });
        expect(computeRetryEligibility({ lastErrorAt: undefined, intervalMinutes: 30, now }))
            .toEqual({ eligible: true, nextEligibleAt: null });
    });

    test('lastErrorAt exactly intervalMinutes ago is eligible (>= inclusive boundary)', () => {
        const intervalMinutes = 240;
        const lastErrorAt = new Date(now.getTime() - intervalMinutes * MS_PER_MINUTE);

        const result = computeRetryEligibility({ lastErrorAt, intervalMinutes, now });

        expect(result.eligible).toBe(true);
        expect(result.nextEligibleAt).toBeInstanceOf(Date);
        expect(result.nextEligibleAt.getTime()).toBe(now.getTime());
    });

    test('one ms inside the interval is deferred and reports nextEligibleAt', () => {
        const intervalMinutes = 30;
        const lastErrorAt = new Date(now.getTime() - (intervalMinutes * MS_PER_MINUTE - 1));

        const result = computeRetryEligibility({ lastErrorAt, intervalMinutes, now });

        expect(result.eligible).toBe(false);
        expect(result.nextEligibleAt).toBeInstanceOf(Date);
        expect(result.nextEligibleAt.getTime()).toBe(lastErrorAt.getTime() + intervalMinutes * MS_PER_MINUTE);
        expect(result.nextEligibleAt.getTime()).toBe(now.getTime() + 1);
    });

    test('lastErrorAt well past the interval is eligible and still reports nextEligibleAt', () => {
        const intervalMinutes = 240;
        const lastErrorAt = new Date(now.getTime() - 3 * intervalMinutes * MS_PER_MINUTE);

        const result = computeRetryEligibility({ lastErrorAt, intervalMinutes, now });

        expect(result.eligible).toBe(true);
        expect(result.nextEligibleAt.getTime()).toBe(lastErrorAt.getTime() + intervalMinutes * MS_PER_MINUTE);
    });

    test('accepts a SQL/ISO timestamp string for lastErrorAt (mssql may not hand back a Date)', () => {
        const intervalMinutes = 30;
        const eligible = computeRetryEligibility({
            lastErrorAt: new Date(now.getTime() - 31 * MS_PER_MINUTE).toISOString(),
            intervalMinutes,
            now
        });
        const deferred = computeRetryEligibility({
            lastErrorAt: new Date(now.getTime() - 29 * MS_PER_MINUTE).toISOString(),
            intervalMinutes,
            now
        });

        expect(eligible.eligible).toBe(true);
        expect(deferred.eligible).toBe(false);
    });

    test('the two document types defer differently for the same lastErrorAt', () => {
        const lastErrorAt = new Date(now.getTime() - 60 * MS_PER_MINUTE); // failed 1 h ago

        expect(computeRetryEligibility({ lastErrorAt, intervalMinutes: 30, now }).eligible).toBe(true);
        expect(computeRetryEligibility({ lastErrorAt, intervalMinutes: 240, now }).eligible).toBe(false);
    });

    test('fails open (eligible) on an unusable intervalMinutes or lastErrorAt — never stalls the cron', () => {
        const lastErrorAt = new Date(now.getTime() - 5 * MS_PER_MINUTE);

        [undefined, null, NaN, Infinity, -10, 'abc'].forEach((bad) => {
            expect(computeRetryEligibility({ lastErrorAt, intervalMinutes: bad, now }).eligible).toBe(true);
        });

        expect(computeRetryEligibility({ lastErrorAt: 'not-a-date', intervalMinutes: 240, now }))
            .toEqual({ eligible: true, nextEligibleAt: null });
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
