# Codebase Concerns

**Analysis Date:** 2026-03-12

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

**Database Connection Pooling Issues:**
- Issue: `SQLServerConnection.js` creates a new connection pool for every query execution and immediately closes it, defeating the purpose of connection pooling. This creates significant overhead.
- Files: `src/utils/SQLServerConnection.js` (lines 14-26)
- Impact:
  - Performance degradation from constant connection create/destroy cycles
  - Potential exhaustion of database connections under load
  - Increased latency for database operations
  - Wasted resources for repeated authentication
- Fix approach: Implement a singleton connection pool pattern that is created once and reused across the application. Consider using `mssql` with pre-configured pool settings.

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
