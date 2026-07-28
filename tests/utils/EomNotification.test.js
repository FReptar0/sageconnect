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
