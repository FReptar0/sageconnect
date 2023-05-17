const express = require('express');
const { getProviders } = require('./components/focaltec/Provider')
const { minutesToMilliseconds } = require('./utils/TransformTime');
const { checkPayments } = require('./controller/PaymentController');
require('dotenv').config({ path: '.env' });
const notifier = require('node-notifier');

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(require('./routes/routes'))

app.use(function (req, res, next) {
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

setInterval(async () => {
/*     const result = await getProviders()
    console.log(result) */
/*     const rs = await checkPayments();
    console.log(rs) */
}, minutesToMilliseconds(process.env.WAIT_TIME));
