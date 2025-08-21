const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const axios = require('axios');
const notifier = require('node-notifier');
const dotenv = require('dotenv');

const credentials = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;

const {
    TENANT_ID,
    API_KEY,
    API_SECRET,
    URL,
    DATABASES
} = credentials;

// preparamos arrays de tenants/keys/etc.
const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const database = DATABASES.split(',');

async function uploadPayments(index) {
    try {
        const currentDate = new Date()
            .toISOString()
            .slice(0, 10)
            .replace(/-/g, '');

        console.log(`\n=== Iniciando uploadPayments para tenant index=${index} (db=${database[index]}) con fecha desde ${currentDate} ===`);

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
        AND P.AUDTDATE   >= ${currentDate}
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
        console.log('Ejecutando queryEncabezadosPago con filtro de 60 minutos...');
        const payments = await runQuery(queryEncabezadosPago, database[index])
            .catch(err => {
                logGenerator('PortalPaymentController', 'error', `Error queryEncabezadosPago: ${err.message}`);
                console.error('❌ Falló queryEncabezadosPago:', err.message);
                return { recordset: [] };
            });

        console.log(`[INFO] Recuperados ${payments.recordset.length} registros de pagos (con al menos 60 minutos de antigüedad).`);

        // Log de información sobre minutos transcurridos para cada pago
        if (payments.recordset.length > 0) {
            console.log('[INFO] Detalle de minutos transcurridos por pago:');
            payments.recordset.forEach(payment => {
                console.log(`  - Pago ${payment.external_id}: ${payment.DIFERENCIA_MINUTOS} minutos desde creación`);
            });
        }

        // 2) Filtrar registros sin PROVIDERID
        const beforeCount = payments.recordset.length;
        payments.recordset = payments.recordset.filter(r => {
            if (!r.PROVIDERID || r.PROVIDERID.trim() === '') {
                logGenerator(
                    'PortalPaymentController',
                    'warn',
                    `Proveedor ${r.provider_external_id} no tiene PROVIDERID seteado.`
                );
                console.warn(`[WARN] Omite pago ${r.external_id} por PROVIDERID vacío`);
                return false;
            }
            return true;
        });
        console.log(`[INFO] Se omitieron ${beforeCount - payments.recordset.length} pagos sin PROVIDERID.`);

        // 3) Filtrar por control table (todos los NoPagoSage ya existentes)
        const queryPagosRegistrados = `
        SELECT NoPagoSage
        FROM fesa.dbo.fesaPagosFocaltec`;

        console.log('[INFO] Ejecutando queryPagosRegistrados...');
        const pagosRegistrados = await runQuery(queryPagosRegistrados)
            .catch(err => {
                logGenerator('PortalPaymentController', 'error', `Error queryPagosRegistrados: ${err.message}`);
                console.error('❌ Falló queryPagosRegistrados:', err.message);
                return { recordset: [] };
            });

        const existingSet = new Set(pagosRegistrados.recordset.map(r => r.NoPagoSage));
        const beforeFilter = payments.recordset.length;
        payments.recordset = payments.recordset.filter(p => !existingSet.has(p.external_id));
        console.log(`[INFO] Se omitieron ${beforeFilter - payments.recordset.length} pagos ya registrados en control.`);

        if (!payments.recordset.length) {
            console.log('[OK] No hay pagos nuevos para procesar.');
            return;
        }

        // 4) Procesar cada pago restante
        for (let i = 0; i < payments.recordset.length; i++) {
            const hdr = payments.recordset[i];
            console.log(`\n[PROCESS] Procesando pago [${i + 1}/${payments.recordset.length}]: ${hdr.external_id}`);

            // 4.1) Consultar facturas asociadas
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
            console.log(`  [INFO] Ejecutando queryFacturasPagadas para lote ${hdr.LotePago} / asiento ${hdr.AsientoPago}...`);
            const invoices = await runQuery(queryFacturasPagadas, database[index])
                .catch(err => {
                    logGenerator('PortalPaymentController', 'error', `Error queryFacturasPagadas: ${err.message}`);
                    console.error('  [ERROR] Falló queryFacturasPagadas:', err.message);
                    return { recordset: [] };
                });

            if (!invoices.recordset.length) {
                console.log(`  [INFO] No hay facturas pagadas para Lote ${hdr.LotePago} / Asiento ${hdr.AsientoPago}.`);
                continue;
            }

            // 4.2) Construir cfdis con lógica de exchange_rate
            const cfdis = invoices.recordset.map(inv => {
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

            const allFull = invoices.recordset.every(inv =>
                inv.FULL_PAID === 1 || inv.FULL_PAID === '1'
            );
            console.log(`  [INFO] Estado pago completo? ${allFull}`);

            const d = hdr.payment_date.toString(); // YYYYMMDD
            const payment_date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T10:00:00.000Z`;

            // 4.3) Payload
            const payload = {
                bank_account_id: hdr.bank_account_id,
                cfdis,
                comments: hdr.comments,
                currency: hdr.bk_currency,
                external_id: hdr.external_id,
                ignore_amounts: false,
                open: false, // Campo fijo
                operation_type: hdr.operation_type,
                payment_date,
                provider_external_id: hdr.provider_external_id,
                reference: hdr.reference,
                total_amount: hdr.total_amount
            };

            //console.log('  [INFO] Payload generado:', JSON.stringify(payload, null, 2));

            // 4.4) Enviar al portal
            const endpoint = `${URL}/api/1.0/extern/tenants/${tenantIds[index]}/payments`;
            console.log(`  [INFO] POST ${endpoint}`);
            const resp = await axios.post(endpoint, payload, {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index],
                    'Content-Type': 'application/json'
                }
            }).catch(err => {
                logGenerator('PortalPaymentController', 'error', `Error POST payment: ${err.message}`);
                return err.response || { status: 500, data: err.message };
            });

            if (resp.status === 200) {
                const idPortal = resp.data && resp.data.id ? resp.data.id : undefined;
                console.log(`  [OK] Pago ${hdr.external_id} enviado con éxito (200)`);
                if (idPortal) {
                    console.log(`    [INFO] ID asignado por portal: ${idPortal}`);
                }
                logGenerator(
                    'PortalPaymentController',
                    'success',
                    `Pago ${hdr.external_id} enviado correctamente. Tenant: ${tenantIds[index]}, ID portal: ${idPortal ?? 'N/A'}`
                );

                // 4.5) Registrar en control table
                const statusTag = allFull ? 'PAID' : 'PARTIAL';
                // Insertar también el idFocaltec (id del portal)
                const insertSql = `
        INSERT INTO fesa.dbo.fesaPagosFocaltec
            (idCia, NoPagoSage, status, idFocaltec)
            VALUES
            ('${database[index]}',
            '${hdr.external_id}',
            '${statusTag}',
            ${idPortal ? `'${idPortal}'` : 'NULL'}
            )
        `;
                console.log(`  [INFO] INSERT control table con status='${statusTag}' y idFocaltec=${idPortal ?? 'NULL'}`);
                const result = await runQuery(insertSql)
                    .catch(err => {
                        logGenerator('PortalPaymentController', 'error', `Insert control table failed: ${err.message}`);
                        console.error('  ❌ Falló INSERT control table:', err.message);
                        return { rowsAffected: [0] };
                    });

                if (result.rowsAffected[0]) {
                    console.log(`  [OK] Control table actualizado para pago ${hdr.external_id}.`);
                } else {
                    console.warn(`  [WARN] No se insertó control para pago ${hdr.external_id}.`);
                }

            } else {
                console.error(`  [ERROR] Falló envío pago ${hdr.external_id}: ${resp.status}`);
                console.error('    Detalle:', resp.data);
                logGenerator(
                    'PortalPaymentController',
                    'error',
                    `Error al enviar pago ${hdr.external_id}: ${resp.status} ${JSON.stringify(resp.data)}`
                );
            }
        }

    } catch (err) {
        console.error('[ERROR] Error inesperado en uploadPayments:', err.message);
        logGenerator('PortalPaymentController', 'error', `Unexpected error: ${err.message}`);
        notifier.notify({
            title: 'Error en uploadPayments',
            message: err.message,
            sound: true,
            wait: true
        });
    }
}

module.exports = {
    uploadPayments
};
