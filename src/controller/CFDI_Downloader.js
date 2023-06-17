const { getTypeE, getTypeI } = require('../utils/GetTypesCFDI');
const axios = require('axios');
const dotenv = require('dotenv');
const credentials = dotenv.config({ path: '.env.credentials.focaltec' });
const path_env = dotenv.config({ path: '.env.path' });
const fs = require('fs');
const path = require('path');
const parser = require('xml2js').parseString;
const xmlBuilder = require('xml2js').Builder;

const url = credentials.parsed.URL;
const tenantId = credentials.parsed.TENANT_ID;
const apiKey = credentials.parsed.API_KEY;
const apiSecret = credentials.parsed.API_SECRET;

async function downloadCFDI() {
    const ids = [];
    const urls = [];
    const outPathWFileNames = [];

    const types = await getTypeE();
    types.forEach(type => {
        ids.push(type.id);
    });

    const typesI = await getTypeI();
    typesI.forEach(type => {
        ids.push(type.id);
    });

    for (let i = 0; i < ids.length; i++) {
        const response = await axios.get(`${url}/api/1.0/extern/tenants/${tenantId}/cfdis/${ids[i]}/files`, {
            headers: {
                'PDPTenantKey': apiKey,
                'PDPTenantSecret': apiSecret
            }
        });
        //urls.push(response.data.pdf);
        urls.push(response.data.xml);
    }

    // Función para agregar la etiqueta <cfdi:Addenda> al archivo XML
    function agregarEtiquetaAddenda(xmlPath) {
        // Leer el archivo XML
        fs.readFile(xmlPath, 'utf8', (err, data) => {
            if (err) {
                console.error(`Error al leer el archivo ${xmlPath}:`, err);
                return;
            }

            // Analizar el archivo XML
            parser(data, (err, result) => {
                if (err) {
                    console.error(`Error al analizar el archivo ${xmlPath}:`, err);
                    return;
                }

                // Crear la estructura de la etiqueta <cfdi:Addenda> y su contenido
                const addenda = {
                    'cfdi:Addenda': {
                        'cfdi:AddendaEmisor': {
                            'cfdi:Proveedor': {
                                '$': {
                                    'IdBase': '.',
                                    'provider_id': '.',
                                    'external_id': '.',
                                    'bank': '.',
                                    'clabe': '.',
                                    'account': '.',
                                    'grupo_prov': '.',
                                    'grupo_fiscal': '.',
                                    'contact': '',
                                    'contact_email': '.',
                                    'Terminos': '.',
                                    'CuentaContable': '.'
                                },
                                'cfdi:DomicilioProv': {
                                    '$': {
                                        'Calle': '.',
                                        'NumeroExterior': '.',
                                        'NumeroInterior': '.',
                                        'Colonia': '.',
                                        'Localidad': '.',
                                        'Municipio': '.',
                                        'Estado': '.',
                                        'Pais': '.',
                                        'CodigoPostal': '.'
                                    }
                                }
                            }
                        }
                    }
                };

                // Agregar la etiqueta <cfdi:Addenda> al objeto XML
                result['cfdi:Comprobante']['cfdi:Addenda'] = addenda['cfdi:Addenda'];

                // Generar el XML actualizado
                const xml = new xmlBuilder().buildObject(result);

                // Escribir el XML actualizado en el mismo archivo
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

    for (let i = 0; i < urls.length; i++) {
        const name = path.basename(urls[i]).split('?')[0];
        const outPath = path.join(path_env.parsed.PATH, name);
        outPathWFileNames.push(outPath);
        const fileStream = await axios.get(urls[i], { responseType: 'stream' });

        const xmlPath = outPath; // Ruta del archivo XML descargado

        fileStream.data.pipe(fs.createWriteStream(outPath))
            .on('finish', () => {
                // Agregar etiqueta <cfdi:Addenda> al XML descargado
                agregarEtiquetaAddenda(xmlPath);

                console.log(`Archivo ${name} descargado`);
            }).on('error', (err) => {
                console.log('Error al descargar el archivo: ' + err);
            });
    }
}

downloadCFDI().then(() => {
    console.log('CFDIS descargados');
}).catch((err) => {
    console.log('Error al descargar los CFDIS: ' + err);
});

module.exports = {
    downloadCFDI
};
