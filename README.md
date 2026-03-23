# SAGECONNECT

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/FReptar0/sageconnect)

**SAGECONNECT** is an automation software that streamlines the process of interconnecting the **SAGE 300** ERP with the **portaldeproveedores.mx** API. The software simplifies administrative processes such as _supplier registration, invoice management, payment processing, and payment supplements in both systems_. By maintaining data atomicity in both systems, SAGECONNECT ensures that all changes made in one system are accurately reflected in the other, thereby reducing errors and increasing efficiency. With SAGECONNECT, businesses can seamlessly manage their financial operations while reducing manual effort and minimizing the risk of errors.

---

## Required programs  

- Node.js (Stable version)

   > The system was created on Node v18.12.1

- npm (Stable version)

   > The system was created using npm v8.19.2  
   >
   > This package manager for JavaScript is automatically installed when you installed Node.js

- Git

   > The system was created using git v2.41.0.windows.3

---

## Installation and Download

The following is a series of instructions for installing the necessary programs and downloading the packages for this implementation.

---

### Programs Installation

#### Git

To download Git you must do it from the following [Download Git for Windows](https://git-scm.com/download/win)

##### Git Installation steps

   1. Select your preferred installation option
   2. Click next until the installation start

#### Node.js

To download Node.js you must do it from the following [Node.js download page](https://nodejs.org/en/download)

##### Node.js Installation steps

   1. Select your corresponding version | Windows Installer 32-bit or 64-bit
   2. Execute the intaller
   3. Read and accept the terms of the license agreement.
   4. Click next until you found the **Custom Setup** and click all the icons to perfom a correct installation
   5. Accept the automatically installation for native modules in the **Tools for Native Modules** screen
   6. Click on the install button to install the application.

### Repository and package download

#### Repository

After you have downloaded and installed the previous applications you will need to run the following command in a terminal so that you can clone this repository:

```bash
git clone https://github.com/FReptar0/sageconnect
```

> :bangbang: Make sure you are cloning the program to the desired path.

#### Packages

Once you have cloned the repository, you will need to run the following command in a terminal to install the necessary packages for the program to run correctly:

```bash
npm install
```

> :bangbang: Make sure that you are running the command in the program folder

---

## Configuration Setup

After installing the dependencies, you need to configure the environment file. All configuration is in a **single `.env` file** (unified since v1.1).

### 1. Copy Example File

```bash
cp .env.example .env
```

### 2. Edit Configuration

Open `.env` and replace the example values with your actual credentials and settings. The file is organized by sections:

- **DATABASE** — SQL Server connection credentials
- **PORTAL (Focaltec)** — Portal de Proveedores API credentials
- **MAILING** — Email configuration (optional)
- **PATHS** — File system paths for logs and downloads
- **APP** — Application settings, company info, address defaults

> :warning: **Security Notice**: Never commit the actual `.env` file to version control. Only `.env.example` should be tracked in Git.
>
> :bangbang: **Important**: The application validates all required environment variables at startup. If any required variable is missing or empty, the process will print a list of missing variables and exit before running any business logic.
>
> :bangbang: **Migrating from v1.0 (5 separate .env files)?** Run the migration script: `node scripts/migrate-env.js`. It reads your old files, shows a preview, and creates the unified `.env` on confirmation. See [Migrating from v1.0](#migrating-from-v10) for details.

---

## Configuration

### Environment Variables

All configuration lives in a single `.env` file organized by sections. See `.env.example` for the full template with inline documentation.

#### Database

| Variable | Description | Example |
| :---: | :---: | :---: |
| DB_USER | SQL Server username | your_db_user |
| DB_PASSWORD | SQL Server password | your_db_password |
| SERVER | SQL Server hostname | your_sql_server_host |
| DATABASE | Default database name | YOUR_DATABASE_NAME |

> :bangbang: `DB_USER` and `DB_PASSWORD` were renamed from `USER` and `PASSWORD` in v1.1 to avoid collision with OS environment variables.

#### Portal (Focaltec)

| Variable | Description | Example |
| :---: | :---: | :---: |
| URL | Portal de Proveedores API URL | https://api.portaldeproveedores.mx |
| TENANT_ID | Company identifiers (comma-separated for multi-tenant) | tenant1,tenant2 |
| API_KEY | API keys (comma-separated, same index as TENANT_ID) | key1,key2 |
| API_SECRET | API secrets (comma-separated, same index as TENANT_ID) | secret1,secret2 |
| DATABASES | Database names per tenant (comma-separated) | DB1,DB2 |
| EXTERNAL_IDS | External IDs/RFCs per tenant (comma-separated) | RFC1,RFC2 |

> :bangbang: Multi-tenant values must correspond by position. If the first TENANT_ID is for Company A, then the first API_KEY, API_SECRET, DATABASES, and EXTERNAL_IDS must also be for Company A.

#### Mailing (Optional)

Email configuration is optional. If `MAIL_TRANSPORT` is not set, the mailing section is skipped entirely.

| Variable | Description | Example |
| :---: | :---: | :---: |
| MAIL_TRANSPORT | Transport type: `smtp` or `gmail` | smtp |

**For SMTP:**

| Variable | Description | Example |
| :---: | :---: | :---: |
| eFrom | Sender email address | notificaciones@tuempresa.com |
| ePass | SMTP password (leave empty if not needed) | tu_password |
| eServer | SMTP server address | mail.tuempresa.com |
| ePuerto | SMTP port | 587 |
| eSSL | TRUE for SSL/TLS, FALSE otherwise | TRUE |
| MAILING_NOTICES | Comma-separated recipient emails | admin@tuempresa.com |
| MAILING_CC | Comma-separated CC emails | backup@tuempresa.com |

**For Gmail OAuth:**

| Variable | Description | Example |
| :---: | :---: | :---: |
| CLIENT_ID | Google API client ID | your-client-id.apps.googleusercontent.com |
| SECRET_CLIENT | Google API client secret | GOCSPX-your_client_secret |
| REFRESH_TOKEN | Google API refresh token | 1//your_refresh_token |
| REDIRECT_URI | OAuth redirect URI | https://developers.google.com/oauthplayground |

<details>
<summary>How to get Gmail OAuth credentials (CLIENT_ID, SECRET_CLIENT, REFRESH_TOKEN)</summary>

1. Go to [Google Cloud Console APIs](https://console.cloud.google.com/apis/)
2. Create a new project
3. Enable the **Gmail API**
4. Go to **Consent screen** → select **External** → create
5. Fill in app name, assistance email, developer email
6. **Save and Continue** until summary → **Return to Panel**
7. **Publish the application** → **Confirm**
8. Go to **Credentials** → **Create Credentials** → **OAuth client ID**
9. Select **Web app**, add redirect URI: `https://developers.google.com/oauthplayground`
10. Copy **Client ID** and **Client Secret**
11. Go to [Google OAuth Playground](https://developers.google.com/oauthplayground/)
12. Click **Settings** → **Use your own OAuth credentials** → paste Client ID and Secret
13. In **Select & authorize APIs**, type `https://mail.google.com` → **Authorize APIs** → **Allow**
14. Click **Exchange authorization code for tokens** → copy the **Refresh token**

</details>

#### Paths

| Variable | Description | Example |
| :---: | :---: | :---: |
| DOWNLOADS_PATH | Directory for downloaded CFDI files | ./downloads |
| PROVIDERS_PATH | Directory for provider data | ./downloads/providers |
| LOG_PATH | Base directory for log files (creates `sageconnect/` subdirectory) | ./logs |

> :bangbang: `DOWNLOADS_PATH` was renamed from `PATH` in v1.1 to avoid collision with the OS PATH environment variable.

#### App

| Variable | Description | Example |
| :---: | :---: | :---: |
| IMPORT_CFDIS_ROUTE | Path to Sage CFDI import executable | C:\Program Files (x86)\Importa CFDIs AP - Focaltec\ImportaFacturasFocaltec.exe |
| ARG | Sage 300 database name for the executable | YOUR_DATABASE_NAME |
| NOMBRE | Company name for CFDI fiscal information | Tu Empresa SA de CV |
| RFC | Company RFC (tax ID) | ABC123456DEF |
| REGIMEN | SAT tax regime code | 601 |
| TIMEZONE | IANA timezone identifier | America/Mexico_City |
| DEFAULT_ADDRESS_CITY | Default city for purchase orders | TU_CIUDAD |
| DEFAULT_ADDRESS_COUNTRY | Default country | MEXICO |
| DEFAULT_ADDRESS_IDENTIFIER | Default location identifier | ID_EXAMPLE |
| DEFAULT_ADDRESS_MUNICIPALITY | Default municipality | TU_MUNICIPIO |
| DEFAULT_ADDRESS_STATE | Default state | TU_ESTADO |
| DEFAULT_ADDRESS_STREET | Default street | CALLE EJEMPLO |
| DEFAULT_ADDRESS_ZIP | Default ZIP code | 12345 |
| ADDRESS_IDENTIFIERS_SKIP | Location IDs to exclude (comma-separated) | LOCATION1,LOCATION2 |
| AUTO_TERMINATE | Auto-exit after tasks complete (for scheduled tasks) | false |

> :bangbang: **AUTO_TERMINATE**: Set to `true` for Windows Server scheduled tasks (every 15 minutes). The app exits cleanly after processing. For normal operation with PM2, keep `false`.

---

## Preserving Local Environment Files

The `.env` file is tracked in the repo. To prevent your local values from being overwritten on `git pull` or `git merge`, mark it as **skip-worktree**:

```bash
git update-index --skip-worktree .env
```

---

## :alarm_clock: Scheduled Task Setup (Windows Server)

If you need to run SageConnect as a scheduled task on Windows Server (every 15 minutes), use the provided `RunSageconnect.bat` script instead of `npm run start`:

Configure your Windows Task Scheduler to run:
```cmd
C:\path\to\sageconnect\RunSageconnect.bat
```

This script automatically:
- Sets `AUTO_TERMINATE=true` environment variable
- Changes to the correct directory (update the path in the script as needed)
- Runs the application with proper termination
- Logs execution times for monitoring
- Exits cleanly to prevent port conflicts

> :bangbang: **Important**: 
> - Update the path `E:\sageconnect` in `RunSageconnect.bat` to match your installation directory
> - Do not use `npm run start` directly for scheduled tasks as the process will never terminate and cause port conflicts with subsequent executions

---

## :gear: How to deploy it

After all the previous actions have been performed you will need to install some npm dependencies globally with the following commands:

```bash
npm install -g pm2
npm install pm2-windows-startup -g
npx pm2-startup install
```

Then, you must execute the following commands in order to keep the program process always running

```bash
npx pm2 start src/index.js --watch --ignore-watch="node_modules" --name sageconnect
npx pm2 save
```

If you need more information on the use of PM2 you can visit the following [PM2 Quick Start Guide](https://pm2.keymetrics.io/docs/usage/quick-start/)

---

## :package: Production Deployment Workflow

The production code is **obfuscated** and pushed to a separate repository. The production repo has no shared git history with this source repo.

### Deployment Steps

1. **On your development machine:**
   ```bash
   git checkout master
   git pull origin master
   node scripts/obfuscate.js
   # Push obfuscated code to the production repository
   ```

2. **On the Windows production server:**
   ```cmd
   REM Stop the app
   pm2 stop sageconnect

   REM Reset to latest (no shared history — always reset)
   git fetch origin
   git reset --hard origin/master

   REM Install dependencies
   npm install

   REM If migrating from v1.0 (5 separate .env files), run:
   node scripts/migrate-env.js

   REM Verify config loads correctly
   node -e "const c = require('./src/config'); console.log('OK:', c.database.server, c.portal.url)"

   REM Start the app
   pm2 start sageconnect
   ```

> :bangbang: **Important**: The production repo contains obfuscated code with no shared git history. Each deployment uses `git reset --hard origin/master` to get the latest version. The `.env` file is not affected by the reset.

---

## :arrows_counterclockwise: Migrating from v1.0

If the server currently has the old 5 separate `.env` files, run the migration script **before starting the app** after updating to v1.1+:

```cmd
node scripts/migrate-env.js
```

The script will:
1. Scan for old `.env` files (`.env`, `.env.path`, `.env.credentials.database`, `.env.credentials.focaltec`, `.env.credentials.mailing`)
2. Read all variables from each file
3. Apply renames: `USER` → `DB_USER`, `PASSWORD` → `DB_PASSWORD`, `PATH` → `DOWNLOADS_PATH`
4. Add new variable: `MAIL_TRANSPORT=smtp`
5. Show a full preview of the unified `.env` for review
6. On confirmation: write the unified `.env`, back up originals to `.env.legacy/`, remove old separate files

> :bangbang: **Rollback**: If something goes wrong after migration, the original files are in `.env.legacy/`. Copy them back to the root directory and revert the code to the previous version.
