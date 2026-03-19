const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { getCurrentDateCompact } = require('../utils/TimezoneHelper');
const { getProviderByExternalId } = require('../utils/GetProviders');

const LOG_FILE = 'ProviderIdResolver';

/**
 * Busca el proveedor en Portal de Proveedores por external_id y escribe su ID en APVENO.
 * @param {string} vendorId - VENDORID de Sage (ej: "534-0039")
 * @param {string} providerExternalId - External ID del proveedor en ERP
 * @param {number} index - Índice del tenant
 * @param {string} db - Base de datos de Sage
 * @returns {Promise<boolean>} - true si se escribió el PROVIDERID
 */
async function resolveProviderIdByExternalId(vendorId, providerExternalId, index, db) {
    try {
        const provider = await getProviderByExternalId(index, providerExternalId);
        if (!provider || !provider.id) {
            console.warn(`  [WARN] No se encontró proveedor único en portal con externalId: ${providerExternalId}`);
            logGenerator(
                LOG_FILE,
                'warn',
                `No se encontró proveedor único en portal con externalId: ${providerExternalId} (vendor: ${vendorId})`
            );
            return false;
        }

        const providerId = provider.id;

        // Verificar si ya existe la fila en APVENO
        const existing = await runQuery(
            `SELECT COUNT(*) AS cnt FROM APVENO WHERE VENDORID = '${vendorId}' AND OPTFIELD = 'PROVIDERID'`, db
        );

        if (existing.recordset[0].cnt > 0) {
            await runQuery(
                `UPDATE APVENO SET [VALUE] = '${providerId}' WHERE VENDORID = '${vendorId}' AND OPTFIELD = 'PROVIDERID'`, db
            );
        } else {
            // Descubrir esquema de una fila existente para el INSERT
            let schemaRow = null;
            try {
                const schema = await runQuery(`SELECT TOP 1 * FROM APVENO WHERE OPTFIELD = 'PROVIDERID'`, db);
                if (schema.recordset.length > 0) schemaRow = schema.recordset[0];
            } catch { /* ignore */ }
            if (!schemaRow) {
                try {
                    const schema = await runQuery(`SELECT TOP 1 * FROM APVENO`, db);
                    if (schema.recordset.length > 0) schemaRow = schema.recordset[0];
                } catch { /* ignore */ }
            }

            const audtdate = getCurrentDateCompact();
            const type = schemaRow?.TYPE ?? 1;
            const length = schemaRow?.LENGTH ?? 60;
            const decimals = schemaRow?.DECIMALS ?? 0;
            const allownull = schemaRow?.ALLOWNULL ?? 0;
            const validate = schemaRow?.VALIDATE ?? 0;
            const audtuser = schemaRow?.AUDTUSER ? schemaRow.AUDTUSER.trim() : 'ADMIN';
            const audtorg = schemaRow?.AUDTORG ? schemaRow.AUDTORG.trim() : '';

            await runQuery(`
                INSERT INTO APVENO
                    (VENDORID, OPTFIELD, AUDTDATE, AUDTTIME, AUDTUSER, AUDTORG,
                     [VALUE], [TYPE], [LENGTH], DECIMALS, ALLOWNULL, VALIDATE, SWSET)
                VALUES
                    ('${vendorId}', 'PROVIDERID',
                     ${audtdate}, 0, '${audtuser}', '${audtorg}',
                     '${providerId}', ${type}, ${length}, ${decimals}, ${allownull}, ${validate}, 1)
            `, db);
        }

        console.log(
            `  [AUTO-FIX] PROVIDERID '${providerId}' escrito en APVENO para vendor ${vendorId} (externalId: ${providerExternalId})`
        );
        logGenerator(
            LOG_FILE,
            'info',
            `PROVIDERID '${providerId}' escrito en APVENO para vendor ${vendorId} (externalId: ${providerExternalId})`
        );
        return true;
    } catch (err) {
        console.error(`  [ERROR] resolveProviderIdByExternalId falló para ${vendorId}: ${err.message}`);
        logGenerator(LOG_FILE, 'error', `resolveProviderIdByExternalId falló para ${vendorId}: ${err.message}`);
        return false;
    }
}

module.exports = { resolveProviderIdByExternalId };
