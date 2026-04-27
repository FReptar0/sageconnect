const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const { logGenerator } = require('./utils/LogGenerator');
const { errorResult } = require('./utils/ResultEnvelope');
const config = require('./config');

/**
 * SageConnect Web Server
 * Handles all Express app functionality and web-based features
 */

const app = express();

// ---------------------------------------------------------------------------
// Security middleware (applied BEFORE body parsers)
// ---------------------------------------------------------------------------

// Helmet -- security headers (CSP disabled for dashboard inline scripts)
app.use(helmet({ contentSecurityPolicy: false }));

// CORS -- allow cross-origin requests with API key header
app.use(cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
}));

// Global API rate limiter -- 2000 requests per 15 minutes
// Calibrated for the Phase 17 dashboard polling pattern:
//   - GET /api/operations/status every 5s = 12/min = 180/window
//   - GET /api/license/status periodic
//   - Plus initial loads, dropdowns, manual nav, multiple tabs
// Per-tab realistic usage is ~270/window, so 2000 leaves headroom for several
// operator tabs while still serving as a guardrail against runaway clients.
// The writeLimiter below (10/min) is the real abuse guard for state-changing endpoints.
app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 2000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        success: false,
        data: null,
        errors: ['Too many requests, please try again later'],
        summary: 'Rate limited',
        meta: {
            duration: 0,
            timestamp: new Date().toISOString(),
            tenant: null,
        },
    },
}));

// Write rate limiter -- 10 requests per minute (for payment/PO write endpoints)
const writeLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        success: false,
        data: null,
        errors: ['Too many write requests, please try again later'],
        summary: 'Rate limited',
        meta: {
            duration: 0,
            timestamp: new Date().toISOString(),
            tenant: null,
        },
    },
});

// ---------------------------------------------------------------------------
// Body parsers and existing middleware
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared JS static mount (before routes so /js/shared.js resolves)
// ---------------------------------------------------------------------------

app.use('/js', express.static(process.cwd() + '/public/js'));

// ---------------------------------------------------------------------------
// Clean URL routes for operational pages
//
// HTML pages are served with a server-injected <meta name="x-app-key"> tag
// so the dashboard JS can authenticate same-origin API calls without the
// operator needing to configure anything in the browser.
// ---------------------------------------------------------------------------

function escapeAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function serveHtmlWithKey(relativePath) {
    return (_req, res) => {
        const filePath = process.cwd() + '/public/' + relativePath;
        let html;
        try {
            html = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
            return res.status(500).send('Failed to read page: ' + err.message);
        }

        const key = config.security.apiKey || '';
        if (key && html.includes('</head>')) {
            const meta = `<meta name="x-app-key" content="${escapeAttr(key)}">`;
            html = html.replace('</head>', `    ${meta}\n</head>`);
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    };
}

app.get('/schedule.html', serveHtmlWithKey('schedule.html'));
app.get('/payments.html', serveHtmlWithKey('payments.html'));
app.get('/pos.html', serveHtmlWithKey('pos.html'));
app.get('/logs.html', serveHtmlWithKey('logs.html'));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use(require('./routes/routes'));

// Root redirect -- schedule page is the new home
app.get('/', (_req, res) => res.redirect('/schedule.html'));

// 404 handler
app.use(function (req, res) {
    res.status(404).sendFile(process.cwd() + '/public/404.html');
});

// Global JSON error handler
app.use((err, req, res, _next) => {
    console.error('[API ERROR]', err.message);
    res.status(500).json(errorResult([err.message], 'Internal server error'));
});

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

/**
 * Starts the Express server
 * @param {number} port - Port number to listen on
 * @returns {Object} Express server instance
 */
function startServer(port = 3030) {
    const logFileName = 'ServerStatus';

    const server = app.listen(port, () => {
        const msg = `El servidor se inició correctamente en el puerto ${port}`;
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
    startServer,
    writeLimiter,
    serveHtmlWithKey,
    escapeAttr,
};
