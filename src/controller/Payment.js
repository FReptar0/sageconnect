const { getTypeP } = require('../utils/GetTypesCFDI')
const { runQuery } = require('../utils/SQLServerConnection');
const { sendMail } = require('../utils/EmailSender');
const notifier = require('node-notifier');

async function checkPayments(index) {
    const resultPayments = await getTypeP(index);

    if (resultPayments.length === 0)
        return;

    const emailData = { h1: "", p: "", status: 0, message: "", position: index, idCia: "" };
    const emails = [];

    let currentDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    for (let i = 0; i < resultPayments.length; i++) {
        const idCiaQuery = `SELECT Valor as DataBaseName, idCia FROM FESAPARAM WHERE idCia IN ( SELECT idCia FROM fesaParam WHERE Parametro = 'RFCReceptor' AND Valor = '${result[i].cfdi.receptor.rfc}') AND Parametro = 'DataBase'`;
        const idCiaResult = await runQuery(idCiaQuery).catch((err) => { emailData.h1 = "Error al obtener el idCia"; emailData.p = err; emailData.status = 500; emailData.message = "Error al obtener el idCia"; emails.push(emailData); });

        if (idCiaResult.recordset.length === 0)
            continue;

        if (idCiaResult.recordset.length > 0) {
            const optionalFieldsQuery = `SELECT [BancoAP],[NumCtaAP],[FechaCFD],[FolioCFD],[FormaPago],[MetodoPago],[PasswordA],[UserAccpac] FROM (SELECT PARAMETRO, RTRIM(VALOR) AS VALOR FROM fesaParam WHERE PARAMETRO IN ('BancoAP','NumCtaAP','FechaCFD','FolioCFD','FormaPago','MetodoPago','PasswordA','UserAccpac') AND idCia = '${idCiaResult.recordset[0].idCia}') AS t PIVOT (MIN(VALOR) FOR PARAMETRO IN ([BancoAP],[NumCtaAP],[FechaCFD],[FolioCFD],[FormaPago],[MetodoPago],[PasswordA],[UserAccpac])) AS p;`;
            const optionalFieldsResult = await runQuery(optionalFieldsQuery).catch((err) => { emailData.h1 = "Error al obtener los campos opcionales"; emailData.p = err; emailData.status = 500; emailData.message = "Error al obtener los campos opcionales"; emailData.idCia = idCiaResult.recordset[0].idCia; emails.push(emailData); });

            const timbradoDataQuery = `SELECT H.CNTBTCH, H.CNTENTR, RTRIM(ISNULL(O.[VALUE], 'NOEXISTECO')) AS UUIDPAGO, RTRIM(ISNULL(F.[VALUE], 'NOEXISTECO')) AS FECHATIM FROM APTCR H LEFT JOIN APTCRO O ON O.CNTBTCH = H.CNTBTCH AND O.CNTENTR = H.CNTENTR AND O.OPTFIELD = '${optionalFieldsResult.recordset[0].FolioCFD}' LEFT JOIN APTCRO F ON F.CNTBTCH = H.CNTBTCH AND F.CNTENTR = H.CNTENTR AND F.OPTFIELD = '${optionalFieldsResult.recordset[0].FechaCFD}' WHERE H.BTCHTYPE = 'PY' AND H.ERRENTRY = 0 AND H.DOCNBR = '${resultPayments[i].metadata.external_id}'`
            const timbradoDataResult = await runQuery(timbradoDataQuery, idCiaResult.recordset[0].DataBaseName).catch((err) => { emailData.h1 = "Error al obtener los datos de timbrado"; emailData.p = err; emailData.status = 500; emailData.message = "Error al obtener los datos de timbrado"; emailData.idCia = idCiaResult.recordset[0].idCia; emails.push(emailData); });

            if (timbradoDataResult.recordset[0].UUIDPAGO.length === 36 && timbradoDataResult.recordset[0].FECHATIM.length === 19)
                continue;

            if (timbradoDataResult.recordset[0].UUIDPAGO === 'NOEXISTECO') {
                const insertUUIDQuery = `INSERT INTO APTCRO 
                (BTCHTYPE,CNTBTCH,CNTENTR,OPTFIELD,AUDTDATE,AUDTTIME,AUDTUSER,AUDTORG,VALUE,[TYPE],[LENGTH],DECIMALS,ALLOWNULL,VALIDATE,SWSET) 
                VALUES 
                ('PY', ${timbradoDataResult.recordset[0].CNTBTCH}, ${timbradoDataResult.recordset[0].CNTENTR}  ,'${optionalFieldsResult.recordset[0].FolioCFD}' 
                ,  ${currentDate} ,23165973,'${optionalFieldsResult.recordset[0].UserAccpac}','${idCiaResult.recordset[0].idCia}' 
                ,'${resultPayments[i].cfdi.timbre.uuid}' 
                ,1,60,0,0,0,1)`;

                const insertUUIDResult = await runQuery(insertUUIDQuery, idCiaResult.recordset[0].DataBaseName).catch((err) => { emailData.h1 = "Error al insertar el UUID"; emailData.p = err; emailData.status = 500; emailData.message = "Error al insertar el UUID"; emailData.idCia = idCiaResult.recordset[0].idCia; emails.push(emailData); });

                if (insertUUIDResult.rowsAffected[0] > 0) {
                    emailData.h1 = "Se insertó el UUID";
                    emailData.p = `Se insertó el UUID ${resultPayments[i].cfdi.timbre.uuid} en la factura ${resultPayments[i].metadata.external_id}`;
                    emailData.status = 200;
                    emailData.message = "Se insertó el UUID";
                    emailData.idCia = idCiaResult.recordset[0].idCia;
                    emails.push(emailData);
                } else {
                    emailData.h1 = "Error al insertar el UUID";
                    emailData.p = `No se insertó el UUID ${resultPayments[i].cfdi.timbre.uuid} en la factura ${resultPayments[i].metadata.external_id}`;
                    emailData.status = 500;
                    emailData.message = "Error al insertar el UUID";
                    emailData.idCia = idCiaResult.recordset[0].idCia;
                    emails.push(emailData);
                }
            }

            if (timbradoDataResult.recordset[0].UUIDPAGO === '') {
                const updateUUIDQuery = `UPDATE APTCRO  SET [VALUE] = '${resultPayments[i].cfdi.timbre.uuid}' 
                WHERE BTCHTYPE= 'PY' AND CNTBTCH = ${timbradoDataResult.recordset[0].CNTBTCH} AND CNTENTR = ${timbradoDataResult.recordset[0].CNTENTR} 
                AND OPTFIELD = '${optionalFieldsResult.recordset[0].FolioCFD}'`

                const updateUUIDResult = await runQuery(updateUUIDQuery, idCiaResult.recordset[0].DataBaseName).catch((err) => { emailData.h1 = "Error al actualizar el UUID"; emailData.p = err; emailData.status = 500; emailData.message = "Error al actualizar el UUID"; emailData.idCia = idCiaResult.recordset[0].idCia; emails.push(emailData); });

                if (updateUUIDResult.rowsAffected[0] > 0) {
                    emailData.h1 = "Se actualizó el UUID";
                    emailData.p = `Se actualizó el UUID ${resultPayments[i].cfdi.timbre.uuid} en la factura ${resultPayments[i].metadata.external_id}`;
                    emailData.status = 200;
                    emailData.message = "Se actualizó el UUID";
                    emailData.idCia = idCiaResult.recordset[0].idCia;
                    emails.push(emailData);
                } else {
                    emailData.h1 = "Error al actualizar el UUID";
                    emailData.p = `No se actualizó el UUID ${resultPayments[i].cfdi.timbre.uuid} en la factura ${resultPayments[i].metadata.external_id}`;
                    emailData.status = 500;
                    emailData.message = "Error al actualizar el UUID";
                    emailData.idCia = idCiaResult.recordset[0].idCia;
                    emails.push(emailData);
                }
            }

            if (timbradoDataResult.recordset[0].FECHATIM === 'NOEXISTECO') {
                const insertFECHATIMQuery = `INSERT INTO APTCRO
                (BTCHTYPE,CNTBTCH,CNTENTR,OPTFIELD,AUDTDATE,AUDTTIME,AUDTUSER,AUDTORG,VALUE,[TYPE],[LENGTH],DECIMALS,ALLOWNULL,VALIDATE,SWSET)
                VALUES
                ('PY',${timbradoDataResult.recordset[0].CNTBTCH},${timbradoDataResult.recordset[0].CNTENTR},'${optionalFieldsResult.recordset[0].FechaCFD}'
                ,${currentDate},23165973,'${optionalFieldsResult.recordset[0].UserAccpac}','${idCiaResult.recordset[0].idCia}'
                ,'20230605 12:06:05'
                ,1,60,0,0,0,1)`

                const insertFECHATIMResult = await runQuery(insertFECHATIMQuery, idCiaResult.recordset[0].DataBaseName).catch((err) => { emailData.h1 = "Error al insertar la fecha de timbrado"; emailData.p = err; emailData.status = 500; emailData.message = "Error al insertar la fecha de timbrado"; emailData.idCia = idCiaResult.recordset[0].idCia; emails.push(emailData); });

                if (insertFECHATIMResult.rowsAffected[0] > 0) {
                    emailData.h1 = "Se insertó la fecha de timbrado";
                    emailData.p = `Se insertó la fecha de timbrado ${resultPayments[i].cfdi.timbre.fechaTimbrado} en la factura ${resultPayments[i].metadata.external_id}`;
                    emailData.status = 200;
                    emailData.message = "Se insertó la fecha de timbrado";
                    emailData.idCia = idCiaResult.recordset[0].idCia;
                    emails.push(emailData);
                } else {
                    emailData.h1 = "Error al insertar la fecha de timbrado";
                    emailData.p = `No se insertó la fecha de timbrado ${resultPayments[i].cfdi.timbre.fechaTimbrado} en la factura ${resultPayments[i].metadata.external_id}`;
                    emailData.status = 500;
                    emailData.message = "Error al insertar la fecha de timbrado";
                    emailData.idCia = idCiaResult.recordset[0].idCia;
                    emails.push(emailData);
                }
            }

            if (timbradoDataResult.recordset[0].FECHATIM === '') {
                const updateFECHATIMQuery = `UPDATE APTCRO  SET [VALUE] = '${resultPayments[i].cfdi.timbre.fecha_timbrado}'
                WHERE BTCHTYPE = 'PY' AND CNTBTCH = ${timbradoDataResult.recordset[0].CNTBTCH} AND CNTENTR = ${timbradoDataResult.recordset[0].CNTENTR}
                AND OPTFIELD = '${optionalFieldsResult.recordset[0].FechaCFD}'`

                const updateFECHATIMResult = await runQuery(updateFECHATIMQuery, idCiaResult.recordset[0].DataBaseName).catch((err) => { emailData.h1 = "Error al actualizar la fecha de timbrado"; emailData.p = err; emailData.status = 500; emailData.message = "Error al actualizar la fecha de timbrado"; emailData.idCia = idCiaResult.recordset[0].idCia; emails.push(emailData); });

                if (updateFECHATIMResult.rowsAffected[0] > 0) {
                    emailData.h1 = "Se actualizó la fecha de timbrado";
                    emailData.p = `Se actualizó la fecha de timbrado ${resultPayments[i].cfdi.timbre.fechaTimbrado} en la factura ${resultPayments[i].metadata.external_id}`;
                    emailData.status = 200;
                    emailData.message = "Se actualizó la fecha de timbrado";
                    emailData.idCia = idCiaResult.recordset[0].idCia;
                    emails.push(emailData);
                } else {
                    emailData.h1 = "Error al actualizar la fecha de timbrado";
                    emailData.p = `No se actualizó la fecha de timbrado ${resultPayments[i].cfdi.timbre.fechaTimbrado} en la factura ${resultPayments[i].metadata.external_id}`;
                    emailData.status = 500;
                    emailData.message = "Error al actualizar la fecha de timbrado";
                    emailData.idCia = idCiaResult.recordset[0].idCia;
                    emails.push(emailData);
                }
            }


        } else {
            emailData.h1 = "Error al obtener el idCia";
            emailData.p = "No se encontró el idCia";
            emailData.status = 500;
            emailData.message = "Error al obtener el idCia";
            emails.push(emailData);
        }
    }

    if (emails.length > 0) {
        for (let i = 0; i < emails.length; i++) {
            sendMail(emails[i].h1, emails[i].p, emails[i].status, emails[i].message, emails[i].position, emails[i].idCia).catch((err) => {
                notifier.notify({
                    title: 'Error al enviar correo',
                    message: 'No se envio el correo, error: ' + err,
                    sound: true,
                    wait: true,
                    icon: process.cwd() + '/public/img/cerrar.png'
                }).catch((err1) => {
                    console.log(err);
                    console.log(err1);
                });
            });

        }
    }
}

module.exports = {
    checkPayments
}