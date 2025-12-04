// tests/PO_Upload.test.js

const axios = require('axios');
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
const ADDRESS_IDENTIFIERS_SKIP = config?.ADDRESS_IDENTIFIERS_SKIP || '';

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

/**
 * Uploads specific purchase orders to Portal de Proveedores
 * @param {string[]} poNumbers - Array of PO numbers to upload
 * @param {string} database - Database to query (optional, defaults to first database)
 * @param {number} tenantIndex - Tenant index to use (optional, defaults to 0)
 */
async function uploadSpecificPurchaseOrders(poNumbers, database = null, tenantIndex = 0) {
  const today = getCurrentDateString(); // 'YYYY-MM-DD'
  const logFileName = 'PO_Upload';
  const dbToUse = database || databases[tenantIndex];

  console.log(`[INICIO] ========================================`);
  console.log(`[INICIO] SUBIDA DE ÓRDENES ESPECÍFICAS AL PORTAL`);
  console.log(`[INICIO] Fecha/Hora: ${new Date().toISOString()}`);
  console.log(`[INICIO] Tenant: ${tenantIds[tenantIndex]}`);
  console.log(`[INICIO] Database: ${dbToUse}`);
  console.log(`[INICIO] POs a procesar: ${poNumbers.join(', ')}`);
  console.log(`[INICIO] ========================================`);

  // Preparar filtro de ubicaciones a omitir
  const skipIdentifiers = ADDRESS_IDENTIFIERS_SKIP.split(',').map(id => id.trim()).filter(id => id.length > 0);
  const skipCondition = skipIdentifiers.length > 0
    ? `AND B.[LOCATION] NOT IN (${skipIdentifiers.map(id => `'${id}'`).join(',')})`
    : '';


  if (skipIdentifiers.length > 0) {
    console.log(`[INFO] Omitiendo ubicaciones: ${skipIdentifiers.join(', ')}`);
    logGenerator(logFileName, 'info', `[INFO] Ubicaciones omitidas: ${skipIdentifiers.join(', ')}`);
  }

  logGenerator(logFileName, 'info', `========================================`);
  logGenerator(logFileName, 'info', `INICIO SUBIDA ESPECÍFICA - ${new Date().toISOString()}`);
  logGenerator(logFileName, 'info', `Tenant: ${tenantIds[tenantIndex]} | Database: ${dbToUse}`);
  logGenerator(logFileName, 'info', `POs objetivo: ${poNumbers.join(', ')}`);
  logGenerator(logFileName, 'info', `========================================`);

  // 1) Ejecuta tu consulta a DATABASE para los POs específicos (sin filtro de fecha)
  console.log(`[QUERY] Preparando consulta para POs específicas...`);
  logGenerator(logFileName, 'info', `[QUERY] Preparando consulta para base: ${dbToUse}`);

  const poFilter = poNumbers.map(po => `'${po}'`).join(',');

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
       FROM ${dbToUse}.dbo.CSOPTFD
      WHERE OPTFIELD = 'METODOPAGO'
        AND VALUE    = E2.[VALUE]
    ), 2
  )                                            as [CFDI_PAYMENT_FORM],
  ''                                           as [CFDI_PAYMENT_METHOD],
  UPPER(RTRIM(C2.[VALUE]))                     as [CFDI_USE],
  RTRIM(A.DESCRIPTIO) + ' ' + RTRIM(A.COMMENT) as [COMMENTS],
  '${externalId[tenantIndex]}'                       as [COMPANY_EXTERNAL_ID],
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
from ${dbToUse}.dbo.POPORH1 A
left outer join ${dbToUse}.dbo.POPORH2 A1
  on A.PORHSEQ = A1.PORHSEQ
left outer join ${dbToUse}.dbo.POPORL B
  on A.PORHSEQ = B.PORHSEQ
left outer join ${dbToUse}.dbo.POPORHO C1
  on A.PORHSEQ = C1.PORHSEQ
 and C1.OPTFIELD = 'AFE'
left outer join ${dbToUse}.dbo.POPORHO C2
  on A.PORHSEQ = C2.PORHSEQ
 and C2.OPTFIELD = 'USOCFDI'
left outer join ${dbToUse}.dbo.APVEN D
  on A.VDCODE = D.VENDORID
left outer join ${dbToUse}.dbo.APVENO E1
  on D.VENDORID = E1.VENDORID
 and E1.OPTFIELD = 'FORMAPAGO'
left outer join ${dbToUse}.dbo.APVENO E2
  on D.VENDORID = E2.VENDORID
 and E2.OPTFIELD = 'METODOPAGO'
left outer join ${dbToUse}.dbo.APVENO E3
  on D.VENDORID = E3.VENDORID
 and E3.OPTFIELD = 'PROVIDERID'
left outer join ${dbToUse}.dbo.ICLOC F
  on B.[LOCATION] = F.[LOCATION]
left outer join Autorizaciones_electronicas.dbo.Autoriza_OC X
  on A.PONUMBER = X.PONumber
where
  X.Autorizada = 1
  and X.Empresa = '${dbToUse}'
  and A.PONUMBER IN (${poFilter})
  ${skipCondition}
order by A.PONUMBER, B.PORLREV;
`;

  //TODO: Si los metadata values vienen vacios mandar un none 
  let recordset;
  try {
    ({ recordset } = await runQuery(sql, dbToUse));
    console.log(`[INFO] Recuperadas ${recordset.length} filas de la base para POs específicas`);
    logGenerator(logFileName, 'info', `[INFO] Iniciando uploadSpecificPurchaseOrders. Total de registros recuperados: ${recordset.length}`);
  } catch (dbErr) {
    console.error('❌ Error al ejecutar la consulta SQL:', dbErr);
    logGenerator(logFileName, 'error', `[ERROR] Error al ejecutar la consulta SQL: ${dbErr.message}`);
    return;
  }

  if (recordset.length === 0) {
    console.log('⚠️  No se encontraron registros para las POs especificadas');
    console.log('   Posibles causas:');
    console.log('   - Las POs no existen en la base de datos');
    console.log('   - Las POs no están autorizadas');
    console.log('   - Error en el nombre de la base de datos');
    logGenerator(logFileName, 'warn', `[WARN] No se encontraron registros para las POs: ${poNumbers.join(', ')}`);
    return;
  }

  // 3) Agrupar y parsear al formato de envío
  const grouped = groupOrdersByNumber(recordset);
  const ordersToSend = parseExternPurchaseOrders(grouped);

  console.log(`[INFO] Órdenes a procesar: ${ordersToSend.length}`);
  ordersToSend.forEach(order => {
    console.log(`[INFO] - ${order.external_id}`);
  });

  // 4) Procesar cada PO
  for (let i = 0; i < ordersToSend.length; i++) {
    const po = ordersToSend[i];
    console.log(`\n[PROCESANDO] ======= PO ${i + 1}/${ordersToSend.length}: ${po.external_id} =======`);

    // 4.1) Comprobar si ya existe en fesaOCFocaltec
    const checkSql = `
      SELECT idFocaltec, status
      FROM dbo.fesaOCFocaltec
      WHERE ocSage    = '${po.external_id}'
        AND idDatabase= '${dbToUse}'
        AND idFocaltec IS NOT NULL
        AND status = 'POSTED'
    `;
    const { recordset: existing } = await runQuery(checkSql, 'FESA');
    if (existing.length > 0) {
      console.log(`⚠️  [SKIP] PO ${po.external_id} ya procesada (POSTED), se omite.`);
      logGenerator(logFileName, 'warn', `[WARN] PO ${po.external_id} ya procesada (POSTED), se omite.`);
      continue;
    }

    // 4.2) Limpiar placeholders
    if (po.cfdi_payment_method === '') delete po.cfdi_payment_method;
    if (po.requisition_number === 0) delete po.requisition_number;

    // 4.3) Validar con Joi
    try {
      validateExternPurchaseOrder(po);
      console.log(`✅ [VALID] PO ${po.external_id} pasó validación Joi`);
      logGenerator(logFileName, 'info', `[OK] PO ${po.external_id} pasó validación Joi`);
    } catch (valErr) {
      console.error(`❌ [ERROR] Joi validation failed for PO ${po.external_id}:`);
      valErr.details.forEach(d => console.error(`   -> ${d.message}`));
      logGenerator(logFileName, 'error', `[ERROR] Validación Joi falló para PO ${po.external_id}: ${valErr.details.map(d => d.message).join('; ')}`);

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
           '${dbToUse}'
          )
      `;
      await runQuery(sqlErr, 'FESA');
      continue;
    }

    // 4.4) Enviar al portal
    const endpoint = `${urlBase(tenantIndex)}/purchase-orders`;
    try {
      console.log(`🚀 [UPLOAD] Enviando al Portal de Proveedores...`);
      const resp = await axios.post(
        endpoint,
        po,
        {
          headers: {
            'PDPTenantKey': apiKeys[tenantIndex],
            'PDPTenantSecret': apiSecrets[tenantIndex],
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );
      console.log(
        `✅ [SUCCESS] PO ${po.external_id} enviada OK\n` +
        `   -> Status: ${resp.status} ${resp.statusText}\n` +
        `   -> ID Focaltec: ${resp.data.id}`
      );
      logGenerator(logFileName, 'info', `[OK] PO ${po.external_id} enviada OK. Status: ${resp.status} ${resp.statusText}`);

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
           '${dbToUse}'
          )
      `;
      await runQuery(sqlOk, 'FESA');
      logGenerator(logFileName, 'info', `[OK] PO ${po.external_id} marcada POSTED en FESA con idFocaltec: ${idFocaltec}`);

    } catch (err) {
      console.error(`❌ [ERROR] Error enviando PO ${po.external_id}:`);
      let respAPI;
      if (err.response) {
        console.error(`   -> Status: ${err.response.status} ${err.response.statusText}`);
        console.error(`   -> Body:`, err.response.data);
        const { code, description } = err.response.data;
        respAPI = `${code}: ${description}`;
      } else {
        console.error('   -> No hubo respuesta del servidor o timeout.');
        respAPI = err.message;
      }
      logGenerator(logFileName, 'error', `[ERROR] Error enviando PO ${po.external_id}: ${respAPI}`);

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
           '${dbToUse}'
          )
      `;
      await runQuery(sqlErr, 'FESA');
      logGenerator(logFileName, 'info', `[INFO] PO ${po.external_id} marcada ERROR en FESA: ${respAPI}`);
    }
  }

  console.log(`\n[FIN] ==========================================`);
  console.log(`[FIN] Proceso completado para ${ordersToSend.length} órdenes`);
  console.log(`[FIN] Tenant: ${tenantIds[tenantIndex]}`);
  console.log(`[FIN] Database: ${dbToUse}`);
  console.log(`[FIN] ==========================================`);
  logGenerator(logFileName, 'info', `[FIN] Proceso completado para ${ordersToSend.length} órdenes - Tenant: ${tenantIds[tenantIndex]}`);
}

// Función principal para manejar argumentos CLI
async function runPOUpload() {
  console.log('🚀 SUBIDA DE ÓRDENES ESPECÍFICAS AL PORTAL DE PROVEEDORES');
  console.log('=========================================================\n');

  // Obtener parámetros de la línea de comandos
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('❌ ERROR: Debes proporcionar al menos un número de PO');
    console.log('\n📋 Uso:');
    console.log('  node tests/PO_Upload.test.js PO0075624 [PO0075625] [DATABASE] [TENANT_INDEX]');
    console.log('\n📝 Ejemplos:');
    console.log('  node tests/PO_Upload.test.js PO0075624');
    console.log('  node tests/PO_Upload.test.js PO0075624 PO0075625');
    console.log('  node tests/PO_Upload.test.js PO0075624 PO0075625 COPDAT');
    console.log('  node tests/PO_Upload.test.js PO0075624 PO0075625 COPDAT 0');
    console.log('\n📊 Parámetros:');
    console.log('  - PO numbers: Uno o más números de PO (requerido)');
    console.log('  - DATABASE: Base de datos específica (opcional)');
    console.log('  - TENANT_INDEX: Índice del tenant (opcional, default: 0)');
    return;
  }

  // Separar POs de otros parámetros
  const poNumbers = [];
  let database = null;
  let tenantIndex = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Si empieza con PO, es un número de PO
    if (arg.startsWith('PO')) {
      poNumbers.push(arg);
    }
    // Si es un número, es el tenant index
    else if (/^\d+$/.test(arg)) {
      tenantIndex = parseInt(arg);
    }
    // Si no, es el database
    else {
      database = arg;
    }
  }

  if (poNumbers.length === 0) {
    console.log('❌ ERROR: No se encontraron números de PO válidos');
    console.log('   Los números de PO deben empezar con "PO"');
    return;
  }

  console.log(`📦 Parámetros detectados:`);
  console.log(`   - POs: ${poNumbers.join(', ')}`);
  console.log(`   - Database: ${database || 'Usar configuración por defecto'}`);
  console.log(`   - Tenant Index: ${tenantIndex}`);
  console.log();

  try {
    await uploadSpecificPurchaseOrders(poNumbers, database, tenantIndex);
    console.log('\n✅ PROCESO COMPLETADO EXITOSAMENTE');
  } catch (error) {
    console.error('\n❌ ERROR EN EL PROCESO:', error.message);
    logGenerator('PO_Upload', 'error', `[ERROR] Error en proceso principal: ${error.message}`);
  }
}

// Exportar funciones para uso en otros archivos
module.exports = {
  uploadSpecificPurchaseOrders,
  runPOUpload
};

// Ejecutar si el archivo se ejecuta directamente
if (require.main === module) {
  runPOUpload().catch(console.error);
}