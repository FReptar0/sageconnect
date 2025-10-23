const { startServer } = require('./server');
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
    startBackgroundProcesses();
    
    // Auto-terminate after background processes complete (for scheduled tasks)
    if (process.env.AUTO_TERMINATE === 'true') {
        setTimeout(() => {
            console.log('[AUTO-TERMINATE] Cerrando servidor y finalizando proceso');
            server.close(() => {
                process.exit(0);
            });
        }, 15000); // Wait 15 seconds for all processes to complete
    }
}