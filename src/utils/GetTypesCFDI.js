const notifier = require('node-notifier');
require('dotenv').config({ path: '.env.credentials.focaltec' });
const axios = require('axios');
const { runQuery } = require('./SQLServerConnection');

const url = process.env.URL;
const tenantIds = []
const apiKeys = []
const apiSecrets = []

const tenantIdValues = process.env.TENANT_ID.split(',');
const apiKeyValues = process.env.API_KEY.split(',');
const apiSecretValues = process.env.API_SECRET.split(',');

tenantIds.push(...tenantIdValues);
apiKeys.push(...apiKeyValues);
apiSecrets.push(...apiSecretValues);

async function getTypeP(index) {
    let date = new Date().getDate();
    let month = new Date().getMonth() + 1;
    let year = new Date().getFullYear();

    try {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis?to=${year}-${month}-${date}&from=${year}-01-01&cfdiType=PAYMENT_CFDI&stage=PENDING_TO_PAY`, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index]
            }
        });

        // TODO: En el servidor eliminar el return que no esta comentado y descomentar desde const data = [] hasta el return


        /* const data = []; */

        // ejecutar la siguiente query SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = `${response.data.items[i].cfdi.receptor.rfc}}`; si NREG = 0 entonces no existe el RFC en la tabla fesaParam y se debe eliminar el CFDI
        /* for (let i = 0; i < response.data.items.length; i++) {
            const query = `SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '${response.data.items[i].cfdi.receptor.rfc}';`;
            const result = await runQuery(query);
            // si NREG != 0 entonces existe el RFC en la tabla fesaParam y se debe agregar el CFDI al arreglo data
            if (result.recordset.NREG != 0) {
                data.push(response.data.items[i]);
            }
        } */

        // ejecutar la siguiente query SELECT COUNT(*) AS NREG FROM ARIBH H, ARIBHO O WHERE H.CNTBTCH  = O. CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = `${response.data.items[i].cfdi.timbre.uuid}}`; si NREG > 0 entonces existe el CFDI en la tabla ARIBHO y se debe eliminar el CFDI porque ya fue timbrado
        /* for (let i = 0; i < data.length; i++) {
            const query = `SELECT COUNT(*) AS NREG FROM ARIBH H, ARIBHO O WHERE H.CNTBTCH  = O. CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = '${data[i].cfdi.timbre.uuid}';`;
            const result = await runQuery(query);
            // si NREG > 0 entonces existe el CFDI en la tabla ARIBHO y se debe eliminar el CFDI del arreglo data
            if (result.recordset.NREG > 0) {
                data.splice(i, 1);
            }
        } */

        /* return data; */

        return response.data.items;
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

        // TODO: En el servidor eliminar el return que no esta comentado y descomentar desde const data = [] hasta el return

        /* const data = []; */

        // ejecutar la siguiente query SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = `${response.data.items[i].cfdi.receptor.rfc}}`; si NREG = 0 entonces no existe el RFC en la tabla fesaParam y se debe eliminar el CFDI
        /* for (let i = 0; i < response.data.items.length; i++) {
            const query = `SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '${response.data.items[i].cfdi.receptor.rfc}';`;
            const result = await runQuery(query);
            // si NREG != 0 entonces existe el RFC en la tabla fesaParam y se debe agregar el CFDI al arreglo data
            if (result.recordset.NREG != 0) {
                data.push(response.data.items[i]);
            }
        } */

        // ejecutar la siguiente query SELECT COUNT(*) AS NREG FROM ARIBH H, ARIBHO O WHERE H.CNTBTCH  = O. CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = `${response.data.items[i].cfdi.timbre.uuid}}`; si NREG > 0 entonces existe el CFDI en la tabla ARIBHO y se debe eliminar el CFDI porque ya fue timbrado
        /* for (let i = 0; i < data.length; i++) {
            const query = `SELECT COUNT(*) AS NREG FROM ARIBH H, ARIBHO O WHERE H.CNTBTCH  = O. CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = '${data[i].cfdi.timbre.uuid}';`;
            const result = await runQuery(query);
            // si NREG > 0 entonces existe el CFDI en la tabla ARIBHO y se debe eliminar el CFDI del arreglo data
            if (result.recordset.NREG > 0) {
                data.splice(i, 1);
            }
        } */



        /* return data || response.data.items; */

        return response.data.items;
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
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis?to=${year}-${month}-${date}&from=${year}-01-01&cfdiType=CREDIT_NOTE&stage=PENDING_TO_PAY`, {
            headers: {
                'PDPTenantKey': apiKeys[index],
                'PDPTenantSecret': apiSecrets[index]
            }
        });

        // TODO: En el servidor eliminar el return que no esta comentado y descomentar desde const data = [] hasta el return

        /* const data = []; */

        // ejecutar la siguiente query SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = `${response.data.items[i].cfdi.receptor.rfc}}`; si NREG = 0 entonces no existe el RFC en la tabla fesaParam y se debe eliminar el CFDI
        /* for (let i = 0; i < response.data.items.length; i++) {
            const query = `SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '${response.data.items[i].cfdi.receptor.rfc}';`;
            const result = await runQuery(query);
            // si NREG != 0 entonces existe el RFC en la tabla fesaParam y se debe agregar el CFDI al arreglo data
            if (result.recordset.NREG != 0) {
                data.push(response.data.items[i]);
            }
        } */

        // ejecutar la siguiente query SELECT COUNT(*) AS NREG FROM ARIBH H, ARIBHO O WHERE H.CNTBTCH  = O. CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = `${response.data.items[i].cfdi.timbre.uuid}}`; si NREG > 0 entonces existe el CFDI en la tabla ARIBHO y se debe eliminar el CFDI porque ya fue timbrado
        /* for (let i = 0; i < data.length; i++) {
            const query = `SELECT COUNT(*) AS NREG FROM ARIBH H, ARIBHO O WHERE H.CNTBTCH  = O. CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = '${data[i].cfdi.timbre.uuid}';`;
            const result = await runQuery(query);
            // si NREG > 0 entonces existe el CFDI en la tabla ARIBHO y se debe eliminar el CFDI del arreglo data
            if (result.recordset.NREG > 0) {
                data.splice(i, 1);
            }
        } */

        /* return data || response.data.items; */

        return response.data.items;
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