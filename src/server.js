const express = require('express');
const { logGenerator } = require('./utils/LogGenerator');
const { autoShutdownService } = require('./services/AutoShutdownService');

/**
 * SageConnect Web Server
 * Handles all Express app functionality and web-based features
 */

const app = express();

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Set proper charset for all responses
app.use((req, res, next) => {
    res.charset = 'utf-8';
    // Only set content-type for HTML routes, let JSON routes handle their own
    if (req.path.endsWith('.html') || req.path === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
    next();
});

// Serve static files with proper encoding
app.use('/public', express.static(process.cwd() + '/public', {
    setHeaders: (res, path) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
}));

// Routes
app.use(require('./routes/routes'));

// index handler
app.get('/', (req, res) => {
    res.sendFile(process.cwd() + '/public/index.html');
});

// 404 handler
app.use(function (req, res) {
    res.status(404).sendFile(process.cwd() + '/public/404.html');
});

/**
 * Starts the Express server
 * @param {number} port - Port number to listen on
 * @param {boolean} webOnlyMode - Whether running in web-only mode
 * @returns {Object} Express server instance
 */
function startServer(port = 3030, webOnlyMode = false) {
    const logFileName = 'ServerStatus';
    
    const server = app.listen(port, () => {
        let msg = `El servidor se inició correctamente en el puerto ${port}`;
        if (webOnlyMode) {
            msg += ' (MODO WEB SOLAMENTE - Sin procesos automáticos)';
            
            // Start auto-shutdown service only in web-only mode
            logGenerator(logFileName, 'info', 'Iniciando servicio de auto-shutdown para evitar conflictos con procesos programados');
            autoShutdownService.start();
        }
        console.log(msg);
        logGenerator(logFileName, 'info', msg);
    });

    // Graceful shutdown handler
    const gracefulShutdown = () => {
        console.log('[INFO] Iniciando cierre graceful del servidor...');
        logGenerator(logFileName, 'info', '[INFO] Iniciando cierre graceful del servidor...');
        
        server.close(() => {
            console.log('[INFO] Servidor cerrado correctamente');
            logGenerator(logFileName, 'info', '[INFO] Servidor cerrado correctamente');
        });
    };

    // Handle shutdown signals
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    return server;
}

module.exports = {
    app,
    startServer
};