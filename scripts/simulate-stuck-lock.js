#!/usr/bin/env node
/**
 * Phase 18 manual test helper — simulate a stuck lock.
 *
 * Boots a minimal SageConnect server (license validation skipped, cron disabled
 * via env override) and injects a fake lock into the in-process OperationManager
 * singleton so the dashboard's "Operación en curso" card appears and the new
 * "Forzar liberación" button (Plan 18-03) is clickable.
 *
 * USAGE:
 *   node scripts/simulate-stuck-lock.js [--port N] [--quick] [--no-step]
 *
 * FLAGS:
 *   --port N    Listen on port N instead of 3030.
 *   --quick     Set LOCK_TIMEOUT_MS=120000 (2 min) so auto-release fires within
 *               a short test window. Default: respects .env (14 min).
 *   --no-step   Skip startStep so the modal context line shows the
 *               "inicializando ciclo" fallback (UI-SPEC line 107) instead of
 *               a populated step + tenant.
 *   --xss       Inject HTML/JS payloads as step name + tenant
 *               (`<img src=x onerror="alert(1)">` / `<svg/onload="alert(2)">`)
 *               for the Plan 18-03 XSS regression test. The modal must render
 *               these as literal text via escapeHtml() — no alert() should
 *               fire. Mutually exclusive with --no-step (overrides it).
 *
 * NOT FOR PRODUCTION. Excluded from the obfuscated build because
 * scripts/obfuscate.js COPY_AS_IS allowlist does not include this file.
 */

'use strict';

// ---- CLI args (parse before requiring config so env overrides take effect) ----
const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3030;
const QUICK = args.includes('--quick');
const NO_STEP = args.includes('--no-step');
const XSS = args.includes('--xss');

if (QUICK) {
    process.env.LOCK_TIMEOUT_MS = '120000'; // 2 min
}

// Force cron to almost-never fire during the test (Jan 1 at 00:00, once a year).
// We still register the schedule so initScheduler() runs the lock:timeout listener
// wiring, but the actual background cycle never kicks off.
process.env.CRON_SCHEDULE = '0 0 1 1 *';

// ---- Bypass the license enforcement middleware ----
// require-license.js does `const { isValid } = require('./LicenseValidator')` at module load,
// which captures the function reference. Monkey-patching after the fact is too late, so we
// replace the module in require.cache BEFORE server.js (and its route → middleware chain) is
// required. Self-contained to this script — production code is untouched.
const validatorPath = require.resolve('../src/services/LicenseValidator');
const now = new Date().toISOString();
require.cache[validatorPath] = {
    id: validatorPath,
    filename: validatorPath,
    loaded: true,
    children: [],
    paths: [],
    exports: {
        validate: async () => ({ valid: true, expiresAt: null }),
        isValid: () => true,
        getStatus: () => ({
            active: true,
            state: 'VALID',
            expiresAt: null,
            lastChecked: now,
            lastSuccessfulCheck: now,
        }),
        _reset: () => {},
    },
};

// ---- Boot ----
const { app } = require('../src/server');
const operationManager = require('../src/services/OperationManager');
const { initScheduler } = require('../src/services/CronScheduler');

// Register the lock:timeout listener (Plan 18-01 wires this inside initScheduler).
// initScheduler also creates the cron task — neutralized by the CRON_SCHEDULE override above.
initScheduler();

const TASK_ID = 'background-cycle';
const operationId = 'sim-' + Date.now().toString().slice(-8);

const server = app.listen(PORT, () => {
    operationManager.acquireLock(TASK_ID, operationId);
    if (XSS) {
        // XSS spot-check: inject HTML/JS payloads as the step name and tenant.
        // The frontend modal must render these as literal text via escapeHtml().
        // If escapeHtml is missing, the browser executes alert(1) and alert(2).
        operationManager.startStep(
            TASK_ID,
            '<img src=x onerror="alert(1)">',
            '<svg/onload="alert(2)">'
        );
    } else if (!NO_STEP) {
        operationManager.startStep(TASK_ID, 'downloadCFDI', 'capstone');
    }

    const apiKey = process.env.SAGECONNECT_API_KEY || '(unset)';
    const lockTimeoutMs = parseInt(process.env.LOCK_TIMEOUT_MS, 10) || (14 * 60 * 1000);
    const lockTimeoutMin = (lockTimeoutMs / 60000).toFixed(1);

    const lines = [
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '  Phase 18 manual test — simulated stuck lock',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '  Dashboard:    http://localhost:' + PORT + '/schedule.html',
        '  Status API:   http://localhost:' + PORT + '/api/operations/status',
        '  API key:      ' + apiKey,
        '',
        '  Active simulated lock:',
        '    operationType:    ' + TASK_ID,
        '    operationId:      ' + operationId,
        '    stuckOnStep:      ' + (NO_STEP ? '(none — modal will show "inicializando ciclo")' : 'downloadCFDI (capstone)'),
        '    auto-release in:  ' + lockTimeoutMin + ' min',
        '',
        '  → Open the dashboard URL above. Within ~5 seconds the',
        '    "Operación en curso" card should appear.',
        '  → Click "Forzar liberación" to test the Plan 18-03 modal.',
        '  → Or hit POST /api/schedule/' + TASK_ID + '/force-release',
        '    with header  x-api-key: ' + apiKey,
        '',
        '  Auto-release path: wait ' + lockTimeoutMin + ' min without clicking',
        '  (use --quick to shorten to 2 min). The lock:timeout listener',
        '  fires addHistory + admin email + log.',
        '',
        '  Notes:',
        '    - License middleware bypassed via require.cache shim',
        '      (LicenseValidator returns VALID without HTTP).',
        '    - Cron is disabled (CRON_SCHEDULE=0 0 1 1 *).',
        '    - SQL pool is lazy — no DB queries fire unless triggered.',
        '    - Admin email targets the SMTP in .env which is not reachable',
        '      from outside Capstone — sends will fail silently (warn log).',
        '',
        '  Stop with Ctrl-C.',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
    ];
    console.log(lines.join('\n'));
});

const shutdown = () => {
    console.log('\n[simulate-stuck-lock] Shutting down...');
    operationManager.releaseLock(TASK_ID);
    server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
