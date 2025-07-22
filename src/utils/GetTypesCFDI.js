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

const urlBase = (index) => `${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis`;

async function getTypeP(index) {
    let date = new Date();
    let dateFrom = new Date(date.setMonth(date.getMonth() - 1)).toISOString().slice(0, 7);
    let dateUntil = new Date().toISOString().slice(0, 10);

    try {
        const response = await axios.get(
            urlBase(index) +
            `?to=${dateUntil}` +
            `&from=${dateFrom}-01` +
            `&documentTypes=CFDI` +
            `&offset=0&pageSize=0` +
            `&cfdiType=PAYMENT_CFDI`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );

        if (response.data.total === 0) {
            console.log('[INFO] No hay CFDI de tipo P');
            return [];
        }

        const data = [];
        for (const item of response.data.items) {
            if (!item.metadata.payment_info || item.metadata.payment_info.payments.length === 0) {
                if (item.payment_complement_info && item.payment_complement_info[0].payment_id) {
                    const paymentId = item.payment_complement_info[0].payment_id;
                    try {
                        const paymentResponse = await axios.get(
                            `${url}/api/1.0/extern/tenants/${tenantIds[index]}/payments/${paymentId}`,
                            {
                                headers: {
                                    'PDPTenantKey': apiKeys[index],
                                    'PDPTenantSecret': apiSecrets[index]
                                }
                            }
                        );

                        if (paymentResponse.data) {
                            item.metadata.payment_info = {
                                payments: [
                                    {
                                        external_id: paymentResponse.data.external_id
                                    }
                                ]
                            };
                        } else {
                            console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por no tener información en el endpoint de pagos`);
                            logGenerator('GetTypesCFDI', 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por no tener información en el endpoint de pagos`);
                            continue;
                        }
                    } catch (error) {
                        console.log(`[ERROR] No se pudo obtener información del pago con ID ${paymentId}:`, error.message);
                        logGenerator('GetTypesCFDI', 'error', `Error al obtener información del pago con ID ${paymentId}: ${error.message}`);
                        continue;
                    }
                } else {
                    console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por no tener payment_id`);
                    logGenerator('GetTypesCFDI', 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por no tener payment_id`);
                    continue;
                }
            }

            const rfcQuery = `SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '${item.cfdi.receptor.rfc}';`;
            try {
                const rfcResult = await runQuery(rfcQuery);
                if (rfcResult.recordset[0].NREG === 0) {
                    console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    logGenerator('GetTypesCFDI', 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    continue;
                }

                const cfdiQuery = `SELECT COUNT(*) AS NREG FROM APIBH H, APIBHO O WHERE H.CNTBTCH = O.CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = '${item.cfdi.timbre.uuid}';`;
                const cfdiResult = await runQuery(cfdiQuery, databases[index]);
                if (cfdiResult.recordset[0].NREG > 0) {
                    console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por ser ya timbrado`);
                    continue;
                }

                console.log(`[OK] UUID ${item.cfdi.timbre.uuid} conservado`);
                data.push(item);
            } catch (error) {
                console.log(`[ERROR] Error ejecutando consultas SQL para UUID ${item.cfdi.timbre.uuid}: ${error.message}`);
                logGenerator('GetTypesCFDI', 'error', `Error ejecutando consultas SQL para UUID ${item.cfdi.timbre.uuid}: ${error.message}`);
                continue;
            }
        }

        return data;
    } catch (error) {
        try {
            logGenerator('GetTypesCFDI', 'error', 'Error al obtener el tipo de comprobante "P" : \n' + error + '\n');
        } catch (err) {
            console.log('Error al enviar notificación: ' + err);
        }
        return [];
    }
}

async function getTypeI(index) {
    let date = new Date();
    let dateFrom = new Date(date.setMonth(date.getMonth() - 1)).toISOString().slice(0, 7);
    let dateUntil = new Date().toISOString().slice(0, 10);

    try {
        const response = await axios.get(
            urlBase(index) +
            `?to=${dateUntil}` +
            `&from=${dateFrom}-01` +
            `&documentTypes=CFDI` +
            `&offset=0&pageSize=0` +
            `&cfdiType=INVOICE` +
            `&stage=PENDING_TO_PAY`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );

        if (response.data.total === 0) {
            console.log('[INFO] No hay CFDI de tipo I');
            return [];
        }

        const data = [];
        for (const item of response.data.items) {
            const rfcQuery = `SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '${item.cfdi.receptor.rfc}';`;
            try {
                const rfcResult = await runQuery(rfcQuery);
                if (rfcResult.recordset[0].NREG === 0) {
                    console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    logGenerator('GetTypesCFDI', 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    continue;
                }

                const cfdiQuery = `SELECT COUNT(*) AS NREG FROM APIBH H, APIBHO O WHERE H.CNTBTCH = O.CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = '${item.cfdi.timbre.uuid}';`;
                const cfdiResult = await runQuery(cfdiQuery, databases[index]);
                if (cfdiResult.recordset[0].NREG > 0) {
                    console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por ser ya timbrado`);
                    continue;
                }

                const poCheckQuery = `
                    SELECT COUNT(O.[VALUE]) AS NREG
                      FROM POINVH1 H
                      JOIN POINVHO O ON H.INVHSEQ = O.INVHSEQ
                     WHERE O.OPTFIELD = 'FOLIOCFD'
                       AND O.[VALUE]  = '${item.cfdi.timbre.uuid}'
                `;
                const poCheckResult = await runQuery(poCheckQuery, databases[index]);
                if (poCheckResult.recordset[0].NREG > 0) {
                    console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por existir en Sage OC (ya registrado en órdenes de compra)`);
                    continue;
                }

                console.log(`[OK] UUID ${item.cfdi.timbre.uuid} conservado`);
                data.push(item);
            } catch (error) {
                console.log(`[ERROR] Error executing query: ${error}`);
                logGenerator('GetTypesCFDI', 'error', 'Error executing query: \n' + error + '\n');
            }
        }

        return data;
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


async function getTypeIToSend(index) {
    let date = new Date();
    let dateFrom = new Date(date.setMonth(date.getMonth() - 2)).toISOString().slice(0, 7);
    let dateUntil = new Date().toISOString().slice(0, 10);

    try {
        const response = await axios.get(
            urlBase(index) +
            `?to=${dateUntil}` +
            `&from=${dateFrom}-01` +
            `&documentTypes=CFDI` +
            `&offset=0&pageSize=0` +
            `&cfdiType=INVOICE` +
            `&status=TO_SEND`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );

        if (response.data.total === 0) {
            console.log('[INFO] No hay CFDI de tipo I TO_SEND');
            return [];
        }

        const data = [];
        for (const item of response.data.items) {
            const uuid = item.cfdi.timbre.uuid;
            const rels = item.cfdi.cfdis_relacionados;
            if (!Array.isArray(rels) || !rels.some(r => r.tipo_relacion === '07')) {
                console.log(`[INFO] UUID ${uuid} eliminado por no tener cfdi_relacionados tipo 07`);
                logGenerator('GetTypesCFDI', 'info', `UUID ${uuid} eliminado por no tener cfdi_relacionados tipo 07`);
                continue;
            }

            const rfc = item.cfdi.receptor.rfc;
            const rfcQuery = `
                SELECT COUNT(*) AS NREG
                  FROM fesaParam
                 WHERE Parametro = 'RFCReceptor'
                   AND VALOR     = '${rfc}';
            `;
            try {
                const rfcResult = await runQuery(rfcQuery);
                if (rfcResult.recordset[0].NREG === 0) {
                    console.log(`[INFO] UUID ${uuid} eliminado por falta de RFCReceptor en fesa`);
                    logGenerator('GetTypesCFDI', 'info', `UUID ${uuid} eliminado por falta de RFCReceptor en fesa`);
                    continue;
                }
            } catch (err) {
                console.log(`Error ejecutando rfcQuery: ${err.message}`);
                logGenerator('GetTypesCFDI', 'error', `Error ejecutando rfcQuery para UUID ${uuid}: ${err.stack}`);
                continue;
            }

            const cfdiQuery = `
                SELECT COUNT(*) AS NREG
                  FROM APIBH H
                  JOIN APIBHO O
                    ON H.CNTBTCH = O.CNTBTCH
                   AND H.CNTITEM = O.CNTITEM
                 WHERE H.ERRENTRY = 0
                   AND O.OPTFIELD = 'FOLIOCFD'
                   AND [VALUE]    = '${uuid}';
            `;
            try {
                const cfdiResult = await runQuery(cfdiQuery, databases[index]);
                if (cfdiResult.recordset[0].NREG > 0) {
                    console.log(`[INFO] UUID ${uuid} eliminado por ser ya timbrado`);
                    continue;
                }
            } catch (err) {
                console.log(`Error ejecutando cfdiQuery: ${err.message}`);
                logGenerator('GetTypesCFDI', 'error', `Error ejecutando cfdiQuery para UUID ${uuid}: ${err.stack}`);
                continue;
            }

            const poCheckQuery = `
                SELECT COUNT(O.[VALUE]) AS NREG
                  FROM POINVH1 H
                  JOIN POINVHO O ON H.INVHSEQ = O.INVHSEQ
                 WHERE O.OPTFIELD = 'FOLIOCFD'
                   AND O.[VALUE]  = '${uuid}'
            `;
            try {
                const poCheckResult = await runQuery(poCheckQuery, databases[index]);
                if (poCheckResult.recordset[0].NREG > 0) {
                    console.log(`[INFO] UUID ${uuid} eliminado por existir en Sage OC (ya registrado en órdenes de compra)`);
                    continue;
                }
            } catch (err) {
                console.log(`Error ejecutando poCheckQuery: ${err.message}`);
                logGenerator('GetTypesCFDI', 'error', `Error ejecutando poCheckQuery para UUID ${uuid}: ${err.stack}`);
                continue;
            }

            console.log(`[OK] UUID ${uuid} conservado`);
            data.push(item);
        }

        return data;
    } catch (error) {
        logGenerator('GetTypesCFDI', 'error', `Error al obtener el tipo de comprobante "I" TO_SEND :\n${error.stack}`);
        try {
            notifier.notify({
                title: 'Focaltec',
                message: 'Error al obtener el tipo I TO_SEND: ' + error.message,
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (notifyErr) {
            console.log('Error al enviar notificación: ' + notifyErr.message);
        }
        return [];
    }
}

async function getTypeE(index) {
    let date = new Date();
    let dateFrom = new Date(date.setMonth(date.getMonth() - 1)).toISOString().slice(0, 7);
    let dateUntil = new Date().toISOString().slice(0, 10);

    try {
        const response = await axios.get(
            urlBase(index) +
            `?to=${dateUntil}` +
            `&from=${dateFrom}-01` +
            `&documentTypes=CFDI` +
            `&offset=0&pageSize=0` +
            `&cfdiType=CREDIT_NOTE`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );

        if (response.data.total === 0) {
            console.log('[INFO] No hay CFDI de tipo E');
            return [];
        }

        const data = [];
        for (const item of response.data.items) {
            const uuid = item.cfdi.timbre.uuid;

            const rfcQuery = `
                SELECT COUNT(*) AS NREG
                  FROM fesaParam
                 WHERE Parametro = 'RFCReceptor'
                   AND VALOR     = '${item.cfdi.receptor.rfc}';
            `;
            try {
                const rfcResult = await runQuery(rfcQuery);
                if (rfcResult.recordset[0].NREG === 0) {
                    console.log(`[INFO] UUID ${uuid} eliminado por falta de RFCReceptor en fesa`);
                    logGenerator('GetTypesCFDI', 'info', `UUID ${uuid} eliminado por falta de RFCReceptor en fesa`);
                    continue;
                }

                const cfdiQuery = `
                    SELECT COUNT(*) AS NREG
                      FROM APIBH H
                      JOIN APIBHO O
                        ON H.CNTBTCH = O.CNTBTCH
                       AND H.CNTITEM = O.CNTITEM
                     WHERE H.ERRENTRY = 0
                       AND O.OPTFIELD = 'FOLIOCFD'
                       AND [VALUE]    = '${uuid}';
                `;
                const cfdiResult = await runQuery(cfdiQuery, databases[index]);
                if (cfdiResult.recordset[0].NREG > 0) {
                    console.log(`[INFO] UUID ${uuid} eliminado por ser ya timbrado`);
                    continue;
                }

                const crnCheckQuery = `
                    SELECT COUNT(O.[VALUE]) AS NREG
                      FROM POCRNH1 H
                      JOIN POCRNHO O ON H.CRNHSEQ = O.CRNHSEQ
                     WHERE O.OPTFIELD = 'FOLIOCFD'
                       AND O.[VALUE]  = '${uuid}'
                `;
                const crnCheckResult = await runQuery(crnCheckQuery, databases[index]);
                if (crnCheckResult.recordset[0].NREG > 0) {
                    console.log(`[INFO] UUID ${uuid} eliminado por existir en Sage NC (ya registrado en notas de crédito)`);
                    continue;
                }

                console.log(`[OK] UUID ${uuid} conservado`);
                data.push(item);
            } catch (error) {
                console.log(`[ERROR] Error executing query: ${error}`);
                logGenerator('GetTypesCFDI', 'error', `Error executing query: \n${error}\n`);
            }
        }

        return data;
    } catch (error) {
        logGenerator('GetTypesCFDI', 'error', `Error al obtener el tipo de comprobante "E": \n${error}\n`);
        notifier.notify({
            title: 'Focaltec',
            message: 'Error al obtener el tipo de comprobante "E": ' + error,
            sound: true,
            wait: true,
            icon: process.cwd() + '/public/img/cerrar.png'
        });
        return [];
    }
}


module.exports = {
    getTypeP,
    getTypeI,
    getTypeIToSend,
    getTypeE
}