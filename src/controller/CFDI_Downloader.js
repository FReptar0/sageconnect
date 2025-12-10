const { getTypeE, getTypeI } = require('../utils/GetTypesCFDI');
const axios = require('axios');
const dotenv = require('dotenv');
const credentials = dotenv.config({ path: '.env.credentials.focaltec' });
const path_env = dotenv.config({ path: '.env.path' });
const fs = require('fs');
const path = require('path');
const { runQuery } = require('../utils/SQLServerConnection');
const parser = require('xml2js').parseString;
const xmlBuilder = require('xml2js').Builder;
const { logGenerator } = require('../utils/LogGenerator');

const url = credentials.parsed.URL;

const tenantIds = [];
const apiKeys = [];
const apiSecrets = [];

const tenantIdValues = credentials.parsed.TENANT_ID.split(',');
const apiKeyValues = credentials.parsed.API_KEY.split(',');
const apiSecretValues = credentials.parsed.API_SECRET.split(',');

tenantIds.push(...tenantIdValues);
apiKeys.push(...apiKeyValues);
apiSecrets.push(...apiSecretValues);

/**
 * Función auxiliar para extraer OrdenCompra, AFE y datos adicionales desde additional_info y additional_amount.
 * Se espera que additional_info sea un arreglo de objetos con la estructura:
 * { field: { external_id: 'Orden_de_compra' or 'AFE', ... }, value: { raw: 'valor' } }
 * Si existe 'OC', se usa ese valor y se ignora 'orden_de_compra'.
 * Si no existe ninguno, se deja en blanco.
 * También extrae información de additional_amount para gastos adicionales.
 */
function getAfeAndOrden(additional_info, additional_amount = null) {
    let ordenCompra = '';
    // Buscar primero OC
    const ocObj = additional_info.find(item =>
        item.field &&
        item.field.external_id &&
        item.field.external_id.toLowerCase() === 'oc'
    );
    if (ocObj && ocObj.value) {
        ordenCompra = ocObj.value.raw;
    } else {
        // Si no hay OC, buscar orden_de_compra
        const ordenObj = additional_info.find(item =>
            item.field &&
            item.field.external_id &&
            item.field.external_id.toLowerCase() === 'orden_de_compra'
        );
        ordenCompra = ordenObj && ordenObj.value ? ordenObj.value.raw : '';
    }
    const afeObj = additional_info.find(item =>
        item.field &&
        item.field.external_id &&
        item.field.external_id.toLowerCase() === 'afe'
    );
    const afe = afeObj && afeObj.value ? afeObj.value.raw : '';
    
    // Extraer información de gastos adicionales
    let descriGastosAdi = '';
    let mtoGastosAdi = '';
    
    if (additional_amount && additional_amount.name && additional_amount.amount) {
        descriGastosAdi = additional_amount.name;
        mtoGastosAdi = additional_amount.amount.toString();
    }
    
    return { ordenCompra, afe, descriGastosAdi, mtoGastosAdi };
}

const urlBase = (index) => `${url}/api/1.0/extern/tenants/${tenantIds[index]}`;

async function downloadCFDI(index) {
    const logFileName = 'CFDI_Downloader';
    const cfdiData = [];
    
    console.log(`[INICIO] Ejecutando proceso de descarga de CFDIs - Tenant: ${tenantIds[index]}`);

    const typeE = await getTypeE(index);
    typeE.forEach((type) => {
        cfdiData.push({
            cfdiId: type.id,
            providerId: type.metadata.provider_id,
            rfcReceptor: type.cfdi && type.cfdi.receptor ? type.cfdi.receptor.rfc : '',
            additional_info: type.metadata.additional_info,
            additional_amount: type.metadata.additional_amount
        });
    });

    const typeI = await getTypeI(index);
    typeI.forEach((type) => {
        cfdiData.push({
            cfdiId: type.id,
            providerId: type.metadata.provider_id,
            rfcReceptor: type.cfdi && type.cfdi.receptor ? type.cfdi.receptor.rfc : '',
            additional_info: type.metadata.additional_info,
            additional_amount: type.metadata.additional_amount
        });
    });

    const apiKey = apiKeys[index];
    const apiSecret = apiSecrets[index];

    const urls = [];
    const outPathWFileNames = [];

    // En Windows, se espera que path_env.parsed.PATH ya sea una ruta absoluta, por ejemplo "C:\XMLSFOCALTEC"
    const downloadsDir = path_env.parsed.PATH;
    // Crear el directorio si no existe
    if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
    }

    for (let i = 0; i < cfdiData.length; i++) {
        const response = await axios.get(`${urlBase(index)}/cfdis/${cfdiData[i].cfdiId}/files`, {
            headers: {
                'PDPTenantKey': apiKey,
                'PDPTenantSecret': apiSecret,
            },
        });
        if (response.data.xml !== undefined) {
            urls.push(response.data.xml);
        } else {
            console.log(`[WARN] CFDI sin URL XML para id: ${cfdiData[i].cfdiId}`);
        }
    }

    for (let i = 0; i < urls.length; i++) {
        const name = path.basename(urls[i]).split('?')[0];
        const outPath = path.join(downloadsDir, name);
        outPathWFileNames.push(outPath);
        const fileStream = await axios.get(urls[i], { responseType: 'stream' });
        const xmlPath = outPath;

        fileStream.data
            .pipe(fs.createWriteStream(outPath))
            .on('finish', () => {
                agregarEtiquetaAddenda(xmlPath, cfdiData[i], index, logFileName);
                console.log(`[INFO] Archivo ${name} descargado`);
            })
            .on('error', (err) => {
                console.log('[ERROR] Error al descargar el archivo: ' + err);
                logGenerator(logFileName, 'error', 'Error al descargar el archivo: ' + err);
                // Si ocurre un error, intenta eliminar el archivo (si existe)
                fs.unlink(xmlPath, (unlinkErr) => {
                    if (unlinkErr) {
                        console.error(`[ERROR] Error al eliminar el archivo ${xmlPath}:`, unlinkErr);
                        logGenerator(logFileName, 'error', `Error al eliminar el archivo ${xmlPath}: ${unlinkErr}`);
                        return;
                    }
                    console.log(`[INFO] Archivo ${xmlPath} eliminado exitosamente.`);
                });
            });
    }
}

function agregarEtiquetaAddenda(xmlPath, dataCfdi, index, logFileName = 'CFDI_Downloader') {
    fs.readFile(xmlPath, 'utf8', async (err, data) => {
        if (err) {
            console.error(`[ERROR] Error al leer el archivo ${xmlPath}:`, err);
            logGenerator(logFileName, 'error', `Error al leer el archivo ${xmlPath}: ${err}`);
            return;
        }

        const apiKey = apiKeys[index];
        const apiSecret = apiSecrets[index];
        const response = await axios.get(`${urlBase(index)}/providers/${dataCfdi.providerId}`, {
            headers: {
                'PDPTenantKey': apiKey,
                'PDPTenantSecret': apiSecret
            }
        });

        const query = `SELECT COALESCE(idCia, 'NOT_FOUND') AS Resultado FROM FESAPARAM WHERE idCia IN (SELECT idCia FROM FESAPARAM WHERE Parametro = 'RFCReceptor' AND Valor = '${dataCfdi.rfcReceptor}') AND Parametro = 'DataBase';`
        const dbResponse = await runQuery(query).catch(() => {
            console.log('Error al ejecutar la consulta:', query);
            logGenerator(logFileName, 'error', 'Error al ejecutar la consulta: ' + query);
            return { recordset: [{ Resultado: 'NOT_FOUND' }] };
        });

        const idCia = dbResponse.recordset[0].Resultado || '';

        const bankAccounts = response.data.expedient.bank_accounts;
        const firstBankAccountKey = Object.keys(bankAccounts)[0];
        const firstBankAccountValue = bankAccounts[firstBankAccountKey];

        const addresses = response.data.expedient.addresses;
        const firstAddressKey = Object.keys(addresses)[0];
        const firstAddressValue = addresses[firstAddressKey];

        const contact = response.data.expedient.contacts;
        const firstContactKey = Object.keys(contact)[0];
        const firstContactValue = contact[firstContactKey];

        if (!firstBankAccountValue) {
            console.log(`[WARN] No se tienen los datos del banco. Eliminando archivo: ${xmlPath}`);
            logGenerator(logFileName, 'error', 'No se tienen los datos del banco. Eliminando archivo: ' + xmlPath);
            fs.unlink(xmlPath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error(`[ERROR] Error al eliminar el archivo ${xmlPath}:`, unlinkErr);
                    logGenerator(logFileName, 'error', `Error al eliminar el archivo ${xmlPath}: ${unlinkErr}`);
                    return;
                }
                console.log(`[INFO] Archivo ${xmlPath} eliminado exitosamente.`);
            });
            return;
        }

        parser(data, (err, result) => {
            if (err) {
                console.error(`[ERROR] Error al analizar el archivo ${xmlPath}:`, err);
                logGenerator(logFileName, 'error', `Error al analizar el archivo ${xmlPath}: ${err}`);
                return;
            }

            const fields = response.data.expedient.fields;
            const fieldKeys = Object.keys(fields);
            let grupo_prov = '';
            let grupo_fiscal = '';
            let cuenta_contable = '';

            fieldKeys.forEach(key => {
                if (fields[key].field_external_id && fields[key].field_external_id.toLowerCase() == 'grupo_de_proveedores') {
                    grupo_prov = fields[key].value_external_id;
                }
                if (fields[key].field_external_id && fields[key].field_external_id.toLowerCase() == 'grupo_de_impuestos') {
                    grupo_fiscal = fields[key].value_external_id;
                }
                if (fields[key].field_external_id && fields[key].field_external_id.toLowerCase() == 'cuenta_de_gastos') {
                    cuenta_contable = fields[key].value_external_id;
                }
            });

            const bankData = {
                'bank': firstBankAccountValue ? firstBankAccountValue.value.bank_name : '',
                'clabe': firstBankAccountValue ? firstBankAccountValue.value.clabe : '',
                'account': firstBankAccountValue ? firstBankAccountValue.value.account : '',
                'grupo_prov': grupo_prov || '',
                'grupo_fiscal': grupo_fiscal || '',
                'cuenta_contable': cuenta_contable || ''
            };

            const addressData = {
                'calle': firstAddressValue ? firstAddressValue.value.street : '',
                'noExterior': firstAddressValue ? firstAddressValue.value.exterior_number : '',
                'noInterior': firstAddressValue ? firstAddressValue.value.interior_number : '',
                'colonia': firstAddressValue ? firstAddressValue.value.suburb : '',
                'localidad': firstAddressValue ? firstAddressValue.value.city : '',
                'municipio': firstAddressValue ? firstAddressValue.value.city : '',
                'estado': firstAddressValue ? firstAddressValue.value.state : '',
                'pais': firstAddressValue ? firstAddressValue.value.country : '',
                'codigoPostal': firstAddressValue ? firstAddressValue.value.zip_code : ''
            };

            const contactData = {
                'nombre': firstContactValue ? `${firstContactValue.value.first_name} ${firstContactValue.value.last_name}` : '',
                'telefono': firstContactValue ? firstContactValue.value.phone : '',
                'correo': firstContactValue ? firstContactValue.value.email : ''
            };

            const { ordenCompra, afe, descriGastosAdi, mtoGastosAdi } = dataCfdi.additional_info ? 
                getAfeAndOrden(dataCfdi.additional_info, dataCfdi.additional_amount) : 
                { ordenCompra: '', afe: '', descriGastosAdi: '', mtoGastosAdi: '' };

            const addenda = {
                'cfdi:AddendaEmisor': {
                    'cfdi:DoctoDatosAdi': {
                        '$': {
                            'OrdenCompra': ordenCompra,
                            'AFE': afe,
                            'DescriGastosAdi': descriGastosAdi,
                            'MtoGastosAdi': mtoGastosAdi
                        }
                    },
                    'cfdi:Proveedor': {
                        '$': {
                            'IdBase': idCia,
                            'provider_id': dataCfdi.providerId,
                            'external_id': response.data.external_id || '',
                            'bank': bankData.bank,
                            'clabe': bankData.clabe,
                            'account': bankData.account,
                            'grupo_prov': bankData.grupo_prov,
                            'grupo_fiscal': bankData.grupo_fiscal,
                            'contact': contactData.nombre,
                            'contact_email': contactData.correo,
                            'contact_phone': contactData.telefono,
                            'Terminos': response.data.credit_days || '',
                            'CuentaContable': bankData.cuenta_contable,
                            'TipoProveedor': response.data.type,
                        },
                        'cfdi:DomicilioProv': {
                            '$': {
                                'Calle': addressData.calle,
                                'NumeroExterior': addressData.noExterior,
                                'NumeroInterior': addressData.noInterior,
                                'Colonia': addressData.colonia,
                                'Localidad': addressData.localidad,
                                'Municipio': addressData.municipio,
                                'Estado': addressData.estado,
                                'Pais': addressData.pais,
                                'CodigoPostal': addressData.codigoPostal
                            }
                        }
                    },
                    // Aquí se anida DoctoDatosAdi dentro de AddendaEmisor

                }
            };

            result['cfdi:Comprobante']['cfdi:Addenda'] = addenda;

            const xmlBuilderInstance = new xmlBuilder();
            const xml = xmlBuilderInstance.buildObject(result);

            fs.writeFile(xmlPath, xml, 'utf8', (err) => {
                if (err) {
                    console.error(`[ERROR] Error al escribir el archivo ${xmlPath}:`, err);
                    logGenerator(logFileName, 'error', `Error al escribir el archivo ${xmlPath}: ${err}`);
                    return;
                }
                console.log(`[INFO] Archivo ${xmlPath} actualizado exitosamente.`);
            });
        });
    });
}

module.exports = {
    downloadCFDI
};

// downloadCFDI(0).catch(err => {
//     console.error('Error en downloadCFDI:', err);
//     logGenerator('downloadCFDI', 'error', err);
// });
