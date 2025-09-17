const axios = require('axios');
const dotenv = require('dotenv');

// carga las credenciales del portal de proveedores
const creds = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const {
  TENANT_ID,
  API_KEY,
  API_SECRET,
  URL,
  DATABASES,
  EXTERNAL_IDS
} = creds;

// utilerías
const { runQuery } = require('../utils/SQLServerConnection');
const { groupOrdersByNumber } = require('../utils/OC_GroupOrdersByNumber');
const { parseExternPurchaseOrders } = require('../utils/parseExternPurchaseOrders');
const { validateExternPurchaseOrder } = require('../models/PurchaseOrder');
const { logGenerator } = require('../utils/LogGenerator');

// preparamos arrays de tenants/keys/etc.
const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const databases = DATABASES.split(',');
const externalId = EXTERNAL_IDS.split(',');

const urlBase = (index) => `${URL}/api/1.0/batch/tenants/${tenantIds[index]}`;

// Función específica para carga inicial con timeout extendido
async function createInitialLoadPurchaseOrders(index) {
  const logFileName = 'PortalOC_CargaInicial';
  
  console.log(`[INFO] Iniciando carga inicial para base de datos: ${databases[index]}`);
  logGenerator(logFileName, 'info', `Iniciando carga inicial para base de datos: ${databases[index]}`);
  
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
       FROM ${databases[index]}.dbo.CSOPTFD
      WHERE OPTFIELD = 'METODOPAGO'
        AND VALUE    = E2.[VALUE]
    ), 2
  )                                            as [CFDI_PAYMENT_FORM],
  ''                                           as [CFDI_PAYMENT_METHOD],
  RTRIM(C2.[VALUE])                            as [CFDI_USE],
  RTRIM(A.DESCRIPTIO) + ' ' + RTRIM(A.COMMENT) as [COMMENTS],
  '${externalId[index]}'                                 as [COMPANY_EXTERNAL_ID],
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
  and A.[DATE] between '20250101' and '20251231'
  and B.SQOUTSTAND > 0 
  and B.COMPLETION = 1
  -- Excluir órdenes ya registradas en FESA (POSTED, ERROR, EN_PROCESO)
  and A.PONUMBER NOT IN (
    SELECT ocSage 
    FROM dbo.fesaOCFocaltec 
    WHERE idDatabase = '${databases[index]}'
      AND status IN ('POSTED', 'ERROR', 'EN_PROCESO')
  )
order by A.PONUMBER, B.PORLREV;
`;

  //TODO: Si los metadata values vienen vacios mandar un none 
  let recordset;
  try {
    ({ recordset } = await runQuery(sql, databases[index]));
    console.log(`[INFO] [CARGA INICIAL] Recuperadas ${recordset.length} filas de la base`);
    logGenerator(logFileName, 'info', `Recuperadas ${recordset.length} filas de la base ${databases[index]}`);
  } catch (dbErr) {
    console.error('[ERROR] [CARGA INICIAL] Error al ejecutar la consulta SQL:', dbErr);
    logGenerator(logFileName, 'error', `Error al ejecutar la consulta SQL para ${databases[index]}: ${dbErr.message}`);
    return;
  }

  // 3) Agrupar y parsear al formato de envío
  const grouped = groupOrdersByNumber(recordset);
  const ordersToSend = parseExternPurchaseOrders(grouped);

  console.log(`[INFO] [CARGA INICIAL] Procesando ${ordersToSend.length} órdenes de compra...`);
  logGenerator(logFileName, 'info', `Procesando ${ordersToSend.length} órdenes de compra para ${databases[index]}`);

  // 4) Validar y preparar órdenes para envío en batch
  const validOrders = [];
  const invalidOrders = [];

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
      console.log(`[WARN] [${i + 1}/${ordersToSend.length}] PO ${po.external_id} ya procesada (POSTED), se omite.`);
      logGenerator(logFileName, 'warn', `PO ${po.external_id} ya procesada (POSTED), se omite. Base: ${databases[index]}`);
      continue;
    }

    // 4.2) Limpiar placeholders
    if (po.cfdi_payment_method === '') delete po.cfdi_payment_method;
    if (po.requisition_number === 0) delete po.requisition_number;

    // 4.3) Validar con Joi
    try {
      validateExternPurchaseOrder(po);
      console.log(`[OK] [${i + 1}/${ordersToSend.length}] PO ${po.external_id} pasó validación Joi`);
      validOrders.push(po);
    } catch (valErr) {
      console.error(`[ERROR] Joi validation failed for PO ${po.external_id}:`);
      valErr.details.forEach(d => console.error(`   -> ${d.message}`));
      logGenerator(logFileName, 'error', `Joi validation failed for PO ${po.external_id}: ${valErr.details.map(d => d.message).join('; ')} - Base: ${databases[index]}`);
      
      invalidOrders.push({
        po: po,
        error: valErr.details.map(d => d.message).join('; ')
      });
    }
  }

  // 4.4) Registrar órdenes inválidas en base de datos
  for (const invalid of invalidOrders) {
    const sqlErr = `
      INSERT INTO dbo.fesaOCFocaltec
        (idFocaltec, ocSage, status, lastUpdate, createdAt, responseAPI, idDatabase)
      VALUES
        ('',
         '${invalid.po.external_id}',
         'ERROR',
         GETDATE(),
         GETDATE(),
         '${invalid.error}',
         '${databases[index]}'
        )
    `;
    await runQuery(sqlErr, 'FESA');
    logGenerator(logFileName, 'error', `Orden inválida registrada: ${invalid.po.external_id} - Error: ${invalid.error} - Base: ${databases[index]}`);
  }

  // 4.5) Enviar órdenes válidas en batch si hay alguna
  if (validOrders.length > 0) {
    console.log(`[INFO] [CARGA INICIAL] Enviando batch de ${validOrders.length} órdenes de compra...`);
    console.log('[DEBUG] POs en batch:', validOrders.map(po => po.external_id).join(', '));
    logGenerator(logFileName, 'info', `Enviando batch de ${validOrders.length} órdenes de compra para ${databases[index]}. POs: ${validOrders.map(po => po.external_id).join(', ')}`);

    const endpoint = `${urlBase(index)}/purchase-orders`;
    try {
      const resp = await axios.put(
        endpoint,
        { purchase_orders: validOrders }, // Enviar como objeto con propiedad purchase_orders
        {
          headers: {
            'PDPTenantKey': apiKeys[index],
            'PDPTenantSecret': apiSecrets[index],
            'Content-Type': 'application/json'
          },
          timeout: 300000 // 5 minutos de timeout para carga inicial
        }
      );
      
      console.log(
        `[INFO] [CARGA INICIAL] Batch de ${validOrders.length} órdenes enviado exitosamente\n` +
        `   -> Status: ${resp.status} ${resp.statusText}`
      );
      logGenerator(logFileName, 'info', `Batch de ${validOrders.length} órdenes enviado exitosamente para ${databases[index]}. Status: ${resp.status} ${resp.statusText}`);

      // 4.6) Procesar respuesta del batch
      if (resp.data && resp.data.type === 'ASYNC') {
        // Respuesta asíncrona - registrar órdenes como EN_PROCESO
        console.log(`[INFO] [CARGA INICIAL] Batch procesado de forma asíncrona (ID: ${resp.data.id})`);
        console.log(`[WARN] [CARGA INICIAL] Las órdenes se están procesando de forma asíncrona. Se marcarán como EN_PROCESO.`);
        console.log(`[INFO] [CARGA INICIAL] ID del batch asíncrono: ${resp.data.id}`);
        
        logGenerator(logFileName, 'warn', `Batch asíncrono iniciado para ${databases[index]}. ID: ${resp.data.id}. ${validOrders.length} órdenes en proceso.`);
        
        // Registrar todas las órdenes como EN_PROCESO con el ID del batch asíncrono
        for (const po of validOrders) {
          const sqlPending = `
            INSERT INTO dbo.fesaOCFocaltec
              (idFocaltec, ocSage, status, lastUpdate, createdAt, responseAPI, idDatabase)
            VALUES
              ('${resp.data.id}',
               '${po.external_id.replace(/'/g, "''")}',
               'EN_PROCESO',
               GETDATE(),
               GETDATE(),
               'ASYNC_BATCH_PROCESSING',
               '${databases[index]}'
              )
          `;
          await runQuery(sqlPending, 'FESA');
        }
        
        console.log(`[WARN] [CARGA INICIAL] ${validOrders.length} órdenes marcadas como EN_PROCESO.`);
        console.log(`[INFO] [CARGA INICIAL] IMPORTANTE: Debe implementar consulta posterior al batch ID: ${resp.data.id}`);
        
      } else if (resp.data && resp.data.orders_status && resp.data.orders_status.length > 0) {
        // Respuesta síncrona con detalles por orden
        console.log(`[INFO] [CARGA INICIAL] Procesando respuesta síncrona de ${resp.data.orders_status.length} órdenes...`);
        
        for (const orderStatus of resp.data.orders_status) {
          const po = validOrders.find(order => order.external_id === orderStatus.external_id);
          if (!po) {
            console.warn(`[WARN] No se encontró orden local para external_id: ${orderStatus.external_id}`);
            continue;
          }

          if (orderStatus.status === 'ERROR') {
            // Orden con errores
            const errors = orderStatus.errors.map(err => 
              `${err.error_code}: ${err.error_message}`
            ).join('; ');
            
            console.error(`[ERROR] PO ${po.external_id} falló: ${errors}`);
            logGenerator(logFileName, 'error', `PO ${po.external_id} falló en batch: ${errors} - Base: ${databases[index]}`);
            
            const sqlErr = `
              INSERT INTO dbo.fesaOCFocaltec
                (idFocaltec, ocSage, status, lastUpdate, createdAt, responseAPI, idDatabase)
              VALUES
                (NULL,
                 '${po.external_id.replace(/'/g, "''")}',
                 'ERROR',
                 GETDATE(),
                 GETDATE(),
                 '${errors.replace(/'/g, "''")}',
                 '${databases[index]}'
                )
            `;
            await runQuery(sqlErr, 'FESA');
          } else {
            // Orden exitosa
            const idFocaltec = orderStatus.internal_id || orderStatus.id || `SYNC_${orderStatus.external_id}`;
            
            console.log(`[OK] PO ${po.external_id} procesada exitosamente (ID: ${idFocaltec})`);
            logGenerator(logFileName, 'info', `PO ${po.external_id} procesada exitosamente con ID: ${idFocaltec} - Base: ${databases[index]}`);
            
            const sqlOk = `
              INSERT INTO dbo.fesaOCFocaltec
                (idFocaltec, ocSage, status, lastUpdate, createdAt, responseAPI, idDatabase)
              VALUES
                ('${idFocaltec}',
                 '${po.external_id.replace(/'/g, "''")}',
                 'POSTED',
                 GETDATE(),
                 GETDATE(),
                 'SYNC_SUCCESS',
                 '${databases[index]}'
                )
            `;
            await runQuery(sqlOk, 'FESA');
          }
        }
      } else {
        // Respuesta sin información clara - no registrar nada para evitar duplicados
        console.warn(`[WARN] [CARGA INICIAL] Respuesta de API sin información clara sobre el estado de las órdenes`);
        console.warn(`[WARN] [CARGA INICIAL] No se registrarán las órdenes para evitar duplicados`);
        logGenerator(logFileName, 'warn', `Respuesta ambigua de API para ${databases[index]}. No se registraron órdenes para evitar duplicados.`);
      }

    } catch (err) {
      console.error(`[ERROR] [CARGA INICIAL] Error enviando batch de ${validOrders.length} órdenes:`);
      logGenerator(logFileName, 'error', `Error enviando batch de ${validOrders.length} órdenes para ${databases[index]}: ${err.message}`);
      let respAPI;
      if (err.response) {
        console.error(`   -> Status: ${err.response.status} ${err.response.statusText}`);
        console.error(`   -> Body:`, err.response.data);
        
        // Manejar diferentes tipos de errores del API
        if (err.response.data && err.response.data.code && err.response.data.description) {
          // Error tipo: {"code": 9005, "description": "...", "other": "Batch API"}
          respAPI = `CODE_${err.response.data.code}: ${err.response.data.description}`;
        } else if (err.response.data && typeof err.response.data === 'string') {
          respAPI = `HTTP_${err.response.status}: ${err.response.data}`;
        } else {
          respAPI = `HTTP_${err.response.status}: ${err.response.statusText}`;
        }
      } else if (err.code === 'ECONNABORTED') {
        console.error('   -> Timeout del servidor.');
        respAPI = 'TIMEOUT: La petición excedió el tiempo límite';
      } else {
        console.error('   -> Error de conexión o red.');
        respAPI = `NETWORK_ERROR: ${err.message}`;
      }

      // 4.7) Registrar todas las órdenes como ERROR si falla el batch
      for (const po of validOrders) {
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
  } else {
    console.log('[INFO] [CARGA INICIAL] No hay órdenes válidas para enviar.');
    logGenerator(logFileName, 'info', `No hay órdenes válidas para enviar en ${databases[index]}`);
  }
}

// Función principal para ejecutar desde terminal
async function main() {
  const logFileName = 'PortalOC_CargaInicial';
  
  console.log('[INFO] [CARGA INICIAL] Iniciando procesamiento de órdenes de compra...');
  logGenerator(logFileName, 'info', 'Iniciando procesamiento completo de carga inicial para todas las bases de datos');
  
  try {
    // Procesar todas las bases de datos configuradas
    for (let i = 0; i < databases.length; i++) {
      console.log(`\n[INFO] [CARGA INICIAL] Procesando base de datos ${i + 1}/${databases.length}: ${databases[i]}`);
      logGenerator(logFileName, 'info', `Iniciando procesamiento de base de datos ${i + 1}/${databases.length}: ${databases[i]}`);
      
      await createInitialLoadPurchaseOrders(i);
      
      console.log(`[SUCCESS] [CARGA INICIAL] Finalizado procesamiento para ${databases[i]}`);
      logGenerator(logFileName, 'info', `Finalizado procesamiento para ${databases[i]}`);
    }
    
    console.log('\n[SUCCESS] [CARGA INICIAL] Procesamiento completo de todas las bases de datos.');
    logGenerator(logFileName, 'info', 'Procesamiento completo de todas las bases de datos finalizado exitosamente');
  } catch (error) {
    console.error('[ERROR] [CARGA INICIAL] Error durante el procesamiento:', error);
    logGenerator(logFileName, 'error', `Error fatal durante el procesamiento: ${error.message}`);
    process.exit(1);
  }
}

// Ejecutar solo si el archivo se ejecuta directamente desde terminal
if (require.main === module) {
  main().catch(error => {
    console.error('[ERROR] [CARGA INICIAL] Error fatal:', error);
    process.exit(1);
  });
}

module.exports = {
  createInitialLoadPurchaseOrders,
  main
}