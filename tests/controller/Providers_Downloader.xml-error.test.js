/**
 * Tests for src/controller/Providers_Downloader.js — XML proveedores error reports +
 * post-write validation (Quick task 260502-i7l, path-b).
 *
 * Test coverage:
 *   2    Error portal path: getProviders rejects → emits [XML-ERROR] + admin email + throws.
 *   3    Post-write validation fail (size 0): emits [XML-ERROR] reason=invalid +
 *        '[SageConnect] XML proveedores: post-write validation failed' email + throws.
 *   3.5  fs.writeFileSync rejection (ENOSPC): same email subject + [XML-ERROR] reason=invalid
 *        err=writeFileSync error: <msg> + throws.
 *   4    Happy path BYTE-SHAPE regression guard — preserves XML structure (xml decl +
 *        Proveedores root + Emisor + Proveedor with external_id="ext1") and emits NO email,
 *        NO [XML-ERROR].
 *   5    Empty-legítimo regression guard — getProviders returns [] (no throw) → warn log +
 *        return without writing file or emitting email.
 *
 * AdminEmailSender wraps nodemailer transitively; mocking nodemailer at the module level
 * suffices (matches Phase 18 patterns in CronScheduler.timeout-listener + schedule-force-release).
 */

const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://test',
        tenants: [{ id: 'T1', key: 'k1', secret: 's1', database: 'DB1', externalId: 'ext1' }],
        httpTimeoutMs: 30000,
    },
    paths: { downloads: '/tmp/downloads', logs: '/tmp/logs' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', notices: [], cc: [], password: '' },
    license: { adminEmail: 'admin@test.com' },
    app: { company: 'TestCo', timezone: 'America/Mexico_City', rfc: 'RFC', regimen: 'R1', arg: 'A1' },
    security: { apiKey: 'test-key' },
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 5000, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
}));

const mockGetProviders = jest.fn();
jest.mock('../../src/utils/GetProviders', () => ({ getProviders: mockGetProviders }));

const mockNodemailerSendMail = jest.fn().mockResolvedValue({ accepted: ['admin@test.com'] });
jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({ sendMail: mockNodemailerSendMail })),
}));

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

jest.mock('../../src/utils/TimezoneHelper', () => ({
    getCurrentDate: () => new Date('2026-04-29T12:00:00Z'),
}));

// Pre-load source module BEFORE any fs spying so Jest's own fs usage
// (transform cache, source map writes) can complete unhindered.
const { buildProvidersXML } = require('../../src/controller/Providers_Downloader');

const fs = require('fs');
const realWriteFileSync = fs.writeFileSync;
const realStatSync = fs.statSync;
const realReadFileSync = fs.readFileSync;

// Selective spies: only intercept calls within the test downloads dir
// (/tmp/downloads/providers-*.xml). Pass through everything else so Jest
// internals (cache writes to /private/var/folders/...) are unaffected.
const TEST_PATH_PREFIX = '/tmp/downloads/providers-';

let writeFileSyncCalls;       // captures (path, data, encoding) per call
let writeFileSyncShouldThrow; // when set, next matching call throws this Error

let statSyncStub;             // when set, next matching call returns this
let readFileSyncStub;         // when set, next matching call returns this

let writeFileSyncSpy;
let statSyncSpy;
let readFileSyncSpy;

describe('Providers_Downloader.buildProvidersXML (Quick task 260502-i7l, path-b)', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        writeFileSyncCalls = [];
        writeFileSyncShouldThrow = null;
        statSyncStub = { size: 5000 };
        readFileSyncStub = '<?xml version="1.0"?><Proveedores><Proveedor /></Proveedores>';

        writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(function (p, data, encoding) {
            if (typeof p === 'string' && p.startsWith(TEST_PATH_PREFIX)) {
                writeFileSyncCalls.push([p, data, encoding]);
                if (writeFileSyncShouldThrow) {
                    const err = writeFileSyncShouldThrow;
                    writeFileSyncShouldThrow = null;
                    throw err;
                }
                return undefined;
            }
            return realWriteFileSync.call(fs, p, data, encoding);
        });

        statSyncSpy = jest.spyOn(fs, 'statSync').mockImplementation(function (p) {
            if (typeof p === 'string' && p.startsWith(TEST_PATH_PREFIX)) {
                return statSyncStub;
            }
            return realStatSync.call(fs, p);
        });

        readFileSyncSpy = jest.spyOn(fs, 'readFileSync').mockImplementation(function (p, encoding) {
            if (typeof p === 'string' && p.startsWith(TEST_PATH_PREFIX)) {
                return readFileSyncStub;
            }
            return realReadFileSync.call(fs, p, encoding);
        });
    });

    afterEach(() => {
        writeFileSyncSpy.mockRestore();
        statSyncSpy.mockRestore();
        readFileSyncSpy.mockRestore();
    });

    test('Test 2 (error portal): emits [XML-ERROR] + admin email + throws when getProviders rejects', async () => {
        mockGetProviders.mockRejectedValueOnce(new Error('Portal HTTP 500'));
        await expect(buildProvidersXML(0)).rejects.toThrow('Portal HTTP 500');
        expect(mockLogGenerator).toHaveBeenCalledWith(
            'Providers_Downloader',
            'error',
            expect.stringMatching(/^\[XML-ERROR\] step=buildProvidersXML tenant=T1 path=n\/a reason=error err=Portal HTTP 500/)
        );
        expect(mockNodemailerSendMail).toHaveBeenCalledWith(
            expect.objectContaining({
                subject: '[SageConnect] XML proveedores: error en generación',
                html: expect.stringContaining('Portal HTTP 500'),
            })
        );
    });

    test('Test 3 (post-write validation fail — size 0): emits [XML-ERROR] tamaño insuficiente: 0 bytes + admin email + throws', async () => {
        mockGetProviders.mockResolvedValueOnce([
            {
                id: 'p1', external_id: 'ext1', name: 'Acme', rfc: 'RFC1', type: 'NACIONAL',
                tax_id: '', credit_days: 30,
                expedient: { fields: {}, addresses: {}, contacts: {}, bank_accounts: {}, approved: Date.now() },
            },
        ]);
        statSyncStub = { size: 0 };
        await expect(buildProvidersXML(0)).rejects.toThrow(/post-write validation failed/);
        expect(mockLogGenerator).toHaveBeenCalledWith(
            'Providers_Downloader',
            'error',
            expect.stringContaining('reason=invalid err=tamaño insuficiente: 0 bytes')
        );
        expect(mockNodemailerSendMail).toHaveBeenCalledWith(
            expect.objectContaining({
                subject: '[SageConnect] XML proveedores: post-write validation failed',
                html: expect.stringContaining('tamaño insuficiente: 0 bytes'),
            })
        );
    });

    test('Test 3.5 (writeFileSync rejection): emits [XML-ERROR] reason=invalid + admin email + throws', async () => {
        mockGetProviders.mockResolvedValueOnce([
            {
                id: 'p1', external_id: 'ext1', name: 'Acme', rfc: 'RFC1', type: 'NACIONAL',
                tax_id: '', credit_days: 30,
                expedient: { fields: {}, addresses: {}, contacts: {}, bank_accounts: {}, approved: Date.now() },
            },
        ]);
        writeFileSyncShouldThrow = new Error('ENOSPC: no space left');
        await expect(buildProvidersXML(0)).rejects.toThrow('ENOSPC: no space left');
        expect(mockLogGenerator).toHaveBeenCalledWith(
            'Providers_Downloader',
            'error',
            expect.stringContaining('reason=invalid err=writeFileSync error: ENOSPC: no space left')
        );
        expect(mockNodemailerSendMail).toHaveBeenCalledWith(
            expect.objectContaining({
                subject: '[SageConnect] XML proveedores: post-write validation failed',
                html: expect.stringContaining('writeFileSync error: ENOSPC: no space left'),
            })
        );
    });

    test('Test 4 (happy path BYTE-SHAPE regression guard): no admin email, no [XML-ERROR], XML output preserves structure', async () => {
        mockGetProviders.mockResolvedValueOnce([
            {
                id: 'p1', external_id: 'ext1', name: 'Acme', rfc: 'RFC1', type: 'NACIONAL',
                tax_id: '', credit_days: 30,
                expedient: { fields: {}, addresses: {}, contacts: {}, bank_accounts: {}, approved: Date.now() },
            },
        ]);
        statSyncStub = { size: 5000 };
        readFileSyncStub = '<?xml version="1.0" encoding="UTF-8"?>\n<Proveedores>\n  <Emisor Rfc="RFC"/>\n  <Proveedor external_id="ext1"/>\n</Proveedores>';
        await expect(buildProvidersXML(0)).resolves.toBeUndefined();
        expect(mockNodemailerSendMail).not.toHaveBeenCalled();
        const errorLogs = mockLogGenerator.mock.calls.filter((c) => c[1] === 'error');
        expect(errorLogs).toHaveLength(0);
        // BYTE-SHAPE assertion (per Truth 4): pin xml decl + Proveedores root + Emisor + Proveedor with external_id
        expect(writeFileSyncCalls).toHaveLength(1);
        const [writePath, writeData, writeEncoding] = writeFileSyncCalls[0];
        expect(writePath).toEqual(expect.stringContaining('/tmp/downloads/providers-'));
        expect(writeData).toMatch(/<\?xml version="1\.0" encoding="UTF-8"\?>[\s\S]*<Proveedores>[\s\S]*<Emisor[\s\S]*<Proveedor[\s\S]*external_id="ext1"/);
        expect(writeEncoding).toBe('utf8');
    });

    test('Test 5 (empty-legítimo regression guard): warn log + return without writing file or email', async () => {
        mockGetProviders.mockResolvedValueOnce([]);
        await expect(buildProvidersXML(0)).resolves.toBeUndefined();
        expect(writeFileSyncCalls).toHaveLength(0);
        expect(mockNodemailerSendMail).not.toHaveBeenCalled();
        expect(mockLogGenerator).toHaveBeenCalledWith(
            'Providers_Downloader',
            'warn',
            expect.stringContaining('No hay proveedores para procesar')
        );
    });
});
