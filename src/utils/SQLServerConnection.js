const sql = require('mssql');
const config = require('../config');

const poolConfig = {
    user: config.database.user,
    password: config.database.password,
    server: config.database.server,
    database: config.database.database, // Default database (FESA)
    pool: {
        max: 10,
        min: 2,
        idleTimeoutMillis: 30000,
    },
    options: {
        trustServerCertificate: true,
    },
    connectionTimeout: 15000,
    requestTimeout: 60000,
};

let poolPromise = null;

/**
 * Returns the singleton pool promise. Creates the pool on first call.
 * Subsequent calls return the same promise (singleton pattern).
 */
function getPool() {
    if (!poolPromise) {
        const pool = new sql.ConnectionPool(poolConfig);
        pool.on('error', (err) => {
            console.error('[SQLServerConnection] Pool error:', err.message);
            poolPromise = null;
        });
        poolPromise = pool.connect();
    }
    return poolPromise;
}

/**
 * Execute a SQL query using the singleton pool.
 * Signature is identical to the previous implementation for backward compatibility.
 *
 * @param {string} query - SQL query to execute
 * @param {string} database - Target database (defaults to config default, typically 'FESA')
 * @returns {Promise<object>} mssql query result
 */
async function runQuery(query, database = 'FESA') {
    const pool = await getPool();
    const request = pool.request();

    // If targeting a non-default database, prepend USE [database] to run as a single batch
    const fullQuery = database !== config.database.database
        ? `USE [${database}]; ${query}`
        : query;

    return request.query(fullQuery);
}

/**
 * Close the singleton pool and reset so next getPool() creates a fresh one.
 */
async function closePool() {
    if (poolPromise) {
        const pool = await poolPromise;
        poolPromise = null;
        await pool.close();
    }
}

module.exports = {
    runQuery,
    closePool,
    getPool,
};
