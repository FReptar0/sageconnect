const { startServer } = require('./server');
const config = require('./config');
const { startBackgroundProcesses } = require('./background');

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
    // Start background processes (now async)
    startBackgroundProcesses().then(() => {
        // In autoTerminate mode (legacy scheduled task): close server and exit.
        // In always-on mode (autoTerminate=false): process stays alive serving web requests.
        if (config.app.autoTerminate) {
            console.log('[AUTO-TERMINATE] Cerrando servidor y finalizando proceso');
            server.close(() => {
                process.exit(0); // Only reachable when autoTerminate=true
            });
        }
    }).catch((error) => {
        console.error('[ERROR] Error en procesos de background:', error);
        // In autoTerminate mode: close server and exit with error code.
        // In always-on mode: log error, process stays alive for web requests.
        if (config.app.autoTerminate) {
            console.log('[AUTO-TERMINATE] Cerrando servidor debido a error');
            server.close(() => {
                process.exit(1); // Only reachable when autoTerminate=true
            });
        }
    });
}