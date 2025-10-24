// tests/Payment_Select.test.js

// Script interactivo de prueba para listar pagos por fecha, seleccionar uno y opcionalmente subirlo al portal
// Uso:
//   node tests/Payment_Select.test.js <YYYYMMDD> [DATABASE] [TENANT_INDEX]
// Ejemplo:
//   node tests/Payment_Select.test.js 20251024 COPDAT 0

const dotenv = require('dotenv');
const readline = require('readline');
const axios = require('axios');

dotenv.config({ path: '.env.credentials.focaltec' });
const creds = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const config = dotenv.config({ path: '.env' }).parsed || {};

const { TENANT_ID, API_KEY, API_SECRET, URL, DATABASES } = creds;
const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const databases = DATABASES.split(',');

const { runQuery } = require('../src/utils/SQLServerConnection');
const { logGenerator } = require('../src/utils/LogGenerator');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function question(q) {
  return new Promise(resolve => rl.question(q, ans => resolve(ans)));
}

async function main() {
  console.log('=== Payment Select Test ===\n');
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Uso: node tests/Payment_Select.test.js <YYYYMMDD> [DATABASE] [TENANT_INDEX]');
    process.exit(1);
  }

  const dateArg = args[0];
  let dbArg = args[1] || null;
  let tenantIndex = 0;
  if (args[2] && /^\d+$/.test(args[2])) tenantIndex = parseInt(args[2]);

  const dbToUse = dbArg || databases[tenantIndex];
  console.log(`[INICIO] Fecha filtro: ${dateArg} | Database: ${dbToUse} | Tenant index: ${tenantIndex}`);

  const logFileName = 'Payment_Select_Test';

  const queryEncabezadosPago = `
SELECT A.* FROM (
    SELECT
        P.CNTBTCH    AS LotePago,
        P.CNTENTR    AS AsientoPago,
        RTRIM(BK.ADDR1)   AS bank_account_id,
        B.IDBANK,
        P.DATEBUS    AS FechaAsentamiento,
        RTRIM(P.DOCNBR)     AS external_id,
        P.TEXTRMIT   AS comments,
        P.TXTRMITREF AS reference,
        CASE BK.CURNSTMT WHEN 'MXP' THEN 'MXN' ELSE BK.CURNSTMT END AS bk_currency,
        P.DATERMIT   AS payment_date,
        RTRIM(P.IDVEND)   AS provider_external_id,
        P.AMTRMIT    AS total_amount,
        'TRANSFER'   AS operation_type,
        P.RATEEXCHHC AS TipoCambioPago,
    ISNULL(
    (SELECT [VALUE]
        FROM APVENO
        WHERE OPTFIELD = 'RFC'
        AND VENDORID = P.IDVEND
    ),
    ''
    ) AS RFC,
    ISNULL(
        (SELECT [VALUE]
        FROM APVENO
            WHERE OPTFIELD = 'PROVIDERID'
        AND VENDORID = P.IDVEND
    ),
    ''
    ) AS PROVIDERID,
    -- Calculamos la diferencia en minutos desde la creación del registro
    DATEDIFF(
        MINUTE,
        DATEADD(
            mi,
            DATEDIFF(mi, GETUTCDATE(), GETDATE()),
            CONVERT(VARCHAR(10), CONVERT(Date, CONVERT(VARCHAR(8), P.AUDTDATE))) 
            + ' ' +
            LEFT(LEFT(RIGHT('00000000' + CONVERT(varchar(8), P.AUDTTIME), 8), 4), 2) + ':' +
            RIGHT(LEFT(RIGHT('00000000' + CONVERT(varchar(8), P.AUDTTIME), 8), 4), 2) + ':' +
            RIGHT(LEFT(RIGHT('00000000' + CONVERT(varchar(8), P.AUDTTIME), 8), 6), 2)
        ),
        SYSDATETIME()
    ) AS DIFERENCIA_MINUTOS
    FROM APBTA B
    JOIN BKACCT BK ON B.IDBANK    = BK.BANK
    JOIN APTCR   P  ON B.PAYMTYPE  = P.BTCHTYPE
        AND B.CNTBTCH   = P.CNTBTCH
    WHERE B.PAYMTYPE   = 'PY'
        AND B.BATCHSTAT  = 3
        AND P.ERRENTRY   = 0
        AND P.RMITTYPE   = 1
        AND P.AUDTDATE   >= ${dateArg}
        AND P.DOCNBR NOT IN (
    SELECT NoPagoSage
        FROM fesa.dbo.fesaPagosFocaltec
        WHERE idCia       = P.AUDTORG
            AND NoPagoSage  = P.DOCNBR
    )
    AND P.DOCNBR NOT IN (
        SELECT IDINVC
            FROM APPYM
        WHERE IDBANK    = B.IDBANK
            AND CNTBTCH   = P.CNTBTCH
            AND CNTITEM   = P.CNTENTR
            AND SWCHKCLRD = 2
    )
    -- Filtro para solo procesar pagos con al menos 60 minutos de antigüedad
    AND DATEDIFF(
        MINUTE,
        DATEADD(
            mi,
            DATEDIFF(mi, GETUTCDATE(), GETDATE()),
            CONVERT(VARCHAR(10), CONVERT(Date, CONVERT(VARCHAR(8), P.AUDTDATE))) 
            + ' ' +
            LEFT(LEFT(RIGHT('00000000' + CONVERT(varchar(8), P.AUDTTIME), 8), 4), 2) + ':' +
            RIGHT(LEFT(RIGHT('00000000' + CONVERT(varchar(8), P.AUDTTIME), 8), 4), 2) + ':' +
            RIGHT(LEFT(RIGHT('00000000' + CONVERT(varchar(8), P.AUDTTIME), 8), 6), 2)
        ),
        SYSDATETIME()
    ) >= 60
) AS A
`;

  try {
    console.log('[INFO] Ejecutando query de encabezados de pago...');
    const payments = await runQuery(queryEncabezadosPago, dbToUse);
    const rows = payments.recordset || [];

    if (rows.length === 0) {
      console.log('[OK] No hay pagos para la fecha indicada.');
      process.exit(0);
    }

    console.log(`\n[RESULT] Encontrados ${rows.length} pagos:`);
    rows.forEach((r, idx) => {
      console.log(`  [${idx}] Lote: ${r.LotePago} | Asiento: ${r.AsientoPago} | Pago: ${r.external_id} | Proveedor: ${r.provider_external_id} | Monto: ${r.total_amount} | Minutos: ${r.DIFERENCIA_MINUTOS}`);
    });

    const sel = await question('\nIngresa el índice del pago que quieres revisar y subir (o "exit" para salir): ');
    if (sel.trim().toLowerCase() === 'exit') {
      console.log('Saliendo...');
      process.exit(0);
    }
    const selIdx = parseInt(sel);
    if (isNaN(selIdx) || selIdx < 0 || selIdx >= rows.length) {
      console.log('Índice inválido. Saliendo.');
      process.exit(1);
    }

    const hdr = rows[selIdx];
    console.log(`\n[SELECTED] Lote ${hdr.LotePago} / Asiento ${hdr.AsientoPago} / Pago ${hdr.external_id}`);

    // Consultar facturas asociadas (mismo query que en controller)
    const queryFacturasPagadas = `
        SELECT DISTINCT
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
                AND IDVEND = DP.IDVEND),
            0
            ) AS FULL_PAID,
            ISNULL(
            (SELECT RTRIM([VALUE])
                FROM APIBHO
                WHERE CNTBTCH = H.CNTBTCH
                AND CNTITEM = H.CNTITEM
                AND OPTFIELD = 'FOLIOCFD'
            ),
            ''
        ) AS UUID,
            -- Revisar su uso en fase 3 
            R.RATEEXCHHC as exchange_rate
        FROM APTCP DP
        JOIN APTCR R ON R.CNTBTCH = DP.CNTBTCH AND R.CNTENTR = DP.CNTRMIT
        JOIN APIBH H ON DP.IDVEND = H.IDVEND
                AND DP.IDINVC = H.IDINVC
                AND H.ERRENTRY = 0
        JOIN APIBC C ON H.CNTBTCH = C.CNTBTCH
                AND C.BTCHSTTS = 3
        WHERE DP.BATCHTYPE = 'PY'
            AND DP.CNTBTCH   = ${hdr.LotePago}
            AND DP.CNTRMIT   = ${hdr.AsientoPago}
            AND DP.DOCTYPE   = 1`;

    const invoices = await runQuery(queryFacturasPagadas, dbToUse).catch(err => {
      console.error('[ERROR] queryFacturasPagadas:', err.message);
      return { recordset: [] };
    });

    const invRows = invoices.recordset || [];
    if (invRows.length === 0) {
      console.log('No se encontraron facturas asociadas al pago. Abortando.');
      process.exit(0);
    }

    console.log(`\n[INVOICES] Encontradas ${invRows.length} facturas asociadas:`);
    invRows.forEach((inv, i) => {
      console.log(`  - ${i}: ${inv.invoice_external_id} | Monto: ${inv.invoice_amount} | Pago aplicado: ${inv.payment_amount} | UUID: ${inv.UUID}`);
    });

    // Construir cfdis
    const cfdis = invRows.map(inv => {
      const sameCurrency = inv.invoice_currency === hdr.bk_currency;
      const UUID_Capitalized = inv.UUID ? inv.UUID.toUpperCase() : '';
      return {
        amount: inv.payment_amount,
        currency: inv.invoice_currency,
        exchange_rate: sameCurrency ? 1 : inv.invoice_exchange_rate,
        payment_amount: inv.payment_amount,
        payment_currency: hdr.bk_currency,
        uuid: UUID_Capitalized
      };
    });

    const allFull = invRows.every(inv => inv.FULL_PAID === 1 || inv.FULL_PAID === '1');
    console.log(`\n[INFO] Pago completo? ${allFull}`);

    const d = hdr.payment_date.toString();
    const payment_date = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T10:00:00.000Z`;

    const payload = {
      bank_account_id: hdr.bank_account_id,
      cfdis,
      comments: hdr.comments,
      currency: hdr.bk_currency,
      external_id: hdr.external_id,
      ignore_amounts: false,
      open: false,
      operation_type: hdr.operation_type,
      payment_date,
      provider_external_id: hdr.provider_external_id,
      reference: hdr.reference,
      total_amount: hdr.total_amount
    };

    console.log('\n[PAYLOAD] Payload que se enviaría:');
    console.log(JSON.stringify(payload, null, 2));

    const confirm = await question('\n¿Deseas enviar este pago al portal? (yes/no): ');
    if (confirm.trim().toLowerCase() !== 'yes') {
      console.log('Operación cancelada por el usuario. Saliendo.');
      process.exit(0);
    }

    // Enviar al portal
    const endpoint = `${URL}/api/1.0/extern/tenants/${tenantIds[tenantIndex]}/payments`;
    console.log(`\n[INFO] Enviando POST a ${endpoint} ...`);
    let resp;
    try {
      resp = await axios.post(endpoint, payload, {
        headers: {
          'PDPTenantKey': apiKeys[tenantIndex],
          'PDPTenantSecret': apiSecrets[tenantIndex],
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
    } catch (err) {
      const msg = err.response ? `${err.response.status} ${JSON.stringify(err.response.data)}` : err.message;
      console.error('[ERROR] Error al enviar pago:', msg);
      logGenerator(logFileName, 'error', `Error POST payment: ${msg}`);
      process.exit(1);
    }

    if (resp.status === 200 || resp.status === 201) {
      const idPortal = resp.data && resp.data.id ? resp.data.id : undefined;
      console.log(`[OK] Pago ${hdr.external_id} enviado correctamente. ID portal: ${idPortal ?? 'N/A'}`);
      logGenerator(logFileName, 'success', `Pago ${hdr.external_id} enviado. ID portal: ${idPortal ?? 'N/A'}`);

      const confirmInsert = await question('¿Deseas insertar el control en fesaPagosFocaltec? (yes/no): ');
      if (confirmInsert.trim().toLowerCase() === 'yes') {
        const statusTag = allFull ? 'PAID' : 'PARTIAL';
        const insertSql = `
        INSERT INTO fesa.dbo.fesaPagosFocaltec
            (idCia, NoPagoSage, status, idFocaltec)
            VALUES
            ('${dbToUse}',
            '${hdr.external_id}',
            '${statusTag}',
            ${idPortal ? `'${idPortal}'` : 'NULL'}
            )`;
        try {
          const result = await runQuery(insertSql);
          if (result.rowsAffected && result.rowsAffected[0]) {
            console.log('[OK] Insert de control realizado.');
            logGenerator(logFileName, 'info', `Insert control para pago ${hdr.external_id}`);
          } else {
            console.warn('[WARN] No se insertó control (rowsAffected=0)');
          }
        } catch (err) {
          console.error('[ERROR] Falló INSERT control:', err.message);
          logGenerator(logFileName, 'error', `Insert failed: ${err.message}`);
        }
      } else {
        console.log('No se insertó control en la tabla (cancelado por usuario).');
      }

    } else {
      console.error(`[ERROR] El portal respondió con status ${resp.status}`);
      console.error(resp.data);
      logGenerator(logFileName, 'error', `Error al enviar pago ${hdr.external_id}: ${resp.status}`);
    }

    console.log('\nProceso finalizado.');
    process.exit(0);

  } catch (err) {
    console.error('[ERROR] Error inesperado en script:', err.message);
    logGenerator('Payment_Select_Test', 'error', `Unexpected error: ${err.message}`);
    process.exit(1);
  }
}

main();
