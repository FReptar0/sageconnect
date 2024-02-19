const log = require('log4js');
const dotenv = require('dotenv');
const path_env = dotenv.config({ path: '.env.path' });

logGenerator = (fileName, logLevel, logMessage) => {

    const date = new Date();
    fileName = `${date.toISOString().split('T')[0]}_${fileName}`;

    log.configure({
        appenders: { logs: { type: 'file', filename: path_env.parsed.LOG_PATH + fileName + '.log'} },
        //appenders: { logs: { type: 'file', filename: 'logs/log.log'} },
        categories: { default: { appenders: ['logs'], level: 'info' } }
    });
    const logger = log.getLogger(fileName);
    switch (logLevel) {
        case 'info':
            logger.info(logMessage);
            break;
        case 'error':
            logger.error(logMessage);
            break;
        case 'debug':
            logger.debug(logMessage);
            break;
        case 'warn':
            logger.warn(logMessage);
            break;
        default:
            logger.info(logMessage);
            break;
    }
}

module.exports = {
    logGenerator
}