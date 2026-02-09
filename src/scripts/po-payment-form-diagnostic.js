// src/scripts/po-payment-form-diagnostic.js

const dotenv = require('dotenv');

// Carga configuración
const creds = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const { DATABASES } = creds;

const { runQuery } = require('../utils/SQLServerConnection');

const databases = DATABASES.split(',');

/**
 * Diagnostica el problema de cfdi_payment_form para una PO específica
 * @param {string} poNumber - Número de la orden de compra (ej: 'PO0081005')
 * @param {string} database - Base de datos a consultar (opcional, default: primer database configurado)
 */
async function diagnosticPaymentForm(poNumber, database = null) {
    const dbToUse = database || databases[0];
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`DIAGNÓSTICO DE CFDI_PAYMENT_FORM PARA ${poNumber}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Base de datos: ${dbToUse}`);
    console.log(`Fecha: ${new Date().toISOString()}\n`);

    try {
        // 1. Verificar si la PO existe
        console.log('1. VERIFICACIÓN DE EXISTENCIA DE LA PO');
        console.log('-'.repeat(40));
        
        const existsQuery = `
            SELECT 
                RTRIM(A.PONUMBER) as PONUMBER,
                RTRIM(A.VDCODE) as PROVEEDOR_ID,
                RTRIM(D.VENDNAME) as PROVEEDOR_NOMBRE
            FROM ${dbToUse}.dbo.POPORH1 A
            LEFT OUTER JOIN ${dbToUse}.dbo.APVEN D
                ON A.VDCODE = D.VENDORID
            WHERE A.PONUMBER = '${poNumber}'`;

        const existsResult = await runQuery(existsQuery, dbToUse);
        
        if (existsResult.recordset.length === 0) {
            console.log(`❌ ERROR: La PO ${poNumber} no existe en ${dbToUse}.dbo.POPORH1`);
            return;
        }
        
        console.table(existsResult.recordset);
        const proveedorId = existsResult.recordset[0].PROVEEDOR_ID;

        // 2. Verificar campo METODOPAGO del proveedor
        console.log('\n2. CAMPO METODOPAGO EN PROVEEDOR (APVENO)');
        console.log('-'.repeat(40));
        
        const metodoPagoQuery = `
            SELECT 
                RTRIM(E2.VENDORID) as PROVEEDOR_ID,
                RTRIM(E2.OPTFIELD) as CAMPO,
                RTRIM(E2.[VALUE]) as METODOPAGO_VALUE,
                CASE 
                    WHEN E2.[VALUE] IS NULL THEN '❌ NO CONFIGURADO'
                    WHEN RTRIM(E2.[VALUE]) = '' THEN '❌ VACÍO'
                    ELSE '✅ CONFIGURADO'
                END as ESTADO
            FROM ${dbToUse}.dbo.APVENO E2
            WHERE E2.VENDORID = '${proveedorId}'
              AND E2.OPTFIELD = 'METODOPAGO'`;

        const metodoPagoResult = await runQuery(metodoPagoQuery, dbToUse);
        
        if (metodoPagoResult.recordset.length === 0) {
            console.log(`❌ El proveedor ${proveedorId} NO tiene el campo METODOPAGO configurado en APVENO`);
            console.log('   Esto causa que cfdi_payment_form sea solo "F" (sin número)');
        } else {
            console.table(metodoPagoResult.recordset);
        }

        // 3. Verificar catálogo CSOPTFD para METODOPAGO
        console.log('\n3. CATÁLOGO CSOPTFD PARA METODOPAGO');
        console.log('-'.repeat(40));
        
        const catalogoQuery = `
            SELECT 
                RTRIM([VALUE]) as VALOR,
                RTRIM(VDESC) as DESCRIPCION,
                'F' + LEFT(RTRIM(VDESC), 2) as CFDI_FORM_RESULTANTE
            FROM ${dbToUse}.dbo.CSOPTFD
            WHERE OPTFIELD = 'METODOPAGO'
            ORDER BY [VALUE]`;

        const catalogoResult = await runQuery(catalogoQuery, dbToUse);
        
        if (catalogoResult.recordset.length === 0) {
            console.log('❌ No hay entradas en CSOPTFD para METODOPAGO');
        } else {
            console.log('Valores disponibles en el catálogo:');
            console.table(catalogoResult.recordset);
        }

        // 4. DIAGNÓSTICO COMPLETO - El valor calculado
        console.log('\n4. VALOR CALCULADO DE CFDI_PAYMENT_FORM');
        console.log('-'.repeat(40));
        
        const diagnosticQuery = `
            SELECT 
                RTRIM(A.PONUMBER) as PONUMBER,
                RTRIM(A.VDCODE) as PROVEEDOR_ID,
                RTRIM(E2.[VALUE]) as METODOPAGO_VALUE_EN_PROVEEDOR,
                (SELECT RTRIM(VDESC) 
                   FROM ${dbToUse}.dbo.CSOPTFD 
                  WHERE OPTFIELD = 'METODOPAGO' 
                    AND [VALUE] = E2.[VALUE]
                ) as VDESC_EN_CATALOGO,
                'F' + LEFT(
                    ISNULL(
                        (SELECT RTRIM(VDESC) 
                           FROM ${dbToUse}.dbo.CSOPTFD 
                          WHERE OPTFIELD = 'METODOPAGO' 
                            AND [VALUE] = E2.[VALUE]
                        ), ''
                    ), 2
                ) as CFDI_PAYMENT_FORM_CALCULADO,
                CASE 
                    WHEN E2.[VALUE] IS NULL THEN '❌ Proveedor sin METODOPAGO configurado'
                    WHEN (SELECT VDESC FROM ${dbToUse}.dbo.CSOPTFD WHERE OPTFIELD = 'METODOPAGO' AND [VALUE] = E2.[VALUE]) IS NULL 
                        THEN '❌ VALUE del proveedor no existe en catálogo CSOPTFD'
                    ELSE '✅ Configuración correcta'
                END as DIAGNOSTICO
            FROM ${dbToUse}.dbo.POPORH1 A
            LEFT OUTER JOIN ${dbToUse}.dbo.APVEN D
                ON A.VDCODE = D.VENDORID
            LEFT OUTER JOIN ${dbToUse}.dbo.APVENO E2
                ON D.VENDORID = E2.VENDORID
               AND E2.OPTFIELD = 'METODOPAGO'
            WHERE A.PONUMBER = '${poNumber}'`;

        const diagnosticResult = await runQuery(diagnosticQuery, dbToUse);
        console.table(diagnosticResult.recordset);

        // 5. Valores válidos según Joi
        console.log('\n5. VALORES VÁLIDOS SEGÚN VALIDACIÓN JOI');
        console.log('-'.repeat(40));
        const validValues = [
            'F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F08',
            'F12', 'F13', 'F14', 'F15', 'F17', 'F23', 'F24',
            'F25', 'F26', 'F27', 'F28', 'F29', 'F30', 'F99',
            '', null
        ];
        console.log('Valores aceptados: ' + validValues.filter(v => v !== null && v !== '').join(', '));
        console.log('También se permite: cadena vacía ("") o null');

        // 6. Conclusión
        console.log('\n6. CONCLUSIÓN');
        console.log('-'.repeat(40));
        
        const calculatedValue = diagnosticResult.recordset[0]?.CFDI_PAYMENT_FORM_CALCULADO;
        const isValid = validValues.includes(calculatedValue);
        
        console.log(`Valor calculado: "${calculatedValue}"`);
        console.log(`¿Es válido?: ${isValid ? '✅ SÍ' : '❌ NO'}`);
        
        if (!isValid) {
            console.log('\n⚠️  SOLUCIÓN RECOMENDADA:');
            if (calculatedValue === 'F' || calculatedValue === 'Fnull' || !calculatedValue) {
                console.log('   1. Configurar el campo METODOPAGO en el proveedor (tabla APVENO)');
                console.log('   2. O agregar la entrada correspondiente en el catálogo CSOPTFD');
            } else {
                console.log(`   El valor "${calculatedValue}" no está en la lista de valores permitidos.`);
                console.log('   Verificar que VDESC en CSOPTFD tenga el formato correcto (ej: "01 - Efectivo")');
            }
        }

        console.log(`\n${'='.repeat(60)}`);
        console.log('FIN DEL DIAGNÓSTICO');
        console.log(`${'='.repeat(60)}\n`);

    } catch (error) {
        console.error('❌ Error durante el diagnóstico:', error.message);
        throw error;
    }
}

// CLI
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('❌ ERROR: Debes proporcionar un número de PO');
        console.log('\n📋 Uso:');
        console.log('  node src/scripts/po-payment-form-diagnostic.js <PO_NUMBER> [DATABASE]');
        console.log('\n📝 Ejemplos:');
        console.log('  node src/scripts/po-payment-form-diagnostic.js PO0081005');
        console.log('  node src/scripts/po-payment-form-diagnostic.js PO0081005 COPDAT');
        process.exit(1);
    }

    const poNumber = args[0];
    const database = args[1] || null;

    try {
        await diagnosticPaymentForm(poNumber, database);
    } catch (error) {
        console.error('\n❌ ERROR FATAL:', error.message);
        process.exit(1);
    }
}

module.exports = { diagnosticPaymentForm };

if (require.main === module) {
    main().catch(console.error);
}
