const express = require('express');
const { minutesToMilliseconds } = require('./utils/TransformTime');
require('dotenv').config({ path: '.env.mail' });

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(require('./routes/routes'))

app.listen(3030, () => {
    console.log('Server is up on port 3030');
});

setInterval(() => {
    // TODO: Llamar a las funciones que se ejecutarán cada cierto tiempo
    // * Son las funciones de comparación de datos
}, minutesToMilliseconds(process.env.WAIT_TIME));
