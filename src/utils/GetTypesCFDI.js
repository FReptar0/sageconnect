const notifier = require('node-notifier');
require('dotenv').config({ path: '.env.credentials.focaltec' });
const axios = require('axios');
const { runQuery } = require('./SQLServerConnection');
const { logGenerator } = require('./LogGenerator');

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
    let date = new Date();
    let dateFrom = new Date(date.setMonth(date.getMonth() - 1)).toISOString().slice(0, 7)
    let dateUntil = new Date().toISOString().slice(0, 10);

    try {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis?createdUntil=${dateUntil}&createdFrom=${dateFrom}-01&documentTypes=CFDI&offset=0&pageSize=0&cfdiType=PAYMENT_CFDI`, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index]
            }
        });

        if (response.data.total === 0) {
            console.log('No hay CFDI de tipo P');
            return [];
        }


        const data = [];
        for (const item of response.data.items) {

            console.log(item.metadata.payment_info.payments.length);

            if (item.metadata.payment_info.payments.length === 0) {
                console.log(`UUID ${item.cfdi.timbre.uuid} eliminado por no tener pagos`);
                logGenerator('GetTypesCFDI', 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por no tener pagos`);
                continue; // Skip this item
            }

            const rfcQuery = `SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '${item.cfdi.receptor.rfc}';`;
            try {
                const rfcResult = await runQuery(rfcQuery);
                if (rfcResult.recordset[0].NREG === 0) {
                    console.log(`UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    logGenerator('GetTypesCFDI', 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    continue; // Skip this item
                }

                const cfdiQuery = `SELECT COUNT(*) AS NREG FROM APIBH H, APIBHO O WHERE H.CNTBTCH = O.CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = '${item.cfdi.timbre.uuid}';`;
                const cfdiResult = await runQuery(cfdiQuery, databases[index]);
                if (cfdiResult.recordset[0].NREG > 0) {
                    console.log(`UUID ${item.cfdi.timbre.uuid} eliminado por ser ya timbrado`);
                    continue; // Skip this item
                }

                console.log(`UUID ${item.cfdi.timbre.uuid} conservado`);
                data.push(item); // Keep this item
            } catch (error) {
                console.log(`Error executing query: ${error}`);
                logGenerator('GetTypesCFDI', 'error', 'Error executing query: \n' + error + '\n');
            }
        }

        return data;

        //return response.data.items;
    } catch (error) {
        try {
            logGenerator('GetTypesCFDI', 'error', 'Error al obtener el tipo de comprobante "P" : \n' + error + '\n');
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
    let date = new Date();
    let dateFrom = new Date(date.setMonth(date.getMonth() - 1)).toISOString().slice(0, 7)
    let dateUntil = new Date().toISOString().slice(0, 10);

    try {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis?createdUntil=${dateUntil}&createdFrom=${dateFrom}-01&documentTypes=CFDI&offset=0&pageSize=0&cfdiType=INVOICE&stage=PENDING_TO_PAY`, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index]
            }
        });

        if (response.data.total === 0) {
            console.log('No hay CFDI de tipo I');
            return [];
        }

        const data = [];
        for (const item of response.data.items) {
            const rfcQuery = `SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '${item.cfdi.receptor.rfc}';`;
            try {
                const rfcResult = await runQuery(rfcQuery);
                if (rfcResult.recordset[0].NREG === 0) {
                    console.log(`UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    logGenerator('GetTypesCFDI', 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    continue; // Skip this item
                }

                const cfdiQuery = `SELECT COUNT(*) AS NREG FROM APIBH H, APIBHO O WHERE H.CNTBTCH = O.CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = '${item.cfdi.timbre.uuid}';`;
                const cfdiResult = await runQuery(cfdiQuery, databases[index]);
                if (cfdiResult.recordset[0].NREG > 0) {
                    console.log(`UUID ${item.cfdi.timbre.uuid} eliminado por ser ya timbrado`);
                    continue; // Skip this item
                }

                console.log(`UUID ${item.cfdi.timbre.uuid} conservado`);
                data.push(item); // Keep this item
            } catch (error) {
                console.log(`Error executing query: ${error}`);
                logGenerator('GetTypesCFDI', 'error', 'Error executing query: \n' + error + '\n');
            }
        }

        return data

    } catch (error) {
        try {
            logGenerator('GetTypesCFDI', 'error', 'Error al obtener el tipo de comprobante "I" : \n' + error + '\n');
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
    let date = new Date();
    let dateFrom = new Date(date.setMonth(date.getMonth() - 1)).toISOString().slice(0, 7)
    let dateUntil = new Date().toISOString().slice(0, 10);

    try {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis?createdUntil=${dateUntil}&createdFrom=${dateFrom}-01&documentTypes=CFDI&offset=0&pageSize=0&cfdiType=CREDIT_NOTE`, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index]
            }
        });

        if (response.data.total === 0) {
            console.log('No hay CFDI de tipo E');
            return [];
        }

        const data = [];
        for (const item of response.data.items) {
            const rfcQuery = `SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '${item.cfdi.receptor.rfc}';`;
            try {
                const rfcResult = await runQuery(rfcQuery);
                if (rfcResult.recordset[0].NREG === 0) {
                    console.log(`UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    logGenerator('GetTypesCFDI', 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    continue; // Skip this item
                }

                const cfdiQuery = `SELECT COUNT(*) AS NREG FROM APIBH H, APIBHO O WHERE H.CNTBTCH = O.CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = '${item.cfdi.timbre.uuid}';`;
                const cfdiResult = await runQuery(cfdiQuery, databases[index]);
                if (cfdiResult.recordset[0].NREG > 0) {
                    console.log(`UUID ${item.cfdi.timbre.uuid} eliminado por ser ya timbrado`);
                    continue; // Skip this item
                }

                console.log(`UUID ${item.cfdi.timbre.uuid} conservado`);
                data.push(item); // Keep this item
            } catch (error) {
                console.log(`Error executing query: ${error}`);
                logGenerator('GetTypesCFDI', 'error', 'Error executing query: \n' + error + '\n');
            }
        }

        return data

        //return response.data.items;
    } catch (error) {
        try {
            logGenerator('GetTypesCFDI', 'error', 'Error al obtener el tipo de comprobante "E" : \n' + error + '\n');
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