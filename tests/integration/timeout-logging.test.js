// tests/integration/timeout-logging.test.js (NEW — Phase 19 ROOT-04 integration)
//
// Verifies log routing per timeout source (D-14):
//   - ROOT-01 axios timeout → LOG_FILE del caller (e.g., 'PortalPaymentController') con [TIMEOUT] entry
//   - ROOT-02 child timeout → 'ChildProcess' log + 'CronScheduler' log + admin email (sendAdminAlert)
//   - ROOT-03 step timeout → 'ForResponse' log con [TIMEOUT] entry; NO email (D-15)
//
// Strategy: structural (file content regex matching) — high confidence sin depender de
// fixture stability. Coherente con `tests/services/CronScheduler.timeout-listener.test.js`
// Phase 19 extension (Task 5 del Plan 19-02) que también usa file content matching.

const { describe, test, expect, beforeEach } = require('@jest/globals');

// Shared mock for src/config (S-9) — needed for PortalClient require below
jest.mock('../../src/config', () => ({
    schedule: {
        cronExpression: '*/15 * * * *',
        operationDelayMs: 0,
        lockTimeoutMs: 14 * 60 * 1000,
        childProcessTimeoutMs: 1000,
        stepTimeoutMs: 1000,
    },
    portal: {
        url: 'http://test',
        tenants: [{ id: 'T1' }],
        httpTimeoutMs: 30000,
    },
    app: { importRoute: 'fake', arg: 'arg', timezone: 'America/Mexico_City', company: 'TestCo', rfc: '', regimen: '' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', password: '', notices: [], cc: [] },
    license: { adminEmail: 'admin@test.com' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs', downloads: '/tmp/dl', providers: '/tmp/p' },
    security: { apiKey: 'test-key' },
}));

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

describe('Timeout logging integration (Phase 19, ROOT-04)', () => {
    beforeEach(() => {
        mockLogGenerator.mockClear();
    });

    describe('ROOT-01: axios timeout → caller LOG_FILE with [TIMEOUT] entry', () => {
        test('PortalPaymentController catch enriches log when err.code is ECONNABORTED', () => {
            const fs = require('fs');
            const src = fs.readFileSync('src/controller/PortalPaymentController.js', 'utf8');

            // El catch debe diferenciar ECONNABORTED
            expect(/err\.code\s*===\s*['"]ECONNABORTED['"]/.test(src)).toBe(true);

            // El log entry timeout debe seguir el formato D-16
            expect(/\[TIMEOUT\] step=uploadPayments tenant=/.test(src)).toBe(true);
            expect(/url=/.test(src)).toBe(true);
            expect(/durationMs=/.test(src)).toBe(true);
        });

        test('PortalClient (Plan 19-01) sets default timeout that triggers ECONNABORTED', () => {
            // Smoke test: PortalClient.js exists and propagates timeout from config
            const portalClient = require('../../src/utils/PortalClient');
            expect(portalClient.defaults.timeout).toBe(30000);
        });

        test('PortalPaymentController preserves non-timeout fallback "Error POST payment"', () => {
            const fs = require('fs');
            const src = fs.readFileSync('src/controller/PortalPaymentController.js', 'utf8');
            // Backward-compat: existing log wording for non-timeout errors preserved
            expect(/Error POST payment:/.test(src)).toBe(true);
        });
    });

    describe('ROOT-02: child timeout → ChildProcess.log + CronScheduler.log + admin email', () => {
        test('background.js startChildProcess emits [TIMEOUT] to ChildProcess log on SIGTERM dispatch', () => {
            const fs = require('fs');
            const src = fs.readFileSync('src/background.js', 'utf8');
            // El log entry SIGTERM al ChildProcess log
            expect(/\[TIMEOUT\] step=startChildProcess tenant=global pid=/.test(src)).toBe(true);
            // logFileName en startChildProcess es 'ChildProcess'
            expect(/const logFileName = ['"]ChildProcess['"]/.test(src)).toBe(true);
            // action=SIGTERM presente
            expect(/action=SIGTERM/.test(src)).toBe(true);
        });

        test('CronScheduler.js dispatches sendAdminAlert with [SageConnect] Child process timeout subject', () => {
            const fs = require('fs');
            const src = fs.readFileSync('src/services/CronScheduler.js', 'utf8');
            // Subject literal Phase 19-02
            expect(/\[SageConnect\] Child process timeout: ImportaFacturasFocaltec\.exe killed/.test(src)).toBe(true);
            // Detection regex
            expect(/\/Child process timeout\//.test(src)).toBe(true);
            // Dispatch via sendAdminAlert (NOT EmailSender.sendMail) — D-15 + S-8
            expect(/sendAdminAlert\(subject/.test(src)).toBe(true);
        });

        test('CronScheduler.js logs [TIMEOUT] action=admin-email-dispatched (CronScheduler.log paridad)', () => {
            const fs = require('fs');
            const src = fs.readFileSync('src/services/CronScheduler.js', 'utf8');
            // Multi-line template literal split — match [\s\S] across newlines/backticks
            expect(/\[TIMEOUT\] step=startChildProcess[\s\S]*?action=admin-email-dispatched/.test(src)).toBe(true);
        });
    });

    describe('ROOT-03: step timeout → ForResponse log; NO email (D-15)', () => {
        test('background.js forResponse logs [TIMEOUT] step=<name> tenant=<id> url=n/a durationMs=<N>', () => {
            const fs = require('fs');
            const src = fs.readFileSync('src/background.js', 'utf8');
            // The log entry pattern in catch handler
            expect(/\[TIMEOUT\] step=\$\{__step\} tenant=\$\{tenantIds\[i\]\} url=n\/a/.test(src)).toBe(true);
            // El logFileName en forResponse es 'ForResponse'
            expect(/const logFileName = ['"]ForResponse['"]/.test(src)).toBe(true);
            // Detection regex
            expect(/\/Step timeout\//.test(src)).toBe(true);
        });

        test('background.js wraps each step with withStepTimeout (D-12 steps + EOM gate, NOT child)', () => {
            const fs = require('fs');
            const src = fs.readFileSync('src/background.js', 'utf8');
            // 7 tenant-loop step wraps + 1 EOM-gate wrap (Phase 20, 20-07 / CONTEXT D-11)
            // + 1 biweekly payment-report wrap (Phase 20.5, Q3-03 / Q3-04). Los tres honran
            // el tier de paso de la defensa en profundidad (CLAUDE.md §9). startChildProcess
            // NO está entre ellos — tiene su propio temporizador de 10 min.
            const wrapMatches = src.match(/await withStepTimeout\(/g);
            expect(wrapMatches).not.toBeNull();
            expect(wrapMatches.length).toBe(9);
            // The EOM dispatch step is wrapped per D-11.
            expect(/withStepTimeout\(\s*dispatchEomIfDue\(/.test(src)).toBe(true);
            expect(/__step = 'eomDispatch'/.test(src)).toBe(true);
            // El reporte quincenal está envuelto igual, y con su PROPIO nombre de paso: son
            // dominios de fallo independientes (Q3-04), así que una línea [TIMEOUT] nombra el
            // flujo que de verdad se atoró en vez de confundirlo con el cierre de mes.
            expect(/withStepTimeout\(\s*dispatchPaymentReportIfDue\(/.test(src)).toBe(true);
            expect(/__step = 'paymentReport'/.test(src)).toBe(true);
        });

        test('step timeout NO triggers sendAdminAlert (D-15 negation — step wording does NOT match child detection)', () => {
            // Step timeout wording: 'Step timeout after 5m — step=<name> tenant=<id>'
            const stepWording = 'Step timeout after 5m — step=buildProviders tenant=T1';
            // El regex de child timeout (en CronScheduler.js) NO debe matchear:
            expect(/Child process timeout/.test(stepWording)).toBe(false);
        });

        test('axios timeout NO triggers sendAdminAlert (D-15 negation — axios wording does NOT match child detection)', () => {
            const axiosWording = 'timeout of 30000ms exceeded';
            expect(/Child process timeout/.test(axiosWording)).toBe(false);
        });
    });

    describe('ROOT-04 cross-cutting: log prefix consistency', () => {
        test('all three timeout sources use [TIMEOUT] prefix (D-13 plain ASCII consistency)', () => {
            const fs = require('fs');
            const bgSrc = fs.readFileSync('src/background.js', 'utf8');
            const cronSrc = fs.readFileSync('src/services/CronScheduler.js', 'utf8');
            const ppSrc = fs.readFileSync('src/controller/PortalPaymentController.js', 'utf8');

            // Cada uno tiene al menos un [TIMEOUT] entry
            expect(/\[TIMEOUT\]/.test(bgSrc)).toBe(true);
            expect(/\[TIMEOUT\]/.test(cronSrc)).toBe(true);
            expect(/\[TIMEOUT\]/.test(ppSrc)).toBe(true);

            // No JSON estructurado (D-13)
            expect(/JSON\.stringify\([^)]*\[TIMEOUT\]/.test(bgSrc)).toBe(false);
        });

        test('mandatory keys per D-16: step + tenant + url + durationMs', () => {
            const fs = require('fs');
            const bgSrc = fs.readFileSync('src/background.js', 'utf8');
            // forResponse [TIMEOUT] entries are multi-line template literals — use [\s\S] across newlines.
            expect(/\[TIMEOUT\] step=[\s\S]*?tenant=[\s\S]*?url=[\s\S]*?durationMs=/.test(bgSrc)).toBe(true);
        });
    });
});
