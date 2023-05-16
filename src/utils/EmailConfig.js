const { runQuery } = require('./SQLServerConnection')
const notifier = require('node-notifier');

async function getEmailConfig() {
    try {
        const data = await runQuery(`SELECT [CLIENT_ID],[CorreoEnvio],[CorreoAvisos],[REFRESH_TOKEN],[SECRET_CLIENT]
        FROM (
        SELECT PARAMETRO, VALOR
        FROM FESA.dbo.fesaParam
        WHERE PARAMETRO IN ('CLIENT_ID','CorreoEnvio','CorreoAvisos','REFRESH_TOKEN','SECRET_CLIENT')
            AND idCia = 'GRUPO'
        ) AS t
        PIVOT (
        MIN(VALOR)
        FOR PARAMETRO IN ([CLIENT_ID],[CorreoEnvio],[CorreoAvisos],[REFRESH_TOKEN],[SECRET_CLIENT]
        )
        ) AS p;`);
        return data[0];
    } catch (error) {
        try {
            notifier.notify({
                title: 'Database Error',
                message: 'Error al obtener la configuracion de correo: \n' + error + '\n',
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (err) {

        }
    }
}

module.exports = {
    getEmailConfig
}