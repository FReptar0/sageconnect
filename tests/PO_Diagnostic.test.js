// tests/PO_Diagnostic.test.js

const dotenv = require('dotenv');
const { runQuery } = require('../src/utils/SQLServerConnection');
const { logGenerator } = require('../src/utils/LogGenerator');

// carga las variables de configuración general (incluyendo direcciones por defecto)
const config = dotenv.config({ path: '.env' }).parsed;

// Variables de configuración de direcciones por defecto para órdenes de compra
// Estas variables se usan cuando la tabla ICLOC no tiene datos de dirección para una ubicación
const DEFAULT_ADDRESS_CITY = config?.DEFAULT_ADDRESS_CITY || '';
const DEFAULT_ADDRESS_COUNTRY = config?.DEFAULT_ADDRESS_COUNTRY || '';
const DEFAULT_ADDRESS_IDENTIFIER = config?.DEFAULT_ADDRESS_IDENTIFIER || '';
const DEFAULT_ADDRESS_MUNICIPALITY = config?.DEFAULT_ADDRESS_MUNICIPALITY || '';
const DEFAULT_ADDRESS_STATE = config?.DEFAULT_ADDRESS_STATE || '';
const DEFAULT_ADDRESS_STREET = config?.DEFAULT_ADDRESS_STREET || '';
const DEFAULT_ADDRESS_ZIP = config?.DEFAULT_ADDRESS_ZIP || '';

/**
 * Diagnóstico completo para verificar por qué una OC no está siendo procesada
 * @param {string} poNumber - Número de la orden de compra (ej: 'PO0075624')
 * @param {string} database - Base de datos a consultar (ej: 'COPDAT')
 * @param {string} empresa - Empresa en autorizaciones (ej: 'COPDAT')
 */
async function diagnosticPO(poNumber, database = 'COPDAT', empresa = 'COPDAT') {
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

        // 2. Verificar detalles de la OC
        console.log('\n2. DETALLES DE LA OC EN POPORH1');
        console.log('===============================');
        const detailsQuery = `
            SELECT 
                RTRIM(PONUMBER) as PONUMBER,
                RTRIM(VDCODE) as PROVIDER_ID,
                RTRIM(ORDDATE) as ORDER_DATE,
                RTRIM(ORDSTATUS) as ORDER_STATUS,
                RTRIM(POSTATUS) as PO_STATUS,
                PORHSEQ
            FROM ${database}.dbo.POPORH1 
            WHERE PONUMBER = '${poNumber}'`;
        
        const detailsResult = await runQuery(detailsQuery);
        console.table(detailsResult.recordset);

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

        // 4. Verificar datos de dirección de ICLOC vs valores por defecto
        console.log('\n4. ANÁLISIS DE DIRECCIONES (ICLOC vs DEFAULTS)');
        console.log('===============================================');
        
        console.log('Valores por defecto configurados en .env:');
        console.table([{
            DEFAULT_CITY: DEFAULT_ADDRESS_CITY,
            DEFAULT_COUNTRY: DEFAULT_ADDRESS_COUNTRY,
            DEFAULT_IDENTIFIER: DEFAULT_ADDRESS_IDENTIFIER,
            DEFAULT_MUNICIPALITY: DEFAULT_ADDRESS_MUNICIPALITY,
            DEFAULT_STATE: DEFAULT_ADDRESS_STATE,
            DEFAULT_STREET: DEFAULT_ADDRESS_STREET,
            DEFAULT_ZIP: DEFAULT_ADDRESS_ZIP
        }]);

        const addressQuery = `
            SELECT DISTINCT
                RTRIM(B.[LOCATION]) as LOCATION_CODE,
                RTRIM(ISNULL(F.CITY, 'NULL')) as ICLOC_CITY,
                RTRIM(ISNULL(F.COUNTRY, 'NULL')) as ICLOC_COUNTRY,
                RTRIM(ISNULL(F.[LOCATION], 'NULL')) as ICLOC_IDENTIFIER,
                RTRIM(ISNULL(F.ADDRESS2, 'NULL')) as ICLOC_MUNICIPALITY,
                RTRIM(ISNULL(F.[STATE], 'NULL')) as ICLOC_STATE,
                RTRIM(ISNULL(F.ADDRESS1, 'NULL')) as ICLOC_STREET,
                RTRIM(ISNULL(F.ZIP, 'NULL')) as ICLOC_ZIP,
                -- Valores que se usarían en la query final
                ISNULL(RTRIM(F.CITY),'${DEFAULT_ADDRESS_CITY}') as FINAL_CITY,
                ISNULL(RTRIM(F.COUNTRY),'${DEFAULT_ADDRESS_COUNTRY}') as FINAL_COUNTRY,
                ISNULL(RTRIM(F.[LOCATION]),'${DEFAULT_ADDRESS_IDENTIFIER}') as FINAL_IDENTIFIER,
                ISNULL(RTRIM(F.ADDRESS2),'${DEFAULT_ADDRESS_MUNICIPALITY}') as FINAL_MUNICIPALITY,
                ISNULL(RTRIM(F.[STATE]),'${DEFAULT_ADDRESS_STATE}') as FINAL_STATE,
                ISNULL(RTRIM(F.ADDRESS1),'${DEFAULT_ADDRESS_STREET}') as FINAL_STREET,
                ISNULL(RTRIM(F.ZIP),'${DEFAULT_ADDRESS_ZIP}') as FINAL_ZIP,
                CASE 
                    WHEN F.[LOCATION] IS NULL THEN 'LOCATION NO EXISTE EN ICLOC'
                    WHEN F.CITY IS NULL OR RTRIM(F.CITY) = '' THEN 'USARÁ DEFAULT CITY'
                    ELSE 'USARÁ DATOS DE ICLOC'
                END as ADDRESS_SOURCE
            FROM ${database}.dbo.POPORH1 A
            LEFT OUTER JOIN ${database}.dbo.POPORL B ON A.PORHSEQ = B.PORHSEQ
            LEFT OUTER JOIN ${database}.dbo.ICLOC F ON B.[LOCATION] = F.[LOCATION]
            WHERE A.PONUMBER = '${poNumber}'`;
        
        const addressResult = await runQuery(addressQuery);
        if (addressResult.recordset.length === 0) {
            console.log('❌ No se encontraron datos de ubicación para esta OC');
        } else {
            console.log('\nAnálisis de direcciones por línea de la OC:');
            console.table(addressResult.recordset);
            
            // Mostrar la dirección final consolidada que se enviaría al Portal
            console.log(`\n🏠 DIRECCIÓN FINAL QUE SE ENVIARÍA AL PORTAL PARA ${poNumber}:`);
            console.log('=========================================================');
            
            // Tomar la primera línea como referencia para la dirección (todas deberían ser iguales)
            const firstRow = addressResult.recordset[0];
            const finalAddress = {
                'Ciudad': firstRow.FINAL_CITY,
                'País': firstRow.FINAL_COUNTRY,
                'Identificador': firstRow.FINAL_IDENTIFIER,
                'Municipio': firstRow.FINAL_MUNICIPALITY,
                'Estado': firstRow.FINAL_STATE,
                'Calle': firstRow.FINAL_STREET,
                'Código Postal': firstRow.FINAL_ZIP,
                'Fuente de Datos': firstRow.ADDRESS_SOURCE
            };
            
            console.table([finalAddress]);
            
            // Verificar si hay inconsistencias entre líneas
            const uniqueAddresses = new Set(addressResult.recordset.map(row => 
                `${row.FINAL_CITY}|${row.FINAL_COUNTRY}|${row.FINAL_STATE}`
            ));
            
            if (uniqueAddresses.size > 1) {
                console.log('⚠️  ALERTA: Hay direcciones diferentes entre las líneas de la OC:');
                addressResult.recordset.forEach((row, index) => {
                    console.log(`   Línea ${index + 1} (${row.LOCATION_CODE}): ${row.FINAL_CITY}, ${row.FINAL_STATE}, ${row.FINAL_COUNTRY}`);
                });
            } else {
                console.log('✅ Todas las líneas de la OC usan la misma dirección');
            }
            
            // Analizar si hay problemas de dirección
            const hasNullLocations = addressResult.recordset.some(row => row.LOCATION_CODE === null || row.LOCATION_CODE === '');
            const hasMissingIclocData = addressResult.recordset.some(row => row.ADDRESS_SOURCE.includes('NO EXISTE EN ICLOC'));
            const usesDefaults = addressResult.recordset.some(row => row.ADDRESS_SOURCE.includes('DEFAULT'));
            
            console.log('\nResumen de análisis de direcciones:');
            if (hasNullLocations) {
                console.log('⚠️  PROBLEMA: Algunas líneas no tienen código de ubicación');
            }
            if (hasMissingIclocData) {
                console.log('⚠️  PROBLEMA: Algunas ubicaciones no existen en tabla ICLOC');
            }
            if (usesDefaults) {
                console.log('✅ INFO: Se están usando valores por defecto del .env');
            } else {
                console.log('✅ INFO: Se están usando datos completos de ICLOC');
            }
        }

        // 4.1 Resumen de dirección para esta OC específica
        if (addressResult.recordset.length > 0) {
            const firstRow = addressResult.recordset[0];
            console.log(`\n📋 RESUMEN DE DIRECCIÓN PARA ${poNumber}:`);
            console.log('==========================================');
            console.log(`🏢 Ubicación/Almacén: ${firstRow.LOCATION_CODE || 'NO ESPECIFICADO'}`);
            console.log(`🏙️  Ciudad: ${firstRow.FINAL_CITY} ${firstRow.FINAL_CITY === DEFAULT_ADDRESS_CITY ? '(DEFAULT)' : '(ICLOC)'}`);
            console.log(`🌍 País: ${firstRow.FINAL_COUNTRY} ${firstRow.FINAL_COUNTRY === DEFAULT_ADDRESS_COUNTRY ? '(DEFAULT)' : '(ICLOC)'}`);
            console.log(`🗺️  Estado: ${firstRow.FINAL_STATE} ${firstRow.FINAL_STATE === DEFAULT_ADDRESS_STATE ? '(DEFAULT)' : '(ICLOC)'}`);
            console.log(`🏘️  Municipio: ${firstRow.FINAL_MUNICIPALITY} ${firstRow.FINAL_MUNICIPALITY === DEFAULT_ADDRESS_MUNICIPALITY ? '(DEFAULT)' : '(ICLOC)'}`);
            console.log(`🛣️  Calle: ${firstRow.FINAL_STREET} ${firstRow.FINAL_STREET === DEFAULT_ADDRESS_STREET ? '(DEFAULT)' : '(ICLOC)'}`);
            console.log(`📮 Código Postal: ${firstRow.FINAL_ZIP} ${firstRow.FINAL_ZIP === DEFAULT_ADDRESS_ZIP ? '(DEFAULT)' : '(ICLOC)'}`);
            console.log(`📍 Identificador: ${firstRow.FINAL_IDENTIFIER} ${firstRow.FINAL_IDENTIFIER === DEFAULT_ADDRESS_IDENTIFIER ? '(DEFAULT)' : '(ICLOC)'}`);
        }

        // 5. Verificar autorización
        console.log('\n5. ESTADO DE AUTORIZACIÓN');
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

        // 6. Verificar fecha de autorización
        console.log('\n6. FECHA DE AUTORIZACIÓN');
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

        // 7. Verificar si ya fue procesada
        console.log('\n7. ¿YA FUE PROCESADA ANTERIORMENTE?');
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

        // 8. Consulta final que usa el sistema
        console.log('\n8. RESULTADO DE LA CONSULTA COMPLETA DEL SISTEMA');
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

        // Agregar query completa con direcciones para comparar con producción
        console.log('\n8.1. SIMULACIÓN COMPLETA DE LA QUERY DE PRODUCCIÓN');
        console.log('==================================================');
        const productionSimulationQuery = `
            SELECT 
                'ACCEPTED' as ACCEPTANCE_STATUS,
                ISNULL(RTRIM(F.CITY),'${DEFAULT_ADDRESS_CITY}') as [ADDRESSES_CITY],
                ISNULL(RTRIM(F.COUNTRY),'${DEFAULT_ADDRESS_COUNTRY}') as [ADDRESSES_COUNTRY],
                ISNULL(RTRIM(F.[LOCATION]),'${DEFAULT_ADDRESS_IDENTIFIER}') as [ADDRESSES_IDENTIFIER],
                ISNULL(RTRIM(F.ADDRESS2),'${DEFAULT_ADDRESS_MUNICIPALITY}') as [ADDRESSES_MUNICIPALITY],
                ISNULL(RTRIM(F.[STATE]),'${DEFAULT_ADDRESS_STATE}') as [ADDRESSES_STATE],
                ISNULL(RTRIM(F.ADDRESS1),'${DEFAULT_ADDRESS_STREET}') as [ADDRESSES_STREET],
                ISNULL(RTRIM(F.ZIP),'${DEFAULT_ADDRESS_ZIP}') as [ADDRESSES_ZIP],
                RTRIM(A.PONUMBER) as [EXTERNAL_ID],
                RTRIM(B.ITEMNO) as [LINES_CODE],
                RTRIM(B.ITEMDESC) as [LINES_DESCRIPTION],
                B.SQOUTSTAND as [LINES_QUANTITY],
                RTRIM(B.[LOCATION]) as [WAREHOUSE],
                -- Campos de diagnóstico
                CASE 
                    WHEN F.[LOCATION] IS NULL THEN 'LOCATION_NO_EXISTS'
                    WHEN F.CITY IS NULL OR RTRIM(F.CITY) = '' THEN 'USING_DEFAULT_CITY'
                    ELSE 'USING_ICLOC_DATA'
                END as ADDRESS_DATA_SOURCE,
                RTRIM(ISNULL(F.CITY, 'NULL_IN_ICLOC')) as RAW_ICLOC_CITY,
                RTRIM(ISNULL(F.COUNTRY, 'NULL_IN_ICLOC')) as RAW_ICLOC_COUNTRY
            FROM ${database}.dbo.POPORH1 A
            LEFT OUTER JOIN ${database}.dbo.POPORL B ON A.PORHSEQ = B.PORHSEQ
            LEFT OUTER JOIN ${database}.dbo.ICLOC F ON B.[LOCATION] = F.[LOCATION]
            LEFT OUTER JOIN Autorizaciones_electronicas.dbo.Autoriza_OC X ON A.PONUMBER = X.PONumber
            WHERE A.PONUMBER = '${poNumber}'
                AND X.Autorizada = 1
                AND X.Empresa = '${empresa}'
            ORDER BY B.PORLREV`;
        
        try {
            const productionResult = await runQuery(productionSimulationQuery);
            if (productionResult.recordset.length === 0) {
                console.log('❌ La OC no aparecería en la query de producción');
            } else {
                console.log(`✅ La OC aparecería en producción con ${productionResult.recordset.length} líneas:`);
                console.table(productionResult.recordset.map(row => ({
                    EXTERNAL_ID: row.EXTERNAL_ID,
                    LINES_CODE: row.LINES_CODE,
                    WAREHOUSE: row.WAREHOUSE,
                    ADDRESSES_CITY: row.ADDRESSES_CITY,
                    ADDRESSES_COUNTRY: row.ADDRESSES_COUNTRY,
                    ADDRESSES_STATE: row.ADDRESSES_STATE,
                    ADDRESS_DATA_SOURCE: row.ADDRESS_DATA_SOURCE,
                    RAW_ICLOC_CITY: row.RAW_ICLOC_CITY,
                    RAW_ICLOC_COUNTRY: row.RAW_ICLOC_COUNTRY
                })));
            }
        } catch (prodErr) {
            console.error('❌ Error ejecutando simulación de producción:', prodErr.message);
        }

        // 9. Resumen y recomendaciones
        console.log('\n9. RESUMEN Y RECOMENDACIONES');
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

        logGenerator('PO_Diagnostic', 'info', `Diagnóstico completado para ${poNumber}`);

    } catch (error) {
        console.error('\n❌ ERROR DURANTE EL DIAGNÓSTICO:', error.message);
        logGenerator('PO_Diagnostic', 'error', `Error en diagnóstico para ${poNumber}: ${error.message}`);
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

/**
 * Función para comparar direcciones entre query de producción y diagnóstico
 */
async function compareAddressQueries(database = 'COPDAT') {
    console.log('\n=== COMPARACIÓN DE QUERIES DE DIRECCIONES ===');
    console.log(`Base de datos: ${database}\n`);

    try {
        // Query tal como aparece en QueryTest_CargaInicial.test.js (con defaults)
        const queryWithDefaults = `
            SELECT TOP 5
                RTRIM(A.PONUMBER) as PONUMBER,
                RTRIM(B.[LOCATION]) as LOCATION_CODE,
                ISNULL(RTRIM(F.CITY),'${DEFAULT_ADDRESS_CITY}') as [ADDRESSES_CITY],
                ISNULL(RTRIM(F.COUNTRY),'${DEFAULT_ADDRESS_COUNTRY}') as [ADDRESSES_COUNTRY],
                ISNULL(RTRIM(F.[LOCATION]),'${DEFAULT_ADDRESS_IDENTIFIER}') as [ADDRESSES_IDENTIFIER],
                ISNULL(RTRIM(F.ADDRESS2),'${DEFAULT_ADDRESS_MUNICIPALITY}') as [ADDRESSES_MUNICIPALITY],
                ISNULL(RTRIM(F.[STATE]),'${DEFAULT_ADDRESS_STATE}') as [ADDRESSES_STATE],
                ISNULL(RTRIM(F.ADDRESS1),'${DEFAULT_ADDRESS_STREET}') as [ADDRESSES_STREET],
                ISNULL(RTRIM(F.ZIP),'${DEFAULT_ADDRESS_ZIP}') as [ADDRESSES_ZIP],
                -- Datos raw para comparación
                RTRIM(ISNULL(F.CITY, 'NULL')) as RAW_CITY,
                RTRIM(ISNULL(F.COUNTRY, 'NULL')) as RAW_COUNTRY,
                RTRIM(ISNULL(F.ADDRESS1, 'NULL')) as RAW_STREET
            FROM ${database}.dbo.POPORH1 A
            LEFT OUTER JOIN ${database}.dbo.POPORL B ON A.PORHSEQ = B.PORHSEQ
            LEFT OUTER JOIN ${database}.dbo.ICLOC F ON B.[LOCATION] = F.[LOCATION]
            LEFT OUTER JOIN Autorizaciones_electronicas.dbo.Autoriza_OC X ON A.PONUMBER = X.PONumber
            WHERE X.Autorizada = 1
                AND X.Empresa = '${database}'
                AND A.[DATE] between '20250101' and '20251231'
                AND B.SQOUTSTAND > 0 
                AND B.COMPLETION = 1
            ORDER BY A.PONUMBER`;

        console.log('Ejecutando query con valores por defecto configurados...');
        const resultWithDefaults = await runQuery(queryWithDefaults);
        
        console.log(`\nResultados encontrados: ${resultWithDefaults.recordset.length}`);
        console.log('\nPrimeras 5 OCs con análisis de direcciones:');
        console.table(resultWithDefaults.recordset);

        // Mostrar estadísticas de uso de defaults
        const stats = {
            totalRows: resultWithDefaults.recordset.length,
            usingDefaultCity: 0,
            usingDefaultCountry: 0,
            usingDefaultState: 0,
            nullLocations: 0,
            uniqueLocations: new Set()
        };

        resultWithDefaults.recordset.forEach(row => {
            if (row.ADDRESSES_CITY === DEFAULT_ADDRESS_CITY) stats.usingDefaultCity++;
            if (row.ADDRESSES_COUNTRY === DEFAULT_ADDRESS_COUNTRY) stats.usingDefaultCountry++;
            if (row.ADDRESSES_STATE === DEFAULT_ADDRESS_STATE) stats.usingDefaultState++;
            if (!row.LOCATION_CODE || row.LOCATION_CODE.trim() === '') stats.nullLocations++;
            if (row.LOCATION_CODE) stats.uniqueLocations.add(row.LOCATION_CODE);
        });

        console.log('\n=== ESTADÍSTICAS DE USO DE VALORES POR DEFECTO ===');
        console.table([{
            'Total Filas': stats.totalRows,
            'Usando Default City': stats.usingDefaultCity,
            'Usando Default Country': stats.usingDefaultCountry,
            'Usando Default State': stats.usingDefaultState,
            'Ubicaciones NULL': stats.nullLocations,
            'Ubicaciones Únicas': stats.uniqueLocations.size
        }]);

        console.log('\n=== VALORES POR DEFECTO CONFIGURADOS ===');
        console.table([{
            DEFAULT_CITY: DEFAULT_ADDRESS_CITY,
            DEFAULT_COUNTRY: DEFAULT_ADDRESS_COUNTRY,
            DEFAULT_IDENTIFIER: DEFAULT_ADDRESS_IDENTIFIER,
            DEFAULT_MUNICIPALITY: DEFAULT_ADDRESS_MUNICIPALITY,
            DEFAULT_STATE: DEFAULT_ADDRESS_STATE,
            DEFAULT_STREET: DEFAULT_ADDRESS_STREET,
            DEFAULT_ZIP: DEFAULT_ADDRESS_ZIP
        }]);

        // Verificar ubicaciones problemáticas
        if (stats.uniqueLocations.size > 0) {
            console.log('\n=== ANÁLISIS DE UBICACIONES ===');
            const locationAnalysisQuery = `
                SELECT 
                    F.[LOCATION] as LOCATION_CODE,
                    COUNT(*) as USAGE_COUNT,
                    RTRIM(ISNULL(F.CITY, 'NULL')) as CITY_IN_ICLOC,
                    RTRIM(ISNULL(F.COUNTRY, 'NULL')) as COUNTRY_IN_ICLOC,
                    RTRIM(ISNULL(F.[STATE], 'NULL')) as STATE_IN_ICLOC,
                    CASE 
                        WHEN F.CITY IS NULL OR RTRIM(F.CITY) = '' THEN 'USARÁ DEFAULT'
                        ELSE 'USARÁ ICLOC'
                    END as CITY_SOURCE
                FROM ${database}.dbo.ICLOC F
                WHERE F.[LOCATION] IN ('${Array.from(stats.uniqueLocations).join("','")}')
                GROUP BY F.[LOCATION], F.CITY, F.COUNTRY, F.[STATE]
                ORDER BY COUNT(*) DESC`;
            
            const locationAnalysis = await runQuery(locationAnalysisQuery);
            console.log('\nAnálisis detallado de ubicaciones:');
            console.table(locationAnalysis.recordset);
        }

        logGenerator('PO_Diagnostic', 'info', `Comparación de queries completada. Total filas: ${stats.totalRows}`);

    } catch (error) {
        console.error('\n❌ ERROR EN COMPARACIÓN DE QUERIES:', error.message);
        logGenerator('PO_Diagnostic', 'error', `Error en comparación de queries: ${error.message}`);
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
    } else if (args[0] === 'compare-addresses') {
        // Comparar queries de direcciones
        const database = args[1] || 'COPDAT';
        await compareAddressQueries(database);
    } else {
        // Prueba específica para PO0075624 por defecto
        await diagnosticPO('PO0075624', 'COPDAT', 'COPDAT');
    }

    // Obtener todas las OCs autorizadas hoy si no es comparación de direcciones
    if (args[0] !== 'compare-addresses') {
        await getAuthorizedPOsToday('COPDAT');
    }

    console.log('\n✅ PRUEBAS COMPLETADAS');
}

// Exportar funciones para uso en otros archivos
module.exports = {
    diagnosticPO,
    getAuthorizedPOsToday,
    compareAddressQueries,
    runTests
};

// Ejecutar pruebas si el archivo se ejecuta directamente
if (require.main === module) {
    runTests().catch(console.error);
}
