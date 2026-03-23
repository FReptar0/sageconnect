const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { successResult, errorResult } = require('../utils/ResultEnvelope');
const axios = require('axios');
const config = require('../config');

// preparamos arrays de credenciales
const tenantIds = config.portal.tenants.map(t => t.id);
const apiKeys = config.portal.tenants.map(t => t.key);
const apiSecrets = config.portal.tenants.map(t => t.secret);

// preparamos array de bases de datos (usamos indice 0 para pruebas)
const database = config.portal.tenants.map(t => t.database);
const URL = config.portal.url;

async function generatePayments(options = {}) {
  const startTime = Date.now();
  const tenantIndex = options.tenantIndex || 0;
  const pyFilter = options.pyFilter || null;
  let dateFilter = options.dateFilter || null;
  const shouldPost = options.shouldPost || false;
  const logFileName = 'TestUploadPayments';

  if (shouldPost) {
    console.log('Modo POST activado - Los pagos seran enviados al portal');
  } else {
    console.log('Modo preview - Solo se mostrara el JSON (usa --post para enviar)');
  }

  // Si no se proporciono fecha, tomamos la fecha de hoy en formato YYYYMMDD
  if (!dateFilter && !pyFilter) {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dateFilter = `${yyyy}${mm}${dd}`;
  }
  // Construir condicion dinamica: si se indico --py filtramos por P.DOCNBR exacto, si no usamos P.DATEBUS >= <fecha>
  const extraCondition = pyFilter ? `AND P.DOCNBR = '${pyFilter}'` : `AND P.DATEBUS >= ${dateFilter}`;

  const queryEncabezadosPago = `
SELECT A.* FROM (
  SELECT
    P.CNTBTCH    AS LotePago,
    P.CNTENTR    AS AsientoPago,
    RTRIM(BK.ADDR1)   AS bank_account_id,
    B.IDBANK,
    P.DATEBUS    AS FechaAsentamiento,
    P.DOCNBR     AS external_id,
    P.TEXTRMIT   AS comments,
    P.TXTRMITREF AS reference,
    CASE BK.CURNSTMT WHEN 'MXP' THEN 'MXN' ELSE BK.CURNSTMT END AS bk_currency,
    P.DATERMIT   AS payment_date,
    RTRIM(P.IDVEND)   AS provider_external_id,
    P.AMTRMIT    AS total_amount,
    'TRANSFER'   AS operation_type,
    P.RATEEXCHHC AS TipoCambioPago,
    ISNULL(
      (SELECT [VALUE] FROM APVENO WHERE OPTFIELD='RFC'        AND VENDORID=P.IDVEND),
      ''
    ) AS RFC,
    ISNULL(
      (SELECT [VALUE] FROM APVENO WHERE OPTFIELD='PROVIDERID' AND VENDORID=P.IDVEND),
      ''
    ) AS PROVIDERID
  FROM APBTA B
  JOIN BKACCT BK ON B.IDBANK  = BK.BANK
  JOIN APTCR   P  ON B.PAYMTYPE = P.BTCHTYPE
                 AND B.CNTBTCH  = P.CNTBTCH
  WHERE B.PAYMTYPE  = 'PY'
    AND B.BATCHSTAT = 3
    AND P.ERRENTRY  = 0
    AND P.RMITTYPE  = 1
    ${extraCondition}
    AND P.DOCNBR NOT IN (
      SELECT NoPagoSage
      FROM fesa.dbo.fesaPagosFocaltec
      WHERE idCia      = P.AUDTORG
        AND NoPagoSage = P.DOCNBR
    )
    AND P.DOCNBR NOT IN (
      SELECT IDINVC
      FROM APPYM
      WHERE IDBANK    = B.IDBANK
        AND CNTBTCH   = P.CNTBTCH
        AND CNTITEM   = P.CNTENTR
        AND SWCHKCLRD = 2
    )
) AS A
`;
  let hdrs;
  try {
    ({ recordset: hdrs } = await runQuery(queryEncabezadosPago, database[tenantIndex]));
  } catch (err) {
    console.error('Error al traer cabeceras:', err);
    return errorResult(
      [err.message],
      'Failed to fetch payment headers',
      { tenant: tenantIndex, startTime }
    );
  }
  console.log(`${hdrs.length} cabeceras recuperadas`);

  // 2) Filtrar en JS registros sin PROVIDERID
  const before = hdrs.length;
  hdrs = hdrs.filter(r => {
    if (!r.PROVIDERID?.trim()) {
      logGenerator(logFileName, 'warn',
        `Omitiendo lote ${r.LotePago}/${r.AsientoPago}: provider_external_id="${r.provider_external_id}" sin PROVIDERID`);
      return false;
    }
    return true;
  });
  console.log(`Omitidos ${before - hdrs.length} pagos sin PROVIDERID`);

  if (!hdrs.length) {
    console.log('No quedan cabeceras tras filtrar PROVIDERID');
    return successResult(
      { total: 0, sent: 0, skippedNoProvider: before, skippedAlreadyProcessed: 0, errors: 0 },
      'No payments to process after PROVIDERID filter',
      { tenant: tenantIndex, startTime }
    );
  }

  // 3) Filtrar pagos ya registrados
  const queryPagosRegistrados = `SELECT NoPagoSage FROM fesa.dbo.fesaPagosFocaltec`;
  let regs;
  try {
    ({ recordset: regs } = await runQuery(queryPagosRegistrados));
  } catch (err) {
    console.error('Error al traer pagos registrados:', err);
    regs = [];
  }
  const seen = new Set(regs.map(r => r.NoPagoSage));
  const before2 = hdrs.length;
  hdrs = hdrs.filter(r => !seen.has(r.external_id));
  console.log(`Omitidos ${before2 - hdrs.length} pagos ya procesados`);

  if (!hdrs.length) {
    console.log('Todos los pagos ya estaban procesados');
    return successResult(
      { total: 0, sent: 0, skippedNoProvider: before - hdrs.length, skippedAlreadyProcessed: before2 - hdrs.length, errors: 0 },
      'All payments already processed',
      { tenant: tenantIndex, startTime }
    );
  }

  // 4) Generar JSON para cada pago
  let sentCount = 0;
  let errorCount = 0;
  const results = [];

  for (const hdr of hdrs) {
    // 4.1) Obtener facturas del lote/asiento
    const qInv = `
SELECT
  DP.CNTBTCH        AS LotePago,
  DP.CNTRMIT        AS AsientoPago,
  RTRIM(DP.IDINVC)  AS invoice_external_id,
  H.AMTGROSDST      AS invoice_amount,
  CASE H.CODECURN WHEN 'MXP' THEN 'MXN' ELSE H.CODECURN END AS invoice_currency,
  H.EXCHRATEHC      AS invoice_exchange_rate,
  DP.AMTPAYM        AS payment_amount,
  ISNULL(
    (SELECT SWPAID
     FROM APOBL
     WHERE IDINVC = DP.IDINVC
       AND IDVEND = DP.IDVEND
    ),
    0
  )                   AS FULL_PAID,
  ISNULL(
    (SELECT RTRIM([VALUE])
     FROM APIBHO
     WHERE CNTBTCH = H.CNTBTCH
       AND CNTITEM = H.CNTITEM
       AND OPTFIELD = 'FOLIOCFD'
    ),
    ''
  )                   AS UUID
FROM APTCP DP
JOIN APIBH H ON DP.IDVEND = H.IDVEND
           AND DP.IDINVC = H.IDINVC
           AND H.ERRENTRY = 0
JOIN APIBC C ON H.CNTBTCH = C.CNTBTCH
           AND C.BTCHSTTS = 3
WHERE DP.BATCHTYPE = 'PY'
  AND DP.CNTBTCH   = ${hdr.LotePago}
  AND DP.CNTRMIT   = ${hdr.AsientoPago}
  AND DP.DOCTYPE   = 1
`;
    let invs;
    try {
      ({ recordset: invs } = await runQuery(qInv, database[tenantIndex]));
    } catch (err) {
      console.error(`Error al traer facturas L${hdr.LotePago}/A${hdr.AsientoPago}:`, err);
      invs = [];
    }
    if (!invs.length) {
      console.log(`Sin facturas para L${hdr.LotePago}/A${hdr.AsientoPago}`);
      continue;
    }

    // 4.2) Construir cfdis con logica de exchange_rate
    const cfdis = invs.map(inv => {
      const sameCurrency = inv.invoice_currency === hdr.bk_currency;
      return {
        amount: inv.invoice_amount,
        currency: inv.invoice_currency,
        exchange_rate: sameCurrency ? 1 : inv.invoice_exchange_rate,
        payment_amount: inv.payment_amount,
        payment_currency: hdr.bk_currency,
        uuid: inv.UUID
      };
    });

    const allFull = invs.every(inv => inv.FULL_PAID === 1 || inv.FULL_PAID === '1');
    const payStatus = allFull ? 'PAID' : 'PARTIAL';
    const markExisting = allFull;

    const d = hdr.payment_date.toString();
    const payment_date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T10:00:00.000Z`;

    const payload = {
      bank_account_id: hdr.bank_account_id,
      cfdis,
      comments: hdr.comments,
      currency: hdr.bk_currency,
      external_id: hdr.external_id,
      ignore_amounts: false,
      mark_existing_cfdi_as_payed: markExisting,
      open: false,
      operation_type: hdr.operation_type,
      payment_date,
      provider_external_id: hdr.provider_external_id,
      reference: hdr.reference,
      total_amount: hdr.total_amount
    };

    console.log(`\nPayload para pago ${hdr.external_id} (status ${payStatus}):`);
    console.log(JSON.stringify(payload, null, 2));

    // Si se paso el flag --post, enviar al portal
    if (shouldPost) {
      console.log(`\nEnviando pago ${hdr.external_id} al portal...`);
      const endpoint = `${URL}/api/1.0/extern/tenants/${tenantIds[tenantIndex]}/payments`;

      try {
        const resp = await axios.post(endpoint, payload, {
          headers: {
            'PDPTenantKey': apiKeys[tenantIndex],
            'PDPTenantSecret': apiSecrets[tenantIndex],
            'Content-Type': 'application/json'
          }
        });

        if (resp.status === 200) {
          const idPortal = resp.data && resp.data.id ? resp.data.id : undefined;
          console.log(`Pago ${hdr.external_id} enviado con exito (200)`);
          if (idPortal) {
            console.log(`   ID asignado por portal: ${idPortal}`);
          }

          logGenerator(
            logFileName,
            'success',
            `Pago ${hdr.external_id} enviado correctamente. Tenant: ${tenantIds[tenantIndex]}, ID portal: ${idPortal ?? 'N/A'}`
          );

          // Registrar en control table
          const insertSql = `
                    INSERT INTO fesa.dbo.fesaPagosFocaltec
                        (idCia, NoPagoSage, status, idFocaltec)
                    VALUES
                        ('${database[tenantIndex]}',
                         '${hdr.external_id}',
                         '${payStatus}',
                         ${idPortal ? `'${idPortal}'` : 'NULL'}
                        )
                `;

          const result = await runQuery(insertSql).catch(err => {
            logGenerator(logFileName, 'error', `Insert control table failed: ${err.message}`);
            console.error(`Fallo INSERT control table: ${err.message}`);
            return { rowsAffected: [0] };
          });

          if (result.rowsAffected[0]) {
            console.log(`Control table actualizado para pago ${hdr.external_id}`);
          } else {
            console.warn(`No se inserto control para pago ${hdr.external_id}`);
          }

          sentCount++;
          results.push({ externalId: hdr.external_id, status: 'sent', portalId: idPortal });
        } else {
          console.error(`Error enviando pago ${hdr.external_id}: ${resp.status}`);
          console.error('   Detalle:', resp.data);
          logGenerator(
            logFileName,
            'error',
            `Error al enviar pago ${hdr.external_id}: ${resp.status} ${JSON.stringify(resp.data)}`
          );
          errorCount++;
          results.push({ externalId: hdr.external_id, status: 'error', error: `HTTP ${resp.status}` });
        }
      } catch (err) {
        console.error(`Error POST para pago ${hdr.external_id}:`, err.message);
        if (err.response) {
          console.error('   Status:', err.response.status);
          console.error('   Data:', err.response.data);
        }
        logGenerator(
          logFileName,
          'error',
          `Error POST payment ${hdr.external_id}: ${err.message}`
        );
        errorCount++;
        results.push({ externalId: hdr.external_id, status: 'error', error: err.message });
      }
    } else {
      results.push({ externalId: hdr.external_id, status: 'preview', payload });
    }
  }

  return successResult(
    { total: hdrs.length, sent: sentCount, errors: errorCount, payments: results },
    shouldPost
      ? `Generated and sent ${sentCount} payments (${errorCount} errors)`
      : `Generated ${hdrs.length} payment payloads (preview mode)`,
    { tenant: tenantIndex, startTime }
  );
}

module.exports = { generatePayments };

// CLI execution
if (require.main === module) {
  (async () => {
    const cliArgs = process.argv.slice(2);
    let pyFilter = null;
    let dateFilter = null;
    let shouldPost = false;
    let tenantIndex = 0;

    for (let i = 0; i < cliArgs.length; i++) {
      const a = cliArgs[i];
      if (a === '--py' && cliArgs[i + 1]) {
        pyFilter = cliArgs[i + 1];
        i++;
      } else if (a === '--date' && cliArgs[i + 1]) {
        dateFilter = cliArgs[i + 1];
        i++;
      } else if (a === '--post') {
        shouldPost = true;
      } else if (a.startsWith('--index=')) {
        tenantIndex = parseInt(a.split('=')[1]) || 0;
      } else if (/^\d{8}$/.test(a) && !dateFilter && !pyFilter) {
        dateFilter = a;
      } else if (!pyFilter && !/^\d{8}$/.test(a)) {
        pyFilter = a;
      }
    }

    const result = await generatePayments({ tenantIndex, pyFilter, dateFilter, shouldPost });
    console.log('\n[RESULT]', JSON.stringify(result, null, 2));
  })().catch(err => {
    console.error('Error en generatePayments:', err);
  });
}
