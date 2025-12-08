// tests/PO_Update.test.js

const axios = require('axios');
const dotenv = require('dotenv');

// Load credentials for Portal de Proveedores
const creds = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const config = dotenv.config({ path: '.env' }).parsed;

const {
  TENANT_ID,
  API_KEY,
  API_SECRET,
  URL,
  DATABASES,
  EXTERNAL_IDS
} = creds;

// Address configuration variables
const DEFAULT_ADDRESS_CITY = config?.DEFAULT_ADDRESS_CITY || '';
const DEFAULT_ADDRESS_COUNTRY = config?.DEFAULT_ADDRESS_COUNTRY || '';
const DEFAULT_ADDRESS_IDENTIFIER = config?.DEFAULT_ADDRESS_IDENTIFIER || '';
const DEFAULT_ADDRESS_MUNICIPALITY = config?.DEFAULT_ADDRESS_MUNICIPALITY || '';
const DEFAULT_ADDRESS_STATE = config?.DEFAULT_ADDRESS_STATE || '';
const DEFAULT_ADDRESS_STREET = config?.DEFAULT_ADDRESS_STREET || '';
const DEFAULT_ADDRESS_ZIP = config?.DEFAULT_ADDRESS_ZIP || '';
const ADDRESS_IDENTIFIERS_SKIP = config?.ADDRESS_IDENTIFIERS_SKIP || '';

// Utilities
const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { groupOrdersByNumber } = require('../utils/OC_GroupOrdersByNumber');
const { parseExternPurchaseOrders } = require('../utils/parseExternPurchaseOrders');
const { validateExternPurchaseOrder } = require('../models/PurchaseOrder');

// Prepare arrays of tenants/keys/etc.
const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const databases = DATABASES.split(',');
const externalIds = EXTERNAL_IDS.split(',');

const urlBase = (index) => `${URL}/api/1.0/extern/tenants/${tenantIds[index]}`;

/**
 * Tests purchase order updates by searching FESA, retrieving Sage data, and updating Portal
 * @param {string} poNumber - PO number to update
 * @param {string} database - Database to query (optional, defaults to first database)  
 * @param {number} tenantIndex - Tenant index to use (optional, defaults to 0)
 * @param {boolean} dryRun - If true, only simulates the update without sending to Portal
 */
async function testPurchaseOrderUpdate(poNumber, database = null, tenantIndex = 0, dryRun = false) {
  const logFileName = 'PO_Update';
  const dbToUse = database || databases[tenantIndex];

  console.log(`[INICIO] ========================================`);
  console.log(`[INICIO] PRUEBA DE ACTUALIZACIÓN DE ORDEN ${poNumber}`);
  console.log(`[INICIO] Fecha/Hora: ${new Date().toISOString()}`);
  console.log(`[INICIO] Tenant: ${tenantIds[tenantIndex]}`);
  console.log(`[INICIO] Database: ${dbToUse}`);
  console.log(`[INICIO] Modo: ${dryRun ? 'DRY RUN (sin enviar)' : 'ACTUALIZACIÓN REAL'}`);
  console.log(`[INICIO] ========================================`);

  logGenerator(logFileName, 'info', `========================================`);
  logGenerator(logFileName, 'info', `INICIO ACTUALIZACIÓN - ${new Date().toISOString()}`);
  logGenerator(logFileName, 'info', `PO: ${poNumber} | Tenant: ${tenantIds[tenantIndex]} | Database: ${dbToUse}`);
  logGenerator(logFileName, 'info', `Modo: ${dryRun ? 'DRY RUN' : 'REAL UPDATE'}`);
  logGenerator(logFileName, 'info', `========================================`);

  try {
    // STEP 1: Search for the PO in FESA database
    console.log(`\n[STEP 1] === BÚSQUEDA EN FESA ===`);
    const fesaResult = await searchPOInFESA(poNumber, dbToUse);

    if (!fesaResult.found) {
      console.log(`❌ [ERROR] PO ${poNumber} no encontrada en FESA o no está marcada como POSTED`);
      logGenerator(logFileName, 'error', `PO ${poNumber} no encontrada en FESA`);
      return { success: false, error: 'PO not found in FESA' };
    }

    console.log(`✅ [SUCCESS] PO encontrada en FESA:`);
    console.log(`   -> ID Focaltec: ${fesaResult.idFocaltec}`);
    console.log(`   -> Status: ${fesaResult.status}`);
    console.log(`   -> Creada: ${fesaResult.createdAt}`);
    console.log(`   -> Última actualización: ${fesaResult.lastUpdate}`);

    // STEP 2: Retrieve info from Sage with the query
    console.log(`\n[STEP 2] === RECUPERACIÓN DE DATOS SAGE ===`);
    const sageData = await retrieveFromSage(poNumber, dbToUse, tenantIndex);

    if (!sageData.success) {
      console.log(`❌ [ERROR] ${sageData.error}`);
      logGenerator(logFileName, 'error', `Error recuperando datos de Sage: ${sageData.error}`);
      return { success: false, error: sageData.error };
    }

    console.log(`✅ [SUCCESS] Datos recuperados de Sage:`);
    console.log(`   -> Total registros: ${sageData.recordCount}`);
    console.log(`   -> Líneas: ${sageData.parsedOrder.lines?.length || 0}`);
    console.log(`   -> Total: ${sageData.parsedOrder.total}`);
    console.log(`   -> Proveedor: ${sageData.parsedOrder.provider_external_id}`);

    // STEP 3: Update PO in Portal (or simulate)
    console.log(`\n[STEP 3] === ${dryRun ? 'SIMULACIÓN DE' : ''} ACTUALIZACIÓN EN PORTAL ===`);

    if (dryRun) {
      console.log(`🔍 [DRY RUN] Estructura que se enviaría al Portal:`);
      console.log(`   -> External ID: ${sageData.parsedOrder.external_id}`);
      console.log(`   -> Endpoint: ${urlBase(tenantIndex)}/purchase-orders/${fesaResult.idFocaltec}`);
      console.log(`   -> Método: PUT`);
      console.log(`   -> Líneas a enviar: ${sageData.parsedOrder.lines?.length || 0}`);

      if (sageData.parsedOrder.lines && sageData.parsedOrder.lines.length > 0) {
        console.log(`   -> Ejemplo línea 1:`);
        console.log(`      - Código: ${sageData.parsedOrder.lines[0].code}`);
        console.log(`      - Descripción: ${sageData.parsedOrder.lines[0].description}`);
        console.log(`      - Cantidad: ${sageData.parsedOrder.lines[0].quantity}`);
        console.log(`      - Precio: ${sageData.parsedOrder.lines[0].price}`);
      }

      console.log(`✅ [DRY RUN] Actualización simulada completada`);
      logGenerator(logFileName, 'info', `DRY RUN completado para PO ${poNumber}`);
      return { success: true, mode: 'dry-run', idFocaltec: fesaResult.idFocaltec };

    } else {
      const updateResult = await updatePOInPortal(fesaResult.idFocaltec, sageData.parsedOrder, tenantIndex);

      if (updateResult.success) {
        console.log(`✅ [SUCCESS] PO actualizada en Portal:`);
        console.log(`   -> Status: ${updateResult.status}`);
        console.log(`   -> Response: ${updateResult.data ? 'Datos recibidos' : 'Sin datos'}`);

        // Update timestamp in FESA
        await updateFESATimestamp(poNumber, dbToUse);
        console.log(`✅ [SUCCESS] Timestamp actualizado en FESA`);

        logGenerator(logFileName, 'info', `Actualización exitosa para PO ${poNumber}`);
        return { success: true, mode: 'update', status: updateResult.status };

      } else {
        console.log(`❌ [ERROR] Error actualizando PO en Portal: ${updateResult.error}`);
        logGenerator(logFileName, 'error', `Error actualizando PO ${poNumber}: ${updateResult.error}`);
        return { success: false, error: updateResult.error };
      }
    }

  } catch (error) {
    console.error(`\n❌ [ERROR] Error durante el proceso: ${error.message}`);
    logGenerator(logFileName, 'error', `Error durante proceso para ${poNumber}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Search for PO in FESA database
 * @param {string} poNumber - PO number to search
 * @param {string} database - Database identifier
 * @returns {Promise<Object>} Search result
 */
async function searchPOInFESA(poNumber, database) {
  const sql = `
    SELECT 
      RTRIM(idFocaltec) AS idFocaltec,
      RTRIM(ocSage) AS ocSage,
      status,
      createdAt,
      lastUpdate,
      responseAPI,
      idDatabase
    FROM fesa.dbo.fesaOCFocaltec
    WHERE ocSage = '${poNumber}'
      AND idDatabase = '${database}'
      AND idFocaltec IS NOT NULL
      AND status = 'POSTED'
  `;

  try {
    const { recordset } = await runQuery(sql, 'FESA');

    if (recordset.length > 0) {
      const record = recordset[0];
      return {
        found: true,
        idFocaltec: record.idFocaltec,
        status: record.status,
        createdAt: record.createdAt,
        lastUpdate: record.lastUpdate,
        responseAPI: record.responseAPI
      };
    }

    return { found: false };

  } catch (error) {
    throw new Error(`Error searching FESA: ${error.message}`);
  }
}

/**
 * Retrieve PO data from Sage using the standard query
 * @param {string} poNumber - PO number
 * @param {string} database - Database to query
 * @param {number} tenantIndex - Tenant index
 * @returns {Promise<Object>} Retrieved data
 */
async function retrieveFromSage(poNumber, database, tenantIndex) {
  // Prepare skip condition for locations
  const skipIdentifiers = ADDRESS_IDENTIFIERS_SKIP.split(',').map(id => id.trim()).filter(id => id.length > 0);
  const skipCondition = skipIdentifiers.length > 0
    ? `AND B.[LOCATION] NOT IN (${skipIdentifiers.map(id => `'${id}'`).join(',')})`
    : '';

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
       FROM ${database}.dbo.CSOPTFD
      WHERE OPTFIELD = 'METODOPAGO'
        AND VALUE    = E2.[VALUE]
    ), 2
  )                                            as [CFDI_PAYMENT_FORM],
  ''                                           as [CFDI_PAYMENT_METHOD],
  UPPER(RTRIM(C2.[VALUE]))                     as [CFDI_USE],
  RTRIM(A.DESCRIPTIO) + ' ' + RTRIM(A.COMMENT) as [COMMENTS],
  '${externalIds[tenantIndex]}'                       as [COMPANY_EXTERNAL_ID],
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
  B.SQORDERED                                 as [LINES_QUANTITY],
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
from ${database}.dbo.POPORH1 A
left outer join ${database}.dbo.POPORH2 A1
  on A.PORHSEQ = A1.PORHSEQ
left outer join ${database}.dbo.POPORL B
  on A.PORHSEQ = B.PORHSEQ
left outer join ${database}.dbo.POPORHO C1
  on A.PORHSEQ = C1.PORHSEQ
 and C1.OPTFIELD = 'AFE'
left outer join ${database}.dbo.POPORHO C2
  on A.PORHSEQ = C2.PORHSEQ
 and C2.OPTFIELD = 'USOCFDI'
left outer join ${database}.dbo.APVEN D
  on A.VDCODE = D.VENDORID
left outer join ${database}.dbo.APVENO E1
  on D.VENDORID = E1.VENDORID
 and E1.OPTFIELD = 'FORMAPAGO'
left outer join ${database}.dbo.APVENO E2
  on D.VENDORID = E2.VENDORID
 and E2.OPTFIELD = 'METODOPAGO'
left outer join ${database}.dbo.APVENO E3
  on D.VENDORID = E3.VENDORID
 and E3.OPTFIELD = 'PROVIDERID'
left outer join ${database}.dbo.ICLOC F
  on B.[LOCATION] = F.[LOCATION]
where
  A.PONUMBER = '${poNumber}'
  ${skipCondition}
order by A.PONUMBER, B.PORLREV;
`;

  try {
    const { recordset } = await runQuery(sql, database);

    if (recordset.length === 0) {
      return {
        success: false,
        error: `No data found for PO ${poNumber} in Sage database`
      };
    }

    // Group and parse the data
    const grouped = groupOrdersByNumber(recordset);
    const ordersToSend = parseExternPurchaseOrders(grouped);

    if (ordersToSend.length === 0) {
      return {
        success: false,
        error: `No valid orders generated after parsing for PO ${poNumber}`
      };
    }

    const parsedOrder = ordersToSend[0];

    // Clean placeholders
    if (parsedOrder.cfdi_payment_method === '') delete parsedOrder.cfdi_payment_method;
    if (parsedOrder.requisition_number === 0) delete parsedOrder.requisition_number;

    // Validate with Joi
    try {
      validateExternPurchaseOrder(parsedOrder);
    } catch (valErr) {
      return {
        success: false,
        error: `Validation failed: ${valErr.details.map(d => d.message).join('; ')}`
      };
    }

    return {
      success: true,
      recordCount: recordset.length,
      parsedOrder: parsedOrder
    };

  } catch (error) {
    return {
      success: false,
      error: `Database error: ${error.message}`
    };
  }
}

/**
 * Update PO in Portal de Proveedores
 * @param {string} idFocaltec - Focaltec ID for the PO
 * @param {Object} orderPayload - Order data to send
 * @param {number} tenantIndex - Tenant index
 * @returns {Promise<Object>} Update result
 */
async function updatePOInPortal(idFocaltec, orderPayload, tenantIndex) {
  const endpoint = `${urlBase(tenantIndex)}/purchase-orders/${idFocaltec}`;

  try {
    console.log(`🚀 [UPDATE] Enviando actualización al Portal...`);
    console.log(`   -> Endpoint: ${endpoint}`);
    console.log(`   -> ID Focaltec: ${idFocaltec}`);
    console.log(`   -> Líneas: ${orderPayload.lines?.length || 0}`);

    const response = await axios.put(
      endpoint,
      orderPayload,
      {
        headers: {
          'PDPTenantKey': apiKeys[tenantIndex],
          'PDPTenantSecret': apiSecrets[tenantIndex],
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    return {
      success: true,
      status: response.status,
      data: response.data
    };

  } catch (error) {
    let errorMessage = '';
    if (error.response) {
      errorMessage = `${error.response.status} ${error.response.statusText}: ${JSON.stringify(error.response.data)}`;
    } else {
      errorMessage = error.message;
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Update lastUpdate timestamp in FESA database
 * @param {string} poNumber - PO number
 * @param {string} database - Database identifier
 */
async function updateFESATimestamp(poNumber, database) {
  const sql = `
    UPDATE dbo.fesaOCFocaltec
    SET lastUpdate = GETDATE()
    WHERE ocSage = '${poNumber}'
      AND idDatabase = '${database}'
      AND idFocaltec IS NOT NULL
      AND status = 'POSTED'
  `;

  try {
    await runQuery(sql, 'FESA');
  } catch (error) {
    console.warn(`⚠️ [WARN] Error updating FESA timestamp: ${error.message}`);
  }
}

// Main function to handle CLI arguments
async function runPOUpdate() {
  console.log('🔄 PRUEBA DE ACTUALIZACIÓN DE ORDEN DE COMPRA');
  console.log('=============================================\n');

  // Get parameters from command line
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('❌ ERROR: Debes proporcionar al menos un número de PO');
    console.log('\n📋 Uso:');
    console.log('  node tests/PO_Update.test.js <PO_NUMBER> [DATABASE] [TENANT_INDEX] [--dry-run]');
    console.log('\n📝 Ejemplos:');
    console.log('  node tests/PO_Update.test.js PO0075624');
    console.log('  node tests/PO_Update.test.js PO0075624 COPDAT');
    console.log('  node tests/PO_Update.test.js PO0075624 COPDAT 0');
    console.log('  node tests/PO_Update.test.js PO0075624 COPDAT 0 --dry-run');
    console.log('\n📊 Parámetros:');
    console.log('  - PO_NUMBER: Número de PO a actualizar (requerido)');
    console.log('  - DATABASE: Base de datos específica (opcional)');
    console.log('  - TENANT_INDEX: Índice del tenant (opcional, default: 0)');
    console.log('  - --dry-run: Solo simula la actualización sin enviar al Portal');
    console.log('\n🔍 Proceso:');
    console.log('  1. Busca la PO en FESA para obtener el idFocaltec');
    console.log('  2. Recupera datos actualizados de Sage');
    console.log('  3. Envía actualización al Portal de Proveedores (PUT)');
    return;
  }

  const poNumber = args[0];
  let database = null;
  let tenantIndex = 0;
  let dryRun = false;

  // Parse additional parameters
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run') {
      dryRun = true;
    } else if (/^\d+$/.test(arg)) {
      tenantIndex = parseInt(arg);
    } else {
      database = arg;
    }
  }

  if (!poNumber.startsWith('PO')) {
    console.log('❌ ERROR: El número de PO debe empezar con "PO"');
    return;
  }

  console.log(`📦 Parámetros detectados:`);
  console.log(`   - PO: ${poNumber}`);
  console.log(`   - Database: ${database || 'Usar configuración por defecto'}`);
  console.log(`   - Tenant Index: ${tenantIndex}`);
  console.log(`   - Modo: ${dryRun ? 'DRY RUN (simulación)' : 'ACTUALIZACIÓN REAL'}`);
  console.log();

  try {
    const result = await testPurchaseOrderUpdate(poNumber, database, tenantIndex, dryRun);

    if (result.success) {
      console.log('\n✅ PROCESO COMPLETADO EXITOSAMENTE');
      if (result.mode === 'dry-run') {
        console.log('⚠️  RECORDATORIO: Fue una simulación, no se envió al Portal');
      } else {
        console.log('🎉 La orden fue actualizada en el Portal de Proveedores');
      }
    } else {
      console.log(`\n❌ PROCESO FALLÓ: ${result.error}`);
    }

  } catch (error) {
    console.error('\n❌ ERROR EN EL PROCESO:', error.message);
    logGenerator('PO_Update', 'error', `Error en proceso principal: ${error.message}`);
  }
}

// Export functions for use in other files
module.exports = {
  testPurchaseOrderUpdate,
  searchPOInFESA,
  retrieveFromSage,
  updatePOInPortal,
  updateFESATimestamp,
  runPOUpdate
};

// Execute if file is run directly
if (require.main === module) {
  runPOUpdate().catch(console.error);
}