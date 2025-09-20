const winston = require('winston');
const { getCurrentDate, getCurrentDateFormatted } = require('./TimezoneHelper');
const dotenv = require('dotenv');
const path_env = dotenv.config({ path: '.env.path' });

logGenerator = (fileName, logLevel, logMessage) => {
    const formattedDate = getCurrentDateFormatted();
    fileName = `${formattedDate}-${fileName}`;

    const logger = winston.createLogger({
        level: logLevel,
        format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(({ timestamp, level, message }) => {
                return `${timestamp} [${level.toUpperCase()}]: ${message}`;
            })
        ),
        transports: [
            new winston.transports.File({
                filename: `${path_env.parsed.LOG_PATH}sageconnect/${fileName}.log`,
                level: logLevel
            })
        ]
    });

    // Log the message
    logger.log({ level: logLevel, message: logMessage });
};

module.exports = {
    logGenerator
};