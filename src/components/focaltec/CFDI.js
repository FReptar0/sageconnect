const axios = require('axios');
const { getConfig } = require('../../utils/FocaltecConfig');
const notifier = require('node-notifier');

async function getCFDIS() {
    const config = await getConfig();
    const url = config.URL;
    const tenantId = config.TenantId;
    const apiKey = config.TenantKey;
    const apiSecret = config.TenantSecret;

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
                wait: true
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