const notifier = require('node-notifier');

function minutesToMilliseconds(minutes) {
    if (minutes == 0) {
        try {
            notifier.notify({
                title: 'Asignación de tiempo',
                message: 'El tiempo de espera no puede ser 0',
                sound: true,
                wait: true
            });
        } catch (error) {
            console.log('Error al enviar notificacion: ' + error);
            console.log('El tiempo de espera no puede ser 0');
        }
    } else if (minutes < 0) {
        try {
            notifier.notify({
                title: 'Asignación de tiempo',
                message: 'El tiempo de espera no puede ser negativo',
                sound: true,
                wait: true
            });
        } catch (error) {
            console.log('Error al enviar notificacion: ' + error);
            console.log('El tiempo de espera no puede ser negativo');
        }
    } else {
        return minutes * 60000;
    }
}

module.exports = {
    minutesToMilliseconds
}