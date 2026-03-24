const { startServer } = require('./server');
const config = require('./config');
const { startBackgroundProcesses } = require('./background');
const { initScheduler } = require('./services/CronScheduler');

/**
 * SageConnect Main Entry Point
 * Orchestrates web server and background processes based on startup arguments
 */

// Parse command line arguments
const args = process.argv.slice(2);
const webOnlyMode = args.includes('--web-only') || args.includes('-w');

// Start the web server
const server = startServer(3030, webOnlyMode);

// Start background processes only if not in web-only mode
if (!webOnlyMode) {
    if (config.app.autoTerminate) {
        // Legacy mode: run once and exit
        startBackgroundProcesses().then(() => {
            console.log('[AUTO-TERMINATE] Cerrando servidor y finalizando proceso');
            server.close(() => {
                process.exit(0);
            });
        }).catch((error) => {
            console.error('[ERROR] Error en procesos de background:', error);
            console.log('[AUTO-TERMINATE] Cerrando servidor debido a error');
            server.close(() => {
                process.exit(1);
            });
        });
    } else {
        // Always-on mode: cron scheduler manages recurring execution
        initScheduler();
        console.log('[CRON] Scheduler initialized -- background cycle runs on schedule');
    }
}