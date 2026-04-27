/**
 * HTML Key Injection Tests
 *
 * Verifies that the server-injected <meta name="x-app-key"> tag is added to
 * dashboard HTML pages so the dashboard JS can authenticate same-origin API
 * calls without operator intervention.
 */

const { describe, test, expect, beforeAll, afterAll, jest: jestObj } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Mock config to control the apiKey value per test suite
// ---------------------------------------------------------------------------
const KEY_VALUE = 'test-app-key-abc123';

jest.mock('../../src/config', () => ({
    portal: { url: 'http://test', tenants: [] },
    security: { apiKey: 'test-app-key-abc123' },
    database: { user: 'u', password: 'p', server: 's', database: 'd' },
    paths: { logs: '/tmp', downloads: '/tmp', providers: '/tmp' },
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 5000 },
    app: {
        timezone: 'America/Mexico_City',
        importRoute: '/test',
        arg: 'a', company: 'c', rfc: 'r', regimen: 'g',
        defaultAddress: { city: 'c', country: 'c', identifier: 'i', municipality: 'm', state: 's', street: 's', zip: 'z' },
        addressIdentifiersSkip: [],
    },
    mailing: {},
    license: { apiUrl: 'http://test', hmacSecret: 'h', adminEmail: 'a@a.com' },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('escapeAttr', () => {
    let escapeAttr;
    beforeAll(() => {
        ({ escapeAttr } = require('../../src/server'));
    });

    test('escapes ampersand, angle brackets, and double quotes', () => {
        expect(escapeAttr('a & b')).toBe('a &amp; b');
        expect(escapeAttr('a < b > c')).toBe('a &lt; b &gt; c');
        expect(escapeAttr('say "hi"')).toBe('say &quot;hi&quot;');
        expect(escapeAttr('all: & < > "')).toBe('all: &amp; &lt; &gt; &quot;');
    });

    test('coerces non-strings safely', () => {
        expect(escapeAttr(123)).toBe('123');
        expect(escapeAttr(null)).toBe('null');
    });
});

describe('serveHtmlWithKey', () => {
    let serveHtmlWithKey;
    let tmpDir;
    let originalCwd;

    beforeAll(() => {
        ({ serveHtmlWithKey } = require('../../src/server'));
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sageconnect-html-test-'));
        // serveHtmlWithKey reads from process.cwd() + '/public/' + relativePath
        // so we make tmpDir/public and chdir to tmpDir for the test duration
        fs.mkdirSync(path.join(tmpDir, 'public'));
        originalCwd = process.cwd();
        process.chdir(tmpDir);
    });

    afterAll(() => {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function makeRes() {
        const headers = {};
        let body;
        let status = 200;
        return {
            setHeader: (k, v) => { headers[k] = v; },
            status: (s) => { status = s; return { send: (b) => { body = b; } }; },
            send: (b) => { body = b; },
            get headers() { return headers; },
            get body() { return body; },
            get statusCode() { return status; },
        };
    }

    test('injects <meta name="x-app-key"> before </head> when key is configured', () => {
        const html = '<!DOCTYPE html><html><head><title>Test</title></head><body>x</body></html>';
        fs.writeFileSync(path.join(tmpDir, 'public', 'page1.html'), html);

        const handler = serveHtmlWithKey('page1.html');
        const res = makeRes();
        handler({}, res);

        expect(res.body).toContain(`<meta name="x-app-key" content="${KEY_VALUE}">`);
        expect(res.body.indexOf('<meta name="x-app-key"')).toBeLessThan(res.body.indexOf('</head>'));
        expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
    });

    test('preserves original HTML structure (no truncation, no double-injection)', () => {
        const html = '<html><head><title>X</title></head><body><div id="root">content</div></body></html>';
        fs.writeFileSync(path.join(tmpDir, 'public', 'page2.html'), html);

        const handler = serveHtmlWithKey('page2.html');
        const res = makeRes();
        handler({}, res);

        expect(res.body).toContain('<title>X</title>');
        expect(res.body).toContain('<div id="root">content</div>');
        // Exactly one meta tag
        const matches = res.body.match(/<meta name="x-app-key"/g);
        expect(matches).toHaveLength(1);
    });

    test('returns 500 when file does not exist', () => {
        const handler = serveHtmlWithKey('nonexistent.html');
        const res = makeRes();
        handler({}, res);

        expect(res.statusCode).toBe(500);
        expect(res.body).toMatch(/Failed to read page/);
    });
});
