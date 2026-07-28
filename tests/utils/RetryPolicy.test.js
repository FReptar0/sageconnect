// tests/utils/RetryPolicy.test.js
// RETRY-C1 / RETRY-C2 / RETRY-C4 / RETRY-C6 / RETRY-S1 — unit coverage for the pure cron-retry helpers.
// The retry wait is a FIXED interval per document type (payments 30 min, POs 240 min); it does
// not grow with the attempt count. Eligibility lives in one shared helper so the first-attempt
// rule (RETRY-C4) cannot diverge between the two controllers and the diagnostic script.
// RETRY-S1: fesa.dbo.fesaPagosFocaltec has only FOUR columns — idCia, NoPagoSage, status,
// idFocaltec (2026-07-27 production read of fesa.INFORMATION_SCHEMA.COLUMNS) — so its error-stats
// fragment must never reference lastUpdate, while fesaOCFocaltec's (which does have the column)
// must stay byte-identical.

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

    // RETRY-S4 / D-01 / D-05 — the single-clock contract. Both operands of the elapsed-time
    // comparison must come off ONE clock: `now` is the `GETDATE() AS dbNow` column of the very
    // SELECT that produced `lastErrorAt`. Per hazard H-2, every fixture below derives its
    // lastErrorAt from `dbNow` — a fixture that leaves dbNow unset falls back to the Node clock
    // and would keep passing no matter what the call sites do, i.e. it would prove nothing.
    describe('single clock — a SQL-sourced now (dbNow)', () => {
        // Measured 2026-07-27 on the deployed SQL Server host:
        // DATEDIFF(mi, GETUTCDATE(), GETDATE()) = -360. tedious@18.6.1 defaults useUTC: true and
        // SQLServerConnection.js overrides only trustServerCertificate, so lastErrorAt arrives as
        // server-local wall clock labelled UTC while new Date() returns true UTC — 360 min apart.
        const SKEW_MIN = 360;
        const dbNow = new Date('2026-07-20T12:00:00.000Z');
        // What new Date() would return while SQL hands back timestamps labelled 360 min behind.
        const nodeNow = new Date(dbNow.getTime() + SKEW_MIN * MS_PER_MINUTE);

        test('a 5-minute-old error defers on the server clock but reads eligible under the 360-min skew', () => {
            const intervalMinutes = 30;
            const lastErrorAt = new Date(dbNow.getTime() - 5 * MS_PER_MINUTE);

            const onServerClock = computeRetryEligibility({ lastErrorAt, intervalMinutes, now: dbNow });
            const onSkewedNodeClock = computeRetryEligibility({ lastErrorAt, intervalMinutes, now: nodeNow });

            // The correct verdict: 5 min elapsed, 30 min required.
            expect(onServerClock.eligible).toBe(false);
            expect(onServerClock.nextEligibleAt.getTime())
                .toBe(lastErrorAt.getTime() + intervalMinutes * MS_PER_MINUTE);

            // What the defect did: 360 min of skew swamps both configured intervals (30 payment,
            // 240 PO), so every candidate always looked eligible and [RETRY-DEFER] could never
            // fire. Asserting the skewed verdict too is what makes this test fail the moment a
            // call site reverts to new Date() — the pair encodes both outcomes.
            expect(onSkewedNodeClock.eligible).toBe(true);
        });

        test('does not over-defer — 40 minutes past a 30-minute interval is eligible on the server clock', () => {
            const lastErrorAt = new Date(dbNow.getTime() - 40 * MS_PER_MINUTE);

            expect(computeRetryEligibility({ lastErrorAt, intervalMinutes: 30, now: dbNow }).eligible).toBe(true);
        });

        test('fails open on an unusable now — no bad dbNow can permanently defer a row', () => {
            // Regression guard for hazard H-1. Before this phase `null`, `''` and `0` each
            // returned eligible: false, because new Date(<falsy>) is the Unix epoch, so
            // 0 >= nextEligibleAt is never true and EVERY candidate row deferred forever behind
            // normal-looking [RETRY-DEFER] lines. These values fall back to the process clock,
            // so lastErrorAt is derived from it rather than from dbNow.
            const lastErrorAt = new Date(Date.now() - 300 * MS_PER_MINUTE);

            [null, '', 0, 'not-a-date', NaN].forEach((badNow) => {
                expect(computeRetryEligibility({ lastErrorAt, intervalMinutes: 240, now: badNow }).eligible).toBe(true);
            });
        });

        test('now: undefined uses the process clock — the documented default, pinned so a change stays deliberate', () => {
            const lastErrorAt = new Date(Date.now() - 300 * MS_PER_MINUTE);

            expect(computeRetryEligibility({ lastErrorAt, intervalMinutes: 240, now: undefined }).eligible).toBe(true);
            expect(computeRetryEligibility({ lastErrorAt, intervalMinutes: 240 }).eligible).toBe(true);
        });
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
            dbAlias: 'COPDAT',
            timestampColumn: 'lastUpdate'
        });
        expect(sql).toMatch(/OUTER APPLY/);
        expect(sql).toMatch(/COUNT\(\*\) AS errorCount/);
        expect(sql).toMatch(/MAX\(lastUpdate\) AS lastErrorAt/);
        expect(sql).toMatch(/idDatabase = 'COPDAT'/);
        expect(sql).toMatch(/status = 'ERROR'/);
        expect(sql).toMatch(/ocSage = A\.PONUMBER/);
        expect(sql).toMatch(/AS ef/);
        // RETRY-S1 byte-identity guard: fesaOCFocaltec genuinely HAS lastUpdate, so the payments
        // fix must leave this line untouched down to its 4-space indent (SPEC acceptance #3).
        expect(sql.split('\n')[1]).toBe('    SELECT COUNT(*) AS errorCount, MAX(lastUpdate) AS lastErrorAt');
    });

    test('payments case — explicit dbColumn "idCia"', () => {
        const sql = buildErrorStatsApply({
            fesaTable: 'fesa.dbo.fesaPagosFocaltec',
            joinColumn: 'NoPagoSage',
            joinKey: 'P.DOCNBR',
            dbAlias: 'COPDAT',
            dbColumn: 'idCia',
            timestampColumn: 'none'
        });
        expect(sql).toMatch(/idCia = 'COPDAT'/);
        expect(sql).toMatch(/NoPagoSage = P\.DOCNBR/);
        expect(sql).not.toMatch(/idDatabase/);
        expect(sql).not.toMatch(/ocSage/);
        // RETRY-S1: fesaPagosFocaltec has no lastUpdate column. Emitting it aborts the whole
        // payment cron query with `Invalid column name`; the .catch() at
        // PortalPaymentController.js:103 swallows that into { recordset: [] }, so the cron would
        // process zero payments on every tick behind a normal-looking [RETRY] summary.
        expect(sql).not.toMatch(/lastUpdate/);
        // The shape both controllers consume is unchanged: errorCount stays a real COUNT(*)
        // (legal — `status` exists) and lastErrorAt survives as a typed NULL.
        expect(sql).toMatch(/COUNT\(\*\) AS errorCount/);
        expect(sql).toMatch(/CAST\(NULL AS datetime\) AS lastErrorAt/);
        // Mirror of the OC byte-identity guard above — pins the whole payments SELECT line so a
        // future edit cannot reintroduce a column that does not exist on this table.
        expect(sql.split('\n')[1]).toBe('    SELECT COUNT(*) AS errorCount, CAST(NULL AS datetime) AS lastErrorAt');
    });

    test('throws for a missing or unknown timestampColumn', () => {
        // D-06: there is deliberately NO default. A 'lastUpdate' default would be right for OCs
        // and silently invalid for payments — the CLAUDE.md §6 pitfall #2 shape (PR #16 → #19).
        const base = {
            fesaTable: 'fesa.dbo.fesaPagosFocaltec',
            joinColumn: 'NoPagoSage',
            joinKey: 'P.DOCNBR',
            dbAlias: 'COPDAT',
            dbColumn: 'idCia'
        };
        expect(() => buildErrorStatsApply(base)).toThrow(/invalid timestampColumn/i);
        expect(() => buildErrorStatsApply(Object.assign({}, base, { timestampColumn: null }))).toThrow(/invalid timestampColumn/i);
        expect(() => buildErrorStatsApply(Object.assign({}, base, { timestampColumn: '' }))).toThrow(/invalid timestampColumn/i);
        // Near-misses: the closed set is case-sensitive, same posture as getRetryIntervalMinutes' 'PO' case.
        expect(() => buildErrorStatsApply(Object.assign({}, base, { timestampColumn: 'lastupdate' }))).toThrow(/invalid timestampColumn/i);
        expect(() => buildErrorStatsApply(Object.assign({}, base, { timestampColumn: 'LastUpdate' }))).toThrow(/invalid timestampColumn/i);
        expect(() => buildErrorStatsApply(Object.assign({}, base, { timestampColumn: 'None' }))).toThrow(/invalid timestampColumn/i);
        // Plausible but wrong: fesaOCFocaltec does have a createdAt column, but it is not a selector.
        expect(() => buildErrorStatsApply(Object.assign({}, base, { timestampColumn: 'createdAt' }))).toThrow(/invalid timestampColumn/i);
    });
});
