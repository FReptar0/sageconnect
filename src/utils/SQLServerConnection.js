const sql = require('mssql');

const config = {
    user: 'user',
    password: 'password',
    server: 'server_name',
    database: 'database_name',
    //  port: , // descomentar si se usa un puerto diferente al 1433
    options: {
        encrypt: true // si la conexión se realiza a través de SSL
    }
};

async function conectarDB() {
    try {
        const pool = await sql.connect(config);
        console.log('Conexión exitosa');
        return pool;
    } catch (error) {
        console.log('Error al conectar a la base de datos: ', error);
        throw error;
    }
}

module.exports = {
    conectarDB
};
