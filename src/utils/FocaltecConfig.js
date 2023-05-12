const { runQuery } = require('./SQLServerConnection')
const notifier = require('node-notifier');

async function getFocaltecConfig() {
    try {
        const data = await runQuery(`SELECT [URL],[TenantId],[TenantKey],[TenantSecret]
        FROM (SELECT PARAMETRO, VALOR FROM FESA.dbo.fesaParam WHERE PARAMETRO IN ('URL', 'TenantId', 'TenantKey', 'TenantSecret') AND idCia = 'GRUPO' ) AS t
        PIVOT ( MIN(VALOR) FOR PARAMETRO IN ([URL], [TenantId], [TenantKey], [TenantSecret])) AS p;
        `);
        return data[0];
    } catch (error) {
        try {
            notifier.notify({
                title: 'Database Error',
                message: 'Error al obtener la configuracion de Focaltec: \n' + error + '\n',
                sound: true,
                wait: true
            });
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al obtener la configuracion de Focaltec: \n' + error + '\n');
        }
    }
}

async function updateFocaltecConfig(query) {
    try {
        const result = await runQuery(query);
        return result;
    } catch (error) {
        try {
            notifier.notify({
                title: 'Database Error',
                message: 'Error al actualizar los datos de Focaltec Config: \n' + error + '\n',
                sound: true,
                wait: true
            });
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al actualizar los datos de Focaltec Config: \n' + error + '\n');
        }
    }
}

async function insertFocaltecConfig(query) {
    try {
        const result = await runQuery(query);
        return result;
    } catch (error) {
        try {
            notifier.notify({
                title: 'Database Error',
                message: 'Error al insertar los datos de Focaltec Config: \n' + error + '\n',
                sound: true,
                wait: true
            });
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al insertar los datos de Focaltec Config: \n' + error + '\n');
        }
    }
}

module.exports = {
    getFocaltecConfig,
    updateFocaltecConfig,
    insertFocaltecConfig
}