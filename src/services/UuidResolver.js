const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { getCurrentDateCompact } = require('../utils/TimezoneHelper');
const { getCfdisByProvider } = require('../utils/GetTypesCFDI');

const LOG_FILE = 'UuidResolver';

/**
 * Busca el UUID de una factura en Portal de Proveedores y lo escribe en APIBHO.
 * @param {string} invoiceId - IDINVC de Sage (ej: "FV-12345")
 * @param {number} invBatch - CNTBTCH de la factura en APIBH
 * @param {number} invEntry - CNTITEM de la factura en APIBH
 * @param {string} providerId - ID del proveedor en el portal
 * @param {number} index - Índice del tenant
 * @param {string} db - Base de datos de Sage
 * @returns {Promise<boolean>} - true si se escribió el UUID
 */
async function resolveUuidByFolio(invoiceId, invBatch, invEntry, providerId, index, db) {
    try {
        const cfdis = await getCfdisByProvider(index, providerId);
        if (cfdis.length === 0) {
            console.warn(`  [WARN] No se encontraron CFDIs en portal para provider ${providerId}`);
            logGenerator(LOG_FILE, 'warn', `No CFDIs found for provider ${providerId} (invoice: ${invoiceId})`);
            return false;
        }

        // Buscar CFDI que coincida por folio
        const idinvc = invoiceId.trim();
        const match = cfdis.find(c => {
            const folio = (c.cfdi?.folio || '').toString().trim();
            const serie = (c.cfdi?.serie || '').toString().trim();
            return folio === idinvc || (serie + folio) === idinvc;
        });

        if (!match || !match.cfdi?.timbre?.uuid) {
            console.warn(`  [WARN] No se encontró CFDI con folio ${idinvc} para provider ${providerId}`);
            logGenerator(LOG_FILE, 'warn', `No CFDI match for folio ${idinvc} (provider: ${providerId})`);
            return false;
        }

        const uuid = match.cfdi.timbre.uuid;

        // Verificar si ya existe la fila en APIBHO
        const existing = await runQuery(
            `SELECT COUNT(*) AS cnt FROM APIBHO WHERE CNTBTCH = ${invBatch} AND CNTITEM = ${invEntry} AND OPTFIELD = 'FOLIOCFD'`, db
        );

        if (existing.recordset[0].cnt > 0) {
            await runQuery(
                `UPDATE APIBHO SET [VALUE] = '${uuid}' WHERE CNTBTCH = ${invBatch} AND CNTITEM = ${invEntry} AND OPTFIELD = 'FOLIOCFD'`, db
            );
        } else {
            // Descubrir esquema de una fila existente para el INSERT
            let schemaRow = null;
            try {
                const schema = await runQuery(`SELECT TOP 1 * FROM APIBHO WHERE OPTFIELD = 'FOLIOCFD'`, db);
                if (schema.recordset.length > 0) schemaRow = schema.recordset[0];
            } catch { /* ignore */ }

            const audtdate = getCurrentDateCompact();
            const type = schemaRow?.TYPE ?? 1;
            const length = schemaRow?.LENGTH ?? 60;
            const decimals = schemaRow?.DECIMALS ?? 0;
            const allownull = schemaRow?.ALLOWNULL ?? 0;
            const validate = schemaRow?.VALIDATE ?? 0;
            const audtuser = schemaRow?.AUDTUSER ? schemaRow.AUDTUSER.trim() : 'ADMIN';
            const audtorg = schemaRow?.AUDTORG ? schemaRow.AUDTORG.trim() : '';

            await runQuery(`
                INSERT INTO APIBHO
                    (CNTBTCH, CNTITEM, OPTFIELD, AUDTDATE, AUDTTIME, AUDTUSER, AUDTORG,
                    [VALUE], [TYPE], [LENGTH], DECIMALS, ALLOWNULL, VALIDATE, SWSET)
                VALUES
                    (${invBatch}, ${invEntry}, 'FOLIOCFD',
                    ${audtdate}, 0, '${audtuser}', '${audtorg}',
                    '${uuid}', ${type}, ${length}, ${decimals}, ${allownull}, ${validate}, 1)
            `, db);
        }

        console.log(`  [AUTO-FIX] UUID '${uuid}' escrito en APIBHO para factura ${idinvc} (batch: ${invBatch}, entry: ${invEntry})`);
        logGenerator(LOG_FILE, 'info', `UUID '${uuid}' escrito en APIBHO para factura ${idinvc} (batch: ${invBatch}, entry: ${invEntry})`);
        return true;
    } catch (err) {
        console.error(`  [ERROR] resolveUuidByFolio falló para factura ${invoiceId}: ${err.message}`);
        logGenerator(LOG_FILE, 'error', `resolveUuidByFolio falló para factura ${invoiceId}: ${err.message}`);
        return false;
    }
}

module.exports = { resolveUuidByFolio };
