// buildProvidersXML.js

require('dotenv').config({ path: '.env.credentials.focaltec' });
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const { logGenerator } = require('../utils/LogGenerator');
const {getProviders} = require('../utils/GetProviders');
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
        const provider_id = provider.id || '';
        // Para NumRegIdTrib
        const NumRegIdTrib = provider.tax_id || '';
        // Asumimos que expedient.valid es un booleano (si no existe, se pone false)
        const ExpedientValid = provider.expedient && typeof provider.expedient.valid === 'boolean'
            ? provider.expedient.valid
            : false;
        // credit_days -> para Terminos
        const Terminos = provider.credit_days ? String(provider.credit_days) : '0';
        // Fecha de actualización (si no existe, se usa la actual)
        const FechaActualizacion = new Date(provider.updated_at || Date.now()).toISOString();

        // -- BUSCAR CAMPOS DENTRO DE "fields" --
        let grupo_prov = '';
        let grupo_fiscal = '';
        let cuenta_contable = '';
        let metodoPago = 'PPD';  // Default
        let formaPago = '2';     // Default

        const fields = provider.expedient && provider.expedient.fields ? provider.expedient.fields : {};
        const fieldKeys = Object.keys(fields);

        fieldKeys.forEach(key => {
            const field = fields[key];
            if (!field.field_external_id) return; // Saltar si no tiene field_external_id
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
                Sucursal: firstBank.sucursal || '',
                SWIFT: firstBank.swift || '',
                // REFDO = reference en el API (si existe)
                REFDO: firstBank.reference || ''
            }
        };

        // Extraer la moneda (currency) de la cuenta bancaria
        const Moneda = firstBank.currency || 'MXN'; // Elige el valor por defecto que necesites

        // -- ESTRUCTURA DEL <Proveedor> --
        return {
            $: {
                external_id,
                Nombre,
                Rfc,
                grupo_prov,
                RegimenFiscalReceptor: process.env.REGIMEN || '', // Ajusta si deseas otro régimen
                MetodoPago: metodoPago,
                FormaPago: formaPago,
                provider_id,
                grupo_fiscal,
                Terminos,
                CuentaContable: cuenta_contable,
                Moneda, // <-- Aquí se asigna la moneda dinámica
                NumRegIdTrib,
                FechaActualizacion,
                ExpedientValid
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

    // 6. Guardar en un archivo (por ejemplo, providers.xml) 
    const outputPath = path.join(__dirname, 'providers.xml');
    try {
        fs.writeFileSync(outputPath, xml, 'utf8');
        console.log('Archivo XML generado en:', outputPath);
    } catch (err) {
        console.error('Error al escribir el archivo XML:', err);
        logGenerator('buildProvidersXML', 'ERROR', err);
    }
}

buildProvidersXML(0).catch(err => {
    console.error('Error en buildProvidersXML:', err);
    logGenerator('buildProvidersXML', 'ERROR', err);
});

module.exports = { buildProvidersXML };
