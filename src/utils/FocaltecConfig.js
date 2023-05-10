const { runQuery } = require('./SQLServerConnection')

async function getConfig() {
    try {
        const data = await runQuery(`SELECT [URL],[TenantId],[TenantKey],[TenantSecret]
        FROM (SELECT PARAMETRO, VALOR FROM FESA.dbo.fesaParam WHERE PARAMETRO IN ('URL', 'TenantId', 'TenantKey', 'TenantSecret') AND idCia = 'GRUPO' ) AS t
        PIVOT ( MIN(VALOR) FOR PARAMETRO IN ([URL], [TenantId], [TenantKey], [TenantSecret])) AS p;
        `);
        return data[0];
    } catch (error) {
        throw new Error('Error al obtener la configuracion: \n' + error + '\n');
    }
}

async function updateConfig(query) {
    try {
        const result = await runQuery(query);
        return result;
    } catch (error) {
        throw new Error('Error al actualizar los datos de Focaltec Config: \n' + error + '\n');
    }
}

async function insertConfig(query) {
    try {
        const result = await runQuery(query);
        return result;
    } catch (error) {
        throw new Error('Error al insertar los datos de Focaltec Config: \n' + error + '\n');
    }
}

module.exports = {
    getConfig,
    updateConfig,
    insertConfig
}