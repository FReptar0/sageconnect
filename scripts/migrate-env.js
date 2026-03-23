#!/usr/bin/env node

/**
 * migrate-env.js
 *
 * Migration script for v1.1 Env Unification.
 * Reads the 5 old separate .env files, merges them into a single unified .env,
 * shows the result for validation, and backs up originals to .env.legacy/.
 *
 * Usage: node scripts/migrate-env.js
 *
 * What it does:
 * 1. Reads old .env files (.env, .env.path, .env.credentials.database,
 *    .env.credentials.focaltec, .env.credentials.mailing)
 * 2. Maps old variable names to new ones (USER→DB_USER, PASSWORD→DB_PASSWORD,
 *    PATH→DOWNLOADS_PATH)
 * 3. Adds new variable MAIL_TRANSPORT=smtp (default)
 * 4. Shows the unified result for review
 * 5. On confirmation, writes unified .env and moves originals to .env.legacy/
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Old file paths
// ---------------------------------------------------------------------------
const OLD_FILES = {
    main: path.join(ROOT, '.env'),
    path: path.join(ROOT, '.env.path'),
    database: path.join(ROOT, '.env.credentials.database'),
    focaltec: path.join(ROOT, '.env.credentials.focaltec'),
    mailing: path.join(ROOT, '.env.credentials.mailing'),
};

// ---------------------------------------------------------------------------
// Variable renames (old → new)
// ---------------------------------------------------------------------------
const RENAMES = {
    'USER': 'DB_USER',
    'PASSWORD': 'DB_PASSWORD',
    'PATH': 'DOWNLOADS_PATH',
};

// ---------------------------------------------------------------------------
// Parse a .env file into key-value pairs (ignores comments and empty lines)
// ---------------------------------------------------------------------------
function parseEnvFile(filePath) {
    const vars = {};
    if (!fs.existsSync(filePath)) return vars;

    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.substring(0, eqIndex).trim();
        const value = trimmed.substring(eqIndex + 1).trim();
        vars[key] = value;
    }
    return vars;
}

// ---------------------------------------------------------------------------
// Build unified env content
// ---------------------------------------------------------------------------
function buildUnifiedEnv(allVars) {
    const lines = [];

    function addSection(title, comment, vars) {
        lines.push(`# ====== ${title} ======`);
        if (comment) lines.push(`# ${comment}`);
        for (const [key, value] of vars) {
            const renamed = RENAMES[key];
            if (renamed) {
                lines.push(`${renamed}=${value}`);
            } else {
                lines.push(`${key}=${value}`);
            }
        }
        lines.push('');
    }

    // Database
    const dbVars = allVars.database;
    addSection('DATABASE', 'SQL Server connection credentials', [
        ['USER', dbVars.USER || ''],
        ['PASSWORD', dbVars.PASSWORD || ''],
        ['SERVER', dbVars.SERVER || ''],
        ['DATABASE', dbVars.DATABASE || ''],
    ]);

    // Portal
    const portalVars = allVars.focaltec;
    addSection('PORTAL (Focaltec)', 'Portal de Proveedores API — comma-separated for multi-tenant', [
        ['URL', portalVars.URL || ''],
        ['TENANT_ID', portalVars.TENANT_ID || ''],
        ['API_KEY', portalVars.API_KEY || ''],
        ['API_SECRET', portalVars.API_SECRET || ''],
        ['DATABASES', portalVars.DATABASES || ''],
        ['EXTERNAL_IDS', portalVars.EXTERNAL_IDS || ''],
    ]);

    // Mailing
    const mailVars = allVars.mailing;
    const hasMailVars = Object.keys(mailVars).length > 0;
    const mailEntries = [['MAIL_TRANSPORT', 'smtp']];
    if (hasMailVars) {
        mailEntries.push(
            ['eFrom', mailVars.eFrom || ''],
            ['ePass', mailVars.ePass || ''],
            ['eServer', mailVars.eServer || ''],
            ['ePuerto', mailVars.ePuerto || ''],
            ['eSSL', mailVars.eSSL || ''],
            ['MAILING_NOTICES', mailVars.MAILING_NOTICES || ''],
            ['MAILING_CC', mailVars.MAILING_CC || ''],
        );
        // Gmail OAuth (if present)
        if (mailVars.CLIENT_ID) mailEntries.push(['CLIENT_ID', mailVars.CLIENT_ID]);
        if (mailVars.SECRET_CLIENT) mailEntries.push(['SECRET_CLIENT', mailVars.SECRET_CLIENT]);
        if (mailVars.REFRESH_TOKEN) mailEntries.push(['REFRESH_TOKEN', mailVars.REFRESH_TOKEN]);
        if (mailVars.REDIRECT_URI) mailEntries.push(['REDIRECT_URI', mailVars.REDIRECT_URI]);
    }
    addSection('MAILING', 'Transport: smtp or gmail — section is optional', mailEntries);

    // Paths
    const pathVars = allVars.path;
    addSection('PATHS', 'Local filesystem paths', [
        ['PATH', pathVars.PATH || ''],
        ['PROVIDERS_PATH', pathVars.PROVIDERS_PATH || ''],
        ['LOG_PATH', pathVars.LOG_PATH || ''],
    ]);

    // App
    const appVars = allVars.main;
    const appEntries = [];
    const appKeys = [
        'IMPORT_CFDIS_ROUTE', 'ARG', 'NOMBRE', 'RFC', 'REGIMEN', 'TIMEZONE',
        'DEFAULT_ADDRESS_CITY', 'DEFAULT_ADDRESS_COUNTRY', 'DEFAULT_ADDRESS_IDENTIFIER',
        'DEFAULT_ADDRESS_MUNICIPALITY', 'DEFAULT_ADDRESS_STATE', 'DEFAULT_ADDRESS_STREET',
        'DEFAULT_ADDRESS_ZIP', 'ADDRESS_IDENTIFIERS_SKIP', 'AUTO_TERMINATE',
    ];
    // Also grab WAIT_TIME if it exists (legacy, unused but preserve)
    if (appVars.WAIT_TIME) appEntries.push(['WAIT_TIME', appVars.WAIT_TIME]);
    for (const key of appKeys) {
        if (appVars[key] !== undefined) {
            appEntries.push([key, appVars[key]]);
        }
    }
    addSection('APP', 'Application config, company info, address defaults', appEntries);

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Prompt user for confirmation
// ---------------------------------------------------------------------------
function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase());
        });
    });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    console.log('=== ENV MIGRATION SCRIPT (v1.1) ===\n');

    // Step 1: Check which old files exist
    console.log('Step 1: Scanning for old .env files...\n');
    const found = {};
    const missing = [];
    for (const [name, filePath] of Object.entries(OLD_FILES)) {
        if (fs.existsSync(filePath)) {
            found[name] = filePath;
            console.log(`  [OK] ${path.basename(filePath)}`);
        } else {
            missing.push(name);
            console.log(`  [--] ${path.basename(filePath)} (not found)`);
        }
    }

    if (Object.keys(found).length === 0) {
        console.log('\nNo old .env files found. Nothing to migrate.');
        console.log('If you already have a unified .env, you\'re good.');
        process.exit(0);
    }

    // Check if unified .env already exists with new format
    const existingEnv = path.join(ROOT, '.env');
    if (fs.existsSync(existingEnv)) {
        const content = fs.readFileSync(existingEnv, 'utf-8');
        if (content.includes('DB_USER') && content.includes('DOWNLOADS_PATH')) {
            console.log('\n[WARN] .env already appears to be in unified v1.1 format.');
            const proceed = await ask('Continue anyway? (y/n): ');
            if (proceed !== 'y' && proceed !== 'yes') {
                console.log('Aborted.');
                process.exit(0);
            }
        }
    }

    // Step 2: Parse all files
    console.log('\nStep 2: Reading variables...\n');
    const allVars = {};
    for (const [name, filePath] of Object.entries(OLD_FILES)) {
        allVars[name] = fs.existsSync(filePath) ? parseEnvFile(filePath) : {};
        const count = Object.keys(allVars[name]).length;
        if (count > 0) console.log(`  ${path.basename(filePath)}: ${count} variables`);
    }

    // Step 3: Build unified content
    const unified = buildUnifiedEnv(allVars);

    // Step 4: Show result
    console.log('\n' + '='.repeat(60));
    console.log('UNIFIED .env (preview):');
    console.log('='.repeat(60) + '\n');
    console.log(unified);
    console.log('='.repeat(60));

    // Step 5: Highlight renames
    console.log('\nVariable renames applied:');
    console.log('  USER → DB_USER');
    console.log('  PASSWORD → DB_PASSWORD');
    console.log('  PATH → DOWNLOADS_PATH');
    console.log('\nNew variable added:');
    console.log('  MAIL_TRANSPORT=smtp');

    if (missing.length > 0) {
        console.log(`\n[INFO] Missing files (${missing.join(', ')}) — those sections may be incomplete.`);
    }

    // Step 6: Confirm
    const answer = await ask('\nWrite this unified .env and archive old files? (y/n): ');
    if (answer !== 'y' && answer !== 'yes') {
        console.log('Aborted. No files changed.');
        process.exit(0);
    }

    // Step 7: Backup old files to .env.legacy/
    const legacyDir = path.join(ROOT, '.env.legacy');
    if (!fs.existsSync(legacyDir)) {
        fs.mkdirSync(legacyDir);
        console.log('\nCreated .env.legacy/');
    }

    for (const [name, filePath] of Object.entries(found)) {
        const basename = path.basename(filePath);
        const dest = path.join(legacyDir, basename);
        fs.copyFileSync(filePath, dest);
        console.log(`  Backed up ${basename} → .env.legacy/${basename}`);
    }

    // Step 8: Write unified .env
    fs.writeFileSync(path.join(ROOT, '.env'), unified, 'utf-8');
    console.log('\n  [OK] Written: .env (unified)');

    // Step 9: Remove old separate files (keep .env, remove the rest)
    for (const [name, filePath] of Object.entries(found)) {
        if (name !== 'main') { // Don't delete .env itself — we just overwrote it
            fs.unlinkSync(filePath);
            console.log(`  [OK] Removed: ${path.basename(filePath)}`);
        }
    }

    console.log('\n=== MIGRATION COMPLETE ===');
    console.log('  - Unified .env written');
    console.log('  - Old files backed up to .env.legacy/');
    console.log('  - Old separate files removed');
    console.log('\nVerify your app starts correctly with: node src/index.js');
}

main().catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
});
