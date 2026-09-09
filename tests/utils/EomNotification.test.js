// tests/utils/EomNotification.test.js
// EOM-01 / EOM-03 / EOM-04 / D-15 / D-16: gate truth table + atomic sentinel I/O + snapshot HTML.

jest.mock('../../src/config', () => {
    const nodePath = require('path');
    const nodeOs = require('os');
    return {
        portal: { url: 'http://test', tenants: [{ id: 'T1', database: 'TESTDB' }] },
        database: { user: '', password: '', server: '', database: '' },
        mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', notices: [], cc: [], password: '' },
        paths: { downloads: '', providers: '', logs: nodePath.join(nodeOs.tmpdir(), `sageconnect-test-eom-${process.pid}`) },
        app: {
            importRoute: '', arg: '', company: '', rfc: '', regimen: '', timezone: 'America/Mexico_City',
            defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
            addressIdentifiersSkip: [],
            baseUrl: 'http://localhost:3030',
        },
        license: { adminEmail: 'admin@test.com' },
        security: { apiKey: 'test-key' },
        schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 0, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 10 * 60 * 1000, stepTimeoutMs: 5 * 60 * 1000 },
        retry: { scope: 'current_month', lookbackDays: 30, backoff: { initialMin: 15, multiplier: 2, maxMin: 1440 } },
        eom: { notificationHour: 18, notificationEnabled: true },
    };
});

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    shouldDispatchEom,
    shouldDispatchPaymentReport,
    paymentPeriodOf,
    buildEomEmailHtml,
    writeSentinelAtomically,
    readSentinelPayload,
} = require('../../src/utils/EomNotification');

const tmpRoot = path.join(os.tmpdir(), `sageconnect-eom-test-${process.pid}`);

// Local-time constructors (D-16, option a) — production background.js calls
// `new Date()`, also local-time. month index 4 = May; last day of May = 31.
const lastDayLateHour = new Date(2026, 4, 31, 18, 5, 0);
const lastDayEarlyHour = new Date(2026, 4, 31, 17, 55, 0);
const notLastDayLateHour = new Date(2026, 4, 30, 18, 5, 0);
const notLastDayEarlyHour = new Date(2026, 4, 30, 17, 55, 0);

const eomCfgEnabled = { notificationHour: 18, notificationEnabled: true };
const eomCfgDisabled = { notificationHour: 18, notificationEnabled: false };

beforeEach(() => {
    if (fs.existsSync(tmpRoot)) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpRoot, { recursive: true });
});

afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('shouldDispatchEom truth table', () => {
    const sentinelPath = () => path.join(tmpRoot, 'eom-test.sent');

    function writeSentinel() {
        fs.writeFileSync(sentinelPath(), '{}', 'utf8');
    }

    // 8 combos: last-day Y/N × hour>=threshold Y/N × sentinel-exists Y/N (enabled=true).
    test('last=Y hour=Y sentinel=N -> true', () => {
        expect(shouldDispatchEom(lastDayLateHour, sentinelPath(), eomCfgEnabled)).toBe(true);
    });

    test('last=Y hour=Y sentinel=Y -> false', () => {
        writeSentinel();
        expect(shouldDispatchEom(lastDayLateHour, sentinelPath(), eomCfgEnabled)).toBe(false);
    });

    test('last=Y hour=N sentinel=N -> false', () => {
        expect(shouldDispatchEom(lastDayEarlyHour, sentinelPath(), eomCfgEnabled)).toBe(false);
    });

    test('last=Y hour=N sentinel=Y -> false', () => {
        writeSentinel();
        expect(shouldDispatchEom(lastDayEarlyHour, sentinelPath(), eomCfgEnabled)).toBe(false);
    });

    test('last=N hour=Y sentinel=N -> false', () => {
        expect(shouldDispatchEom(notLastDayLateHour, sentinelPath(), eomCfgEnabled)).toBe(false);
    });

    test('last=N hour=Y sentinel=Y -> false', () => {
        writeSentinel();
        expect(shouldDispatchEom(notLastDayLateHour, sentinelPath(), eomCfgEnabled)).toBe(false);
    });

    test('last=N hour=N sentinel=N -> false', () => {
        expect(shouldDispatchEom(notLastDayEarlyHour, sentinelPath(), eomCfgEnabled)).toBe(false);
    });

    test('last=N hour=N sentinel=Y -> false', () => {
        writeSentinel();
        expect(shouldDispatchEom(notLastDayEarlyHour, sentinelPath(), eomCfgEnabled)).toBe(false);
    });

    // 9th: kill-switch dominates the positive combo.
    test('notificationEnabled=false short-circuits the positive combo -> false', () => {
        expect(shouldDispatchEom(lastDayLateHour, sentinelPath(), eomCfgDisabled)).toBe(false);
    });
});

describe('writeSentinelAtomically + readSentinelPayload', () => {
    test('round-trip preserves payload', () => {
        const sentinelPath = path.join(tmpRoot, 'roundtrip.sent');
        const payload = { timestamp: '2026-05-31T18:05:00.000Z', success: true, rowCount: 2 };
        writeSentinelAtomically(sentinelPath, payload);
        expect(readSentinelPayload(sentinelPath)).toEqual(payload);
    });

    test('readSentinelPayload returns null for missing file', () => {
        expect(readSentinelPayload(path.join(tmpRoot, 'does-not-exist.sent'))).toBe(null);
    });

    test('readSentinelPayload returns null for malformed JSON', () => {
        const sentinelPath = path.join(tmpRoot, 'malformed.sent');
        fs.writeFileSync(sentinelPath, 'not valid json', 'utf8');
        expect(readSentinelPayload(sentinelPath)).toBe(null);
    });

    test('writeSentinelAtomically re-throws on rename failure', () => {
        const sentinelPath = path.join(tmpRoot, 'rename-fail.sent');
        const realRenameSync = fs.renameSync;
        const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
            if (typeof from === 'string' && from.startsWith(tmpRoot)) {
                throw new Error('EXDEV cross-device link');
            }
            return realRenameSync.call(fs, from, to);
        });

        try {
            expect(() => {
                writeSentinelAtomically(sentinelPath, { timestamp: 't', success: true });
            }).toThrow(/EXDEV cross-device link/);
            // .tmp survives, final sentinel never created.
            expect(fs.existsSync(sentinelPath + '.tmp')).toBe(true);
            expect(fs.existsSync(sentinelPath)).toBe(false);
        } finally {
            renameSpy.mockRestore();
        }
    });
});

describe('buildEomEmailHtml', () => {
    test('snapshot matches tests/fixtures/eom-email-sample.html for pos category with 2 rows', () => {
        const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/eom-email-sample.html'), 'utf8');
        const rows = [
            { tenant: 'COPDAT', idOrPo: 'PO0083449', fechaAuth: '2026-05-07', attempts: 3, lastError: 'CFDI VENDOR_NOT_FOUND' },
            { tenant: 'COPDAT', idOrPo: 'PO0083500', fechaAuth: '2026-05-12', attempts: 1, lastError: 'TIMEOUT 30s' },
        ];
        const actual = buildEomEmailHtml(rows, 'pos');
        expect(actual.trim()).toBe(fixture.trim());
    });

    test('empty rows produces "Sin pendientes" message + footer', () => {
        const actual = buildEomEmailHtml([], 'pos');
        expect(actual).toMatch(/Sin pendientes en esta categoría este mes/);
        expect(actual).toMatch(/<a[^>]*pos\.html[^>]*>Ver POs<\/a>/);
        expect(actual).toMatch(/<a[^>]*payments\.html[^>]*>Ver pagos<\/a>/);
    });

    // Phase 20.2 / RETRY-S3 / D-10 / D-11: the payments table is deliberately one column
    // narrower than the POs table. Its control table (fesa.dbo.fesaPagosFocaltec) has four
    // columns and none of them can hold an error description, so the column is removed
    // rather than filled with a placeholder, and one footnote states the gap.
    test('payments category with 2 rows renders 5 columns, no error column, and the footnote', () => {
        const rows = [
            // The lastError values are deliberate: they must NOT reach the payments output.
            { tenant: 'COPDAT', idOrPo: 'PAY00001234', fechaAuth: '2026-05-12', attempts: 1, lastError: 'TIMEOUT 30s' },
            { tenant: 'COPDAT', idOrPo: 'PAY00005678', fechaAuth: '2026-05-20', attempts: 2, lastError: 'CFDI VENDOR_NOT_FOUND' },
        ];
        const actual = buildEomEmailHtml(rows, 'payments');

        // Header and body branch together — 5 headers over 2 rows x 5 cells.
        expect((actual.match(/<th>/g) || []).length).toBe(5);
        expect((actual.match(/<td>/g) || []).length).toBe(10);
        // The dropped column, by header text and by leaked value.
        expect(actual).not.toMatch(/Último error/);
        expect(actual).not.toMatch(/TIMEOUT 30s/);
        expect(actual).not.toMatch(/CFDI VENDOR_NOT_FOUND/);
        // The rows themselves still render.
        expect(actual).toMatch(/PAY00001234/);
        expect(actual).toMatch(/PAY00005678/);
        // The D-10 footnote.
        expect(actual).toMatch(/<p><em>Nota:/);
    });

    test('payments category with 0 rows still carries "Sin pendientes", the footnote and the footer', () => {
        const actual = buildEomEmailHtml([], 'payments');
        expect(actual).toMatch(/Sin pendientes en esta categoría este mes/);
        // The footnote sits OUTSIDE the if/else on purpose: the empty case is exactly when
        // an operator might otherwise conclude that nothing failed.
        expect(actual).toMatch(/<p><em>Nota:/);
        expect(actual).toMatch(/<a[^>]*pos\.html[^>]*>Ver POs<\/a>/);
        expect(actual).toMatch(/<a[^>]*payments\.html[^>]*>Ver pagos<\/a>/);
    });

    test('pos category never renders the payments footnote (D-11)', () => {
        const rows = [
            { tenant: 'COPDAT', idOrPo: 'PO0083449', fechaAuth: '2026-05-07', attempts: 3, lastError: 'CFDI VENDOR_NOT_FOUND' },
            { tenant: 'COPDAT', idOrPo: 'PO0083500', fechaAuth: '2026-05-12', attempts: 1, lastError: 'TIMEOUT 30s' },
        ];
        expect(buildEomEmailHtml(rows, 'pos')).not.toMatch(/<p><em>Nota:/);
        expect(buildEomEmailHtml([], 'pos')).not.toMatch(/<p><em>Nota:/);
        // The POs table keeps all six columns and its error cell.
        expect((buildEomEmailHtml(rows, 'pos').match(/<th>/g) || []).length).toBe(6);
        expect((buildEomEmailHtml(rows, 'pos').match(/<td>/g) || []).length).toBe(12);
        expect(buildEomEmailHtml(rows, 'pos')).toMatch(/Último error/);
    });
});

// ---------------------------------------------------------------------------
// Phase 20.5 — Q3-03 (biweekly gate), D-06 (natural periods), D-07 (no exact-day
// term) and Q3-05 (the month-close body does not move). Everything above this
// line is Phase 20 / 20.2 and is left untouched on purpose: Q3-05 requires every
// pre-existing assertion in this file to pass unchanged, and this file is the
// artifact that proves it.
// ---------------------------------------------------------------------------

// Same local-time register and the same month-index convention as the constants
// at the top of the file — month index 4 = May (31 days), index 5 = June (30),
// index 1 = February. Read `new Date(2026, 4, 16, ...)` as 16 May, not 16 June.
const day16LateHour = new Date(2026, 4, 16, 18, 5, 0);
const day16EarlyHour = new Date(2026, 4, 16, 17, 55, 0);
const day1LateHour = new Date(2026, 4, 1, 18, 5, 0);
const day1EarlyHour = new Date(2026, 4, 1, 17, 55, 0);
const day20LateHour = new Date(2026, 4, 20, 18, 5, 0);
const day9LateHour = new Date(2026, 4, 9, 18, 5, 0);

const reportCfgEnabled = { hour: 18, enabled: true };
const reportCfgDisabled = { hour: 18, enabled: false };

describe('shouldDispatchPaymentReport truth table (Q3-03, D-07)', () => {
    const sentinelPath = () => path.join(tmpRoot, 'payment-report-2026-05-2.sent');

    function writeSentinel() {
        fs.writeFileSync(sentinelPath(), '{}', 'utf8');
    }

    test('day=16 hour=Y sentinel=N -> true (SPEC checkbox 5)', () => {
        expect(shouldDispatchPaymentReport(day16LateHour, sentinelPath(), reportCfgEnabled)).toBe(true);
    });

    test('day=16 hour=Y sentinel=Y -> false, one report per period (SPEC checkbox 6)', () => {
        writeSentinel();
        expect(shouldDispatchPaymentReport(day16LateHour, sentinelPath(), reportCfgEnabled)).toBe(false);
    });

    test('day=16 hour=N sentinel=N -> false', () => {
        expect(shouldDispatchPaymentReport(day16EarlyHour, sentinelPath(), reportCfgEnabled)).toBe(false);
    });

    test('day=1 hour=Y sentinel=N -> true', () => {
        expect(shouldDispatchPaymentReport(day1LateHour, sentinelPath(), reportCfgEnabled)).toBe(true);
    });

    test('day=1 hour=N sentinel=N -> false', () => {
        expect(shouldDispatchPaymentReport(day1EarlyHour, sentinelPath(), reportCfgEnabled)).toBe(false);
    });

    // D-07, the keystone. The service was down / restarting / licence-blocked on the
    // 16th and this period's report has STILL not gone out. It must go out now.
    // Rewriting the predicate to an exact-day term (day is 1 or 16) makes this case
    // fail — which is exactly the point: that rewrite loses the period's report
    // permanently and silently, and nothing anywhere would report the gap.
    test('day=20 hour=Y sentinel=N -> true: a service down on the 16th does NOT lose the period (D-07)', () => {
        expect(shouldDispatchPaymentReport(day20LateHour, sentinelPath(), reportCfgEnabled)).toBe(true);
    });

    test('day=9 hour=Y sentinel=N -> true: a missed day 1 still reports later in the period (D-07)', () => {
        expect(shouldDispatchPaymentReport(day9LateHour, sentinelPath(), reportCfgEnabled)).toBe(true);
    });

    test('enabled=false short-circuits the otherwise-true combo -> false (Q3-04)', () => {
        expect(shouldDispatchPaymentReport(day16LateHour, sentinelPath(), reportCfgDisabled)).toBe(false);
    });

    test('fail-closed: reportConfig undefined -> false', () => {
        expect(shouldDispatchPaymentReport(day16LateHour, sentinelPath(), undefined)).toBe(false);
    });

    test('fail-closed: reportConfig not an object -> false', () => {
        expect(shouldDispatchPaymentReport(day16LateHour, sentinelPath(), 'yes')).toBe(false);
    });

    test('fail-closed: now is an invalid Date -> false', () => {
        expect(shouldDispatchPaymentReport(new Date('nope'), sentinelPath(), reportCfgEnabled)).toBe(false);
    });

    test('fail-closed: sentinelPath is an empty string -> false', () => {
        expect(shouldDispatchPaymentReport(day16LateHour, '', reportCfgEnabled)).toBe(false);
    });

    // Q3-04 / D-09: the two namespaces are NOT interchangeable. The EOM shape carries
    // `notificationEnabled` and no `enabled`, so feeding it here fails closed rather
    // than silently inheriting the month-close switch.
    test('the EOM config shape is not accepted as a payment-report config -> false (Q3-04, D-09)', () => {
        expect(shouldDispatchPaymentReport(day16LateHour, sentinelPath(), eomCfgEnabled)).toBe(false);
    });
});

describe('paymentPeriodOf boundaries (D-06)', () => {
    // [label, Date, expected period]. No month-length branch exists in the source and
    // these rows prove none is needed: the upper period is "16 or later", full stop.
    const cases = [
        ['31-day month, day 1', new Date(2026, 4, 1, 12, 0, 0), 1],
        ['31-day month, day 15', new Date(2026, 4, 15, 12, 0, 0), 1],
        ['31-day month, day 16', new Date(2026, 4, 16, 12, 0, 0), 2],
        ['31-day month, day 31', new Date(2026, 4, 31, 12, 0, 0), 2],
        ['30-day month, day 15', new Date(2026, 5, 15, 12, 0, 0), 1],
        ['30-day month, day 16', new Date(2026, 5, 16, 12, 0, 0), 2],
        ['30-day month, day 30', new Date(2026, 5, 30, 12, 0, 0), 2],
        ['February 2026 (28 days), day 28', new Date(2026, 1, 28, 12, 0, 0), 2],
        ['February 2028 (leap, 29 days), day 29', new Date(2028, 1, 29, 12, 0, 0), 2],
    ];

    test.each(cases)('%s -> period %i', (_label, date, expected) => {
        expect(paymentPeriodOf(date)).toBe(expected);
    });

    test('a non-Date argument yields null', () => {
        expect(paymentPeriodOf('2026-05-16')).toBe(null);
    });

    test('an invalid Date yields null', () => {
        expect(paymentPeriodOf(new Date('nope'))).toBe(null);
    });
});

describe('buildEomEmailHtml variant (Q3-05 + Q3-01)', () => {
    const posRows = [
        { tenant: 'COPDAT', idOrPo: 'PO0083449', fechaAuth: '2026-05-07', attempts: 3, lastError: 'CFDI VENDOR_NOT_FOUND' },
        { tenant: 'COPDAT', idOrPo: 'PO0083500', fechaAuth: '2026-05-12', attempts: 1, lastError: 'TIMEOUT 30s' },
    ];

    // Q3-05, byte-identity in a form that survives a later refactor of the fixture:
    // an omitted third argument must be indistinguishable from an explicit 'eom'.
    test('the omitted variant and an explicit \'eom\' produce identical output', () => {
        expect(buildEomEmailHtml(posRows, 'pos')).toBe(buildEomEmailHtml(posRows, 'pos', 'eom'));
        expect(buildEomEmailHtml([], 'pos')).toBe(buildEomEmailHtml([], 'pos', 'eom'));
    });

    test('(\'pos\', \'po-alert\') carries the urgent heading and the failure-date column', () => {
        const actual = buildEomEmailHtml(posRows, 'pos', 'po-alert');
        expect(actual).toMatch(/OCs que fallaron al subir al portal/);
        expect(actual).toMatch(/Fecha del fallo/);
        expect(actual).not.toMatch(/Pendientes fin de mes/);
        expect(actual).not.toMatch(/Fecha autorización/);
    });

    test('(\'pos\') with the same rows keeps the month-close heading and column', () => {
        const actual = buildEomEmailHtml(posRows, 'pos');
        expect(actual).toMatch(/Pendientes fin de mes/);
        expect(actual).toMatch(/Fecha autorización/);
        expect(actual).not.toMatch(/Fecha del fallo/);
    });

    // The column COUNT does not branch — that is what keeps the D-11 header/body
    // rule out of play. Six headers over six cells in both variants.
    test('the po-alert body renders exactly six <th> cells, same as the default POs branch', () => {
        const actual = buildEomEmailHtml(posRows, 'pos', 'po-alert');
        expect((actual.match(/<th>/g) || []).length).toBe(6);
        expect((actual.match(/<td>/g) || []).length).toBe(12);
    });

    // T-20-14 asserted ON the new path rather than assumed from the shared code.
    test('the po-alert body escapes a <script> payload in lastError (T-20-14)', () => {
        const rows = [{ tenant: 'COPDAT', idOrPo: 'PO1', fechaAuth: '2026-09-09', attempts: 1, lastError: '<script>alert(1)</script>' }];
        const actual = buildEomEmailHtml(rows, 'pos', 'po-alert');
        expect(actual).toMatch(/&lt;script&gt;/);
        expect(actual).not.toMatch(/<script>/);
    });

    test('the po-alert body truncates lastError at 100 chars with the ellipsis', () => {
        const long = 'x'.repeat(150);
        const rows = [{ tenant: 'COPDAT', idOrPo: 'PO1', fechaAuth: '2026-09-09', attempts: 1, lastError: long }];
        const actual = buildEomEmailHtml(rows, 'pos', 'po-alert');
        expect(actual).toContain('x'.repeat(100) + '…');
        expect(actual).not.toContain('x'.repeat(101));
    });

    // The variant is INERT outside the pos branch: it must not reach the payments
    // table and specifically must not disturb the 20.2-05 footnote.
    test('(\'payments\', \'po-alert\') is identical to (\'payments\')', () => {
        const payRows = [
            { tenant: 'COPDAT', idOrPo: 'PAY00001234', fechaAuth: '2026-05-12', attempts: 1, lastError: 'TIMEOUT 30s' },
        ];
        expect(buildEomEmailHtml(payRows, 'payments', 'po-alert')).toBe(buildEomEmailHtml(payRows, 'payments'));
        expect(buildEomEmailHtml([], 'payments', 'po-alert')).toBe(buildEomEmailHtml([], 'payments'));
        expect(buildEomEmailHtml(payRows, 'payments', 'po-alert')).toMatch(/<p><em>Nota:/);
    });
});
