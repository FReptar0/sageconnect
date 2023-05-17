const axios = require('axios');
const { getFocaltecConfig } = require('../../utils/FocaltecConfig');
const notifier = require('node-notifier');
require('dotenv').config({ path: '.env.credentials.focaltec' });

async function getCFDIS() {
    const config = await getFocaltecConfig();
    const url = process.env.URL;
    const tenantId = process.env.TENANT_ID  ;
    const apiKey = process.env.API_KEY;
    const apiSecret = process.env.API_SECRET;

    let date = new Date().getDate();
    let month = new Date().getMonth() + 1;
    let year = new Date().getFullYear();


    try {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantId}/cfdis?to=${year}-${month}-${date}&from=${year}-01-01`, {
            headers: {
                'PDPTenantKey': apiKey,
                'PDPTenantSecret': apiSecret
            }
        });
        return response.data.items;
    } catch (err) {
        try {
            notifier.notify({
                title: 'Focaltec',
                message: 'Error al obtener los CFDIS: ' + err,
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (error) {
            console.log('Error al enviar notificacion: ' + error);
            console.log('Error al obtener los CFDIS: ' + err);
        }
    }
}

module.exports = {
    getCFDIS
}