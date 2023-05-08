const sql = require('mssql');

const dbConfig = {
    user: 'usuario',
    password: 'contraseña',
    server: 'servidor',
    database: 'FESA', // por defecto, usa la base de datos FESA
    port: 1433
};

async function runQuery(query, database = 'FESA') {
    const pool = await new sql.ConnectionPool({
        ...dbConfig,
        database: database // si se especifica otra base de datos, se usa esa en vez de la FESA
    }).connect();

    const result = await pool.request().query(query);

    pool.close();

    return result.recordset;
}

module.exports = {
    runQuery
};
