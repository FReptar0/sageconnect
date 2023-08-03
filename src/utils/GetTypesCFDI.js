const notifier = require('node-notifier');
require('dotenv').config({ path: '.env.credentials.focaltec' });
const axios = require('axios');
const { runQuery } = require('./SQLServerConnection');

const url = process.env.URL;
const tenantIds = []
const apiKeys = []
const apiSecrets = []
const databases = []

const tenantIdValues = process.env.TENANT_ID.split(',');
const apiKeyValues = process.env.API_KEY.split(',');
const apiSecretValues = process.env.API_SECRET.split(',');
const databaseValues = process.env.DATABASES.split(',');

tenantIds.push(...tenantIdValues);
apiKeys.push(...apiKeyValues);
apiSecrets.push(...apiSecretValues);
databases.push(...databaseValues);

async function getTypeP(index) {
    let date = new Date().getDate();
    let month = new Date().getMonth() + 1;
    let year = new Date().getFullYear();

    try {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis?to=${year}-${month}-${date}&from=${year}-01-01&cfdiType=PAYMENT_CFDI`, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index]
            }
        });

        if (response.data.total === 0) {
            console.log('No hay CFDI de tipo P para timbrar');
            return [];
        }


        const data = [];

        for (let i = 0; i < response.data.items.length; i++) {
            // Check if RFCReceptor exists in fesaParam table
            const query = `SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '${response.data.items[i].cfdi.receptor.rfc}';`;
            const result = await runQuery(query);
            // If the RFCReceptor does not exist in fesaParam table, then the CFDI is not timbrable and must be deleted
            if (result.recordset[0].NREG != 0) {
                data.push(response.data.items[i]);
            }
        }

        for (let i = 0; i < data.length; i++) {
            // Check if the CFDI exists
            const query = `SELECT COUNT(*) AS NREG FROM ARIBH H, ARIBHO O WHERE H.CNTBTCH  = O. CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = '${data[i].cfdi.timbre.uuid}';`;
            const result = await runQuery(query, databases[index]);
            // If the CFDI exists, then the CFDI is already timbrado and must be deleted
            if (result.recordset[0].NREG > 0) {
                data.splice(i, 1);
            }
        }

        return data;

        //return response.data.items;
    } catch (error) {
        try {
            notifier.notify({
                title: 'Focaltec',
                message: 'Error al obtener el tipo de comprobante "P" : \n' + error + '\n',
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al obtener el tipo de comprobante "P" : \n' + error + '\n');
        }
        return [];
    }
}

async function getTypeI(index) {
    let date = new Date().getDate();
    let month = new Date().getMonth() + 1;
    let year = new Date().getFullYear();

    try {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis?to=${year}-${month}-${date}&from=${year}-01-01&cfdiType=INVOICE&stage=PENDING_TO_PAY`, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index]
            }
        });


        const data = [];

        for (let i = 0; i < response.data.items.length; i++) {
            const query = `SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '${response.data.items[i].cfdi.receptor.rfc}';`;
            const result = await runQuery(query);
            if (result.recordset[0].NREG != 0) {
                data.push(response.data.items[i]);
            }
        }

        for (let i = 0; i < data.length; i++) {
            const query = `SELECT COUNT(*) AS NREG FROM ARIBH H, ARIBHO O WHERE H.CNTBTCH  = O. CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = '${data[i].cfdi.timbre.uuid}';`;
            const result = await runQuery(query, databases[index]);
            if (result.recordset[0].NREG > 0) {
                data.splice(i, 1);
            }
        }



        return data

    } catch (error) {
        try {
            notifier.notify({
                title: 'Focaltec',
                message: 'Error al obtener el tipo de comprobante "I" : \n' + error + '\n',
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al obtener el tipo de comprobante "I" : \n' + error + '\n');
        }
        return [];
    }
}

async function getTypeE(index) {
    let date = new Date().getDate();
    let month = new Date().getMonth() + 1;
    let year = new Date().getFullYear();

    try {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis?to=${year}-${month}-${date}&from=${year}-01-01&cfdiType=CREDIT_NOTE`, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index]
            }
        });

        const data = [];

        for (let i = 0; i < response.data.items.length; i++) {
            const query = `SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '${response.data.items[i].cfdi.receptor.rfc}';`;
            const result = await runQuery(query);
            if (result.recordset[0].NREG != 0) {
                data.push(response.data.items[i]);
            }
        }

        for (let i = 0; i < data.length; i++) {
            const query = `SELECT COUNT(*) AS NREG FROM ARIBH H, ARIBHO O WHERE H.CNTBTCH  = O. CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = '${data[i].cfdi.timbre.uuid}';`;
            const result = await runQuery(query, databases[index]);
            if (result.recordset[0].NREG > 0) {
                data.splice(i, 1);
            }
        }

        return data

        //return response.data.items;
    } catch (error) {
        try {
            notifier.notify({
                title: 'Focaltec',
                message: 'Error al obtener el tipo de comprobante "E" : \n' + error + '\n',
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al obtener el tipo de comprobante "E" : \n' + error + '\n');
        }
        return [];
    }
}

module.exports = {
    getTypeP,
    getTypeI,
    getTypeE
}