const { getTypeP } = require('../utils/GetTypesCFDI')
const { runQuery } = require('../utils/SQLServerConnection');
const { sendMail } = require('../utils/EmailSender');
const { logGenerator } = require('../utils/LogGenerator');
const { getCurrentDateCompact, getCurrentISOString } = require('../utils/TimezoneHelper');

async function sendGroupedEmails(emails, logFileName = 'Payment') {
    const maxRetries = 3;

    const sendEmailWithRetry = async (email, retries = 0) => {
        try {
            await sendMail(email);
            logGenerator(logFileName, 'info', `[OK] Correo enviado: ${email.h1}`);
        } catch (err) {
            if (retries < maxRetries) {
                logGenerator(logFileName, 'warn', `[WARN] Reintentando envío de correo: ${email.h1}. Intento ${retries + 1}`);
                await sendEmailWithRetry(email, retries + 1);
            } else {
                logGenerator(logFileName, 'error', `[ERROR] Falló el envío de correo tras ${maxRetries} intentos: ${email.h1}. Error: ${err.message}`);
            }
        }
    };

    await Promise.all(emails.map(email => sendEmailWithRetry(email)));
}

async function checkPayments(index) {
    let emails = [];
    let currentDate = getCurrentDateCompact();
    const logFileName = 'SagePaymentController';

    console.log(`[INFO] Iniciando checkPayments para index=${index}`);

    const resultPayments = await getTypeP(index);

    console.log(`[INFO] Pagos obtenidos: ${resultPayments.length}`);

    logGenerator(logFileName, 'info', `[INFO] Iniciando checkPayments para index=${index}. Total de pagos obtenidos: ${resultPayments.length}`);
    console.log(`[INFO] Iniciando checkPayments para index=${index}. Total de pagos obtenidos: ${resultPayments.length}`);

    if (resultPayments.length === 0) {
        logGenerator(logFileName, 'info', `[INFO] No se encontraron pagos para procesar en index=${index}`);
        console.log(`[INFO] No se encontraron pagos para procesar en index=${index}`);
        return;
    }

    for (let i = 0; i < resultPayments.length; i++) {
        console.log(`[PROCESS] Procesando pago ${i + 1}/${resultPayments.length} para index=${index}`);
        logGenerator(logFileName, 'info', `[PROCESS] Procesando pago ${i + 1}/${resultPayments.length} para index=${index}. Detalles del pago: ${JSON.stringify(resultPayments[i])}`);

        const idCiaQuery = `SELECT Valor as DataBaseName, idCia FROM FESAPARAM WHERE idCia IN ( SELECT idCia FROM fesaParam WHERE Parametro = 'RFCReceptor' AND Valor = '${resultPayments[i].cfdi.receptor.rfc}') AND Parametro = 'DataBase'`;
        const idCiaResult = await runQuery(idCiaQuery)
            .catch(
                (err) => {
                    const data = {
                        h1: "Error al obtener el idCia", p: err, status: 500, message: "Error al obtener el idCia", position: index
                    };
                    logGenerator(logFileName, 'error', `Error al obtener el idCia: ${err}`);
                    emails.push(data);
                    return { recordset: [] }
                });

        if (idCiaResult.recordset.length === 0) {
            logGenerator(logFileName, 'info', `[INFO] No se encontró el idCia para el RFC ${resultPayments[i].cfdi.receptor.rfc} en index=${index}`);
            console.log(`[INFO] No se encontró el idCia para el RFC ${resultPayments[i].cfdi.receptor.rfc} en index=${index}`);
            continue;
        }

        if (idCiaResult.recordset.length > 0) {
            const optionalFieldsQuery = `SELECT [BancoAP],[NumCtaAP],[FechaCFD],[FolioCFD],[FormaPago],[MetodoPago],[PasswordA],[UserAccpac] FROM (SELECT PARAMETRO, RTRIM(VALOR) AS VALOR FROM fesaParam WHERE PARAMETRO IN ('BancoAP','NumCtaAP','FechaCFD','FolioCFD','FormaPago','MetodoPago','PasswordA','UserAccpac') AND idCia = '${idCiaResult.recordset[0].idCia}') AS t PIVOT (MIN(VALOR) FOR PARAMETRO IN ([BancoAP],[NumCtaAP],[FechaCFD],[FolioCFD],[FormaPago],[MetodoPago],[PasswordA],[UserAccpac])) AS p;`;
            const optionalFieldsResult = await runQuery(optionalFieldsQuery)
                .catch(
                    (err) => {
                        const data = { h1: "Error al obtener los campos opcionales", p: err, status: 500, message: "Error al obtener los campos opcionales", idCia: idCiaResult.recordset[0].idCia, position: index };
                        logGenerator(logFileName, 'error', `Error al obtener los campos opcionales: ${err}`);
                        emails.push(data);
                        return { recordset: [] }
                    });

            if (optionalFieldsResult.recordset.length === 0) {
                logGenerator(logFileName, 'info', `[INFO] No se encontraron campos opcionales para el idCia ${idCiaResult.recordset[0].idCia} en index=${index}`);
                console.log(`[INFO] No se encontraron campos opcionales para el idCia ${idCiaResult.recordset[0].idCia} en index=${index}`);
                continue;
            }

            const timbradoDataQuery = `SELECT H.CNTBTCH, H.CNTENTR, RTRIM(ISNULL(O.[VALUE], 'NOEXISTECO')) AS UUIDPAGO, RTRIM(ISNULL(F.[VALUE], 'NOEXISTECO')) AS FECHATIM FROM APTCR H LEFT JOIN APTCRO O ON O.CNTBTCH = H.CNTBTCH AND O.CNTENTR = H.CNTENTR AND O.OPTFIELD = '${optionalFieldsResult.recordset[0].FolioCFD}' LEFT JOIN APTCRO F ON F.CNTBTCH = H.CNTBTCH AND F.CNTENTR = H.CNTENTR AND F.OPTFIELD = '${optionalFieldsResult.recordset[0].FechaCFD}' WHERE H.BTCHTYPE = 'PY' AND H.ERRENTRY = 0 AND H.DOCNBR = '${resultPayments[i].metadata.payment_info.payments[0].external_id}'`
            const timbradoDataResult = await runQuery(timbradoDataQuery, idCiaResult.recordset[0].DataBaseName)
                .catch(
                    (err) => {
                        const data = { h1: "Error al obtener los datos de timbrado", p: err, status: 500, message: "Error al obtener los datos de timbrado", idCia: idCiaResult.recordset[0].idCia, position: index };
                        logGenerator(logFileName, 'error', `Error al obtener los datos de timbrado: ${err}`);
                        emails.push(data);
                        return { recordset: [] }
                    });

            if (timbradoDataResult.recordset.length === 0) {
                logGenerator(logFileName, 'info', `[INFO] No se encontraron datos de timbrado para el pago ${resultPayments[i].metadata.payment_info.payments[0].external_id} en index=${index}`);
                console.log(`[INFO] No se encontraron datos de timbrado para el pago ${resultPayments[i].metadata.payment_info.payments[0].external_id} en index=${index}`);
                continue;
            }

            if (timbradoDataResult.recordset[0].UUIDPAGO.length === 36 && timbradoDataResult.recordset[0].FECHATIM.length === 19) {
                logGenerator(logFileName, 'info', `[INFO] El pago con UUID ${timbradoDataResult.recordset[0].UUIDPAGO} ya está registrado y tiene fecha de timbrado ${timbradoDataResult.recordset[0].FECHATIM}. Se omite el procesamiento.`);
                console.log(`[INFO] El pago con UUID ${timbradoDataResult.recordset[0].UUIDPAGO} ya está registrado y tiene fecha de timbrado ${timbradoDataResult.recordset[0].FECHATIM}. Se omite el procesamiento.`);
                continue;
            }

            if (timbradoDataResult.recordset[0].UUIDPAGO === 'NOEXISTECO') {
                const insertUUIDQuery = `INSERT INTO APTCRO 
                (BTCHTYPE,CNTBTCH,CNTENTR,OPTFIELD,AUDTDATE,AUDTTIME,AUDTUSER,AUDTORG,VALUE,[TYPE],[LENGTH],DECIMALS,ALLOWNULL,VALIDATE,SWSET) 
                VALUES 
                ('PY', ${timbradoDataResult.recordset[0].CNTBTCH}, ${timbradoDataResult.recordset[0].CNTENTR}  ,'${optionalFieldsResult.recordset[0].FolioCFD}' 
                ,  ${currentDate} ,23165973,'${optionalFieldsResult.recordset[0].UserAccpac}','${idCiaResult.recordset[0].idCia}' 
                ,'${resultPayments[i].cfdi.timbre.uuid}' 
                ,1,60,0,0,0,1)`;

                console.log('[INFO] UUID: ', resultPayments[i].cfdi.timbre.uuid);

                const insertUUIDResult = await runQuery(insertUUIDQuery, idCiaResult.recordset[0].DataBaseName)
                    .catch(
                        (err) => {
                            const data = { h1: "Error al insertar el UUID", p: err, status: 500, message: "Error al insertar el UUID", idCia: idCiaResult.recordset[0].idCia, position: index };
                            logGenerator(logFileName, 'error', `Error al insertar el UUID: ${err}`);
                            emails.push(data);
                            return { rowsAffected: [0] }
                        });

                if (insertUUIDResult.rowsAffected[0] > 0) {
                    const data = {
                        h1: "Se insertó el UUID",
                        p: `Se insertó el UUID ${resultPayments[i].cfdi.timbre.uuid} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}.`,
                        status: 200,
                        message: "Se insertó el UUID exitosamente",
                        position: index,
                        idCia: idCiaResult.recordset[0].idCia,
                        database: idCiaResult.recordset[0].DataBaseName,
                        timestamp: getCurrentISOString()
                    };
                    logGenerator(logFileName, 'info', `[OK] Se insertó el UUID ${resultPayments[i].cfdi.timbre.uuid} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}. Detalles: ${JSON.stringify(data)}`);
                    emails.push(data);
                } else {
                    const data = {
                        h1: "Error al insertar el UUID",
                        p: `No se insertó el UUID ${resultPayments[i].cfdi.timbre.uuid} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}.`,
                        status: 500,
                        message: "Error al insertar el UUID",
                        position: index,
                        idCia: idCiaResult.recordset[0].idCia
                    };
                    logGenerator(logFileName, 'error', `[ERROR] No se insertó el UUID ${resultPayments[i].cfdi.timbre.uuid} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}. Detalles: ${JSON.stringify(data)}`);
                    emails.push(data);
                }
            }

            if (timbradoDataResult.recordset[0].UUIDPAGO === '') {
                const updateUUIDQuery = `UPDATE APTCRO  SET [VALUE] = '${resultPayments[i].cfdi.timbre.uuid}' 
                WHERE BTCHTYPE= 'PY' AND CNTBTCH = ${timbradoDataResult.recordset[0].CNTBTCH} AND CNTENTR = ${timbradoDataResult.recordset[0].CNTENTR} 
                AND OPTFIELD = '${optionalFieldsResult.recordset[0].FolioCFD}'`

                const updateUUIDResult = await runQuery(updateUUIDQuery, idCiaResult.recordset[0].DataBaseName)
                    .catch(
                        (err) => {
                            const data = { h1: "Error al actualizar el UUID", p: err, status: 500, message: "Error al actualizar el UUID", idCia: idCiaResult.recordset[0].idCia, position: index };
                            logGenerator(logFileName, 'error', `Error al actualizar el UUID: ${err}`);
                            emails.push(data);
                            return { rowsAffected: [0] }
                        });

                if (updateUUIDResult.rowsAffected[0] > 0) {
                    const data = {
                        h1: "Se actualizó el UUID",
                        p: `Se actualizó el UUID ${resultPayments[i].cfdi.timbre.uuid} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}`,
                        status: 200,
                        message: "Se actualizó el UUID",
                        position: index,
                        idCia: idCiaResult.recordset[0].idCia,
                    }
                    logGenerator(logFileName, 'info', `[OK] Se actualizó el UUID ${resultPayments[i].cfdi.timbre.uuid} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}`);
                    emails.push(data);
                } else {
                    const data = {
                        h1: "Error al actualizar el UUID",
                        p: `No se actualizó el UUID ${resultPayments[i].cfdi.timbre.uuid} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}`,
                        status: 500,
                        message: "Error al actualizar el UUID",
                        position: index,
                        idCia: idCiaResult.recordset[0].idCia,
                    }
                    logGenerator(logFileName, 'error', `[ERROR] No se actualizó el UUID ${resultPayments[i].cfdi.timbre.uuid} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}`);
                    emails.push(data);
                }
            }

            const fechaTimbrado = resultPayments[i].cfdi.timbre.fecha_timbrado.split('T')[0].replace(/-/g, '');

            if (timbradoDataResult.recordset[0].FECHATIM === 'NOEXISTECO') {
                const insertFECHATIMQuery = `INSERT INTO APTCRO
                (BTCHTYPE,CNTBTCH,CNTENTR,OPTFIELD,AUDTDATE,AUDTTIME,AUDTUSER,AUDTORG,VALUE,[TYPE],[LENGTH],DECIMALS,ALLOWNULL,VALIDATE,SWSET)
                VALUES
                ('PY',${timbradoDataResult.recordset[0].CNTBTCH},${timbradoDataResult.recordset[0].CNTENTR},'${optionalFieldsResult.recordset[0].FechaCFD}'
                ,${currentDate},23165973,'${optionalFieldsResult.recordset[0].UserAccpac}','${idCiaResult.recordset[0].idCia}'
                ,'${fechaTimbrado}'
                ,1,60,0,0,0,1)`

                const insertFECHATIMResult = await runQuery(insertFECHATIMQuery, idCiaResult.recordset[0].DataBaseName)
                    .catch((err) => {
                        const data = { h1: "Error al insertar la fecha de timbrado", p: err, status: 500, message: "Error al insertar la fecha de timbrado", idCia: idCiaResult.recordset[0].idCia, position: index };
                        logGenerator(logFileName, 'error', `Error al insertar la fecha de timbrado: ${err}`);
                        emails.push(data);
                        return { rowsAffected: [0] }
                    });

                if (insertFECHATIMResult.rowsAffected[0] > 0) {
                    const data = {
                        h1: "Se insertó la fecha de timbrado",
                        p: `Se insertó la fecha de timbrado ${fechaTimbrado} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}`,
                        status: 200,
                        message: "Se insertó la fecha de timbrado",
                        position: index,
                        idCia: idCiaResult.recordset[0].idCia,
                    }
                    logGenerator(logFileName, 'info', `[OK] Se insertó la fecha de timbrado ${fechaTimbrado} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}`);
                    emails.push(data);
                } else {
                    const data = {
                        h1: "Error al insertar la fecha de timbrado",
                        p: `No se insertó la fecha de timbrado ${fechaTimbrado} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}`,
                        status: 500,
                        message: "Error al insertar la fecha de timbrado",
                        position: index,
                        idCia: idCiaResult.recordset[0].idCia,
                    }
                    logGenerator(logFileName, 'error', `[ERROR] No se insertó la fecha de timbrado ${fechaTimbrado} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}`);
                    emails.push(data);
                }
            }

            if (timbradoDataResult.recordset[0].FECHATIM === '') {
                const updateFECHATIMQuery = `UPDATE APTCRO  SET [VALUE] = '${resultPayments[i].cfdi.timbre.fecha_timbrado}'
                WHERE BTCHTYPE = 'PY' AND CNTBTCH = ${timbradoDataResult.recordset[0].CNTBTCH} AND CNTENTR = ${timbradoDataResult.recordset[0].CNTENTR}
                AND OPTFIELD = '${optionalFieldsResult.recordset[0].FechaCFD}'`

                const updateFECHATIMResult = await runQuery(updateFECHATIMQuery, idCiaResult.recordset[0].DataBaseName)
                    .catch((err) => {
                        const data = { h1: "Error al actualizar la fecha de timbrado", p: err, status: 500, message: "Error al actualizar la fecha de timbrado", idCia: idCiaResult.recordset[0].idCia, position: index };
                        logGenerator(logFileName, 'error', `Error al actualizar la fecha de timbrado: ${err}`);
                        emails.push(data);
                        return { rowsAffected: [0] }
                    });

                if (updateFECHATIMResult.rowsAffected[0] > 0) {
                    const data = {
                        h1: "Se actualizó la fecha de timbrado",
                        p: `Se actualizó la fecha de timbrado ${fechaTimbrado} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}`,
                        status: 200,
                        message: "Se actualizó la fecha de timbrado",
                        position: index,
                        idCia: idCiaResult.recordset[0].idCia,
                    }
                    logGenerator(logFileName, 'info', `[OK] Se actualizó la fecha de timbrado ${fechaTimbrado} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}`);
                    emails.push(data);
                } else {
                    const data = {
                        h1: "Error al actualizar la fecha de timbrado",
                        p: `No se actualizó la fecha de timbrado ${fechaTimbrado} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}`,
                        status: 500,
                        message: "Error al actualizar la fecha de timbrado",
                        position: index,
                        idCia: idCiaResult.recordset[0].idCia,
                    }
                    logGenerator(logFileName, 'error', `[ERROR] No se actualizó la fecha de timbrado ${fechaTimbrado} en la factura ${resultPayments[i].metadata.payment_info.payments[0].external_id}`);
                    emails.push(data);
                }
            }


        } else {
            const data = {
                h1: "Error al obtener el idCia",
                p: "No se encontró el idCia",
                status: 500,
                message: "Error al obtener el idCia",
                position: index,
            }
            logGenerator(logFileName, 'error', '[ERROR] Error al obtener el idCia: No se encontró el idCia');
            emails.push(data);
        }
    }

    if (emails.length > 0) {
        logGenerator(logFileName, 'info', `[INFO] Enviando ${emails.length} correos agrupados para index=${index}. Detalles de los correos: ${JSON.stringify(emails)}`);
        console.log(`[INFO] Enviando ${emails.length} correos agrupados para index=${index}`);
        await sendGroupedEmails(emails, logFileName);
        logGenerator(logFileName, 'info', `[INFO] Correos enviados exitosamente para index=${index}`);
        console.log(`[INFO] Correos enviados exitosamente para index=${index}`);
    } else {
        logGenerator(logFileName, 'info', `[INFO] No hay correos para enviar en index=${index}`);
        console.log(`[INFO] No hay correos para enviar en index=${index}`);
    }
}

module.exports = {
    checkPayments
}