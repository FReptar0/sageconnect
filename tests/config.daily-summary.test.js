const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * RD-12 / RD-01 (fase 20.7) — los cuatro interruptores de correo y la hora del resumen diario.
 *
 * Qué fija este archivo, todo por código de salida (D-09, D-29, D-30):
 *   - sin PO_ALERT_ENABLED, PAYMENT_REPORT_ENABLED, EOM_NOTIFICATION_ENABLED ni
 *     DAILY_SUMMARY_ENABLED, el arranque sale con exit 0 y los cuatro valen false: un servidor sin
 *     esas líneas del .env no manda ningún correo (RD-12);
 *   - cada interruptor se prende solo con 'true' (con trim y sin distinguir mayúsculas), y prender
 *     uno no prende los otros tres;
 *   - cualquier otro valor ('no', '1', 'yes', 'on') detiene el arranque con exit 1, [CONFIG ERROR]
 *     y el nombre de la variable, en vez de apagar el aviso en silencio (WR-04 de la 20.5);
 *   - DAILY_SUMMARY_TIME acepta solo HH:MM de 24 horas con dos dígitos (00:00..23:59), y cualquier
 *     otro formato sale con exit 1 en vez de caer a las 23:45 en silencio (RD-01, D-09).
 *
 * Por qué un proceso hijo real y no el harness de tests/config.test.js:
 * ese suite stubea process.exit con jest.spyOn(process, 'exit').mockImplementation(() => {}), lo
 * que convierte cada guarda en un pass-through y deja que config.js siga ejecutándose después de
 * ella. Un CÓDIGO DE SALIDA no se puede medir ahí, y los criterios de esta fase están escritos
 * como códigos de salida. El arnés es el de tests/config.notifications.test.js, copiado y no
 * importado: cada suite de subproceso se lee sola.
 *
 * Esto ES la revisión que .env.example le pide al operador antes de reiniciar el servicio,
 * ejecutada herméticamente: spawnSync recibe un ARRAY de argv y jamás se le activa la opción de
 * shell, así que ningún valor de fixture lo interpreta un shell. La opción se nombra aquí en
 * prosa y no literalmente a propósito, igual que en el suite del que se copió el arnés.
 *
 * Por qué el hijo corre en un directorio temporal:
 * src/config.js llama dotenv.config() sin argumentos, que resuelve `.env` relativo al CWD del
 * proceso. Sin un CWD limpio, el .env real del desarrollador se filtraría en todos los casos. Hay
 * DOS temporales: uno vacío para casi todos los casos y otro con un .env que escribe el propio
 * suite, para el caso que prueba la forma de las líneas del control de cambios (un comentario en
 * línea detrás del valor). Los dos se crean en beforeAll y se borran en afterAll — la disciplina
 * always-on de CLAUDE.md §3 aplicada a la huella del propio test.
 *
 * Por qué BASE_ENV se construye desde cero y NUNCA hace spread de process.env:
 * es lo que convierte la ausencia de los cuatro interruptores y de DAILY_SUMMARY_TIME en una
 * propiedad garantizada de cada caso, en vez de un accidente de la máquina. Todos los
 * placeholders son obviamente sintéticos: ningún tenant, host, llave, secreto ni correo real
 * (HANDOFF §1).
 */

const CONFIG_PATH = path.join(__dirname, '..', 'src', 'config.js');
const SOURCE = fs.readFileSync(CONFIG_PATH, 'utf8');

// Requiere el config por la ruta absoluta que llega en argv[1] (bajo `node -e`, argv[1] es el
// primer argumento de usuario) y escribe en stdout los cuatro bloques donde viven los
// interruptores. Los [CONFIG ERROR] y [CONFIG WARN] del módulo van a stderr, así que stdout queda
// como JSON limpio.
const PROBE_SCRIPT = 'const c = require(process.argv[1]); process.stdout.write(JSON.stringify({ poAlert: c.notifications.poAlert, paymentReport: c.notifications.paymentReport, dailySummary: c.notifications.dailySummary, eom: c.eom }));';

// Todas las variables del mapa REQUIRED de src/config.js, con placeholders sintéticos.
// Falta cualquiera => validate() sale con exit 1 y el caso mediría la guarda equivocada.
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
    // validate() solo comprueba presencia, nunca formato, así que este placeholder NO tiene
    // forma de correo a propósito: el criterio de redacción de HANDOFF §1 para este archivo es
    // que un regex genérico de correo no encuentre nada.
    LICENSE_ADMIN_EMAIL: 'admin-placeholder',
    // PATH es necesario para que el hijo arranque.
    PATH: process.env.PATH,
};

// Windows necesita SystemRoot para que el proceso hijo arranque; en POSIX no existe.
if (process.env.SystemRoot !== undefined) {
    BASE_ENV.SystemRoot = process.env.SystemRoot;
}

// Los cuatro interruptores de D-30 y dónde expone cada uno su valor el módulo. Tres viven en
// config.notifications y el del cierre de mes sigue en config.eom (D-09 de la 20.5).
const SWITCHES = [
    { name: 'PO_ALERT_ENABLED', read: (parsed) => parsed.poAlert.enabled },
    { name: 'PAYMENT_REPORT_ENABLED', read: (parsed) => parsed.paymentReport.enabled },
    { name: 'DAILY_SUMMARY_ENABLED', read: (parsed) => parsed.dailySummary.enabled },
    { name: 'EOM_NOTIFICATION_ENABLED', read: (parsed) => parsed.eom.notificationEnabled },
];

// El .env del caso del comentario en línea. Las dos líneas son load-bearing: si dotenv no leyera
// el archivo, DAILY_SUMMARY_ENABLED faltaría y valdría false; si no quitara el comentario,
// EOM_NOTIFICATION_ENABLED llegaría como 'false # comentario' y el arranque saldría con exit 1.
const DOTENV_LINES = [
    'EOM_NOTIFICATION_ENABLED=false # comentario',
    'DAILY_SUMMARY_ENABLED=true # comentario',
];

let TMP_CWD;
let DOTENV_CWD;

beforeAll(() => {
    TMP_CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-daily-'));
    DOTENV_CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-daily-env-'));
    fs.writeFileSync(path.join(DOTENV_CWD, '.env'), DOTENV_LINES.join('\n') + '\n');
});

afterAll(() => {
    for (const dir of [TMP_CWD, DOTENV_CWD]) {
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

/**
 * Carga src/config.js en un proceso hijo real con el CWD dado y devuelve su código de salida y
 * sus streams. Un override con valor `undefined` se BORRA del env combinado en vez de pasarse,
 * para que un caso pueda expresar "esta variable no está puesta".
 */
function runConfigIn(cwd, overrides) {
    const env = { ...BASE_ENV, ...overrides };
    for (const key of Object.keys(env)) {
        if (env[key] === undefined) {
            delete env[key];
        }
    }

    const result = spawnSync(process.execPath, ['-e', PROBE_SCRIPT, CONFIG_PATH], {
        cwd,
        env,
        encoding: 'utf8',
    });

    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** El caso común: el CWD vacío, sin ningún .env. */
function runConfig(overrides) {
    return runConfigIn(TMP_CWD, overrides);
}

describe('RD-12 / RD-01 — interruptores estrictos y hora del resumen diario', () => {
    // -----------------------------------------------------------------------
    // Defaults: sin ninguna línea, ningún aviso (RD-12)
    // -----------------------------------------------------------------------

    test('RD-12: sin los cuatro interruptores ni DAILY_SUMMARY_TIME arranca con exit 0 y los cuatro en false', () => {
        const { status, stdout } = runConfig({});

        expect(status).toBe(0);
        const parsed = JSON.parse(stdout);
        for (const { name, read } of SWITCHES) {
            expect({ name, value: read(parsed) }).toEqual({ name, value: false });
        }
        // La llave entera y no solo enabled: la hora por omisión es parte del default (D-09), y el
        // helper de la hora devuelve exactamente { hour, minute }, sin claves de más.
        expect(parsed.dailySummary).toEqual({ enabled: false, hour: 23, minute: 45 });
    });

    // -----------------------------------------------------------------------
    // Independencia: prender uno no prende los otros (D-30)
    // -----------------------------------------------------------------------

    for (const target of SWITCHES) {
        test(`D-30: ${target.name}=true prende solo ese interruptor; los otros tres siguen en false`, () => {
            const { status, stdout } = runConfig({ [target.name]: 'true' });

            expect(status).toBe(0);
            const parsed = JSON.parse(stdout);
            // El nombre viaja dentro de la aserción para que una falla diga cuál interruptor se
            // prendió de más o cuál no se prendió.
            for (const { name, read } of SWITCHES) {
                expect({ name, value: read(parsed) }).toEqual({ name, value: name === target.name });
            }
        });
    }

    // -----------------------------------------------------------------------
    // Formas aceptadas: trim y sin distinguir mayúsculas; vacío es "no puesta"
    // -----------------------------------------------------------------------

    // '' y '   ' valen false por el mismo contrato que parseEnvNumber: una línea `X=` en el .env es
    // una variable no puesta, no un valor inválido. ' true ' fija que el trim es parte del contrato.
    const ACCEPTED = [
        ['TRUE', true],
        ['False', false],
        [' true ', true],
        ['', false],
        ['   ', false],
    ];

    for (const { name, read } of SWITCHES) {
        for (const [raw, expected] of ACCEPTED) {
            test(`D-30: ${name}=${JSON.stringify(raw)} arranca y vale ${expected}`, () => {
                const { status, stdout } = runConfig({ [name]: raw });

                expect(status).toBe(0);
                expect(read(JSON.parse(stdout))).toBe(expected);
            });
        }
    }

    // -----------------------------------------------------------------------
    // Valores inválidos: exit 1, [CONFIG ERROR] y el nombre de la variable (WR-04)
    // -----------------------------------------------------------------------

    // Hasta la 20.7 todos estos arrancaban en silencio: lo que no fuera la cadena true valía false,
    // así que un error de dedo apagaba el aviso sin que nadie se enterara. Ahora el operador lo ve
    // en la revisión previa al reinicio, con el nombre de la variable que tiene que corregir.
    const INVALID = ['no', '1', 'yes', 'on'];

    for (const { name } of SWITCHES) {
        for (const raw of INVALID) {
            test(`D-30: ${name}=${JSON.stringify(raw)} sale con exit 1 y nombra la variable`, () => {
                const { status, stderr } = runConfig({ [name]: raw });

                expect(status).toBe(1);
                expect(stderr).toContain('[CONFIG ERROR]');
                expect(stderr).toContain(name);
            });
        }
    }

    // -----------------------------------------------------------------------
    // DAILY_SUMMARY_TIME: HH:MM de 24 horas con dos dígitos (D-09)
    // -----------------------------------------------------------------------

    // '00:00' es el control del cero falsy: una lectura escrita como `Number(x) || 23` convertiría
    // la medianoche en las 23 en silencio. '00:00' y '23:59' son los dos bordes del rango. '' y
    // '   ' son "no puesta" y caen a 23:45; ' 07:05 ' fija que el trim también es parte de este
    // contrato.
    const VALID_TIMES = [
        ['23:45', 23, 45],
        ['00:00', 0, 0],
        ['07:05', 7, 5],
        ['23:59', 23, 59],
        ['', 23, 45],
        ['   ', 23, 45],
        [' 07:05 ', 7, 5],
    ];

    for (const [raw, hour, minute] of VALID_TIMES) {
        test(`D-09: DAILY_SUMMARY_TIME=${JSON.stringify(raw)} arranca con hour=${hour} y minute=${minute}`, () => {
            const { status, stdout } = runConfig({ DAILY_SUMMARY_TIME: raw });

            expect(status).toBe(0);
            expect(JSON.parse(stdout).dailySummary).toEqual({ enabled: false, hour, minute });
        });
    }

    // Todos estos corren con DAILY_SUMMARY_ENABLED ausente, es decir, con el resumen apagado: la hora
    // se valida igual, así que un error de dedo aparece el día de la instalación y no el día en que
    // alguien prende el resumen. '7:05' es la hora de un dígito; '24:00' y '23:60' se salen del
    // rango; '2345' no lleva dos puntos; '23:45:00' trae segundos; '23:4' es un minuto de un dígito.
    const INVALID_TIMES = ['24:00', '23:60', '7:05', '2345', '23:45:00', 'abc', '23:4'];

    for (const raw of INVALID_TIMES) {
        test(`D-09: DAILY_SUMMARY_TIME=${JSON.stringify(raw)} sale con exit 1 y nombra la variable`, () => {
            const { status, stderr } = runConfig({ DAILY_SUMMARY_TIME: raw });

            expect(status).toBe(1);
            expect(stderr).toContain('[CONFIG ERROR]');
            expect(stderr).toContain('DAILY_SUMMARY_TIME');
        });
    }

    // -----------------------------------------------------------------------
    // Un .env real con comentario en línea (D-30)
    // -----------------------------------------------------------------------

    test('D-30: un .env con comentario en línea detrás de false y de true arranca con exit 0 y lee los dos valores', () => {
        const { status, stdout } = runConfigIn(DOTENV_CWD, {});

        // Es la forma de las líneas que ya lleva el .env desplegado: con la lectura estricta, un
        // comentario mal quitado detendría el arranque en producción.
        expect(status).toBe(0);
        const parsed = JSON.parse(stdout);
        expect(parsed.eom.notificationEnabled).toBe(false);
        expect(parsed.dailySummary.enabled).toBe(true);
        expect(parsed.poAlert.enabled).toBe(false);
        expect(parsed.paymentReport.enabled).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Afirmación sobre la fuente: opcionales, fuera de REQUIRED (D-29)
    // -----------------------------------------------------------------------

    test('D-29: ni DAILY_SUMMARY_ENABLED ni DAILY_SUMMARY_TIME entran al mapa REQUIRED ni a validate()', () => {
        // El tramo empieza en el mapa REQUIRED, que se define ANTES de function validate, y termina
        // en la primera salida de validate(). Cortar desde function validate dejaría el mapa fuera
        // y la aserción negativa no protegería nada.
        const start = SOURCE.indexOf('const REQUIRED = {');
        const validateAt = SOURCE.indexOf('function validate', start);
        const end = SOURCE.indexOf('process.exit(1)', validateAt);

        expect(start).toBeGreaterThan(-1);
        expect(validateAt).toBeGreaterThan(start);
        expect(end).toBeGreaterThan(validateAt);

        const requiredSlice = SOURCE.slice(start, end);
        // Control positivo: el tramo contiene la primera y la última variable del mapa, así que de
        // verdad lo cubre entero.
        expect(requiredSlice).toContain('DB_USER');
        expect(requiredSlice).toContain('LICENSE_ADMIN_EMAIL');
        for (const name of ['DAILY_SUMMARY_ENABLED', 'DAILY_SUMMARY_TIME']) {
            expect(requiredSlice).not.toContain(name);
        }
    });
});
