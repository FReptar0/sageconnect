const { runQuery } = require('../utils/SQLServerConnection');
const { sendMail } = require('../utils/EmailSender');
const axios = require('axios');
const notifier = require('node-notifier');
const dotenv = require('dotenv');
const credentials = dotenv.config({ path: '.env.credentials.focaltec' });

const database = [];
const url = credentials.parsed.URL;

const tenantIds = []
const apiKeys = []
const apiSecrets = []

const tenantIdValues = credentials.parsed.TENANT_ID.split(',');
const apiKeyValues = credentials.parsed.API_KEY.split(',');
const apiSecretValues = credentials.parsed.API_SECRET.split(',');

const databaseValues = credentials.parsed.DATABASES.split(',');

tenantIds.push(...tenantIdValues);
apiKeys.push(...apiKeyValues);
apiSecrets.push(...apiSecretValues);
database.push(...databaseValues);

async function uploadPayments(index) {
    try {
        //Obtener la fecha de hoy (dia, mes, año)
        const fechaActual = new Date().toISOString().slice(0, 10).replace(/-/g, '')


        // Obtener los pagos del dia en sage y subirlos a portal
        /* Consulta del encabezado de los Pagos */

        const queryEncabezadosPago = `SELECT P.CNTBTCH as LotePago, P.CNTENTR as AsientoPago, BK.ADDR1 AS bank_account_id, B.IDBANK, P.DATEBUS as FechaAsentamiento
        , P.DOCNBR as external_id,P.TEXTRMIT AS comments, P.TXTRMITREF AS reference
        , CASE BK.CURNSTMT WHEN 'MXP' THEN 'MXN' ELSE BK.CURNSTMT END AS bk_currency
        ,P.DATERMIT as payment_date, P.IDVEND as provider_external_id
        , P.AMTRMIT as total_amount
        , 'TRANSFER' as operation_type
        , P.RATEEXCHHC as TipoCambioPago
        , ISNULL((SELECT [VALUE] FROM APVENO WHERE OPTFIELD ='RFC' AND VENDORID = P.IDVEND ),'') AS RFC
        FROM APBTA B, BKACCT BK, APTCR P
        WHERE B.IDBANK = BK.BANK  AND B.PAYMTYPE = P.BTCHTYPE AND B.CNTBTCH = P.CNTBTCH 
        AND P.ERRENTRY = 0
        AND B.PAYMTYPE='PY' AND B.BATCHSTAT = 3 AND P.DATEBUS>=${fechaActual}
        AND P.DOCNBR NOT IN (SELECT NoPagoSage FROM fesa.dbo.fesaPagosFocaltec WHERE idCia = P.AUDTORG AND  NoPagoSage = P.DOCNBR )`;

        const payments = await runQuery(queryEncabezadosPago, database[index]);
        console.log(payments)
        if (payments.length > 0) {
            /* Consulta de las Facturas Pagadas se debe de sustituir el LotePago y AsientoPago de la Consulta Anterior */
            const queryFacturasPagadas = `SELECT DP.CNTBTCH as LotePago,DP.CNTRMIT as AsientoPago,  DP.IDVEND, DP.IDINVC, H.AMTGROSDST AS invoice_amount, DP.DOCTYPE
            , CASE H.CODECURN WHEN 'MXP' THEN 'MXN' ELSE H.CODECURN END AS invoice_currency
            , H.EXCHRATEHC  AS invoice_exchange_rate
            , DP.AMTPAYM  AS payment_amount
            , ISNULL((SELECT [VALUE] FROM APIBHO  WHERE CNTBTCH = H.CNTBTCH  AND CNTITEM = H.CNTITEM AND OPTFIELD = 'FOLIOCFD'),'') AS UUID
            FROM APTCP DP , APIBH H
            WHERE DP.BATCHTYPE ='PY' AND DP.CNTBTCH= ${payments.recordset.LotePago} AND DP.CNTRMIT = ${payments.recordset.AsientoPago} AND DP.DOCTYPE = 1
            AND H.ORIGCOMP='' AND DP.IDVEND = H.IDVEND  AND DP.IDINVC = H.IDINVC  AND H.ERRENTRY = 0`;

            //const invoices = await runQuery(queryFacturasPagadas, database[index]);
            //console.log(invoices)
            if (invoices.length > 0) {
                /* Proceso de alta */

                // insertar en fesaPagosFocaltec el idCia el NoPagoSage que es el el que empieza con PY de la primera consulta (external_id) 

                const queryInsert = `INSERT INTO fesa.dbo.fesaPagosFocaltec (idCia, NoPagoSage) VALUES (${payments.recordset.AUDTORG}, '${payments.recordset.external_id}')`;
                //const result = await runQuery(queryInsert); // no se indica la base de datos porque sera FESA por default

                if (result.rowsAffected[0] > 0) {
                    console.log('Se inserto correctamente el pago en la tabla fesaPagosFocaltec');
                }
            } else {
                console.log('No hay facturas pagadas para subir a portal');
            }
        } else {
            console.log('No hay pagos para subir a portal');
        }

    } catch (error) {
        //console.log(error);
        try {
            notifier.notify({
                title: 'Error al ejecutar el proceso de alta de pagos en portal',
                message: 'No se ejecuto el proceso: ' + error ,
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (err) {
            console.log(err);
        }
    }

}

uploadPayments.catch((err)=>{
    console.log(err)
})

module.exports = {
    uploadPayments,
}