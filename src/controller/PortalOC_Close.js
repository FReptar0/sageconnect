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

// preparamos arrays de tenants/keys/etc.
const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const databases = DATABASES.split(',');

const urlBase = (index) => `${URL}/api/1.0/extern/tenants/${tenantIds[index]}`;

async function closePurchaseOrders(index) {
    // fecha de hoy en formato YYYYMMDD
    const today = new Date();
    const oneMonthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate())
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, '');

    // 1) Obtener POs canceladas en Sage
    const sql = `SELECT DISTINCT RTRIM(A.PONUMBER) AS PONUMBER
      FROM POPORH1 A
      LEFT OUTER JOIN PORCPH1 B ON A.PORHSEQ = B.PORHSEQ
     WHERE (SELECT SUM(B.OQCANCELED) FROM POPORL B WHERE B.PORHSEQ = A.PORHSEQ) = 0
       AND A.ISCOMPLETE = 1
       AND A.DTCOMPLETE >= '${oneMonthAgo}'
       AND B.ISINVOICED = 1
       AND B.ISCOMPLETE = 1`;

    let recordset;
    try {
        ({ recordset } = await runQuery(sql, databases[index]));
        if (recordset.length === 0) {
            console.log(`[INFO] No se encontraron registros para la fecha ${oneMonthAgo.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}`);
            return;
        }
        console.log(`[INFO] Recuperadas ${recordset.length} filas de la base`);
    } catch (err) {
        console.error(`[ERROR] Error al ejecutar la consulta SQL en tenant ${tenantIds[index]}:`, err);
        return;
    }

    // 2) Para cada PO, verificar y cerrar
    for (let i = 0; i < recordset.length; i++) {
        const ponumber = recordset[i].PONUMBER;
        console.log(`\n[PROCESS] Procesando [${i + 1}/${recordset.length}] PO ${ponumber}`);

        // 2.1) Verificar en fesaOCFocaltec
        const checkSql = `
      SELECT RTRIM(idFocaltec) AS idFocaltec
        FROM dbo.fesaOCFocaltec
       WHERE ocSage     = '${ponumber}'
         AND idDatabase = '${databases[index]}'
         AND idFocaltec IS NOT NULL
         AND status     = 'POSTED'
    `;
        let existing;
        try {
            ({ recordset: existing } = await runQuery(checkSql, 'FESA'));
        } catch (err) {
            console.error(`❌ Error al verificar existencia en FESA para ${ponumber}:`, err);
            continue;
        }
        if (existing.length === 0) {
            console.log(`[WARN] PO ${ponumber} no registrada (POSTED) en FESA, omitiendo.`);
            continue;
        }

        // 2.2) Cerrar en portal (PUT)
        const idFocaltec = existing[0].idFocaltec;
        console.log(idFocaltec)
        const endpoint = `${urlBase(index)}/purchase-orders/${idFocaltec}/status`;
        try {
            const resp = await axios.put(
                endpoint,
                { status: 'CLOSED' },
                {
                    headers: {
                        'PDPTenantKey': apiKeys[index],
                        'PDPTenantSecret': apiSecrets[index],
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );
            console.log(
                `[INFO] [${i + 1}/${recordset.length}] PO ${ponumber} cerrada en portal\n` +
                `   -> Endpoint: ${endpoint}\n` +
                `   -> Status:   ${resp.status} ${resp.statusText}`
            );
        } catch (err) {
            console.error(`[ERROR] [${i + 1}/${recordset.length}] Error cerrando PO ${ponumber}:`);
            if (err.response) {
                console.error(`   -> ${err.response.status} ${err.response.statusText}`);
                console.error(`   -> Body:`, err.response.data);
            } else {
                console.error(`   -> ${err.message}`);
            }
            continue;
        }

        // 2.3) Actualizar FESA a CLOSED
        const updateSql = `
      UPDATE dbo.fesaOCFocaltec
         SET status     = 'CLOSED',
             lastUpdate = GETDATE()
       WHERE ocSage     = '${ponumber}'
         AND idDatabase = '${databases[index]}'
         AND idFocaltec IS NOT NULL
         AND status     = 'POSTED'
    `;
        try {
            await runQuery(updateSql, 'FESA');
            console.log(`[OK] PO ${ponumber} marcada CLOSED en FESA`);
        } catch (err) {
            console.error(`[ERROR] Error actualizando FESA para PO ${ponumber}:`, err);
        }
    }
}

// cancellationPurchaseOrders(0).catch(err=>{
//     console.log(err)
// })

module.exports = {
    closePurchaseOrders
};
