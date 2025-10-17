const dotenv = require('dotenv');

// carga las credenciales del portal de proveedores
const creds = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;

// carga las variables de configuración general (incluyendo direcciones por defecto)
const config = dotenv.config({ path: '.env' }).parsed;

const {
  TENANT_ID,
  API_KEY,
  API_SECRET,
  URL,
  DATABASES,
  EXTERNAL_IDS
} = creds;

// Variables de configuración de direcciones por defecto para órdenes de compra
// Estas variables se usan cuando la tabla ICLOC no tiene datos de dirección para una ubicación
// Si no están configuradas en el .env, se usa string vacío como fallback
const DEFAULT_ADDRESS_CITY = config?.DEFAULT_ADDRESS_CITY || '';
const DEFAULT_ADDRESS_COUNTRY = config?.DEFAULT_ADDRESS_COUNTRY || '';
const DEFAULT_ADDRESS_IDENTIFIER = config?.DEFAULT_ADDRESS_IDENTIFIER || '';
const DEFAULT_ADDRESS_MUNICIPALITY = config?.DEFAULT_ADDRESS_MUNICIPALITY || '';
const DEFAULT_ADDRESS_STATE = config?.DEFAULT_ADDRESS_STATE || '';
const DEFAULT_ADDRESS_STREET = config?.DEFAULT_ADDRESS_STREET || '';
const DEFAULT_ADDRESS_ZIP = config?.DEFAULT_ADDRESS_ZIP || '';

// utilerías
const { runQuery } = require('../utils/SQLServerConnection');
const { getCurrentDateString } = require('../utils/TimezoneHelper');
const { logGenerator } = require('../utils/LogGenerator');
const { groupOrdersByNumber } = require('../utils/OC_GroupOrdersByNumber');
const { parseExternPurchaseOrders } = require('../utils/parseExternPurchaseOrders');
const { validateExternPurchaseOrder } = require('../models/PurchaseOrder');

// preparamos arrays de tenants/keys/etc.
const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const databases = DATABASES.split(',');
const externalId = EXTERNAL_IDS.split(',');

const urlBase = (index) => `${URL}/api/1.0/extern/tenants/${tenantIds[index]}`;

// Órdenes específicas para testing (desde 2024)
const TEST_POS = ['PO0074902', 'PO0075300'];

async function testPurchaseOrdersQuery(index) {
  const today = getCurrentDateString(); // 'YYYY-MM-DD'
  const logFileName = 'PortalOC_Creation_TEST';
  
  console.log(`[TEST] Ejecutando proceso de prueba de consultas - Tenant: ${tenantIds[index]} - Fecha: ${today}`);
  console.log(`[TEST] Probando con POs: ${TEST_POS.join(', ')}`);
  
  // 1) Ejecuta tu consulta a DATABASE para los POs específicos (sin filtro de fecha)
  const poFilter = TEST_POS.map(po => `'${po}'`).join(',');
  
  const sql = `
select 
  'ACCEPTED' as ACCEPTANCE_STATUS,
  ISNULL(RTRIM(F.CITY),'${DEFAULT_ADDRESS_CITY}')                     as [ADDRESSES_CITY],
  ISNULL(RTRIM(F.COUNTRY),'${DEFAULT_ADDRESS_COUNTRY}')                  as [ADDRESSES_COUNTRY],
  ''                                           as [ADDRESSES_EXTERIOR_NUMBER],
  ISNULL(RTRIM(F.[LOCATION]),'${DEFAULT_ADDRESS_IDENTIFIER}')               as [ADDRESSES_IDENTIFIER],
  ''                                           as [ADDRESSES_INTERIOR_NUMBER],
  ISNULL(RTRIM(F.ADDRESS2),'${DEFAULT_ADDRESS_MUNICIPALITY}')                 as [ADDRESSES_MUNICIPALITY],
  ISNULL(RTRIM(F.[STATE]),'${DEFAULT_ADDRESS_STATE}')                  as [ADDRESSES_STATE],
  ISNULL(RTRIM(F.ADDRESS1),'${DEFAULT_ADDRESS_STREET}')                 as [ADDRESSES_STREET],
  ''                                           as [ADDRESSES_SUBURB],
  'SHIPPING'                                   as [ADDRESSES_TYPE],
  ISNULL(RTRIM(F.ZIP),'${DEFAULT_ADDRESS_ZIP}')                      as [ADDRESSES_ZIP],
  'F' + LEFT(
    (SELECT RTRIM(VDESC)
       FROM ${databases[index]}.dbo.CSOPTFD
      WHERE OPTFIELD = 'METODOPAGO'
        AND VALUE    = E2.[VALUE]
    ), 2
  )                                            as [CFDI_PAYMENT_FORM],
  ''                                           as [CFDI_PAYMENT_METHOD],
  UPPER(RTRIM(C2.[VALUE]))                     as [CFDI_USE],
  RTRIM(A.DESCRIPTIO) + ' ' + RTRIM(A.COMMENT) as [COMMENTS],
  '${externalId[index]}'                       as [COMPANY_EXTERNAL_ID],
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
  ROW_NUMBER() OVER (PARTITION BY A.PONUMBER ORDER BY B.PORLREV) as [LINES_NUM],
  B.UNITCOST                                   as [LINES_PRICE],
  B.SQORDERED                                  as [LINES_QUANTITY],
  ''                                           as [LINES_REQUISITION_LINE_ID],
  B.EXTENDED                                   as [LINES_SUBTOTAL],
  B.EXTENDED                                   as [LINES_TOTAL],
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
from ${databases[index]}.dbo.POPORH1 A
left outer join ${databases[index]}.dbo.POPORH2 A1
  on A.PORHSEQ = A1.PORHSEQ
left outer join ${databases[index]}.dbo.POPORL B
  on A.PORHSEQ = B.PORHSEQ
left outer join ${databases[index]}.dbo.POPORHO C1
  on A.PORHSEQ = C1.PORHSEQ
 and C1.OPTFIELD = 'AFE'
left outer join ${databases[index]}.dbo.POPORHO C2
  on A.PORHSEQ = C2.PORHSEQ
 and C2.OPTFIELD = 'USOCFDI'
left outer join ${databases[index]}.dbo.APVEN D
  on A.VDCODE = D.VENDORID
left outer join ${databases[index]}.dbo.APVENO E1
  on D.VENDORID = E1.VENDORID
 and E1.OPTFIELD = 'FORMAPAGO'
left outer join ${databases[index]}.dbo.APVENO E2
  on D.VENDORID = E2.VENDORID
 and E2.OPTFIELD = 'METODOPAGO'
left outer join ${databases[index]}.dbo.APVENO E3
  on D.VENDORID = E3.VENDORID
 and E3.OPTFIELD = 'PROVIDERID'
left outer join ${databases[index]}.dbo.ICLOC F
  on B.[LOCATION] = F.[LOCATION]
left outer join Autorizaciones_electronicas.dbo.Autoriza_OC X
  on A.PONUMBER = X.PONumber
where
  X.Autorizada = 1
  and X.Empresa = '${databases[index]}'
  and A.PONUMBER IN (${poFilter})
order by A.PONUMBER, B.PORLREV;
`;

  console.log('\n[TEST] === CONSULTA SQL GENERADA ===');
  console.log(sql);
  console.log('\n[TEST] === FIN CONSULTA SQL ===\n');

  let recordset;
  try {
    ({ recordset } = await runQuery(sql, databases[index]));
    console.log(`[TEST] Recuperadas ${recordset.length} filas de la base para POs de prueba`);
    logGenerator(logFileName, 'info', `[TEST] Consulta de prueba ejecutada para index=${index}. Total de registros recuperados: ${recordset.length}`);
    
    if (recordset.length > 0) {
      console.log('\n[TEST] === PRIMEROS 3 REGISTROS RECUPERADOS ===');
      recordset.slice(0, 3).forEach((row, idx) => {
        console.log(`[TEST] Registro ${idx + 1}:`);
        console.log(`   PO: ${row.EXTERNAL_ID}`);
        console.log(`   Línea: ${row.LINES_NUM}`);
        console.log(`   Producto: ${row.LINES_CODE} - ${row.LINES_DESCRIPTION}`);
        console.log(`   Cantidad: ${row.LINES_QUANTITY} ${row.LINES_UNIT_OF_MEASURE}`);
        console.log(`   Precio: ${row.LINES_PRICE} ${row.CURRENCY}`);
        console.log(`   Total línea: ${row.LINES_TOTAL}`);
        console.log('   ---');
      });
      console.log('[TEST] === FIN REGISTROS ===\n');
    }
    
  } catch (dbErr) {
    console.error('[TEST] ❌ Error al ejecutar la consulta SQL:', dbErr);
    logGenerator(logFileName, 'error', `[TEST] Error al ejecutar la consulta SQL en index=${index}: ${dbErr.message}`);
    return;
  }

  // 3) Agrupar y parsear al formato de envío (SIN ENVIAR)
  console.log('[TEST] === AGRUPANDO DATOS ===');
  const grouped = groupOrdersByNumber(recordset);
  console.log(`[TEST] Órdenes agrupadas: ${Object.keys(grouped).length}`);
  Object.keys(grouped).forEach(poNumber => {
    console.log(`[TEST] - ${poNumber}: ${grouped[poNumber].length} líneas`);
  });
  
  console.log('\n[TEST] === PARSEANDO A FORMATO DE ENVÍO ===');
  const ordersToSend = parseExternPurchaseOrders(grouped);
  console.log(`[TEST] Órdenes parseadas: ${ordersToSend.length}`);

  // 4) Procesar cada PO (SOLO VALIDACIÓN, SIN ENVÍO)
  for (let i = 0; i < ordersToSend.length; i++) {
    const po = ordersToSend[i];
    console.log(`\n[TEST] === PROCESANDO PO ${i + 1}/${ordersToSend.length}: ${po.external_id} ===`);
    
    // 4.1) Comprobar si ya existe en fesaOCFocaltec (SIN MODIFICAR)
    const checkSql = `
      SELECT idFocaltec, status
      FROM dbo.fesaOCFocaltec
      WHERE ocSage    = '${po.external_id}'
        AND idDatabase= '${databases[index]}'
    `;
    try {
      const { recordset: existing } = await runQuery(checkSql, 'FESA');
      if (existing.length > 0) {
        console.log(`[TEST] Estado en FESA: ${existing[0].status} (idFocaltec: ${existing[0].idFocaltec || 'NULL'})`);
      } else {
        console.log(`[TEST] No existe en FESA - se puede procesar`);
      }
    } catch (fesaErr) {
      console.log(`[TEST] Error consultando FESA: ${fesaErr.message}`);
    }

    // 4.2) Limpiar placeholders
    let poToSend = { ...po };
    if (poToSend.cfdi_payment_method === '') delete poToSend.cfdi_payment_method;
    if (poToSend.requisition_number === 0) delete poToSend.requisition_number;

    // 4.3) Validar con Joi (SIN INSERTAR ERRORES EN DB)
    try {
      validateExternPurchaseOrder(poToSend);
      console.log(`[TEST] ✅ PO ${po.external_id} pasó validación Joi`);
      logGenerator(logFileName, 'info', `[TEST] PO ${po.external_id} pasó validación Joi`);
    } catch (valErr) {
      console.error(`[TEST] ❌ Joi validation failed for PO ${po.external_id}:`);
      valErr.details.forEach(d => console.error(`[TEST]    -> ${d.message}`));
      logGenerator(logFileName, 'error', `[TEST] Validación Joi falló para PO ${po.external_id}: ${valErr.details.map(d => d.message).join('; ')}`);
    }

    // 4.4) Mostrar estructura final que se enviaría (SIN ENVIAR)
    console.log(`[TEST] === ESTRUCTURA FINAL PARA ${po.external_id} ===`);
    console.log(`[TEST] Proveedor: ${poToSend.provider_external_id}`);
    console.log(`[TEST] Fecha: ${poToSend.date}`);
    console.log(`[TEST] Fecha entrega: ${poToSend.delivery_date}`);
    console.log(`[TEST] Moneda: ${poToSend.currency}`);
    console.log(`[TEST] Total: ${poToSend.total}`);
    console.log(`[TEST] Líneas: ${poToSend.lines?.length || 0}`);
    console.log(`[TEST] Dirección: ${poToSend.addresses?.[0]?.street || 'N/A'}, ${poToSend.addresses?.[0]?.city || 'N/A'}`);
    
    if (poToSend.lines && poToSend.lines.length > 0) {
      console.log(`[TEST] Primera línea: ${poToSend.lines[0].code} - ${poToSend.lines[0].description}`);
      console.log(`[TEST]   Cantidad: ${poToSend.lines[0].quantity} ${poToSend.lines[0].unit_of_measure}`);
      console.log(`[TEST]   Precio: ${poToSend.lines[0].price}`);
    }
    
    console.log(`[TEST] === FIN ESTRUCTURA ${po.external_id} ===`);
  }
  
  console.log(`\n[TEST] === PROCESO DE PRUEBA COMPLETADO ===`);
  console.log(`[TEST] Total POs procesadas: ${ordersToSend.length}`);
  console.log(`[TEST] Sin envíos al portal ni inserts en DB`);
  logGenerator(logFileName, 'info', `[TEST] Proceso de prueba completado para tenant ${tenantIds[index]} - ${ordersToSend.length} POs analizadas`);
}

// Función para testing de consultas con diferentes filtros
async function testDifferentFilters(index) {
  console.log('\n[TEST] === PROBANDO DIFERENTES FILTROS ===\n');
  
  // Test 1: Filtro por fecha del día de hoy (original)
  console.log('[TEST] 1. Filtro original (fecha de hoy en autorizaciones):');
  const filterToday = `
    (
      select max(Fecha)
        from Autorizaciones_electronicas.dbo.Autoriza_OC_detalle
       where Empresa = '${databases[index]}'
         and PONumber = A.PONUMBER
    ) = CAST(GETDATE() AS DATE)
  `;
  console.log(filterToday);
  
  // Test 2: Sin filtro de fecha
  console.log('\n[TEST] 2. Sin filtro de fecha (solo autorizadas):');
  const filterNoDate = `X.Autorizada = 1 and X.Empresa = '${databases[index]}'`;
  console.log(filterNoDate);
  
  // Test 3: Filtro por POs específicas
  console.log('\n[TEST] 3. Filtro por POs específicas:');
  const filterSpecific = `A.PONUMBER IN ('PO0074902', 'PO0075300')`;
  console.log(filterSpecific);
  
  // Test 4: Filtro por fecha del año 2024
  console.log('\n[TEST] 4. Filtro por año 2024:');
  const filter2024 = `
    (
      select max(Fecha)
        from Autorizaciones_electronicas.dbo.Autoriza_OC_detalle
       where Empresa = '${databases[index]}'
         and PONumber = A.PONUMBER
    ) >= '2024-01-01' 
    AND 
    (
      select max(Fecha)
        from Autorizaciones_electronicas.dbo.Autoriza_OC_detalle
       where Empresa = '${databases[index]}'
         and PONumber = A.PONUMBER
    ) < '2025-01-01'
  `;
  console.log(filter2024);
  
  console.log('\n[TEST] === FIN PRUEBA FILTROS ===\n');
}

// Ejecutar pruebas
async function runTests() {
  console.log('[TEST] Iniciando pruebas para el primer tenant (index 0)...\n');
  
  try {
    // Test de filtros
    await testDifferentFilters(0);
    
    // Test de consulta principal
    await testPurchaseOrdersQuery(0);
    
  } catch (err) {
    console.error('[TEST] ❌ Error en las pruebas:', err);
  }
}

// Ejecutar las pruebas si se llama directamente
if (require.main === module) {
  runTests();
}

module.exports = {
  testPurchaseOrdersQuery,
  testDifferentFilters,
  runTests
}