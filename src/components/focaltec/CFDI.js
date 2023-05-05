const axios = require('axios');
require('dotenv').config({ path: '.env.credentials.focaltec' });

const url = process.env.URL;
const tenantId = process.env.TENANT_ID;
const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;


async function getProviders() {
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
    } catch (error) {
        throw new Error('Error al obtener los proveedores');
    }
}

module.exports = {
    getProviders
}