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

        const queryEncabezadosPago = `SELECT P.CNTBTCH as LotePago, P.CNTENTR as AsientoPago, RTRIM(BK.ADDR1) AS bank_account_id, B.IDBANK, P.DATEBUS as FechaAsentamiento
        , P.DOCNBR as external_id,P.TEXTRMIT AS comments, P.TXTRMITREF AS reference
        , CASE BK.CURNSTMT WHEN 'MXP' THEN 'MXN' ELSE BK.CURNSTMT END AS bk_currency
        ,P.DATERMIT as payment_date, RTRIM(P.IDVEND) as provider_external_id
        , P.AMTRMIT as total_amount
        , 'TRANSFER' as operation_type
        , P.RATEEXCHHC as TipoCambioPago
        , ISNULL((SELECT [VALUE] FROM APVENO WHERE OPTFIELD ='RFC' AND VENDORID = P.IDVEND ),'') AS RFC
        FROM APBTA B, BKACCT BK, APTCR P
        WHERE B.IDBANK = BK.BANK  AND B.PAYMTYPE = P.BTCHTYPE AND B.CNTBTCH = P.CNTBTCH 
        AND P.ERRENTRY = 0 AND P.RMITTYPE = 1
        AND B.PAYMTYPE='PY' AND B.BATCHSTAT = 3 AND P.DATEBUS>=${currentDate}
        AND P.DOCNBR NOT IN (SELECT NoPagoSage FROM fesa.dbo.fesaPagosFocaltec WHERE idCia = P.AUDTORG AND  NoPagoSage = P.DOCNBR )
        AND P.DOCNBR NOT IN (SELECT IDINVC FROM APPYM WHERE IDBANK = B.IDBANK AND CNTBTCH = P.CNTBTCH AND CNTITEM =P.CNTENTR AND SWCHKCLRD = 2 )`;

        const payments = await runQuery(queryEncabezadosPago, database[index]).catch((err) => {
            console.log(err)
            return {
                recordset: []
            }
        })

        const queryPagosRegistrados = `SELECT NoPagoSage FROM fesa.dbo.fesaPagosFocaltec`;
        const pagosRegistrados = await runQuery(queryPagosRegistrados).catch((err) => {
            console.log(err);
            return {
                recordset: []
            }
        })

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
                const cfdis = [];

                // Consult the invoices paid with the LotePago and AsientoPago of the previous query
                const queryFacturasPagadas = `SELECT DP.CNTBTCH as LotePago,DP.CNTRMIT as AsientoPago,  RTRIM(DP.IDVEND) as IDVEND, RTRIM(DP.IDINVC) AS IDINVC, H.AMTGROSDST AS invoice_amount, DP.DOCTYPE
            , CASE H.CODECURN WHEN 'MXP' THEN 'MXN' ELSE H.CODECURN END AS invoice_currency
            , H.EXCHRATEHC  AS invoice_exchange_rate
            , DP.AMTPAYM  AS payment_amount
            , ISNULL((SELECT RTRIM([VALUE]) FROM APIBHO  WHERE CNTBTCH = H.CNTBTCH  AND CNTITEM = H.CNTITEM AND OPTFIELD = 'FOLIOCFD'),'') AS UUID
            FROM APTCP DP , APIBH H, APIBC C
            WHERE DP.BATCHTYPE ='PY' AND DP.CNTBTCH= ${payments.recordset[i].LotePago} AND DP.CNTRMIT = ${payments.recordset[i].AsientoPago} AND DP.DOCTYPE = 1
            AND H.ORIGCOMP='' AND DP.IDVEND = H.IDVEND  AND DP.IDINVC = H.IDINVC  AND H.ERRENTRY = 0 AND H.CNTBTCH = C.CNTBTCH AND C.BTCHSTTS = 3`;
                const invoices = await runQuery(queryFacturasPagadas, database[index]).catch((err) => {
                    console.log(err)
                    return {
                        recordset: []
                    }
                })

                if (invoices.recordset.length > 0) {
                    for (let j = 0; j < invoices.recordset.length; j++) {
                        const cfdi = {
                            "amount": invoices.recordset[j].payment_amount,
                            "currency": invoices.recordset[j].invoice_currency,
                            "exchange_rate": invoices.recordset[j].invoice_exchange_rate,
                            "payment_amount": invoices.recordset[j].payment_amount,
                            "payment_currency": payments.recordset[i].bk_currency,
                            "uuid": invoices.recordset[j].UUID,
                        }
                        cfdis.push(cfdi);
                    }
                    const date = payments.recordset[i].payment_date.toString();

                    const payment_date = date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6, 8) + 'T10:00:00.000Z'

                    const payment = {
                        "bank_account_id": payments.recordset[i].bank_account_id,
                        "cfdis": cfdis,
                        "comments": payments.recordset[i].comments,
                        "currency": payments.recordset[i].bk_currency,
                        "external_id": payments.recordset[i].external_id,
                        "ignore_amounts": false,
                        "mark_existing_cfdi_as_payed": true,
                        "open": false,
                        "operation_type": payments.recordset[i].operation_type,
                        "payment_date": payment_date,
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
                        return {
                            status: 500,
                            data: error
                        }
                    });

                    if (response.status === 200) {
                        const message = 'Se ejecuto correctamente el proceso de alta de pagos en portal, para la compañia ' + database[index] + ' con el NoPagoSage ' + payments.recordset[i].external_id;

                        const data = {
                            h1: 'Alta de pagos en portal',
                            p: 'Se ejecuto el proceso de alta de pagos en portal, para la compañia ' + database[index] + ' con el NoPagoSage ' + payments.recordset[i].external_id,
                            status: response.status,
                            message: message,
                            position: index,
                            idCia: database[index]
                        }

                        await sendMail(data).catch((err) => {
                            console.log(err)
                        })

                        // Insert the idCia and NoPagoSage in the fesaPagosFocaltec table
                        const queryInsert = `INSERT INTO fesa.dbo.fesaPagosFocaltec (idCia, NoPagoSage) VALUES ('${database[index]}', '${payments.recordset[i].external_id}')`;
                        const result = await runQuery(queryInsert).catch((err) => {
                            console.log(err)
                            return {
                                rowsAffected: [0]
                            }
                        })

                        if (result.rowsAffected[0] > 0) {
                            console.log('Se inserto correctamente el pago en la tabla fesaPagosFocaltec');
                        } else {
                            console.log('No se inserto el pago en la tabla fesaPagosFocaltec');
                        }
                    } else {
                        console.log('No se pudo insertar el pago en portal');

                        const data = {
                            h1: 'Alta de pagos en portal',
                            p: 'No se ejecuto el proceso de alta de pagos en portal, para la compañia ' + database[index] + ' con el NoPagoSage ' + payments.recordset[i].external_id,
                            status: response.status,
                            message: response.data,
                            position: index,
                            idCia: database[index]
                        }

                        await sendMail(data).catch((err) => {
                            console.log(err)
                        })

                        try {
                            notifier.notify({
                                title: 'Error al ejecutar el proceso de alta de pagos en portal',
                                message: 'No se ejecuto el proceso: ' + response.data,
                                sound: true,
                                wait: true,
                                icon: process.cwd() + '/public/img/cerrar.png'
                            });
                        } catch (error) {
                            console.log(error)
                            console.log("No se ejecuto el proceso: " + response.data)
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

module.exports = {
    uploadPayments,
}