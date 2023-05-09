const { getTypeP } = require('./GetTypesCFDI')
const { runQuery } = require('../utils/SQLServerConnection')

async function miFuncion() {
  const result = await getTypeP();
  const rsQuery = await runQuery(`SELECT Valor as DataBaseName, idCia FROM FESAPARAM WHERE idCia IN ( SELECT idCia FROM fesaParam WHERE Parametro = 'RFCReceptor' AND Valor = '${result[0].cfdi.receptor.rfc}')
    AND Parametro = 'DataBase'`)
  // const externalId = result[0].metadata.external_id
  const externalId = 'PY00000000000000000001'
  const rsQuery1 = runQuery(`SELECT H.CNTBTCH, H.CNTENTR, ISNULL(O.[VALUE], 'NOEXISTECO') AS UUIDPAGO, ISNULL(F.[VALUE], 'NOEXISTECO') AS FECHATIM
    FROM APTCR H
    LEFT JOIN APTCRO O ON O.CNTBTCH = H.CNTBTCH AND O.CNTENTR = H.CNTENTR AND O.OPTFIELD = 'FOLIOCFD'
    LEFT JOIN APTCRO F ON F.CNTBTCH = H.CNTBTCH AND F.CNTENTR = H.CNTENTR AND F.OPTFIELD = 'FECHACFD'
    WHERE H.BTCHTYPE = 'PY' AND H.ERRENTRY = 0 AND H.DOCNBR = '${externalId}'`, rsQuery[0].DataBaseName)
  return rsQuery1;
}

miFuncion().then(rs => {
  console.log(rs)
}).catch(err => {
  console.log(err)
})

/* 
Si el resultado es UUIDPAGO="NOEXISTECO" 
INSERT INTO APTCRO 
     (BTCHTYPE,CNTBTCH,CNTENTR,OPTFIELD,AUDTDATE,AUDTTIME,AUDTUSER,AUDTORG,VALUE,[TYPE],[LENGTH],DECIMALS,ALLOWNULL,VALIDATE,SWSET) 
     VALUES 
     ('PY', ${numLote de la bd} ,  ${numAsiento de la bd}  ,'${parametro de fesaParam nombre campo opcional uuid}' 
     ,  ${fechaActual} ,23165973,'${parametro de fesaParam}','${idCia}' 
     ,'${UUID}' 
     ,1,60,0,0,0,1) 			 

     si el resultado UUIDPAGO = ""
UPDATE APTCRO  SET [VALUE] = ${UUID} 
 WHERE BTCHTYPE= 'PY' AND CNTBTCH =   ${numLote de la bd}   AND CNTENTR =   ${numAsiento de la bd}  AND OPTFIELD = '${parametro de fesaParam nombre campo opcional uuid}' 

 si el resultado len(UUIDPAGO) = 36  no hacer nada
 
  si el resultado es FECHATIM ="NOEXISTECO"
 INSERT INTO APTCRO
 (BTCHTYPE,CNTBTCH,CNTENTR,OPTFIELD,AUDTDATE,AUDTTIME,AUDTUSER,AUDTORG,VALUE,[TYPE],[LENGTH],DECIMALS,ALLOWNULL,VALIDATE,SWSET)
 VALUES
 ('PY',${numLote bd},${numAsiento bd},'${PARAMETRO DE FESAPARAM NOMBRE CAMPO OPCIONAL de fecha de timbrado}'
 ,${fechaActual},23165973,'${Parametro de Fesaparam}','${idCia}'
 ,'20230605 12:06:05'
 ,1,60,0,0,0,1)


  si el resultado FECHATIM = ""
UPDATE APTCRO  SET [VALUE] = '${fechaDeTimbrado del api}'
 WHERE BTCHTYPE= 'PY' AND CNTBTCH = ${numLote de la constula a la bd} AND CNTENTR = ${numeroAsiento de la consulta a la bd} AND OPTFIELD = '${parametro de fesaParam de fecha de timbrado campo opcional}'

   si el resultado len(FECHATIM) > 0 no se hace nada
 
 
 
 
 */