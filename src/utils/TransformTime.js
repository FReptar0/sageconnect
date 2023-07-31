const notifier = require('node-notifier');

function hoursToMilliseconds(hours) {
    if (hours == 0) {
        try {
            notifier.notify({
                title: 'Asignación de tiempo',
                message: 'El tiempo de espera no puede ser 0',
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (error) {
            console.log('Error al enviar notificacion: ' + error);
            console.log('El tiempo de espera no puede ser 0');
        }
    } else if (hours < 0) {
        try {
            notifier.notify({
                title: 'Asignación de tiempo',
                message: 'El tiempo de espera no puede ser negativo',
                sound: true,
                wait: true,
                icon: process.cwd() + '/public/img/cerrar.png'
            });
        } catch (error) {
            console.log('Error al enviar notificacion: ' + error);
            console.log('El tiempo de espera no puede ser negativo');
        }
    } else {
        return hours * 60 * 60 * 1000;
    }
}

module.exports = {
    hoursToMilliseconds
}