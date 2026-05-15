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
        // RETRY-03 (D-customer-confirmation): cron scope for which authorization dates the WHERE picks up.
        // Default 'current_month' (customer-locked policy 2026-05-15). Valid: 'current_month' | 'last_n_days'.
        scope: process.env.RETRY_SCOPE || 'current_month',
        // RETRY-03 (D-customer-confirmation): lookback window when scope=last_n_days. Default 30. Range [1, 365].
        lookbackDays: parseEnvNumber(process.env.RETRY_LOOKBACK_DAYS, (v) => parseInt(v, 10), 30),
        backoff: {
            // RETRY-05 (D-customer-confirmation): initial backoff in minutes. Default 15. Range [1, 60].
            initialMin: parseEnvNumber(process.env.RETRY_BACKOFF_INITIAL_MIN, (v) => parseInt(v, 10), 15),
            // RETRY-05 (D-customer-confirmation): backoff multiplier per attempt. Default 2 (curva 15→30→60→…→1440). Range [1.0, 10.0]. parseFloat acepta decimales.
            multiplier: parseEnvNumber(process.env.RETRY_BACKOFF_MULTIPLIER, parseFloat, 2),
            // RETRY-05 (D-customer-confirmation): max backoff in minutes (caps the geometric growth). Default 1440 (24h). Range [60, 10080] (1h, 1w).
            maxMin: parseEnvNumber(process.env.RETRY_BACKOFF_MAX_MIN, (v) => parseInt(v, 10), 1440),
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

// RETRY-05: initialMin in [1, 60].
if (!Number.isInteger(config.retry.backoff.initialMin) || config.retry.backoff.initialMin < 1 || config.retry.backoff.initialMin > 60) {
    console.error('[CONFIG ERROR] RETRY_BACKOFF_INITIAL_MIN must be integer in [1, 60]. Got: ' + config.retry.backoff.initialMin);
    process.exit(1);
}

// RETRY-05: multiplier in [1.0, 10.0].
if (typeof config.retry.backoff.multiplier !== 'number' || !Number.isFinite(config.retry.backoff.multiplier) || config.retry.backoff.multiplier < 1.0 || config.retry.backoff.multiplier > 10.0) {
    console.error('[CONFIG ERROR] RETRY_BACKOFF_MULTIPLIER must be number in [1.0, 10.0]. Got: ' + config.retry.backoff.multiplier);
    process.exit(1);
}

// RETRY-05: maxMin in [60, 10080].
if (!Number.isInteger(config.retry.backoff.maxMin) || config.retry.backoff.maxMin < 60 || config.retry.backoff.maxMin > 10080) {
    console.error('[CONFIG ERROR] RETRY_BACKOFF_MAX_MIN must be integer in [60, 10080]. Got: ' + config.retry.backoff.maxMin);
    process.exit(1);
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
