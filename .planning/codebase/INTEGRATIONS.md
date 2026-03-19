# External Integrations

**Analysis Date:** 2026-03-12

## APIs & External Services

**Focaltec Portal de Proveedores API:**
- Service: Supplier portal for managing purchase orders and invoices
- SDK/Client: axios HTTP client
- Auth: Custom headers `PDPTenantKey` and `PDPTenantSecret` (API key and secret)
- Base URL: Configured via `process.env.URL` (defaults to `https://api-sandbox.portaldeproveedores.mx`)
- Endpoints:
  - `GET /api/1.0/extern/tenants/{tenantId}/cfdis` - Retrieve CFDI documents (invoices/payments)
  - `GET /api/1.0/extern/tenants/{tenantId}/cfdis/{cfdiId}/files` - Download CFDI XML files
  - `GET /api/1.0/extern/tenants/{tenantId}/payments/{paymentId}` - Fetch payment details
  - `GET /api/1.0/extern/tenants/{tenantId}/providers/{providerId}` - Get provider information
  - `POST /api/1.0/extern/tenants/{tenantId}/purchase-orders` - Create purchase orders
  - `PUT /api/1.0/extern/tenants/{tenantId}/purchase-orders/{id}/status` - Update PO status
  - `PUT /api/1.0/extern/tenants/{tenantId}/purchase-orders/{id}` - Update PO content
  - `POST /api/1.0/extern/tenants/{tenantId}/payments` - Create/upload payment records
  - `POST /api/1.0/batch/tenants/{tenantId}/payments` - Batch payment operations

**CFDI Document Processing:**
- Service: Mexican tax authority CFDI (Comprobante Fiscal Digital por Internet) documents
- Document Types: PAYMENT_CFDI, INVOICE, CREDIT_NOTE
- Processing: XML parsing and validation for payment/invoice reconciliation

## Data Storage

**Databases:**
- Provider: Microsoft SQL Server
- Connection: via `mssql` npm package with connection pooling
- Client: `mssql@11.0.1`
- Configuration: `src/utils/SQLServerConnection.js`
  - Connection pooling: 15s timeout for connection, 60s for queries
  - SSL certificate validation disabled (trustServerCertificate: true)
  - Database credentials from `.env.credentials.database`
  - Default database: FESA (configurable per call)

**Key Tables:**
- `fesa.dbo.fesaOCFocaltec` - Tracking purchase orders synced to Focaltec portal
- Contains fields: idFocaltec, ocSage, status, lastUpdate, createdAt, responseAPI, idDatabase
- Used to link SAGE purchase orders with Focaltec portal order IDs

**File Storage:**
- Local filesystem only
- Log directory: `logs/` (Windows path: `C:\Logs\sageconnect\`)
- Report storage: `reports/` directory
- CFDI file downloads to disk before processing

**Caching:**
- None detected

## Authentication & Identity

**Auth Provider:**
- Custom API key/secret header-based authentication
- Multiple tenant support: Credentials are comma-separated lists allowing multiple environments
  - `TENANT_ID=tenant1,tenant2,tenant3`
  - `API_KEY=key1,key2,key3`
  - `API_SECRET=secret1,secret2,secret3`
  - `DATABASES=DB1,DB2,DB3`
  - `EXTERNAL_IDS=RFC1,RFC2,RFC3` (RFC for payment reconciliation)

**Implementation:**
- Each API request includes tenant-specific credentials in headers
- Provider IDs resolved using `external_id` (RFC number) from database
- Service: `src/services/ProviderIdResolver.js` - Resolves provider identifiers

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, Rollbar, or similar service detected)
- Errors logged locally

**Logs:**
- Multi-strategy approach:
  - Winston ^3.17.0 - Primary logging library
  - Log4js ^6.9.1 - Alternative logging
  - Custom LogGenerator: `src/utils/LogGenerator.js`
  - Log files stored in `logs/` directory with date-based naming
  - Log types: ForResponse, GetTypesCFDI, CFDI_Downloader, PortalOC_Creator, etc.
  - Log Dashboard UI at `/api/dashboard` showing execution history and statistics

**Notifications:**
- Desktop notifications via node-notifier (Windows notifications)
- Email notifications via nodemailer on process completion/errors

## CI/CD & Deployment

**Hosting:**
- Self-hosted (no cloud platform detected)
- Windows server required (CFDI import executable is Windows-only)
- Port: 3030 (default)

**CI Pipeline:**
- GitHub Actions workflow: `.github/workflows/obfuscate-deploy.yml`
  - Triggers on: push to src/, public/, package.json, or manual trigger
  - Node.js 18 setup
  - Obfuscation build step
  - Push to distribution repository (FReptar0/sageconnect-dist)
  - Requires secret: `OBFUSCATED_REPO_TOKEN` (Personal Access Token)

## Environment Configuration

**Required env vars (.env):**
- `WAIT_TIME` - Delay between operations (seconds)
- `IMPORT_CFDIS_ROUTE` - Full path to CFDI import executable
- `ARG` - Target database name for CFDI import
- `NOMBRE` - Company name
- `RFC` - Company RFC (tax ID)
- `REGIMEN` - Tax regime code (e.g., 601)
- `TIMEZONE` - Application timezone (e.g., America/Mexico_City)
- `DEFAULT_ADDRESS_*` - Default addresses for purchase orders (CITY, COUNTRY, STATE, etc.)
- `ADDRESS_IDENTIFIERS_SKIP` - Comma-separated location IDs to exclude
- `AUTO_TERMINATE` - Auto-shutdown flag (true/false)

**Required env vars (.env.credentials.focaltec):**
- `URL` - Focaltec API base URL
- `TENANT_ID` - Comma-separated tenant IDs
- `API_KEY` - Comma-separated API keys
- `API_SECRET` - Comma-separated API secrets
- `DATABASES` - Comma-separated database names
- `EXTERNAL_IDS` - Comma-separated RFC identifiers

**Required env vars (.env.credentials.database):**
- `USER` - SQL Server username
- `PASSWORD` - SQL Server password
- `SERVER` - SQL Server hostname/IP
- `DATABASE` - Default database name

**Required env vars (.env.credentials.mailing):**
- `eServer` - SMTP server hostname
- `ePuerto` - SMTP port (typically 587)
- `eSSL` - Enable SSL (TRUE/FALSE)
- `eFrom` - Sender email address
- `ePass` - SMTP password
- `MAILING_NOTICES` - Comma-separated notification recipient emails
- `MAILING_CC` - Comma-separated CC recipient emails

**Secrets location:**
- Stored in `.env.*` files (git-ignored, not tracked in repository)
- GitHub Actions secrets for distribution pipeline: `OBFUSCATED_REPO_TOKEN`

## Webhooks & Callbacks

**Incoming:**
- No webhook endpoints detected

**Outgoing:**
- Email notifications on:
  - Process start/completion
  - Error conditions
  - CFDI import failures
- Log entries for process tracking

## Data Flow

**Primary Integration Flow:**
1. **CFDI Download** → Fetch from Focaltec portal using API
2. **CFDI Processing** → Parse XML, extract payment/invoice data
3. **Database Storage** → Store in FESA SQL Server database
4. **Purchase Order Creation** → Read from SAGE database, transform, POST to Focaltec
5. **Status Updates** → Monitor and sync PO status changes via PUT requests
6. **Payment Reconciliation** → Match SAGE payments with Focaltec records
7. **Notifications** → Email alerts on completion/errors

---

*Integration audit: 2026-03-12*
