# <center>SAGECONNECT</center>

**SAGECONNECT** is an automation software that streamlines the process of interconnecting the **SAGE 300** ERP with the **portaldeproveedores.mx** API. The software simplifies administrative processes such as _supplier registration, invoice management, payment processing, and payment supplements in both systems_. By maintaining data atomicity in both systems, SAGECONNECT ensures that all changes made in one system are accurately reflected in the other, thereby reducing errors and increasing efficiency. With SAGECONNECT, businesses can seamlessly manage their financial operations while reducing manual effort and minimizing the risk of errors.

---

## System requirements

- Node.js (Stable version)
   - > The system was created on Node v18.12.1
- npm (Stable version)
   - > The system was created using npm v8.19.2

---

## Installation

### For the developers

Only the installation of the libraries/dependencies in the project should be performed, for which the following command will be used.

```
npm install
```

> :bulb: Remember that the ***.env*** files need to be added so that the program can access the credentials.

### For the final user

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


- ### During testing time

You should execute the next command so you can run all the tests:



```
npm run test
```
> :bulb: Remember, if you want to add a new test, you should add it in the [tests](./tests/) folder. <br/>
> :bangbang: The test files must end in .test.js



---