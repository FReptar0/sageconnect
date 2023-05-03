const express = require('express');
const { getProviders } = require('./components/Provider');
const { minutesToMilliseconds } = require('./utils/TransformTime');
require('dotenv').config({ path: '.env.mail'});

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(require('./routes/routes'))

app.listen(3030, () => {
    console.log('Server is up on port 3030');
});

// Se verificara la informacion cada x minutos definidos en el archivo .env.mail
setInterval(() => {
    getProviders();
}, minutesToMilliseconds(process.env.WAIT_TIME));
