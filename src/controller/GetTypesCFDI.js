const { getCFDIS } = require('../components/focaltec/CFDI');

async function getTypeP() {
    try {
        const data = await getCFDIS();
        let typeP = [];
        data.forEach(element => {
            if (element.cfdi.tipo_comprobante == 'P') {
                typeP.push(element);
            }
        });
        return typeP;
    } catch (error) {
        throw new Error('Error al obtener el tipo de comprobante "P" : \n' + error + '\n');
    }
}

async function getTypeI() {
    try {
        const data = await getCFDIS();
        let typeI = [];
        data.forEach(element => {
            if (element.cfdi.tipo_comprobante == 'I') {
                typeI.push(element);
            }
        });
        return typeI;
    } catch (error) {
        throw new Error('Error al obtener el tipo de comprobante "I" : \n' + error + '\n');
    }
}

async function getTypeE() {
    try {
        const data = await getCFDIS();
        let typeE = [];
        data.forEach(element => {
            if (element.cfdi.tipo_comprobante == 'E') {
                typeE.push(element);
            }
        });
        return typeE;
    } catch (error) {
        throw new Error('Error al obtener el tipo de comprobante "E" : \n' + error + '\n');
    }
}

module.exports = {
    getTypeP,
    getTypeI,
    getTypeE
}