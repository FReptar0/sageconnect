# Codebase Structure

**Analysis Date:** 2026-03-12

## Directory Layout

```
sageconnect/
├── src/                          # Application source code
│   ├── index.js                 # Main entry point (orchestrates web + background)
│   ├── server.js                # Express web server setup
│   ├── background.js            # Background process orchestrator
│   ├── controller/              # High-level business process controllers
│   ├── services/                # Support services (logging, resolution, shutdown)
│   ├── utils/                   # Utilities (DB, API, transformation, logging)
│   ├── models/                  # Data validation schemas
│   ├── routes/                  # Express route handlers
│   └── scripts/                 # One-off utility scripts for diagnostics/repairs
├── public/                       # Static HTML/dashboard files
│   ├── index.html               # Main dashboard UI
│   ├── 404.html                 # Error page
│   └── img/                     # Dashboard images
├── logs/                        # Runtime log files (generated)
│   └── sageconnect/
│       └── YYYY-MM-DD/          # Daily log directories
├── reports/                     # Generated reports (if any)
├── .planning/                   # GSD planning documents
│   └── codebase/                # Architecture/structure documentation
├── .github/                     # GitHub Actions workflows
│   └── workflows/
├── .env                         # Configuration (example: .env.example)
├── .env.credentials.focaltec    # Portal credentials (excluded from git)
├── .env.credentials.database    # Database credentials (excluded from git)
├── .env.credentials.mailing     # Email credentials (excluded from git)
├── .env.path                    # Log path configuration
├── package.json                 # Dependencies and scripts
├── jest.config.js               # Jest testing configuration
├── babel.config.js              # Babel transpilation config
└── README.md                    # Project documentation
```

## Directory Purposes

**src/controller/:**
- Purpose: Orchestrate high-level business workflows for CFDI processing and purchase order management
- Contains: 10 controller files handling download, verification, upload, and lifecycle operations
- Key files:
  - `CFDI_Downloader.js`: Retrieves electronic invoices from FocalTec API
  - `SagePaymentController.js`: Validates payments against Sage 300 database
  - `PortalPaymentController.js`: Uploads verified payments to Portal
  - `PortalOC_Creator.js`: Creates purchase orders in Portal from Sage database
  - `PortalOC_LifecycleManager.js`: Processes order status and content changes
  - `PortalOC_Closer.js`: Closes completed orders
  - `PortalOC_Canceller.js`: Cancels orders
  - `PortalOC_StatusUpdater.js`: Updates individual order statuses
  - `PortalOC_ContentUpdater.js`: Modifies order line items and addresses
  - `Providers_Downloader.js`: Fetches and builds provider XML from Portal

**src/services/:**
- Purpose: Provide specialized business logic support and infrastructure concerns
- Contains: 6 services for logging, shutdown control, and ID/UUID resolution
- Key files:
  - `LogDashboardService.js`: Aggregates logs across dates/types for dashboard view
  - `AutoShutdownService.js`: Implements graceful shutdown for web-only mode with timeout
  - `ProviderIdResolver.js`: Maps vendor IDs to provider IDs and writes APVENO table
  - `UuidResolver.js`: Resolves invoice UUIDs from Portal and writes APIBHO table
  - `PortalOC_PayloadBuilder.js`: Constructs validated API request bodies
  - `PortalOC_StatusService.js`: Queries Portal order status and formats responses

**src/utils/:**
- Purpose: Provide reusable utilities for database access, API calls, data transformation, and logging
- Contains: 11 utility files for cross-cutting concerns
- Key files:
  - `SQLServerConnection.js`: MSSQL connection pool and query execution
  - `GetTypesCFDI.js`: Retrieves CFDI documents from FocalTec API with XML parsing
  - `GetProviders.js`: Queries Portal providers API with filtering
  - `EmailSender.js`: Sends notifications via SMTP
  - `LogGenerator.js`: Creates Winston log files in dated directories
  - `TimezoneHelper.js`: Date formatting and timezone handling
  - `TransformTime.js`: Time unit conversion utilities
  - `OC_GroupOrdersByNumber.js`: Groups purchase orders by order number
  - `parseExternPurchaseOrders.js`: Parses external PO data structures

**src/models/:**
- Purpose: Define data validation schemas for API request/response payloads
- Contains: 1 file with Joi validation schemas
- Key file:
  - `PurchaseOrder.js`: Schemas for addresses, line items, taxes, metadata validation

**src/routes/:**
- Purpose: Define Express HTTP routes and API endpoints
- Contains: Single router file with all endpoints
- Key file:
  - `routes.js`: Routes for email sending, dashboard data, logs, execution status, shutdown control

**src/scripts/:**
- Purpose: Standalone scripts for manual operations (diagnostics, repairs, uploads)
- Contains: 13 utility scripts
- Key files:
  - `payment-reconciliation.js`: Reconcile payments between systems
  - `po-diagnostic.js`: Diagnose purchase order issues
  - `po-upload.js`: Manually upload POs to Portal
  - `payment-uuid-repair.js`: Fix missing UUIDs in invoices
  - `get-payment-cfdis.js`: Retrieve specific CFDI payments
  - Other: address diagnostic, query utilities, order lifecycle tests

**public/:**
- Purpose: Serve static web assets for dashboard UI
- Contains: HTML pages and images
- Key files:
  - `index.html`: Main dashboard with log viewer, execution status, shutdown control
  - `404.html`: Error page

**logs/:**
- Purpose: Store runtime log files organized by date
- Contains: Daily subdirectories with process-specific log files
- Structure: `logs/sageconnect/YYYY-MM-DD/[ProcessName].log`
- Generated: At runtime; not committed to git

## Key File Locations

**Entry Points:**
- `src/index.js`: Main application entry (decides web+background vs web-only mode)
- `src/server.js`: Express server startup
- `src/background.js`: Background process orchestrator

**Configuration:**
- `package.json`: Dependencies (express, axios, mssql, winston, nodemailer, joi)
- `.env`: General configuration (addresses, timeouts, identifiers to skip)
- `.env.credentials.focaltec`: Portal API credentials (tenants, keys, secrets, databases)
- `.env.credentials.database`: SQL Server credentials (user, password, server, database)
- `.env.credentials.mailing`: Email/SMTP credentials
- `.env.path`: Log directory path
- `jest.config.js`: Testing framework configuration
- `babel.config.js`: JavaScript transpilation settings

**Core Logic:**
- `src/controller/CFDI_Downloader.js`: CFDI retrieval logic
- `src/controller/SagePaymentController.js`: Payment validation logic
- `src/controller/PortalPaymentController.js`: Payment upload logic
- `src/controller/PortalOC_Creator.js`: Purchase order creation logic
- `src/background.js`: Main orchestration loop (forResponse function)

**Testing:**
- `jest.config.js`: Test configuration
- `tests/` directory: Test files (location exists but specific files not detailed in exploration)

## Naming Conventions

**Files:**
- Controllers: `[Entity][Action].js` (e.g., `PortalOC_Creator.js`, `CFDI_Downloader.js`)
- Services: `[Service]Service.js` (e.g., `LogDashboardService.js`, `AutoShutdownService.js`)
- Utilities: `[Function][Type].js` or `[FunctionName].js` (e.g., `GetTypesCFDI.js`, `GetProviders.js`, `EmailSender.js`)
- Models: `[Entity].js` (e.g., `PurchaseOrder.js`)
- Scripts: `[action]-[object].js` (e.g., `payment-reconciliation.js`, `po-diagnostic.js`)

**Directories:**
- Lowercase with no underscores (e.g., `controller`, `services`, `utils`, `models`, `routes`)
- Exception: Log directories use date format (e.g., `2026-03-12`)

**Functions:**
- camelCase for main functions (e.g., `checkPayments`, `createPurchaseOrders`, `buildProvidersXML`)
- camelCase for async functions (e.g., `getTypeP`, `runQuery`, `sendMail`)
- Prefix utility functions with action verb (e.g., `get`, `build`, `download`, `resolve`)

**Variables:**
- camelCase for general variables (e.g., `emails`, `resultPayments`, `idCia`)
- UPPER_CASE for constants/environment variables (e.g., `TENANT_ID`, `API_KEY`, `LOG_PATH`)
- Use index suffix for array positions (e.g., `i` for tenant index, always passed as parameter)

**Types/Models:**
- PascalCase for class/schema names (e.g., `PurchaseOrder`, `BatchAddressRequest`)
- Suffixes: `Schema` for Joi validators (e.g., `addressSchema`, `vatTaxSchema`)

## Where to Add New Code

**New Feature (CFDI Processing):**
- Primary logic: Create controller file in `src/controller/[Feature]Controller.js`
- Support services: Add methods to `src/services/[Feature]Service.js` if cross-cutting
- Database queries: Add utility in `src/utils/[DataAccess].js` or extend `GetTypesCFDI.js`
- Validation: Add Joi schema to `src/models/[Entity].js`
- Routes: Add endpoint to `src/routes/routes.js`
- Orchestration: Call from `src/background.js` forResponse function in sequence
- Logging: Use `logGenerator(fileName, 'info'/'error'/'warn', message)` throughout

**New Component/Module (Support Logic):**
- Shared utility: Create `src/utils/[Utility].js` with export of main function
- Service for complex logic: Create `src/services/[Name]Service.js` with initialization and methods
- Follow existing pattern: Require dependencies at top, accept index parameter, return Promise

**Utilities:**
- Shared helpers: `src/utils/[UtilityName].js` (e.g., date helpers, formatters)
- Database queries: Use `SQLServerConnection.js` via `runQuery(query, database)`
- API calls: Use axios pattern from `GetTypesCFDI.js` (headers with tenant credentials)
- Logging: Always use `logGenerator(fileName, level, message)` not console.log

**Tests:**
- Test location: Mirror source structure in `tests/` directory
- Naming: `[ComponentName].test.js` or `[ComponentName].spec.js`
- Framework: Jest (configured in `jest.config.js`)
- Run: `npm test` or `npm test -- --watch`

## Special Directories

**logs/sageconnect/:**
- Purpose: Store timestamped log files for audit trail and debugging
- Generated: At runtime when logGenerator is called
- Structure: `logs/sageconnect/YYYY-MM-DD/[ProcessName].log`
- Committed: Not committed to git (in .gitignore)
- Retention: User-managed (can be manually deleted)

**.planning/codebase/:**
- Purpose: Store architectural and structural documentation
- Generated: By GSD analysis tools
- Files: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md
- Committed: Committed to git for reference
- Use: Reference for new features and understanding system design

**dist/:**
- Purpose: Compiled/bundled application (if obfuscation script is run)
- Generated: By `npm run obfuscate` script
- Files: Obfuscated JavaScript source
- Committed: Not committed to git (in .gitignore)

**public/:**
- Purpose: Static web assets served by Express
- Contains: HTML pages, CSS (if any), images for dashboard
- Served: Via `app.use('/public', express.static(...))` in `src/server.js`
- Index: Root route (`/`) serves `public/index.html`

---

*Structure analysis: 2026-03-12*
