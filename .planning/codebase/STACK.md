# Technology Stack

**Analysis Date:** 2026-03-12

## Languages

**Primary:**
- JavaScript (Node.js) - Backend server, services, controllers, utilities
- HTML/CSS - Frontend UI for dashboard
- SQL - SQL Server queries for data retrieval

## Runtime

**Environment:**
- Node.js (v18 specified in GitHub Actions, no .nvmrc file)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Express.js ^4.21.1 - HTTP web server and routing

**Testing:**
- Jest ^29.7.0 - Unit testing framework
- Babel-Jest ^29.7.0 - Jest transformer for ES6+ syntax

**Build/Dev:**
- Babel ^7.26.0 - JavaScript transpiler
  - @babel/core ^7.26.0
  - @babel/preset-env ^7.26.0
- JavaScript Obfuscator ^5.3.0 - Code obfuscation for distribution
- Nodemon ^3.1.7 - Auto-reload development server

## Key Dependencies

**Critical:**
- mssql ^11.0.1 - Microsoft SQL Server connection and queries
- axios ^1.7.7 - HTTP client for external API calls (Focaltec portal)
- dotenv ^16.4.5 - Environment variable management
- nodemailer ^6.9.16 - Email sending functionality

**Data Processing:**
- xml2js ^0.6.2 - XML to JSON conversion for CFDI documents
- joi ^17.13.3 - Data validation and schema validation

**Logging & Notifications:**
- winston ^3.17.0 - Logging library
- log4js ^6.9.1 - Alternative logging framework
- node-notifier ^10.0.1 - Desktop notifications for process completion

**Utilities:**
- fs ^0.0.1-security - File system operations (built-in Node.js)

## Configuration

**Environment:**
- Three primary .env files (not tracked in git):
  - `.env` - General application config (WAIT_TIME, timezone, addresses, AUTO_TERMINATE)
  - `.env.credentials.database` - SQL Server connection (USER, PASSWORD, SERVER, DATABASE)
  - `.env.credentials.focaltec` - Focaltec Portal API credentials (URL, TENANT_ID, API_KEY, API_SECRET, DATABASES, EXTERNAL_IDS)
  - `.env.credentials.mailing` - Email configuration (SMTP server, auth, recipient lists)

**Key Configuration Variables:**
- Timezone: `TIMEZONE` (America/Mexico_City)
- Database: SQL Server with configurable target database
- API: Multiple tenant support via comma-separated credentials
- CFDI Import: External executable path (`IMPORT_CFDIS_ROUTE`)
- Auto-shutdown: `AUTO_TERMINATE` flag for background processes

**Build:**
- `babel.config.js` - Babel configuration (preset-env targeting current Node)
- `jest.config.js` - Jest test runner config (babel-jest transformer)
- `scripts/obfuscate.js` - Custom obfuscation script for distribution

## Platform Requirements

**Development:**
- Windows environment (uses Windows executable for CFDI import: `ImportaFacturasFocaltec.exe`)
- SQL Server instance accessible via network
- SMTP server for email functionality

**Production:**
- Windows server (CFDI import executable is Windows-specific)
- Node.js v18 LTS recommended
- SQL Server with appropriate database and permissions
- Network access to:
  - Focaltec Portal API (`https://api-sandbox.portaldeproveedores.mx` or production equivalent)
  - SMTP server for notifications

## Deployment

**Container:** Not containerized (bare Node.js)

**Distribution:**
- Code is obfuscated before deployment using GitHub Actions workflow
- Obfuscated code pushed to separate distribution repository (`FReptar0/sageconnect-dist`)
- GitHub Actions CI/CD enabled with secrets management

**Entry Points:**
- `npm start` → `node src/index.js` - Full server + background processes
- `npm run web-only` → `node src/index.js --web-only` - Web server only (no background tasks)
- `npm run dev` → `nodemon src/index.js` - Development with auto-reload
- `npm run background-only` → `node src/background.js` - Background processes only
- `npm run obfuscate` → Obfuscate code to `dist/` folder

---

*Stack analysis: 2026-03-12*
