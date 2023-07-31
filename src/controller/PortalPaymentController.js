const { runQuery } = require('../utils/SQLServerConnection');
const { sendMail } = require('../utils/EmailSender');
const axios = require('axios');
const notifier = require('node-notifier');
const dotenv = require('dotenv');
const credentials = dotenv.config({ path: '.env.credentials.focaltec' });

const database = [];
const tenantIds = []
const apiKeys = []
const apiSecrets = []
const cfdis = [];

const url = credentials.parsed.URL;
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

        const currentDate = new Date().toISOString().slice(0, 10).replace(/-/g, '')

        // Get the daily payments from Sage

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
        AND B.PAYMTYPE='PY' AND B.BATCHSTAT = 3 AND P.DATEBUS>=${currentDate}
        AND P.DOCNBR NOT IN (SELECT NoPagoSage FROM fesa.dbo.fesaPagosFocaltec WHERE idCia = P.AUDTORG AND  NoPagoSage = P.DOCNBR )`;

        const payments = await runQuery(queryEncabezadosPago, database[index]);

        const queryPagosRegistrados = `SELECT NoPagoSage FROM fesa.dbo.fesaPagosFocaltec`;
        const pagosRegistrados = await runQuery(queryPagosRegistrados);

        // If an external_id corresponds to some NoPagoSage, verify in which position of the array it is and delete it
        if (pagosRegistrados.recordset.length > 0) {
            for (let i = 0; i < pagosRegistrados.recordset.length; i++) {
                for (let j = 0; j < payments.recordset.length; j++) {
                    if (pagosRegistrados.recordset[i].NoPagoSage === payments.recordset[j].external_id) {
                        payments.recordset.splice(j, 1);
                    }
                }
            }
        }

        if (payments.recordset.length > 0) {
            for (let i = 0; i < payments.recordset.length; i++) {
                // Consult the invoices paid with the LotePago and AsientoPago of the previous query
                const queryFacturasPagadas = `SELECT DP.CNTBTCH as LotePago,DP.CNTRMIT as AsientoPago,  DP.IDVEND, DP.IDINVC, H.AMTGROSDST AS invoice_amount, DP.DOCTYPE
            , CASE H.CODECURN WHEN 'MXP' THEN 'MXN' ELSE H.CODECURN END AS invoice_currency
            , H.EXCHRATEHC  AS invoice_exchange_rate
            , DP.AMTPAYM  AS payment_amount
            , ISNULL((SELECT [VALUE] FROM APIBHO  WHERE CNTBTCH = H.CNTBTCH  AND CNTITEM = H.CNTITEM AND OPTFIELD = 'FOLIOCFD'),'') AS UUID
            FROM APTCP DP , APIBH H
            WHERE DP.BATCHTYPE ='PY' AND DP.CNTBTCH= ${payments.recordset[i].LotePago} AND DP.CNTRMIT = ${payments.recordset[i].AsientoPago} AND DP.DOCTYPE = 1
            AND H.ORIGCOMP='' AND DP.IDVEND = H.IDVEND  AND DP.IDINVC = H.IDINVC  AND H.ERRENTRY = 0`;

                const invoices = await runQuery(queryFacturasPagadas, database[index]);
                if (invoices.recordset.length > 0) {
                    for (let j = 0; j < tenantIds.length; j++) {
                        const cfdi = {
                            "amount": invoices.recordset[j].invoice_amount,
                            "currency": invoices.recordset[j].invoice_currency,
                            "exchange_rate": invoices.recordset[j].invoice_exchange_rate,
                            "payment_amount": invoices.recordset[j].payment_amount,
                            "payment_currency": payments.recordset[i].bk_currency,
                            "uuid": invoices.recordset[j].UUID,
                        }
                        cfdis.push(cfdi);
                    }

                    const payment = {
                        "bank_account_id": payments.recordset[i].bank_account_id,
                        "cfdis": cfdis,
                        "comments": payments.recordset[i].comments,
                        "currency": payments.recordset[i].bk_currency,
                        "external_id": payments.recordset[i].external_id,
                        "ignore_amounts": true,
                        "mark_existing_cfdi_as_paid": true,
                        "open": false,
                        "operation_type": payments.recordset[i].operation_type,
                        "payment_date": payments.recordset[i].payment_date,
                        "provider_external_id": payments.recordset[i].provider_external_id,
                        "reference": payments.recordset[i].reference,
                        "total_amount": payments.recordset[i].total_amount,
                    }

                    const response = await axios.post(`${url}/api/1.0/extern/tenants/${tenantIds[index]}/payments`, payment, {
                        headers: {
                            'PDPTenantKey': apiKeys[index],
                            'PDPTenantSecret': apiSecrets[index]
                        }
                    }).catch(error => {
                        console.log(error.response.data);
                    });

                    if (response.status === 200) {
                        // Insert the idCia and NoPagoSage in the fesaPagosFocaltec table
                        const queryInsert = `INSERT INTO fesa.dbo.fesaPagosFocaltec (idCia, NoPagoSage) VALUES (${database[index]}, '${payments.recordset[i].external_id}')`;
                        const result = await runQuery(queryInsert);

                        if (result.rowsAffected[0] > 0) {
                            console.log('Se inserto correctamente el pago en la tabla fesaPagosFocaltec');
                        }
                    }

                } else {
                    console.log('No hay facturas pagadas para subir a portal');
                }
            }
        } else {
            console.log('No hay pagos para subir a portal');
        }

    } catch (error) {
        //console.log(error);
        try {
            notifier.notify({
                title: 'Error al ejecutar el proceso de alta de pagos en portal',
                message: 'No se ejecuto el proceso: ' + error,
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (err) {
            console.log(err);
        }
    }

}

/* uploadPayments(1).catch((err) => {
    console.log(err)
}) */

module.exports = {
    uploadPayments,
}