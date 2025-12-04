const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const dotenv = require('dotenv');

const credentials = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const { DATABASES } = credentials;

// preparamos array de bases de datos (usamos índice 0 para pruebas)
const database = DATABASES.split(',');
const index = 0;

async function testGeneratePaymentJson() {
  const logFileName = 'TestUploadPayments';
  // 0) Obtener parámetros CLI: --py <DOCNBR> o --date <YYYYMMDD>
  const cliArgs = process.argv.slice(2);
  let pyFilter = null;
  let dateFilter = null;
  for (let i = 0; i < cliArgs.length; i++) {
    const a = cliArgs[i];
    if (a === '--py' && cliArgs[i + 1]) {
      pyFilter = cliArgs[i + 1];
      i++;
    } else if (a === '--date' && cliArgs[i + 1]) {
      dateFilter = cliArgs[i + 1];
      i++;
    } else if (/^\d{8}$/.test(a) && !dateFilter && !pyFilter) {
      // si se pasa un argumento suelto de 8 dígitos lo interpretamos como fecha YYYYMMDD
      dateFilter = a;
    } else if (!pyFilter && !/^\d{8}$/.test(a)) {
      // si se pasa un argumento que no es fecha lo interpretamos como DOCNBR (py)
      pyFilter = a;
    }
  }

  // Si no se proporcionó fecha, tomamos la fecha de hoy en formato YYYYMMDD
  if (!dateFilter && !pyFilter) {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dateFilter = `${yyyy}${mm}${dd}`;
  }
  // Construir condición dinámica: si se indicó --py filtramos por P.DOCNBR exacto, si no usamos P.DATEBUS >= <fecha>
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
    ({ recordset: hdrs } = await runQuery(queryEncabezadosPago, database[index]));
  } catch (err) {
    console.error('Error al traer cabeceras:', err);
    return;
  }
  console.log(`🔍 ${hdrs.length} cabeceras recuperadas`);

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
  console.log(`ℹ️  Omitidos ${before - hdrs.length} pagos sin PROVIDERID`);

  if (!hdrs.length) {
    console.log('✅ No quedan cabeceras tras filtrar PROVIDERID');
    return;
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
  console.log(`ℹ️  Omitidos ${before2 - hdrs.length} pagos ya procesados`);

  if (!hdrs.length) {
    console.log('✅ Todos los pagos ya estaban procesados');
    return;
  }

  // 4) Generar JSON para cada pago
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
      ({ recordset: invs } = await runQuery(qInv, database[index]));
    } catch (err) {
      console.error(`Error al traer facturas L${hdr.LotePago}/A${hdr.AsientoPago}:`, err);
      invs = [];
    }
    if (!invs.length) {
      console.log(`⚠️  Sin facturas para L${hdr.LotePago}/A${hdr.AsientoPago}`);
      continue;
    }

    // 4.2) Construir cfdis con lógica de exchange_rate
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

    console.log(`\n📦 Payload para pago ${hdr.external_id} (status ${payStatus}):`);
    console.log(JSON.stringify(payload, null, 2));
  }
}

testGeneratePaymentJson().catch(err => {
  console.error('❌ Error en testGeneratePaymentJson:', err);
});
