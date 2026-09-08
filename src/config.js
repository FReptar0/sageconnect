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
        probeBudgetMs: parseEnvNumber(process.env.PORTAL_PROBE_BUDGET_MS, (v) => parseInt(v, 10), 120000),
        probeMaxPerTick: parseEnvNumber(process.env.PORTAL_PROBE_MAX_PER_TICK, (v) => parseInt(v, 10), 50),
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
// El término Number.isInteger de las dos guardas de piso es load-bearing y NO debe quitarse para
// igualar la forma más corta de las cuatro guardas de timeout de arriba: parseEnvNumber pasa 'abc'
// verbatim a parseInt, que devuelve NaN, y toda comparación `>=` contra NaN es false. Sin él un
// valor no numérico pasaría el startup Y dejaría en false para siempre las comparaciones del bound
// en PortalOC_Creator — el bound quedaría silenciosamente desactivado (fail-open), que es
// exactamente la falla que esta fase existe para quitar. Forma copiada de RETRY_LOOKBACK_DAYS.
if (!Number.isInteger(config.portal.probeBudgetMs) || config.portal.probeBudgetMs < 10000) {
    console.error('[CONFIG ERROR] PORTAL_PROBE_BUDGET_MS must be integer >= 10000 (10 sec). Got: ' + config.portal.probeBudgetMs);
    process.exit(1);
}

if (!Number.isInteger(config.portal.probeMaxPerTick) || config.portal.probeMaxPerTick < 1) {
    console.error('[CONFIG ERROR] PORTAL_PROBE_MAX_PER_TICK must be integer >= 1. Got: ' + config.portal.probeMaxPerTick);
    process.exit(1);
}

// RETRY-E2: guarda RELACIONAL, la primera de su tipo en este archivo -- las cuatro de arriba miden
// un piso en aislamiento y ninguna mide la relación entre tiers. El techo es 50% del step porque
// 120 s de sondeo + 180 s de POSTs restantes = los 300 s del step; esa aritmética sólo cierra
// porque D-01 mide el presupuesto desde el mismo origen que el step (entrada a createPurchaseOrders).
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

// Warn if API key protection is disabled (optional -- not fatal)
if (!config.security.apiKey) {
    console.warn('[CONFIG WARN] SAGECONNECT_API_KEY not set -- API key protection is DISABLED');
}

module.exports = config;
