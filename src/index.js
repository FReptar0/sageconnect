const express = require('express');
const { getProviders } = require('./components/focaltec/Provider')
const { minutesToMilliseconds } = require('./utils/TransformTime');

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
    getProviders().then(result => {
        console.console.log(result);
    })
    .catch(err => {
        console.log(err)
    })
}, minutesToMilliseconds());
