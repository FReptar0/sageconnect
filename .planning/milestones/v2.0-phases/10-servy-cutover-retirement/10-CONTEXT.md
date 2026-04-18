# Phase 10: Servy Cutover + Retirement - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Register SageConnect as a native Windows Service via Servy, remove all legacy process lifecycle artifacts (AutoShutdownService, AUTO_TERMINATE, RunSageconnect.bat, --web-only mode, shutdown route), and provide deployment documentation. This is the final phase of v2.0.

</domain>

<decisions>
## Implementation Decisions

### Servy configuration
- Servy is NOT installed yet — include installation in deliverables
- Deliver both: PowerShell automation script (`scripts/install-service.ps1`) + step-by-step README for ops team understanding
- Production server runs Node.js v22.15.0 — no compatibility concerns
- Servy manages: auto-start on boot, restart on crash, log rotation, health monitoring
- Service name: "SageConnect"

### Legacy code removal — complete removal, no backward compat
- **Remove entirely:**
  - `src/services/AutoShutdownService.js` — the file itself
  - All imports/references to AutoShutdownService across the codebase
  - `AUTO_TERMINATE` env var from config.js validation + config object
  - `autoTerminate` logic in index.js (dual-mode) — always-on mode becomes the only mode
  - `--web-only` CLI argument parsing and mode in index.js
  - `RunSageconnect.bat` — delete the file
  - `POST /api/shutdown` route — remove entirely (was returning 403 in always-on mode)
  - `/api/shutdown-status` route — remove (referenced AutoShutdownService)
  - Shutdown button/status from dashboard UI (logs.html)
- **Keep:** config.js `process.exit(1)` on startup validation (fail-fast on bad config)

### Deployment transition plan
- **Cutover sequence:** Stop Task Scheduler job → deploy v2.0 code → install Servy → start service. Brief downtime (minutes).
- **Rollback:** Keep RunSageconnect.bat in a backup location (not in repo, on server). Re-enable Task Scheduler job if Servy fails. Code still works in legacy mode during rollback since the Task Scheduler can just call `npm start`.
- **No parallel operation** — stop old, start new. Avoids port 3030 conflicts.

### Claude's Discretion
- Servy CLI flags and configuration options (restart delay, log path, health check URL)
- Exact PowerShell script implementation
- Which files need config.js `autoTerminate` references cleaned up
- Order of removal operations to keep each commit valid

</decisions>

<specifics>
## Specific Ideas

- The PowerShell script should be idempotent — safe to run multiple times (check if service already exists before creating)
- README should include: prerequisites, installation steps, verification steps, how to check logs, how to restart, rollback procedure
- After all legacy removal, index.js should be simplified: just start server + initialize cron scheduler. No mode switching, no arg parsing.

</specifics>

<code_context>
## Existing Code Insights

### Files to Remove
- `src/services/AutoShutdownService.js` — shutdown timer service
- `RunSageconnect.bat` — Windows Task Scheduler launcher

### Files to Modify (legacy removal)
- `src/index.js` — remove --web-only parsing, autoTerminate branches, simplify to always-on only
- `src/config.js` — remove AUTO_TERMINATE from env vars and config object
- `src/routes/dashboard-routes.js` — remove /api/shutdown and /api/shutdown-status routes
- `public/logs.html` — remove shutdown button/status UI elements
- `.env.example` — remove AUTO_TERMINATE variable

### Files to Create
- `scripts/install-service.ps1` — Servy installation + registration script
- README section or DEPLOYMENT.md — deployment/cutover documentation

### Integration Points
- `src/server.js` — may import AutoShutdownService (check and remove)
- `src/routes/routes.js` — shutdown-related route mounting
- `package.json` — remove web-only npm script if exists

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-servy-cutover-retirement*
*Context gathered: 2026-03-24*
