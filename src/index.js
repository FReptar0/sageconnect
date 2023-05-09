const express = require('express');
const { getProviders } = require('./components/focaltec/Provider')
const { minutesToMilliseconds } = require('./utils/TransformTime');
require('dotenv').config({ path: '.env' });

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

setInterval(async () => {


}, minutesToMilliseconds(process.env.WAIT_TIME));
