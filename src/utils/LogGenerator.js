const winston = require('winston');
const { getCurrentDate, getCurrentDateFormatted, getCurrentDateString } = require('./TimezoneHelper');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const path_env = dotenv.config({ path: '.env.path' });

logGenerator = (fileName, logLevel, logMessage) => {
    const isoDate = getCurrentDateString(); // YYYY-MM-DD format for folder structure
    
    // Create folder path: logs/sageconnect/YYYY-MM-DD/
    const logDir = path.join(path_env.parsed.LOG_PATH, 'sageconnect', isoDate);
    
    // Ensure directory exists
    try {
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    } catch (error) {
        console.error(`[ERROR] No se pudo crear el directorio de logs: ${logDir}`, error);
        // Fallback to basic path without date folder if directory creation fails
        const fallbackPath = path.join(path_env.parsed.LOG_PATH, 'sageconnect');
        if (!fs.existsSync(fallbackPath)) {
            fs.mkdirSync(fallbackPath, { recursive: true });
        }
        // Use old format as fallback
        fileName = `${getCurrentDateFormatted()}-${fileName}`;
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
                    filename: path.join(fallbackPath, `${fileName}.log`),
                    level: logLevel
                })
            ]
        });
        logger.log({ level: logLevel, message: logMessage });
        return;
    }

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
                filename: path.join(logDir, `${fileName}.log`),
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