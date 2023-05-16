const { getCFDIS } = require('../components/focaltec/CFDI');
const notifier = require('node-notifier');

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
        try {
            notifier.notify({
                title: 'Focaltec',
                message: 'Error al obtener el tipo de comprobante "P" : \n' + error + '\n',
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al obtener el tipo de comprobante "P" : \n' + error + '\n');
        }
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
        try {
            notifier.notify({
                title: 'Focaltec',
                message: 'Error al obtener el tipo de comprobante "I" : \n' + error + '\n',
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al obtener el tipo de comprobante "I" : \n' + error + '\n');
        }
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
        try {
            notifier.notify({
                title: 'Focaltec',
                message: 'Error al obtener el tipo de comprobante "E" : \n' + error + '\n',
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al obtener el tipo de comprobante "E" : \n' + error + '\n');
        }
    }
}

module.exports = {
    getTypeP,
    getTypeI,
    getTypeE
}