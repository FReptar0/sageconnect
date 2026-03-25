# Phase 6: Infrastructure Foundation - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Refactor all 13 scripts to return structured data objects, eliminate process.exit from always-on code paths, and create a shared SQL connection pool singleton. Existing CLI behavior (console output, exit codes) must be preserved for backward compatibility. No new endpoints or UI changes in this phase.

</domain>

<decisions>
## Implementation Decisions

### Script return contract
- Unified envelope for ALL scripts: `{ success, data, errors, summary, meta: { duration, timestamp, tenant } }`
- Metadata (duration, timestamp, tenant) always included in the envelope — useful for audit/logging in web UI later
- Multi-mode scripts (e.g., payment-uuid-repair with scan/repair/upload) export separate functions per mode, not a single function with mode parameter
- Each exported function maps 1:1 to a future API endpoint

### Console output strategy
- Dual output: scripts keep all console.log/table/warn for CLI usage AND return structured data from exported functions
- Both paths work simultaneously — zero CLI regression
- console.table handling per script at Claude's discretion

### SQL pool lifecycle
- Single shared pool connected to default database, switch with `USE [database]` before each query
- `runQuery(query, database)` signature stays identical — zero changes needed in 30+ callers
- Auto-reconnect on connection drops — transparent to callers, critical for always-on reliability
- Pool created once at startup, reused across all script executions and background processes

### process.exit handling
- **config.js**: Keep `process.exit(1)` on startup validation — fail-fast on bad config is correct behavior
- **PortalOC_StatusUpdater.js**: Full refactor — this was originally built for a Sage 300 button, will become a web UI action instead. Extract logic into exported async function, remove auto-execute, remove all 7 process.exit calls
- **All other files**: Remove process.exit entirely. The system must be operational at all times. Claude analyzes each of the 30 calls and replaces with the appropriate pattern (error envelope return, throw, or log-and-continue) based on context
- **Scripts**: Add `if (require.main === module)` guard for CLI execution path (arg parsing, console output, process.exit for CLI exit codes). Exported functions never call process.exit

### Claude's Discretion
- Per-script refactor depth for the 5 scripts that don't export anything (wrap vs light refactor based on complexity)
- console.table replacement strategy per script
- Specific process.exit replacement pattern per call site (return error vs throw vs log-and-continue)

</decisions>

<specifics>
## Specific Ideas

- PortalOC_StatusUpdater was originally designed as a Sage 300 button action — it auto-executes on require with no guard. The web UI will replace this use case, so full isolation/refactor is appropriate.
- The unified envelope `{ success, data, errors, summary, meta }` should be consistent enough that Phase 7 (API layer) can wrap any script result directly into HTTP responses without transformation.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SQLServerConnection.js` (32 LOC): Current pool-per-query implementation — will be refactored to singleton with auto-reconnect
- `logGenerator()`: Winston-based logging already in place, scripts should continue using it
- `config.js`: Centralized config loader — pool will use `config.database.*` properties

### Established Patterns
- CommonJS `module.exports = { functionName }` everywhere — new exports follow this pattern
- 8 of 13 scripts already export functions via `module.exports` — extend existing pattern
- Error handling returns `false` or error objects, not thrown exceptions — consistent with envelope approach
- `testId` parameter threaded through async operations for tracing

### Integration Points
- `runQuery(query, database)` called by 30+ files — signature must not change
- `src/background.js` calls controllers sequentially via `forResponse()` — will need to not call process.exit after completion
- `src/index.js` orchestrates server + background — process.exit calls here control lifecycle

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-infrastructure-foundation*
*Context gathered: 2026-03-23*
