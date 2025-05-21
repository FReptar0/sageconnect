// controllers/OC_OrderCreation.js

const axios = require('axios');
const dotenv = require('dotenv');
const credentials = dotenv.config({ path: '.env.credentials.focaltec' });
const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { validateExternPurchaseOrder } = require('../models/PurchaseOrders');
const { groupOrdersByNumber } = require('../utils/OC_GroupOrdersByNumber');

const url = credentials.parsed.URL;

// Arrays de tenants, keys, secrets y bases de datos
const tenantIds = credentials.parsed.TENANT_ID.split(',');
const apiKeys = credentials.parsed.API_KEY.split(',');
const apiSecrets = credentials.parsed.API_SECRET.split(',');
const databases = credentials.parsed.DATABASES.split(',');

/**
 * Trae un conjunto específico de órdenes de compra de Sage300,
 * las agrupa por número, las valida y las envía al API.
 *
 * @param {number} index — Índice de la empresa (tenant) a usar
 * @returns {Promise<Array>} — Resultado de cada envío { external_id, status? | error? }
 */
async function createPurchaseOrders(index) {
    const tenantId = tenantIds[index];
    const apiKey = apiKeys[index];
    const apiSecret = apiSecrets[index];
    const database = databases[index];

    // 1) Consulta con WHERE: únicamente los dos POs indicados
    const sql = `
    select 
      'ACCEPTED' as ACCEPTANCE_STATUS,
      ISNULL(F.CITY,'') as [ADDRESSES_CITY],
      ISNULL(F.COUNTRY,'') as [ADDRESSES_COUNTRY],
      '' as [ADDRESSES_EXTERIOR_NUMBER],
      ISNULL(F.[LOCATION],'') as [ADDRESSES_IDENTIFIER],
      '' as [ADDRESSES_INTERIOR_NUMBER],
      ISNULL(F.ADDRESS2,'') as [ADDRESSES_MUNICIPALITY],
      ISNULL(F.[STATE],'') as [ADDRESSES_STATE],
      ISNULL(F.ADDRESS1,'') as [ADDRESSES_STREET],
      '' as [ADDRESSES_SUBURB],
      'SHIPPING' as [ADDRESSES_TYPE],
      ISNULL(F.ZIP,'') as [ADDRESSES_ZIP],
      'F' + LEFT(
        (SELECT RTRIM(VDESC) 
           FROM CSOPTFD 
          WHERE OPTFIELD='METODOPAGO' 
            AND VALUE=E2.[VALUE]
        ), 2
      ) as [CFDI_PAYMENT_FORM],
      '' as [CFDI_PAYMENT_METHOD],
      C2.[VALUE] as [CFDI_USE],
      A.DESCRIPTIO + ' ' + A.COMMENT as [COMMENTS],
      '0123456789' as [COMPANY_EXTERNAL_ID],
      CASE WHEN A.CURRENCY='MXP' THEN 'MXN' ELSE A.CURRENCY END as [CURRENCY],
      CAST(
        SUBSTRING(CAST(A.[DATE] AS VARCHAR),1,4) + '-' +
        SUBSTRING(CAST(A.[DATE] AS VARCHAR),5,2) + '-' +
        SUBSTRING(CAST(A.[DATE] AS VARCHAR),7,2)
      AS DATE) as [DATE],
      A.FOBPOINT as [DELIVERY_CONTACT],
      CASE WHEN A.EXPARRIVAL=0 THEN
        CAST(
          SUBSTRING(CAST(A.[DATE] AS VARCHAR),1,4) + '-' +
          SUBSTRING(CAST(A.[DATE] AS VARCHAR),5,2) + '-' +
          SUBSTRING(CAST(A.[DATE] AS VARCHAR),7,2)
        AS DATE)
      ELSE
        CAST(
          SUBSTRING(CAST(A.EXPARRIVAL AS VARCHAR),1,4) + '-' +
          SUBSTRING(CAST(A.EXPARRIVAL AS VARCHAR),5,2) + '-' +
          SUBSTRING(CAST(A.EXPARRIVAL AS VARCHAR),7,2)
        AS DATE)
      END as [DELIVERY_DATE],
      A.RATE as [EXCHANGE_RATE],
      A.PONUMBER as [EXTERNAL_ID],
      '' as [LINES_BUDGET_ID],
      '' as [LINES_BUDGET_LINE_EXTERNAL_ID],
      B.ITEMNO as [LINES_CODE],
      '' as [LINES_COMMENTS],
      B.ITEMDESC as [LINES_DESCRIPTION],
      B.PORLSEQ as [LINES_EXTERNAL_ID],
      '' as [LINES_METADATA],
      B.DETAILNUM as [LINES_NUM],
      B.UNITCOST as [LINES_PRICE],
      B.SQORDERED as [LINES_QUANTITY],
      '' as [LINES_REQUISITION_LINE_ID],
      B.EXTENDED as [LINES_SUBTOTAL],
      B.EXTENDED + B.TAXAMOUNT as [LINES_TOTAL],
      B.ORDERUNIT as [LINES_UNIT_OF_MEASURE],
      0 as [LINES_VAT_TAXES_AMOUNT],
      '' as [LINES_VAT_TAXES_CODE],
      '' as [LINES_VAT_TAXES_EXTERNAL_CODE],
      0 as [LINES_VAT_TAXES_RATE],
      0 as [LINES_WITHHOLDING_TAXES_AMOUNT],
      '' as [LINES_WITHHOLDING_TAXES_CODE],
      '' as [LINES_WITHHOLDING_TAXES_EXTERNAL_CODE],
      0 as [LINES_WITHHOLDING_TAXES_RATE],
      'AFE' as [METADATA_KEY_01],
      C1.[VALUE] as [METADATA_VALUE_01],
      'REQUISICION' as [METADATA_KEY_02],
      A.RQNNUMBER as [METADATA_VALUE_02],
      'CONDICIONES' as [METADATA_KEY_03],
      A.TERMSCODE as [METADATA_VALUE_03],
      'USUARIO_DE_COMPRA' as [METADATA_KEY_04],
      A.FOBPOINT as [METADATA_VALUE_04],
      A.PONUMBER as [NUM],
      A.VDCODE as [PROVIDER_EXTERNAL_ID],
      A.REFERENCE as [REFERENCE],
      A1.ENTEREDBY as [REQUESTED_BY_CONTACT],
      0 as [REQUISITION_NUMBER],
      'OPEN' as [STATUS],
      A.EXTENDED as [SUBTOTAL],
      A.DOCTOTAL as [TOTAL],
      (
        (CASE WHEN A.TXEXCLUDE1<0 THEN 0 ELSE A.TXEXCLUDE1 END) +
        (CASE WHEN A.TXEXCLUDE2<0 THEN 0 ELSE A.TXEXCLUDE2 END) +
        (CASE WHEN A.TXEXCLUDE3<0 THEN 0 ELSE A.TXEXCLUDE3 END) +
        (CASE WHEN A.TXEXCLUDE4<0 THEN 0 ELSE A.TXEXCLUDE4 END) +
        (CASE WHEN A.TXEXCLUDE5<0 THEN 0 ELSE A.TXEXCLUDE5 END)
      ) as [VAT_SUM],
      B.[LOCATION] as [WAREHOUSE],
      (
        (CASE WHEN A.TXEXCLUDE1>0 THEN 0 ELSE A.TXEXCLUDE1 END) +
        (CASE WHEN A.TXEXCLUDE2>0 THEN 0 ELSE A.TXEXCLUDE2 END) +
        (CASE WHEN A.TXEXCLUDE3>0 THEN 0 ELSE A.TXEXCLUDE3 END) +
        (CASE WHEN A.TXEXCLUDE4>0 THEN 0 ELSE A.TXEXCLUDE4 END) +
        (CASE WHEN A.TXEXCLUDE5>0 THEN 0 ELSE A.TXEXCLUDE5 END)
      ) as [WITHHOLD_TAX_SUM]
    from COPDAT.dbo.POPORH1 A
    LEFT OUTER JOIN COPDAT.dbo.POPORH2 A1 ON A.PORHSEQ=A1.PORHSEQ
    LEFT OUTER JOIN COPDAT.dbo.POPORL  B ON A.PORHSEQ=B.PORHSEQ
    LEFT OUTER JOIN COPDAT.dbo.POPORHO C1 ON A.PORHSEQ=C1.PORHSEQ AND C1.OPTFIELD='AFE'
    LEFT OUTER JOIN COPDAT.dbo.POPORHO C2 ON A.PORHSEQ=C2.PORHSEQ AND C2.OPTFIELD='USOCFDI'
    LEFT OUTER JOIN COPDAT.dbo.APVEN   D ON A.VDCODE=D.VENDORID
    LEFT OUTER JOIN COPDAT.dbo.APVENO  E1 ON D.VENDORID=E1.VENDORID AND E1.OPTFIELD='FORMAPAGO'
    LEFT OUTER JOIN COPDAT.dbo.APVENO  E2 ON D.VENDORID=E2.VENDORID AND E2.OPTFIELD='METODOPAGO'
    LEFT OUTER JOIN COPDAT.dbo.APVENO  E3 ON D.VENDORID=E3.VENDORID AND E3.OPTFIELD='PROVIDERID'
    LEFT OUTER JOIN COPDAT.dbo.ICLOC   F ON B.[LOCATION]=F.[LOCATION]
    LEFT OUTER JOIN Autorizaciones_electronicas.dbo.Autoriza_OC X on A.PONUMBER=X.PONumber
    WHERE RTRIM(LTRIM(A.PONUMBER)) IN ('PO0047640','PO0077480');
  `;

    let rows;
    try {
        ({ recordset: rows } = await runQuery(sql, database));
    } catch (err) {
        logGenerator('OC_OrderCreation', 'error', `SQL fetch error: ${err.message}`);
        return [];
    }

    // 2) Agrupar usando nuestra utilidad
    const orders = groupOrdersByNumber(rows);

    // 3) Validar y enviar cada orden al API
    const results = [];
    for (const po of orders) {
        try {
            validateExternPurchaseOrder(po);
        } catch (err) {
            logGenerator('OC_OrderCreation', 'error', `Validation failed for PO ${po.external_id}: ${err.message}`);
            results.push({ external_id: po.external_id, error: `Validation: ${err.message}` });
            continue;
        }

        try {
            const resp = await axios.post(
                `${url}/purchase-orders`,
                po,
                {
                    headers: {
                        PDPTenantKey: apiKey,
                        PDPTenantSecret: apiSecret
                    }
                }
            );
            results.push({ external_id: po.external_id, status: resp.status });
        } catch (err) {
            logGenerator('OC_OrderCreation', 'error', `POST error for PO ${po.external_id}: ${err.message}`);
            results.push({ external_id: po.external_id, error: `POST: ${err.message}` });
        }
    }

    return results;
}

module.exports = {
    createPurchaseOrders
};
