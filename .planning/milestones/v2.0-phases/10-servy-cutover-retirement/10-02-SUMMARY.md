---
phase: 10-servy-cutover-retirement
plan: 02
subsystem: infra
tags: [servy, powershell, windows-service, deployment, ops]

# Dependency graph
requires:
  - phase: 08-scheduler-real-time
    provides: "CronScheduler and SSE for always-on operation"
  - phase: 09-operational-web-ui
    provides: "Web dashboard with schedule, logs, PO, and payment views"
provides:
  - "Idempotent PowerShell script to register SageConnect as a Windows Service via Servy"
  - "Step-by-step deployment documentation in Spanish for the ops team"
affects: [10-servy-cutover-retirement]

# Tech tracking
tech-stack:
  added: [servy-cli, powershell]
  patterns: [idempotent-installation-script, parameterized-defaults]

key-files:
  created:
    - scripts/install-service.ps1
    - docs/DEPLOYMENT.md

key-decisions:
  - "Used servy-cli (on PATH after winget install) instead of PowerShell module import for portability"
  - "Script accepts parameterized defaults (InstallDir, NodePath, ServiceName, Port) for flexibility across environments"
  - "Documentation written in Spanish as team language"

patterns-established:
  - "Idempotent service registration: check Get-Service before installing, exit 0 if exists"
  - "Pre-flight validation: admin check, tool availability, paths, entry point before any modifications"

requirements-completed: [DEPLOY-01]

# Metrics
duration: 2min
completed: 2026-03-24
---

# Phase 10 Plan 02: Servy Installation Script + Deployment Docs Summary

**Idempotent PowerShell script registering SageConnect as a Windows Service via Servy CLI with auto-start, crash recovery, log rotation, and health monitoring, plus full Spanish deployment documentation covering cutover, verification, rollback, and troubleshooting**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-24T18:43:33Z
- **Completed:** 2026-03-24T18:46:02Z
- **Tasks:** 1
- **Files created:** 2

## Accomplishments
- PowerShell script with 5 pre-flight checks (admin, servy-cli, Node.js, install dir, existing service) and idempotent behavior
- Servy CLI install with all required flags: Automatic startup, RestartService recovery (5 max attempts), 10MB/5-file log rotation, 30s heartbeat health monitoring, 30s stop timeout
- Comprehensive deployment guide in Spanish: prerequisites, 5-step cutover procedure, verification table, service commands, rollback procedure, troubleshooting for 5 common issues

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Servy installation script and deployment documentation** - `398012e` (feat)

## Files Created/Modified
- `scripts/install-service.ps1` - Idempotent Servy service registration script (186 lines)
- `docs/DEPLOYMENT.md` - Step-by-step deployment and cutover procedure in Spanish (308 lines)

## Decisions Made
- Used `servy-cli` CLI interface instead of importing `Servy.psm1` PowerShell module directly -- `servy-cli` is on PATH after `winget install servy`, more portable across different install configurations
- Script accepts parameterized defaults (`-InstallDir`, `-NodePath`, `-ServiceName`, `-Port`) so the same script works if production paths change
- Health check note documents that `--enableHealth` monitors process health via heartbeat; includes comment about configuring HTTP health URL (`/api/system/health`) if needed in the future
- Documentation written entirely in Spanish (team language per CONTEXT.md)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. The install script is run on the production server during cutover.

## Next Phase Readiness
- Servy installation tooling ready for production deployment
- Plan 10-01 (legacy code removal) is the companion plan that removes AutoShutdownService, AUTO_TERMINATE, RunSageconnect.bat, and related dead code
- After both plans complete, SageConnect v2.0 is ready for production cutover

## Self-Check: PASSED

All artifacts verified:
- `scripts/install-service.ps1` -- FOUND
- `docs/DEPLOYMENT.md` -- FOUND
- Commit `398012e` -- FOUND
- `10-02-SUMMARY.md` -- FOUND

---
*Phase: 10-servy-cutover-retirement*
*Completed: 2026-03-24*
