const { runQuery } = require('./SQLServerConnection')

function minutesToMilliseconds(minutes) {
    if (minutes == 0) {
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