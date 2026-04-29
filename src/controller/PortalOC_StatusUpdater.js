// controller/PortalOC_StatusUpdater.js

const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { successResult, errorResult } = require('../utils/ResultEnvelope');
const portalClient = require('../utils/PortalClient');
const http = require('http');
const https = require('https');
const config = require('../config');

const tenantIds = config.portal.tenants.map(t => t.id);
const apiKeys = config.portal.tenants.map(t => t.key);
const apiSecrets = config.portal.tenants.map(t => t.secret);
const databases = config.portal.tenants.map(t => t.database);

const VALID_STATUSES = new Set(['OPEN', 'CLOSED', 'CANCELLED', 'GENERATED']);

// se fuerza el puerto local para todas las solicitudes salientes
const agentOptions = {
    localPort: 3030,
    keepAlive: true
};
const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

const urlBase = (index) => `${config.portal.url}/api/1.0/extern/tenants/${tenantIds[index]}`;

/**
 * Updates the status of a purchase order in the Portal and local control table.
 *
 * @param {string} ocSage - Sage purchase order identifier
 * @param {string} status - New status (OPEN, CLOSED, CANCELLED, GENERATED)
 * @param {string} idDatabase - Tenant database identifier
 * @returns {Promise<object>} ResultEnvelope with success/error details
 */
async function updatePOStatus(ocSage, status, idDatabase) {
    const startTime = Date.now();
    const logFileName = 'PortalOC_StatusUpdater';

    // --- Argument validation ---
    if (!ocSage || !status || !idDatabase) {
        return errorResult(
            'Uso: updatePOStatus(ocSage, status, idDatabase) -- todos los argumentos son requeridos',
            `Argumentos faltantes: OC=${ocSage || 'N/A'}, status=${status || 'N/A'}, db=${idDatabase || 'N/A'}`,
            { startTime }
        );
    }
    if (!VALID_STATUSES.has(status)) {
        return errorResult(
            `Status invalido: '${status}'. Debe ser uno de: ${[...VALID_STATUSES].join(', ')}`,
            `Status invalido para OC=${ocSage}`,
            { startTime }
        );
    }
    const dbIndex = databases.indexOf(idDatabase);
    if (dbIndex < 0) {
        return errorResult(
            `idDatabase desconocido: '${idDatabase}'`,
            `Base de datos no configurada para OC=${ocSage}`,
            { startTime }
        );
    }

    try {
        // 1) Buscar control record valido
        const checkSql = `
      SELECT RTRIM(idFocaltec) AS idFocaltec
      FROM fesa.dbo.fesaOCFocaltec
      WHERE ocSage     = '${ocSage}'
        AND idDatabase = '${idDatabase}'
        AND idFocaltec IS NOT NULL
        AND status     <> 'ERROR'
      ORDER BY createdAt DESC
    `;
        const { recordset } = await runQuery(checkSql, 'FESA');
        if (!recordset.length) {
            logGenerator(logFileName, 'warn', `[WARN] No se encontro registro valido para OC=${ocSage}, DB=${idDatabase}`);
            return errorResult(
                `No se encontro registro valido para OC=${ocSage}, DB=${idDatabase}`,
                `Sin registro en fesaOCFocaltec`,
                { startTime }
            );
        }
        const idFocaltec = recordset[0].idFocaltec;

        // 2) Enviar PUT al portal usando el puerto local 3030
        const endpoint = `${urlBase(dbIndex)}/purchase-orders/${idFocaltec}/status`;
        let apiResp;
        try {
            apiResp = await portalClient.put(
                endpoint,
                { status },
                {
                    headers: {
                        'PDPTenantKey': apiKeys[dbIndex],
                        'PDPTenantSecret': apiSecrets[dbIndex],
                        'Content-Type': 'application/json'
                    },
                    httpAgent,
                    httpsAgent
                }
            );
            logGenerator(logFileName, 'info', `[INFO] Portal respondio ${apiResp.status} para OC=${ocSage}`);
        } catch (err) {
            const msg = err.response
                ? `${err.response.status} ${JSON.stringify(err.response.data)}`
                : err.message;
            logGenerator(logFileName, 'error', `[ERROR] Error al llamar portal: ${msg}`);
            return errorResult(
                `Error al llamar portal: ${msg}`,
                `Fallo API para OC=${ocSage}`,
                { startTime }
            );
        }

        // 3) Actualizar la tabla de control en FESA
        const updateSql = `
      UPDATE fesa.dbo.fesaOCFocaltec
         SET status     = '${status}',
             lastUpdate = GETDATE()
       WHERE ocSage     = '${ocSage}'
         AND idDatabase = '${idDatabase}'
         AND idFocaltec IS NOT NULL
    `;
        await runQuery(updateSql, 'FESA');
        logGenerator(logFileName, 'info', `[INFO] Control actualizado para OC=${ocSage} a ${status}`);

        return successResult(
            { ocSage, status, idFocaltec, apiStatus: apiResp.status },
            `OC ${ocSage} actualizado a ${status}`,
            { startTime }
        );

    } catch (err) {
        logGenerator(logFileName, 'error', `[ERROR] Error inesperado: ${err.message}`);
        return errorResult(
            `Error inesperado: ${err.message}`,
            `Error inesperado para OC=${ocSage}`,
            { startTime }
        );
    }
}

// CLI backward compatibility: run as standalone script
if (require.main === module) {
    const [, , ocSage, status, idDatabase] = process.argv;
    console.log(`[INICIO] Ejecutando actualizacion de estado de orden de compra - OC: ${ocSage || 'N/A'} - Estado: ${status || 'N/A'} - Base: ${idDatabase || 'N/A'}`);

    updatePOStatus(ocSage, status, idDatabase).then((result) => {
        if (result.success) {
            console.log(`[OK] ${result.summary}`);
            process.exit(0);
        } else {
            console.error(`[ERROR] ${result.errors.join(', ')}`);
            process.exit(1);
        }
    }).catch((err) => {
        console.error('[ERROR]', err);
        process.exit(1);
    });
}

module.exports = { updatePOStatus };
