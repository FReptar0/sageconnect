const axios = require('axios');
const { getConfig } = require('../../utils/FocaltecConfig');

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
    } catch (error) {
        throw new Error('Error al obtener los CFDIS: \n' + error + '\n');
    }
}

module.exports = {
    getCFDIS
}