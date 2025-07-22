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

const PARAM_RFC_RECEPTOR = 'RFCReceptor';
const PARAM_FOLIO_CFD = 'FOLIOCFD';
const CFDI_TYPE_PAYMENT = 'PAYMENT_CFDI';
const CFDI_TYPE_INVOICE = 'INVOICE';
const CFDI_TYPE_CREDIT_NOTE = 'CREDIT_NOTE';

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
            `&cfdiType=${CFDI_TYPE_PAYMENT}`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );

        if (response.data.total === 0) {
            logInfo('GetTypesCFDI', 'No hay CFDI de tipo P');
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
                            logInfo('GetTypesCFDI', `UUID ${item.cfdi.timbre.uuid} eliminado por no tener información en el endpoint de pagos`);
                            continue;
                        }
                    } catch (error) {
                        logError('GetTypesCFDI', `Error al obtener información del pago con ID ${paymentId}: ${error.message}`);
                        continue;
                    }
                } else {
                    logInfo('GetTypesCFDI', `UUID ${item.cfdi.timbre.uuid} eliminado por no tener payment_id`);
                    continue;
                }
            }

            try {
                if (!await validateRFC(item.cfdi.receptor.rfc, index)) {
                    logInfo('GetTypesCFDI', `UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    continue;
                }

                if (await isUUIDRegistered(item.cfdi.timbre.uuid, index)) {
                    logInfo('GetTypesCFDI', `UUID ${item.cfdi.timbre.uuid} eliminado por ser ya timbrado`);
                    continue;
                }

                logInfo('GetTypesCFDI', `UUID ${item.cfdi.timbre.uuid} conservado`);
                data.push(item);
            } catch (error) {
                logError('GetTypesCFDI', `Error ejecutando validaciones para UUID ${item.cfdi.timbre.uuid}: ${error.message}`);
                continue;
            }
        }

        return data;
    } catch (error) {
        logError('GetTypesCFDI', `Error al obtener el tipo de comprobante "P": ${error.message}`);
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
            `&cfdiType=${CFDI_TYPE_INVOICE}` +
            `&stage=PENDING_TO_PAY`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );

        if (response.data.total === 0) {
            logInfo('GetTypesCFDI', 'No hay CFDI de tipo I');
            return [];
        }

        const data = [];
        for (const item of response.data.items) {
            try {
                if (!await validateRFC(item.cfdi.receptor.rfc, index)) {
                    logInfo('GetTypesCFDI', `UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    continue;
                }

                const cfdiQuery = `SELECT COUNT(*) AS NREG FROM APIBH H, APIBHO O WHERE H.CNTBTCH = O.CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = '${PARAM_FOLIO_CFD}' AND [VALUE] = '${item.cfdi.timbre.uuid}';`;
                const cfdiResult = await executeQuery(cfdiQuery, index, 'CFDI Query');
                if (cfdiResult.recordset[0].NREG > 0) {
                    logInfo('GetTypesCFDI', `UUID ${item.cfdi.timbre.uuid} eliminado por ser ya timbrado`);
                    continue;
                }

                const poCheckQuery = `
                    SELECT COUNT(O.[VALUE]) AS NREG
                      FROM POINVH1 H
                      JOIN POINVHO O ON H.INVHSEQ = O.INVHSEQ
                     WHERE O.OPTFIELD = '${PARAM_FOLIO_CFD}'
                       AND O.[VALUE]  = '${item.cfdi.timbre.uuid}'
                `;
                const poCheckResult = await executeQuery(poCheckQuery, index, 'PO Check Query');
                if (poCheckResult.recordset[0].NREG > 0) {
                    logInfo('GetTypesCFDI', `UUID ${item.cfdi.timbre.uuid} eliminado por existir en Sage OC (ya registrado en órdenes de compra)`);
                    continue;
                }

                logInfo('GetTypesCFDI', `UUID ${item.cfdi.timbre.uuid} conservado`);
                data.push(item);
            } catch (error) {
                logError('GetTypesCFDI', `Error ejecutando validaciones para UUID ${item.cfdi.timbre.uuid}: ${error.message}`);
                continue;
            }
        }

        return data;
    } catch (error) {
        logError('GetTypesCFDI', `Error al obtener el tipo de comprobante "I": ${error.message}`);
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
            `&cfdiType=${CFDI_TYPE_INVOICE}` +
            `&status=TO_SEND`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );

        if (response.data.total === 0) {
            logInfo('GetTypesCFDI', 'No hay CFDI de tipo I TO_SEND');
            return [];
        }

        const data = [];
        for (const item of response.data.items) {
            const uuid = item.cfdi.timbre.uuid;
            const rels = item.cfdi.cfdis_relacionados;
            if (!Array.isArray(rels) || !rels.some(r => r.tipo_relacion === '07')) {
                logInfo('GetTypesCFDI', `UUID ${uuid} eliminado por no tener cfdi_relacionados tipo 07`);
                continue;
            }

            try {
                if (!await validateRFC(item.cfdi.receptor.rfc, index)) {
                    logInfo('GetTypesCFDI', `UUID ${uuid} eliminado por falta de ${PARAM_RFC_RECEPTOR} en fesa`);
                    continue;
                }

                const cfdiQuery = `
                    SELECT COUNT(*) AS NREG
                      FROM APIBH H
                      JOIN APIBHO O
                        ON H.CNTBTCH = O.CNTBTCH
                       AND H.CNTITEM = O.CNTITEM
                     WHERE H.ERRENTRY = 0
                       AND O.OPTFIELD = '${PARAM_FOLIO_CFD}'
                       AND [VALUE]    = '${uuid}';
                `;
                const cfdiResult = await executeQuery(cfdiQuery, index, 'CFDI Query');
                if (cfdiResult.recordset[0].NREG > 0) {
                    logInfo('GetTypesCFDI', `UUID ${uuid} eliminado por ser ya timbrado`);
                    continue;
                }

                const poCheckQuery = `
                    SELECT COUNT(O.[VALUE]) AS NREG
                      FROM POINVH1 H
                      JOIN POINVHO O ON H.INVHSEQ = O.INVHSEQ
                     WHERE O.OPTFIELD = '${PARAM_FOLIO_CFD}'
                       AND O.[VALUE]  = '${uuid}'
                `;
                const poCheckResult = await executeQuery(poCheckQuery, index, 'PO Check Query');
                if (poCheckResult.recordset[0].NREG > 0) {
                    logInfo('GetTypesCFDI', `UUID ${uuid} eliminado por existir en Sage OC (ya registrado en órdenes de compra)`);
                    continue;
                }

                logInfo('GetTypesCFDI', `UUID ${uuid} conservado`);
                data.push(item);
            } catch (error) {
                logError('GetTypesCFDI', `Error ejecutando validaciones para UUID ${uuid}: ${error.message}`);
                continue;
            }
        }

        return data;
    } catch (error) {
        logError('GetTypesCFDI', `Error al obtener el tipo de comprobante "I" TO_SEND: ${error.message}`);
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
            `&cfdiType=${CFDI_TYPE_CREDIT_NOTE}`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );

        if (response.data.total === 0) {
            logInfo('GetTypesCFDI', 'No hay CFDI de tipo E');
            return [];
        }

        const data = [];
        for (const item of response.data.items) {
            const uuid = item.cfdi.timbre.uuid;

            try {
                if (!await validateRFC(item.cfdi.receptor.rfc, index)) {
                    logInfo('GetTypesCFDI', `UUID ${uuid} eliminado por falta de ${PARAM_RFC_RECEPTOR} en fesa`);
                    continue;
                }

                const cfdiQuery = `
                    SELECT COUNT(*) AS NREG
                      FROM APIBH H
                      JOIN APIBHO O
                        ON H.CNTBTCH = O.CNTBTCH
                       AND H.CNTITEM = O.CNTITEM
                     WHERE H.ERRENTRY = 0
                       AND O.OPTFIELD = '${PARAM_FOLIO_CFD}'
                       AND [VALUE]    = '${uuid}';
                `;
                const cfdiResult = await executeQuery(cfdiQuery, index, 'CFDI Query');
                if (cfdiResult.recordset[0].NREG > 0) {
                    logInfo('GetTypesCFDI', `UUID ${uuid} eliminado por ser ya timbrado`);
                    continue;
                }

                const crnCheckQuery = `
                    SELECT COUNT(O.[VALUE]) AS NREG
                      FROM POCRNH1 H
                      JOIN POCRNHO O ON H.CRNHSEQ = O.CRNHSEQ
                     WHERE O.OPTFIELD = '${PARAM_FOLIO_CFD}'
                       AND O.[VALUE]  = '${uuid}'
                `;
                const crnCheckResult = await executeQuery(crnCheckQuery, index, 'CRN Check Query');
                if (crnCheckResult.recordset[0].NREG > 0) {
                    logInfo('GetTypesCFDI', `UUID ${uuid} eliminado por existir en Sage NC (ya registrado en notas de crédito)`);
                    continue;
                }

                logInfo('GetTypesCFDI', `UUID ${uuid} conservado`);
                data.push(item);
            } catch (error) {
                logError('GetTypesCFDI', `Error ejecutando validaciones para UUID ${uuid}: ${error.message}`);
                continue;
            }
        }

        return data;
    } catch (error) {
        logError('GetTypesCFDI', `Error al obtener el tipo de comprobante "E": ${error.message}`);
        return [];
    }
}

async function isUUIDRegistered(uuid, index) {
    const query = `
        SELECT COUNT(*) AS NREG
          FROM APIBH H
          JOIN APIBHO O
            ON H.CNTBTCH = O.CNTBTCH
           AND H.CNTITEM = O.CNTITEM
         WHERE H.ERRENTRY = 0
           AND O.OPTFIELD = '${PARAM_FOLIO_CFD}'
           AND [VALUE]    = '${uuid}';
    `;
    try {
        const result = await runQuery(query, databases[index]);
        logInfo('isUUIDRegistered', `Consulta ejecutada exitosamente para UUID: ${uuid}, Resultado: ${result.recordset[0].NREG}`);
        return result.recordset[0].NREG > 0;
    } catch (error) {
        logError('isUUIDRegistered', `Error al verificar UUID ${uuid} en la base de datos: ${error.message}`);
        return false;
    }
}

async function validateRFC(rfc, index) {
    const query = `
        SELECT COUNT(*) AS NREG
          FROM fesaParam
         WHERE Parametro = '${PARAM_RFC_RECEPTOR}'
           AND VALOR     = '${rfc}';
    `;
    try {
        const result = await runQuery(query, databases[index]);
        logInfo('validateRFC', `Consulta ejecutada exitosamente para RFC: ${rfc}, Resultado: ${result.recordset[0].NREG}`);
        return result.recordset[0].NREG > 0;
    } catch (error) {
        logError('validateRFC', `Error al validar RFC ${rfc} en la base de datos: ${error.message}`);
        return false;
    }
}

async function executeQuery(query, index, context) {
    try {
        return await runQuery(query, databases[index]);
    } catch (error) {
        logGenerator('GetTypesCFDI', 'error', `Error ejecutando consulta en ${context}: ${error.message}`);
        throw error;
    }
}

function logInfo(context, message) {
    console.log(`[INFO] ${message}`);
    logGenerator(context, 'info', message);
}

function logError(context, message) {
    console.log(`[ERROR] ${message}`);
    logGenerator(context, 'error', message);
}

module.exports = {
    getTypeP,
    getTypeI,
    getTypeIToSend,
    getTypeE
}