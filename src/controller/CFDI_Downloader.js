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

const url = credentials.parsed.URL;

const tenantIds = []
const apiKeys = []
const apiSecrets = []

const tenantIdValues = credentials.parsed.TENANT_ID.split(',');
const apiKeyValues = credentials.parsed.API_KEY.split(',');
const apiSecretValues = credentials.parsed.API_SECRET.split(',');

tenantIds.push(...tenantIdValues);
apiKeys.push(...apiKeyValues);
apiSecrets.push(...apiSecretValues);

async function downloadCFDI(index) {
    const cfdiData = [];

    const typeE = await getTypeE(index);
    typeE.forEach((type) => {
        cfdiData.push({
            cfdiId: type.id,
            providerId: type.metadata.provider_id,
            rfcReceptor: type.cfdi.receptor.rfc,
        });
    });

    const typeI = await getTypeI(index);
    typeI.forEach((type) => {
        cfdiData.push({
            cfdiId: type.id,
            providerId: type.metadata.provider_id,
            rfcReceptor: type.cfdi.receptor.rfc,
        });
    });

    const apiKey = apiKeys[index];
    const apiSecret = apiSecrets[index];

    const urls = [];
    const outPathWFileNames = [];

    for (let i = 0; i < cfdiData.length; i++) {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis/${cfdiData[i].cfdiId}/files`, {
            headers: {
                'PDPTenantKey': apiKey,
                'PDPTenantSecret': apiSecret,
            },
        });
        urls.push(response.data.xml);
    }

    for (let i = 0; i < urls.length; i++) {
        const name = path.basename(urls[i]).split('?')[0];
        const outPath = path.join(path_env.parsed.PATH, name);
        outPathWFileNames.push(outPath);
        const fileStream = await axios.get(urls[i], { responseType: 'stream' });

        const xmlPath = outPath;

        fileStream.data
            .pipe(fs.createWriteStream(outPath))
            .on('finish', () => {
                agregarEtiquetaAddenda(xmlPath, cfdiData[i], index);
                console.log(`Archivo ${name} descargado`);
            })
            .on('error', (err) => {
                console.log('Error al descargar el archivo: ' + err);
                // Delete the file if an error occurs
                fs.unlink(xmlPath, (unlinkErr) => {
                    if (unlinkErr) {
                        console.error(`Error al eliminar el archivo ${xmlPath}:`, unlinkErr);
                        return;
                    }
                    console.log(`Archivo ${xmlPath} eliminado exitosamente.`);
                });
            });
    }
}


function agregarEtiquetaAddenda(xmlPath, dataCfdi, index) {
    fs.readFile(xmlPath, 'utf8', async (err, data) => {
        if (err) {
            console.error(`Error al leer el archivo ${xmlPath}:`, err);
            return;
        }

        const apiKey = apiKeys[index];
        const apiSecret = apiSecrets[index];
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantIds[index]}/providers/${dataCfdi.providerId}`, {
            headers: {
                'PDPTenantKey': apiKey,
                'PDPTenantSecret': apiSecret
            }
        });

        const query = `SELECT COALESCE(idCia, 'NOT_FOUND') AS Resultado FROM FESAPARAM WHERE idCia IN (SELECT idCia FROM FESAPARAM WHERE Parametro = 'RFCReceptor' AND Valor = '${dataCfdi.rfcReceptor}') AND Parametro = 'DataBase';`
        const dbResponse = await runQuery(query);

        const idCia = dbResponse.recordset[0].Resultado || '';

        //idCia = 'NOT_FOUND';

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
            console.log('No se tienen los datos del banco. Eliminando archivo:', xmlPath);
            // Delete the file if the bank data is not found
            fs.unlink(xmlPath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error(`Error al eliminar el archivo ${xmlPath}:`, unlinkErr);
                    return;
                }
                console.log(`Archivo ${xmlPath} eliminado exitosamente.`);
            });
            return;
        }


        parser(data, (err, result) => {
            if (err) {
                console.error(`Error al analizar el archivo ${xmlPath}:`, err);
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
                'grupo_prov': grupo_prov ? grupo_prov : '',
                'grupo_fiscal': grupo_fiscal ? grupo_fiscal : '',
                'cuenta_contable': cuenta_contable ? cuenta_contable : ''
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

            const addenda = {
                'cfdi:Addenda': {
                    'cfdi:AddendaEmisor': {
                        'cfdi:Proveedor': {
                            '$': {
                                'IdBase': idCia,
                                'provider_id': dataCfdi.providerId, // Agregado el provider_id
                                'external_id': response.data.external_id || '',
                                'bank': bankData.bank,
                                'clabe': bankData.clabe,
                                'account': bankData.account,
                                'grupo_prov': bankData.grupo_prov,
                                'grupo_fiscal': bankData.grupo_fiscal,
                                'contact': contactData.nombre,
                                'contact_email': contactData.correo,
                                'contact_phone': contactData.telefono,
                                'Terminos': response.data.credit_days || '30',
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
                        }
                    }
                }
            };

            result['cfdi:Comprobante']['cfdi:Addenda'] = addenda;

            const xmlBuilderInstance = new xmlBuilder();
            const xml = xmlBuilderInstance.buildObject(result);

            fs.writeFile(xmlPath, xml, 'utf8', (err) => {
                if (err) {
                    console.error(`Error al escribir el archivo ${xmlPath}:`, err);
                    return;
                }
                console.log(`Archivo ${xmlPath} actualizado exitosamente.`);
            });
        });
    });
}

const forResponse = async () => {
    for (let index = 0; index < tenantIds.length; index++) {
        await downloadCFDI(index);
    }
}

/* forResponse().then(() => {
    console.log('Terminado');
}).catch((err) => {
    console.error('Error:', err);
}); */


module.exports = {
    downloadCFDI
};
