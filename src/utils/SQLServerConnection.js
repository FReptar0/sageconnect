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

    let returnValue = {
        recordset: null,
        rowsAffected: 0
    }

    if (result.recordset.length > 0) {
        returnValue.recordset = result.recordset[0];
    }

    if (result.rowsAffected.length > 0) {
        returnValue.rowsAffected = result.rowsAffected[0];
    }

    pool.close();
    return returnValue;
}

module.exports = {
    runQuery
};
