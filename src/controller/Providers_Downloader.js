// buildProvidersXML.js (o Providers_Downloader.js)

require('dotenv').config({ path: '.env' });
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const os = require('os');
const xml2js = require('xml2js');
const { logGenerator } = require('../utils/LogGenerator');
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
 * Formatea la fecha actual a "yyyy-mm-dd"
 * @returns {string} Fecha formateada
 */
function formatToday() {
    const today = new Date();
    const pad = (n, width = 2) => n.toString().padStart(width, '0');
    return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

/**
 * Construye un archivo XML con la información de los proveedores.
 * @param {number} index - Índice del tenant a procesar.
 */
async function buildProvidersXML(index) {
    // 1. Obtener proveedores
    let providers = await getProviders(index);
    if (!providers || providers.length === 0) {
        console.log('No hay proveedores para procesar.');
        return;
    }

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

    // 6. Guardar el archivo XML en la ruta definida en la variable de entorno,
    //    con el nombre "providers-yyyy-mm-dd.xml"
    let downloadsDir = path_env.parsed.PATH;
    if (downloadsDir.startsWith('~')) {
        if (downloadsDir.startsWith('~/')) {
            downloadsDir = path.join(os.homedir(), downloadsDir.slice(2));
        } else {
            downloadsDir = path.join(os.homedir(), downloadsDir.slice(1));
        }
    }
    const currentDate = formatToday();
    const outputPath = path.join(downloadsDir, `providers-${currentDate}.xml`);

    try {
        fs.writeFileSync(outputPath, xml, 'utf8');
        console.log('Archivo XML generado en:', outputPath);
    } catch (err) {
        console.error('Error al escribir el archivo XML:', err);
        logGenerator('buildProvidersXML', 'ERROR', err);
    }
}

// buildProvidersXML(0).catch(err => {
//     console.error('Error en buildProvidersXML:', err);
//     logGenerator('buildProvidersXML', 'ERROR', err);
// });

module.exports = { buildProvidersXML };
