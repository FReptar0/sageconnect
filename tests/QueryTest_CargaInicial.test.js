const dotenv = require('dotenv');
const fs = require('fs').promises;
const path = require('path');

// Cargar configuraciones
const creds = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const pathEnv = dotenv.config({ path: '.env.path' }).parsed;

const {
  DATABASES,
  EXTERNAL_IDS
} = creds;

// Utilerías
const { runQuery } = require('../src/utils/SQLServerConnection');
const { groupOrdersByNumber } = require('../src/utils/OC_GroupOrdersByNumber');
const { parseExternPurchaseOrders } = require('../src/utils/parseExternPurchaseOrders');
const { validateExternPurchaseOrder } = require('../src/models/PurchaseOrder');
const { logGenerator } = require('../src/utils/LogGenerator');

// Preparar arrays
const databases = DATABASES.split(',');
const externalId = EXTERNAL_IDS.split(',');

// Función para formatear JSON de manera legible
function formatJSON(obj) {
  return JSON.stringify(obj, null, 2);
}

// Función para guardar archivo JSON
async function saveJSONFile(data, filename, basePath) {
  try {
    const filePath = path.join(basePath, filename);
    await fs.writeFile(filePath, formatJSON(data), 'utf8');
    console.log(`[INFO] Archivo JSON guardado: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error(`[ERROR] Error guardando archivo JSON ${filename}:`, error);
    throw error;
  }
}

// Función principal de prueba
async function testCargaInicialQuery(databaseIndex = 0) {
  const logFileName = 'QueryTest_CargaInicial';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  
  console.log(`[INFO] ========================================`);
  console.log(`[INFO] INICIO DE PRUEBA DE QUERY CARGA INICIAL`);
  console.log(`[INFO] ========================================`);
  console.log(`[INFO] Base de datos: ${databases[databaseIndex]} (índice ${databaseIndex})`);
  console.log(`[INFO] Timestamp: ${timestamp}`);
  
  logGenerator(logFileName, 'info', `Iniciando prueba de query para base de datos: ${databases[databaseIndex]}`);

  // Query original del archivo PortalOC_CreationBatch.js
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
       FROM ${databases[databaseIndex]}.dbo.CSOPTFD
      WHERE OPTFIELD = 'METODOPAGO'
        AND VALUE    = E2.[VALUE]
    ), 2
  )                                            as [CFDI_PAYMENT_FORM],
  ''                                           as [CFDI_PAYMENT_METHOD],
  UPPER(RTRIM(C2.[VALUE]))                     as [CFDI_USE],
  RTRIM(A.DESCRIPTIO) + ' ' + RTRIM(A.COMMENT) as [COMMENTS],
  '${externalId[databaseIndex]}'                       as [COMPANY_EXTERNAL_ID],
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
  B.SQOUTSTAND                                 as [LINES_QUANTITY],
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
from ${databases[databaseIndex]}.dbo.POPORH1 A
left outer join ${databases[databaseIndex]}.dbo.POPORH2 A1
  on A.PORHSEQ = A1.PORHSEQ
left outer join ${databases[databaseIndex]}.dbo.POPORL B
  on A.PORHSEQ = B.PORHSEQ
left outer join ${databases[databaseIndex]}.dbo.POPORHO C1
  on A.PORHSEQ = C1.PORHSEQ
 and C1.OPTFIELD = 'AFE'
left outer join ${databases[databaseIndex]}.dbo.POPORHO C2
  on A.PORHSEQ = C2.PORHSEQ
 and C2.OPTFIELD = 'USOCFDI'
left outer join ${databases[databaseIndex]}.dbo.APVEN D
  on A.VDCODE = D.VENDORID
left outer join ${databases[databaseIndex]}.dbo.APVENO E1
  on D.VENDORID = E1.VENDORID
 and E1.OPTFIELD = 'FORMAPAGO'
left outer join ${databases[databaseIndex]}.dbo.APVENO E2
  on D.VENDORID = E2.VENDORID
 and E2.OPTFIELD = 'METODOPAGO'
left outer join ${databases[databaseIndex]}.dbo.APVENO E3
  on D.VENDORID = E3.VENDORID
 and E3.OPTFIELD = 'PROVIDERID'
left outer join ${databases[databaseIndex]}.dbo.ICLOC F
  on B.[LOCATION] = F.[LOCATION]
left outer join Autorizaciones_electronicas.dbo.Autoriza_OC X
  on A.PONUMBER = X.PONumber
where
  X.Autorizada = 1
  and X.Empresa = '${databases[databaseIndex]}'
  and A.[DATE] between '20250101' and '20251231'
  and B.SQOUTSTAND > 0 
  and B.COMPLETION = 1
order by A.PONUMBER, B.PORLREV;
`;

  console.log(`[INFO] Ejecutando query en base de datos: ${databases[databaseIndex]}`);
  logGenerator(logFileName, 'info', `Ejecutando query en base de datos: ${databases[databaseIndex]}`);

  // 1) Ejecutar query
  let recordset;
  try {
    ({ recordset } = await runQuery(sql, databases[databaseIndex]));
    console.log(`[INFO] Query ejecutada exitosamente. Filas obtenidas: ${recordset.length}`);
    logGenerator(logFileName, 'info', `Query ejecutada exitosamente. Filas obtenidas: ${recordset.length}`);
  } catch (dbErr) {
    console.error('[ERROR] Error al ejecutar la consulta SQL:', dbErr);
    logGenerator(logFileName, 'error', `Error al ejecutar la consulta SQL: ${dbErr.message}`);
    return;
  }

  // 2) Guardar datos raw de la query
  const rawDataPath = await saveJSONFile(
    recordset, 
    `${timestamp}_raw_data_${databases[databaseIndex]}.json`,
    pathEnv.LOG_PATH + 'sageconnect/'
  );

  // 3) Agrupar por número de orden
  console.log(`[INFO] Agrupando filas por número de orden...`);
  const grouped = groupOrdersByNumber(recordset);
  console.log(`[INFO] Órdenes agrupadas: ${Object.keys(grouped).length}`);
  logGenerator(logFileName, 'info', `Órdenes agrupadas: ${Object.keys(grouped).length}`);

  // Guardar datos agrupados
  await saveJSONFile(
    grouped,
    `${timestamp}_grouped_data_${databases[databaseIndex]}.json`,
    pathEnv.LOG_PATH + 'sageconnect/'
  );

  // 4) Parsear al formato del portal
  console.log(`[INFO] Parseando órdenes al formato del portal...`);
  const ordersToSend = parseExternPurchaseOrders(grouped);
  console.log(`[INFO] Órdenes parseadas: ${ordersToSend.length}`);
  logGenerator(logFileName, 'info', `Órdenes parseadas: ${ordersToSend.length}`);

  // Guardar datos parseados
  await saveJSONFile(
    ordersToSend,
    `${timestamp}_parsed_orders_${databases[databaseIndex]}.json`,
    pathEnv.LOG_PATH + 'sageconnect/'
  );

  // 5) Validar órdenes y verificar control FESA
  console.log(`[INFO] Validando órdenes con Joi y verificando control FESA...`);
  const validationResults = {
    valid: [],
    invalid: [],
    alreadyProcessed: [],
    summary: {
      total: ordersToSend.length,
      valid: 0,
      invalid: 0,
      alreadyProcessed: 0,
      errors: {}
    }
  };

  for (let i = 0; i < ordersToSend.length; i++) {
    const po = ordersToSend[i];
    
    console.log(`[INFO] [${i + 1}/${ordersToSend.length}] Validando PO: ${po.external_id}`);
    
    // 5.1) Verificar si ya existe en fesaOCFocaltec
    const checkSql = `
      SELECT idFocaltec, status, responseAPI, lastUpdate
      FROM dbo.fesaOCFocaltec
      WHERE ocSage    = '${po.external_id}'
        AND idDatabase= '${databases[databaseIndex]}'
        AND idFocaltec IS NOT NULL
        AND status = 'POSTED'
    `;
    
    try {
      const { recordset: existing } = await runQuery(checkSql, 'FESA');
      if (existing.length > 0) {
        console.log(`[WARN] [${i + 1}/${ordersToSend.length}] PO ${po.external_id} ya procesada (POSTED), se omite.`);
        logGenerator(logFileName, 'warn', `PO ${po.external_id} ya procesada (POSTED), se omite. Base: ${databases[databaseIndex]}`);
        
        validationResults.alreadyProcessed.push({
          po: po,
          controlInfo: existing[0]
        });
        validationResults.summary.alreadyProcessed++;
        continue;
      }
    } catch (controlErr) {
      console.error(`[ERROR] Error verificando control FESA para PO ${po.external_id}:`, controlErr);
      logGenerator(logFileName, 'error', `Error verificando control FESA para PO ${po.external_id}: ${controlErr.message}`);
      // Continuar con la validación aunque falle la verificación de control
    }
    
    // 5.2) Limpiar placeholders como en el código original
    if (po.cfdi_payment_method === '') delete po.cfdi_payment_method;
    if (po.requisition_number === 0) delete po.requisition_number;

    // 5.3) Validar con Joi
    try {
      validateExternPurchaseOrder(po);
      console.log(`[OK] [${i + 1}/${ordersToSend.length}] PO ${po.external_id} pasó validación`);
      validationResults.valid.push(po);
      validationResults.summary.valid++;
    } catch (valErr) {
      const errors = valErr.details.map(d => d.message);
      console.error(`[ERROR] [${i + 1}/${ordersToSend.length}] PO ${po.external_id} falló validación:`);
      errors.forEach(err => console.error(`   -> ${err}`));
      
      validationResults.invalid.push({
        po: po,
        errors: errors
      });
      validationResults.summary.invalid++;
      
      // Contar tipos de errores
      errors.forEach(err => {
        if (!validationResults.summary.errors[err]) {
          validationResults.summary.errors[err] = 0;
        }
        validationResults.summary.errors[err]++;
      });
      
      logGenerator(logFileName, 'error', `PO ${po.external_id} falló validación: ${errors.join('; ')}`);
    }
  }

  // Guardar resultados de validación
  await saveJSONFile(
    validationResults,
    `${timestamp}_validation_results_${databases[databaseIndex]}.json`,
    pathEnv.LOG_PATH + 'sageconnect/'
  );

  // 6) Mostrar resumen final
  console.log(`\n[INFO] ========================================`);
  console.log(`[INFO] RESUMEN FINAL`);
  console.log(`[INFO] ========================================`);
  console.log(`[INFO] Base de datos: ${databases[databaseIndex]}`);
  console.log(`[INFO] Filas de SQL: ${recordset.length}`);
  console.log(`[INFO] Órdenes agrupadas: ${Object.keys(grouped).length}`);
  console.log(`[INFO] Órdenes parseadas: ${ordersToSend.length}`);
  console.log(`[INFO] Órdenes válidas: ${validationResults.summary.valid}`);
  console.log(`[INFO] Órdenes inválidas: ${validationResults.summary.invalid}`);
  console.log(`[INFO] Órdenes ya procesadas: ${validationResults.summary.alreadyProcessed}`);
  console.log(`[INFO] ========================================`);

  if (validationResults.summary.invalid > 0) {
    console.log(`[INFO] ERRORES MÁS COMUNES:`);
    Object.entries(validationResults.summary.errors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([error, count]) => {
        console.log(`[INFO]   ${count}x: ${error}`);
      });
    console.log(`[INFO] ========================================`);
  }

  // Mostrar algunas órdenes válidas como ejemplo
  if (validationResults.valid.length > 0) {
    console.log(`[INFO] EJEMPLO DE ÓRDENES VÁLIDAS (primeras 3):`);
    validationResults.valid.slice(0, 3).forEach((order, index) => {
      console.log(`[INFO] ${index + 1}. PO: ${order.external_id} - Total: ${order.total} ${order.currency} - Líneas: ${order.lines.length}`);
    });
    console.log(`[INFO] ========================================`);
  }

  // Mostrar algunas órdenes ya procesadas como ejemplo
  if (validationResults.alreadyProcessed.length > 0) {
    console.log(`[INFO] EJEMPLO DE ÓRDENES YA PROCESADAS (primeras 3):`);
    validationResults.alreadyProcessed.slice(0, 3).forEach((item, index) => {
      const order = item.po;
      const control = item.controlInfo;
      console.log(`[INFO] ${index + 1}. PO: ${order.external_id} - ID Focaltec: ${control.idFocaltec} - Última actualización: ${control.lastUpdate}`);
    });
    console.log(`[INFO] ========================================`);
  }

  logGenerator(logFileName, 'info', `Prueba completada. Válidas: ${validationResults.summary.valid}, Inválidas: ${validationResults.summary.invalid}, Ya procesadas: ${validationResults.summary.alreadyProcessed}`);
  
  console.log(`[SUCCESS] Prueba completada exitosamente`);
  console.log(`[INFO] Archivos JSON guardados en: ${pathEnv.LOG_PATH}sageconnect/`);
}

// Función para probar todas las bases de datos
async function testAllDatabases() {
  console.log(`[INFO] Iniciando prueba para todas las bases de datos (${databases.length} total)`);
  
  for (let i = 0; i < databases.length; i++) {
    console.log(`\n[INFO] ==========================================`);
    console.log(`[INFO] PROCESANDO BASE ${i + 1}/${databases.length}`);
    console.log(`[INFO] ==========================================`);
    
    try {
      await testCargaInicialQuery(i);
    } catch (error) {
      console.error(`[ERROR] Error procesando base ${databases[i]}:`, error);
    }
    
    // Pausa entre bases de datos
    if (i < databases.length - 1) {
      console.log(`[INFO] Pausa de 2 segundos antes de la siguiente base...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log(`\n[SUCCESS] Prueba completada para todas las bases de datos`);
}

// Ejecutar si se llama directamente
if (require.main === module) {
  // Obtener índice de base de datos desde argumentos de línea de comandos
  const args = process.argv.slice(2);
  const dbIndex = args[0];
  
  if (dbIndex === 'all') {
    testAllDatabases().catch(error => {
      console.error('[ERROR] Error en prueba completa:', error);
      process.exit(1);
    });
  } else if (dbIndex !== undefined) {
    const index = parseInt(dbIndex);
    if (isNaN(index) || index < 0 || index >= databases.length) {
      console.error(`[ERROR] Índice de base de datos inválido: ${dbIndex}`);
      console.log(`[INFO] Bases disponibles (0-${databases.length - 1}): ${databases.join(', ')}`);
      process.exit(1);
    }
    
    testCargaInicialQuery(index).catch(error => {
      console.error('[ERROR] Error en prueba:', error);
      process.exit(1);
    });
  } else {
    // Por defecto usar la primera base de datos
    testCargaInicialQuery(0).catch(error => {
      console.error('[ERROR] Error en prueba:', error);
      process.exit(1);
    });
  }
}

module.exports = {
  testCargaInicialQuery,
  testAllDatabases
};