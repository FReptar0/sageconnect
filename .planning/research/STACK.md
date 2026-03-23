# Stack Research

**Domain:** Always-on Windows service with internal scheduling, REST API, and operational web UI for Sage 300 integration
**Researched:** 2026-03-23
**Confidence:** HIGH (Servy, node-cron, Express patterns) / MEDIUM (croner alternative, UI library choices)

## Context: Existing Stack (DO NOT install -- already present)

These are validated and in production. Listed here to prevent duplicate additions:

| Already Have | Version | Role |
|---|---|---|
| express | ^4.21.1 | Web server, routing |
| mssql | ^11.0.1 | SQL Server connectivity |
| axios | ^1.7.7 | HTTP client (Portal API calls) |
| winston | ^3.17.0 | Logging |
| log4js | ^6.9.1 | Logging |
| joi | ^17.13.3 | Validation |
| nodemailer | ^6.9.16 | Email |
| dotenv | ^16.4.5 | Environment configuration |
| xml2js | ^0.6.2 | XML parsing |
| node-notifier | ^10.0.1 | Desktop notifications |
| Bootstrap 5.3 | CDN | Dashboard UI (loaded from CDN in index.html) |
| javascript-obfuscator | ^5.3.0 | Production builds (devDep) |
| jest | ^29.7.0 | Testing (devDep) |

---

## Recommended Stack Additions

### 1. Windows Service Manager -- Servy (external tool, not npm)

| Technology | Version | Purpose | Why Recommended |
|---|---|---|---|
| Servy | 7.0 | Run SageConnect as a native Windows service that survives reboots, auto-restarts on crash | Replaces both PM2 and Windows Task Scheduler. Self-contained .NET 10 build needs no runtime installation. Provides health monitoring, log rotation, restart policies, and a management GUI/CLI. Free and open-source. |

**Why Servy over alternatives:**

| Alternative | Problem |
|---|---|
| PM2 | Not a native Windows service. Requires separate pm2-windows-startup hack. No Windows Event Log integration. Process manager pretending to be a service. Known `wmic` bugs on Windows Server 2025. |
| node-windows | Based on WinSW internally, last published 3+ years ago (beta), limited feature set, no health monitoring GUI. |
| NSSM | No stable update in over a decade. No health checks, no log rotation, no recovery actions, no GUI. |
| WinSW | In maintenance limbo, XML-driven, no graphical interface, no health monitoring. |

**Integration with SageConnect:**

The install command for production will look like:

```powershell
servy-cli install `
  --name="SageConnect" `
  --description="Sage 300 Integration Service - Portal de Proveedores" `
  --path="C:\Program Files\nodejs\node.exe" `
  --params="src/index.js" `
  --startupDir="C:\path\to\sageconnect" `
  --startupType="Automatic" `
  --enableHealth `
  --heartbeatInterval=60 `
  --maxFailedChecks=3 `
  --recoveryAction="RestartProcess" `
  --maxRestartAttempts=5 `
  --stdout="C:\path\to\sageconnect\logs\service-stdout.log" `
  --stderr="C:\path\to\sageconnect\logs\service-stderr.log" `
  --enableSizeRotation `
  --rotationSize=50 `
  --maxRotations=10
```

**Key Servy CLI commands for operations:**

```powershell
servy-cli start --name="SageConnect"
servy-cli stop --name="SageConnect"
servy-cli restart --name="SageConnect"
servy-cli status --name="SageConnect"
servy-cli export --name="SageConnect"   # backup config
servy-cli import --file="config.json"   # restore config
```

**Critical deployment note:** Servy is installed on the Windows server itself (via MSI installer, WinGet, Chocolatey, or Scoop) -- it is NOT an npm dependency. It wraps the Node.js process as a Windows service. The obfuscated production repo would include a PowerShell setup script using `servy-cli install`.

**Installation options:**
- MSI installer from GitHub releases
- `winget install servy` (WinGet)
- `choco install servy` (Chocolatey)
- `scoop install servy` (Scoop)

**Confidence:** HIGH -- actively maintained (7.0 released March 2025), comprehensive CLI docs verified, self-contained modern build eliminates .NET dependency concerns.

**Sources:**
- [Servy GitHub](https://github.com/aelassas/servy) -- verified CLI parameters, releases, wiki
- [Servy CLI Wiki](https://github.com/aelassas/servy/wiki/Servy-CLI) -- full parameter reference
- [Servy vs NSSM vs WinSW comparison](https://github.com/aelassas/servy/wiki/Comparison-with-Alternatives)

---

### 2. Internal Scheduler -- node-cron

| Technology | Version | Purpose | Why Recommended |
|---|---|---|---|
| node-cron | ^4.2.1 | Schedule background processes (forResponse cycle, child process) on cron expressions within the Node.js process | Replaces Windows Task Scheduler. Pure JS, zero dependencies, built-in timezone support, noOverlap prevents concurrent runs of the same job. Widely adopted (2,200+ dependents). |

**Why node-cron over alternatives:**

| Alternative | Why Not |
|---|---|
| cron (kelektiv) | More features than needed (Date/Luxon triggers, year field). node-cron's simpler API is a better fit for the 2-3 cron jobs this service needs. |
| croner | TypeScript-native, impressive feature set, but adds complexity for a vanilla JS project. Also smaller community (fewer dependents = less battle-tested edge cases). |
| node-schedule | Heavier, supports Date-based scheduling we do not need. Less focused on cron-only use cases. |
| setInterval/setTimeout | What the code currently uses (AutoShutdownService). Fragile for scheduling -- no cron expression support, no timezone handling, no overlap protection. |

**Integration with SageConnect:**

Currently, `background.js` runs tasks sequentially once and exits (or auto-terminates). The new model:

```javascript
const cron = require('node-cron');

// Run the full forResponse + childProcess cycle every 15 minutes
// Matches the current Windows Task Scheduler pattern
const mainJob = cron.schedule('*/15 * * * *', async () => {
  await forResponse();
  await startChildProcess();
}, {
  timezone: config.app.timezone,  // e.g., 'America/Mexico_City'
  noOverlap: true                 // skip if previous run still executing
});
```

**Key v4 behavior changes from v3 (IMPORTANT -- the project must use v4, not v3):**
- Tasks auto-start immediately on creation (no `scheduled: false` + `.start()` pattern)
- `scheduled` and `runOnInit` options removed
- New options: `noOverlap`, `maxExecutions`, `maxRandomDelay`
- `cron.validate(expression)` still available for runtime validation

**This eliminates the AutoShutdownService entirely.** The service runs continuously; cron handles timing. No more process.exit(0) followed by Windows Task Scheduler relaunch. No more port conflicts between web-only mode and background mode.

**Confidence:** HIGH -- API verified via official docs, v4 migration changes confirmed, timezone and noOverlap features confirmed.

**Sources:**
- [node-cron npm](https://www.npmjs.com/package/node-cron) -- version 4.2.1
- [node-cron scheduling options](https://nodecron.com/scheduling-options.html)
- [v3 to v4 migration guide](https://nodecron.com/migrating-from-v3)

---

### 3. REST API Security -- helmet + express-rate-limit + cors

| Library | Version | Purpose | Why Recommended |
|---|---|---|---|
| helmet | ^8.1.0 | Set security HTTP headers (CSP, X-Frame-Options, etc.) | Single line adds 15 security headers. 2M+ weekly downloads. Express official recommendation. Required because the API will be network-accessible. |
| express-rate-limit | ^8.3.1 | Prevent API abuse, brute-force protection | In-memory store is fine for single-process service. Configurable per-route limits. 10M+ weekly downloads. |
| cors | ^2.8.6 | CORS headers for web UI accessing API from browser | De facto standard for Express APIs. The operational UI will make fetch() calls to the API from the same origin, but explicit CORS config prevents issues if the UI is ever accessed from a different host. |

**Integration with existing server.js:**

```javascript
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Security headers -- must configure CSP to allow existing CDN resources
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:"],
    }
  }
}));

// CORS -- same-origin by default, configurable for external access
app.use(cors({ origin: true }));

// Rate limiting for API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                    // limit per window per IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);
```

**Confidence:** HIGH -- all three are the official Express.js recommended security stack, versions verified via npm.

**Sources:**
- [helmet npm](https://www.npmjs.com/package/helmet) -- v8.1.0
- [express-rate-limit npm](https://www.npmjs.com/package/express-rate-limit) -- v8.3.1
- [cors npm](https://www.npmjs.com/package/cors) -- v2.8.6
- [Express security best practices](https://expressjs.com/en/advanced/best-practice-security.html)

---

### 4. Async Error Handling -- express-async-errors

| Library | Version | Purpose | Why Recommended |
|---|---|---|---|
| express-async-errors | ^3.1.1 | Automatic async error handling in Express routes | Without it, unhandled promise rejections in async route handlers crash the process silently. Express 4 does not natively catch async errors. Critical for an always-on service. |

The current routes in `routes.js` use try/catch in every handler. When exposing 13 scripts as API endpoints, manually wrapping every handler is error-prone. This is a one-require monkey-patch:

```javascript
require('express-async-errors');  // must be before route definitions
// Now any thrown error in an async handler reaches the error middleware
```

**Confidence:** HIGH -- 5M+ weekly downloads, de facto standard for Express 4 async error handling.

---

### 5. API Authentication -- custom middleware (no new dependency)

| Approach | Implementation | Why |
|---|---|---|
| API key via `x-api-key` header | Custom Express middleware checking against env var | This is an internal operations API, not a public-facing service. A simple shared secret is appropriate. Adding Passport, JWT, or OAuth2 would be over-engineering for a service that runs on a private network. |

**Implementation pattern (zero dependencies):**

```javascript
function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== config.api.key) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

// Apply to all /api/ops/* routes (operational endpoints)
app.use('/api/ops', apiKeyAuth);
```

**Why NOT add a library:**
- `passport` + `passport-headerapikey`: 50+ transitive dependencies for a 10-line middleware
- `@vpriem/express-api-key-auth`: Tiny but unmaintained, does the same thing as the snippet above
- JWT/sessions: Adds state management complexity for a single-user operations UI

The API key is stored in `.env` as `API_KEY_OPS` and loaded through the existing centralized `config.js`.

**Confidence:** HIGH -- this is a well-established pattern for internal APIs.

---

### 6. Operational Web UI -- No new framework dependencies

| Approach | Purpose | Why |
|---|---|---|
| Server-rendered HTML + Bootstrap 5.3 (existing CDN) + vanilla JS fetch() | Operational pages for payments and POs | Matches existing dashboard pattern exactly. The current index.html is already 66KB of Bootstrap + vanilla JS doing dashboard rendering. Adding React/Vue/Svelte for 3-4 operational pages would be unnecessary build tooling in a project that uses javascript-obfuscator, not webpack/vite. |

**What the operational UI needs that the existing dashboard does NOT have:**

| Capability | How | New Dependency? |
|---|---|---|
| Form submission (trigger scripts) | `fetch()` to REST API endpoints | No |
| Data tables with sort/filter | Bootstrap Table (CDN) or vanilla JS | No (Bootstrap already loaded) |
| Real-time job status updates | SSE (native EventSource) or polling via `setInterval` + `fetch()` | No |
| Confirmation dialogs | Bootstrap modals (already loaded) | No |
| Toast notifications | Bootstrap toasts (already loaded) | No |
| Progress for long-running ops | SSE with `Content-Type: text/event-stream` (native Express) | No |

**SSE over WebSockets:** The dashboard needs server-to-client only (job progress, status updates). Native SSE requires zero dependencies -- Express sets headers, browser uses EventSource API with automatic reconnection. Socket.IO would add ~50KB client bundle + server dependency for bidirectional messaging we do not need.

**Why NOT add a frontend framework:**
- The project uses `javascript-obfuscator` for production builds, not webpack/vite/rollup
- Adding a build step for frontend code would require changes to the obfuscation pipeline
- The existing 66KB index.html proves the team's pattern is "CDN + vanilla JS"
- The operational UI is for 1-2 internal users, not a public SaaS product

**Confidence:** HIGH -- this continues the established pattern.

---

## Installation

```bash
# New production dependencies (5 packages)
npm install node-cron@^4.2.1 helmet@^8.1.0 express-rate-limit@^8.3.1 cors@^2.8.6 express-async-errors@^3.1.1

# Servy is installed on the Windows server (not via npm):
# winget install servy
# OR download MSI from https://github.com/aelassas/servy/releases
```

No new devDependencies required.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|---|---|---|
| Servy (external) | node-windows (npm) | If you need programmatic install/uninstall from within the Node app itself. However, node-windows is beta and unmaintained. |
| Servy (external) | PM2 + pm2-windows-startup | If you also deploy to Linux and need cross-platform process management. Not this project -- Windows-only deployment. |
| node-cron | croner | If the project migrates to TypeScript and needs advanced cron features (L, W, # syntax). Croner is the better long-term choice for TS projects. |
| node-cron | cron (kelektiv) | If you need Date-object-based scheduling (not just cron expressions). Not needed here. |
| Custom API key middleware | passport-headerapikey | If the API needs multiple auth strategies (API key + OAuth2 + JWT) in the same app. Not needed for single-strategy internal API. |
| Vanilla JS + Bootstrap CDN | React/Vue + Vite | If the UI had 10+ interactive pages with complex state. This project has 3-4 operational pages with form + table patterns. |
| In-memory rate limit | Redis + rate-limiter-flexible | If running multiple instances behind a load balancer. This is a single-instance Windows service. |
| Native SSE | Socket.IO | If the UI needed bidirectional client-to-server streaming. We only need server-to-client. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| PM2 on Windows | Not a native Windows service. Known bugs with `wmic.exe` on Windows Server 2025. Requires npm global install that can break on Node version upgrades. | Servy |
| Windows Task Scheduler (current approach) | Cannot monitor health, no overlap protection, process starts/stops every 15 minutes causing port conflicts, requires AutoShutdownService hack. | node-cron inside always-on service |
| node-cron v3.x | Missing `noOverlap` (critical for preventing concurrent runs), missing `maxExecutions`, auto-start behavior differs. v4 is a significant improvement. | node-cron v4.2.1 |
| express-session / cookie-session | The operational UI does not need traditional sessions. API key auth is stateless and simpler. Adding sessions means session store, cookie config, CSRF protection. | Custom API key middleware |
| Socket.IO / WebSockets | Over-engineering for 1-2 users. SSE provides server-to-client push with automatic reconnection, zero dependencies, and ~15 lines of Express middleware. | Native SSE |
| EJS / Pug / Handlebars | Template engines add a compile step and server-side rendering complexity. The existing pattern is static HTML served from /public/ with fetch() for data. | Static HTML + fetch() |
| morgan (HTTP logger) | The project already has winston + log4js. Adding a third logging library creates confusion about which logger handles what. | Extend existing winston/log4js for HTTP access logging |
| nodemon in production | Currently a devDependency (correct). With Servy managing the process, nodemon is never used in production. | Servy restart policy |
| node-notifier in production | Desktop notifications are meaningless when running as a Windows service (no desktop session). Can remain for dev mode only. | Servy health check notifications (toast/email built-in) |

---

## Stack Patterns by Variant

**If deploying as always-on service (primary pattern):**
- Servy manages the Node.js process as a Windows service
- node-cron handles scheduling internally
- AutoShutdownService is removed entirely
- `--web-only` flag is removed (the service always serves web + runs background)
- `autoTerminate` config is removed
- index.js no longer calls process.exit()

**If running in development:**
- `npm run dev` (nodemon) for hot-reload during development
- node-cron still runs scheduled jobs
- Servy is not used (just local node process)
- A `--no-schedule` flag could be added for UI-only development without background processes firing

---

## Version Compatibility

| Package | Compatible With | Notes |
|---|---|---|
| node-cron@^4.2.1 | Node.js >=18.0 | v4 dropped support for Node <18. Production server must be Node 18+. |
| helmet@^8.1.0 | Express 4.x and 5.x | Works with existing Express 4.21.1. |
| express-rate-limit@^8.3.1 | Express 4.x and 5.x | In-memory store by default. No external dependency. |
| cors@^2.8.6 | Express 4.x | Stable for years, no breaking changes expected. |
| express-async-errors@^3.1.1 | Express 4.x | Monkey-patches Express 4 Layer.handle. Will NOT be needed if/when upgrading to Express 5 (which handles async natively). |
| Servy 7.0 | Windows 10+, Server 2016+ | Self-contained .NET 10 build. No runtime dependency. For Windows 7/8: use .NET Framework 4.8 build. |

---

## Config.js Additions

The existing `config.js` will need new sections:

```javascript
// New sections to add to config object:
schedule: {
    cronExpression: process.env.CRON_EXPRESSION || '*/15 * * * *',
    timezone: process.env.TIMEZONE,  // already exists in app section, reuse
},

api: {
    key: process.env.API_KEY_OPS,
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW, 10) || 15,
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
},
```

New `.env` variables:
```
CRON_EXPRESSION=*/15 * * * *
API_KEY_OPS=<generated-secret>
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX=100
```

---

## Summary of All Changes

| What Changes | From | To |
|---|---|---|
| Process lifecycle | Windows Task Scheduler launches process every 15 min, process auto-terminates | Servy keeps Node.js running permanently as Windows service |
| Scheduling | External (Windows Task Scheduler) | Internal (node-cron `*/15 * * * *`) |
| Web server mode | Two modes: web-only (manual) vs background (scheduled) | Single always-on mode serving both web and background |
| AutoShutdownService | Required (prevents port conflicts) | Eliminated (no conflicts when always running) |
| API surface | Dashboard read-only routes only | + REST endpoints for 13 CLI scripts + operational UI |
| Security | None (localhost only assumption) | helmet + rate-limit + API key auth + CORS |
| Error handling | Manual try/catch per route | express-async-errors + central error handler |

**Total new npm dependencies: 5** (node-cron, helmet, express-rate-limit, cors, express-async-errors)
**Total new external tools: 1** (Servy, installed on server)
**Total new frontend dependencies: 0** (continue with Bootstrap CDN + vanilla JS)

---

## Sources

- [Servy GitHub](https://github.com/aelassas/servy) -- v7.0, verified CLI, wiki, releases
- [Servy CLI reference](https://github.com/aelassas/servy/wiki/Servy-CLI) -- full parameter list verified
- [Servy Installation Guide](https://github.com/aelassas/servy/wiki/Installation-Guide) -- .NET self-contained build confirmed
- [Servy Examples](https://github.com/aelassas/servy/wiki/Examples-&-Recipes) -- Node.js install pattern verified
- [Servy vs NSSM vs WinSW](https://dev.to/aelassas/servy-vs-nssm-vs-winsw-2k46) -- comparison verified
- [node-cron npm](https://www.npmjs.com/package/node-cron) -- v4.2.1, 2,229 dependents
- [node-cron scheduling options](https://nodecron.com/scheduling-options.html) -- timezone, noOverlap, maxExecutions
- [node-cron v3 to v4 migration](https://nodecron.com/migrating-from-v3) -- breaking changes confirmed
- [helmet npm](https://www.npmjs.com/package/helmet) -- v8.1.0
- [express-rate-limit npm](https://www.npmjs.com/package/express-rate-limit) -- v8.3.1
- [cors npm](https://www.npmjs.com/package/cors) -- v2.8.6
- [Express security best practices](https://expressjs.com/en/advanced/best-practice-security.html) -- helmet + rate-limit recommended
- [npm-compare schedulers](https://npm-compare.com/cron,node-cron,node-schedule) -- node-cron vs cron vs node-schedule

---
*Stack research for: SageConnect always-on service with web operations UI*
*Researched: 2026-03-23*
