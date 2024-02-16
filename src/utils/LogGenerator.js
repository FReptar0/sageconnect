const log = require('log4js');
const dotenv = require('dotenv');
const path_env = dotenv.config({ path: '.env.path' });

logGenerator = (fileName, logLevel, logMessage) => {
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

logGenerator('LogGenerator', 'info', 'This is an info message');
logGenerator('LogGenerator', 'error', 'This is an error message');
logGenerator('LogGenerator', 'debug', 'This is a debug message');
logGenerator('LogGenerator', 'warn', 'This is a warning message');

module.exports = {
    logGenerator
}