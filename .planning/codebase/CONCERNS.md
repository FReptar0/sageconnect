# Codebase Concerns

**Analysis Date:** 2026-03-12 (initial), updated 2026-04-27 (post-Phase 17 hotfix cascade)

## Tech Debt

**SQL Injection Vulnerability:**
- Issue: Direct string interpolation in SQL queries throughout the codebase using template literals (`${variable}`), bypassing parameterized queries. This is a critical security vulnerability.
- Files:
  - `src/services/ProviderIdResolver.js` (lines 33, 37-38, 63-71)
  - `src/services/UuidResolver.js` (lines 44, 49-50, 69-77)
  - `src/controller/SagePaymentController.js` (lines 149, 214)
  - `src/utils/GetTypesCFDI.js` (lines 91, 100)
  - `src/scripts/portal-payments-generator.js` (line 60)
  - `src/scripts/payment-uuid-repair.js` (multiple locations)
- Impact: Attackers could exploit these injection points to extract sensitive data, modify database records, or escalate privileges if malicious data enters these functions (e.g., via API responses, file uploads).
- Fix approach: Replace all direct string interpolation with parameterized queries using mssql's prepared statements or use `pool.request().input()` method instead of template literals.

**Database Connection Pooling Issues:** *(partially resolved 2026-04-27 by PR #16 — singleton pool + always-prepend `USE [DB]`)*
- Original issue: `SQLServerConnection.js` created a new connection pool per query and closed it immediately, defeating pooling.
- Resolution status: Singleton pool implemented; `runQuery` now always prepends `USE [database]` so pool reuse cannot leak DB context (prod regression observed where session retained `USE [FESA]` then queries against COPDAT failed silently). Default DB now resolves at runtime from `config.database.database`.
- Remaining gap: No retry logic for transient connection failures (see "Missing Connection Error Handling" below). No bounded pool size override (uses mssql defaults — see "Database Connection Limits" under Scaling).
- Files: `src/utils/SQLServerConnection.js`, `tests/SQLServerConnection.test.js`
- Lessons captured: see "Implicit Defaults in Shared Helpers" tech-debt entry below — PR #16 changed the `database` default and broke 7 callers (PR #19 follow-up).

**Missing TODO Items:**
- Issue: 3 TODO comments indicate unfinished functionality related to metadata value handling in purchase order creation
- Files:
  - `src/controller/PortalOC_Creator.js` (line 206)
  - `src/scripts/po-upload.js` (line 227)
  - `src/scripts/po-query.js` (line 228)
- Impact: Purchase orders with empty metadata values may not be handled correctly, potentially causing API errors or incomplete data transmission
- Fix approach: Implement logic to send "none" or null values when metadata values are empty, with proper validation

**Inconsistent Error Handling:**
- Issue: Some promises use `.catch()` chains with await, some have silent error suppression, and some throw unhandled errors. No centralized error handling strategy.
- Files: Multiple locations including:
  - `src/services/ProviderIdResolver.js` (line 46, 51 - silent catch blocks)
  - `src/services/UuidResolver.js` (line 58 - silent catch block)
  - `src/scripts/payment-uuid-repair.js` (line 287)
  - `src/background.js` (various error handlers)
- Impact: Errors may be silently swallowed, making debugging difficult. Some errors propagate uncaught while others are logged inconsistently.
- Fix approach: Create a centralized error handling utility with consistent logging, error categorization (retryable vs. fatal), and proper propagation strategy.

**Missing Connection Error Handling:**
- Issue: `SQLServerConnection.js` does not handle connection failures or timeouts gracefully - no retry logic or timeout handling
- Files: `src/utils/SQLServerConnection.js`
- Impact: A temporary database connection failure causes immediate script failure. No resilience for transient network issues.
- Fix approach: Add retry logic with exponential backoff, proper timeout handling, and connection validation before use.

**Hardcoded Environment File Path:**
- Issue: Multiple files hardcode `.env.credentials.focaltec` as the credentials file path, preventing flexible deployment across environments
- Files: `src/background.js` (line 21), `src/controller/PortalOC_LifecycleManager.js` (line 6), and many others
- Impact: Cannot easily switch between development/staging/production credentials without code changes. Deployment flexibility limited.
- Fix approach: Use a single centralized configuration loader that reads from environment variable to determine which credentials file to load.

### Always-On Cutover Debt (added 2026-04-27)

The v2.0 Servy cutover (Phase 10) was a mechanical wrap of the existing batch-mode Node process; the *implications* of going from "exits each cycle" to "runs forever" were never audited. Phase 17's deploy day surfaced 5 latent bugs in 1h56m. See `.planning/forensics/report-20260427-220000.md` for full analysis. Remaining debt items below.

**Always-On Assumption Gap:**
- Issue: Several primitives across the codebase still assume the process exits between cycles (FD reclamation, pool short-lifetime, occasional API calls, no operator interaction). Phase 17 patched the worst symptoms but other always-on assumptions likely remain in `setInterval`, `setTimeout`, EventEmitter listeners, child_process spawns, and any module that retains state in module scope.
- Files: System-wide. Notable already-fixed examples: `src/utils/LogGenerator.js` (logger cache, PR #14), `src/utils/SQLServerConnection.js` (pool reuse, PR #16), `src/server.js` (rate limit, PR #17). Notable to-audit: `src/services/CronScheduler.js` (`node-cron` long-lived), `src/services/OperationManager.js` (Map state retained across cycles + EventEmitter listeners), `src/background.js` (child_process orchestration).
- Impact: Each unaudited always-on assumption is a potential production incident waiting for the right trigger. Phase 18 touches `setTimeout` for stuck-lock auto-release — exactly the class of primitive that decays under always-on without explicit retention/cleanup.
- Fix approach: Pre-Phase 18 — read `.planning/phases/<phase-18>/CONTEXT.md` through the lens "what assumes the process exits?" Write `always-on` as a first-class constraint into `CLAUDE.md` or `.planning/PROJECT.md` so future code reviews catch it. Long-term — add a soak-test harness (see "No Long-Running Soak Test" below).

**Confirmed production impact (2026-04-27, Capstone Copper):**
A spreadsheet from Capstone showed 6 RCP records for vendor SANDVIK MINING with the "matched CFDI" column blank (RCPs dated 2026-04-23; invoices AI000654119/120/125/126/127/130; UUIDs `B7CFEACF-…`, `BE1FF5F3-…`, `F53790C3-…`, `F136DF6B-…`, `B4D66792-…`, `980997B6-…`). Investigation traced the apparent 4-day gap to two distinct delays:
  1. **~3 days in Capstone's internal authorization workflow** (out of our control). Per portal HISTORIAL: Sandvik uploaded the CFDIs on 2026-04-24 13:30, status "Por enviar" → "Por autorizar" by 13:32; then sat in "Por autorizar" until 2026-04-27 10:04 when Capstone's despachador (Cornelio López) authorized → status "Pendiente de pago". `getTypeI` filters by `stage=PENDING_TO_PAY`, so the CFDIs were *invisible* to our pipeline during this window.
  2. **~6 hours of in-our-pipeline delay** (always-on bug cascade). Once eligible at 10:04, the next ~6 hours of cron ticks failed to process them due to the EMFILE crash loop and the brief PR#16-without-PR#19 window where `getTypeI`'s "already-timbrado" check could land on the wrong DB. Successful processing only happened at 16:04 — the first cron run after the final hotfix (PR #19 deploy at ~15:38).
  
Lesson: the always-on bug cascade was *not* the dominant cause for this specific spreadsheet (Capstone's authorization SLA dwarfs our 6h gap), but the gap was **measurable and operator-visible**. Without Phase 17's observability work, this 6h would have been indistinguishable from "service running fine." Confirms that always-on regressions aren't always loud crashes — they can be silent processing gaps that look like supplier delays from the outside.

**Implicit Defaults in Shared Helpers:**
- Issue: `runQuery(query, database = config.database.database)` is the cautionary tale. PR #16 changed the default *correctly in isolation*, but 7 callers had silently depended on the old literal `'FESA'` default. PR #19 fixed it by passing `'FESA'` explicitly to all 7 sites. The same pattern likely lives elsewhere — any function-with-default in a shared utility is a latent regression vector if the default ever changes.
- Files: Audit needed across `src/utils/` and `src/services/`. Confirmed instances post-PR #19: `src/utils/GetTypesCFDI.js` (4 sites), `src/controller/CFDI_Downloader.js` (1 site), `src/controller/SagePaymentController.js` (2 sites) — all now explicit.
- Impact: Hidden coupling — a "safe" default change in a shared helper can break N callers across N files without any compile-time signal. Tests caught one of the 7 cases (FESA test); the other 6 only manifested in production.
- Fix approach: Long-term — consider making `database` a *required* parameter on `runQuery`, eliminating the default entirely. Verbose but eliminates the bug class. Short-term — when modifying any shared helper signature, grep for all call sites and verify intent of each.

**No Long-Running Soak Test:**
- Issue: There is no test class — local, CI, or staging — that runs the service for 30+ minutes under synthetic load (cron tick + dashboard polling) and asserts FD count stable, pool stats stable, memory stable, log size bounded. This is the test that would have caught EMFILE (PR #14), pool reuse (PR #16), and rate-limit exhaustion (PR #17) before deploy.
- Files: `tests/` has only unit tests; no harness for the always-on regime.
- Impact: Always-on regression class is invisible until production. Each future phase that touches long-running primitives is exposed.
- Fix approach: Add a `tests/soak/` harness that boots the service, hits `/api/operations/status` every 5s for 30 min, fires a synthetic cron tick every 5 min, then asserts `lsof -p <pid>` count, `/api/operations/status` shape stability, log file growth bounded, and process RSS stable within ±20%.

**Hardcoded Rate Limits:**
- Issue: `src/server.js` has `windowMs` and `limit` literals (currently 15-min / 2000 req post-PR #17). Changing the polling cadence again requires a code commit + deploy, when the operational reality is this is a config-shaped concern.
- Files: `src/server.js`
- Impact: Operational tuning requires code changes; can't be hot-tuned in prod by editing `.env`. Likelihood of getting caught again with wrong number under load.
- Fix approach: Move to `.env` as `RATE_LIMIT_WINDOW_MS` + `RATE_LIMIT_MAX`. Default to current values for backward compat.

**Undocumented Always-On Constraint:**
- Issue: Neither `CLAUDE.md` nor `.planning/PROJECT.md` explicitly states "this service is always-on; assume the process never restarts when writing new code." Future developers (human or LLM) will reintroduce batch-era assumptions because the constraint is implicit.
- Files: `CLAUDE.md` (root), `.planning/PROJECT.md`, possibly `docs/ARCHITECTURE.md`
- Impact: Re-forgetting the constraint guarantees re-experiencing the cascade.
- Fix approach: Add a clearly labelled "Runtime Constraint: Always-On" section to PROJECT.md that lists the consequences (FD lifecycle, pool reuse, polling load, default-stability, etc.) and links to `.planning/forensics/report-20260427-220000.md` as the worked example.

## Known Bugs

**UUID Resolution Incomplete Fallback:**
- Symptoms: Payment CFDI uploads fail when folio/serie matching logic doesn't find exact matches
- Files: `src/services/UuidResolver.js` (lines 29-33)
- Trigger: When portal CFDI folio format differs slightly from Sage invoice ID format
- Workaround: Manual database updates to APIBHO FOLIOCFD field. Script `payment-uuid-repair.js` provides partial automation.

**Metadata Value Lookup Missing Default Handling:**
- Symptoms: Purchase orders fail to upload if metadata values (like PROVIDERID) are empty strings instead of properly handled nulls
- Files: `src/controller/PortalPaymentController.js` (line 130), `src/scripts/portal-payments-generator.js` (line 124)
- Trigger: Providers without RFC or PROVIDERID configuration in Sage APVENO table
- Workaround: Manually configure RFC and PROVIDERID in APVENO table before uploading orders

**Async Payment Processing Race Condition:**
- Symptoms: Duplicate payment records in `fesaPagosFocaltec` when concurrent uploads process same payment
- Files: `src/controller/PortalPaymentController.js` (lines 81-95)
- Trigger: Fast consecutive calls to `uploadPayments()` before previous completion
- Workaround: Ensure sequential execution by waiting for logs to complete before re-running

## Security Considerations

**SQL Injection Risk (Critical):**
- Risk: Unparameterized SQL queries allow injection via any untrusted data source (API responses, user input, file uploads)
- Files: All database query files listed under Tech Debt section above
- Current mitigation: None - data validation is done with `.trim()` but not SQL escaping
- Recommendations:
  1. Immediate: Implement parameterized queries across entire codebase
  2. Add SQL injection detection and prevention linting rules
  3. Implement input validation schema before database operations

**API Credential Exposure:**
- Risk: API keys and secrets split across multiple environment variables and potentially logged in error messages
- Files: `src/background.js`, all controller files load from `.env.credentials.focaltec`
- Current mitigation: Environment file isolation, not in git (if properly configured)
- Recommendations:
  1. Add secret detection to git hooks (e.g., detect API_KEY pattern)
  2. Review all `console.log()` and error logging to ensure secrets aren't logged
  3. Consider rotating credentials regularly

**Missing Request Validation:**
- Risk: Express routes in `src/routes/routes.js` may accept malformed requests without proper validation
- Files: `src/routes/routes.js`
- Current mitigation: Some Joi validation in `src/scripts/upload-authorized-pos.js` but not consistently applied
- Recommendations:
  1. Add request validation middleware to all HTTP endpoints
  2. Use Joi schema validation on all incoming data
  3. Implement rate limiting and request size limits

**Unencrypted Data Transmission:**
- Risk: Email credentials and payment data may be transmitted without proper HTTPS enforcement
- Files: `src/utils/EmailSender.js`, `src/controller/PortalPaymentController.js`
- Current mitigation: Relies on environment configuration for HTTPS
- Recommendations: Verify HTTPS enforcement at application and infrastructure level

## Performance Bottlenecks

**Large File Processing Without Streaming:**
- Problem: Log files and CSV data read entirely into memory before processing
- Files: `src/services/LogDashboardService.js` (line 75), multiple script files
- Cause: Using `fs.readFileSync()` for full file content
- Improvement path: Implement streaming for large files, paginate log reads, implement cursor-based fetching

**N+1 Database Query Pattern:**
- Problem: For each payment record, additional queries execute to fetch metadata (PROVIDERID, RFC)
- Files: `src/controller/PortalPaymentController.js` (lines 52-86 uses subqueries, but repeated for each row in processing loop)
- Cause: Metadata lookups implemented as subqueries instead of JOIN operations
- Improvement path: Refactor metadata queries to use JOINs or batch lookups; pre-fetch all metadata once per run

**Synchronous Array Processing in Loops:**
- Problem: Payment/order processing loops await each item sequentially instead of using Promise.all()
- Files: `src/scripts/payment-uuid-repair.js` (line 287+), `src/scripts/upload-authorized-pos.js` (line 272+)
- Cause: Manual loop with sequential `await` inside
- Improvement path: Batch requests using `Promise.all()` with configurable concurrency limits (e.g., 5-10 parallel)

**Missing Index Analysis:**
- Problem: Complex queries with multiple JOINs and conditions may lack proper database indexes
- Files: `src/controller/PortalOC_Creator.js` (lines 84-185 with complex SQL)
- Cause: No index optimization documented
- Improvement path: Analyze slow query logs, add composite indexes for frequently filtered column combinations

**Timezone Conversion Overhead:**
- Problem: `TimezoneHelper` converts dates repeatedly for each record processed
- Files: `src/utils/TimezoneHelper.js` used throughout processing loops
- Cause: No caching of timezone configuration
- Improvement path: Cache timezone instance at startup, calculate dates once and reuse

## Fragile Areas

**Payment UUID Repair Script (`src/scripts/payment-uuid-repair.js`):**
- Files: 1211 lines, highly complex with multiple interconnected subsystems
- Why fragile:
  - State file persistence with manual JSON manipulation
  - Complex matching logic with scoring (best-fit folio matching)
  - Multiple nested API calls and database queries
  - Error recovery logic that may leave partial state
  - CLI parsing is manual and error-prone
- Safe modification:
  - Add unit tests for matching algorithm
  - Refactor state management to use proper ORM or state manager
  - Extract matching logic into separate testable module
  - Add transaction support for repairs
- Test coverage: None - no test file exists for this critical script

**LogDashboardService (`src/services/LogDashboardService.js`):**
- Files: 424 lines, reads raw log files and performs complex aggregations
- Why fragile:
  - String-based log parsing without structured format
  - Regex matching for log level detection could break with format changes
  - No validation of log file format
  - File system assumptions about directory structure
- Safe modification:
  - Implement structured logging (JSON or similar)
  - Add log format validation
  - Use dedicated log parsing library
  - Add integration tests with sample log files
- Test coverage: None

**PortalOC_LifecycleManager (`src/controller/PortalOC_LifecycleManager.js`):**
- Files: 402 lines, orchestrates multiple order processing steps
- Why fragile:
  - Multiple sequential operations without transaction boundaries
  - Partial failure scenarios not well handled (what if step 2 fails after step 1 completes?)
  - No rollback mechanism
  - Address configuration passed through multiple layers
- Safe modification:
  - Implement transaction wrapper for multi-step operations
  - Add rollback/compensation logic
  - Test failure scenarios at each step
  - Reduce configuration coupling
- Test coverage: None

**Complex SQL Queries:**
- Files: `src/controller/PortalPaymentController.js` (lines 33-101), `src/controller/PortalOC_Creator.js` (lines 84-185)
- Why fragile:
  - 70+ line SQL statements with deep nesting
  - Hardcoded table joins without validation
  - Complex date/time logic in SQL
  - No stored procedure abstraction
- Safe modification:
  - Break large queries into smaller reusable pieces
  - Consider moving complex logic to stored procedures
  - Add query result validation
  - Test with edge cases (date boundaries, null values)
- Test coverage: Basic only

## Scaling Limits

**Database Connection Limits:**
- Current capacity: Single connection pool with default mssql settings (typically 10 concurrent connections)
- Limit: Script runs that spawn multiple child processes or concurrent tenant processing will exhaust connection pool
- Scaling path:
  1. Implement proper connection pooling with configurable pool size
  2. Add connection queue management
  3. Monitor connection usage with metrics

**Memory Usage in Batch Operations:**
- Current capacity: Loads entire payment/order lists into memory before processing
- Limit: Processing hundreds of thousands of records simultaneously will cause OOM errors
- Scaling path:
  1. Implement pagination/cursor-based iteration
  2. Use streaming for large data sets
  3. Add memory monitoring and graceful degradation

**API Rate Limiting:**
- Current capacity: No rate limiting observed on Portal de Proveedores API calls
- Limit: Rapid consecutive requests may trigger API throttling
- Scaling path:
  1. Implement request queue with configurable rate limits
  2. Add exponential backoff with jitter
  3. Track API quota and warn when approaching limits

**Multi-Tenant Processing:**
- Current capacity: Sequential tenant processing in loops
- Limit: Adding more tenants linearly increases total runtime
- Scaling path:
  1. Implement parallel tenant processing with worker pool
  2. Use job queue (Bull, RabbitMQ) for distributed processing
  3. Add tenant-specific resource throttling

## Dependencies at Risk

**mssql@11.0.1:**
- Risk: SQL Server client library lacks built-in connection pooling optimization. Requires manual pool management.
- Impact: Poor performance from connection exhaustion, no automatic reconnection handling
- Migration plan: Evaluate Tedious library or native driver enhancements; consider ORM like Sequelize or TypeORM for better pooling

**axios@1.7.7:**
- Risk: No built-in request retries or circuit breaker for Portal de Proveedores API calls
- Impact: Transient API failures cause script failures instead of graceful handling
- Migration plan: Wrap axios with retry logic utility or migrate to axios-retry package

**dotenv@16.4.5:**
- Risk: No validation of required environment variables at startup
- Impact: Missing credentials discovered at runtime in the middle of processing
- Migration plan: Create config validation module that runs at startup, migrate to env-var with validation

**winston/log4js Dual Usage:**
- Risk: Two different logging libraries used inconsistently across codebase
- Impact: Inconsistent log format, difficult to aggregate and analyze logs
- Migration plan: Consolidate on single logging framework (recommend winston with structured logging)

**No Validation Library Standardization:**
- Risk: Joi used in some places but manual validation elsewhere
- Impact: Inconsistent error messages, some validation gaps go undetected
- Migration plan: Create validation service layer, use Joi schema definitions for all input validation

## Missing Critical Features

**Distributed Transaction Support:**
- Problem: Multi-step operations (payment upload -> UUID repair -> reconciliation) have no ACID guarantees. Partial failures leave inconsistent state.
- Blocks: Can't safely roll back multi-tenant operations or handle mid-process failures

**Request/Response Auditing:**
- Problem: No centralized audit log for all Portal API requests/responses for compliance and debugging
- Blocks: Can't trace payment history or prove what data was sent/received at specific times

**Circuit Breaker Pattern:**
- Problem: Cascading failures when Portal API becomes unavailable - scripts keep retrying without backoff
- Blocks: Resilience under degraded conditions

**Health Check Endpoints:**
- Problem: No way to monitor if integration is functioning without running full processing scripts
- Blocks: Alerting and proactive issue detection

**Deduplication & Idempotency Keys:**
- Problem: No mechanism to prevent duplicate submissions if requests are retried
- Blocks: Safe retry logic, exactly-once delivery semantics

## Test Coverage Gaps

**Database Operations (Critical):**
- What's not tested: SQL query construction, database interactions, connection handling
- Files: `src/utils/SQLServerConnection.js`, `src/services/ProviderIdResolver.js`, `src/services/UuidResolver.js`
- Risk: SQL injection, data corruption, connection leaks go undetected
- Priority: High - immediately add parameterized query tests

**Payment Upload Logic:**
- What's not tested: Payment validation, duplicate detection, API submission flow
- Files: `src/controller/PortalPaymentController.js`
- Risk: Duplicate payments submitted, invalid data passed to API, silent failures
- Priority: High - 371 lines of untested controller code

**CFDI Processing:**
- What's not tested: CFDI download, transformation, UUID matching algorithm
- Files: `src/controller/CFDI_Downloader.js`, `src/utils/GetTypesCFDI.js`
- Risk: Missed CFDIs, incorrect transformations, mismatched UUIDs
- Priority: High - complex business logic without coverage

**Purchase Order Lifecycle:**
- What's not tested: Order creation, cancellation, status updates, partial cancellation handling
- Files: `src/controller/PortalOC_Creator.js`, `src/controller/PortalOC_Closer.js`, `src/controller/PortalOC_LifecycleManager.js`
- Risk: Orders created with incorrect data, lifecycle state inconsistencies
- Priority: High - core business logic coverage is < 10%

**Error Scenarios:**
- What's not tested: Network timeouts, API errors, database connection failures, invalid data handling
- Files: All controller and script files
- Risk: Unknown behavior under failure conditions
- Priority: Medium - add happy path tests first, then error cases

**Script Utilities (Diagnostic Tools):**
- What's not tested: po-diagnostic, po-payment-form-diagnostic, payment-uuid-diagnostic scripts
- Files: `src/scripts/po-*.js` diagnostic files (multiple)
- Risk: False diagnostics mislead troubleshooting
- Priority: Medium - can be tested with mocked data

**Current Test Files Status:**
- `tests/SQLServerConnection.test.js`: Placeholder only (1 dummy test)
- `tests/TransformTime.test.js`: Placeholder only (empty)
- `tests/EmailSender.test.js`: Minimal coverage
- `tests/EnhancedPaymentSync.test.js`: Has actual tests but for deprecated module
- `tests/GetPaymentCFDI.test.js`: Partial coverage
- Coverage estimate: < 15% of codebase covered by meaningful tests

---

*Concerns audit: 2026-03-12*
