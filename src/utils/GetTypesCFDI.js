const notifier = require('node-notifier');
require('dotenv').config({ path: '.env.credentials.focaltec' });
const axios = require('axios');

const url = process.env.URL;
const tenantIds = []
const apiKeys = []
const apiSecrets = []

const tenantIdValues = process.env.TENANT_ID.split(',');
const apiKeyValues = process.env.API_KEY.split(',');
const apiSecretValues = process.env.API_SECRET.split(',');

tenantIds.push(...tenantIdValues);
apiKeys.push(...apiKeyValues);
apiSecrets.push(...apiSecretValues);

async function getTypeP(index) {
    let date = new Date().getDate();
    let month = new Date().getMonth() + 1;
    let year = new Date().getFullYear();

    try {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis?to=${year}-${month}-${date}&from=${year}-01-01&cfdiType=PAYMENT_CFDI`, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index]
            }
        });
        return response.data.items;
    } catch (error) {
        try {
            notifier.notify({
                title: 'Focaltec',
                message: 'Error al obtener el tipo de comprobante "P" : \n' + 'error' + '\n',
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (err) {
            console.log('Error al enviar notificacion: ' );
            console.log('Error al obtener el tipo de comprobante "P" : \n' + '' + '\n');
        }
        return [];
    }
}

async function getTypeI(index) {
    let date = new Date().getDate();
    let month = new Date().getMonth() + 1;
    let year = new Date().getFullYear();

    try {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis?to=${year}-${month}-${date}&from=${year}-01-01&cfdiType=INVOICE`, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index]
            }
        });
        return response.data.items;
    } catch (error) {
        try {
            notifier.notify({
                title: 'Focaltec',
                message: 'Error al obtener el tipo de comprobante "I" : \n' + 'error' + '\n',
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al obtener el tipo de comprobante "I" : \n' + 'error' + '\n');
        }
        return [];
    }
}

async function getTypeE(index) {
    let date = new Date().getDate();
    let month = new Date().getMonth() + 1;
    let year = new Date().getFullYear();

    try {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis?to=${year}-${month}-${date}&from=${year}-01-01&cfdiType=CREDIT_NOTE`, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index]
            }
        });
        return response.data.items;
    } catch (error) {
        try {
            notifier.notify({
                title: 'Focaltec',
                message: 'Error al obtener el tipo de comprobante "E" : \n' + 'error' + '\n',
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al obtener el tipo de comprobante "E" : \n' + 'error' + '\n');
        }
        return [];
    }
}

module.exports = {
    getTypeP,
    getTypeI,
    getTypeE
}