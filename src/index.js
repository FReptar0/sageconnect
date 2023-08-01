const express = require('express');
const { hoursToMilliseconds } = require('./utils/TransformTime');
//const { checkPayments } = require('./controller/SagePaymentController');
const { checkPayments } = require('./controller/Payment');
const { uploadPayments } = require('./controller/PortalPaymentController');
const { downloadCFDI } = require('./controller/CFDI_Downloader');
const { spawn } = require('child_process');

const dotenv = require('dotenv');
const credentials = dotenv.config({ path: '.env.credentials.focaltec' });
const env = dotenv.config({ path: '.env' });

const notifier = require('node-notifier');

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(require('./routes/routes'))

app.use(function (req, res) {
    res.status(404).sendFile(process.cwd() + '/public/404.html');
});

app.listen(3030, () => {
    console.log('Server is up on port 3030');
});

try {
    notifier.notify({
        title: 'Bienvenido!',
        message: 'El servidor se inicio correctamente en el puerto 3030',
        sound: true,
        wait: true
    });
} catch (error) {
    console.log(error)
}

forResponse = async () => {
    const tenantIds = credentials.parsed.TENANT_ID.split(',');
    for (let i = 0; i < tenantIds.length; i++) {
        // CFDI_Downloader function
        await downloadCFDI(i);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // The spawn function is used to execute the import process
        const childProcess = spawn(env.parsed.IMPORT_CFDIS_ROUTE, [env.parsed.ARGS]);

        // Stdout is used to capture the data messages
        childProcess.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });

        // Stderr is used to capture the error messages
        childProcess.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        // Close is used to capture the close event
        childProcess.on('close', (code) => {
            console.log(`child process exited with code ${code}`);
        });


        // Function to check payments in Sage and upload timbrados data
        await checkPayments(i);
        await new Promise(resolve => setTimeout(resolve, 5000));


        // Function to upload payments to the portal de proveedores
        await uploadPayments(i);
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}


setInterval(async () => {
    forResponse().then(() => {
        console.log('Proceso finalizado');
    }).catch((error) => {
        console.log(error);
    });
}, hoursToMilliseconds(env.parsed.WAIT_TIME));
