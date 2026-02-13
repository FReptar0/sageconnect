require('dotenv').config({ path: '.env.credentials.focaltec' });
const axios = require('axios');
const { getOneMonthAgoString, getCurrentDateString } = require('./TimezoneHelper');
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
    const logFileName = 'GetTypesCFDI';
    logGenerator(logFileName, 'info', `[START] Iniciando procesamiento de CFDI tipo P (PAYMENT_CFDI) para index=${index}`);
    let dateFrom = getOneMonthAgoString();
    let dateUntil = getCurrentDateString();

    try {
        const response = await axios.get(
            urlBase(index) +
            `?from=${dateFrom}-01&to=${dateUntil}` +
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
                            logGenerator(logFileName, 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por no tener información en el endpoint de pagos`);
                            continue;
                        }
                    } catch (error) {
                        console.log(`[ERROR] No se pudo obtener información del pago con ID ${paymentId}:`, error.message);
                        logGenerator(logFileName, 'error', `Error al obtener información del pago con ID ${paymentId}: ${error.message}`);
                        continue;
                    }
                } else {
                    console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por no tener payment_id`);
                    logGenerator(logFileName, 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por no tener payment_id`);
                    continue;
                }
            }

            const rfcQuery = `SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '${item.cfdi.receptor.rfc}';`;
            try {
                const rfcResult = await runQuery(rfcQuery);
                if (rfcResult.recordset[0].NREG === 0) {
                    console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    logGenerator(logFileName, 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
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
                logGenerator(logFileName, 'error', `Error ejecutando consultas SQL para UUID ${item.cfdi.timbre.uuid}: ${error.message}`);
                continue;
            }
        }

        return data;
    } catch (error) {
        try {
            logGenerator(logFileName, 'error', 'Error al obtener el tipo de comprobante "P" : \n' + error + '\n');
        } catch (err) {
            console.log('Error al enviar notificación: ' + err);
        }
        return [];
    }
}

async function getTypeI(index) {
    const logFileName = 'GetTypesCFDI';
    logGenerator(logFileName, 'info', `[START] Iniciando procesamiento de CFDI tipo I (INVOICE) PENDING_TO_PAY para index=${index}`);
    let dateFrom = getOneMonthAgoString();
    let dateUntil = getCurrentDateString();

    try {
        const response = await axios.get(
            urlBase(index) +
            `?from=${dateFrom}-01&to=${dateUntil}` +
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
                    logGenerator(logFileName, 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
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
                logGenerator(logFileName, 'error', 'Error executing query: \n' + error + '\n');
            }
        }

        return data;
    } catch (error) {
        try {
            logGenerator(logFileName, 'error', 'Error al obtener el tipo de comprobante "I" : \n' + error + '\n');
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al obtener el tipo de comprobante "I" : \n' + error + '\n');
        }
        return [];
    }
}


async function getTypeIToSend(index) {
    const logFileName = 'GetTypesCFDI';
    logGenerator(logFileName, 'info', `[START] Iniciando procesamiento de CFDI tipo I (INVOICE) TO_SEND para index=${index}`);
    let dateFrom = getOneMonthAgoString();
    let dateUntil = getCurrentDateString();

    try {
        const response = await axios.get(
            urlBase(index) +
            `?from=${dateFrom}-01&to=${dateUntil}` +
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
                logGenerator(logFileName, 'info', `UUID ${uuid} eliminado por no tener cfdi_relacionados tipo 07`);
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
                    logGenerator(logFileName, 'info', `UUID ${uuid} eliminado por falta de RFCReceptor en fesa`);
                    continue;
                }
            } catch (err) {
                console.log(`Error ejecutando rfcQuery: ${err.message}`);
                logGenerator(logFileName, 'error', `Error ejecutando rfcQuery para UUID ${uuid}: ${err.stack}`);
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
                logGenerator(logFileName, 'error', `Error ejecutando cfdiQuery para UUID ${uuid}: ${err.stack}`);
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
                logGenerator(logFileName, 'error', `Error ejecutando poCheckQuery para UUID ${uuid}: ${err.stack}`);
                continue;
            }

            console.log(`[OK] UUID ${uuid} conservado`);
            data.push(item);
        }

        return data;
    } catch (error) {
        logGenerator(logFileName, 'error', `Error al obtener el tipo de comprobante "I" TO_SEND :\n${error.stack}`);
        return [];
    }
}

async function getTypeE(index) {
    const logFileName = 'GetTypesCFDI';
    logGenerator(logFileName, 'info', `[START] Iniciando procesamiento de CFDI tipo E (CREDIT_NOTE) para index=${index}`);
    let dateFrom = getOneMonthAgoString();
    let dateUntil = getCurrentDateString();

    try {
        const response = await axios.get(
            urlBase(index) +
            `?from=${dateFrom}-01&to=${dateUntil}` +
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
                    logGenerator(logFileName, 'info', `UUID ${uuid} eliminado por falta de RFCReceptor en fesa`);
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
                logGenerator(logFileName, 'error', `Error executing query: \n${error}\n`);
            }
        }

        return data;
    } catch (error) {
        logGenerator(logFileName, 'error', `Error al obtener el tipo de comprobante "E": \n${error}\n`);
        return [];
    }
}


/**
 * Obtiene CFDIs PENDING_TO_PAY de tipo INVOICE filtrados por provider_id.
 * @param {number} index - Índice del tenant.
 * @param {string} providerId - ID del proveedor en el portal.
 * @returns {Promise<Array>} - CFDIs del proveedor.
 */
async function getCfdisByProvider(index, providerId) {
    const logFileName = 'GetTypesCFDI';
    let dateFrom = getOneMonthAgoString();
    let dateUntil = getCurrentDateString();

    try {
        const response = await axios.get(
            urlBase(index) +
            `?from=${dateFrom}-01&to=${dateUntil}` +
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

        if (response.data.total === 0) return [];

        return (response.data.items || []).filter(
            item => item.metadata?.provider_id === providerId
        );
    } catch (error) {
        console.error(`[ERROR] getCfdisByProvider: ${error.message}`);
        logGenerator(logFileName, 'error', `getCfdisByProvider failed for provider ${providerId}: ${error.message}`);
        return [];
    }
}

/**
 * Fetches ALL PENDING_TO_PAY invoices from the portal without any Sage-side
 * filtering or date constraints. Returns every invoice the portal considers unpaid.
 * @param {number} index - Tenant index.
 * @returns {Promise<Array>} - Raw portal items array.
 */
async function getPendingToPayInvoices(index) {
    const logFileName = 'GetTypesCFDI';
    logGenerator(logFileName, 'info', `[START] Fetching ALL PENDING_TO_PAY invoices (no date filter, no Sage filter) for index=${index}`);

    try {
        const response = await axios.get(
            urlBase(index) +
            `?documentTypes=CFDI` +
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
            console.log('[INFO] No PENDING_TO_PAY invoices found in portal');
            return [];
        }

        console.log(`[INFO] Portal returned ${response.data.items.length} PENDING_TO_PAY invoices`);
        return response.data.items || [];
    } catch (error) {
        console.error(`[ERROR] getPendingToPayInvoices: ${error.message}`);
        logGenerator(logFileName, 'error', `getPendingToPayInvoices failed: ${error.message}`);
        return [];
    }
}

module.exports = {
    getTypeP,
    getTypeI,
    getTypeIToSend,
    getTypeE,
    getCfdisByProvider,
    getPendingToPayInvoices
}