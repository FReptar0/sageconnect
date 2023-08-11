# <center>SAGECONNECT</center>

**SAGECONNECT** is an automation software that streamlines the process of interconnecting the **SAGE 300** ERP with the **portaldeproveedores.mx** API. The software simplifies administrative processes such as _supplier registration, invoice management, payment processing, and payment supplements in both systems_. By maintaining data atomicity in both systems, SAGECONNECT ensures that all changes made in one system are accurately reflected in the other, thereby reducing errors and increasing efficiency. With SAGECONNECT, businesses can seamlessly manage their financial operations while reducing manual effort and minimizing the risk of errors.

---

## Required programs 

- Node.js (Stable version)
   - > The system was created on Node v18.12.1
- npm (Stable version)
   - > The system was created using npm v8.19.2 <br> 
       > This package manager for JavaScript is automatically installed when you installed Node.js
- Git 
   - > The system was created using git v2.41.0.windows.3

---

## Installation and Download 
The following is a series of instructions for installing the necessary programs and downloading the packages for this implementation.

---
### <center>Programs Installation</center>

#### Git
To download Git you must do it from the following [link](https://git-scm.com/download/win)

##### Installation steps:
   1. Select your preferred installation option
   2. Click next until the installation start

#### Node.js
To download Node.js you must do it from the following [link](https://nodejs.org/en/download)

##### Installation steps:
   1. Select your corresponding version | Windows Installer 32-bit or 64-bit
   2. Execute the intaller
   3. Read and accept the terms of the license agreement. 
   4. Click next until you found the **Custom Setup** and click all the icons to perfom a correct installation 
   5. Accept the automatically installation for native modules in the **Tools for Native Modules** screen
   6. Click on the install button to install the application.

### <center>Repository and package download</center>

#### Repository

After you have downloaded and installed the previous applications you will need to run the following command in a terminal so that you can clone this repository:

`
git clone https://github.com/FReptar0/sageconnect
`
> :bangbang: Make sure you are cloning the program to the desired path.

#### Packages

Once you have cloned the repository, you will need to run the following command in a terminal to install the necessary packages for the program to run correctly:

`
npm install
`
> :bangbang: Make sure that you are running the command in the program folder

---

## Configuration

### Environment variables

The following environment variables must be configured for the program to run correctly:

### .env

| Variable | Description | Example | File |
| :---: | :---: | :---: | :---: |
| WAIT_TIME | Time in hours, to be used for the program to repeat its functionality every x time.  | 2 | .env |
| IMPORT_CFDIS_ROUTE | Used to define the path to the sage executable to be called to perform the invoice import process. | C:\Program Files (x86)\Importa CFDIs AP - Focaltec\ImportaFacturasFocaltec.exe | .env|
| ARG | This is the argument that must be provided for the executable to perform its task. | CMXDAT | .env |

### .env.credentials.database

| Variable | Description | Example | File |
| :---: | :---: | :---: | :---: |
| USER | Is the user name for SQLServer database. | sa | .env.credentials.database |
| PASSWORD | Is the password for the acording user. | sa | .env.credentials.database |
| SERVER | Is the server name for the conecction. | EC2AMAZ-IMEIBNC | .env.credentials.database |
| DATABASE | It is the default name of the database where some actions must occur. | FESA | .env.credentials.database |

### .env.credentials.focaltec

> :bangbang: For the program actions to be executed properly you must separate the multiple values by commas, the only variable that does not need multiple values is URL.

> :bangbang: Make sure there are no commas after the equal or at the end of a value that has no other value right away.

| Variable | Description | Example | File |
| :---: | :---: | :---: | :---: |
| URL | It is the URL of the focaltec API. | https://api-sandbox.portaldeproveedores.mx | .env.credentials.focaltec |
| TENANT_ID | These are the company identifiers provided by Focaltec. | t8e8412hgs4kopf,t8e86cuiuennbl,t8e881bms3hygj8 | .env.credentials.focaltec |
| API_KEY | This is one of the key values used by focaltec | EDaYeHfGbgnpevkE,QjgN7i3EHh7kOnuE,6hNTwGkVj9zLZgDX | .env.credentials.focaltec |
| API_SECRET | This is another of the key values used by focaltec | NMcqO1qxQmx66yEQ3tqzFspxe2ALwXbrtcfIY8upZdeiPbDY,iUJRIrquQvFa6LvDzeDlQIk8clwYc14kuiEVGysRioqkcFyt,SDZHVho74TJK2xyshLsl6VSvWRYCt16fBJ00BDnZ3CUXjeZN | .env.credentials.focaltec |
| DATABASES | It is the name of the database corresponding to each company. | CMXDAT,TSMDAT,ARKDAT | .env.credentials.focaltec |

> :bangbang: Make sure that the values correspond to each other, for example, if the first TENANT_ID is for Charger, then the first API_KEY, API_SECRET and DATABASE must be for Charger.

### .env.credentials.mailing

These are the credentials needed to send emails using the google API

| Variable | Description | Example | File |
| :---: | :---: | :---: | :---: |
| CLIENT_ID | It is a value that Google will provide for the use of its API, later we will see how to obtain it. | 213110698827-j2ih3tvkp4hlc4prngfa5hr9qdh2r9bq.apps.googleusercontent.com | .env.credentials.mailing |
| SECRET_CLIENT | It is a value that Google will provide for the use of its API, later we will see how to obtain it. | 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 | .env.credentials.mailing  |
| REFRESH_TOKEN | It is a value that Google will provide for the use of its API, later we will see how to obtain it. | 1//04MQuKAFpXo-_CgYIARAAGAQSNwF-L9IrQKynzPc1WJTkShu3Afzt5z_A_gPcXzdUw5TPTz8u1lgbUnXpZqR7Wcj8rgBMLQWqyTE | .env.credentials.mailing  |
| REDIRECT_URI | **This value will never change** | https://developers.google.com/oauthplayground | .env.credentials.mailing |
| SEND_MAILS | This is the email address that was registered to use Google's email API. | fernando.rodriguez@tersoft.mx | .env.credentials.mailing |
| MAILING_NOTICES | These are the e-mail addresses to which the mails for each company should be sent. | fernando.rodriguez@tersoft.mx,fernando.rodriguez+1@tersoft.mx,fernando.rodriguez+2@tersoft.mx | .env.credentials.mailing |

> :bangbang: Make sure that the MAILING_NOTES variable follows the same sequence as the multiple value variables in focaltec, which means that they must be separated by commas and must be related. <br/><br/>
> :bangbang: If the first tenant is for charger then the first mail of MAILING_NOTICES must also be the mail where the notices for charger will arrive.

In order to get CLIENT_ID, SECRET_CLIENT and REFRESH_TOKEN you need to follow the next steps:

1. Go to the following [link](https://console.cloud.google.com/apis/)
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
20. Enter the following URL in the **Add URI** field: https://developers.google.com/oauthplayground
21. Click on the **Create** button
22. Copy the **Client ID** and **Client Secret** values and paste them in the corresponding fields in the .env.credentials.mailing file
23. Go to the following [link](https://developers.google.com/oauthplayground/)
24. Click on the **Settings** button
25. Select the **Use your own OAuth credentials** option
26. Paste the **Client ID** and **Client Secret** values in the corresponding fields
27. Click on the **Close** button
28. In the **Select & authorize APIs** field, type **https://mail.google.com**
29. Click on the **Authorize APIs** button
30. Click on the **Allow** button
31. Click on the **Exchange authorization code for tokens** button
32. Copy the **Refresh token** value and paste it in the corresponding field in the .env.credentials.mailing file
