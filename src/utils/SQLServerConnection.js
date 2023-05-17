const sql = require('mssql');
require('dotenv').config({ path: '.env.credentials.database' });

const dbConfig = {
    user: process.env.USER,
    password: process.env.PASSWORD,
    server: process.env.SERVER,
    database: process.env.DATABASE, // por defecto, usa la base de datos FESA
};

async function runQuery(query, database = 'FESA') {
    const pool = await new sql.ConnectionPool({
        ...dbConfig,
        database: database, // si se especifica otra base de datos, se usa esa en vez de la FESA
        options: {
            trustServerCertificate: true
        }
    }).connect();

    const result = await pool.request().query(query);

    const returnValue = {
        recordset: result.recordset[0],
        rowsAffected: result.rowsAffected[0]
    }

    pool.close();
    return returnValue;
}

runQuery(`SELECT Valor as DataBaseName, idCia FROM FESAPARAM WHERE idCia IN ( SELECT idCia FROM fesaParam WHERE Parametro = 'RFCReceptor' AND Valor = 'CLO160720219')
AND Parametro = 'DataBase'`).then(result => {
    result.recordset.DataBaseName = result.recordset.DataBaseName.replace(/\s+/g, '')
    data = {
        database: result.recordset.DataBaseName,
        idCia: result.recordset.idCia
    }
    console.log(data)
})

module.exports = {
    runQuery
};
