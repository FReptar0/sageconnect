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

/**
 * Devuelve el fuente sin sus comentarios, para que las aserciones de paridad de
 * la Fase 23 no puedan pasar sobre código muerto (REQ-23-11).
 *
 * POR QUÉ EXISTE: esos casos hacían `expect(/regex/.test(src)).toBe(true)` sobre
 * el texto CRUDO del archivo. La revisión de código (WR-02 de
 * .planning/phases/23-boton-invoca-importador/23-REVIEW.md) demostró
 * experimentalmente que las 7 aserciones seguían pasando con el bloque del
 * importador COMPLETAMENTE comentado: un comentario conserva el texto y el regex
 * lo encuentra igual. Verificaban presencia de subcadenas, no que el código
 * estuviera vivo.
 *
 * Qué quita: los comentarios de varias líneas delimitados por barra-asterisco, y
 * las líneas cuyo primer carácter no en blanco es una doble barra. Una línea de
 * código con un comentario AL FINAL se conserva entera: lo que importa es que el
 * código esté vivo, no que no tenga comentarios.
 *
 * @param {string} src — contenido del archivo
 * @returns {string} el mismo fuente sin comentarios
 */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
}

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

        // -------------------------------------------------------------------
        // Fase 23 (D-08) — contraparte de los tres casos de arriba, para la RUTA MANUAL.
        //
        // POR QUÉ EXISTEN: el bloque del importador está duplicado A PROPÓSITO entre
        // src/services/CronScheduler.js y src/routes/schedule-routes.js (ver
        // .planning/phases/23-boton-invoca-importador/23-CONTEXT.md, D-01). No se extrajo
        // a un helper compartido porque los cuatro casos que afirman sobre el FUENTE de
        // CronScheduler.js —los de arriba y los de
        // tests/services/CronScheduler.timeout-listener.test.js:288-303— se romperían, y
        // REQ-23-06 prohíbe editar sus assertions. El contador de PATTERNS.md §S-6
        // (extraer en el 3.er uso) queda en 2 de 3.
        //
        // Estas aserciones son lo que convierte esa duplicación en una COPIA VERIFICADA
        // en vez de deuda que diverge en silencio: si alguien toca un lado y no el otro,
        // aquí truena. Mismo mecanismo (file content matching) que el repo ya usa para
        // fijar invariantes que cruzan archivos.
        // -------------------------------------------------------------------
        test('schedule-routes.js replica la detección del sentinel del cron (Fase 23 D-08)', () => {
            const fs = require('fs');
            // REQ-23-11: se evalua sobre el fuente SIN comentarios — comentar el bloque
            // tiene que hacer TRONAR estas aserciones (WR-02 de 23-REVIEW.md).
            const src = stripComments(fs.readFileSync('src/routes/schedule-routes.js', 'utf8'));
            // Mismo regex de detección que CronScheduler.js
            expect(/\/Child process timeout\//.test(src)).toBe(true);
            // Mismo asunto literal, sin sufijos ni variantes (D-05) — los filtros del admin siguen sirviendo
            expect(/\[SageConnect\] Child process timeout: ImportaFacturasFocaltec\.exe killed/.test(src)).toBe(true);
            // Mismo despacho vía sendAdminAlert (NOT EmailSender.sendMail) — D-15 + S-8
            expect(/sendAdminAlert\(subject/.test(src)).toBe(true);
        });

        test('schedule-routes.js loguea [TIMEOUT] action=admin-email-dispatched (ScheduleRoutes.log paridad, Fase 23 D-06)', () => {
            const fs = require('fs');
            // REQ-23-11: se evalua sobre el fuente SIN comentarios — comentar el bloque
            // tiene que hacer TRONAR estas aserciones (WR-02 de 23-REVIEW.md).
            const src = stripComments(fs.readFileSync('src/routes/schedule-routes.js', 'utf8'));
            // Multi-line template literal split — match [\s\S] across newlines/backticks
            expect(/\[TIMEOUT\] step=startChildProcess[\s\S]*?action=admin-email-dispatched/.test(src)).toBe(true);
        });

        test('schedule-routes.js instrumenta startStep/endStep del paso startChildProcess (Fase 23 D-04)', () => {
            const fs = require('fs');
            // REQ-23-11: se evalua sobre el fuente SIN comentarios — comentar el bloque
            // tiene que hacer TRONAR estas aserciones (WR-02 de 23-REVIEW.md).
            const src = stripComments(fs.readFileSync('src/routes/schedule-routes.js', 'utf8'));
            // Literal 'background-cycle' (la clave del LOCK), no la variable taskId — paridad byte a byte con el cron
            expect(/startStep\(\s*['"]background-cycle['"],\s*['"]startChildProcess['"]/.test(src)).toBe(true);
            expect(/endStep\(\s*['"]background-cycle['"],\s*['"]startChildProcess['"]/.test(src)).toBe(true);
            // El eslabón que cierra el hueco de la fase: la ruta manual invoca el importador
            expect(/await startChildProcess\(\)/.test(src)).toBe(true);
        });

        // -------------------------------------------------------------------
        // Fase 23 plan 23-04 (REQ-23-11) — prueba de que la mitigación MITIGA.
        // Un test que no puede fallar no prueba nada: así fue como WR-02 se coló.
        // -------------------------------------------------------------------
        test('las aserciones de paridad de la Fase 23 FALLAN si el bloque se comenta (REQ-23-11)', () => {
            const fs = require('fs');
            const raw = fs.readFileSync('src/routes/schedule-routes.js', 'utf8');

            // Los mismos 7 patrones que afirman los tres casos de arriba. Se repiten
            // aquí a propósito: este caso prueba la MITIGACIÓN, no el fuente. Quien
            // cambie un patrón allá arriba tiene que cambiarlo aquí.
            const PARIDAD_FASE_23 = [
                /\/Child process timeout\//,
                /\[SageConnect\] Child process timeout: ImportaFacturasFocaltec\.exe killed/,
                /sendAdminAlert\(subject/,
                /\[TIMEOUT\] step=startChildProcess[\s\S]*?action=admin-email-dispatched/,
                /startStep\(\s*['"]background-cycle['"],\s*['"]startChildProcess['"]/,
                /endStep\(\s*['"]background-cycle['"],\s*['"]startChildProcess['"]/,
                /await startChildProcess\(\)/,
            ];

            // 1. Sobre el fuente REAL (código vivo) los 7 casan.
            const vivo = stripComments(raw);
            for (const patron of PARIDAD_FASE_23) {
                expect(patron.test(vivo)).toBe(true);
            }

            // 2. Sobre una COPIA EN MEMORIA con el archivo comentado línea a línea
            //    —el escenario exacto que WR-02 demostró indetectable— ninguno casa.
            const comentado = raw.split('\n').map((linea) => `// ${linea}`).join('\n');
            for (const patron of PARIDAD_FASE_23) {
                expect(patron.test(stripComments(comentado))).toBe(false);
            }

            // 3. Y sin stripComments esa misma copia comentada seguiría pasando: ésa
            //    era exactamente la falla que REQ-23-11 cierra.
            for (const patron of PARIDAD_FASE_23) {
                expect(patron.test(comentado)).toBe(true);
            }
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

        test('background.js wraps each of the 7 steps with withStepTimeout (D-12 only steps, NOT child)', () => {
            const fs = require('fs');
            const src = fs.readFileSync('src/background.js', 'utf8');
            // 7 wraps in forResponse
            const wrapMatches = src.match(/await withStepTimeout\(/g);
            expect(wrapMatches).not.toBeNull();
            expect(wrapMatches.length).toBe(7);
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
