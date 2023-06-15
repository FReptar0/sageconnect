const { getTypeE, getTypeI } = require('../utils/GetTypesCFDI');
const axios = require('axios');
const dotenv = require('dotenv');
const credentials = dotenv.config({ path: '.env.credentials.focaltec' });
const path_env = dotenv.config({ path: '.env.path' });
const fs = require('fs');
const path = require('path');

const url = credentials.parsed.URL;
const tenantId = credentials.parsed.TENANT_ID;
const apiKey = credentials.parsed.API_KEY;
const apiSecret = credentials.parsed.API_SECRET;

async function downloadCFDI() {
    const ids = [];
    const urls = [];

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
        urls.push(response.data.pdf);
        urls.push(response.data.xml);
    }

    for (let i = 0; i < urls.length; i++) {
        const name = path.basename(urls[i]).split('?')[0];
        const outPath = path.join(path_env.parsed.PATH, name);
        const fileStream = await axios.get(urls[i], { responseType: 'stream' });

        fileStream.data.pipe(fs.createWriteStream(outPath))
            .on('finish', () => {
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
}

