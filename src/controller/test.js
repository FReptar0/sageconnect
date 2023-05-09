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
     ('PY',  1 ,  1  ,'FOLIOCFD' 
     ,  20230506 ,23165973,'ADMIN','CMXDAT' 
     ,'6A5C7967-F587-42CD-B06A-AAD2ABE40735' 
     ,1,60,0,0,0,1) 			 

     si el resultado UUIDPAGO = ""
UPDATE APTCRO  SET [VALUE] = '6A5C7967-F587-42CD-B06A-AAD2ABE40735' 
 WHERE BTCHTYPE= 'PY' AND CNTBTCH =   1   AND CNTENTR =   1  AND OPTFIELD = 'FOLIOCFD' 

 si el resultado len(UUIDPAGO) = 36  no hacer nada
 
  si el resultado es FECHATIM ="NOEXISTECO"
 INSERT INTO APTCRO
 (BTCHTYPE,CNTBTCH,CNTENTR,OPTFIELD,AUDTDATE,AUDTTIME,AUDTUSER,AUDTORG,VALUE,[TYPE],[LENGTH],DECIMALS,ALLOWNULL,VALIDATE,SWSET)
 VALUES
 ('PY',1,1,'FECHACFD'
 ,20230606,23165973,'ADMIN','CMXDAT'
 ,'20230605 12:06:05'
 ,1,60,0,0,0,1)


  si el resultado FECHATIM = ""
UPDATE APTCRO  SET [VALUE] = '20230605 12:06:05'
 WHERE BTCHTYPE= 'PY' AND CNTBTCH = 1 AND CNTENTR = 1 AND OPTFIELD = 'FECHACFD'

   si el resultado len(FECHATIM) > 0 no se hace nada
 
 
 
 
 */