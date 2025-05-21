
const axios    = require('axios');
const dotenv   = require('dotenv');

// carga las credenciales del portal de proveedores
const creds = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const {
  TENANT_ID,
  API_KEY,
  API_SECRET,
  URL
} = creds;

// utilerías tuyas
const { runQuery }                    = require('../src/utils/SQLServerConnection');
const { groupOrdersByNumber }         = require('../src/utils/OC_GroupOrdersByNumber');
const { parseExternPurchaseOrders }   = require('../src/utils/parseExternPurchaseOrders');
const { validateExternPurchaseOrder } = require('../src/models/PurchaseOrder');

// preparamos arrays de tenants/keys/etc. y sólo usamos el primero en este test
const tenantIds  = TENANT_ID.split(',');
const apiKeys    = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const index      = 0;

async function testQuery() {
  // 1) Ejecuta tu consulta a COPDAT para los dos POs
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
      'F' + LEFT((SELECT RTRIM(VDESC) FROM CSOPTFD WHERE OPTFIELD='METODOPAGO' AND VALUE=E2.[VALUE]),2) as [CFDI_PAYMENT_FORM],
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
      LEFT OUTER JOIN COPDAT.dbo.POPORL B ON A.PORHSEQ=B.PORHSEQ
      LEFT OUTER JOIN COPDAT.dbo.POPORHO C1 ON A.PORHSEQ=C1.PORHSEQ AND C1.OPTFIELD='AFE'
      LEFT OUTER JOIN COPDAT.dbo.POPORHO C2 ON A.PORHSEQ=C2.PORHSEQ AND C2.OPTFIELD='USOCFDI'
      LEFT OUTER JOIN COPDAT.dbo.APVEN D ON A.VDCODE=D.VENDORID
      LEFT OUTER JOIN COPDAT.dbo.APVENO E1 ON D.VENDORID=E1.VENDORID and E1.OPTFIELD='FORMAPAGO'
      LEFT OUTER JOIN COPDAT.dbo.APVENO E2 ON D.VENDORID=E2.VENDORID and E2.OPTFIELD='METODOPAGO'
      LEFT OUTER JOIN COPDAT.dbo.APVENO E3 ON D.VENDORID=E3.VENDORID and E3.OPTFIELD='PROVIDERID'
      LEFT OUTER JOIN COPDAT.dbo.ICLOC F ON B.[LOCATION]=F.[LOCATION]
      LEFT OUTER JOIN Autorizaciones_electronicas.dbo.Autoriza_OC X on A.PONUMBER=X.PONumber
      WHERE A.PONUMBER IN ('PO0077479')
  `;

  let recordset;
  try {
    ({ recordset } = await runQuery(sql, 'COPDAT'));
    console.log(`🔍 Recuperadas ${recordset.length} filas de la base`);
  } catch (dbErr) {
    console.error('❌ Error al ejecutar la consulta SQL:', dbErr);
    return;
  }

  // 2) Agrupa y parsea
  const grouped      = groupOrdersByNumber(recordset);
  const ordersToSend = parseExternPurchaseOrders(grouped);

  // 3) Para cada PO: validar y enviar al portal con POST individual
  for (let i = 0; i < ordersToSend.length; i++) {
    const po = ordersToSend[i];
    delete po.company_external_id;

    // validación Joi
    try {
      validateExternPurchaseOrder(po);
      console.log(`✅ [${i+1}/${ordersToSend.length}] PO ${po.external_id} pasó validación Joi`);
    } catch (valErr) {
      console.error(`❌ Joi validation failed for PO ${po.external_id}:`);
      valErr.details.forEach(d => console.error(`   • ${d.message}`));
      continue;
    }

    // si cfdi_payment_method es cadena vacía, mejor eliminarlo
    if (po.cfdi_payment_method === '') {
      delete po.cfdi_payment_method;
    }

    if(po.requisition_number === 0){
      delete po.requisition_number
    }

    // construir endpoint exacto
    const endpoint = `${URL}/api/1.0/extern/tenants/${tenantIds[index]}/purchase-orders`;

    // envío POST
    try {
      const resp = await axios.post(
        endpoint,
        po,
        {
          headers: {
            'PDPTenantKey':    apiKeys[index],
            'PDPTenantSecret': apiSecrets[index],
            'Content-Type':    'application/json'
          },
          timeout: 30000
        }
      );
      console.log(
        `📤 [${i+1}/${ordersToSend.length}] PO ${po.external_id} enviada correctamente\n` +
        `   ▶ Endpoint: ${endpoint}\n` +
        `   ▶ Status: ${resp.status} ${resp.statusText}\n` +
        `   ▶ Body:\n${JSON.stringify(resp.data, null, 2)}`
      );
    } catch (err) {
      console.error(`🚨 [${i+1}/${ordersToSend.length}] Error enviando PO ${po.external_id}:`);
      console.error(`   ▶ Endpoint: ${endpoint}`);
      if (err.response) {
        console.error(
          `   ▶ Status: ${err.response.status} ${err.response.statusText}\n` +
          `   ▶ Body:\n${JSON.stringify(err.response.data, null, 2)}`
        );
      } else if (err.request) {
        console.error('   ▶ No hubo respuesta del servidor.');
      } else {
        console.error(`   ▶ Error: ${err.message}`);
      }
    }
  }
}

testQuery();