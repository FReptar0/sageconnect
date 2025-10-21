// tests/Address_Diagnostic.test.js

const { runQuery } = require('../src/utils/SQLServerConnection');
const { logGenerator } = require('../src/utils/LogGenerator');
const { groupOrdersByNumber } = require('../src/utils/OC_GroupOrdersByNumber');
const { parseExternPurchaseOrders } = require('../src/utils/parseExternPurchaseOrders');
const { validateExternPurchaseOrder } = require('../src/models/PurchaseOrder');
const dotenv = require('dotenv');

// Load config like in PortalOC_Creation.js
const config = dotenv.config({ path: '.env' }).parsed;

// Default address values (simulating what happens when not set)
const DEFAULT_ADDRESS_CITY = config?.DEFAULT_ADDRESS_CITY || '';
const DEFAULT_ADDRESS_COUNTRY = config?.DEFAULT_ADDRESS_COUNTRY || '';
const DEFAULT_ADDRESS_IDENTIFIER = config?.DEFAULT_ADDRESS_IDENTIFIER || '';
const DEFAULT_ADDRESS_MUNICIPALITY = config?.DEFAULT_ADDRESS_MUNICIPALITY || '';
const DEFAULT_ADDRESS_STATE = config?.DEFAULT_ADDRESS_STATE || '';
const DEFAULT_ADDRESS_STREET = config?.DEFAULT_ADDRESS_STREET || '';
const DEFAULT_ADDRESS_ZIP = config?.DEFAULT_ADDRESS_ZIP || '';
const ADDRESS_IDENTIFIERS_SKIP = config?.ADDRESS_IDENTIFIERS_SKIP || '';

/**
 * Diagnóstico completo para analizar direcciones de una OC específica
 * @param {string} poNumber - Número de la orden de compra (ej: 'PO0075624')
 * @param {string} database - Base de datos a consultar (ej: 'COPDAT')
 */
async function diagnosticPOAddress(poNumber, database = 'COPDAT') {
    const logFileName = 'Address_Diagnostic';
    console.log(`\n=== DIAGNÓSTICO DE DIRECCIONES PARA ${poNumber} ===`);
    console.log(`Base de datos: ${database}`);
    console.log(`Fecha actual: ${new Date().toISOString().slice(0, 10)}\n`);

    try {
        // 1. Verificar configuración de defaults
        console.log('1. CONFIGURACIÓN DE DIRECCIONES POR DEFECTO');
        console.log('===========================================');
        const defaultConfig = {
            DEFAULT_ADDRESS_CITY: DEFAULT_ADDRESS_CITY || '(VACÍO)',
            DEFAULT_ADDRESS_COUNTRY: DEFAULT_ADDRESS_COUNTRY || '(VACÍO)',
            DEFAULT_ADDRESS_IDENTIFIER: DEFAULT_ADDRESS_IDENTIFIER || '(VACÍO)',
            DEFAULT_ADDRESS_MUNICIPALITY: DEFAULT_ADDRESS_MUNICIPALITY || '(VACÍO)',
            DEFAULT_ADDRESS_STATE: DEFAULT_ADDRESS_STATE || '(VACÍO)',
            DEFAULT_ADDRESS_STREET: DEFAULT_ADDRESS_STREET || '(VACÍO)',
            DEFAULT_ADDRESS_ZIP: DEFAULT_ADDRESS_ZIP || '(VACÍO)',
            ADDRESS_IDENTIFIERS_SKIP: ADDRESS_IDENTIFIERS_SKIP || '(VACÍO)'
        };
        console.table([defaultConfig]);

        // 2. Preparar filtro de skip (como en PortalOC_Creation.js)
        const skipIdentifiers = ADDRESS_IDENTIFIERS_SKIP.split(',').map(id => id.trim()).filter(id => id.length > 0);
        const skipCondition = skipIdentifiers.length > 0 
            ? `AND B.[LOCATION] NOT IN (${skipIdentifiers.map(id => `'${id}'`).join(',')})` 
            : '';
        
        console.log('\n2. CONFIGURACIÓN DE FILTROS DE UBICACIÓN');
        console.log('========================================');
        if (skipIdentifiers.length > 0) {
            console.log(`✅ Ubicaciones a omitir: ${skipIdentifiers.join(', ')}`);
            console.log(`✅ Condición SQL: ${skipCondition}`);
        } else {
            console.log('ℹ️  No hay ubicaciones configuradas para omitir');
        }

        // 3. Verificar datos de ubicación en ICLOC
        console.log('\n3. DATOS DE UBICACIÓN EN TABLA ICLOC');
        console.log('===================================');
        const locationQuery = `
            SELECT 
                RTRIM(B.[LOCATION]) as LOCATION_CODE,
                CASE 
                    WHEN F.[LOCATION] IS NOT NULL THEN 'SÍ EXISTE EN ICLOC'
                    ELSE 'NO EXISTE EN ICLOC'
                END as ESTADO_ICLOC,
                ISNULL(RTRIM(F.CITY), 'NULL') as CITY,
                ISNULL(RTRIM(F.COUNTRY), 'NULL') as COUNTRY,
                ISNULL(RTRIM(F.[LOCATION]), 'NULL') as IDENTIFIER,
                ISNULL(RTRIM(F.ADDRESS2), 'NULL') as MUNICIPALITY,
                ISNULL(RTRIM(F.[STATE]), 'NULL') as STATE,
                ISNULL(RTRIM(F.ADDRESS1), 'NULL') as STREET,
                ISNULL(RTRIM(F.ZIP), 'NULL') as ZIP
            FROM ${database}.dbo.POPORH1 A
            LEFT OUTER JOIN ${database}.dbo.POPORL B ON A.PORHSEQ = B.PORHSEQ
            LEFT OUTER JOIN ${database}.dbo.ICLOC F ON B.[LOCATION] = F.[LOCATION]
            WHERE A.PONUMBER = '${poNumber}'
            ORDER BY RTRIM(B.[LOCATION])`;
        
        const locationResult = await runQuery(locationQuery, database);
        console.table(locationResult.recordset);

        // 4. Ejecutar la consulta exacta del sistema (como PortalOC_Creation.js)
        console.log('\n4. CONSULTA EXACTA DEL SISTEMA (SIMULANDO PRODUCCIÓN)');
        console.log('====================================================');
        
        const systemQuery = `
            SELECT 
                'ACCEPTED' as ACCEPTANCE_STATUS,
                ISNULL(RTRIM(F.CITY),'${DEFAULT_ADDRESS_CITY}') as [ADDRESSES_CITY],
                ISNULL(RTRIM(F.COUNTRY),'${DEFAULT_ADDRESS_COUNTRY}') as [ADDRESSES_COUNTRY],
                '' as [ADDRESSES_EXTERIOR_NUMBER],
                ISNULL(RTRIM(F.[LOCATION]),'${DEFAULT_ADDRESS_IDENTIFIER}') as [ADDRESSES_IDENTIFIER],
                '' as [ADDRESSES_INTERIOR_NUMBER],
                ISNULL(RTRIM(F.ADDRESS2),'${DEFAULT_ADDRESS_MUNICIPALITY}') as [ADDRESSES_MUNICIPALITY],
                ISNULL(RTRIM(F.[STATE]),'${DEFAULT_ADDRESS_STATE}') as [ADDRESSES_STATE],
                ISNULL(RTRIM(F.ADDRESS1),'${DEFAULT_ADDRESS_STREET}') as [ADDRESSES_STREET],
                '' as [ADDRESSES_SUBURB],
                'SHIPPING' as [ADDRESSES_TYPE],
                ISNULL(RTRIM(F.ZIP),'${DEFAULT_ADDRESS_ZIP}') as [ADDRESSES_ZIP],
                RTRIM(A.PONUMBER) as [EXTERNAL_ID],
                RTRIM(B.ITEMNO) as [LINES_CODE],
                RTRIM(B.ITEMDESC) as [LINES_DESCRIPTION],
                B.PORLSEQ as [LINES_EXTERNAL_ID],
                ROW_NUMBER() OVER (PARTITION BY A.PONUMBER ORDER BY B.PORLREV) as [LINES_NUM],
                B.UNITCOST as [LINES_PRICE],
                B.SQORDERED as [LINES_QUANTITY],
                B.EXTENDED as [LINES_TOTAL],
                RTRIM(B.ORDERUNIT) as [LINES_UNIT_OF_MEASURE],
                RTRIM(A.VDCODE) as [PROVIDER_EXTERNAL_ID],
                CASE WHEN RTRIM(A.CURRENCY)='MXP' THEN 'MXN' ELSE RTRIM(A.CURRENCY) END as [CURRENCY],
                CAST(
                    SUBSTRING(CAST(A.[DATE] AS VARCHAR),1,4) + '-' +
                    SUBSTRING(CAST(A.[DATE] AS VARCHAR),5,2) + '-' +
                    SUBSTRING(CAST(A.[DATE] AS VARCHAR),7,2)
                AS DATE) as [DATE],
                A.DOCTOTAL as [TOTAL],
                A.EXTENDED as [SUBTOTAL],
                RTRIM(A.FOBPOINT) as [DELIVERY_CONTACT],
                RTRIM(A1.ENTEREDBY) as [REQUESTED_BY_CONTACT],
                'OPEN' as [STATUS],
                ISNULL(RTRIM(B.[LOCATION]),'') as [WAREHOUSE]
            FROM ${database}.dbo.POPORH1 A
            LEFT OUTER JOIN ${database}.dbo.POPORH2 A1 ON A.PORHSEQ = A1.PORHSEQ
            LEFT OUTER JOIN ${database}.dbo.POPORL B ON A.PORHSEQ = B.PORHSEQ
            LEFT OUTER JOIN ${database}.dbo.ICLOC F ON B.[LOCATION] = F.[LOCATION]
            WHERE A.PONUMBER = '${poNumber}'
            ${skipCondition}
            ORDER BY A.PONUMBER, B.PORLREV`;

        console.log('📄 Consulta SQL generada:');
        console.log(systemQuery);
        console.log('\n📊 Resultados de la consulta:');

        const systemResult = await runQuery(systemQuery, database);
        
        if (systemResult.recordset.length === 0) {
            console.log('❌ La consulta no devolvió resultados. Posibles causas:');
            console.log('   - La OC fue filtrada por ADDRESS_IDENTIFIERS_SKIP');
            console.log('   - No existe la OC o no tiene líneas de detalle');
            return;
        }

        // Mostrar solo los primeros 3 registros para revisión
        console.table(systemResult.recordset.slice(0, 3));
        console.log(`\nTotal de registros: ${systemResult.recordset.length}`);

        // 5. Simular agrupamiento y parseado
        console.log('\n5. SIMULACIÓN DE AGRUPAMIENTO Y PARSEADO');
        console.log('=======================================');
        
        const grouped = groupOrdersByNumber(systemResult.recordset);
        console.log(`✅ Órdenes agrupadas: ${Object.keys(grouped).length}`);
        
        Object.keys(grouped).forEach(poNum => {
            console.log(`   - ${poNum}: ${grouped[poNum].length} líneas`);
        });

        const ordersToSend = parseExternPurchaseOrders(grouped);
        console.log(`✅ Órdenes parseadas: ${ordersToSend.length}`);

        // 6. Analizar estructura de direcciones resultante
        console.log('\n6. ANÁLISIS DE DIRECCIONES RESULTANTES');
        console.log('====================================');
        
        ordersToSend.forEach((po, index) => {
            console.log(`\n📦 Orden ${index + 1}: ${po.external_id}`);
            
            if (!po.addresses || po.addresses.length === 0) {
                console.log('❌ ERROR: No hay direcciones en la orden');
                return;
            }

            po.addresses.forEach((addr, addrIndex) => {
                console.log(`\n   📍 Dirección ${addrIndex + 1}:`);
                console.table([{
                    street: addr.street || '(VACÍO)',
                    city: addr.city || '(VACÍO)',
                    state: addr.state || '(VACÍO)',
                    country: addr.country || '(VACÍO)',
                    zip_code: addr.zip_code || '(VACÍO)',
                    identifier: addr.identifier || '(VACÍO)',
                    municipality: addr.municipality || '(VACÍO)',
                    type: addr.type || '(VACÍO)'
                }]);
                
                // Identificar problemas potenciales
                const issues = [];
                if (!addr.street || addr.street.trim() === '') issues.push('street es requerido pero está vacío');
                if (!addr.type) issues.push('type es requerido pero está vacío');
                if (addr.zip_code && !/^\d{5}$/.test(addr.zip_code)) issues.push('zip_code debe ser 5 dígitos');
                
                if (issues.length > 0) {
                    console.log('   ⚠️  Problemas detectados:');
                    issues.forEach(issue => console.log(`      - ${issue}`));
                } else {
                    console.log('   ✅ Dirección válida');
                }
            });
        });

        // 7. Validación Joi
        console.log('\n7. VALIDACIÓN JOI (SIMULACIÓN)');
        console.log('=============================');
        
        ordersToSend.forEach((po, index) => {
            console.log(`\n🔍 Validando orden ${index + 1}: ${po.external_id}`);
            
            try {
                validateExternPurchaseOrder(po);
                console.log('✅ Validación Joi exitosa');
            } catch (valErr) {
                console.log('❌ Validación Joi falló:');
                valErr.details.forEach(d => {
                    if (d.path.includes('addresses')) {
                        console.log(`   🏠 ERROR DE DIRECCIÓN: ${d.message}`);
                    } else {
                        console.log(`   📄 ${d.message}`);
                    }
                });
            }
        });

        // 8. Resumen y recomendaciones
        console.log('\n8. RESUMEN Y RECOMENDACIONES');
        console.log('============================');
        
        if (systemResult.recordset.length === 0) {
            console.log('❌ PROBLEMA: La consulta no devuelve registros');
            console.log('   SOLUCIÓN: Verificar filtros ADDRESS_IDENTIFIERS_SKIP o existencia de la OC');
        } else if (ordersToSend.length === 0) {
            console.log('❌ PROBLEMA: Error en el agrupamiento/parseado');
            console.log('   SOLUCIÓN: Revisar la estructura de datos devueltos por la consulta');
        } else {
            const hasAddressIssues = ordersToSend.some(po => !po.addresses || po.addresses.length === 0);
            const hasValidationIssues = ordersToSend.some(po => {
                try {
                    validateExternPurchaseOrder(po);
                    return false;
                } catch {
                    return true;
                }
            });

            if (hasAddressIssues) {
                console.log('❌ PROBLEMA: Algunas órdenes no tienen direcciones');
                console.log('   SOLUCIÓN: Configurar DEFAULT_ADDRESS_* en .env o verificar datos en ICLOC');
            } else if (hasValidationIssues) {
                console.log('❌ PROBLEMA: Error en validación Joi');
                console.log('   SOLUCIÓN: Revisar campos requeridos, especialmente street en addresses');
            } else {
                console.log('✅ TODO CORRECTO: Las direcciones están bien configuradas');
            }
        }

        logGenerator(logFileName, 'info', `Diagnóstico de direcciones completado para ${poNumber}`);

    } catch (error) {
        console.error('\n❌ ERROR DURANTE EL DIAGNÓSTICO:', error.message);
        logGenerator(logFileName, 'error', `Error en diagnóstico de direcciones para ${poNumber}: ${error.message}`);
    }
}

// Ejemplos de uso
async function runAddressTests() {
    console.log('INICIANDO DIAGNÓSTICO DE DIRECCIONES PARA OCs');
    console.log('==============================================\n');

    // Obtener parámetros de la línea de comandos
    const args = process.argv.slice(2);
    
    if (args.length >= 1) {
        // Si se proporciona al menos un parámetro, usarlo como PO number
        const poNumber = args[0];
        const database = args[1] || 'COPDAT';
        
        console.log(`Parámetros recibidos:`);
        console.log(`- PO Number: ${poNumber}`);
        console.log(`- Database: ${database}\n`);
        
        await diagnosticPOAddress(poNumber, database);
    } else {
        console.log('❌ ERROR: Debes proporcionar el número de PO');
        console.log('Uso: node tests/Address_Diagnostic.test.js PO0075624 [DATABASE]');
        console.log('Ejemplo: node tests/Address_Diagnostic.test.js PO0075624 COPDAT');
        return;
    }

    console.log('\n✅ DIAGNÓSTICO COMPLETADO');
}

// Exportar funciones para uso en otros archivos
module.exports = {
    diagnosticPOAddress,
    runAddressTests
};

// Ejecutar pruebas si el archivo se ejecuta directamente
if (require.main === module) {
    runAddressTests().catch(console.error);
}