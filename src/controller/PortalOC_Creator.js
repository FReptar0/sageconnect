const portalClient = require('../utils/PortalClient');
const config = require('../config');

// Variables de configuracion de direcciones por defecto para ordenes de compra
// Estas variables se usan cuando la tabla ICLOC no tiene datos de direccion para una ubicacion
const DEFAULT_ADDRESS_CITY = config.app.defaultAddress.city;
const DEFAULT_ADDRESS_COUNTRY = config.app.defaultAddress.country;
const DEFAULT_ADDRESS_IDENTIFIER = config.app.defaultAddress.identifier;
const DEFAULT_ADDRESS_MUNICIPALITY = config.app.defaultAddress.municipality;
const DEFAULT_ADDRESS_STATE = config.app.defaultAddress.state;
const DEFAULT_ADDRESS_STREET = config.app.defaultAddress.street;
const DEFAULT_ADDRESS_ZIP = config.app.defaultAddress.zip;

// utilerias
const { runQuery } = require('../utils/SQLServerConnection');
const { getCurrentDateString } = require('../utils/TimezoneHelper');
const { logGenerator } = require('../utils/LogGenerator');
const { groupOrdersByNumber } = require('../utils/OC_GroupOrdersByNumber');
const { parseExternPurchaseOrders } = require('../utils/parseExternPurchaseOrders');
const { validateExternPurchaseOrder } = require('../models/PurchaseOrder');
const { buildScopeWhere, buildErrorStatsApply, getRetryIntervalMinutes, computeRetryEligibility } = require('../utils/RetryPolicy');
const { getPurchaseOrderByExternalId } = require('../utils/GetPurchaseOrders');

// preparamos arrays de tenants/keys/etc.
const tenantIds = config.portal.tenants.map(t => t.id);
const apiKeys = config.portal.tenants.map(t => t.key);
const apiSecrets = config.portal.tenants.map(t => t.secret);
const databases = config.portal.tenants.map(t => t.database);
const externalId = config.portal.tenants.map(t => t.externalId);

const urlBase = (index) => `${config.portal.url}/api/1.0/extern/tenants/${tenantIds[index]}`;

async function createPurchaseOrders(index) {
  const today = getCurrentDateString(); // 'YYYY-MM-DD'
  const logFileName = 'PortalOC_Creator';
  
  console.log(`[INICIO] Ejecutando proceso de creación de órdenes de compra - Tenant: ${tenantIds[index]} - Fecha: ${today}`);
  
  // Preparar filtro de ubicaciones a omitir
  const skipIdentifiers = config.app.addressIdentifiersSkip.filter(id => id.length > 0);
  const skipCondition = skipIdentifiers.length > 0 
    ? `AND B.[LOCATION] NOT IN (${skipIdentifiers.map(id => `'${id}'`).join(',')})` 
    : '';
  
  if (skipIdentifiers.length > 0) {
    console.log(`[INFO] Omitiendo ubicaciones: ${skipIdentifiers.join(', ')}`);
    logGenerator(logFileName, 'info', `[INFO] Ubicaciones omitidas: ${skipIdentifiers.join(', ')}`);
  }
  
  // 1) Ejecuta tu consulta a DATABASE para los dos POs

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
  )                                            as [WITHHOLD_TAX_SUM],
  -- RETRY-D3: se proyecta SOLO errorCount. lastErrorAt del OUTER APPLY sigue sin proyectarse:
  -- es MAX(lastUpdate) sobre una columna date, bloqueado por CR-04 / D-ITEM-03. Alias en
  -- camelCase adrede: row.errorCount se lee abajo (attempts=) y en 20.3-03 gatea el chequeo.
  ef.errorCount                                AS errorCount,
  -- D-01: reloj único. Sale del MISMO SELECT que lastErrorAt, así que la reinterpretación de
  -- zona horaria del driver aplica a ambos operandos y se cancela en la resta. D-05: GETDATE()
  -- es constante de runtime por statement, así que todas las filas del tick comparten un dbNow.
  -- El alias va en camelCase a propósito — el resto de este archivo usa MAYÚSCULAS, pero el
  -- lado JS lee row.dbNow y la misma clave se usa en los cinco call sites de la fase.
  GETDATE()                                    as [dbNow]
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
${buildErrorStatsApply({ fesaTable: 'fesa.dbo.fesaOCFocaltec', joinColumn: 'ocSage', joinKey: 'A.PONUMBER', dbAlias: databases[index], dbColumn: 'idDatabase', timestampColumn: 'lastUpdate' })}
where
  X.Autorizada = 1
  and X.Empresa = '${databases[index]}'
  AND ${buildScopeWhere(config.retry, { dateField: '(SELECT MAX(Fecha) FROM Autorizaciones_electronicas.dbo.Autoriza_OC_detalle WHERE Empresa = \'' + databases[index] + '\' AND PONumber = A.PONUMBER)' })}
  AND NOT EXISTS (
    SELECT 1 FROM fesa.dbo.fesaOCFocaltec
    WHERE ocSage = A.PONUMBER
      AND idDatabase = '${databases[index]}'
      AND status IN ('CLOSED', 'POSTED')
  )
  ${skipCondition}
order by A.PONUMBER, B.PORLREV;
`;

  //TODO: Si los metadata values vienen vacios mandar un none 
  let recordset;
  try {
    ({ recordset } = await runQuery(sql, databases[index]));
    console.log(`[INFO] Recuperadas ${recordset.length} filas de la base`);
    logGenerator(logFileName, 'info', `[INFO] Iniciando createPurchaseOrders para index=${index}. Total de registros recuperados: ${recordset.length}`);
  } catch (dbErr) {
    console.error('❌ Error al ejecutar la consulta SQL:', dbErr);
    logGenerator(logFileName, 'error', `[ERROR] Error al ejecutar la consulta SQL en index=${index}: ${dbErr.message}`);
    return;
  }

  // RETRY-C4 (D-01, D-04, D-05): JS post-filter de reintentos con intervalo fijo.
  // El OUTER APPLY ef trajo errorCount + lastErrorAt por fila; se difieren las filas
  // cuyo último ERROR aún no cumple el intervalo de la OC (config.retry.interval.po).
  // La regla de elegibilidad vive completa en computeRetryEligibility — incluida la de
  // "primer intento" (sin lastErrorAt => elegible ya): no se replica aquí para que no
  // pueda divergir entre los dos controladores y el diagnóstico. errorCount ya no
  // interviene en el cálculo (D-04); sobrevive solo como contexto de operador (attempts=).
  //
  // 20.2 D-01: `now` ya NO es el reloj del proceso Node — se toma del dbNow que proyecta el
  // mismo SELECT que produjo lastErrorAt, resuelto una sola vez por lote (D-05). Medido el
  // 2026-07-27 en el host SQL desplegado: DATEDIFF(mi, GETUTCDATE(), GETDATE()) = -360, seis
  // horas — más que ambos intervalos configurados (240 OC, 30 pago), así que con el reloj de
  // Node toda fila candidata salía elegible siempre y el log de diferimiento por fila
  // (etiqueta RETRY-DEFER) no podía dispararse nunca.
  const candidatesCount = recordset.length;
  const dbNow = candidatesCount > 0 ? recordset[0].dbNow : null;
  // Una sola línea por tick, nunca por fila (CLAUDE.md §3): el helper no puede distinguir un
  // dbNow ausente de una omisión deliberada, así que la condición se vuelve grepeable.
  if (candidatesCount > 0 && !dbNow) {
    logGenerator(logFileName, 'warn',
      `[RETRY-CLOCK] tenant=${databases[index]} dbNow=missing fallback=node-clock`);
  }
  const intervalMin = getRetryIntervalMinutes(config.retry.interval, 'po');
  const deferred = [];
  recordset = recordset.filter((row) => {
    const { eligible, nextEligibleAt } = computeRetryEligibility({
      lastErrorAt: row.lastErrorAt,
      intervalMinutes: intervalMin,
      now: dbNow,
    });
    if (!eligible) {
      deferred.push({ id: row.EXTERNAL_ID, attempts: row.errorCount || 0, nextEligibleAt });
      return false;
    }
    return true;
  });
  // Por fila diferida: entrada [RETRY-DEFER] (operadores buscan un PO específico)
  deferred.forEach((d) => {
    logGenerator(logFileName, 'info',
      `[RETRY-DEFER] PO ${d.id} tenant=${databases[index]} attempts=${d.attempts} nextEligibleAt=${d.nextEligibleAt.toISOString()}`);
  });
  // Resumen [RETRY] por tick (operadores buscan la métrica agregada)
  logGenerator(logFileName, 'info',
    `[RETRY] tenant=${databases[index]} candidates=${candidatesCount} deferred=${deferred.length} processing=${recordset.length}`);
  // ROADMAP SC4: línea observable por tick — confirma que un cambio de RETRY_SCOPE surtió efecto.
  const retryWindow = config.retry.scope === 'last_n_days'
    ? `last ${config.retry.lookbackDays} days`
    : 'current calendar month';
  logGenerator(logFileName, 'info',
    `[CRON] retry-scope=${config.retry.scope} window=${retryWindow}`);

  // RETRY-D4 (D-02): lookup de errorCount por OC, construido desde el recordset YA post-filtrado
  // (recordset se reasigna arriba), que es exactamente el conjunto que se vuelve ordersToSend.
  // Por qué un Map y no pasar el valor por parámetro: errorCount se destruye dos veces aguas
  // abajo — OC_GroupOrdersByNumber.js:20 minuscula toda clave de columna (errorCount pasa a ser
  // errorcount) y parseExternPurchaseOrders.js:86-119 lo suelta por completo, porque devuelve un
  // objeto literal de lista blanca donde ese campo no está. Editar cualquiera de esas dos
  // utilerías compartidas es la trampa de radio de impacto de CLAUDE.md §6 #2 (PR #16 rompió 7
  // llamadores así), y este Map evita tocarlas.
  // Always-on (CLAUDE.md §3): el Map es const dentro de createPurchaseOrders() y queda inalcanzable
  // en cuanto la función retorna. No es cache, no crece entre ticks y no hay nada que liberar.
  // La consulta devuelve una fila por LÍNEA de OC, así que muchas filas comparten EXTERNAL_ID y
  // traen el mismo COUNT(*): gana la última escritura y es correcto. Una OC ausente del Map cae en
  // el default 0, es decir, se comporta exactamente como hoy (sin sonda).
  const errorCounts = new Map();
  recordset.forEach((row) => {
    // S-5: || '' antes de .trim(). Un EXTERNAL_ID nulo lanzaría aquí y mataría el tick a media tanda.
    errorCounts.set(String(row.EXTERNAL_ID || '').trim(), row.errorCount || 0);
  });

  // Contadores del tick para la línea de resumen. Function-scoped, igual que el Map.
  let probed = 0;
  let probeFound = 0;
  let probeAbsent = 0;
  let probeSkipped = 0;
  let probeUnknown = 0;

  // 3) Agrupar y parsear al formato de envío
  const grouped = groupOrdersByNumber(recordset);
  const ordersToSend = parseExternPurchaseOrders(grouped);

  // 4) Procesar cada PO
  for (let i = 0; i < ordersToSend.length; i++) {
    const po = ordersToSend[i];

    // 4.1) [PORTAL-CHECK] — segunda opinión del portal antes de volver a hacer POST (RETRY-D4..D7).
    // D-01: este bloque va PRIMERO en el cuerpo del bucle, por delante del bloque 4.3 de Joi. El
    // camino de fallo de Joi inserta una fila ERROR, y correrlo para una OC que el portal YA tiene
    // fabricaría exactamente el ruido que esta fase existe para eliminar.
    // RETRY-D4: solo se pregunta por OCs que ya fallaron al menos una vez. Una OC con cero fallos
    // llega al POST sin que se emita ningún GET, igual que hoy.
    const ocKey = String(po.external_id || '').trim();
    const priorErrors = errorCounts.get(ocKey) || 0;
    if (priorErrors > 0) {
      // S-3: nada de este bloque puede lanzar hacia afuera. En un servicio que no termina entre
      // ticks, una excepción aquí aborta el tick completo a media tanda (CLAUDE.md §3;
      // RetryPolicy.js documenta la misma doctrina). La sonda nunca lanza, así que la única fuente
      // realista de excepción es runQuery en la escritura de reconciliación.
      // Los tres sitios de escritura preexistentes se dejan con su postura actual a propósito:
      // retrofitearlos ensancha el diff y queda fuera del alcance de este plan.
      try {
        probed++;
        const probe = await getPurchaseOrderByExternalId(index, ocKey);

        // RETRY-D7, garantía ESTRUCTURAL y no enumerativa: llegar al camino de creación exige
        // acertar un valor concreto ('absent'), no fallar una lista. Por eso todo lo que no sea
        // 'absent' — cualquier status encontrado, cualquier reason, y un probe indefinido, nulo o
        // con un outcome no reconocido — termina en el `continue` único del final de este bloque.
        // Un status que nadie anticipó no puede caer al POST.
        if (!probe || probe.outcome !== 'absent') {
          let result;
          // localStatus es un literal LOCAL, nunca texto del portal: solo 'POSTED' o 'CLOSED'.
          // Que siga siendo null es lo que decide que NO se escriba fila.
          let localStatus = null;
          let reason = 'n/a';

          if (probe && probe.outcome === 'found') {
            // Comparación estricta contra los cuatro literales del enum y SIN plegar mayúsculas:
            // normalizar 'open' a 'OPEN' ascendería en silencio una variante no reconocida a
            // reconocida, que es justo lo que RETRY-D7 prohíbe.
            const portalStatus = probe.status;
            if (portalStatus === 'OPEN' || portalStatus === 'GENERATED') {
              result = 'found';
              localStatus = 'POSTED';
            } else if (portalStatus === 'CLOSED') {
              result = 'found';
              localStatus = 'CLOSED';
            } else if (portalStatus === 'CANCELLED') {
              result = 'cancelled';
            } else {
              result = 'unknown';
              reason = 'unrecognised-status';
            }
          } else if (probe && probe.outcome === 'unknown' && probe.reason === 'ambiguous') {
            result = 'ambiguous';
            reason = 'ambiguous';
          } else {
            // 'unknown' con cualquier otro reason, y todo objeto malformado o inesperado.
            result = 'unknown';
            reason = (probe && probe.reason) ? probe.reason : 'unrecognised-outcome';
          }

          // RETRY-D6: cuando el portal confirma que ya tiene la OC se escribe UNA fila nueva de
          // reconciliación. Las filas ERROR históricas se quedan intactas — no se emite ninguna
          // sentencia de actualización contra la tabla de control por ningún camino de código.
          // El único valor de origen portal que cruza a este template es probe.id, ya validado
          // contra la forma de 24 hexadecimales dentro de la propia sonda (RETRY-D8 / D-05).
          if (localStatus) {
            const sqlCheck = `
        INSERT INTO fesa.dbo.fesaOCFocaltec
          (idFocaltec, ocSage, status, lastUpdate, createdAt, responseAPI, idDatabase)
        VALUES
          ('${probe.id}',
           '${po.external_id}',
           '${localStatus}',
           GETDATE(),
           GETDATE(),
           'PORTAL-CHECK',
           '${databases[index]}'
          )
      `;
            await runQuery(sqlCheck, 'FESA');
            logGenerator(logFileName, 'info', `[OK] PO ${po.external_id} reconciliada desde el portal en FESA como ${localStatus} con idFocaltec: ${probe.id}`);
          }

          if (result === 'found') {
            probeFound++;
          } else if (result === 'cancelled') {
            probeSkipped++;
          } else {
            probeUnknown++;
          }

          const level = (result === 'unknown' || result === 'ambiguous') ? 'warn' : 'info';
          const idField = (probe && probe.outcome === 'found') ? probe.id : 'n/a';
          // El status viene del portal y va a parar a la bitácora de auditoría de winston: se
          // sanea en línea para que un salto de línea hostil no pueda forjar una segunda entrada.
          const statusField = (probe && probe.outcome === 'found')
            ? (String(probe.status == null ? '' : probe.status).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'n/a')
            : 'n/a';
          const checkMsg = `[PORTAL-CHECK] PO ${po.external_id} tenant=${databases[index]} result=${result} id=${idField} status=${statusField} reason=${reason}`;
          if (level === 'warn') {
            console.warn(checkMsg);
          } else {
            console.log(checkMsg);
          }
          logGenerator(logFileName, level, checkMsg);
          continue;
        }

        // 'absent': el portal contestó 200 y no tiene la OC. Único camino que sigue al bloque 4.2
        // y hace POST exactamente como antes de esta fase.
        probeAbsent++;
        const absentMsg = `[PORTAL-CHECK] PO ${po.external_id} tenant=${databases[index]} result=absent id=n/a status=n/a reason=n/a`;
        console.log(absentMsg);
        logGenerator(logFileName, 'info', absentMsg);
      } catch (probeErr) {
        // Fail-closed (RETRY-D5): si no se pudo completar, no se hace POST y no se escribe nada.
        // Nunca se relanza.
        probeUnknown++;
        const detail = (probeErr && probeErr.message) ? probeErr.message : String(probeErr);
        const failMsg = `[PORTAL-CHECK] PO ${po.external_id} tenant=${databases[index]} result=unknown id=n/a status=n/a reason=write-failed`;
        console.warn(failMsg);
        console.error(`   -> ${detail}`);
        logGenerator(logFileName, 'warn', failMsg);
        logGenerator(logFileName, 'error', `[ERROR] Fallo escribiendo la reconciliación de PO ${po.external_id}: ${detail}`);
        continue;
      }
    }

    // Imprimir el PO que realmente se enviará al API (después de limpiar placeholders y validación)
    let poToSend = { ...po };
    if (poToSend.cfdi_payment_method === '') delete poToSend.cfdi_payment_method;
    if (poToSend.requisition_number === 0) delete poToSend.requisition_number;
    //console.log('[DEBUG] PO FINAL a enviar al API:', JSON.stringify(poToSend, null, 2));

    // 4.2) Limpiar placeholders
    //delete po.company_external_id;
    if (po.cfdi_payment_method === '') delete po.cfdi_payment_method;
    if (po.requisition_number === 0) delete po.requisition_number;

    // 4.3) Validar con Joi (usar el valor transformado retornado)
    let validatedPO;
    try {
      validatedPO = validateExternPurchaseOrder(po);
      console.log(`[OK] [${i + 1}/${ordersToSend.length}] PO ${validatedPO.external_id} pasó validación Joi`);
      logGenerator(logFileName, 'info', `[OK] PO ${validatedPO.external_id} pasó validación Joi`);
    } catch (valErr) {
      console.error(`[ERROR] Joi validation failed for PO ${po.external_id}:`);
      valErr.details.forEach(d => console.error(`   -> ${d.message}`));
      logGenerator(logFileName, 'error', `[ERROR] Validación Joi falló para PO ${po.external_id}: ${valErr.details.map(d => d.message).join('; ')}`);

      // Insert ERROR en fesaOCFocaltec
      const respAPI = valErr.details.map(d => d.message).join('; ');
      const sqlErr = `
        INSERT INTO fesa.dbo.fesaOCFocaltec
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

    // 4.4) Enviar al portal (usar validatedPO que tiene los valores transformados por Joi)
    const endpoint = `${urlBase(index)}/purchase-orders`;
    try {
      const resp = await portalClient.post(
        endpoint,
        validatedPO,
        {
          headers: {
            'PDPTenantKey': apiKeys[index],
            'PDPTenantSecret': apiSecrets[index],
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(
        `[INFO] [${i + 1}/${ordersToSend.length}] PO ${po.external_id} enviada OK\n` +
        `   -> Status: ${resp.status} ${resp.statusText}`
      );
      logGenerator(logFileName, 'info', `[OK] PO ${po.external_id} enviada OK. Status: ${resp.status} ${resp.statusText}`);

      // 4.5) Insert POSTED en fesaOCFocaltec
      const idFocaltec = resp.data.id;
      const sqlOk = `
        INSERT INTO fesa.dbo.fesaOCFocaltec
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
      logGenerator(logFileName, 'info', `[OK] PO ${po.external_id} marcada POSTED en FESA con idFocaltec: ${idFocaltec}`);

    } catch (err) {
      console.error(`[ERROR] [${i + 1}/${ordersToSend.length}] Error enviando PO ${po.external_id}:`);
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
        INSERT INTO fesa.dbo.fesaOCFocaltec
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
      logGenerator(logFileName, 'info', `[INFO] PO ${po.external_id} marcada ERROR en FESA: ${respAPI}`);
    }
  }

  // Resumen [PORTAL-CHECK-SUMMARY] por tick (D-06), nunca por fila. Invariante que debe cumplirse
  // siempre: probed === found + absent + skipped + unknown. Se omite cuando probed es 0 — el tick
  // silencioso es el abrumadoramente común y una línea vacía por tick vuelve ilegible la bitácora.
  if (probed > 0) {
    const summaryMsg = `[PORTAL-CHECK-SUMMARY] tenant=${databases[index]} probed=${probed} found=${probeFound} absent=${probeAbsent} skipped=${probeSkipped} unknown=${probeUnknown}`;
    console.log(summaryMsg);
    logGenerator(logFileName, 'info', summaryMsg);
  }
}

// createPurchaseOrders(0).catch(err => {
//   console.error('❌ Error en createPurchaseOrders:', err);
//   // Aquí podrías agregar un log si tienes una función de logging
// });

module.exports = {
  createPurchaseOrders
}