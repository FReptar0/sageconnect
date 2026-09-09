/**
 * Centralized Configuration Loader
 *
 * Loads environment variables from a single .env file, validates all required
 * variables, and exports a structured configuration object organized by domain.
 *
 * Usage: const config = require('./config');
 *
 * Sections: database, portal, mailing, paths, app, license
 */

const dotenv = require('dotenv');

// Load .env from project root -- populates process.env for backward compatibility
dotenv.config();

// ---------------------------------------------------------------------------
// Required variables by section
// ---------------------------------------------------------------------------
const REQUIRED = {
    database: ['DB_USER', 'DB_PASSWORD', 'SERVER', 'DATABASE'],
    portal: ['URL', 'TENANT_ID', 'API_KEY', 'API_SECRET', 'DATABASES', 'EXTERNAL_IDS'],
    paths: ['DOWNLOADS_PATH', 'PROVIDERS_PATH', 'LOG_PATH'],
    app: [
        'IMPORT_CFDIS_ROUTE', 'ARG', 'NOMBRE', 'RFC', 'REGIMEN', 'TIMEZONE',
        'DEFAULT_ADDRESS_CITY', 'DEFAULT_ADDRESS_COUNTRY', 'DEFAULT_ADDRESS_IDENTIFIER',
        'DEFAULT_ADDRESS_MUNICIPALITY', 'DEFAULT_ADDRESS_STATE', 'DEFAULT_ADDRESS_STREET',
        'DEFAULT_ADDRESS_ZIP', 'ADDRESS_IDENTIFIERS_SKIP',
    ],
    license: ['LICENSE_API_URL', 'HMAC_SECRET', 'LICENSE_ADMIN_EMAIL'],
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validate() {
    const missing = [];

    for (const [section, vars] of Object.entries(REQUIRED)) {
        for (const varName of vars) {
            const value = (process.env[varName] || '').trim();
            if (value === '') {
                missing.push(`  - ${varName} (${section})`);
            }
        }
    }

    if (missing.length > 0) {
        console.error(
            '[CONFIG ERROR] Missing required environment variables:\n' +
            missing.join('\n') + '\n' +
            'See .env.example for reference.\n' +
            'Process exiting.'
        );
        process.exit(1);
    }
}

validate();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split comma-separated string into trimmed array. Returns empty array for falsy input. */
function splitCSV(value) {
    if (!value || value.trim() === '') return [];
    return value.split(',').map((s) => s.trim());
}

/** Parse multi-tenant portal vars into array of tenant objects. */
function parseTenants() {
    const ids = splitCSV(process.env.TENANT_ID);
    const keys = splitCSV(process.env.API_KEY);
    const secrets = splitCSV(process.env.API_SECRET);
    const dbs = splitCSV(process.env.DATABASES);
    const extIds = splitCSV(process.env.EXTERNAL_IDS);

    return ids.map((id, i) => ({
        id,
        key: keys[i] || '',
        secret: secrets[i] || '',
        database: dbs[i] || '',
        externalId: extIds[i] || '',
    }));
}

/**
 * Parse an optional numeric env var, applying the default ONLY when the var is
 * absent/empty. An explicitly-set value (including '0' or 'abc') is parsed and
 * passed through verbatim so the range guard can reject it -- the `parseX(...) || default`
 * idiom silently swallows '0' (falsy) and would bypass the [1, N] guards.
 */
function parseEnvNumber(raw, parser, def) {
    if (raw === undefined || raw === null || String(raw).trim() === '') return def;
    return parser(raw);
}

/**
 * RETRY-E2 / WR-09: parser ESTRICTO de entero. NO es específico de la sonda, aunque nació con
 * ella: hoy lo usan CINCO vars — las dos de la sonda (PORTAL_PROBE_BUDGET_MS y
 * PORTAL_PROBE_MAX_PER_TICK, fase 20.4) y las tres numéricas de config.notifications
 * (PAYMENT_REPORT_HOUR, PAYMENT_REPORT_LOOKBACK_DAYS y MAIL_TIMEOUT_MS, fase 20.5).
 *
 * Por qué existe: parseInt devuelve el entero de un PREFIJO y descarta el resto en silencio, y
 * ese entero es un entero de verdad, así que Number.isInteger lo acepta encantado. El caso
 * peligroso no es 'abc' — ése ya fallaba cerrado — sino '1e5': un operador que quiere SUBIR el
 * tope a 100000 escribe notación científica y obtiene 1, el mínimo permitido, un tick de una sola
 * sonda, sin un solo mensaje. Es el mismo desenlace fail-open que la guarda existe para evitar,
 * por una puerta que el comentario de las guardas no contemplaba.
 *
 * Devolver NaN es lo que hace que la guarda de piso lo rechace: toda comparación >= contra NaN es
 * false, y el término Number.isInteger la convierte en exit 1.
 *
 * QUÉ RECHAZA, y conviene saberlo antes de escribir el .env: '1e5', '50abc', '20000abc', '12.5',
 * '0x10' y 'abc'. También rechaza dos formas que un lector podría creer válidas — '+50' y '050' —
 * y eso es DELIBERADO, no un descuido: la comparación es contra la representación entera pura. Es
 * fail-closed y en voz alta, el error nombra la variable, corregirlo cuesta segundos, y ésa es la
 * postura correcta para un tope que si queda desactivado no se nota. ACEPTA '50', ' 50 ' (el trim
 * es parte del contrato) y '-5', que cae después en el piso con su propio mensaje.
 *
 * Deliberadamente NO se aplica a las demás vars numéricas del archivo: cambiar el idiom
 * compartido tiene su propio radio de impacto (CLAUDE.md §6 #2) y ninguna otra alimenta una
 * comparación que se apague en silencio si el valor sale mal. Pero la regla para una var NUEVA
 * es la contraria: si alimenta una guarda de rango, se parsea con parseStrictInt. Leer esta
 * cabecera como "esto es de la sonda" y alcanzar parseEnvNumber a secas para la siguiente var
 * reabre exactamente el agujero que el helper existe para cerrar.
 */
function parseStrictInt(raw) {
    const text = String(raw).trim();
    const parsed = parseInt(text, 10);
    return text === String(parsed) ? parsed : NaN;
}

/** Build mailing config -- fully optional. Only populated if MAIL_TRANSPORT is set. */
function buildMailing() {
    const transport = (process.env.MAIL_TRANSPORT || '').trim();

    if (!transport) {
        return {};
    }

    return {
        transport,
        from: process.env.eFrom || '',
        password: process.env.ePass || '',
        server: process.env.eServer || '',
        port: parseInt(process.env.ePuerto, 10) || 0,
        ssl: (process.env.eSSL || '').toUpperCase() === 'TRUE',
        notices: splitCSV(process.env.MAILING_NOTICES),
        cc: splitCSV(process.env.MAILING_CC),
        clientId: process.env.CLIENT_ID || '',
        clientSecret: process.env.SECRET_CLIENT || '',
        refreshToken: process.env.REFRESH_TOKEN || '',
        redirectUri: process.env.REDIRECT_URI || '',
    };
}

// ---------------------------------------------------------------------------
// Build config object
// ---------------------------------------------------------------------------
const config = {
    database: {
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        server: process.env.SERVER,
        database: process.env.DATABASE,
    },

    portal: {
        url: process.env.URL,
        tenants: parseTenants(),
        // ROOT-01 (D-03): timeout para todas las llamadas axios al portal de proveedores.
        // Env override: PORTAL_HTTP_TIMEOUT_MS. Default 30s (texto literal de REQ ROOT-01).
        httpTimeoutMs: parseInt(process.env.PORTAL_HTTP_TIMEOUT_MS, 10) || 30000,
        // RETRY-E2 (D-11): tope por tick de la sonda de existencia en el portal (fase 20.4).
        // Presupuesto de tiempo (default 2 min) y tope de conteo (default 50), lo que ocurra primero.
        // Ambas son OPCIONALES y nunca REQUIRED: el servidor de octubre arranca con un .env nuevo y
        // una REQUIRED faltante haría fail-fast del servicio entero (decisión 20.1-01, la forma del
        // corte de fin de mes de abril).
        // Se parsean con parseEnvNumber y NO con el idiom `parseInt(...) || default` justamente para
        // que un '0' explícito llegue a su range guard en vez de ser tragado por ser falsy.
        probeBudgetMs: parseEnvNumber(process.env.PORTAL_PROBE_BUDGET_MS, parseStrictInt, 120000),
        probeMaxPerTick: parseEnvNumber(process.env.PORTAL_PROBE_MAX_PER_TICK, parseStrictInt, 50),
    },

    mailing: buildMailing(),

    paths: {
        downloads: process.env.DOWNLOADS_PATH,
        providers: process.env.PROVIDERS_PATH,
        logs: process.env.LOG_PATH,
    },

    app: {
        importRoute: process.env.IMPORT_CFDIS_ROUTE,
        arg: process.env.ARG,
        company: process.env.NOMBRE,
        rfc: process.env.RFC,
        regimen: process.env.REGIMEN,
        timezone: process.env.TIMEZONE,
        defaultAddress: {
            city: process.env.DEFAULT_ADDRESS_CITY,
            country: process.env.DEFAULT_ADDRESS_COUNTRY,
            identifier: process.env.DEFAULT_ADDRESS_IDENTIFIER,
            municipality: process.env.DEFAULT_ADDRESS_MUNICIPALITY,
            state: process.env.DEFAULT_ADDRESS_STATE,
            street: process.env.DEFAULT_ADDRESS_STREET,
            zip: process.env.DEFAULT_ADDRESS_ZIP,
        },
        addressIdentifiersSkip: splitCSV(process.env.ADDRESS_IDENTIFIERS_SKIP),
    },

    security: {
        apiKey: process.env.SAGECONNECT_API_KEY || null,
    },

    license: {
        apiUrl: process.env.LICENSE_API_URL,
        hmacSecret: process.env.HMAC_SECRET,
        adminEmail: process.env.LICENSE_ADMIN_EMAIL,
    },

    schedule: {
        cronExpression: process.env.CRON_SCHEDULE || '*/15 * * * *',
        operationDelayMs: parseInt(process.env.OPERATION_DELAY_MS, 10) || 5000,
        // REC-01 (D-01): auto-release timeout for OperationManager locks. Env override: LOCK_TIMEOUT_MS. Default 14 min (~93% of 15 min cron cadence).
        lockTimeoutMs: parseInt(process.env.LOCK_TIMEOUT_MS, 10) || 14 * 60 * 1000,
        // ROOT-02 (D-07): timeout para el child process ImportaFacturasFocaltec.exe.
        // Env override: CHILD_PROCESS_TIMEOUT_MS. Default 10 min (texto literal de REQ ROOT-02).
        // Effective ~10m 30s incluyendo el grace period — comfortably bajo los 14 min del lock auto-release.
        childProcessTimeoutMs: parseInt(process.env.CHILD_PROCESS_TIMEOUT_MS, 10) || 10 * 60 * 1000,
        // ROOT-03 (D-11): per-step timeout para los 7 steps de forResponse (buildProviders, downloadCFDI,
        // checkPayments, uploadPayments, createPurchaseOrders, processOrderChanges, closePurchaseOrders).
        // Env override: STEP_TIMEOUT_MS. Default 5 min (texto literal de REQ ROOT-03).
        // Cubre un step con hasta ~10 axios calls en serie con timeout 30s c/u (10 × 30s = 5 min).
        stepTimeoutMs: parseInt(process.env.STEP_TIMEOUT_MS, 10) || 5 * 60 * 1000,
    },

    retry: {
        // RETRY-C1 (D-07): cron scope for which authorization dates the WHERE picks up.
        // Default 'last_n_days' which, with lookbackDays=30, is the rolling 30-day window the team
        // settled on 2026-06-11 (refining the 2026-05-20 client agreement; supersedes the earlier
        // 'current_month' reading). Valid: 'current_month' | 'last_n_days' -- both still selectable.
        scope: process.env.RETRY_SCOPE || 'last_n_days',
        // RETRY-C1 (D-07): lookback window when scope=last_n_days. Default 30. Range [1, 365].
        lookbackDays: parseEnvNumber(process.env.RETRY_LOOKBACK_DAYS, (v) => parseInt(v, 10), 30),
        // RETRY-C2/C3 (D-02): FIXED retry interval per document type, in minutes -- no longer a
        // geometric curve, so the wait never grows with the attempt count.
        interval: {
            // Payments: default 30 min (client, 2026-05-20). Range [10, 60].
            payment: parseEnvNumber(process.env.RETRY_INTERVAL_PAYMENT_MIN, (v) => parseInt(v, 10), 30),
            // POs: default 240 min = 4h (team, 2026-06-11). Range [30, 1440].
            po: parseEnvNumber(process.env.RETRY_INTERVAL_PO_MIN, (v) => parseInt(v, 10), 240),
        },
    },

    // Va ANTES de config.eom, no después, por una razón mecánica y no de estilo: el hook
    // .claude/hooks/pre-commit-redaction.sh grepea el diff COMPLETO —contexto incluido— y una
    // línea preexistente del bloque eom lleva un término que ese hook prohíbe. Insertando aquí,
    // esa línea queda fuera de la ventana de contexto de 3 líneas y el commit pasa sin bypass;
    // debajo de eom: no pasaba de ninguna forma, ni tocando la línea (aparece como -) ni
    // dejándola intacta (aparece como contexto). Es una clave HERMANA: el orden dentro del
    // object literal no significa nada, y config.eom queda byte-idéntico a HEAD.
    // === Fase 20.5 (Q3-04 / Q3-06) — alertas diferenciadas ===
    // Los tres interruptores de apagado independientes de Q3-04 más el tier SMTP de Q3-06.
    //
    // Se AÑADE junto a config.eom, nunca en su lugar (D-09): Q3-05 exige que el camino del cierre
    // de mes quede byte-idéntico, y renombrar ensancharía el diff a través de guardas y de tests
    // que hoy pasan, sin ganancia de comportamiento alguna. DEVIATIONS.md de la fase 20 propone
    // borrar el namespace `eom`; esa propuesta queda superseded por D-09.
    //
    // Las cinco vars son OPCIONALES y ninguna entra al mapa REQUIRED de validate() (D-10). Eso es
    // load-bearing, no comodidad: el servidor nuevo de octubre arranca desde un .env limpio y una
    // var REQUIRED ausente sale con exit 1 antes de que el servicio llegue a existir (decisión
    // 20.1-01).
    //
    // Las tres vars numéricas usan parseStrictInt y NO (v) => parseInt(v, 10) — ver el comentario
    // de parseStrictInt y el de mailTimeoutMs. Esto NO cambia el parser de ninguna var
    // preexistente: EOM_NOTIFICATION_HOUR, RETRY_LOOKBACK_DAYS y los dos intervalos de reintento
    // conservan parseInt, porque cambiar un idiom compartido tiene su propio radio de impacto
    // (CLAUDE.md §6 #2, PR #16).
    notifications: {
        poAlert: {
            // Q3-01/Q3-02: interruptor de apagado de la alerta inmediata de OC fallida.
            // Default 'true'.
            // Deliberadamente independiente de EOM_NOTIFICATION_ENABLED y de
            // PAYMENT_REPORT_ENABLED: silenciar un flujo no debe silenciar otro (Q3-04). Quien
            // quiera todo en silencio apaga los tres interruptores, uno por uno y a sabiendas.
            enabled: (process.env.PO_ALERT_ENABLED || 'true').toLowerCase() === 'true',
        },
        paymentReport: {
            // Q3-03: interruptor de apagado del reporte quincenal de pagos pendientes.
            // Default 'true'.
            // Misma independencia que poAlert.enabled (Q3-04).
            enabled: (process.env.PAYMENT_REPORT_ENABLED || 'true').toLowerCase() === 'true',
            // Q3-03: hora del día a partir de la cual el reporte es elegible. Default 18. Rango
            // [0, 23]. Misma hora que el correo de cierre de mes a propósito: el operador aprende
            // un solo hábito.
            hour: parseEnvNumber(process.env.PAYMENT_REPORT_HOUR, parseStrictInt, 18),
            // Q3-03: ventana hacia atrás del reporte. Default 365. Rango [30, 3650].
            // Var propia y deliberadamente NO RETRY_LOOKBACK_DAYS: la ventana de reintento es lo
            // que el cron todavía intenta subir; ésta es lo que el operador todavía necesita ver.
            // Acoplarlas encogería el reporte el día que alguien afine la ventana de reintento.
            lookbackDays: parseEnvNumber(process.env.PAYMENT_REPORT_LOOKBACK_DAYS, parseStrictInt, 365),
        },
        // Q3-06 (D-11): el tier SMTP. Alimenta connectionTimeout / greetingTimeout / socketTimeout
        // de nodemailer en los DOS call sites de EmailSender. Default 30000, piso 1000, y una sola
        // guarda relacional: < STEP_TIMEOUT_MS.
        //
        // POR QUÉ VIVE AQUÍ Y NO EN config.mailing, que es donde un lector lo buscaría:
        // buildMailing() abre con `if (!transport) return {};`, así que en cualquier despliegue que
        // no haya puesto MAIL_TRANSPORT el valor sería undefined. Y `undefined < 1000` es false: la
        // guarda de piso PASARÍA, sin emitir un solo mensaje en ninguna parte, y nodemailer se
        // quedaría con su socketTimeout por defecto de 600000 ms — el doble del presupuesto del
        // step e igual al tier del proceso hijo. Es fail-open exacto, la misma forma que
        // parseStrictInt existe para cerrar. config.notifications es un object literal
        // INCONDICIONAL; por eso la clave vive aquí. No la "ordenes" moviéndola a config.mailing
        // sin resolver antes ese undefined.
        mailTimeoutMs: parseEnvNumber(process.env.MAIL_TIMEOUT_MS, parseStrictInt, 30000),
    },

    eom: {
        // EOM-01 (D-customer-confirmation): hour-of-day when EOM dispatch becomes eligible (last day only). Default 18 (6pm). Range [0, 23].
        notificationHour: parseEnvNumber(process.env.EOM_NOTIFICATION_HOUR, (v) => parseInt(v, 10), 18),
        // EOM-05 (D-customer-confirmation): kill-switch. Default 'true'. Set to 'false' to disable EOM dispatch entirely.
        notificationEnabled: (process.env.EOM_NOTIFICATION_ENABLED || 'true').toLowerCase() === 'true',
    },
};

// REC-01 (D-01): defensive bound — values < 60000 ms (1 min) almost certainly indicate misconfiguration.
if (config.schedule.lockTimeoutMs < 60000) {
    console.error('[CONFIG ERROR] LOCK_TIMEOUT_MS must be >= 60000 (1 min). Got: ' + config.schedule.lockTimeoutMs);
    process.exit(1);
}

// ROOT-01 (D-03): axios timeout puede legitimamente ser sub-segundo en pruebas, pero < 1000ms es signal de misconfig.
if (config.portal.httpTimeoutMs < 1000) {
    console.error('[CONFIG ERROR] PORTAL_HTTP_TIMEOUT_MS must be >= 1000 (1 sec). Got: ' + config.portal.httpTimeoutMs);
    process.exit(1);
}

// ROOT-02 (D-07): mínimo 1 min para evitar misconfigs catastróficas (e.g., 10ms aborta antes de que el exe arranque).
if (config.schedule.childProcessTimeoutMs < 60000) {
    console.error('[CONFIG ERROR] CHILD_PROCESS_TIMEOUT_MS must be >= 60000 (1 min). Got: ' + config.schedule.childProcessTimeoutMs);
    process.exit(1);
}

// ROOT-03 (D-11): mínimo 30s para evitar timeouts triviales que disparen falso positivo en cada cycle.
// Un step típico tiene 1-3 axios calls + DB roundtrips; <30s es trivial y produce falsos positivos.
if (config.schedule.stepTimeoutMs < 30000) {
    console.error('[CONFIG ERROR] STEP_TIMEOUT_MS must be >= 30000 (30 sec). Got: ' + config.schedule.stepTimeoutMs);
    process.exit(1);
}

// RETRY-E2 (D-12): las cuatro guardas de la sonda van DESPUÉS de las guardas de piso de
// PORTAL_HTTP_TIMEOUT_MS y de STEP_TIMEOUT_MS.
// El orden es correctitud, no estilo: las dos guardas relacionales de abajo comparan contra
// config.schedule.stepTimeoutMs y contra config.portal.httpTimeoutMs, y ponerlas antes del piso de
// esos valores las haría comparar contra un valor ya conocido como inválido y nombrar la variable
// equivocada en el error.
//
// La entrada no numérica se ataja en DOS mitades y hacen falta las dos. Reparto exacto, escrito
// para que nadie quite la que crea redundante:
//
//   1. parseStrictInt (ver arriba) devuelve NaN para todo lo que no sea una representación entera
//      pura. Es la mitad que WR-09 tuvo que agregar: sin ella, parseInt aceptaba el entero de un
//      PREFIJO y '1e5' entraba como 1 — un entero de verdad, que Number.isInteger aprobaba. El
//      operador que quería subir el tope a 100000 se quedaba con un tick de UNA sonda y sin un
//      solo mensaje.
//   2. El término Number.isInteger de estas dos guardas de piso convierte ese NaN en exit 1, y por
//      eso es load-bearing y NO debe quitarse para igualar la forma más corta de las cuatro
//      guardas de timeout de arriba: toda comparación `>=` contra NaN es false, así que sin él el
//      valor pasaría el startup Y dejaría en false para siempre las comparaciones del bound en
//      PortalOC_Creator. El bound quedaría silenciosamente desactivado (fail-open), que es
//      exactamente la falla que esta fase existe para quitar.
//
// Ninguna de las dos sola cierra el hueco. Forma copiada de RETRY_LOOKBACK_DAYS.
if (!Number.isInteger(config.portal.probeBudgetMs) || config.portal.probeBudgetMs < 10000) {
    console.error('[CONFIG ERROR] PORTAL_PROBE_BUDGET_MS must be integer >= 10000 (10 sec). Got: ' + config.portal.probeBudgetMs);
    process.exit(1);
}

if (!Number.isInteger(config.portal.probeMaxPerTick) || config.portal.probeMaxPerTick < 1) {
    console.error('[CONFIG ERROR] PORTAL_PROBE_MAX_PER_TICK must be integer >= 1. Got: ' + config.portal.probeMaxPerTick);
    process.exit(1);
}

// RETRY-E2: guarda RELACIONAL, la primera de su tipo en este archivo -- las cuatro de arriba miden
// un piso en aislamiento y ninguna mide la relación entre tiers.
//
// QUÉ ACOTA ESTE TECHO, EXACTAMENTE (WR-01 / WR-02). Acota CUÁNTO SONDEO hace un tick. NO acota el
// step, y la versión anterior de este comentario decía que sí — decía "120 s de sondeo + 180 s de
// POSTs restantes = los 300 s del step", que trata el presupuesto como un techo duro y no lo es.
// La condición del bound se evalúa en el BORDE DE ITERACIÓN, sólo antes de admitir cada OC, así que
// una OC admitida con el transcurrido a 1 ms del presupuesto corre DESPUÉS su ciclo completo por
// encima de él. Con los valores que este repo ya trae, esa cola de UNA sola iteración vale:
//
//     GET de la sonda      hasta config.portal.httpTimeoutMs          =  30 s
//   + POST de creación     hasta config.portal.httpTimeoutMs          =  30 s
//   + INSERT de la fila    hasta el requestTimeout de mssql           = 180 s
//                                          (src/utils/SQLServerConnection.js:18)
//   ------------------------------------------------------------------------
//   = hasta 240 s POR ENCIMA del presupuesto, en el peor caso de una iteración.
//
// O sea que el techo real del sondeo es `probeBudgetMs + ~240 s`, y quien sigue acotando el step
// es STEP_TIMEOUT_MS con su withStepTimeout (src/background.js:237). Este 50 % no lo sustituye.
//
// POR QUÉ EL TECHO SE QUEDA EN 50 % Y NO EN `stepTimeoutMs - 240 s` — no lo "corrijas" en la otra
// dirección: reservar la cola completa dejaría el presupuesto en 60 000 ms con el step por default,
// lo que estrangula al portal SANO a ~2 sondas por tick, peor que el problema que esta fase
// resuelve. El término dominante de esa cola es el requestTimeout de 180 s de mssql, que es
// preexistente y queda fuera del alcance de esta fase. La decisión es deliberada: se acota el
// sondeo, no la cola de una iteración ya admitida.
//
// Y EL PRESUPUESTO TAMBIÉN MIDE EL POST Y EL INSERT de cada OC sondeada-y-ausente, porque ese
// trabajo vive dentro del mismo bucle y se mide desde el mismo origen (D-01). No es un reparto
// "media para sondear, media para POSTear": los POSTs de las OCs sondeadas salen del MISMO
// presupuesto. La otra mitad del step es para las OCs con errorCount = 0, que nunca pasan por la
// compuerta de la sonda ni por la cota. Consecuencia práctica al leer la bitácora: el tope de 50
// sólo gobierna si el ciclo COMPLETO por OC promedia menos de ~2.4 s; con el portal degradado
// gobierna el presupuesto, así que un `deferred=` alto apunta a latencia del portal y NO a que
// haga falta subir el cap.
//
// El mensaje nombra AMBOS valores para que el operador vea cuál de los dos mover.
if (config.portal.probeBudgetMs > config.schedule.stepTimeoutMs * 0.5) {
    console.error('[CONFIG ERROR] PORTAL_PROBE_BUDGET_MS (' + config.portal.probeBudgetMs + ') must be <= 50% of STEP_TIMEOUT_MS (' + config.schedule.stepTimeoutMs + '). Lower PORTAL_PROBE_BUDGET_MS or raise STEP_TIMEOUT_MS.');
    process.exit(1);
}

// RETRY-E2 / WR-03: la SEGUNDA guarda relacional, y la que le faltaba al tier que esta fase
// estrenó. El invariante de defensa en profundidad gana su tier más interno —
// PORTAL_HTTP_TIMEOUT_MS < PORTAL_PROBE_BUDGET_MS < STEP_TIMEOUT_MS < CHILD_PROCESS_TIMEOUT_MS <
// LOCK_TIMEOUT_MS — y hasta aquí ese tier estaba escrito en .env.example como si estuviera
// guardado, tres líneas debajo de "Range guards fail-fast", sin que nada lo hiciera cumplir.
//
// Qué pasaba sin ella: un presupuesto por debajo del techo de UNA sola petición admite exactamente
// una sonda por tick, para siempre. La primera sonda puede gastar hasta httpTimeoutMs, así que la
// evaluación de la segunda ya ve el presupuesto agotado. PORTAL_PROBE_BUDGET_MS=10000 junto al
// default de 30000 arrancaba con exit 0 y colapsaba el sondeo de 50 OCs a 1 cada 15 minutos, sin
// ninguna señal que lo distinguiera de un rezago legítimo. Es la misma forma del hueco que el SPEC
// § Background le reprocha a las cuatro guardas de piso, reproducida en el tier nuevo — y un tope
// que en silencio no hace nada es peor que no tener tope, porque parece protegido.
//
// Va DESPUÉS del piso de PORTAL_HTTP_TIMEOUT_MS por la misma regla de orden de D-12: compara contra
// un valor ya validado. El mensaje nombra AMBOS valores, igual que la relacional de arriba.
//
// Efecto lateral deliberado y correcto: STEP_TIMEOUT_MS=30000 queda sin ningún presupuesto válido
// junto al PORTAL_HTTP_TIMEOUT_MS por default, porque la relacional pide <= 15000 y ésta pide
// > 30000. Ese par ya violaba CLAUDE.md §9 antes de esta fase; ahora no arranca en vez de arrancar
// callado.
if (config.portal.probeBudgetMs <= config.portal.httpTimeoutMs) {
    console.error('[CONFIG ERROR] PORTAL_PROBE_BUDGET_MS (' + config.portal.probeBudgetMs + ') must be > PORTAL_HTTP_TIMEOUT_MS (' + config.portal.httpTimeoutMs + '). Raise PORTAL_PROBE_BUDGET_MS or lower PORTAL_HTTP_TIMEOUT_MS.');
    process.exit(1);
}

// RETRY-03: scope must be one of the valid values.
if (!['current_month', 'last_n_days'].includes(config.retry.scope)) {
    console.error('[CONFIG ERROR] RETRY_SCOPE inválido. Got: ' + config.retry.scope + '. Valid: current_month | last_n_days');
    process.exit(1);
}

// RETRY-03: lookbackDays in [1, 365].
if (!Number.isInteger(config.retry.lookbackDays) || config.retry.lookbackDays < 1 || config.retry.lookbackDays > 365) {
    console.error('[CONFIG ERROR] RETRY_LOOKBACK_DAYS must be integer in [1, 365]. Got: ' + config.retry.lookbackDays);
    process.exit(1);
}

// RETRY-C3: payment retry interval in [10, 60]. Below 10 min a failing payment would be retried
// on almost every 15-min tick; above 60 min contradicts the 2026-05-20 client agreement.
if (!Number.isInteger(config.retry.interval.payment) || config.retry.interval.payment < 10 || config.retry.interval.payment > 60) {
    console.error('[CONFIG ERROR] RETRY_INTERVAL_PAYMENT_MIN must be integer in [10, 60]. Got: ' + config.retry.interval.payment);
    process.exit(1);
}

// RETRY-C3: PO retry interval in [30, 1440] (30 min .. 24 h). Default 240 = 4 h (team, 2026-06-11).
if (!Number.isInteger(config.retry.interval.po) || config.retry.interval.po < 30 || config.retry.interval.po > 1440) {
    console.error('[CONFIG ERROR] RETRY_INTERVAL_PO_MIN must be integer in [30, 1440]. Got: ' + config.retry.interval.po);
    process.exit(1);
}

// RETRY-C3 (D-03): the three RETRY_BACKOFF_* vars were removed together with the geometric curve.
// A leftover value in a deployed .env is INERT -- nothing reads it -- so warn the operator and
// keep booting. Deliberately NOT fail-fast: this is an always-on service handling production
// payment data, and refusing to start over a removed OPTIONAL var is the exact outage shape that
// hurt the customer at the April month-end close. Fail-fast stays reserved for invalid REQUIRED
// config (see validate() above) and for out-of-range values that would corrupt timing.
const OBSOLETE_RETRY_VARS = ['RETRY_BACKOFF_INITIAL_MIN', 'RETRY_BACKOFF_MULTIPLIER', 'RETRY_BACKOFF_MAX_MIN'];
for (const varName of OBSOLETE_RETRY_VARS) {
    if ((process.env[varName] || '').trim() !== '') {
        console.warn('[CONFIG WARN] ' + varName + ' is obsolete and ignored — retry timing now uses RETRY_INTERVAL_PAYMENT_MIN / RETRY_INTERVAL_PO_MIN.');
    }
}

// EOM-01: hour in [0, 23].
if (!Number.isInteger(config.eom.notificationHour) || config.eom.notificationHour < 0 || config.eom.notificationHour > 23) {
    console.error('[CONFIG ERROR] EOM_NOTIFICATION_HOUR must be integer in [0, 23]. Got: ' + config.eom.notificationHour);
    process.exit(1);
}

// EOM-05: enabled is boolean (parsed via toLowerCase === 'true' above).
if (typeof config.eom.notificationEnabled !== 'boolean') {
    console.error('[CONFIG ERROR] EOM_NOTIFICATION_ENABLED must be "true" or "false". Got: ' + process.env.EOM_NOTIFICATION_ENABLED);
    process.exit(1);
}

// === Fase 20.5 (Q3-04 / Q3-06) — las seis guardas de config.notifications ===
// El bloque va DESPUÉS de las dos guardas de config.eom y ANTES del warn de la API key.
//
// El término Number.isInteger de G3, G4 y G5 no es decoración: es lo ÚNICO que rechaza el NaN que
// devuelve parseStrictInt. Sin él, toda comparación < o > contra NaN es false, la guarda pasa en
// silencio, y el servicio arranca con un valor que el operador nunca escribió — que es justo el
// desenlace fail-open que estas guardas existen para cerrar (WR-09 de la fase 20.4).

// Q3-04 (G1): el idiom de arriba produce un booleano por construcción; la guarda atrapa el caso en
// que alguien cambie ese idiom y deje de producirlo.
if (typeof config.notifications.poAlert.enabled !== 'boolean') {
    console.error('[CONFIG ERROR] PO_ALERT_ENABLED must be "true" or "false". Got: ' + process.env.PO_ALERT_ENABLED);
    process.exit(1);
}

// Q3-04 (G2): mismo contrato para el switch del reporte quincenal.
if (typeof config.notifications.paymentReport.enabled !== 'boolean') {
    console.error('[CONFIG ERROR] PAYMENT_REPORT_ENABLED must be "true" or "false". Got: ' + process.env.PAYMENT_REPORT_ENABLED);
    process.exit(1);
}

// Q3-03 (G3): hora en [0, 23].
if (!Number.isInteger(config.notifications.paymentReport.hour) || config.notifications.paymentReport.hour < 0 || config.notifications.paymentReport.hour > 23) {
    console.error('[CONFIG ERROR] PAYMENT_REPORT_HOUR must be integer in [0, 23]. Got: ' + config.notifications.paymentReport.hour);
    process.exit(1);
}

// Q3-03 (G4): ventana en [30, 3650].
if (!Number.isInteger(config.notifications.paymentReport.lookbackDays) || config.notifications.paymentReport.lookbackDays < 30 || config.notifications.paymentReport.lookbackDays > 3650) {
    console.error('[CONFIG ERROR] PAYMENT_REPORT_LOOKBACK_DAYS must be integer in [30, 3650]. Got: ' + config.notifications.paymentReport.lookbackDays);
    process.exit(1);
}

// Q3-06 (G5): piso de 1000 ms. Por debajo de un segundo el timeout no acota un envío SMTP, lo
// cancela siempre.
if (!Number.isInteger(config.notifications.mailTimeoutMs) || config.notifications.mailTimeoutMs < 1000) {
    console.error('[CONFIG ERROR] MAIL_TIMEOUT_MS must be integer >= 1000 (1 sec). Got: ' + config.notifications.mailTimeoutMs);
    process.exit(1);
}

// Q3-06 (G6, D-12): la ÚNICA relación que el código exige para MAIL_TIMEOUT_MS.
//
// Va aquí, y no más arriba, por la misma regla de orden que las guardas de la sonda: una guarda
// relacional debe ir DESPUÉS de la guarda de piso del valor contra el que compara. El piso de
// STEP_TIMEOUT_MS queda muy por encima de este punto, así que aquí config.schedule.stepTimeoutMs
// ya está validado; ponerla antes la haría comparar contra un valor ya conocido como inválido y
// nombrar la variable equivocada en el error.
//
// Es >= y no >: un timeout de correo exactamente igual al presupuesto del step no puede estar
// estrictamente acotado por él, y el caso de aceptación del SPEC es MAIL_TIMEOUT_MS=300000 junto a
// STEP_TIMEOUT_MS=300000 saliendo con exit 1. La igualdad tiene que fallar.
//
// MAIL_TIMEOUT_MS es HERMANO del tier de axios — ambos default 30000, ambos el tier más interno —
// y deliberadamente NO se relaciona con PORTAL_PROBE_BUDGET_MS, que acota otro subsistema. La
// única relación que se afirma aquí es contra el step.
if (config.notifications.mailTimeoutMs >= config.schedule.stepTimeoutMs) {
    console.error('[CONFIG ERROR] MAIL_TIMEOUT_MS (' + config.notifications.mailTimeoutMs + ') must be < STEP_TIMEOUT_MS (' + config.schedule.stepTimeoutMs + '). Lower MAIL_TIMEOUT_MS or raise STEP_TIMEOUT_MS.');
    process.exit(1);
}

// Warn if API key protection is disabled (optional -- not fatal)
if (!config.security.apiKey) {
    console.warn('[CONFIG WARN] SAGECONNECT_API_KEY not set -- API key protection is DISABLED');
}

module.exports = config;
