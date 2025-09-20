// buildProvidersXML.js (o Providers_Downloader.js)

require('dotenv').config({ path: '.env' });
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const os = require('os');
const xml2js = require('xml2js');
const { logGenerator } = require('../utils/LogGenerator');
const { getCurrentDate } = require('../utils/TimezoneHelper');
const { getProviders } = require('../utils/GetProviders');

// Cargar la variable de entorno que contiene la ruta donde se guardarán los archivos
const path_env = dotenv.config({ path: '.env.path' });

/**
 * Formatea un timestamp a formato "dd-mm-yyyyTHH:MM:SS:MMMZ"
 * @param {number} timestamp
 * @returns {string} Fecha formateada
 */
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const pad = (n, width = 2) => n.toString().padStart(width, '0');
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    const milliseconds = pad(date.getMilliseconds(), 3);
    return `${day}-${month}-${year}T${hours}:${minutes}:${seconds}:${milliseconds}Z`;
}

/**
 * Formatea la fecha actual para el nombre del archivo en el formato "yyMMdd-hhmmss"
 * @returns {string} Fecha formateada
 */
function formatDateForFilename() {
    const now = getCurrentDate();
    const pad = (n, width = 2) => n.toString().padStart(width, '0');
    const year = now.getFullYear().toString().slice(-2); // últimos dos dígitos del año
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());
    return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * Construye un archivo XML con la información de los proveedores.
 * @param {number} index - Índice del tenant a procesar.
 */
async function buildProvidersXML(index) {
    const logFileName = 'Providers_Downloader';
    // Log de inicio del proceso
    logGenerator(logFileName, 'info', `[START] Iniciando la generación del archivo XML para el índice ${index}.`);

    // 1. Obtener proveedores
    let providers = await getProviders(index);
    if (!providers || providers.length === 0) {
        logGenerator(logFileName, 'warn', `[WARN] No hay proveedores para procesar en el índice ${index}.`);
        console.log('[WARN] No hay proveedores para procesar.');
        return;
    }

    logGenerator(logFileName, 'info', `[INFO] Se encontraron ${providers.length} proveedores para procesar en el índice ${index}.`);

    // 2. Datos del Emisor (tomados de .env)
    const emisor = {
        $: {
            Rfc: process.env.RFC || '',
            Nombre: process.env.NOMBRE || '',
            RegimenFiscal: process.env.REGIMEN || '',
            IdBase: process.env.ARG || ''
        }
    };

    // 3. Construir la lista de <Proveedor> en base a la información
    const proveedoresXML = providers.map(provider => {
        // Campos básicos
        const external_id = provider.external_id || '';
        const Nombre = provider.name || '';
        const Rfc = provider.rfc || '';
        const TipoProveedor = provider.type || '';
        const provider_id = provider.id || '';
        const NumRegIdTrib = provider.tax_id || '';
        const Terminos = provider.credit_days ? String(provider.credit_days) : '0';
        const approvedTimestamp = (provider.expedient && provider.expedient.approved) ? provider.expedient.approved : Date.now();
        const FechaActualizacion = formatTimestamp(approvedTimestamp);

        // -- BUSCAR CAMPOS DENTRO DE "fields" --
        let grupo_prov = '';
        let grupo_fiscal = '';
        let cuenta_contable = '';
        let metodoPago = 'PPD';  // Valor por defecto
        let formaPago = '2';     // Valor por defecto

        const fields = provider.expedient && provider.expedient.fields ? provider.expedient.fields : {};
        const fieldKeys = Object.keys(fields);

        fieldKeys.forEach(key => {
            const field = fields[key];
            if (!field.field_external_id) return;
            const fieldName = field.field_external_id.toLowerCase();

            if (fieldName === 'grupo_de_proveedores') {
                grupo_prov = field.value_external_id || '';
            } else if (fieldName === 'grupo_de_impuestos') {
                grupo_fiscal = field.value_external_id || '';
            } else if (fieldName === 'cuenta_de_gastos') {
                cuenta_contable = field.value_external_id || '';
            } else if (fieldName === 'metodopago') {
                metodoPago = field.value_external_id || 'PPD';
            } else if (fieldName === 'formapago') {
                formaPago = field.value_external_id || '2';
            }
        });

        // -- DATOS DEL DOMICILIO --
        let addressObj = {};
        if (provider.expedient && provider.expedient.addresses) {
            const addressList = Object.values(provider.expedient.addresses);
            if (addressList.length > 0 && addressList[0].value) {
                addressObj = addressList[0].value;
            }
        }
        const DomicilioProv = {
            $: {
                Calle: addressObj.street || '',
                NumeroExterior: addressObj.exterior_number || '',
                NumeroInterior: addressObj.interior_number || '',
                Colonia: addressObj.suburb || '',
                Localidad: addressObj.city || '',
                Municipio: addressObj.municipality || '',
                Estado: addressObj.state || '',
                Pais: addressObj.country || '',
                CodigoPostal: addressObj.zip_code || ''
            }
        };

        // -- CONTACTOS (se toman hasta 2) --
        let contactos = [];
        if (provider.expedient && provider.expedient.contacts) {
            contactos = Object.values(provider.expedient.contacts);
        }
        const contacto1 = contactos[0] && contactos[0].value ? contactos[0].value : {};
        const contacto2 = contactos[1] && contactos[1].value ? contactos[1].value : {};

        const Contacto1Prov = {
            $: {
                contact: `${contacto1.first_name || ''} ${contacto1.last_name || ''}`.trim(),
                contact_email: contacto1.email || '',
                contact_tel: contacto1.phone || ''
            }
        };
        const Contacto2Prov = {
            $: {
                contact: `${contacto2.first_name || ''} ${contacto2.last_name || ''}`.trim(),
                contact_email: contacto2.email || '',
                contact_tel: contacto2.phone || ''
            }
        };

        // -- CUENTA BANCARIA --
        let bankAccounts = [];
        if (provider.expedient && provider.expedient.bank_accounts) {
            bankAccounts = Object.values(provider.expedient.bank_accounts);
        }
        const firstBank = bankAccounts[0] && bankAccounts[0].value ? bankAccounts[0].value : {};
        const CuentaBancariaProv = {
            $: {
                bank: firstBank.bank_name || '',
                clabe: firstBank.clabe || '',
                account: firstBank.account || '',
                Sucursal: firstBank.subsidiary_number || firstBank.subsidiary || '',
                SWIFT: firstBank.code || '',
                REFDO: firstBank.reference || ''
            }
        };

        // Extraer la moneda (currency) de la cuenta bancaria
        const Moneda = firstBank.currency || 'MXN';

        return {
            $: {
                external_id,
                Nombre,
                Rfc,
                TipoProveedor,
                grupo_prov,
                RegimenFiscalReceptor: process.env.REGIMEN || '',
                MetodoPago: metodoPago,
                FormaPago: formaPago,
                provider_id,
                grupo_fiscal,
                Terminos,
                CuentaContable: cuenta_contable,
                Moneda,
                NumRegIdTrib,
                FechaActualizacion,
            },
            DomicilioProv,
            Contacto1Prov,
            Contacto2Prov,
            CuentaBancariaProv
        };
    });

    // 4. Crear el objeto final para xml2js
    const xmlObj = {
        Proveedores: {
            Emisor: emisor,
            Proveedor: proveedoresXML
        }
    };

    // 5. Generar el XML
    const builder = new xml2js.Builder({
        xmldec: { version: '1.0', encoding: 'UTF-8' },
        renderOpts: { pretty: true }
    });
    const xml = builder.buildObject(xmlObj);

    // 6. Guardar el archivo XML en la ruta definida en path_env, 
    //    con el nombre "providers-yyMMdd-hhmmss.xml"
    let downloadsDir = path_env.parsed.PATH;
    if (downloadsDir.startsWith('~')) {
        if (downloadsDir.startsWith('~/')) {
            downloadsDir = path.join(os.homedir(), downloadsDir.slice(2));
        } else {
            downloadsDir = path.join(os.homedir(), downloadsDir.slice(1));
        }
    }
    const outputFileName = `providers-${formatDateForFilename()}.xml`;
    const outputPath = path.join(downloadsDir, outputFileName);

    try {
        fs.writeFileSync(outputPath, xml, 'utf8');
        logGenerator(logFileName, 'info', `[OK] Archivo XML generado exitosamente en: ${outputPath}`);
        console.log('[OK] Archivo XML generado en:', outputPath);
    } catch (err) {
        logGenerator(logFileName, 'error', `[ERROR] Error al escribir el archivo XML en ${outputPath}: ${err.message}`);
        console.error('[ERROR] Error al escribir el archivo XML:', err);
    }
}

// buildProvidersXML(0).catch(err => {
//     console.error('Error en buildProvidersXML:', err);
//     logGenerator(logFileName, 'ERROR', err);
// });

module.exports = { buildProvidersXML };
