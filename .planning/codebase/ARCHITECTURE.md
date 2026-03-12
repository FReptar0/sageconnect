# Architecture

**Analysis Date:** 2026-03-12

## Pattern Overview

**Overall:** Multi-tenant CFDI (electronic invoice) processor with dual runtime modes - web server for dashboard management and background process orchestrator for automated imports/reconciliation.

**Key Characteristics:**
- Dual entry points: Express web server (`src/server.js`) + background process orchestrator (`src/background.js`)
- Tenant-based isolation: Configuration supports multiple tenants via environment variable arrays
- External API-driven: Integrates with FocalTec Portal de Proveedores API for CFDI data
- SQL Server database layer: Direct queries for Sage 300 ERP data access
- Sequential processing pipeline: CFDI download → payment verification → upload → purchase order lifecycle management
- Multi-stage orchestration: Manages lifecycle from CFDI import to purchase order closure

## Layers

**Web Layer (Express):**
- Purpose: Serve dashboard UI and API endpoints for monitoring/control
- Location: `src/server.js`, `src/routes/routes.js`
- Contains: HTTP routes, JSON API endpoints, static file serving
- Depends on: Services (LogDashboardService, AutoShutdownService), utilities (LogGenerator)
- Used by: Browser clients accessing dashboard

**Controller/Orchestration Layer:**
- Purpose: Orchestrate high-level business processes across multiple tenants
- Location: `src/controller/`, `src/background.js`
- Contains: CFDI downloader, payment processor, purchase order lifecycle managers, provider downloader
- Depends on: Services, utilities, database connection
- Used by: Background process (`startBackgroundProcesses()`), API routes

**Service Layer:**
- Purpose: Support business logic with specialized concerns (logging, provider resolution, UUID mapping)
- Location: `src/services/`
- Contains: LogDashboardService (log aggregation), AutoShutdownService (graceful shutdown), ProviderIdResolver (map vendor IDs), UuidResolver (resolve invoice UUIDs)
- Depends on: Utilities, database connection, external APIs
- Used by: Controllers, utilities

**Data/Utility Layer:**
- Purpose: Provide database access, external API calls, data transformation, logging
- Location: `src/utils/`
- Contains: SQLServerConnection (MSSQL queries), GetTypesCFDI (CFDI retrieval), GetProviders (provider lookup), EmailSender (notifications), TimezoneHelper (date handling), LogGenerator (file logging)
- Depends on: External libraries (axios, mssql, winston, nodemailer)
- Used by: Controllers, services

**Model Layer:**
- Purpose: Define data validation schemas
- Location: `src/models/PurchaseOrder.js`
- Contains: Joi validation schemas for external purchase order requests (addresses, taxes, line items)
- Depends on: Joi validation library
- Used by: Controllers during data validation

## Data Flow

**Background Process (forResponse Orchestration):**

1. Load environment credentials (`.env.credentials.focaltec`, `.env`)
2. Iterate through tenant indices (from TENANT_ID array)
3. For each tenant, execute in sequence:
   - `buildProvidersXML(i)` → Download providers from FocalTec API
   - `downloadCFDI(i)` → Retrieve CFDI documents from FocalTec Portal
   - `checkPayments(i)` → Validate payments against Sage 300 database
   - `uploadPayments(i)` → Post payment confirmations to Portal
   - `createPurchaseOrders(i)` → Create new purchase orders in Portal from Sage data
   - `processOrderChanges(i)` → Update existing orders with status/content changes
   - `closePurchaseOrders(i)` → Mark completed orders as closed in Portal
4. Each step includes 5-second delay between tenant iterations
5. On completion, check AUTO_TERMINATE flag for shutdown behavior

**CFDI Download Flow:**
1. Query FocalTec API for CFDI documents via `GetTypesCFDI.js`
2. Parse XML response into JavaScript objects
3. Extract payment and invoice data
4. Store in local database/memory for processing

**Payment Check & Upload Flow:**
1. Retrieve CFDI payments from Portal
2. For each payment, query Sage 300 database for idCia (company ID) via RFC lookup
3. Resolve provider ID using external_id via `ProviderIdResolver`
4. Resolve invoice UUID via `UuidResolver`
5. Format payload and POST to Portal payment endpoint
6. On success, send email notification

**Purchase Order Lifecycle:**
1. **Creation**: Query Sage ICLOC/OE tables → Build payload with addresses, line items, taxes → POST to Portal
2. **Status Updates**: Poll Portal for status changes → Update ICINQ/OE tables in Sage
3. **Content Updates**: Detect changes in Sage → Send updates to Portal (addresses, line items)
4. **Cancellation**: User cancels in Sage → POST cancellation to Portal
5. **Closure**: Order complete in Sage → POST closure to Portal

**State Management:**
- Application state: Tenant indices in memory, environment configuration in dotenv
- Database state: Sage 300 tables (ICLOC, OE, APVENO for vendor fields, APIBHO for invoice fields)
- External state: FocalTec Portal (CFDI documents, purchase orders, payment records)
- Log state: Winston logs written to `logs/sageconnect/YYYY-MM-DD/` directory
- No in-process caching between iterations; each cycle is stateless

## Key Abstractions

**Tenant Array Pattern:**
- Purpose: Support multiple independent Portal tenants with single codebase
- Examples: `TENANT_ID`, `API_KEY`, `API_SECRET`, `DATABASES` split by comma and indexed
- Pattern: Configuration arrays indexed by position; loops iterate `0..tenantIds.length` passing index to all downstream calls

**Provider/Vendor Resolution:**
- Purpose: Map between Sage 300 vendor IDs and FocalTec Portal provider IDs
- Examples: `src/services/ProviderIdResolver.js`, `src/utils/GetProviders.js`
- Pattern: Lookup by external_id → Write PROVIDERID to APVENO table → Use in subsequent operations

**Invoice UUID Mapping:**
- Purpose: Link Sage invoices to Portal CFDIs for payment reconciliation
- Examples: `src/services/UuidResolver.js`
- Pattern: Query Portal for CFDI by folio → Write UUID to APIBHO table → Reference in payment verification

**Payload Builder:**
- Purpose: Construct validated API request bodies from Sage database records
- Examples: `src/services/PortalOC_PayloadBuilder.js`
- Pattern: Assemble addresses, line items, taxes from multiple database queries → Validate with Joi → Return formatted object

**Log Dashboard Aggregator:**
- Purpose: Provide unified view of distributed log files across dates and processors
- Examples: `src/services/LogDashboardService.js`
- Pattern: Scan log directory → Parse lines → Return by log type → Serve via API

## Entry Points

**Web Server Entry:**
- Location: `src/index.js` → `src/server.js`
- Triggers: `npm start` or `npm run dev`
- Responsibilities: Start Express on port 3030, serve static HTML/dashboard, expose JSON API routes

**Background Process Entry:**
- Location: `src/index.js` → `src/background.js`
- Triggers: `npm start` (unless `--web-only` flag set)
- Responsibilities: Execute forResponse orchestration, invoke child process for external CFDI import, check for AUTO_TERMINATE flag

**Script Entry Points:**
- Location: `src/scripts/` (13 standalone scripts)
- Triggers: Manual execution via `node src/scripts/[script-name].js`
- Examples: `payment-reconciliation.js`, `po-diagnostic.js`, `po-upload.js`
- Purpose: One-off data operations (diagnostics, repairs, manual uploads)

## Error Handling

**Strategy:** Try-catch wrapping with error logging and email notifications; continue-on-error for tenant processing.

**Patterns:**

1. **Async Function Wrapping:**
   ```javascript
   try {
       await operation();
   } catch (error) {
       logGenerator(fileName, 'error', `Error message: ${error.message}`);
       // Continue to next iteration or send email notification
   }
   ```

2. **Database Query Wrapping:**
   ```javascript
   const result = await runQuery(query)
       .catch((err) => {
           logGenerator(logFileName, 'error', `Database error: ${err}`);
           emails.push({ h1: "Error message", p: err, status: 500 });
           return { recordset: [] };
       });
   ```

3. **Tenant Loop Resilience:**
   ```javascript
   for (let i = 0; i < tenantIds.length; i++) {
       try {
           // Process tenant
       } catch (error) {
           logGenerator(logFileName, 'error', `Error processing tenant ${i}: ${error.message}`);
           // Continue with next tenant
       }
   }
   ```

4. **Email Notification on Critical Failures:**
   - Collected errors added to `emails` array
   - Batch sent at end of operation via `sendGroupedEmails()`
   - Includes retry logic (up to 3 attempts per email)

## Cross-Cutting Concerns

**Logging:** Winston-based file logging to `logs/sageconnect/YYYY-MM-DD/[LogType].log`; also console output for debugging. LogGenerator utility called throughout codebase.

**Validation:** Joi schemas in `src/models/PurchaseOrder.js` for external purchase order API requests (addresses, line items, taxes, metadata).

**Authentication:** Static tenant credentials via environment variables (API_KEY, API_SECRET); passed as headers to FocalTec API calls.

**Multi-tenancy:** Tenant index passed through entire call stack (forResponse → controllers → services → utilities) to ensure data isolation.

**Graceful Shutdown:** Handled via SIGTERM/SIGINT signals in server; AutoShutdownService provides web-only mode timeout for preventing process conflicts.

---

*Architecture analysis: 2026-03-12*
