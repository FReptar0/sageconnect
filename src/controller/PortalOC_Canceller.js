// src/controller/PortalPurchaseOrderCancellation.js

const axios = require('axios');
const dotenv = require('dotenv');

// carga las credenciales del portal de proveedores
const creds = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const {
    TENANT_ID,
    API_KEY,
    API_SECRET,
    URL,
    DATABASES
} = creds;

// utilería de conexión
const { runQuery } = require('../utils/SQLServerConnection');
const { getCurrentDateCompact } = require('../utils/TimezoneHelper');
const { logGenerator } = require('../utils/LogGenerator');

// preparamos arrays de tenants/keys/etc.
const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const databases = DATABASES.split(',');
const urlBase = (index) => `${URL}/api/1.0/extern/tenants/${tenantIds[index]}`;

async function cancellationPurchaseOrders(index) {
    // fecha de hoy en formato YYYYMMDD
    const today = getCurrentDateCompact();
    const logFileName = 'PortalOC_Canceller';
    
    console.log(`[INICIO] Ejecutando proceso de cancelación de órdenes de compra - Tenant: ${tenantIds[index]} - Fecha: ${today}`);

    // 1) Obtener POs canceladas en Sage
    const sql = `
    SELECT RTRIM(A.PONUMBER) AS PONUMBER
      FROM POPORH1 A
     WHERE (SELECT SUM(B.OQCANCELED)
              FROM POPORL B
             WHERE B.PORHSEQ = A.PORHSEQ) > 0
       AND A.ISCOMPLETE = 1
       AND A.DTCOMPLETE  = '${today}'
  `;
    let recordset;
    try {
        ({ recordset } = await runQuery(sql, databases[index]));
        console.log(`[INFO] Recuperadas ${recordset.length} filas de la base`);
        logGenerator(logFileName, 'info', `[INFO] Iniciando cancellationPurchaseOrders para index=${index}. Total de registros recuperados: ${recordset.length}`);
    } catch (err) {
        logGenerator(logFileName, 'error', `[ERROR] Error al ejecutar la consulta SQL en tenant ${tenantIds[index]}: ${err.message}`);
        return;
    }

    // 2) Para cada PO, verificar y cancelar
    for (let i = 0; i < recordset.length; i++) {
        const ponumber = recordset[i].PONUMBER;

        // 2.1) Verificar en fesaOCFocaltec
        const checkSql = `
      SELECT RTRIM(idFocaltec) AS idFocaltec
        FROM fesa.dbo.fesaOCFocaltec
       WHERE ocSage     = '${ponumber}'
         AND idDatabase = '${databases[index]}'
         AND idFocaltec IS NOT NULL
         AND status     = 'POSTED'
    `;
        let existing;
        try {
            ({ recordset: existing } = await runQuery(checkSql, 'FESA'));
        } catch (err) {
            logGenerator(logFileName, 'error', `[ERROR] Error al verificar existencia en FESA para ${ponumber}: ${err.message}`);
            continue;
        }
        if (existing.length === 0) {
            logGenerator(logFileName, 'warn', `[WARN] PO ${ponumber} no registrada (POSTED) en FESA, omitiendo.`);
            continue;
        }

        // 2.2) Cancelar en portal (PUT)
        const idFocaltec = existing[0].idFocaltec;
        const endpoint = `${urlBase(index)}/purchase-orders/${idFocaltec}/status`;
        try {
            const resp = await axios.put(
                endpoint,
                { status: 'CANCELLED' },
                {
                    headers: {
                        'PDPTenantKey': apiKeys[index],
                        'PDPTenantSecret': apiSecrets[index],
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );
            logGenerator(logFileName, 'info', `[OK] PO ${ponumber} cancelada en portal. Status: ${resp.status} ${resp.statusText}`);
        } catch (err) {
            let errorMsg = '';
            if (err.response) {
                errorMsg = `${err.response.status} ${err.response.statusText}: ${JSON.stringify(err.response.data)}`;
            } else {
                errorMsg = err.message;
            }
            logGenerator(logFileName, 'error', `[ERROR] Error cancelando PO ${ponumber}: ${errorMsg}`);
            continue;
        }

        // 2.3) Actualizar FESA a CANCELLED
        const updateSql = `
      UPDATE fesa.dbo.fesaOCFocaltec
         SET status     = 'CANCELLED',
             lastUpdate = GETDATE()
       WHERE ocSage     = '${ponumber}'
         AND idDatabase = '${databases[index]}'
         AND idFocaltec IS NOT NULL
         AND status     = 'POSTED'
    `;
        try {
            await runQuery(updateSql, 'FESA');
            logGenerator(logFileName, 'info', `[OK] PO ${ponumber} marcada CANCELLED en FESA`);
        } catch (err) {
            console.error(`[ERROR] Error actualizando FESA para PO ${ponumber}:`, err);
            logGenerator(logFileName, 'error', `[ERROR] Error actualizando FESA para PO ${ponumber}: ${err.message}`);
        }
    }
}

// cancellationPurchaseOrders(0).catch(err=>{
//     logGenerator('PortalOC_Canceller', 'error', `[ERROR] Unhandled error: ${err.message}`);
// })

module.exports = {
    cancellationPurchaseOrders
};
