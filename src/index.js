const { startServer } = require('./server');
const { initScheduler } = require('./services/CronScheduler');

/**
 * SageConnect Main Entry Point
 * Always-on mode: starts web server and cron scheduler
 */

// Start the web server
startServer(3030);

// Initialize cron scheduler for recurring background jobs
initScheduler();
console.log('[CRON] Scheduler initialized -- background cycle runs on schedule');
