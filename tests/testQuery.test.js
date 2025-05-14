const { runQuery } = require('../utils/SQLServerConnection');

async function testQuery() {
    // Tu consulta original, con WHERE estático
    const sql = `
    SELECT 
      'ACCEPTED' AS ACCEPTANCE_STATUS,
      ISNULL(F.CITY,'')                 AS ADDRESSES_CITY,
      ISNULL(F.COUNTRY,'')              AS ADDRESSES_COUNTRY,
      ''                                 AS ADDRESSES_EXTERIOR_NUMBER,
      ISNULL(F.[LOCATION],'')            AS ADDRESSES_IDENTIFIER,
      ''                                 AS ADDRESSES_INTERIOR_NUMBER,
      ISNULL(F.ADDRESS2,'')             AS ADDRESSES_MUNICIPALITY,
      ISNULL(F.[STATE],'')               AS ADDRESSES_STATE,
      ISNULL(F.ADDRESS1,'')             AS ADDRESSES_STREET,
      ''                                 AS ADDRESSES_SUBURB,
      'SHIPPING'                        AS ADDRESSES_TYPE,
      ISNULL(F.ZIP,'')                  AS ADDRESSES_ZIP,
      'F' + LEFT(
        (SELECT RTRIM(VDESC)
           FROM CSOPTFD
          WHERE OPTFIELD = 'METODOPAGO'
            AND VALUE    = E2.[VALUE]
        ), 2
      )                                 AS CFDI_PAYMENT_FORM,
      ''                                 AS CFDI_PAYMENT_METHOD,
      C2.[VALUE]                        AS CFDI_USE,
      A.DESCRIPTIO + ' ' + A.COMMENT    AS COMMENTS,
      '0123456789'                      AS COMPANY_EXTERNAL_ID,
      CASE WHEN A.CURRENCY = 'MXP' THEN 'MXN' ELSE A.CURRENCY END AS CURRENCY,
      CAST(
        SUBSTRING(CAST(A.[DATE] AS VARCHAR),1,4) + '-' +
        SUBSTRING(CAST(A.[DATE] AS VARCHAR),5,2) + '-' +
        SUBSTRING(CAST(A.[DATE] AS VARCHAR),7,2)
      AS DATE)                          AS [DATE],
      A.FOBPOINT                        AS DELIVERY_CONTACT,
      CASE WHEN A.EXPARRIVAL = 0 THEN
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
      END                               AS DELIVERY_DATE,
      A.RATE                            AS EXCHANGE_RATE,
      A.PONUMBER                        AS EXTERNAL_ID,
      ''                                AS LINES_BUDGET_ID,
      ''                                AS LINES_BUDGET_LINE_EXTERNAL_ID,
      B.ITEMNO                          AS LINES_CODE,
      ''                                AS LINES_COMMENTS,
      B.ITEMDESC                        AS LINES_DESCRIPTION,
      B.PORLSEQ                         AS LINES_EXTERNAL_ID,
      ''                                AS LINES_METADATA,
      B.DETAILNUM                       AS LINES_NUM,
      B.UNITCOST                        AS LINES_PRICE,
      B.SQORDERED                       AS LINES_QUANTITY,
      ''                                AS LINES_REQUISITION_LINE_ID,
      B.EXTENDED                        AS LINES_SUBTOTAL,
      B.EXTENDED + B.TAXAMOUNT          AS LINES_TOTAL,
      B.ORDERUNIT                       AS LINES_UNIT_OF_MEASURE,
      0                                 AS LINES_VAT_TAXES_AMOUNT,
      ''                                AS LINES_VAT_TAXES_CODE,
      ''                                AS LINES_VAT_TAXES_EXTERNAL_CODE,
      0                                 AS LINES_VAT_TAXES_RATE,
      0                                 AS LINES_WITHHOLDING_TAXES_AMOUNT,
      ''                                AS LINES_WITHHOLDING_TAXES_CODE,
      ''                                AS LINES_WITHHOLDING_TAXES_EXTERNAL_CODE,
      0                                 AS LINES_WITHHOLDING_TAXES_RATE,
      'AFE'                             AS METADATA_KEY_01,
      C1.[VALUE]                        AS METADATA_VALUE_01,
      'REQUISICION'                     AS METADATA_KEY_02,
      A.RQNNUMBER                       AS METADATA_VALUE_02,
      'CONDICIONES'                     AS METADATA_KEY_03,
      A.TERMSCODE                       AS METADATA_VALUE_03,
      'USUARIO_DE_COMPRA'               AS METADATA_KEY_04,
      A.FOBPOINT                        AS METADATA_VALUE_04,
      A.PONUMBER                        AS NUM,
      A.VDCODE                          AS PROVIDER_EXTERNAL_ID,
      A.REFERENCE                       AS REFERENCE,
      A1.ENTEREDBY                      AS REQUESTED_BY_CONTACT,
      0                                 AS REQUISITION_NUMBER,
      'OPEN'                            AS STATUS,
      A.EXTENDED                        AS SUBTOTAL,
      A.DOCTOTAL                        AS TOTAL,
      (
        ISNULL(NULLIF(A.TXEXCLUDE1, -1), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE2, -1), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE3, -1), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE4, -1), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE5, -1), 0)
      )                                 AS VAT_SUM,
      B.[LOCATION]                      AS WAREHOUSE,
      (
        ISNULL(NULLIF(A.TXEXCLUDE1,  0), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE2,  0), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE3,  0), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE4,  0), 0) +
        ISNULL(NULLIF(A.TXEXCLUDE5,  0), 0)
      )                                 AS WITHHOLD_TAX_SUM
    FROM COPDAT.dbo.POPORH1 A
      LEFT JOIN COPDAT.dbo.POPORH2 A1 ON A.PORHSEQ = A1.PORHSEQ
      LEFT JOIN COPDAT.dbo.POPORL  B  ON A.PORHSEQ = B.PORHSEQ
      LEFT JOIN COPDAT.dbo.POPORHO C1 ON A.PORHSEQ = C1.PORHSEQ AND C1.OPTFIELD = 'AFE'
      LEFT JOIN COPDAT.dbo.POPORHO C2 ON A.PORHSEQ = C2.PORHSEQ AND C2.OPTFIELD = 'USOCFDI'
      LEFT JOIN COPDAT.dbo.APVEN   D  ON A.VDCODE = D.VENDORID
      LEFT JOIN COPDAT.dbo.APVENO  E1 ON D.VENDORID = E1.VENDORID AND E1.OPTFIELD = 'FORMAPAGO'
      LEFT JOIN COPDAT.dbo.APVENO  E2 ON D.VENDORID = E2.VENDORID AND E2.OPTFIELD = 'METODOPAGO'
      LEFT JOIN COPDAT.dbo.APVENO  E3 ON D.VENDORID = E3.VENDORID AND E3.OPTFIELD = 'PROVIDERID'
      LEFT JOIN COPDAT.dbo.ICLOC   F  ON B.[LOCATION] = F.[LOCATION]
      LEFT JOIN Autorizaciones_electronicas.dbo.Autoriza_OC X 
        ON A.PONUMBER = X.PONumber
    WHERE A.PONUMBER = 'PO0047640';
  `;

    try {
        // Asegúrate de pasar tu database si no es el default de .env
        const { recordset } = await runQuery(sql, 'COPDAT');
        console.log(`Se recuperaron ${recordset.length} filas para PO0047640:`);
        console.dir(recordset, { depth: null });
    } catch (err) {
        console.error('Error al ejecutar la consulta de prueba:', err);
    }
}

testQuery();
