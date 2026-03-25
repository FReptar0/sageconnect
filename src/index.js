const { startServer } = require('./server');
const { initScheduler } = require('./services/CronScheduler');
const { validate } = require('./services/LicenseValidator');

/**
 * SageConnect Main Entry Point
 * Always-on mode: validates license, then starts web server and cron scheduler
 */

(async () => {
    // Validate license before starting anything
    // validate({ startup: true }) retries 3x and calls process.exit(1) on failure
    var license = await validate({ startup: true });
    if (!license.valid) {
        // This should not be reached (validate with startup:true exits on failure)
        // but as a safety net:
        console.error('[LICENSE] Startup blocked -- ' + (license.error || 'license inactive'));
        process.exit(1);
        return;
    }
    console.log('[LICENSE] Valid -- expires ' + (license.expiresAt || 'never'));

    // Start the web server
    startServer(3030);

    // Initialize cron scheduler for recurring background jobs
    initScheduler();
    console.log('[CRON] Scheduler initialized -- background cycle runs on schedule');
})();
