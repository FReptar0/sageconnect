// scripts/updatePOStatus.js

const { runQuery } = require('../src/utils/SQLServerConnection');
const { logGenerator } = require('../src/utils/LogGenerator');
const axios = require('axios');
const http = require('http');
const https = require('https');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.credentials.focaltec' });
const creds = process.env;

const {
    TENANT_ID,
    API_KEY,
    API_SECRET,
    URL,
    DATABASES
} = creds;

const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const databases = DATABASES.split(',');

const VALID_STATUSES = new Set(['OPEN', 'CLOSED', 'CANCELLED', 'GENERATED']);

// se fuerza el puerto local para todas las solicitudes salientes
const agentOptions = {
    localPort: 3030,
    keepAlive: true
};
const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

async function main() {
    const [, , ocSage, status, idDatabase] = process.argv;

    if (!ocSage || !status || !idDatabase) {
        console.error('Uso: node updatePOStatus.js <ocSage> <status> <idDatabase>');
        process.exit(1);
    }
    if (!VALID_STATUSES.has(status)) {
        console.error(`status inválido. Debe ser uno de: ${[...VALID_STATUSES].join(',')}`);
        process.exit(1);
    }
    const dbIndex = databases.indexOf(idDatabase);
    if (dbIndex < 0) {
        console.error(`idDatabase desconocido: '${idDatabase}'`);
        process.exit(1);
    }

    try {
        // 1) Buscar control record válido
        const checkSql = `
      SELECT RTRIM(idFocaltec) AS idFocaltec
      FROM dbo.fesaOCFocaltec
      WHERE ocSage     = '${ocSage}'
        AND idDatabase = '${idDatabase}'
        AND idFocaltec IS NOT NULL
        AND status     <> 'ERROR'
      ORDER BY createdAt DESC
    `;
        const { recordset } = await runQuery(checkSql, 'FESA');
        if (!recordset.length) {
            logGenerator('updatePOStatus', 'warn', `No se encontró registro válido para OC=${ocSage}, DB=${idDatabase}`);
            process.exit(1);
        }
        const idFocaltec = recordset[0].idFocaltec;

        // 2) Enviar PUT al portal usando el puerto local 3030
        const endpoint = `${URL}/api/1.0/extern/tenants/${tenantIds[dbIndex]}/purchase-orders/${idFocaltec}/status`;
        let apiResp;
        try {
            apiResp = await axios.put(
                endpoint,
                { status },
                {
                    headers: {
                        'PDPTenantKey': apiKeys[dbIndex],
                        'PDPTenantSecret': apiSecrets[dbIndex],
                        'Content-Type': 'application/json'
                    },
                    httpAgent,
                    httpsAgent,
                    timeout: 30000
                }
            );
            logGenerator('updatePOStatus', 'info', `Portal respondio ${apiResp.status} para OC=${ocSage}`);
        } catch (err) {
            const msg = err.response
                ? `${err.response.status} ${JSON.stringify(err.response.data)}`
                : err.message;
            logGenerator('updatePOStatus', 'error', `Error al llamar portal: ${msg}`);
            process.exit(1);
        }

        // 3) Actualizar la tabla de control en FESA
        const updateSql = `
      UPDATE dbo.fesaOCFocaltec
         SET status     = '${status}',
             lastUpdate = GETDATE()
       WHERE ocSage     = '${ocSage}'
         AND idDatabase = '${idDatabase}'
         AND idFocaltec IS NOT NULL
    `;
        await runQuery(updateSql, 'FESA');
        logGenerator('updatePOStatus', 'info', `Control actualizado para OC=${ocSage} a ${status}`);

        console.log(`✔ OC ${ocSage} actualizado a ${status}`);
        process.exit(0);

    } catch (err) {
        logGenerator('updatePOStatus', 'error', `Error inesperado: ${err.message}`);
        console.error(err);
        process.exit(1);
    }
}

main();
