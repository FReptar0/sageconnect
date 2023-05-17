const axios = require('axios');
const notifier = require('node-notifier');
require('dotenv').config({ path: '.env.credentials.focaltec' });

async function getProviders() {

    if (!config) {
        try {
            notifier.notify({
                title: 'Focaltec',
                message: 'Error al obtener la configuracion del API',
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al obtener la configuracion: ');
        }
    } else {
        const url = process.env.URL;
        const tenantId = process.env.TENANT_ID;
        const apiKey = process.env.API_KEY;
        const apiSecret = process.env.API_SECRET;

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

}

module.exports = {
    getProviders
}