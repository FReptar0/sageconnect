const { runQuery } = require('./SQLServerConnection')

const minutes = runQuery(`SELECT TOP 1 CAST(Valor AS DECIMAL(10,2)) as WAIT_TIME FROM FESAPARAM WHERE  Parametro = 'WAIT_TIME'`)


function minutesToMilliseconds() {
    if (minutes === 0) {
        throw new Error("Input cannot be 0");
    } else if (minutes < 0) {
        throw new Error("Input cannot be negative");
    } else {
        return minutes * 60000;
    }
}

module.exports = {
    minutesToMilliseconds
}