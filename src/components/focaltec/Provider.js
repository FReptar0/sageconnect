const axios = require('axios');
const { getFocaltecConfig } = require('../../utils/FocaltecConfig');
const notifier = require('node-notifier');

async function getProviders() {

    const config = await getFocaltecConfig();
    var url = config.URL;
    var tenantId = config.TenantId;
    var apiKey = config.TenantKey;
    var apiSecret = config.TenantSecret;

    // eliminar espacio en blanco
    const regex = /\s+/g;
    url = url.replace(regex, '');
    tenantId = tenantId.replace(regex, '');
    apiKey = apiKey.replace(regex, '');
    apiSecret = apiSecret.replace(regex, '');

    try {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantId}/providers?hideBankInformation=false&emptyExternalId=false&offset=0&pageSize=1000`, {
            headers: {
                'PDPTenantKey': apiKey,
                'PDPTenantSecret': apiSecret

            }
        });
        return response.data.items;
    } catch (error) {
        try {
            notifier.notify({
                title: 'Focaltec',
                message: 'Error al obtener los proveedores: ' + error,
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al obtener los proveedores: ' + error);
        }
    }
}

module.exports = {
    getProviders
}