const axios = require('axios');
require('dotenv').config({ path: '.env.credentials.focaltec' });

const url = process.env.URL;
const tenantId = process.env.TENANT_ID;
const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;

async function getProviders() {
    try {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantId}/providers?hideBankInformation=false&emptyExternalId=false&offset=0&pageSize=1000`, {
            headers: {
                'PDPTenantKey': apiKey,
                'PDPTenantSecret': apiSecret
            }
        });
        return response.data.items;
    } catch (error) {
        throw new Error('Error al obtener los proveedores');
    }
}

module.exports = {
    getProviders
}