const { getTypeP } = require('../utils/GetTypesCFDI')
const { runQuery } = require('../utils/SQLServerConnection');
const { sendMail } = require('../utils/EmailSender');
const notifier = require('node-notifier');

async function checkPayments() {
  try {
    // Traemos los CFDIS de Focaltec que sean de tipo P
    const result = await getTypeP();
    // Obtenemos la fecha actual
    let fechaActual = new Date().toISOString().slice(0, 10).replace(/-/g, '')

    // Recorremos el arreglo de CFDIS
    for (let index = 0; index < result.length; index++) {
      // Creamos un objeto para guardar los datos que se enviaran por correo
      // Se declara dentro del for para que se reinicie en cada iteracion
      const data = {
        h1: "",
        p: "",
        status: 0,
        message: ""
      }

      // Obtenemos el nombre de la base de datos y el idCia
      const rsQuery = await runQuery(`SELECT Valor as DataBaseName, idCia FROM FESAPARAM WHERE idCia IN ( SELECT idCia FROM fesaParam WHERE Parametro = 'RFCReceptor' AND Valor = '${result[index].cfdi.receptor.rfc}')
      AND Parametro = 'DataBase'`)
      // Quitamos los espacios en blanco del nombre de la base de datos y del idCia
      rsQuery[0].DataBaseName = rsQuery[0].DataBaseName.replace(/\s+/g, '')
      rsQuery[0].idCia = rsQuery[0].idCia.replace(/\s+/g, '')

      // Obtenemos los campos opcionales de la base de datos
      const camposOpcionales = await runQuery(`SELECT [BancoAP],[NumCtaAP],[CorreoAvisos],[FechaCFD],[FolioCFD],[FormaPago],[MetodoPago],[PasswordA],[UserAccpac]
      FROM (
        SELECT PARAMETRO, VALOR
        FROM FESA.dbo.fesaParam
        WHERE PARAMETRO IN ('BancoAP','NumCtaAP','CorreoAvisos','FechaCFD','FolioCFD','FormaPago','MetodoPago','PasswordA','UserAccpac')
          AND idCia = '${rsQuery[index].idCia}'
      ) AS t
      PIVOT (
        MIN(VALOR)
        FOR PARAMETRO IN ([BancoAP],[NumCtaAP],[CorreoAvisos],[FechaCFD],[FolioCFD],[FormaPago],[MetodoPago],[PasswordA],[UserAccpac]
      )
      ) AS p;`)

      // Obtenemos el externalId del CFDI de Focaltec para poder usarlo en la consulta de APTCR
      const externalId = result[index].metadata.external_id
      //const externalId = 'PY00000000000000000001'
      const rsQueryAPTCR = await runQuery(`SELECT H.CNTBTCH, H.CNTENTR, ISNULL(O.[VALUE], 'NOEXISTECO') AS UUIDPAGO, ISNULL(F.[VALUE], 'NOEXISTECO') AS FECHATIM
        FROM APTCR H
        LEFT JOIN APTCRO O ON O.CNTBTCH = H.CNTBTCH AND O.CNTENTR = H.CNTENTR AND O.OPTFIELD = '${camposOpcionales[0].FolioCFD}'
        LEFT JOIN APTCRO F ON F.CNTBTCH = H.CNTBTCH AND F.CNTENTR = H.CNTENTR AND F.OPTFIELD = '${camposOpcionales[0].FechaCFD}'
        WHERE H.BTCHTYPE = 'PY' AND H.ERRENTRY = 0 AND H.DOCNBR = '${externalId}'`, rsQuery[0].DataBaseName)

      if (rsQueryAPTCR[0].UUIDPAGO === 'NOEXISTECO') {
        // Si no existe el UUID en la tabla APTCRO, se inserta
        const rsInsertAPTCRO_UUID = await runQuery(`INSERT INTO APTCRO 
            (BTCHTYPE,CNTBTCH,CNTENTR,OPTFIELD,AUDTDATE,AUDTTIME,AUDTUSER,AUDTORG,VALUE,[TYPE],[LENGTH],DECIMALS,ALLOWNULL,VALIDATE,SWSET) 
            VALUES 
            ('PY', ${rsQueryAPTCR[0].CNTBTCH} ,  ${rsQueryAPTCR[0].CNTENTR}  ,'${camposOpcionales[0].FolioCFD}' 
            ,  ${fechaActual} ,23165973,'${camposOpcionales[0].UserAccpac}','${rsQuery[0].idCia}' 
            ,'${result[index].cfdi.timbre.uuid}' 
            ,1,60,0,0,0,1)`, rsQuery[0].DataBaseName)


        // verifacamos si se inserto el UUID en la tabla APTCRO
        if (rsInsertAPTCRO_UUID[0].affectedRows === 0) {
          // Si no se inserto el UUID en la tabla APTCRO, se modifica el objeto data y se envia el correo
          data.h1 = "No se inserto UUID en APTCRO"
          data.p = "No se inserto el UUID en la tabla APTCRO"
          data.status = 500
          data.message = "No se inserto el UUID: " + result[index].cfdi.timbre.uuid + " en la empresa: " + rsQuery[0].DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

          // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
          // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
          sendMail("No se inserto UUID en APTCRO", data, camposOpcionales[0].CorreoAvisos).then((res) => {
            // Si se envio el correo, se imprime en consola el mensaje
            console.log("No se inserto UUID en APTCRO: " + res)
          }).catch((err) => {
            // Si no se envio el correo, se manda una notificacion y si la notificacion falla se imprime en consola el error
            try {
              notifier.notify({
                title: 'Error al enviar correo',
                message: 'No se envio el correo a: ' + camposOpcionales[0].CorreoAvisos + ' con el error: ' + err
              });
            } catch (error) {
              console.log("No se pudo mandar la notificacion: " + error)
              console.log("No se envio el correo : " + err)
            }
          });
        } else {
          // Si se inserto el UUID en la tabla APTCRO, se modifica el objeto data y se envia el correo
          data.h1 = "Se inserto UUID en APTCRO"
          data.p = "Se inserto el UUID en la tabla APTCRO"
          data.status = 200
          data.message = "Se inserto el UUID: " + result[index].cfdi.timbre.uuid + " en la empresa: " + rsQuery[0].DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

          // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
          // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
          sendMail("Se inserto UUID en APTCRO", data, camposOpcionales[0].CorreoAvisos).then((res) => {
            console.log("Se inserto UUID en APTCRO y se envio el correo: " + res)
          }).catch((err) => {
            // Si no se envio el correo, se manda una notificacion y si la notificacion falla se imprime en consola el error
            try {
              notifier.notify({
                title: 'Error al enviar correo',
                message: 'No se envio el correo a: ' + camposOpcionales[0].CorreoAvisos + ' con el error: ' + err
              });
            } catch (error) {
              console.log("No se pudo mandar la notificacion: " + error)
              console.log("No se envio el correo : " + err)
            }
          })
        }

      } else if (rsQueryAPTCR[0].UUIDPAGO === '') {
        // Si el UUID esta vacio en la tabla APTCRO, se actualiza
        const rsUpdateAPTCRO_UUID = await runQuery(`UPDATE APTCRO  SET [VALUE] = ${result[index].cfdi.timbre.uuid} 
            WHERE BTCHTYPE= 'PY' AND CNTBTCH =   ${rsQueryAPTCR[0].CNTBTCH}   AND CNTENTR =   ${rsQueryAPTCR[0].CNTENTR} 
            AND OPTFIELD = '${camposOpcionales[0].FolioCFD}'`, rsQuery[0].DataBaseName)

        // verifacamos si se actualizo el UUID en la tabla APTCRO
        if (rsUpdateAPTCRO_UUID[0].affectedRows === 0) {
          // Si no se actualizo el UUID en la tabla APTCRO, se modifica el objeto data y se envia el correo
          data.h1 = "No se actualizo UUID en APTCRO"
          data.p = "No se actualizo el UUID en la tabla APTCRO"
          data.status = 500
          data.message = "No se actualizo el UUID: " + result[index].cfdi.timbre.uuid + " en la empresa: " + rsQuery[0].DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

          // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
          // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
          sendMail("No se actualizo UUID en APTCRO", data, camposOpcionales[0].CorreoAvisos).then((res) => {
            // Si se envio el correo, se imprime en consola el mensaje
            console.log("No se actualizo UUID en APTCRO: " + res)
          }).catch((err) => {
            // Si no se envio el correo, se manda una notificacion y si la notificacion falla se imprime en consola el error
            try {
              notifier.notify({
                title: 'Error al enviar correo',
                message: 'No se envio el correo a: ' + camposOpcionales[0].CorreoAvisos + ' con el error: ' + err
              });
            } catch (error) {
              console.log("No se pudo mandar la notificacion: " + error)
              console.log("No se envio el correo : " + err)
            }
          })
        } else {
          // Si se actualizo el UUID en la tabla APTCRO, se modifica el objeto data y se envia el correo
          data.h1 = "Se actualizo UUID en APTCRO"
          data.p = "Se actualizo el UUID en la tabla APTCRO"
          data.status = 200
          data.message = "Se actualizo el UUID: " + result[index].cfdi.timbre.uuid + " en la empresa: " + rsQuery[0].DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

          // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
          // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
          sendMail("Se actualizo UUID en APTCRO", data, camposOpcionales[0].CorreoAvisos).then((res) => {
            console.log("Se actualizo UUID en APTCRO y se envio el correo: " + res)
          }).catch((err) => {
            try {
              notifier.notify({
                title: 'Error al enviar correo',
                message: 'No se envio el correo a: ' + camposOpcionales[0].CorreoAvisos + ' con el error: ' + err
              });
            } catch (error) {
              console.log("No se pudo mandar la notificacion: " + error)
              console.log("No se envio el correo : " + err)
            }
          })
        }

      } else if (rsQueryAPTCR[0].FECHATIM === 'NOEXISTECO') {
        // Si el campo FECHATIM esta vacio en la tabla APTCRO, se inserta
        const rsInsertAPTCRO_FECHATIM = await runQuery(`INSERT INTO APTCRO
          (BTCHTYPE,CNTBTCH,CNTENTR,OPTFIELD,AUDTDATE,AUDTTIME,AUDTUSER,AUDTORG,VALUE,[TYPE],[LENGTH],DECIMALS,ALLOWNULL,VALIDATE,SWSET)
          VALUES
          ('PY',${rsQueryAPTCR[0].CNTBTCH},${rsQueryAPTCR[0].CNTENTR},'${camposOpcionales[0].FechaCFD}'
          ,${fechaActual},23165973,'${camposOpcionales[0].UserAccpac}','${rsQuery[0].idCia}'
          ,'20230605 12:06:05'
          ,1,60,0,0,0,1)`, rsQuery[0].DataBaseName)

        // verifacamos si se inserto el campo FECHATIM en la tabla APTCRO
        if (rsInsertAPTCRO_FECHATIM[0].affectedRows === 0) {
          // Si no se inserto el campo FECHATIM en la tabla APTCRO, se modifica el objeto data y se envia el correo
          data.h1 = "No se inserto FECHATIM en APTCRO"
          data.p = "No se inserto el campo FECHATIM en la tabla APTCRO"
          data.status = 500
          data.message = "No se inserto el campo FECHATIM: " + result[index].cfdi.timbre.fecha_timbrado + " en la empresa: " + rsQuery[0].DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

          // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
          // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
          sendMail("No se inserto FECHATIM en APTCRO", data, camposOpcionales[0].CorreoAvisos).then((res) => {
            // Si se envio el correo, se imprime en consola el mensaje
            console.log("No se inserto FECHATIM en APTCRO: " + res)
          }).catch((err) => {
            try {
              notifier.notify({
                title: 'Error al enviar correo',
                message: 'No se envio el correo a: ' + camposOpcionales[0].CorreoAvisos + ' con el error: ' + err
              });
            } catch (error) {
              console.log("No se pudo mandar la notificacion: " + error)
              console.log("No se envio el correo : " + err)
            }
          })
        } else {
          // Si se inserto el campo FECHATIM en la tabla APTCRO, se modifica el objeto data y se envia el correo
          data.h1 = "Se inserto FECHATIM en APTCRO"
          data.p = "Se inserto el campo FECHATIM en la tabla APTCRO"
          data.status = 200
          data.message = "Se inserto el campo FECHATIM: " + result[index].cfdi.timbre.fecha_timbrado + " en la empresa: " + rsQuery[0].DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

          // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
          // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
          sendMail("Se inserto FECHATIM en APTCRO", data, camposOpcionales[0].CorreoAvisos).then((res) => {
            console.log("Se inserto FECHATIM en APTCRO y se envio el correo: " + res)
          }).catch((err) => {
            try {
              notifier.notify({
                title: 'Error al enviar correo',
                message: 'No se envio el correo a: ' + camposOpcionales[0].CorreoAvisos + ' con el error: ' + err
              });
            } catch (error) {
              console.log("No se pudo mandar la notificacion: " + error)
              console.log("No se envio el correo : " + err)
            }
          })
        }

      } else if (rsQueryAPTCR[0].FECHATIM === '') {
        // Si el campo FECHATIM esta vacio en la tabla APTCRO, se actualiza 
        const rsUpdateAPTCRO_FECHATIM = await runQuery(`UPDATE APTCRO  SET [VALUE] = '${result[index].cfdi.timbre.fecha_timbrado} '
          WHERE BTCHTYPE = 'PY' AND CNTBTCH = ${rsQueryAPTCR[0].CNTBTCH} AND CNTENTR = ${rsQueryAPTCR[0].CNTENTR}
          AND OPTFIELD = '${camposOpcionales[0].FechaCFD}'`, rsQuery[0].DataBaseName)

        // verifacamos si se actualizo el campo FECHATIM en la tabla APTCRO
        if (rsUpdateAPTCRO_FECHATIM[0].affectedRows === 0) {
          // Si no se actualizo el campo FECHATIM en la tabla APTCRO, se modifica el objeto data y se envia el correo
          data.h1 = "No se actualizo FECHATIM en APTCRO"
          data.p = "No se actualizo el campo FECHATIM en la tabla APTCRO"
          data.status = 500
          data.message = "No se actualizo el campo FECHATIM: " + result[index].cfdi.timbre.fecha_timbrado + " en la empresa: " + rsQuery[0].DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

          // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
          // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
          sendMail("No se actualizo FECHATIM en APTCRO", data, camposOpcionales[0].CorreoAvisos).then((res) => {
            // Si se envio el correo, se imprime en consola el mensaje
            console.log("No se actualizo FECHATIM en APTCRO: " + res)
          }).catch((err) => {
            try {
              notifier.notify({
                title: 'Error al enviar correo',
                message: 'No se envio el correo a: ' + camposOpcionales[0].CorreoAvisos + ' con el error: ' + err
              });
            } catch (error) {
              console.log("No se pudo mandar la notificacion: " + error)
              console.log("No se envio el correo : " + err)
            }
          })
        } else {
          // Si se actualizo el campo FECHATIM en la tabla APTCRO, se modifica el objeto data y se envia el correo
          data.h1 = "Se actualizo FECHATIM en APTCRO"
          data.p = "Se actualizo el campo FECHATIM en la tabla APTCRO"
          data.status = 200
          data.message = "Se actualizo el campo FECHATIM: " + result[index].cfdi.timbre.fecha_timbrado + " en la empresa: " + rsQuery[0].DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

          // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
          // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
          sendMail("Se actualizo FECHATIM en APTCRO", data, camposOpcionales[0].CorreoAvisos).then((res) => {
            // Si se envio el correo, se imprime en consola el mensaje
            console.log("Se actualizo FECHATIM en APTCRO y se envio el correo: " + res)
          }).catch((err) => {
            // Si no se envio el correo, se imprime en consola el mensaje con el manejo de error
            try {
              notifier.notify({
                title: 'Error al enviar correo',
                message: 'No se envio el correo a: ' + camposOpcionales[0].CorreoAvisos + ' con el error: ' + err
              });
            } catch (error) {
              console.log("No se pudo mandar la notificacion: " + error)
              console.log("No se envio el correo : " + err)
            }
          })
        }
      } else if (rsQueryAPTCR[0].UUIDPAGO.length === 36) {
        console.log('Ya existe UUID')
      } else if (rsQueryAPTCR[0].FECHATIM.length === 19) {
        console.log('Ya existe fecha de timbrado')
      }
    }
  } catch (error) {
    try {
      notifier.notify({
        title: 'Error al ejecutar el query',
        message: 'No se ejecuto el query: ' + error
      });
    } catch (error) {
      console.log("No se pudo mandar la notificacion: " + error)
      console.log("No se ejecuto el query : " + error)
    }
  }

}

module.exports = {
  checkPayments
}