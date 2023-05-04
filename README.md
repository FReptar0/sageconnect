# <center>SAGECONNECT</center>

**SAGECONNECT** is an automation software that streamlines the process of interconnecting the **SAGE 300** ERP with the **portaldeproveedores.mx** API. The software simplifies administrative processes such as _supplier registration, invoice management, payment processing, and payment supplements in both systems_. By maintaining data atomicity in both systems, SAGECONNECT ensures that all changes made in one system are accurately reflected in the other, thereby reducing errors and increasing efficiency. With SAGECONNECT, businesses can seamlessly manage their financial operations while reducing manual effort and minimizing the risk of errors.

---

## System requirements

- Node.js (Stable version)
   - > The system was created on Node v18.12.1
- npm (latest version)
   - > The system was created using npm v8.19.2

---

## Installation

### For the developers

Only the installation of the libraries/dependencies in the project should be performed, for which the following command will be used.

```
npm install
```

> :bulb: Remember that the ***.env*** files need to be added so that the program can access the credentials.

__The necessary .env files are the following:__
   
   - <a href="#envcredentialsdatabase"><b>.env.credentials.database</b></a>
   - <a href="#envcredentialsfocaltec"><b>.env.credentials.focaltec</b></a>
   - <a href="#envcredentialsmailing"><b>.env.credentials.mailing</b></a>
   - <a href="#envmail"><b>.env.mail</b></a>

---

## How to use it?

- ### During development time
You should execute the following command so that the system starts and restarts automatically every time the code is modified.

```
npm run dev
```
If you prefer to restart manually, use the following command:

```
npm run start
```

> :exclamation: Add the following .env files to the root directory with the information shown below.

### .env.credentials.database

```
USER=<...>
PASSWORD=<...>
```

### .env.credentials.focaltec

Focaltec will have to provide credentials.

```
URL=https://api-stg.portaldeproveedores.mx
TENANT_ID=<...>
API_KEY=<...>
API_SECRET=<...>
```

### .env.credentials.mailing

```
CLIENT_ID=<id that google give you in gcloud>
SECRET_CLIENT=<secret key that google also give you in gcloud>
REFRESH_TOKEN=<refresh token that you obtain from google oauthplayground>
REDIRECT_URI=https://developers.google.com/oauthplayground
```

### .env.mail

```
WAIT_TIME=<time in minutes to check if something change>
USER_MAIL_RECEIVER=<email address who is going to get the messages>
USER_MAIL_SENDER=<email address who is going to send the messages>
```

### For the final user

- ### During testing time

---