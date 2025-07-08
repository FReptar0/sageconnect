const sql = require('mssql');
require('dotenv').config({ path: '.env.credentials.database' });

const dbConfig = {
    user: process.env.USER,
    password: process.env.PASSWORD,
    server: process.env.SERVER,
    database: process.env.DATABASE, // By default, the database is FESA
    connectionTimeout: 10000,          // 10 s para conectarse
    requestTimeout: 10000,          // 10 s para cada query
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
