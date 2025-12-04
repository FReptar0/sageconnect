// src/scripts/upload-authorized-pos.js
// Script to upload authorized purchase orders from today to Portal de Proveedores
const dotenv = require('dotenv');

// carga las credenciales del portal de proveedores
const creds = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const {
  TENANT_ID,
  API_KEY,
  API_SECRET,
  URL,
  DATABASES
} = creds;

// utilerías
const { runQuery } = require('../utils/SQLServerConnection');
const { groupOrdersByNumber } = require('../utils/OC_GroupOrdersByNumber');
const { parseExternPurchaseOrders } = require('../utils/parseExternPurchaseOrders');
const { validateExternPurchaseOrder } = require('../models/PurchaseOrder');

// preparamos arrays de tenants/keys/etc. y sólo usamos el primero en este test
const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const databases = DATABASES.split(',');
const index = 0;

async function testQuery() {
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  // 1) Ejecuta tu consulta a DATABASE para los dos POs

  const sql = `
select 
  'ACCEPTED' as ACCEPTANCE_STATUS,
  ISNULL(RTRIM(F.CITY),'')                     as [ADDRESSES_CITY],
  ISNULL(RTRIM(F.COUNTRY),'')                  as [ADDRESSES_COUNTRY],
  ''                                           as [ADDRESSES_EXTERIOR_NUMBER],
  ISNULL(RTRIM(F.[LOCATION]),'')               as [ADDRESSES_IDENTIFIER],
  ''                                           as [ADDRESSES_INTERIOR_NUMBER],
  ISNULL(RTRIM(F.ADDRESS2),'')                 as [ADDRESSES_MUNICIPALITY],
  ISNULL(RTRIM(F.[STATE]),'')                  as [ADDRESSES_STATE],
  ISNULL(RTRIM(F.ADDRESS1),'')                 as [ADDRESSES_STREET],
  ''                                           as [ADDRESSES_SUBURB],
  'SHIPPING'                                   as [ADDRESSES_TYPE],
  ISNULL(RTRIM(F.ZIP),'')                      as [ADDRESSES_ZIP],
  'F' + LEFT(
    (SELECT RTRIM(VDESC)
       FROM COPDAT.dbo.CSOPTFD
      WHERE OPTFIELD = 'METODOPAGO'
        AND VALUE    = E2.[VALUE]
    ), 2
  )                                            as [CFDI_PAYMENT_FORM],
  ''                                           as [CFDI_PAYMENT_METHOD],
  RTRIM(C2.[VALUE])                            as [CFDI_USE],
  RTRIM(A.DESCRIPTIO) + ' ' + RTRIM(A.COMMENT) as [COMMENTS],
  '0123456789'                                 as [COMPANY_EXTERNAL_ID],
  CASE WHEN RTRIM(A.CURRENCY)='MXP' THEN 'MXN' ELSE RTRIM(A.CURRENCY) END as [CURRENCY],
  CAST(
    SUBSTRING(CAST(A.[DATE] AS VARCHAR),1,4) + '-' +
    SUBSTRING(CAST(A.[DATE] AS VARCHAR),5,2) + '-' +
    SUBSTRING(CAST(A.[DATE] AS VARCHAR),7,2)
  AS DATE)                                     as [DATE],
  RTRIM(A.FOBPOINT)                             as [DELIVERY_CONTACT],
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
  END                                          as [DELIVERY_DATE],
  A.RATE                                       as [EXCHANGE_RATE],
  RTRIM(A.PONUMBER)                            as [EXTERNAL_ID],
  ''                                           as [LINES_BUDGET_ID],
  ''                                           as [LINES_BUDGET_LINE_EXTERNAL_ID],
  RTRIM(B.ITEMNO)                              as [LINES_CODE],
  ''                                           as [LINES_COMMENTS],
  RTRIM(B.ITEMDESC)                            as [LINES_DESCRIPTION],
  B.PORLSEQ                                    as [LINES_EXTERNAL_ID],
  ''                                           as [LINES_METADATA],
  B.DETAILNUM                                  as [LINES_NUM],
  B.UNITCOST                                   as [LINES_PRICE],
  B.SQORDERED                                  as [LINES_QUANTITY],
  ''                                           as [LINES_REQUISITION_LINE_ID],
  B.EXTENDED                                   as [LINES_SUBTOTAL],
  B.EXTENDED + B.TAXAMOUNT                     as [LINES_TOTAL],
  RTRIM(B.ORDERUNIT)                           as [LINES_UNIT_OF_MEASURE],
  0                                            as [LINES_VAT_TAXES_AMOUNT],
  ''                                           as [LINES_VAT_TAXES_CODE],
  ''                                           as [LINES_VAT_TAXES_EXTERNAL_CODE],
  0                                            as [LINES_VAT_TAXES_RATE],
  0                                            as [LINES_WITHHOLDING_TAXES_AMOUNT],
  ''                                           as [LINES_WITHHOLDING_TAXES_CODE],
  ''                                           as [LINES_WITHHOLDING_TAXES_EXTERNAL_CODE],
  0                                            as [LINES_WITHHOLDING_TAXES_RATE],
  'AFE'                                        as [METADATA_KEY_01],
  RTRIM(C1.[VALUE])                            as [METADATA_VALUE_01],
  'REQUISICION'                                as [METADATA_KEY_02],
  RTRIM(A.RQNNUMBER)                           as [METADATA_VALUE_02],
  'CONDICIONES'                                as [METADATA_KEY_03],
  RTRIM(A.TERMSCODE)                           as [METADATA_VALUE_03],
  'USUARIO_DE_COMPRA'                          as [METADATA_KEY_04],
  RTRIM(A.FOBPOINT)                            as [METADATA_VALUE_04],
  RTRIM(A.PONUMBER)                            as [NUM],
  RTRIM(A.VDCODE)                              as [PROVIDER_EXTERNAL_ID],
  RTRIM(A.REFERENCE)                           as [REFERENCE],
  RTRIM(A1.ENTEREDBY)                          as [REQUESTED_BY_CONTACT],
  0                                            as [REQUISITION_NUMBER],
  'OPEN'                                       as [STATUS],
  A.EXTENDED                                   as [SUBTOTAL],
  A.DOCTOTAL                                   as [TOTAL],
  (
    (CASE WHEN A.TXEXCLUDE1<0 THEN 0 ELSE A.TXEXCLUDE1 END) +
    (CASE WHEN A.TXEXCLUDE2<0 THEN 0 ELSE A.TXEXCLUDE2 END) +
    (CASE WHEN A.TXEXCLUDE3<0 THEN 0 ELSE A.TXEXCLUDE3 END) +
    (CASE WHEN A.TXEXCLUDE4<0 THEN 0 ELSE A.TXEXCLUDE4 END) +
    (CASE WHEN A.TXEXCLUDE5<0 THEN 0 ELSE A.TXEXCLUDE5 END)
  )                                            as [VAT_SUM],
  ISNULL(RTRIM(B.[LOCATION]),'')                as [WAREHOUSE],
  (
    (CASE WHEN A.TXEXCLUDE1>0 THEN 0 ELSE A.TXEXCLUDE1 END) +
    (CASE WHEN A.TXEXCLUDE2>0 THEN 0 ELSE A.TXEXCLUDE2 END) +
    (CASE WHEN A.TXEXCLUDE3>0 THEN 0 ELSE A.TXEXCLUDE3 END) +
    (CASE WHEN A.TXEXCLUDE4>0 THEN 0 ELSE A.TXEXCLUDE4 END) +
    (CASE WHEN A.TXEXCLUDE5>0 THEN 0 ELSE A.TXEXCLUDE5 END)
  )                                            as [WITHHOLD_TAX_SUM]
from COPDAT.dbo.POPORH1 A
left outer join COPDAT.dbo.POPORH2 A1
  on A.PORHSEQ = A1.PORHSEQ
left outer join COPDAT.dbo.POPORL B
  on A.PORHSEQ = B.PORHSEQ
left outer join COPDAT.dbo.POPORHO C1
  on A.PORHSEQ = C1.PORHSEQ
 and C1.OPTFIELD = 'AFE'
left outer join COPDAT.dbo.POPORHO C2
  on A.PORHSEQ = C2.PORHSEQ
 and C2.OPTFIELD = 'USOCFDI'
left outer join COPDAT.dbo.APVEN D
  on A.VDCODE = D.VENDORID
left outer join COPDAT.dbo.APVENO E1
  on D.VENDORID = E1.VENDORID
 and E1.OPTFIELD = 'FORMAPAGO'
left outer join COPDAT.dbo.APVENO E2
  on D.VENDORID = E2.VENDORID
 and E2.OPTFIELD = 'METODOPAGO'
left outer join COPDAT.dbo.APVENO E3
  on D.VENDORID = E3.VENDORID
 and E3.OPTFIELD = 'PROVIDERID'
left outer join COPDAT.dbo.ICLOC F
  on B.[LOCATION] = F.[LOCATION]
left outer join Autorizaciones_electronicas.dbo.Autoriza_OC X
  on A.PONUMBER = X.PONumber
where
  X.Autorizada = 1
  and X.Empresa = 'COPDAT'
  and (
    select max(Fecha)
      from Autorizaciones_electronicas.dbo.Autoriza_OC_detalle
     where Empresa = 'COPDAT'
       and PONumber = A.PONUMBER
  ) = '${today}'
order by A.PONUMBER, B.DETAILNUM;
`;


  let recordset;
  try {
    ({ recordset } = await runQuery(sql, 'COPDAT'));
    console.log(`🔍 Recuperadas ${recordset.length} filas de la base`);
  } catch (dbErr) {
    console.error('❌ Error al ejecutar la consulta SQL:', dbErr);
    return;
  }

  // 3) Agrupar y parsear al formato de envío
  const grouped = groupOrdersByNumber(recordset);
  const ordersToSend = parseExternPurchaseOrders(grouped);

  // 4) Procesar cada PO
  for (let i = 0; i < ordersToSend.length; i++) {
    const po = ordersToSend[i];

    // 4.1) Comprobar si ya existe en fesaOCFocaltec
    const checkSql = `
      SELECT idFocaltec
      FROM dbo.fesaOCFocaltec
      WHERE ocSage    = '${po.external_id}'
        AND idDatabase= '${databases[index]}'
        AND idFocaltec IS NOT NULL
        AND status = 'POSTED'
    `;
    const { recordset: existing } = await runQuery(checkSql, 'FESA');
    if (existing.length > 0) {
      console.log(`⚠ [${i + 1}/${ordersToSend.length}] PO ${po.external_id} ya procesada (POSTED), se omite.`);
      continue;
    }

    // 4.2) Limpiar placeholders
    delete po.company_external_id;
    if (po.cfdi_payment_method === '') delete po.cfdi_payment_method;
    if (po.requisition_number === 0) delete po.requisition_number;

    // 4.3) Validar con Joi
    try {
      validateExternPurchaseOrder(po);
      console.log(`✅ [${i + 1}/${ordersToSend.length}] PO ${po.external_id} pasó validación Joi`);
    } catch (valErr) {
      console.error(`❌ Joi validation failed for PO ${po.external_id}:`);
      valErr.details.forEach(d => console.error(`   • ${d.message}`));

      // Insert ERROR en fesaOCFocaltec
      const respAPI = valErr.details.map(d => d.message).join('; ');
      const sqlErr = `
        INSERT INTO dbo.fesaOCFocaltec
          (idFocaltec, ocSage, status, lastUpdate, createdAt, responseAPI, idDatabase)
        VALUES
          ('',
           '${po.external_id}',
           'ERROR',
           GETDATE(),
           GETDATE(),
           '${respAPI}',
           '${databases[index]}'
          )
      `;
      await runQuery(sqlErr, 'FESA');
      continue;
    }

    // 4.4) Enviar al portal
    const endpoint = `${URL}/api/1.0/extern/tenants/${tenantIds[index]}/purchase-orders`;
    try {
      const resp = await axios.post(
        endpoint,
        po,
        {
          headers: {
            'PDPTenantKey': apiKeys[index],
            'PDPTenantSecret': apiSecrets[index],
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );
      console.log(
        `📤 [${i + 1}/${ordersToSend.length}] PO ${po.external_id} enviada OK\n` +
        `   ▶ Status: ${resp.status} ${resp.statusText}`
      );

      // 4.5) Insert POSTED en fesaOCFocaltec
      const idFocaltec = resp.data.id;
      const sqlOk = `
        INSERT INTO dbo.fesaOCFocaltec
          (idFocaltec, ocSage, status, lastUpdate, createdAt, responseAPI, idDatabase)
        VALUES
          ('${idFocaltec}',
           '${po.external_id}',
           'POSTED',
           GETDATE(),
           GETDATE(),
           NULL,
           '${databases[index]}'
          )
      `;
      await runQuery(sqlOk, 'FESA');

    } catch (err) {
      console.error(`🚨 [${i + 1}/${ordersToSend.length}] Error enviando PO ${po.external_id}:`);
      let respAPI;
      if (err.response) {
        console.error(`   ▶ Status: ${err.response.status} ${err.response.statusText}`);
        console.error(`   ▶ Body:`, err.response.data);
        const { code, description } = err.response.data;
        respAPI = `${code}: ${description}`;
      } else {
        console.error('   ▶ No hubo respuesta del servidor o timeout.');
        respAPI = err.message;
      }

      // 4.6) Insert ERROR en fesaOCFocaltec
      const sqlErr = `
        INSERT INTO dbo.fesaOCFocaltec
          (idFocaltec, ocSage, status, lastUpdate, createdAt, responseAPI, idDatabase)
        VALUES
          (NULL,
           '${po.external_id}',
           'ERROR',
           GETDATE(),
           GETDATE(),
           '${respAPI}',
           '${databases[index]}'
          )
      `;
      await runQuery(sqlErr, 'FESA');
    }
  }
}

testQuery();