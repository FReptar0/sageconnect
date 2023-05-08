const axios = require('axios');
const { runQuery } = require('../../utils/SQLServerConnection')
require('dotenv').config({ path: '.env.credentials.focaltec' });

async function getConfig() {
    try {
        const data = await runQuery(`SELECT [URL],[TenantId],[TenantKey],[TenantSecret]
        FROM (SELECT PARAMETRO, VALOR FROM FESA.dbo.fesaParam WHERE PARAMETRO IN ('URL', 'TenantId', 'TenantKey', 'TenantSecret') AND idCia = 'GRUPO' ) AS t
        PIVOT ( MIN(VALOR) FOR PARAMETRO IN ([URL], [TenantId], [TenantKey], [TenantSecret])) AS p;
        `);
        return data[0];
    } catch (error) {
        throw new Error('Error al obtener la configuracion: \n' + error + '\n');
    }
}

/* const url = getConfig().then(rs => rs.URL)
const tenantId = getConfig().then(rs => rs.TenantId)
const apiKey = getConfig().then(rs => rs.TenantKey)
const apiSecret = getConfig().then(rs => rs.TenantSecret) */

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
        throw new Error('Error al obtener los proveedores: \n' + error + '\n');
    }
}

getProviders().then(resultado => {
    console.log(resultado)
}).catch(err => {
    console.log(err)
})

module.exports = {
    getProviders
}