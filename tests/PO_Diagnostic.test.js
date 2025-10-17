// tests/PO_Diagnostic.test.js

const { runQuery } = require('../src/utils/SQLServerConnection');
const { logGenerator } = require('../src/utils/LogGenerator');

/**
 * Diagnóstico completo para verificar por qué una OC no está siendo procesada
 * @param {string} poNumber - Número de la orden de compra (ej: 'PO0075624')
 * @param {string} database - Base de datos a consultar (ej: 'COPDAT')
 * @param {string} empresa - Empresa en autorizaciones (ej: 'COPDAT')
 */
async function diagnosticPO(poNumber, database = 'COPDAT', empresa = 'COPDAT') {
    const logFileName = 'PO_Diagnostic';
    console.log(`\n=== DIAGNÓSTICO COMPLETO PARA ${poNumber} ===`);
    console.log(`Base de datos: ${database}`);
    console.log(`Empresa: ${empresa}`);
    console.log(`Fecha actual: ${new Date().toISOString().slice(0, 10)}\n`);

    try {
        // 1. Verificar si existe en POPORH1
        console.log('1. ¿EXISTE EN POPORH1?');
        console.log('========================');
        const existsQuery = `
            SELECT 
                COUNT(*) as Existe,
                CASE 
                    WHEN COUNT(*) > 0 THEN 'SÍ EXISTE' 
                    ELSE 'NO EXISTE' 
                END as Estado
            FROM ${database}.dbo.POPORH1 
            WHERE PONUMBER = '${poNumber}'`;
        
        const existsResult = await runQuery(existsQuery);
        console.table(existsResult.recordset);
        
        if (existsResult.recordset[0].Existe === 0) {
            console.log('❌ ERROR: La OC no existe en POPORH1. Verifica el número de OC.');
            return;
        }

        // 3. Verificar campos opcionales (AFE y USOCFDI)
        console.log('\n3. CAMPOS OPCIONALES (AFE Y USOCFDI)');
        console.log('====================================');
        const optionalFieldsQuery = `
            SELECT 
                RTRIM(H.PONUMBER) as PONUMBER,
                RTRIM(ISNULL(C1.[VALUE], 'NO ENCONTRADO')) as AFE_VALUE,
                RTRIM(ISNULL(C2.[VALUE], 'NO ENCONTRADO')) as CFDI_USE
            FROM ${database}.dbo.POPORH1 H
            LEFT OUTER JOIN ${database}.dbo.POPORHO C1
                ON H.PORHSEQ = C1.PORHSEQ AND C1.OPTFIELD = 'AFE'
            LEFT OUTER JOIN ${database}.dbo.POPORHO C2
                ON H.PORHSEQ = C2.PORHSEQ AND C2.OPTFIELD = 'USOCFDI'
            WHERE H.PONUMBER = '${poNumber}'`;
        
        const optionalResult = await runQuery(optionalFieldsQuery);
        console.table(optionalResult.recordset);

        // 4. Verificar autorización
        console.log('\n4. ESTADO DE AUTORIZACIÓN');
        console.log('=========================');
        const authQuery = `
            SELECT 
                PONumber,
                ISNULL(Autorizada, 0) as Autorizada,
                Empresa,
                CASE 
                    WHEN ISNULL(Autorizada, 0) = 1 THEN 'AUTORIZADA' 
                    ELSE 'NO AUTORIZADA' 
                END as Estado
            FROM Autorizaciones_electronicas.dbo.Autoriza_OC 
            WHERE PONumber = '${poNumber}' 
                AND Empresa = '${empresa}'`;
        
        const authResult = await runQuery(authQuery);
        if (authResult.recordset.length === 0) {
            console.log('❌ No se encontró registro en Autoriza_OC');
            console.table([{ PONumber: poNumber, Estado: 'NO ENCONTRADA EN AUTORIZACIONES' }]);
        } else {
            console.table(authResult.recordset);
        }

        // 5. Verificar fecha de autorización
        console.log('\n5. FECHA DE AUTORIZACIÓN');
        console.log('========================');
        const authDateQuery = `
            SELECT 
                PONumber,
                MAX(Fecha) as UltimaAutorizacion,
                CAST(GETDATE() AS DATE) as FechaHoy,
                CASE 
                    WHEN MAX(Fecha) = CAST(GETDATE() AS DATE) THEN 'AUTORIZADA HOY' 
                    WHEN MAX(Fecha) IS NOT NULL THEN 'AUTORIZADA EN OTRA FECHA'
                    ELSE 'SIN AUTORIZACIONES' 
                END as Estado
            FROM Autorizaciones_electronicas.dbo.Autoriza_OC_detalle
            WHERE Empresa = '${empresa}' 
                AND PONumber = '${poNumber}'
            GROUP BY PONumber`;
        
        const authDateResult = await runQuery(authDateQuery);
        if (authDateResult.recordset.length === 0) {
            console.log('❌ No se encontraron detalles de autorización');
            console.table([{ PONumber: poNumber, Estado: 'SIN DETALLES DE AUTORIZACIÓN' }]);
        } else {
            console.table(authDateResult.recordset);
        }

        // 6. Verificar si ya fue procesada
        console.log('\n6. ¿YA FUE PROCESADA ANTERIORMENTE?');
        console.log('===================================');
        const processedQuery = `
            SELECT 
                ocSage,
                status,
                createdAt,
                idDatabase,
                CASE 
                    WHEN status = 'POSTED' THEN 'YA PROCESADA'
                    WHEN status = 'ERROR' THEN 'ERROR EN PROCESAMIENTO'
                    ELSE 'ESTADO: ' + status
                END as Estado
            FROM dbo.fesaOCFocaltec
            WHERE ocSage = '${poNumber}'
            ORDER BY createdAt DESC`;
        
        const processedResult = await runQuery(processedQuery);
        if (processedResult.recordset.length === 0) {
            console.log('✅ No ha sido procesada anteriormente');
            console.table([{ Estado: 'NO PROCESADA ANTERIORMENTE' }]);
        } else {
            console.table(processedResult.recordset);
        }

        // 7. Consulta final que usa el sistema
        console.log('\n7. RESULTADO DE LA CONSULTA COMPLETA DEL SISTEMA');
        console.log('================================================');
        const finalQuery = `
            SELECT 
                COUNT(*) as FilasEncontradas,
                CASE 
                    WHEN COUNT(*) > 0 THEN '✅ SERÍA PROCESADA'
                    ELSE '❌ NO SERÍA PROCESADA'
                END as ResultadoFinal
            FROM ${database}.dbo.POPORH1 A
            LEFT OUTER JOIN Autorizaciones_electronicas.dbo.Autoriza_OC X
                ON A.PONUMBER = X.PONumber
            WHERE X.Autorizada = 1
                AND X.Empresa = '${empresa}'
                AND A.PONUMBER = '${poNumber}'
                AND (
                    SELECT MAX(Fecha)
                    FROM Autorizaciones_electronicas.dbo.Autoriza_OC_detalle
                    WHERE Empresa = '${empresa}'
                        AND PONumber = A.PONUMBER
                ) = CAST(GETDATE() AS DATE)`;
        
        const finalResult = await runQuery(finalQuery);
        console.table(finalResult.recordset);

        // 8. Resumen y recomendaciones
        console.log('\n8. RESUMEN Y RECOMENDACIONES');
        console.log('============================');
        
        const isAuthorized = authResult.recordset.length > 0 && authResult.recordset[0].Autorizada === 1;
        const isAuthorizedToday = authDateResult.recordset.length > 0 && 
            authDateResult.recordset[0].Estado === 'AUTORIZADA HOY';
        const isProcessed = processedResult.recordset.length > 0 && 
            processedResult.recordset[0].status === 'POSTED';

        if (!isAuthorized) {
            console.log('❌ PROBLEMA: La OC no está autorizada en el sistema de autorizaciones');
            console.log('   SOLUCIÓN: Verificar el proceso de autorización');
        } else if (!isAuthorizedToday) {
            console.log('❌ PROBLEMA: La OC no fue autorizada hoy');
            console.log('   SOLUCIÓN: Verificar que se haya ejecutado el proceso de autorización hoy');
        } else if (isProcessed) {
            console.log('⚠️  PROBLEMA: La OC ya fue procesada anteriormente');
            console.log('   SOLUCIÓN: Verificar si necesita reprocesamiento');
        } else if (finalResult.recordset[0].FilasEncontradas > 0) {
            console.log('✅ TODO CORRECTO: La OC debería ser procesada');
        } else {
            console.log('❓ REVISAR: Hay algún problema no identificado');
        }

        logGenerator(logFileName, 'info', `Diagnóstico completado para ${poNumber}`);

    } catch (error) {
        console.error('\n❌ ERROR DURANTE EL DIAGNÓSTICO:', error.message);
        logGenerator(logFileName, 'error', `Error en diagnóstico para ${poNumber}: ${error.message}`);
    }
}

/**
 * Función para obtener todas las OCs autorizadas hoy
 */
async function getAuthorizedPOsToday(empresa = 'COPDAT') {
    console.log('\n=== OCs AUTORIZADAS HOY ===');
    try {
        const query = `
            SELECT 
                A.PONumber,
                MAX(A.Fecha) as FechaAutorizacion,
                COUNT(*) as TotalAutorizaciones
            FROM Autorizaciones_electronicas.dbo.Autoriza_OC_detalle A
            INNER JOIN Autorizaciones_electronicas.dbo.Autoriza_OC B 
                ON A.PONumber = B.PONumber AND A.Empresa = B.Empresa
            WHERE A.Empresa = '${empresa}'
                AND A.Fecha = CAST(GETDATE() AS DATE)
                AND B.Autorizada = 1
            GROUP BY A.PONumber
            ORDER BY A.PONumber`;
        
        const result = await runQuery(query);
        console.log(`Total de OCs autorizadas hoy: ${result.recordset.length}`);
        console.table(result.recordset);
        
        return result.recordset;
    } catch (error) {
        console.error('Error obteniendo OCs autorizadas:', error.message);
        return [];
    }
}

// Ejemplos de uso
async function runTests() {
    console.log('INICIANDO PRUEBAS DE DIAGNÓSTICO DE OCs');
    console.log('======================================\n');

    // Obtener parámetros de la línea de comandos
    const args = process.argv.slice(2);
    
    if (args.length >= 1) {
        // Si se proporciona al menos un parámetro, usarlo como PO number
        const poNumber = args[0];
        const database = args[1] || 'COPDAT';
        const empresa = args[2] || 'COPDAT';
        
        console.log(`Parámetros recibidos:`);
        console.log(`- PO Number: ${poNumber}`);
        console.log(`- Database: ${database}`);
        console.log(`- Empresa: ${empresa}\n`);
        
        await diagnosticPO(poNumber, database, empresa);
    } else {
        // Prueba específica para PO0075624 por defecto
        await diagnosticPO('PO0075624', 'COPDAT', 'COPDAT');
    }

    // Obtener todas las OCs autorizadas hoy
    await getAuthorizedPOsToday('COPDAT');

    console.log('\n✅ PRUEBAS COMPLETADAS');
}

// Exportar funciones para uso en otros archivos
module.exports = {
    diagnosticPO,
    getAuthorizedPOsToday,
    runTests
};

// Ejecutar pruebas si el archivo se ejecuta directamente
if (require.main === module) {
    runTests().catch(console.error);
}
