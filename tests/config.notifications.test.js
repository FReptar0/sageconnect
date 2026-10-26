const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Q3-04 / Q3-06 (fase 20.5) — guardas de config.notifications.
 *
 * Por que un proceso hijo real y no el harness de tests/config.test.js:
 * ese suite stubea process.exit con jest.spyOn(process, 'exit').mockImplementation(() => {}),
 * lo que convierte cada guarda en un pass-through y deja que config.js siga ejecutandose
 * despues de ella. Un CODIGO DE SALIDA no se puede medir ahi. Los criterios de aceptacion del
 * SPEC de esta fase estan escritos como codigos de salida (exit 0 / exit 1), asi que este
 * archivo lanza un proceso de verdad y lee su status. Ademas tests/config.test.js es uno de los
 * suites que ya fallan en la linea base de CLAUDE.md §6: no es modelo de nada.
 *
 * Esto ES el `node -e "require('./src/config')"` del SPEC, ejecutado hermeticamente:
 * spawnSync recibe un ARRAY de argv y jamas se le activa la opcion de shell, asi que ninguna
 * cadena de fixture ni del operador la interpreta un shell (T-20.5-05 del registro de amenazas).
 * La opcion se nombra aqui en prosa y no literalmente a proposito: el criterio de aceptacion de
 * este plan la busca con grep, y un grep que encuentre su propio comentario no guarda nada.
 *
 * Por que el hijo corre en un directorio temporal:
 * src/config.js llama dotenv.config() sin argumentos, que resuelve `.env` relativo al CWD del
 * proceso. Sin un CWD limpio, el .env real del desarrollador se filtraria en todos los casos y
 * el suite pasaria o fallaria segun la maquina. El temporal se crea en beforeAll y se borra en
 * afterAll — la disciplina always-on de CLAUDE.md §3 aplicada a la huella del propio test.
 *
 * Por que BASE_ENV se construye desde cero y NUNCA hace spread de process.env:
 * es lo que convierte la ausencia de las cinco vars nuevas en una propiedad garantizada de cada
 * caso, en vez de un accidente de la maquina. Todos los placeholders son obviamente sinteticos:
 * ningun tenant, host, llave, secreto ni correo real (HANDOFF §1, T-20.5-04).
 */

const CONFIG_PATH = path.join(__dirname, '..', 'src', 'config.js');
const SOURCE = fs.readFileSync(CONFIG_PATH, 'utf8');

// Requiere el config por la ruta absoluta que llega en argv[1] (bajo `node -e`, argv[1] es el
// primer argumento de usuario) y escribe los valores parseados en stdout. Los [CONFIG ERROR] y
// [CONFIG WARN] del modulo van a stderr, asi que stdout queda como JSON limpio.
// Incluye `eom` a proposito: asi el caso de D-09 se afirma desde el MISMO hijo que los demas.
const PROBE_SCRIPT = 'const c = require(process.argv[1]); process.stdout.write(JSON.stringify({ poAlert: c.notifications.poAlert, paymentReport: c.notifications.paymentReport, mailTimeoutMs: c.notifications.mailTimeoutMs, eom: c.eom }));';

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
    // que un regex generico de correo no encuentre nada.
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
    TMP_CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-notif-'));
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

describe('Q3-04 / Q3-06 — guardas de configuracion de las alertas diferenciadas', () => {
    // -----------------------------------------------------------------------
    // Defaults y supervivencia de config.eom
    // -----------------------------------------------------------------------

    test('SPEC casilla 11: sin ninguna de las cinco vars, arranca con exit 0 en los defaults documentados', () => {
        const { status, stdout } = runConfig({});

        expect(status).toBe(0);
        // El codigo de salida por si solo no se acepta como prueba de los defaults: hay que ver
        // los valores que el modulo realmente expuso.
        const parsed = JSON.parse(stdout);
        expect(parsed.poAlert).toEqual({ enabled: true });
        expect(parsed.paymentReport).toEqual({ enabled: true, hour: 18, lookbackDays: 365 });
        expect(parsed.mailTimeoutMs).toBe(30000);
    });

    test('D-09: el mismo arranque conserva config.eom con sus dos claves intactas', () => {
        const { status, stdout } = runConfig({});

        expect(status).toBe(0);
        // Se anadio al lado, no se renombro. Si alguien pliega eom dentro de notifications, este
        // caso se pone rojo antes de que Q3-05 se entere por otra via.
        expect(JSON.parse(stdout).eom).toEqual({ notificationHour: 18, notificationEnabled: true });
    });

    // -----------------------------------------------------------------------
    // Contrato de parseEnvNumber: vacio es "no puesta", no "puesta a algo invalido"
    // -----------------------------------------------------------------------

    test('parseEnvNumber: PAYMENT_REPORT_HOUR vacio cae al default 18 y arranca', () => {
        const { status, stdout } = runConfig({ PAYMENT_REPORT_HOUR: '' });

        expect(status).toBe(0);
        expect(JSON.parse(stdout).paymentReport.hour).toBe(18);
    });

    test('parseEnvNumber: PAYMENT_REPORT_HOUR solo con espacios cae al default 18 y arranca', () => {
        const { status, stdout } = runConfig({ PAYMENT_REPORT_HOUR: '   ' });

        expect(status).toBe(0);
        expect(JSON.parse(stdout).paymentReport.hour).toBe(18);
    });

    // -----------------------------------------------------------------------
    // G3 — PAYMENT_REPORT_HOUR en [0, 23]
    // -----------------------------------------------------------------------

    test('SPEC casilla 12: PAYMENT_REPORT_HOUR=24 sale con exit 1 y nombra la variable', () => {
        const { status, stderr } = runConfig({ PAYMENT_REPORT_HOUR: '24' });

        expect(status).toBe(1);
        expect(stderr).toContain('[CONFIG ERROR]');
        expect(stderr).toContain('PAYMENT_REPORT_HOUR');
    });

    test('control positivo del cero falsy: PAYMENT_REPORT_HOUR=0 arranca y reporta 0', () => {
        const { status, stdout } = runConfig({ PAYMENT_REPORT_HOUR: '0' });

        // Este es el caso que se pondria rojo si alguien reescribiera la clave como
        // `parseInt(...) || 18`: 0 es falsy y la medianoche se convertiria en las 18h en silencio.
        expect(status).toBe(0);
        expect(JSON.parse(stdout).paymentReport.hour).toBe(0);
    });

    test('control positivo del borde alto: PAYMENT_REPORT_HOUR=23 arranca y reporta 23', () => {
        const { status, stdout } = runConfig({ PAYMENT_REPORT_HOUR: '23' });

        expect(status).toBe(0);
        expect(JSON.parse(stdout).paymentReport.hour).toBe(23);
    });

    // -----------------------------------------------------------------------
    // G5 / G6 — MAIL_TIMEOUT_MS: piso y relacion con el step
    // -----------------------------------------------------------------------

    test('SPEC casilla 13a: MAIL_TIMEOUT_MS=500 sale con exit 1 y nombra la variable', () => {
        const { status, stderr } = runConfig({ MAIL_TIMEOUT_MS: '500' });

        expect(status).toBe(1);
        expect(stderr).toContain('[CONFIG ERROR]');
        expect(stderr).toContain('MAIL_TIMEOUT_MS');
    });

    test('SPEC casilla 13b: MAIL_TIMEOUT_MS=300000 con STEP_TIMEOUT_MS=300000 sale con exit 1 nombrando ambos', () => {
        const { status, stderr } = runConfig({ MAIL_TIMEOUT_MS: '300000', STEP_TIMEOUT_MS: '300000' });

        expect(status).toBe(1);
        expect(stderr).toContain('[CONFIG ERROR]');
        // El operador tiene que poder arreglarlo sin abrir el codigo: el mensaje nombra las dos
        // variables y el valor con el que chocaron.
        expect(stderr).toContain('MAIL_TIMEOUT_MS');
        expect(stderr).toContain('STEP_TIMEOUT_MS');
        expect(stderr).toContain('300000');
    });

    test('control de estrictez de G6: MAIL_TIMEOUT_MS=299999 con STEP_TIMEOUT_MS=300000 arranca', () => {
        const { status, stdout } = runConfig({ MAIL_TIMEOUT_MS: '299999', STEP_TIMEOUT_MS: '300000' });

        // Prueba que la comparacion rechaza en la igualdad y por encima, y NADA por debajo. Sin
        // este control, cambiar >= por > dejaria pasar el caso 13b sin poner rojo nada mas.
        expect(status).toBe(0);
        expect(JSON.parse(stdout).mailTimeoutMs).toBe(299999);
    });

    // -----------------------------------------------------------------------
    // Clase WR-09 — el prefijo entero que parseInt aceptaria en silencio
    // -----------------------------------------------------------------------

    test('WR-09: MAIL_TIMEOUT_MS=1e5 no arranca, en vez de arrancar en 1', () => {
        const { status, stderr } = runConfig({ MAIL_TIMEOUT_MS: '1e5' });

        // Bajo parseInt esto valdria 1. La afirmacion es que el proceso NO arranca, no que
        // arranque en 1: el operador escribio 100000 y tiene derecho a enterarse.
        expect(status).toBe(1);
        expect(stderr).toContain('MAIL_TIMEOUT_MS');
    });

    test('WR-09: PAYMENT_REPORT_LOOKBACK_DAYS=365abc no arranca, en vez de arrancar en 365', () => {
        const { status, stderr } = runConfig({ PAYMENT_REPORT_LOOKBACK_DAYS: '365abc' });

        // Este es el caso exacto que parseInt arrancaria en silencio en 365 — dentro de rango,
        // sin un solo mensaje. Es la razon por la que estas tres vars usan parseStrictInt.
        expect(status).toBe(1);
        expect(stderr).toContain('[CONFIG ERROR]');
        expect(stderr).toContain('PAYMENT_REPORT_LOOKBACK_DAYS');
    });

    // -----------------------------------------------------------------------
    // G4 — PAYMENT_REPORT_LOOKBACK_DAYS en [30, 3650]
    // -----------------------------------------------------------------------

    test('PAYMENT_REPORT_LOOKBACK_DAYS=29 sale con exit 1', () => {
        const { status, stderr } = runConfig({ PAYMENT_REPORT_LOOKBACK_DAYS: '29' });

        expect(status).toBe(1);
        expect(stderr).toContain('PAYMENT_REPORT_LOOKBACK_DAYS');
    });

    test('control positivo del borde bajo: PAYMENT_REPORT_LOOKBACK_DAYS=30 arranca y reporta 30', () => {
        const { status, stdout } = runConfig({ PAYMENT_REPORT_LOOKBACK_DAYS: '30' });

        expect(status).toBe(0);
        expect(JSON.parse(stdout).paymentReport.lookbackDays).toBe(30);
    });

    test('PAYMENT_REPORT_LOOKBACK_DAYS=3651 sale con exit 1', () => {
        const { status, stderr } = runConfig({ PAYMENT_REPORT_LOOKBACK_DAYS: '3651' });

        expect(status).toBe(1);
        expect(stderr).toContain('PAYMENT_REPORT_LOOKBACK_DAYS');
    });

    test('control positivo del borde alto: PAYMENT_REPORT_LOOKBACK_DAYS=3650 arranca y reporta 3650', () => {
        const { status, stdout } = runConfig({ PAYMENT_REPORT_LOOKBACK_DAYS: '3650' });

        expect(status).toBe(0);
        expect(JSON.parse(stdout).paymentReport.lookbackDays).toBe(3650);
    });

    // -----------------------------------------------------------------------
    // Q3-04 — las tres independencias, tres procesos distintos
    // -----------------------------------------------------------------------

    test('Q3-04: PO_ALERT_ENABLED=false apaga solo la alerta de OC', () => {
        const { status, stdout } = runConfig({ PO_ALERT_ENABLED: 'false' });

        expect(status).toBe(0);
        const parsed = JSON.parse(stdout);
        expect(parsed.poAlert.enabled).toBe(false);
        expect(parsed.paymentReport.enabled).toBe(true);
        expect(parsed.eom.notificationEnabled).toBe(true);
    });

    test('Q3-04: PAYMENT_REPORT_ENABLED=false apaga solo el reporte quincenal', () => {
        const { status, stdout } = runConfig({ PAYMENT_REPORT_ENABLED: 'false' });

        expect(status).toBe(0);
        const parsed = JSON.parse(stdout);
        expect(parsed.poAlert.enabled).toBe(true);
        expect(parsed.paymentReport.enabled).toBe(false);
        expect(parsed.eom.notificationEnabled).toBe(true);
    });

    test('Q3-04: EOM_NOTIFICATION_ENABLED=false sigue apagando solo el cierre de mes', () => {
        const { status, stdout } = runConfig({ EOM_NOTIFICATION_ENABLED: 'false' });

        // Esta es la mitad de Q3-04 que se puede probar a nivel de configuracion. La mitad de
        // despacho — que apagar uno no impide que los otros dos manden — se prueba en los planes
        // 04 y 05 de esta misma fase.
        expect(status).toBe(0);
        const parsed = JSON.parse(stdout);
        expect(parsed.poAlert.enabled).toBe(true);
        expect(parsed.paymentReport.enabled).toBe(true);
        expect(parsed.eom.notificationEnabled).toBe(false);
    });

    // -----------------------------------------------------------------------
    // El idiom booleano heredado, fijado para que nadie lo "arregle"
    // -----------------------------------------------------------------------

    test('idiom booleano: PO_ALERT_ENABLED=FALSE en mayusculas arranca y queda en false', () => {
        const { status, stdout } = runConfig({ PO_ALERT_ENABLED: 'FALSE' });

        expect(status).toBe(0);
        expect(JSON.parse(stdout).poAlert.enabled).toBe(false);
    });

    test('idiom booleano: PO_ALERT_ENABLED=no arranca y queda en false, no lanza', () => {
        const { status, stdout } = runConfig({ PO_ALERT_ENABLED: 'no' });

        // El idiom establecido es "cualquier cosa que no sea la cadena true, sin distinguir
        // mayusculas, es false". Se fija aqui para que nadie suponga luego que 'no' revienta.
        expect(status).toBe(0);
        expect(JSON.parse(stdout).poAlert.enabled).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Afirmaciones sobre la fuente: decisiones que ningun codigo de salida puede fijar
    // -----------------------------------------------------------------------

    test('D-10: ninguna de las cinco vars entra al mapa REQUIRED de validate()', () => {
        const start = SOURCE.indexOf('function validate');
        const end = SOURCE.indexOf('process.exit(1)', start);

        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);

        // OPTIONAL es lo que permite que el servidor nuevo de octubre arranque desde un .env
        // limpio: una var REQUIRED ausente sale con exit 1 antes de que el servicio exista.
        const requiredSlice = SOURCE.slice(start, end);
        for (const name of ['PO_ALERT_ENABLED', 'PAYMENT_REPORT_ENABLED', 'PAYMENT_REPORT_HOUR', 'PAYMENT_REPORT_LOOKBACK_DAYS', 'MAIL_TIMEOUT_MS']) {
            expect(requiredSlice).not.toContain(name);
        }
    });

    test('D-12: la guarda relacional va DESPUES de la guarda de piso de STEP_TIMEOUT_MS', () => {
        const relational = SOURCE.indexOf('mailTimeoutMs >= config.schedule.stepTimeoutMs');
        const floor = SOURCE.indexOf('STEP_TIMEOUT_MS must be >= 30000');

        expect(relational).toBeGreaterThan(-1);
        expect(floor).toBeGreaterThan(-1);
        // Una guarda relacional colocada por encima del piso del valor contra el que compara
        // leeria un numero sin validar y nombraria la variable equivocada en el error.
        expect(relational).toBeGreaterThan(floor);
    });

    test('D-09 estructural: config.eom sigue existiendo y no fue plegado dentro de notifications', () => {
        expect(SOURCE).toContain('eom: {');
        expect(SOURCE).toContain('config.eom.notificationHour');
        expect(SOURCE).toContain('config.eom.notificationEnabled');
        // Un refactor que pliegue eom dentro de notifications tiene que poner esto rojo.
        expect(SOURCE).not.toContain('notifications.notificationHour');
    });
});
