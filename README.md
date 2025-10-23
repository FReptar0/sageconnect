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

After installing the dependencies, you need to configure the environment files. The repository includes example configuration files that you can use as templates:

### 1. Copy Example Files

Copy the provided example files and remove the `.example` suffix:

```bash
cp .env.example .env
cp .env.credentials.database.example .env.credentials.database
cp .env.credentials.focaltec.example .env.credentials.focaltec
cp .env.credentials.mailing.example .env.credentials.mailing
cp .env.path.example .env.path
```

### 2. Edit Configuration Files

Open each configuration file and replace the example values with your actual credentials and settings:

- **`.env`**: General application settings and default addresses
- **`.env.credentials.database`**: SQL Server connection credentials
- **`.env.credentials.focaltec`**: Portal de Proveedores API credentials
- **`.env.credentials.mailing`**: Email configuration for notifications
- **`.env.path`**: File system paths for logs and downloads

> :warning: **Security Notice**: Never commit the actual `.env` files to version control. Only the `.example` files should be tracked in Git.
> :bangbang: **Important**: Make sure to configure all environment variables properly before running the application. Missing or incorrect configuration may cause runtime errors.

---

## Configuration

### Environment variables

The following environment variables must be configured for the program to run correctly:

### .env

| Variable | Description | Example |
| :---: | :---: | :---: |
| WAIT_TIME | Time in hours, to be used for the program to repeat its functionality every x time.  | 10 |
| IMPORT_CFDIS_ROUTE | Used to define the path to the sage executable to be called to perform the invoice import process. | C:\Program Files (x86)\Importa CFDIs AP - Focaltec\ImportaFacturasFocaltec.exe |
| ARG | The name of the SAGE 300 database to be used by the executable for its operations. | YOUR_DATABASE_NAME |
| NOMBRE | Company name for CFDI fiscal information. | Tu Empresa SA de CV |
| RFC | Company RFC (tax identification number) for CFDI fiscal information. | ABC123456DEF |
| REGIMEN | Tax regime code for CFDI fiscal information. | 601 |
| TIMEZONE | IANA timezone identifier for all date/time operations in the system. Must be a valid timezone. | America/Mexico_City |
| DEFAULT_ADDRESS_CITY | Default city for purchase orders when ICLOC table has no data. Leave empty if no default needed. | TU_CIUDAD |
| DEFAULT_ADDRESS_COUNTRY | Default country for purchase orders when ICLOC table has no data. Leave empty if no default needed. | MEXICO |
| DEFAULT_ADDRESS_IDENTIFIER | Default location identifier for purchase orders when ICLOC table has no data. Leave empty if no default needed. | ID_EXAMPLE |
| DEFAULT_ADDRESS_MUNICIPALITY | Default municipality for purchase orders when ICLOC table has no data. Leave empty if no default needed. | TU_MUNICIPIO |
| DEFAULT_ADDRESS_STATE | Default state for purchase orders when ICLOC table has no data. Leave empty if no default needed. | TU_ESTADO |
| DEFAULT_ADDRESS_STREET | Default street for purchase orders when ICLOC table has no data. Leave empty if no default needed. | CALLE EJEMPLO |
| DEFAULT_ADDRESS_ZIP | Default ZIP code for purchase orders when ICLOC table has no data. Leave empty if no default needed. | 12345 |
| ADDRESS_IDENTIFIERS_SKIP | Comma-separated list of location identifiers (LOCATION) to skip during processing. Records with these locations will be excluded from purchase order creation. | LOCATION1,LOCATION2,LOCATION3 |
| AUTO_TERMINATE | Set to `true` to enable automatic process termination after completing all tasks. Useful for scheduled tasks that need to exit cleanly. | false |

> :bangbang: **TIMEZONE Configuration**: The TIMEZONE variable must be set to a valid [IANA timezone identifier](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones). Common examples include:
>
> - `America/Mexico_City` (UTC-6/UTC-5)
> - `America/New_York` (UTC-5/UTC-4)
> - `Europe/London` (UTC+0/UTC+1)
> - `Asia/Tokyo` (UTC+9)
>
> All date filtering, logging, and timestamp operations throughout the system will use this timezone. If an invalid timezone is provided, the system will fall back to local server time and display a warning.
>
> :bangbang: **DEFAULT ADDRESS Configuration**: These variables provide fallback values when the ICLOC table in SAGE 300 doesn't contain address information for a location. If these variables are not set or left empty, the system will use empty strings as defaults. This ensures purchase orders always have valid address fields for Portal de Proveedores API compliance.
>
> The system uses `ISNULL(NULLIF(RTRIM(field),''), default_value)` logic to handle both NULL values and empty strings from the database, ensuring that Portal de Proveedores API requirements are met.
>
> :bangbang: **ADDRESS_IDENTIFIERS_SKIP Configuration**: This variable allows you to exclude specific location identifiers from purchase order processing. When configured, any purchase order lines with locations matching the specified identifiers will be filtered out from the query results. This is useful for excluding test locations, inactive warehouses, or locations that should not be processed by the Portal de Proveedores integration. Leave empty if no locations should be skipped.
>
> :bangbang: **AUTO_TERMINATE Configuration**: When set to `true`, the application will automatically terminate after completing all background processes and CFDI operations. This is particularly useful for scheduled tasks on Windows Server that need to run every 15 minutes without leaving the process running indefinitely. When enabled, the application will:
>
> - Complete all CFDI processing tasks (forResponse function)
> - Wait for the child import process to finish
> - Automatically exit after 15 seconds to free up the port
> - Prevent conflicts with subsequent scheduled executions
>
> For scheduled tasks, use the provided `RunSageconnect.bat` script which automatically sets this variable to `true`. For normal server operation, keep this set to `false` to maintain the web server running.

### .env.credentials.database

| Variable | Description | Example |
| :---: | :---: | :---: |
| USER | Is the user name for SQLServer database. | your_db_user |
| PASSWORD | Is the password for the acording user. | your_db_password |
| SERVER | Is the server name for the conecction. | your_sql_server_host |
| DATABASE | It is the default name of the database where some actions must occur. | YOUR_DATABASE_NAME |

### .env.credentials.focaltec

> :bangbang: For the program actions to be executed properly you must separate the multiple values by commas, the only variable that does not need multiple values is URL.
>
> :bangbang: Make sure there are no commas after the equal or at the end of a value that has no other value right away.

| Variable | Description | Example |
| :---: | :---: | :---: |
| URL | It is the URL of the focaltec API. | <https://api-sandbox.portaldeproveedores.mx> |
| TENANT_ID | These are the company identifiers provided by Focaltec. | your_tenant_id_1,your_tenant_id_2,your_tenant_id_3 |
| API_KEY | This is one of the key values used by focaltec | your_api_key_1,your_api_key_2,your_api_key_3 |
| API_SECRET | This is another of the key values used by focaltec | your_api_secret_1,your_api_secret_2,your_api_secret_3 |
| DATABASES | It is the name of the database corresponding to each company. | DATABASE1,DATABASE2,DATABASE3 |
| EXTERNAL_IDS | It is the external id that focaltec assigns to every company | RFC1,RFC2,RFC3 |

> :bangbang: Make sure that the values correspond to each other, for example, if the first TENANT_ID is for Charger, then the first API_KEY, API_SECRET and DATABASE must be for Charger.

### .env.credentials.mailing

You can use either Google API credentials (OAuth2) or your own SMTP server for sending emails. Use the variable `MAIL_PROVIDER` to select the provider:

- `MAIL_PROVIDER=google` → Use Google API (OAuth2)
- `MAIL_PROVIDER=custom` (or unset) → Use your own SMTP server

#### For Google API (OAuth2)

| Variable | Description | Example |
| :---: | :---: | :---: |
| MAIL_PROVIDER | Set to `google` to use Google API | google |
| CLIENT_ID | Google API client ID | your-client-id.apps.googleusercontent.com |
| SECRET_CLIENT | Google API client secret | GOCSPX-your_client_secret |
| REFRESH_TOKEN | Google API refresh token | 1//your_refresh_token |
| REDIRECT_URI | Always <https://developers.google.com/oauthplayground> | <https://developers.google.com/oauthplayground> |
| SEND_MAILS | The email address registered with Google API | <your_gmail@gmail.com> |
| MAILING_NOTICES | Comma-separated list of recipient emails | <admin@tuempresa.com>,<notifications@tuempresa.com> |
| MAILING_CC | Comma-separated list of CC (carbon copy) recipient emails | <backup@tuempresa.com>,<supervisor@tuempresa.com> |

In order to get CLIENT_ID, SECRET_CLIENT and REFRESH_TOKEN you need to follow the next steps:

1. Go to the following [Google Cloud Console APIs page](https://console.cloud.google.com/apis/)
2. Click on the **Select a project** button
3. Click on the **New Project** button
4. Enter the name of the project and click on the **Create** button
5. Click on the **Enable APIs and Services** button
6. Search for **Gmail API** and click on the **Enable** button
7. Click on the **Consent screen** option
8. Select the **External** option and click on the **Create** button
9. Enter the name of the application
10. Select the asistence email
11. Enter the email address of the developer
12. Click on the **Save and Continue** until you reach the summary screen and click on the **Return to Panel** button.
13. Click on the **Publish the application** button
14. Click on the **Confirm** button
15. Click on the **Credentials** option
16. Click on the **Create Credentials** button
17. Select the **OAuth client ID** option
18. Select the **Web app** option
19. Enter the name of the application
20. Enter the following URL in the **Add URI** field: <https://developers.google.com/oauthplayground>
21. Click on the **Create** button
22. Copy the **Client ID** and **Client Secret** values and paste them in the corresponding fields in the .env.credentials.mailing file
23. Go to the following [Google OAuth Playground](https://developers.google.com/oauthplayground/)
24. Click on the **Settings** button
25. Select the **Use your own OAuth credentials** option
26. Paste the **Client ID** and **Client Secret** values in the corresponding fields
27. Click on the **Close** button
28. In the **Select & authorize APIs** field, type **<https://mail.google.com>**
29. Click on the **Authorize APIs** button
30. Click on the **Allow** button
31. Click on the **Exchange authorization code for tokens** button
32. Copy the **Refresh token** value and paste it in the corresponding field in the .env.credentials.mailing file

#### For custom SMTP server

| Variable | Description | Example |
| :---: | :---: | :---: |
| MAIL_PROVIDER | Set to `custom` to use your SMTP server (or leave unset) | custom |
| eFrom | Sender email address | <notificaciones@tuempresa.com> |
| ePass | Password for SMTP auth (leave empty if not needed) | tu_password_email |
| eServer | SMTP server address | mail.tuempresa.com |
| ePuerto | SMTP port | 587 |
| eSSL | TRUE for SSL, FALSE otherwise | TRUE |
| MAILING_NOTICES | Comma-separated list of recipient emails | <admin@tuempresa.com>,<notifications@tuempresa.com> |
| MAILING_CC | Comma-separated list of CC (carbon copy) recipient emails | <backup@tuempresa.com>,<supervisor@tuempresa.com> |

> :bangbang: Make sure that the MAILING_NOTICES variable follows the same sequence as the multiple value variables in focaltec, which means that they must be separated by commas and must be related.
> :bangbang: If the first tenant is for charger then the first mail of MAILING_NOTICES must also be the mail where the notices for charger will arrive.

### .env.path

These are the file system paths used by the application for storing downloads, providers data, and log files.

| Variable | Description | Example |
| :---: | :---: | :---: |
| PATH | Directory path where downloaded CFDI files will be saved | /Desktop/YourProject/downloads |
| PROVIDERS_PATH | Directory path where provider-related files and data will be stored | C:\Providers\ |
| LOG_PATH | Base directory path where log files will be generated. The system will create a 'sageconnect' subdirectory inside this path. | C:\Logs\ |

> :bangbang: **Path Configuration Notes**:
>
> - **LOG_PATH**: Should end with a trailing slash. The system automatically creates a 'sageconnect' subdirectory. For example, if LOG_PATH is `C:\Logs\`, log files will be saved to `C:\Logs\sageconnect\`.
> - **PROVIDERS_PATH**: Used for storing provider synchronization data and temporary files related to supplier management.
> - **PATH**: Main download directory for CFDI files retrieved from the Portal de Proveedores.
>
> Make sure all specified paths exist and have appropriate read/write permissions for the application.

---

## Preserving Local Environment Files

This project tracks several `.env` files in the repo:

- `.env`
- `.env.credentials.database`
- `.env.credentials.focaltec`
- `.env.credentials.mailing`
- `.env.path`

To prevent your local values from being overwritten on `git pull` or `git merge`, mark them as **skip-worktree**:

```bash
git update-index --skip-worktree .env
git update-index --skip-worktree .env.credentials.database
git update-index --skip-worktree .env.credentials.focaltec
git update-index --skip-worktree .env.credentials.mailing
git update-index --skip-worktree .env.path
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
