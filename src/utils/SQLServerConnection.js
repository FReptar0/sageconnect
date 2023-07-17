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

    console.log(result)


    const returnValue = {
        rowsAffected: result.rowsAffected[0],
        recordset: result.recordset == undefined ? [] : result.recordset[0],
        length: result.recordset == undefined ? 0 : result.recordset.length
    }

    pool.close();
    return returnValue;
}

module.exports = {
    runQuery
};
