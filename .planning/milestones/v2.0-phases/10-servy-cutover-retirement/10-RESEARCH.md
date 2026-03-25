# Phase 10: Servy Cutover + Retirement - Research

**Researched:** 2026-03-24
**Domain:** Windows Service management (Servy), legacy code removal, deployment automation
**Confidence:** HIGH

## Summary

Phase 10 is the final phase of v2.0, combining two distinct work streams: (1) creating Servy-based Windows Service registration tooling, and (2) removing all legacy process lifecycle artifacts. The codebase has been thoroughly audited -- every file referencing `AutoShutdownService`, `autoTerminate`, `AUTO_TERMINATE`, `--web-only`, shutdown routes, and `RunSageconnect.bat` has been identified with exact line locations.

Servy (v7.0, March 2026) is a mature Windows Service wrapper with CLI and PowerShell module interfaces. It supports health checks, log rotation, restart-on-crash, and auto-start on boot. The existing `GET /api/system/health` endpoint already returns the exact format needed for Servy health monitoring. The PowerShell installation script can be fully idempotent using `Get-Service` checks.

**Primary recommendation:** Structure as two waves -- Wave 1 creates the Servy installation script and deployment docs (additive, zero risk), Wave 2 performs complete legacy removal across all files with test updates. This ordering ensures the service infrastructure is ready before removing fallback capability.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Servy is NOT installed yet -- include installation in deliverables
- Deliver both: PowerShell automation script (`scripts/install-service.ps1`) + step-by-step README for ops team understanding
- Production server runs Node.js v22.15.0 -- no compatibility concerns
- Servy manages: auto-start on boot, restart on crash, log rotation, health monitoring
- Service name: "SageConnect"
- Remove entirely: `src/services/AutoShutdownService.js`, all imports/references to AutoShutdownService, `AUTO_TERMINATE` env var from config.js, `autoTerminate` logic in index.js, `--web-only` CLI argument parsing, `RunSageconnect.bat`, `POST /api/shutdown` route, `/api/shutdown-status` route, shutdown button/status from dashboard UI (logs.html)
- Keep: config.js `process.exit(1)` on startup validation (fail-fast on bad config)
- Cutover sequence: Stop Task Scheduler job -> deploy v2.0 code -> install Servy -> start service
- Rollback: Keep RunSageconnect.bat in backup location (not in repo, on server). Re-enable Task Scheduler if Servy fails
- No parallel operation -- stop old, start new. Avoids port 3030 conflicts
- No backward compat -- v2.0 is always-on only

### Claude's Discretion
- Servy CLI flags and configuration options (restart delay, log path, health check URL)
- Exact PowerShell script implementation
- Which files need config.js `autoTerminate` references cleaned up
- Order of removal operations to keep each commit valid

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEPLOY-01 | Servy configuration/script to register SageConnect as native Windows Service | Servy CLI reference fully documented; PowerShell module parameters mapped; `GET /api/system/health` already exists for health checks |
| DEPLOY-02 | Remove AutoShutdownService (after cron + Servy proven stable) | Complete audit: `AutoShutdownService.js` file, 4 import sites (`server.js`, `dashboard-routes.js`, `schedule-routes.test.js`, `operations-routes.test.js`, `payment-routes.test.js`), UI code in `logs.html` |
| DEPLOY-03 | Remove AUTO_TERMINATE flag and RunSageconnect.bat | Complete audit: `config.js` line 142, `index.js` lines 12-13/16/19-33, `background.js` lines 304/312, `.env.example` line 66, `package.json` scripts, `obfuscate.js` lines 38/244, `migrate-env.js` line 145, 12+ test files with autoTerminate mocks |
</phase_requirements>

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Servy | v7.0 | Windows Service wrapper | Replaces PM2 (wmic bug on Win Server 2025); supports CLI, PowerShell, health checks, log rotation |
| PowerShell | 5.1+ | Installation automation | Native on Windows Server; Servy provides PowerShell module |
| Node.js | v22.15.0 | Runtime (production) | Already deployed, LTS |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `servy-cli` | CLI interface for service management | Manual service operations, verification |
| `Servy.psm1` | PowerShell module | Scripted installation (install-service.ps1) |
| `winget` | Package manager | Servy installation: `winget install servy` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Servy | NSSM | NSSM works but lacks health checks, log rotation, PowerShell module. Servy is actively maintained (v7.0 March 2026) |
| Servy | node-windows | npm package but adds runtime dependency; Servy is external to the app |
| PowerShell script | Manual README only | Script ensures repeatability; README ensures understanding |

**Installation (on production server):**
```powershell
winget install servy
```

## Architecture Patterns

### Recommended Project Structure Changes
```
scripts/
  install-service.ps1     # NEW: Idempotent Servy installation
src/
  index.js                # SIMPLIFIED: remove --web-only, autoTerminate branches
  config.js               # SIMPLIFIED: remove autoTerminate from config object
  server.js               # SIMPLIFIED: remove AutoShutdownService import, webOnlyMode param
  services/
    AutoShutdownService.js  # DELETE
  routes/
    dashboard-routes.js     # SIMPLIFIED: remove shutdown routes + import
public/
  logs.html               # SIMPLIFIED: remove shutdown UI elements
RunSageconnect.bat        # DELETE
.env.example              # SIMPLIFIED: remove AUTO_TERMINATE line
```

### Pattern 1: Idempotent PowerShell Installation Script
**What:** Script that checks existing state before modifying, safe to run multiple times
**When to use:** Production service deployment and re-deployment
**Example:**
```powershell
# Source: Servy PowerShell Module documentation
# https://github.com/aelassas/servy/wiki/Servy-PowerShell-Module

# Check if service already exists
$existing = Get-Service -Name "SageConnect" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Service 'SageConnect' already exists (Status: $($existing.Status))"
    Write-Host "Use 'servy-cli uninstall --name=SageConnect' to remove first"
    exit 0
}

# Install via Servy PowerShell module
Import-Module "C:\Program Files\Servy\Servy.psm1" -Force

$params = @{
    Name            = "SageConnect"
    DisplayName     = "SageConnect"
    Description     = "Sage 300 - Portal de Proveedores integration service"
    Path            = "C:\Program Files\nodejs\node.exe"
    Params          = "src/index.js"
    StartupDir      = "E:\sageconnect"
    StartupType     = "Automatic"
    Stdout          = "E:\sageconnect\logs\servy-stdout.log"
    Stderr          = "E:\sageconnect\logs\servy-stderr.log"
    EnableHealth    = $true
    HeartbeatInterval = 30
    MaxFailedChecks = 3
    RecoveryAction  = "RestartService"
    MaxRestartAttempts = 5
    EnableSizeRotation = $true
    RotationSize    = 10
    MaxRotations    = 5
    StopTimeout     = 30
}

Install-ServyService @params
Start-ServyService -Name "SageConnect"
Get-ServyServiceStatus -Name "SageConnect"
```

### Pattern 2: Simplified Always-On Entry Point (Post-Removal)
**What:** index.js after removing all legacy dual-mode code
**When to use:** Final state of index.js
**Example:**
```javascript
// Simplified index.js -- always-on mode only
const { startServer } = require('./server');
const { initScheduler } = require('./services/CronScheduler');

// Start the web server
const server = startServer(3030);

// Initialize cron scheduler for recurring background jobs
initScheduler();
console.log('[CRON] Scheduler initialized -- background cycle runs on schedule');
```

### Pattern 3: Clean server.js (No AutoShutdownService)
**What:** server.js after removing webOnlyMode parameter and AutoShutdownService
**When to use:** Final state of server.js
**Example:**
```javascript
// startServer no longer needs webOnlyMode parameter
function startServer(port = 3030) {
    const logFileName = 'ServerStatus';
    const server = app.listen(port, () => {
        const msg = `El servidor se inicio correctamente en el puerto ${port}`;
        console.log(msg);
        logGenerator(logFileName, 'info', msg);
    });

    // Graceful shutdown handler (Servy sends SIGTERM on stop)
    const gracefulShutdown = () => { /* ... same as current ... */ };
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    return server;
}
```

### Anti-Patterns to Avoid
- **Partial removal:** Do not leave dead references to removed files/vars. Every `autoTerminate`, `AutoShutdownService`, `webOnlyMode`, and shutdown route reference must be cleaned from ALL files including tests.
- **Breaking test mocks:** Tests that mock `AutoShutdownService` (schedule-routes.test.js, operations-routes.test.js, payment-routes.test.js) must have those mocks removed. The module mock will fail if the file does not exist.
- **Process.exit in always-on paths:** After removing the autoTerminate guards from index.js, verify there are ZERO `process.exit` calls remaining in index.js. The `no-process-exit.test.js` will need updating to reflect this.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Windows Service registration | Custom sc.exe calls or registry edits | Servy CLI/PowerShell module | Servy handles service lifecycle, health checks, log rotation, restart policies |
| Health check for service | Custom monitoring script | Servy `--enableHealth` + existing `/api/system/health` endpoint | Already have the endpoint; Servy natively polls HTTP health checks |
| Log rotation for service stdout | Custom log rotation | Servy `--enableSizeRotation` + `--rotationSize` | Built-in, configurable size and date-based rotation |
| Process restart on crash | Custom watchdog | Servy `--recoveryAction=RestartService` | Servy monitors and auto-restarts with configurable retry limits |

**Key insight:** Servy handles ALL the operational concerns (restart, health, logs) that would otherwise require custom code. The application code should be simpler after this phase, not more complex.

## Common Pitfalls

### Pitfall 1: Forgetting Test Mock Cleanup
**What goes wrong:** After deleting `AutoShutdownService.js`, tests with `jest.mock('../../src/services/AutoShutdownService')` fail because the mock target does not exist.
**Why it happens:** Jest module mocks reference the physical file path.
**How to avoid:** Remove ALL `jest.mock` calls for `AutoShutdownService` in: `schedule-routes.test.js` (line 95-96), `operations-routes.test.js` (line 74-75), `payment-routes.test.js` (line 141-142). These mocks were needed because `server.js` imported AutoShutdownService.
**Warning signs:** Jest errors like "Cannot find module '../../src/services/AutoShutdownService'"

### Pitfall 2: Test Assertions on Removed Properties
**What goes wrong:** Tests assert `config.app.autoTerminate` exists, fail after removal.
**Why it happens:** Multiple test files set `autoTerminate: false` in their mock configs, and structural tests assert the property exists.
**How to avoid:** Audit and update every test file. Full list:
- `tests/config.test.js` -- lines 194-203 (2 tests about autoTerminate)
- `tests/regression-verification.test.js` -- line 180 (asserts `autoTerminate` property)
- `tests/no-process-exit.test.js` -- lines 199-225 (test 5: index.js autoTerminate guards), lines 237-243 (AutoShutdownService test), lines 246-266 (dashboard-routes autoTerminate guard test)
- Config mocks in: `GetPaymentCFDI.test.js`, `EmailSender.test.js`, `cron-scheduler.test.js`, `regression-verification.test.js`, `envelope-contract.test.js`, `TimezoneHelper.test.js`, `schedule-routes.test.js`, `operations-routes.test.js`, `po-routes.test.js`, `payment-routes.test.js`, `PaymentReconciliation.test.js`
**Warning signs:** Test failures after legacy code removal

### Pitfall 3: Obfuscation Script Still References Removed Files
**What goes wrong:** `scripts/obfuscate.js` references `RunSageconnect.bat` (line 38) and `web-only` script (line 244) in dist package.json generation.
**Why it happens:** Obfuscation script copies specific files and rewrites package.json for production.
**How to avoid:** Update `obfuscate.js`: remove `RunSageconnect.bat` from COPY_FILES array, remove `web-only` from dist package.json scripts. Add `scripts/install-service.ps1` to COPY_FILES if the script should be in dist.

### Pitfall 4: migrate-env.js Still References AUTO_TERMINATE
**What goes wrong:** `scripts/migrate-env.js` (line 145) includes `AUTO_TERMINATE` in the app keys list for .env migration.
**Why it happens:** Migration script was written before this removal was planned.
**How to avoid:** Remove `AUTO_TERMINATE` from the `appKeys` array in `migrate-env.js`.

### Pitfall 5: background.js autoTerminate References
**What goes wrong:** `background.js` lines 304 and 312 reference `config.app.autoTerminate` for logging purposes.
**Why it happens:** These are informational log lines, easy to miss since they are not functional branching.
**How to avoid:** Remove both conditional blocks in `startBackgroundProcesses()`. After removal, the try/catch just logs normally without any autoTerminate-specific messages.

### Pitfall 6: Graceful Shutdown Signal Handling
**What goes wrong:** Servy sends SIGTERM (or Ctrl+C equivalent) to stop the service. If the app does not handle it, Servy force-kills after `stopTimeout`.
**Why it happens:** Node.js default SIGTERM behavior is to exit immediately.
**How to avoid:** The existing `gracefulShutdown` handler in `server.js` (lines 154-166) already handles SIGTERM and SIGINT correctly. Keep this code intact -- it is critical for Servy integration.

### Pitfall 7: Health Check URL Configuration
**What goes wrong:** Servy health check points to wrong URL or app listens on wrong interface.
**Why it happens:** Express listens on `0.0.0.0` by default on port 3030, but the health URL must be exact.
**How to avoid:** Servy health check documentation indicates it monitors the process, not necessarily HTTP. If HTTP health is needed, the URL would be `http://localhost:3030/api/system/health`. Note: verify on actual deployment whether Servy's `--enableHealth` uses HTTP polling or process monitoring. The PowerShell script should document this.

## Code Examples

### Complete File Audit -- What Changes Where

**Files to DELETE:**
```
src/services/AutoShutdownService.js   -- entire file (218 lines)
RunSageconnect.bat                     -- entire file (4 lines)
```

**Files to CREATE:**
```
scripts/install-service.ps1           -- Servy PowerShell installation script
docs/DEPLOYMENT.md (or README section) -- Cutover procedure documentation
```

**Files to MODIFY (with exact locations):**

#### src/index.js (39 lines -> ~10 lines)
```javascript
// REMOVE: lines 3 (background import used only in autoTerminate branch)
// REMOVE: lines 12-13 (--web-only arg parsing)
// REMOVE: line 16 (webOnlyMode parameter to startServer)
// REMOVE: lines 19-33 (entire autoTerminate if/else block)
// KEEP: lines 1, 4 (server + CronScheduler imports)
// KEEP: startServer() call (without webOnlyMode param)
// KEEP: initScheduler() call
```

#### src/config.js
```javascript
// REMOVE: line 142 -- autoTerminate: (process.env.AUTO_TERMINATE || '').toLowerCase() === 'true',
// That's the only change in config.js
```

#### src/server.js
```javascript
// REMOVE: line 6 -- const { autoShutdownService } = require('./services/AutoShutdownService');
// MODIFY: line 137 -- function startServer(port = 3030) -- remove webOnlyMode parameter
// REMOVE: lines 142-148 -- webOnlyMode conditional block (auto-shutdown start)
// KEEP: gracefulShutdown handler (SIGTERM/SIGINT) -- critical for Servy
```

#### src/routes/dashboard-routes.js
```javascript
// REMOVE: line 13 -- const { autoShutdownService } = require('../services/AutoShutdownService');
// REMOVE: lines 143-166 -- GET /api/shutdown-status route
// REMOVE: lines 169-214 -- POST /api/shutdown route
```

#### public/logs.html
```javascript
// REMOVE: Shutdown button (~line 293)
// REMOVE: shutdownCheckInterval, isShutdownWarningShown variables (~lines 587-588)
// REMOVE: startShutdownMonitoring() call (~line 604-605)
// REMOVE: shutdownServer() function (~lines 1046-1087+)
// REMOVE: startShutdownMonitoring() function (~lines 1185-1202)
// REMOVE: handleShutdownStatus() function (~lines 1203-1221)
// REMOVE: showShutdownWarning() function (~lines 1223-1261)
// REMOVE: showAutoShutdownNotification() function (~lines 1262-1310+)
// REMOVE: updateShutdownInfo() function (~lines 1313-1347)
```

#### package.json
```json
// REMOVE: "web-only" script (line 10)
// REMOVE: "dev:web-only" script (line 11)
```

#### .env.example
```
// REMOVE: AUTO_TERMINATE=false (line 66) and its comment (line 65)
```

#### scripts/obfuscate.js
```javascript
// REMOVE: 'RunSageconnect.bat' from COPY_FILES array (line 38)
// MODIFY: dist package.json scripts -- remove 'web-only' entry (line 244)
// CONSIDER: Add 'scripts/install-service.ps1' to COPY_FILES
```

#### scripts/migrate-env.js
```javascript
// REMOVE: 'AUTO_TERMINATE' from appKeys array (line 145)
```

#### src/background.js
```javascript
// REMOVE: lines 303-306 -- if (config.app.autoTerminate) { logGenerator... }
// REMOVE: lines 311-313 -- if (config.app.autoTerminate) { logGenerator... }
// NOTE: config import on line 12 may still be needed for other config references (check schedule.operationDelayMs usage)
```

### Servy CLI Install Example (Alternative to PowerShell Module)
```powershell
# Source: https://github.com/aelassas/servy/wiki/Servy-CLI
servy-cli install `
    --name="SageConnect" `
    --displayName="SageConnect" `
    --description="Sage 300 - Portal de Proveedores integration service" `
    --path="C:\Program Files\nodejs\node.exe" `
    --params="src/index.js" `
    --startupDir="E:\sageconnect" `
    --startupType="Automatic" `
    --stdout="E:\sageconnect\logs\servy-stdout.log" `
    --stderr="E:\sageconnect\logs\servy-stderr.log" `
    --enableHealth `
    --heartbeatInterval=30 `
    --maxFailedChecks=3 `
    --recoveryAction="RestartService" `
    --maxRestartAttempts=5 `
    --enableSizeRotation `
    --rotationSize=10 `
    --maxRotations=5 `
    --stopTimeout=30
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PM2 for Windows Service | Servy | v2.0 decision (2026-03) | PM2 has wmic bug on Windows Server 2025; Servy is purpose-built |
| Windows Task Scheduler + RunSageconnect.bat | node-cron internal scheduler | Phase 8 (already done) | Scheduling moved inside app; .bat is now dead code |
| AUTO_TERMINATE dual-mode (run-once vs always-on) | Always-on only | Phase 10 (this phase) | Simplifies index.js from 39 lines to ~10 |
| AutoShutdownService (port conflict prevention) | Servy manages single process | Phase 10 (this phase) | No port conflicts when only one process exists |
| NSSM (legacy service wrapper) | Servy v7.0 | 2025-2026 | Servy has health checks, log rotation, PowerShell module, signed binaries |

**Deprecated/outdated:**
- `AutoShutdownService`: Was necessary for web-only mode to prevent port 3030 conflicts with scheduled task. Now meaningless -- only one process.
- `AUTO_TERMINATE`: Was the switch between run-once and always-on modes. Always-on is the only mode in v2.0.
- `--web-only` flag: Started server without background processes. Now irrelevant -- cron scheduler handles timing.
- `RunSageconnect.bat`: Task Scheduler launcher. Replaced by Servy auto-start.

## Open Questions

1. **Servy health check mechanism -- HTTP or process?**
   - What we know: Servy has `--enableHealth`, `--heartbeatInterval`, `--maxFailedChecks`. The existing `/api/system/health` endpoint returns uptime and status.
   - What's unclear: Whether `--enableHealth` does HTTP polling to a URL or just monitors the process PID. The wiki pages for health monitoring failed to load.
   - Recommendation: PowerShell script should document both approaches. If HTTP health is supported, configure it to poll `http://localhost:3030/api/system/health`. If process-only, the default monitoring is sufficient. The install script should include a comment explaining how to add HTTP health check URL if/when Servy supports it.

2. **Servy module path on production**
   - What we know: `winget install servy` installs to Program Files; PowerShell module is at `C:\Program Files\Servy\Servy.psm1`.
   - What's unclear: Exact installation path may vary by winget version/configuration.
   - Recommendation: Script should use `servy-cli` (which is on PATH after winget install) rather than importing the PowerShell module directly, for portability. Alternatively, detect the module path dynamically.

3. **Production server deployment path**
   - What we know: `RunSageconnect.bat` uses `E:\sageconnect` as the working directory.
   - What's unclear: Whether this exact path is current or has changed.
   - Recommendation: Script should accept path as parameter with `E:\sageconnect` as default. Document in README.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7 with babel-jest |
| Config file | `jest.config.js` |
| Quick run command | `npx jest --bail` |
| Full suite command | `npx jest` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEPLOY-01 | install-service.ps1 is valid PowerShell | manual-only | N/A (no PowerShell on macOS dev) | N/A -- new file |
| DEPLOY-02 | AutoShutdownService.js deleted, no imports remain | unit (structural) | `npx jest tests/no-process-exit.test.js -x` | Exists but needs update |
| DEPLOY-02 | server.js no longer imports AutoShutdownService | unit (structural) | `npx jest tests/no-process-exit.test.js -x` | Exists but needs update |
| DEPLOY-02 | shutdown routes removed | unit (API) | `npx jest tests/api/ -x` | Exists -- route tests need mock removal |
| DEPLOY-03 | config.app has no autoTerminate property | unit | `npx jest tests/config.test.js -x` | Exists but needs update |
| DEPLOY-03 | index.js has zero process.exit calls | unit (structural) | `npx jest tests/no-process-exit.test.js -x` | Exists but needs update |
| DEPLOY-03 | package.json has no web-only scripts | unit (structural) | Manual verification or new assertion |
| DEPLOY-03 | Full test suite passes after all removals | integration | `npx jest` | All 18 test files need audit |

### Sampling Rate
- **Per task commit:** `npx jest --bail`
- **Per wave merge:** `npx jest`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/no-process-exit.test.js` -- remove test 5 (index.js autoTerminate guards), AutoShutdownService test, dashboard-routes autoTerminate test; update test 1 ALLOWED_FILES set (remove `dashboard-routes.js` since it will have zero process.exit); add assertion that index.js has zero process.exit calls
- [ ] `tests/config.test.js` -- remove 2 autoTerminate tests (lines 194-203)
- [ ] `tests/regression-verification.test.js` -- remove autoTerminate assertion (line 180)
- [ ] `tests/api/schedule-routes.test.js` -- remove AutoShutdownService mock (lines 95-96)
- [ ] `tests/api/operations-routes.test.js` -- remove AutoShutdownService mock (lines 74-75)
- [ ] `tests/api/payment-routes.test.js` -- remove AutoShutdownService mock (lines 141-142)
- [ ] 11 test files with `autoTerminate: false` in config mocks -- remove the property from mock config objects

## Sources

### Primary (HIGH confidence)
- Servy GitHub repository (https://github.com/aelassas/servy) -- v7.0, March 2026, feature list and installation
- Servy CLI wiki (https://github.com/aelassas/servy/wiki/Servy-CLI) -- all CLI flags and parameters
- Servy PowerShell Module wiki (https://github.com/aelassas/servy/wiki/Servy-PowerShell-Module) -- all cmdlets
- Servy Examples & Recipes (https://github.com/aelassas/servy/wiki/Examples-&-Recipes) -- Node.js service installation patterns
- Source code audit -- direct examination of all files listed in CONTEXT.md

### Secondary (MEDIUM confidence)
- Servy PowerShell module examples (https://github.com/aelassas/servy/blob/main/src/Servy.CLI/servy-module-examples.ps1) -- complete parameter example
- Servy official site (https://servy-win.github.io/) -- feature overview

### Tertiary (LOW confidence)
- Servy health check mechanism -- wiki health monitoring page failed to load; exact HTTP health check configuration unverified

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Servy CLI/PowerShell documented with exact parameters from official wiki
- Architecture: HIGH -- Full source code audit completed; every file to modify identified with line numbers
- Pitfalls: HIGH -- Complete grep audit of all references; test files individually examined
- Servy health check details: MEDIUM -- CLI flags documented but health monitoring wiki page failed to load

**Research date:** 2026-03-24
**Valid until:** 2026-04-24 (Servy is stable; codebase changes only through planned phases)
