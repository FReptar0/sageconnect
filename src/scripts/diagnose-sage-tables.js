/**
 * Diagnose Sage Tables
 *
 * Investigates why Sage 300 tables (APBTA, POPORH1, etc.) report
 * "Invalid object name" errors against the COPDAT database.
 *
 * Checks:
 *  1. Database existence on server
 *  2. Similar databases (LIKE 'COP%') for sanity
 *  3. Current SQL login + server context
 *  4. Sage tables presence in INFORMATION_SCHEMA.TABLES
 *  5. SELECT permission per table
 *  6. Row count per table (or capture access error)
 *  7. Schemas available in the target DB
 *  8. Variant lookup (LIKE '%APBTA%' / '%POPORH%') for prefixed tables
 *
 * Usage:
 *   node src/scripts/diagnose-sage-tables.js               # uses tenant DB or 'COPDAT'
 *   node src/scripts/diagnose-sage-tables.js COPDAT        # explicit DB
 */

const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { successResult, errorResult } = require('../utils/ResultEnvelope');
const config = require('../config');

const DEFAULT_DATABASE = (config.portal.tenants[0] && config.portal.tenants[0].database) || 'COPDAT';
const SAGE_TABLES = ['APBTA', 'POPORH1', 'APVENO', 'BKACCT', 'APTCR'];
const LOG_FILE = 'Sage_Tables_Diagnostic';

async function safeRun(label, fn) {
    try {
        return await fn();
    } catch (err) {
        console.log(`\n[!] ${label} -> ERROR: ${err.message}`);
        logGenerator(LOG_FILE, 'error', `${label}: ${err.message}`);
        return null;
    }
}

async function diagnoseSageTables(database = DEFAULT_DATABASE) {
    const startTime = Date.now();

    console.log('\n=== DIAGNOSTICO DE TABLAS SAGE ===');
    console.log(`Base de datos objetivo: ${database}`);
    console.log(`Servidor configurado:   ${config.database.server}`);
    console.log(`Login configurado:      ${config.database.user}`);
    console.log(`Default DB del config:  ${config.database.database}`);
    console.log(`Fecha:                  ${new Date().toISOString()}\n`);

    // 1. Existencia de la BD en el servidor
    console.log('1. EXISTE LA BASE DE DATOS EN EL SERVIDOR?');
    console.log('==========================================');
    await safeRun('check db existence', async () => {
        const result = await runQuery(
            `SELECT name, database_id, create_date, state_desc, collation_name
             FROM sys.databases WHERE name = '${database}'`,
            'master'
        );
        if (result.recordset.length === 0) {
            console.log(`[X] La base [${database}] NO existe en este servidor`);
        } else {
            console.table(result.recordset);
        }
    });

    // 2. Bases similares (para detectar typo o ambiente equivocado)
    console.log('\n2. BASES SIMILARES (LIKE COP%, %SAGE%, %FESA%)');
    console.log('==============================================');
    await safeRun('list similar dbs', async () => {
        const result = await runQuery(
            `SELECT name, state_desc
             FROM sys.databases
             WHERE name LIKE 'COP%' OR name LIKE '%SAGE%' OR name LIKE '%FESA%'
                OR name LIKE '%ELECT%' OR name LIKE '%AUTORI%'
             ORDER BY name`,
            'master'
        );
        console.table(result.recordset);
    });

    // 3. Quien soy yo en SQL Server?
    console.log('\n3. CONTEXTO DE LA SESION SQL');
    console.log('============================');
    await safeRun('whoami', async () => {
        const result = await runQuery(
            `SELECT
                SUSER_NAME() AS LoginName,
                CURRENT_USER AS UserName,
                @@SERVERNAME AS ServerName,
                @@VERSION AS SqlVersion,
                DB_NAME() AS DefaultDatabase`
        );
        console.table(result.recordset);
    });

    // 4. Tablas Sage en INFORMATION_SCHEMA
    console.log(`\n4. TABLAS SAGE EN [${database}]`);
    console.log('================================');
    await safeRun('list sage tables', async () => {
        const inList = SAGE_TABLES.map((t) => `'${t}'`).join(',');
        const result = await runQuery(
            `SELECT TABLE_SCHEMA AS Schema_Name,
                    TABLE_NAME AS Table_Name,
                    TABLE_TYPE AS Type
             FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_NAME IN (${inList})
             ORDER BY TABLE_NAME`,
            database
        );
        if (result.recordset.length === 0) {
            console.log(`[X] Ninguna tabla Sage encontrada en [${database}] vía INFORMATION_SCHEMA`);
            console.log(`    Tablas buscadas: ${SAGE_TABLES.join(', ')}`);
        } else {
            console.table(result.recordset);
        }
    });

    // 5. Permiso SELECT por tabla
    console.log(`\n5. PERMISO SELECT EN CADA TABLA`);
    console.log('===============================');
    await safeRun('check permissions', async () => {
        const unionSql = SAGE_TABLES
            .map(
                (t) =>
                    `SELECT '${t}' AS Tabla,
                           HAS_PERMS_BY_NAME('dbo.${t}', 'OBJECT', 'SELECT') AS HasSelect`
            )
            .join(' UNION ALL ');
        const result = await runQuery(unionSql, database);
        console.table(result.recordset);
    });

    // 6. Conteo de filas por tabla (revela errores específicos por tabla)
    console.log(`\n6. CONTEO DE FILAS (puede revelar errores específicos por tabla)`);
    console.log('================================================================');
    for (const tbl of SAGE_TABLES) {
        await safeRun(`count ${tbl}`, async () => {
            const result = await runQuery(
                `SELECT '${tbl}' AS Tabla, COUNT(*) AS Filas FROM [${database}].dbo.[${tbl}]`,
                database
            );
            console.table(result.recordset);
        });
    }

    // 7. Schemas disponibles en la BD objetivo
    console.log(`\n7. SCHEMAS DEFINIDOS POR USUARIO EN [${database}]`);
    console.log('=================================================');
    await safeRun('list schemas', async () => {
        const result = await runQuery(
            `SELECT name AS Schema_Name, schema_id, USER_NAME(principal_id) AS Owner
             FROM sys.schemas
             WHERE name NOT IN ('sys','INFORMATION_SCHEMA','guest','db_owner',
                                'db_accessadmin','db_securityadmin','db_ddladmin',
                                'db_backupoperator','db_datareader','db_datawriter',
                                'db_denydatareader','db_denydatawriter')
             ORDER BY name`,
            database
        );
        console.table(result.recordset);
    });

    // 8. Búsqueda de variantes (por si tienen prefijo de empresa o sufijo)
    console.log(`\n8. VARIANTES DE NOMBRES (LIKE %APBTA% / %POPORH%)`);
    console.log('=================================================');
    await safeRun('lookup variants', async () => {
        const result = await runQuery(
            `SELECT TABLE_SCHEMA AS Schema_Name, TABLE_NAME AS Table_Name
             FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_NAME LIKE '%APBTA%'
                OR TABLE_NAME LIKE '%POPORH%'
                OR TABLE_NAME LIKE '%APVEN%'
                OR TABLE_NAME LIKE '%BKACCT%'
                OR TABLE_NAME LIKE '%APTCR%'
             ORDER BY TABLE_NAME`,
            database
        );
        if (result.recordset.length === 0) {
            console.log('[X] Ningún nombre similar encontrado en INFORMATION_SCHEMA');
        } else {
            console.table(result.recordset);
        }
    });

    console.log('\n=== DIAGNOSTICO COMPLETADO ===');
    console.log('Copia y pega TODA la salida (desde "DIAGNOSTICO DE TABLAS SAGE" hasta acá)');
    console.log('al chat para análisis.\n');

    logGenerator(LOG_FILE, 'info', `Diagnóstico Sage tables completado para ${database}`);
    return successResult(
        { database, tablesChecked: SAGE_TABLES },
        `Diagnostic completed for ${database}`,
        { startTime }
    );
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const database = args[0] || DEFAULT_DATABASE;
    diagnoseSageTables(database)
        .then((result) => {
            process.exit(result.success ? 0 : 1);
        })
        .catch((err) => {
            console.error('\n[!] DIAGNOSTICO FALLIDO:', err.message);
            return errorResult([err.message], 'Sage tables diagnostic failed', {});
        })
        .finally(async () => {
            try {
                const { closePool } = require('../utils/SQLServerConnection');
                await closePool();
            } catch (_e) { /* ignore */ }
        });
}

module.exports = { diagnoseSageTables };
