const winston = require('winston');
const { getCurrentDateString, getCurrentDateFormatted } = require('./TimezoneHelper');
const config = require('../config');
const fs = require('fs');
const path = require('path');

const loggerCache = new Map();
let lastSeenDate = null;

function buildLogger(filePath) {
    return winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(({ timestamp, level, message }) => {
                return `${timestamp} [${level.toUpperCase()}]: ${message}`;
            })
        ),
        transports: [
            new winston.transports.File({ filename: filePath }),
        ],
    });
}

function rotateOldLoggers(currentDate) {
    if (lastSeenDate && lastSeenDate !== currentDate) {
        for (const [key, logger] of loggerCache.entries()) {
            if (key.startsWith(`${lastSeenDate}|`)) {
                try { logger.close(); } catch (_e) { /* swallow */ }
                loggerCache.delete(key);
            }
        }
    }
    lastSeenDate = currentDate;
}

function getOrCreateLogger(dateISO, fileName) {
    const cacheKey = `${dateISO}|${fileName}`;
    const existing = loggerCache.get(cacheKey);
    if (existing) return existing;

    const logDir = path.join(config.paths.logs, 'sageconnect', dateISO);

    try {
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const logger = buildLogger(path.join(logDir, `${fileName}.log`));
        loggerCache.set(cacheKey, logger);
        return logger;
    } catch (error) {
        console.error(`[ERROR] No se pudo crear el directorio de logs: ${logDir}`, error);
        const fallbackPath = path.join(config.paths.logs, 'sageconnect');
        if (!fs.existsSync(fallbackPath)) {
            fs.mkdirSync(fallbackPath, { recursive: true });
        }
        const fallbackKey = `fallback|${fileName}`;
        const cachedFallback = loggerCache.get(fallbackKey);
        if (cachedFallback) return cachedFallback;
        const fallbackName = `${getCurrentDateFormatted()}-${fileName}`;
        const logger = buildLogger(path.join(fallbackPath, `${fallbackName}.log`));
        loggerCache.set(fallbackKey, logger);
        return logger;
    }
}

const logGenerator = (fileName, logLevel, logMessage) => {
    const isoDate = getCurrentDateString();
    rotateOldLoggers(isoDate);
    const logger = getOrCreateLogger(isoDate, fileName);
    logger.log({ level: logLevel, message: logMessage });
};

function _closeAll() {
    for (const [key, logger] of loggerCache.entries()) {
        try { logger.close(); } catch (_e) { /* swallow */ }
        loggerCache.delete(key);
    }
    lastSeenDate = null;
}

module.exports = {
    logGenerator,
    _closeAll,
};
