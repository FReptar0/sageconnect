const axios = require('axios');
const { getConfig } = require('../../utils/FocaltecConfig');

async function getProviders() {

    const config = await getConfig();
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
        throw new Error('Error al obtener los proveedores: \n' + error + '\n');
    }
}

module.exports = {
    getProviders
}