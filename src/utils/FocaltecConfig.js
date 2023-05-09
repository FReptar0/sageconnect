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

module.exports = {
    getConfig
}