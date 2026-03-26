const sql = require('mssql');
const config = require('../config');

const dbConfig = {
    user: config.database.user,
    password: config.database.password,
    server: config.database.server,
    database: config.database.database, // By default, the database is FESA
    connectionTimeout: 15000,          // 15 s para conectarse
    requestTimeout: 180000,            // 3 min para cada query (aumentado para reconciliación de pagos históricos)
};

async function runQuery(query, database = 'FESA') {
    const pool = await new sql.ConnectionPool({
        ...dbConfig,
        database: database, // If the database is not specified, the default database is FESA
        options: {
            trustServerCertificate: true
        }
    }).connect();

    const result = await pool.request().query(query);

    //console.log(result)

    pool.close();
    return result;
}

module.exports = {
    runQuery
};
