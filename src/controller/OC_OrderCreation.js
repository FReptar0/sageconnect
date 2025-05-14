// controllers/OC_OrderCreation.js

const axios = require('axios');
const dotenv = require('dotenv');
const credentials = dotenv.config({ path: '.env.credentials.focaltec' });
const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { validateExternPurchaseOrder } = require('../models/PurchaseOrders');

const url = credentials.parsed.URL;

// Arrays de tenants, keys, secrets y bases de datos
const tenantIds = credentials.parsed.TENANT_ID.split(',');
const apiKeys = credentials.parsed.API_KEY.split(',');
const apiSecrets = credentials.parsed.API_SECRET.split(',');
const databases = credentials.parsed.DATABASES.split(',');

/**
 * Trae todas las órdenes de compra de Sage300, las valida y las envía al API.
 *
 * @param {number} index — Índice de la empresa (tenant) a usar
 * @returns {Promise<Array>} — Resultado de cada envío { external_id, status? | error? }
 */
async function createPurchaseOrders(index) {
    const tenantId = tenantIds[index];
    const apiKey = apiKeys[index];
    const apiSecret = apiSecrets[index];
    const database = databases[index];

    // 1) Consulta SIN WHERE: trae todas las órdenes (una fila por cada línea)
    const sql = `
    SELECT 
      'ACCEPTED' AS ACCEPTANCE_STATUS,
      ISNULL(F.CITY,'')            AS ADDRESSES_CITY,
      ISNULL(F.COUNTRY,'')         AS ADDRESSES_COUNTRY,
      ''                            AS ADDRESSES_EXTERIOR_NUMBER,
      ISNULL(F.[LOCATION],'')       AS ADDRESSES_IDENTIFIER,
      ''                            AS ADDRESSES_INTERIOR_NUMBER,
      ISNULL(F.ADDRESS2,'')        AS ADDRESSES_MUNICIPALITY,
      ISNULL(F.[STATE],'')          AS ADDRESSES_STATE,
      ISNULL(F.ADDRESS1,'')        AS ADDRESSES_STREET,
      ''                            AS ADDRESSES_SUBURB,
      'SHIPPING'                   AS ADDRESSES_TYPE,
      ISNULL(F.ZIP,'')             AS ADDRESSES_ZIP,
      'F' + LEFT(
        (SELECT RTRIM(VDESC)
           FROM CSOPTFD
          WHERE OPTFIELD='METODOPAGO'
            AND VALUE=E2.[VALUE]
        ), 2
      )                            AS CFDI_PAYMENT_FORM,
      ''                            AS CFDI_PAYMENT_METHOD,
      C2.[VALUE]                    AS CFDI_USE,
      A.DESCRIPTIO + ' ' + A.COMMENT AS COMMENTS,
      '0123456789'                  AS COMPANY_EXTERNAL_ID,
      CASE WHEN A.CURRENCY='MXP' THEN 'MXN' ELSE A.CURRENCY END AS CURRENCY,
      CAST(
        SUBSTRING(CAST(A.[DATE] AS VARCHAR),1,4) + '-' +
        SUBSTRING(CAST(A.[DATE] AS VARCHAR),5,2) + '-' +
        SUBSTRING(CAST(A.[DATE] AS VARCHAR),7,2)
      AS DATE)                     AS [DATE],
      A.FOBPOINT                   AS DELIVERY_CONTACT,
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
      END                          AS DELIVERY_DATE,
      A.RATE                       AS EXCHANGE_RATE,
      A.PONUMBER                   AS EXTERNAL_ID,
      ''                           AS LINES_BUDGET_ID,
      ''                           AS LINES_BUDGET_LINE_EXTERNAL_ID,
      B.ITEMNO                     AS LINES_CODE,
      ''                           AS LINES_COMMENTS,
      B.ITEMDESC                   AS LINES_DESCRIPTION,
      B.PORLSEQ                    AS LINES_EXTERNAL_ID,
      ''                           AS LINES_METADATA,
      B.DETAILNUM                  AS LINES_NUM,
      B.UNITCOST                   AS LINES_PRICE,
      B.SQORDERED                  AS LINES_QUANTITY,
      ''                           AS LINES_REQUISITION_LINE_ID,
      B.EXTENDED                   AS LINES_SUBTOTAL,
      B.EXTENDED + B.TAXAMOUNT     AS LINES_TOTAL,
      B.ORDERUNIT                  AS LINES_UNIT_OF_MEASURE,
      0                            AS LINES_VAT_TAXES_AMOUNT,
      ''                           AS LINES_VAT_TAXES_CODE,
      ''                           AS LINES_VAT_TAXES_EXTERNAL_CODE,
      0                            AS LINES_VAT_TAXES_RATE,
      0                            AS LINES_WITHHOLDING_TAXES_AMOUNT,
      ''                           AS LINES_WITHHOLDING_TAXES_CODE,
      ''                           AS LINES_WITHHOLDING_TAXES_EXTERNAL_CODE,
      0                            AS LINES_WITHHOLDING_TAXES_RATE,
      'AFE'                        AS METADATA_KEY_01,
      C1.[VALUE]                   AS METADATA_VALUE_01,
      'REQUISICION'                AS METADATA_KEY_02,
      A.RQNNUMBER                  AS METADATA_VALUE_02,
      'CONDICIONES'                AS METADATA_KEY_03,
      A.TERMSCODE                  AS METADATA_VALUE_03,
      'USUARIO_DE_COMPRA'          AS METADATA_KEY_04,
      A.FOBPOINT                   AS METADATA_VALUE_04,
      A.PONUMBER                   AS NUM,
      A.VDCODE                     AS PROVIDER_EXTERNAL_ID,
      A.REFERENCE                  AS REFERENCE,
      A1.ENTEREDBY                 AS REQUESTED_BY_CONTACT,
      0                            AS REQUISITION_NUMBER,
      'OPEN'                       AS STATUS,
      A.EXTENDED                   AS SUBTOTAL,
      A.DOCTOTAL                   AS TOTAL,
      (
        ISNULL(NULLIF(A.TXEXCLUDE1, -1), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE2, -1), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE3, -1), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE4, -1), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE5, -1), 0)
      )                            AS VAT_SUM,
      B.[LOCATION]                 AS WAREHOUSE,
      (
        ISNULL(NULLIF(A.TXEXCLUDE1, 0), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE2, 0), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE3, 0), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE4, 0), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE5, 0), 0)
      )                            AS WITHHOLD_TAX_SUM
    FROM COPDAT.dbo.POPORH1 A
    LEFT JOIN COPDAT.dbo.POPORH2 A1  ON A.PORHSEQ = A1.PORHSEQ
    LEFT JOIN COPDAT.dbo.POPORL  B   ON A.PORHSEQ = B.PORHSEQ
    LEFT JOIN COPDAT.dbo.POPORHO C1  ON A.PORHSEQ = C1.PORHSEQ AND C1.OPTFIELD = 'AFE'
    LEFT JOIN COPDAT.dbo.POPORHO C2  ON A.PORHSEQ = C2.PORHSEQ AND C2.OPTFIELD = 'USOCFDI'
    LEFT JOIN COPDAT.dbo.APVEN    D  ON A.VDCODE  = D.VENDORID
    LEFT JOIN COPDAT.dbo.APVENO   E2 ON D.VENDORID = E2.VENDORID AND E2.OPTFIELD = 'METODOPAGO'
    LEFT JOIN COPDAT.dbo.ICLOC    F  ON B.[LOCATION] = F.[LOCATION];
  `;

    let rows;
    try {
        ({ recordset: rows } = await runQuery(sql, database));
    } catch (err) {
        logGenerator('OC_OrderCreation', 'error', `SQL fetch error: ${err.message}`);
        return [];
    }

    // 2) Agrupar por EXTERNAL_ID
    const ordersMap = {};
    rows.forEach(r => {
        const key = r.EXTERNAL_ID;
        if (!ordersMap[key]) {
            ordersMap[key] = {
                acceptance_status: r.ACCEPTANCE_STATUS,
                company_external_id: r.COMPANY_EXTERNAL_ID,
                exchange_rate: r.EXCHANGE_RATE,
                reference: r.REFERENCE,
                external_id: r.EXTERNAL_ID,
                num: r.NUM,
                status: r.STATUS,
                date: r.DATE.toISOString(),
                delivery_date: r.DELIVERY_DATE.toISOString(),
                delivery_contact: r.DELIVERY_CONTACT,
                requested_by_contact: r.REQUESTED_BY_CONTACT,
                cfdi_payment_form: r.CFDI_PAYMENT_FORM,
                cfdi_payment_method: r.CFDI_PAYMENT_METHOD,
                cfdi_use: r.CFDI_USE,
                comments: r.COMMENTS,
                currency: r.CURRENCY,
                addresses: [{
                    city: r.ADDRESSES_CITY,
                    country: r.ADDRESSES_COUNTRY,
                    exterior_number: r.ADDRESSES_EXTERIOR_NUMBER,
                    identifier: r.ADDRESSES_IDENTIFIER,
                    interior_number: r.ADDRESSES_INTERIOR_NUMBER,
                    municipality: r.ADDRESSES_MUNICIPALITY,
                    state: r.ADDRESSES_STATE,
                    street: r.ADDRESSES_STREET,
                    suburb: r.ADDRESSES_SUBURB,
                    type: r.ADDRESSES_TYPE,
                    zip_code: r.ADDRESSES_ZIP,
                }],
                lines: [],
                metadata: [
                    { key: r.METADATA_KEY_01, value: r.METADATA_VALUE_01 },
                    { key: r.METADATA_KEY_02, value: r.METADATA_VALUE_02 },
                    { key: r.METADATA_KEY_03, value: r.METADATA_VALUE_03 },
                    { key: r.METADATA_KEY_04, value: r.METADATA_VALUE_04 },
                ],
                subtotal: r.SUBTOTAL,
                total: r.TOTAL,
                vat_sum: r.VAT_SUM,
                withhold_tax_sum: r.WITHHOLD_TAX_SUM,
                warehouse: r.WAREHOUSE,
                provider_external_id: r.PROVIDER_EXTERNAL_ID,
                requisition_number: r.REQUISITION_NUMBER
            };
        }
        // añadir cada línea
        ordersMap[key].lines.push({
            code: r.LINES_CODE,
            external_id: String(r.LINES_EXTERNAL_ID),
            description: r.LINES_DESCRIPTION,
            num: r.LINES_NUM,
            unit_of_measure: r.LINES_UNIT_OF_MEASURE,
            price: r.LINES_PRICE,
            quantity: r.LINES_QUANTITY,
            subtotal: r.LINES_SUBTOTAL,
            total: r.LINES_TOTAL,
            comments: r.LINES_COMMENTS,
            metadata: [],
            vat_taxes: r.LINES_VAT_TAXES_RATE > 0
                ? [{
                    amount: r.LINES_VAT_TAXES_AMOUNT,
                    code: r.LINES_VAT_TAXES_CODE,
                    external_code: r.LINES_VAT_TAXES_EXTERNAL_CODE,
                    rate: r.LINES_VAT_TAXES_RATE,
                    type: 'TRANSFERRED'
                }]
                : [],
            withholding_taxes: r.LINES_WITHHOLDING_TAXES_RATE > 0
                ? [{
                    amount: r.LINES_WITHHOLDING_TAXES_AMOUNT,
                    code: r.LINES_WITHHOLDING_TAXES_CODE,
                    external_code: r.LINES_WITHHOLDING_TAXES_EXTERNAL_CODE,
                    rate: r.LINES_WITHHOLDING_TAXES_RATE
                }]
                : []
        });
    });

    const results = [];
    const orders = Object.values(ordersMap);

    // 3) Validar y enviar cada orden
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
                        PDPTenantKey: apiKeys[index],
                        PDPTenantSecret: apiSecrets[index]
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
