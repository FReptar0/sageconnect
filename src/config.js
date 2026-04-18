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
    },
};

// Warn if API key protection is disabled (optional -- not fatal)
if (!config.security.apiKey) {
    console.warn('[CONFIG WARN] SAGECONNECT_API_KEY not set -- API key protection is DISABLED');
}

module.exports = config;
