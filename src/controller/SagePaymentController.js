const { getTypeP } = require('../utils/GetTypesCFDI')
const { runQuery } = require('../utils/SQLServerConnection');
const { sendMail } = require('../utils/EmailSender');
const notifier = require('node-notifier');

async function checkPayments(index) {
  try {
    // Traemos los CFDIS de Focaltec que sean de tipo P
    const result = await getTypeP(index);
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
      /*       rsQuery.recordset.DataBaseName = rsQuery.recordset.DataBaseName.replace(/\s+/g, '')
            rsQuery.recordset.idCia = rsQuery.recordset.idCia.replace(/\s+/g, '') */
      if (rsQuery != '') {
        // Obtenemos los campos opcionales de la base de datos
        const camposOpcionales = await runQuery(`SELECT [BancoAP],[NumCtaAP],[CorreoAvisos],[FechaCFD],[FolioCFD],[FormaPago],[MetodoPago],[PasswordA],[UserAccpac]
      FROM (
        SELECT PARAMETRO, RTRIM(VALOR) AS VALOR
        FROM fesaParam
        WHERE PARAMETRO IN ('BancoAP','NumCtaAP','CorreoAvisos','FechaCFD','FolioCFD','FormaPago','MetodoPago','PasswordA','UserAccpac')
          AND idCia = '${rsQuery.recordset.idCia}'
      ) AS t
      PIVOT (
        MIN(VALOR)
        FOR PARAMETRO IN ([BancoAP],[NumCtaAP],[CorreoAvisos],[FechaCFD],[FolioCFD],[FormaPago],[MetodoPago],[PasswordA],[UserAccpac]
      )
      ) AS p;`)
        //console.log(camposOpcionales.recordset)
        //const externalId = result[index].metadata.provider_external_id 
        //FIXME: Remplazar externalId estatico por el que se obtenga del CFDI-API
        const externalId = 'PY00000000000000000003'
        const rsQueryAPTCR = await runQuery(`SELECT H.CNTBTCH, H.CNTENTR, RTRIM(ISNULL(O.[VALUE], 'NOEXISTECO')) AS UUIDPAGO, RTRIM(ISNULL(F.[VALUE], 'NOEXISTECO')) AS FECHATIM
        FROM APTCR H
        LEFT JOIN APTCRO O ON O.CNTBTCH = H.CNTBTCH AND O.CNTENTR = H.CNTENTR AND O.OPTFIELD = '${camposOpcionales.recordset.FolioCFD}'
        LEFT JOIN APTCRO F ON F.CNTBTCH = H.CNTBTCH AND F.CNTENTR = H.CNTENTR AND F.OPTFIELD = '${camposOpcionales.recordset.FechaCFD}'
        WHERE H.BTCHTYPE = 'PY' AND H.ERRENTRY = 0 AND H.DOCNBR = '${externalId}'`, rsQuery.recordset.DataBaseName)

        if (rsQueryAPTCR.recordset.UUIDPAGO === 'NOEXISTECO') {
          // Si no existe el UUID en la tabla APTCRO, se inserta
          const rsInsertAPTCRO_UUID = await runQuery(`INSERT INTO APTCRO 
            (BTCHTYPE,CNTBTCH,CNTENTR,OPTFIELD,AUDTDATE,AUDTTIME,AUDTUSER,AUDTORG,VALUE,[TYPE],[LENGTH],DECIMALS,ALLOWNULL,VALIDATE,SWSET) 
            VALUES 
            ('PY', ${rsQueryAPTCR.recordset.CNTBTCH} ,  ${rsQueryAPTCR.recordset.CNTENTR}  ,'${camposOpcionales.recordset.FolioCFD}' 
            ,  ${fechaActual} ,23165973,'${camposOpcionales.recordset.UserAccpac}','${rsQuery.recordset.idCia}' 
            ,'${result[index].cfdi.timbre.uuid}' 
            ,1,60,0,0,0,1)`, rsQuery.recordset.DataBaseName)
          console.log(rsInsertAPTCRO_UUID)

          // verifacamos si se inserto el UUID en la tabla APTCRO
          if (rsInsertAPTCRO_UUID.rowsAffected === 0) {
            // Si no se inserto el UUID en la tabla APTCRO, se modifica el objeto data y se envia el correo
            data.h1 = "No se inserto UUID en APTCRO"
            data.p = "No se inserto el UUID en la tabla APTCRO"
            data.status = 500
            data.message = "No se inserto el UUID: " + result[index].cfdi.timbre.uuid + " en la empresa: " + rsQuery.recordset.DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

            // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
            // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
            sendMail("No se inserto UUID en APTCRO", data, camposOpcionales.recordset.CorreoAvisos).then((res) => {
              // Si se envio el correo, se imprime en consola el mensaje
              console.log("No se inserto UUID en APTCRO: " + res)
            }).catch((err) => {
              // Si no se envio el correo, se manda una notificacion y si la notificacion falla se imprime en consola el error
              try {
                notifier.notify({
                  title: 'Error al enviar correo',
                  message: 'No se envio el correo a: ' + camposOpcionales.recordset.CorreoAvisos + ' con el error: ' + err,
                  sound: true,
                  wait: true,
                  icon: process.cwd() + '/public/img/cerrar.png'
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
            data.message = "Se inserto el UUID: " + result[index].cfdi.timbre.uuid + " en la empresa: " + rsQuery.recordset.DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

            // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
            // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
            sendMail("Se inserto UUID en APTCRO", data, camposOpcionales.recordset.CorreoAvisos).then((res) => {
              console.log("Se inserto UUID en APTCRO y se envio el correo: " + res)
            }).catch((err) => {
              // Si no se envio el correo, se manda una notificacion y si la notificacion falla se imprime en consola el error
              try {
                notifier.notify({
                  title: 'Error al enviar correo',
                  message: 'No se envio el correo a: ' + camposOpcionales.recordset.CorreoAvisos + ' con el error: ' + err,
                  sound: true,
                  wait: true,
                  icon: process.cwd() + '/public/img/cerrar.png'
                });
              } catch (error) {
                console.log("No se pudo mandar la notificacion: " + error)
                console.log("No se envio el correo : " + err)
              }
            })
          }

        }
        
        if (rsQueryAPTCR.recordset.UUIDPAGO === '') {
          // Si el UUID esta vacio en la tabla APTCRO, se actualiza
          console.log(`UPDATE APTCRO  SET [VALUE] = '${result[index].cfdi.timbre.uuid}' 
          WHERE BTCHTYPE= 'PY' AND CNTBTCH =   ${rsQueryAPTCR.recordset.CNTBTCH} AND CNTENTR = ${rsQueryAPTCR.recordset.CNTENTR} 
          AND OPTFIELD = '${camposOpcionales.recordset.FolioCFD}'`)

          const rsUpdateAPTCRO_UUID = await runQuery(`UPDATE APTCRO  SET [VALUE] = '${result[index].cfdi.timbre.uuid}' 
            WHERE BTCHTYPE= 'PY' AND CNTBTCH = ${rsQueryAPTCR.recordset.CNTBTCH} AND CNTENTR = ${rsQueryAPTCR.recordset.CNTENTR} 
            AND OPTFIELD = '${camposOpcionales.recordset.FolioCFD}'`, rsQuery.recordset.DataBaseName)
          console.log(rsUpdateAPTCRO_UUID)
          // verifacamos si se actualizo el UUID en la tabla APTCRO
          if (rsUpdateAPTCRO_UUID.rowsAffected === 0) {
            // Si no se actualizo el UUID en la tabla APTCRO, se modifica el objeto data y se envia el correo
            data.h1 = "No se actualizo UUID en APTCRO"
            data.p = "No se actualizo el UUID en la tabla APTCRO"
            data.status = 500
            data.message = "No se actualizo el UUID: " + result[index].cfdi.timbre.uuid + " en la empresa: " + rsQuery.recordset.DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

            // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
            // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
            sendMail("No se actualizo UUID en APTCRO", data, camposOpcionales.recordset.CorreoAvisos).then((res) => {
              // Si se envio el correo, se imprime en consola el mensaje
              console.log("No se actualizo UUID en APTCRO: " + res)
            }).catch((err) => {
              // Si no se envio el correo, se manda una notificacion y si la notificacion falla se imprime en consola el error
              try {
                notifier.notify({
                  title: 'Error al enviar correo',
                  message: 'No se envio el correo a: ' + camposOpcionales.recordset.CorreoAvisos + ' con el error: ' + err,
                  sound: true,
                  wait: true,
                  icon: process.cwd() + '/public/img/cerrar.png'
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
            data.message = "Se actualizo el UUID: " + result[index].cfdi.timbre.uuid + " en la empresa: " + rsQuery.recordset.DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

            // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
            // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
            sendMail("Se actualizo UUID en APTCRO", data, camposOpcionales.recordset.CorreoAvisos).then((res) => {
              console.log("Se actualizo UUID en APTCRO y se envio el correo: " + res)
            }).catch((err) => {
              try {
                notifier.notify({
                  title: 'Error al enviar correo',
                  message: 'No se envio el correo a: ' + camposOpcionales.recordset.CorreoAvisos + ' con el error: ' + err,
                  sound: true,
                  wait: true,
                  icon: process.cwd() + '/public/img/cerrar.png'
                });
              } catch (error) {
                console.log("No se pudo mandar la notificacion: " + error)
                console.log("No se envio el correo : " + err)
              }
            })
          }

        }
        
        if (rsQueryAPTCR.recordset.FECHATIM === 'NOEXISTECO') {
          // Si el campo FECHATIM esta vacio en la tabla APTCRO, se inserta
          const rsInsertAPTCRO_FECHATIM = await runQuery(`INSERT INTO APTCRO
          (BTCHTYPE,CNTBTCH,CNTENTR,OPTFIELD,AUDTDATE,AUDTTIME,AUDTUSER,AUDTORG,VALUE,[TYPE],[LENGTH],DECIMALS,ALLOWNULL,VALIDATE,SWSET)
          VALUES
          ('PY',${rsQueryAPTCR.recordset.CNTBTCH},${rsQueryAPTCR.recordset.CNTENTR},'${camposOpcionales.recordset.FechaCFD}'
          ,${fechaActual},23165973,'${camposOpcionales.recordset.UserAccpac}','${rsQuery.recordset.idCia}'
          ,'20230605 12:06:05'
          ,1,60,0,0,0,1)`, rsQuery.recordset.DataBaseName)

          // verifacamos si se inserto el campo FECHATIM en la tabla APTCRO
          if (rsInsertAPTCRO_FECHATIM.rowsAffected === 0) {
            // Si no se inserto el campo FECHATIM en la tabla APTCRO, se modifica el objeto data y se envia el correo
            data.h1 = "No se inserto FECHATIM en APTCRO"
            data.p = "No se inserto el campo FECHATIM en la tabla APTCRO"
            data.status = 500
            data.message = "No se inserto el campo FECHATIM: " + result[index].cfdi.timbre.fecha_timbrado + " en la empresa: " + rsQuery.recordset.DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

            // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
            // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
            sendMail("No se inserto FECHATIM en APTCRO", data, camposOpcionales.recordset.CorreoAvisos).then((res) => {
              // Si se envio el correo, se imprime en consola el mensaje
              console.log("No se inserto FECHATIM en APTCRO: " + res)
            }).catch((err) => {
              try {
                notifier.notify({
                  title: 'Error al enviar correo',
                  message: 'No se envio el correo a: ' + camposOpcionales.recordset.CorreoAvisos + ' con el error: ' + err,
                  sound: true,
                  wait: true,
                  icon: process.cwd() + '/public/img/cerrar.png'
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
            data.message = "Se inserto el campo FECHATIM: " + result[index].cfdi.timbre.fecha_timbrado + " en la empresa: " + rsQuery.recordset.DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

            // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
            // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
            sendMail("Se inserto FECHATIM en APTCRO", data, camposOpcionales.recordset.CorreoAvisos).then((res) => {
              console.log("Se inserto FECHATIM en APTCRO y se envio el correo: " + res)
            }).catch((err) => {
              try {
                notifier.notify({
                  title: 'Error al enviar correo',
                  message: 'No se envio el correo a: ' + camposOpcionales.recordset.CorreoAvisos + ' con el error: ' + err,
                  sound: true,
                  wait: true,
                  icon: process.cwd() + '/public/img/cerrar.png'
                });
              } catch (error) {
                console.log("No se pudo mandar la notificacion: " + error)
                console.log("No se envio el correo : " + err)
              }
            })
          }

        }
        
        if (rsQueryAPTCR.recordset.FECHATIM === '') {
          // Si el campo FECHATIM esta vacio en la tabla APTCRO, se actualiza 
          const rsUpdateAPTCRO_FECHATIM = await runQuery(`UPDATE APTCRO  SET [VALUE] = '${result[index].cfdi.timbre.fecha_timbrado}'
          WHERE BTCHTYPE = 'PY' AND CNTBTCH = ${rsQueryAPTCR.recordset.CNTBTCH} AND CNTENTR = ${rsQueryAPTCR.recordset.CNTENTR}
          AND OPTFIELD = '${camposOpcionales.recordset.FechaCFD}'`, rsQuery.recordset.DataBaseName)

          // verifacamos si se actualizo el campo FECHATIM en la tabla APTCRO
          if (rsUpdateAPTCRO_FECHATIM.rowsAffected === 0) {
            // Si no se actualizo el campo FECHATIM en la tabla APTCRO, se modifica el objeto data y se envia el correo
            data.h1 = "No se actualizo FECHATIM en APTCRO"
            data.p = "No se actualizo el campo FECHATIM en la tabla APTCRO"
            data.status = 500
            data.message = "No se actualizo el campo FECHATIM: " + result[index].cfdi.timbre.fecha_timbrado + " en la empresa: " + rsQuery.recordset.DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

            // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
            // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
            sendMail("No se actualizo FECHATIM en APTCRO", data, camposOpcionales.recordset.CorreoAvisos).then((res) => {
              // Si se envio el correo, se imprime en consola el mensaje
              console.log("No se actualizo FECHATIM en APTCRO: " + res)
            }).catch((err) => {
              try {
                notifier.notify({
                  title: 'Error al enviar correo',
                  message: 'No se envio el correo a: ' + camposOpcionales.recordset.CorreoAvisos + ' con el error: ' + err,
                  sound: true,
                  wait: true,
                  icon: process.cwd() + '/public/img/cerrar.png'
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
            data.message = "Se actualizo el campo FECHATIM: " + result[index].cfdi.timbre.fecha_timbrado + " en la empresa: " + rsQuery.recordset.DataBaseName + " con el external_id: " + externalId + " en la tabla APTCRO"

            // Enviamos el correo usamos la funcion sendMail que esta en el archivo EmailSender.js
            // usamos el .then para verificar si se envio el correo ya que la funcion sendMail devuelve una promesa
            sendMail("Se actualizo FECHATIM en APTCRO", data, camposOpcionales.recordset.CorreoAvisos).then((res) => {
              // Si se envio el correo, se imprime en consola el mensaje
              console.log("Se actualizo FECHATIM en APTCRO y se envio el correo: " + res)
            }).catch((err) => {
              // Si no se envio el correo, se imprime en consola el mensaje con el manejo de error
              try {
                notifier.notify({
                  title: 'Error al enviar correo',
                  message: 'No se envio el correo a: ' + camposOpcionales.recordset.CorreoAvisos + ' con el error: ' + err,
                  sound: true,
                  wait: true,
                  icon: process.cwd() + '/public/img/cerrar.png'
                });
              } catch (error) {
                console.log("No se pudo mandar la notificacion: " + error)
                console.log("No se envio el correo : " + err)
              }
            })
          }
        }
        
        if (rsQueryAPTCR.recordset.UUIDPAGO.length === 36) {
          console.log('Ya existe UUID')
        }
        
        if (rsQueryAPTCR.recordset.FECHATIM.length === 19) {
          console.log('Ya existe fecha de timbrado')
        }
      } else {
        //console.log('No se encontro el pago en SAGE')
      }
    }
  } catch (error) {
    console.log(error)
    try {
      notifier.notify({
        title: 'Error al ejecutar el proceso de pagos',
        message: 'No se ejecuto el query: ' + error,
        sound: true,
        wait: true,
        icon: process.cwd() + '/public/img/cerrar.png'
      });
    } catch (error) {
      console.log("No se pudo mandar la notificacion: " + error)
      console.log("No se ejecuto el proceso de pagos : " + error)
    }
  }
}

module.exports = {
  checkPayments
}