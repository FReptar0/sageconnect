const axios = require('axios');
const { getFocaltecConfig } = require('../../utils/FocaltecConfig');

async function getProviders() {

    const config = await getFocaltecConfig();
    const url = config.URL;
    const tenantId = config.TenantId;
    const apiKey = config.TenantKey;
    const apiSecret = config.TenantSecret;

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
                wait: true
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