const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * RETRY-E2 (fase 20.4) — guardas de PORTAL_PROBE_BUDGET_MS / PORTAL_PROBE_MAX_PER_TICK.
 *
 * Por que un proceso hijo real y no el harness de tests/config.test.js:
 * ese suite stubea process.exit con jest.spyOn(process, 'exit').mockImplementation(() => {}),
 * lo que convierte la guarda en un no-op y deja que config.js siga ejecutandose despues de ella.
 * Un CODIGO DE SALIDA no se puede probar asi. Los criterios de aceptacion del SPEC estan
 * escritos como codigos de salida (exit 0 / exit 1), de modo que este archivo lanza un proceso
 * de verdad y lee su status.
 *
 * Esto ES el `node -e "require('./src/config')"` del SPEC, ejecutado hermeticamente:
 * spawnSync recibe un ARRAY de argv, nunca una cadena de shell, asi que no hay shell de por
 * medio ni riesgo de comillas. Registrado explicitamente para que /gsd-verify-work lo lea como
 * una decision de implementacion documentada y no como una desviacion.
 *
 * Por que el hijo corre en un directorio temporal:
 * src/config.js llama dotenv.config() sin argumentos, que resuelve `.env` relativo al CWD del
 * proceso. Sin un CWD limpio, el .env real del desarrollador se filtraria en todos los casos y
 * el suite pasaria o fallaria segun la maquina. El temporal se crea en beforeAll y se borra en
 * afterAll — la disciplina always-on de CLAUDE.md §3 aplicada a la huella del propio test.
 *
 * Por que BASE_ENV se construye desde cero y NUNCA hace spread de process.env:
 * es lo que convierte la ausencia de PORTAL_PROBE_BUDGET_MS y PORTAL_PROBE_MAX_PER_TICK en una
 * propiedad garantizada del caso, en vez de un accidente de la maquina. Todos los placeholders
 * son obviamente sinteticos: ningun tenant, host, llave, secreto ni correo real (HANDOFF §1).
 */

const CONFIG_PATH = path.join(__dirname, '..', 'src', 'config.js');

// Requiere el config por la ruta absoluta que llega en argv[1] (bajo `node -e`, argv[1] es el
// primer argumento de usuario) y escribe los dos valores parseados en stdout. Los [CONFIG ERROR]
// y [CONFIG WARN] del modulo van a stderr, asi que stdout queda como JSON limpio.
const PROBE_SCRIPT = 'const c = require(process.argv[1]); process.stdout.write(JSON.stringify({ budget: c.portal.probeBudgetMs, cap: c.portal.probeMaxPerTick }));';

// Todas las variables del mapa REQUIRED de src/config.js, con placeholders sinteticos.
// Falta cualquiera => validate() sale con exit 1 y el caso mediria la guarda equivocada.
const BASE_ENV = {
    // database
    DB_USER: 'test',
    DB_PASSWORD: 'test',
    SERVER: 'localhost',
    DATABASE: 'TEST',
    // portal
    URL: 'http://test',
    TENANT_ID: 'T1',
    API_KEY: 'k1',
    API_SECRET: 's1',
    DATABASES: 'COPDAT',
    EXTERNAL_IDS: 'ext1',
    // paths
    DOWNLOADS_PATH: '/downloads',
    PROVIDERS_PATH: '/providers',
    LOG_PATH: '/logs',
    // app
    IMPORT_CFDIS_ROUTE: '/bin/import',
    ARG: 'ARG1',
    NOMBRE: 'Test Company',
    RFC: 'ABC123456DEF',
    REGIMEN: '601',
    TIMEZONE: 'America/Mexico_City',
    DEFAULT_ADDRESS_CITY: 'Ciudad',
    DEFAULT_ADDRESS_COUNTRY: 'Mexico',
    DEFAULT_ADDRESS_IDENTIFIER: 'ID1',
    DEFAULT_ADDRESS_MUNICIPALITY: 'Municipio',
    DEFAULT_ADDRESS_STATE: 'Estado',
    DEFAULT_ADDRESS_STREET: 'Calle 1',
    DEFAULT_ADDRESS_ZIP: '00000',
    ADDRESS_IDENTIFIERS_SKIP: 'LOC1,LOC2',
    // license
    LICENSE_API_URL: 'http://test',
    HMAC_SECRET: 'h1',
    // validate() solo comprueba presencia, nunca formato, asi que este placeholder NO tiene
    // forma de correo a proposito: el criterio de redaccion de HANDOFF §1 para este archivo es
    // que un regex generico de correo no encuentre nada. Un 'admin@…' sintetico igual lo
    // dispararia, y la guarda vale mas cuando no tiene excepciones.
    LICENSE_ADMIN_EMAIL: 'admin-placeholder',
    // PATH es necesario para que el hijo arranque.
    PATH: process.env.PATH,
};

// Windows necesita SystemRoot para que el proceso hijo arranque; en POSIX no existe.
if (process.env.SystemRoot !== undefined) {
    BASE_ENV.SystemRoot = process.env.SystemRoot;
}

let TMP_CWD;

beforeAll(() => {
    TMP_CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-cfg-'));
});

afterAll(() => {
    fs.rmSync(TMP_CWD, { recursive: true, force: true });
});

/**
 * Carga src/config.js en un proceso hijo real y devuelve su codigo de salida y sus streams.
 * Un override con valor `undefined` se BORRA del env combinado en vez de pasarse, para que un
 * caso pueda expresar "esta variable no esta puesta".
 */
function runConfig(overrides) {
    const env = { ...BASE_ENV, ...overrides };
    for (const key of Object.keys(env)) {
        if (env[key] === undefined) {
            delete env[key];
        }
    }

    const result = spawnSync(process.execPath, ['-e', PROBE_SCRIPT, CONFIG_PATH], {
        cwd: TMP_CWD,
        env,
        encoding: 'utf8',
    });

    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('RETRY-E2 — guardas de configuracion del tope de la sonda', () => {
    // -----------------------------------------------------------------------
    // Defaults
    // -----------------------------------------------------------------------

    test('SPEC casilla 7: sin ninguna de las dos vars, arranca con exit 0 en 120000 / 50', () => {
        const { status, stdout } = runConfig({});

        expect(status).toBe(0);
        // El codigo de salida por si solo no se acepta como prueba de los defaults: hay que ver
        // los valores que el modulo realmente expuso.
        expect(JSON.parse(stdout)).toEqual({ budget: 120000, cap: 50 });
    });

    test('D-11: cadena vacia cae al default (contrato de parseEnvNumber, no es "puesta a algo invalido")', () => {
        const { status, stdout } = runConfig({ PORTAL_PROBE_BUDGET_MS: '' });

        expect(status).toBe(0);
        expect(JSON.parse(stdout).budget).toBe(120000);
    });

    test('D-11: solo espacios en blanco tambien cae al default', () => {
        const { status, stdout } = runConfig({ PORTAL_PROBE_BUDGET_MS: '   ' });

        expect(status).toBe(0);
        expect(JSON.parse(stdout).budget).toBe(120000);
    });

    // -----------------------------------------------------------------------
    // Guardas de piso
    // -----------------------------------------------------------------------

    test('SPEC casilla 9: presupuesto bajo el piso de 10000 sale con exit 1', () => {
        const { status, stderr } = runConfig({ PORTAL_PROBE_BUDGET_MS: '5000' });

        expect(status).toBe(1);
        expect(stderr).toContain('[CONFIG ERROR]');
        expect(stderr).toContain('PORTAL_PROBE_BUDGET_MS');
    });

    test('SPEC casilla 10: tope de conteo en 0 sale con exit 1', () => {
        // Este es exactamente el caso que el idiom `parseInt(...) || default` se habria tragado:
        // '0' es falsy, habria caido al default 50 y nunca habria llegado a esta guarda.
        const { status, stderr } = runConfig({ PORTAL_PROBE_MAX_PER_TICK: '0' });

        expect(status).toBe(1);
        expect(stderr).toContain('[CONFIG ERROR]');
        expect(stderr).toContain('PORTAL_PROBE_MAX_PER_TICK');
    });

    // -----------------------------------------------------------------------
    // Guarda relacional
    // -----------------------------------------------------------------------

    test('SPEC casilla 8: 200000 contra STEP_TIMEOUT_MS=300000 sale con exit 1 nombrando AMBOS valores', () => {
        const { status, stderr } = runConfig({
            PORTAL_PROBE_BUDGET_MS: '200000',
            STEP_TIMEOUT_MS: '300000',
        });

        expect(status).toBe(1);
        expect(stderr).toContain('[CONFIG ERROR]');
        // Las dos aserciones van separadas a proposito: "nombra ambos valores" es el requisito,
        // y un mensaje que nombrara solo uno seguiria conteniendo [CONFIG ERROR].
        expect(stderr).toContain('200000');
        expect(stderr).toContain('300000');
    });

    test('control positivo: exactamente el 50% de STEP_TIMEOUT_MS se acepta (la comparacion es > y no >=)', () => {
        const { status, stdout } = runConfig({
            PORTAL_PROBE_BUDGET_MS: '150000',
            STEP_TIMEOUT_MS: '300000',
        });

        expect(status).toBe(0);
        expect(JSON.parse(stdout).budget).toBe(150000);
    });

    // -----------------------------------------------------------------------
    // Fail-open: el termino Number.isInteger de las dos guardas de piso
    // -----------------------------------------------------------------------

    test('presupuesto no numerico NO debe arrancar fail-open (Number.isInteger rechaza NaN)', () => {
        // parseInt('abc') es NaN. Sin el termino Number.isInteger en la guarda de piso, el
        // servicio arrancaria y toda comparacion `elapsed >= NaN` dentro de PortalOC_Creator
        // seria false para siempre, desactivando el tope en silencio. No es una de las 14
        // casillas del SPEC; existe porque esa regresion seria invisible.
        const { status, stderr } = runConfig({ PORTAL_PROBE_BUDGET_MS: 'abc' });

        expect(status).toBe(1);
        expect(stderr).toContain('PORTAL_PROBE_BUDGET_MS');
    });

    test('tope de conteo no numerico NO debe arrancar fail-open', () => {
        const { status, stderr } = runConfig({ PORTAL_PROBE_MAX_PER_TICK: 'abc' });

        expect(status).toBe(1);
        expect(stderr).toContain('PORTAL_PROBE_MAX_PER_TICK');
    });

    // -----------------------------------------------------------------------
    // El canal de correccion del operador
    // -----------------------------------------------------------------------

    test('un par valido no-default se acepta — el canal de correccion del operador funciona', () => {
        const { status, stdout } = runConfig({
            PORTAL_PROBE_BUDGET_MS: '60000',
            PORTAL_PROBE_MAX_PER_TICK: '10',
        });

        expect(status).toBe(0);
        expect(JSON.parse(stdout)).toEqual({ budget: 60000, cap: 10 });
    });

    // -----------------------------------------------------------------------
    // Orden de las guardas en el fuente (D-12)
    // -----------------------------------------------------------------------

    test('D-12: la guarda relacional va DESPUES del piso de STEP_TIMEOUT_MS y ANTES de RETRY_SCOPE', () => {
        // La guarda relacional lee config.schedule.stepTimeoutMs. Si algun dia sube por encima
        // del piso de ese mismo valor, compararia contra un valor ya conocido como invalido y
        // nombraria la variable equivocada en el error. El orden es correctitud, no estilo, y
        // esta asercion es lo que hace que un reordenamiento futuro falle en voz alta.
        const source = fs.readFileSync(CONFIG_PATH, 'utf8');

        const stepFloor = source.indexOf('STEP_TIMEOUT_MS must be >= 30000');
        const relational = source.indexOf('must be <= 50% of STEP_TIMEOUT_MS');
        const retryScope = source.indexOf('RETRY_SCOPE inválido');

        expect(stepFloor).toBeGreaterThan(-1);
        expect(relational).toBeGreaterThan(stepFloor);
        expect(retryScope).toBeGreaterThan(relational);
    });
});
