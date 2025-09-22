const fs = require('fs');
const path = require('path');
const { getCurrentDateString } = require('../utils/TimezoneHelper');
const { logGenerator } = require('../utils/LogGenerator');
const dotenv = require('dotenv');

const path_env = dotenv.config({ path: '.env.path' });

/**
 * Log Dashboard Service
 * Provides functionality to read and analyze log files for the dashboard
 */

// List of all log file types in the system
const LOG_TYPES = [
    // Core System Logs
    'ServerStatus',
    'ForResponse', 
    'ChildProcess',
    'MainProcess',
    
    // CFDI Processing Logs
    'GetTypesCFDI',
    'CFDI_Downloader',
    'SagePaymentController',
    'PortalPaymentController',
    
    // Purchase Order Logs
    'PortalOC_Creation',
    'PortalOC_Cancellation', 
    'PortalOC_Close',
    'PortalOC_StatusUpdate',
    
    // Utility Logs
    'Providers_Downloader',
    'GetProviders',
    'EmailSender',
];

/**
 * Gets the log directory path for a specific date
 * @param {string} date - Date string in YYYY-MM-DD format
 * @returns {string} Log directory path
 */
function getLogDirectory(date = null) {
    const logDate = date || getCurrentDateString();
    return path.join(path_env.parsed.LOG_PATH, 'sageconnect', logDate);
}

/**
 * Reads a specific log file
 * @param {string} logType - Type of log file
 * @param {string} date - Date string in YYYY-MM-DD format
 * @returns {Promise<Object>} Log data with lines and metadata
 */
async function readLogFile(logType, date = null) {
    const logFileName = 'LogDashboardService';
    
    try {
        const logDir = getLogDirectory(date);
        const logFilePath = path.join(logDir, `${logType}.log`);
        
        
        if (!fs.existsSync(logFilePath)) {
            return {
                exists: false,
                lines: [],
                size: 0,
                lastModified: null,
                path: logFilePath
            };
        }
        
        const stats = fs.statSync(logFilePath);
        const content = fs.readFileSync(logFilePath, 'utf8');
        const lines = content.trim().split('\n').filter(line => line.length > 0);
        
        return {
            exists: true,
            lines: lines,
            size: stats.size,
            lastModified: stats.mtime,
            path: logFilePath,
            lineCount: lines.length
        };
        
    } catch (error) {
        logGenerator(logFileName, 'error', `Error reading log file ${logType}: ${error.message}`);
        return {
            exists: false,
            lines: [],
            size: 0,
            lastModified: null,
            error: error.message
        };
    }
}

/**
 * Gets log data for all log types
 * @param {string} date - Date string in YYYY-MM-DD format
 * @returns {Promise<Object>} All log data organized by type
 */
async function getAllLogs(date = null) {
    const logFileName = 'LogDashboardService';
    
    try {
        const logsData = {};
        
        for (const logType of LOG_TYPES) {
            logsData[logType] = await readLogFile(logType, date);
        }
        
        logGenerator(logFileName, 'info', `Retrieved logs for ${Object.keys(logsData).length} log types`);
        return logsData;
        
    } catch (error) {
        logGenerator(logFileName, 'error', `Error getting all logs: ${error.message}`);
        throw error;
    }
}

/**
 * Calculates execution timing based on current system time
 * @returns {Promise<Object>} Execution timing data
 */
async function getLastExecutionInfo() {
    const logFileName = 'LogDashboardService';
    
    try {
        const now = new Date();
        
        // Calculate the last execution time (most recent 15-minute mark)
        const lastExecution = getLastScheduledTime(now);
        
        // Calculate next execution (next 15-minute mark)
        const nextExecution = getNextScheduledTime(now);
        
        // Calculate time until next execution
        const millisecondsUntilNext = nextExecution.getTime() - now.getTime();
        const minutesUntilNext = Math.ceil(millisecondsUntilNext / (1000 * 60));
        const secondsUntilNext = Math.ceil(millisecondsUntilNext / 1000);
        
        logGenerator(logFileName, 'info', 
            `Calculated timing - Last: ${lastExecution.toISOString()}, Next: ${nextExecution.toISOString()}, Seconds until next: ${secondsUntilNext}`
        );
        
        return {
            lastExecution: lastExecution,
            nextExecution: nextExecution,
            status: 'Active',
            minutesUntilNext: minutesUntilNext,
            secondsUntilNext: secondsUntilNext
        };
        
    } catch (error) {
        logGenerator(logFileName, 'error', `Error calculating execution timing: ${error.message}`);
        return {
            lastExecution: null,
            nextExecution: null,
            status: 'Error',
            error: error.message
        };
    }
}

/**
 * Gets the last scheduled execution time (most recent 15-minute mark)
 * @param {Date} currentTime - Current time
 * @returns {Date} Last scheduled execution time
 */
function getLastScheduledTime(currentTime) {
    const current = new Date(currentTime);
    const currentMinutes = current.getMinutes();
    const currentSeconds = current.getSeconds();
    
    // Find the most recent 15-minute mark
    const scheduleMinutes = [0, 15, 30, 45];
    let lastMinute = scheduleMinutes.filter(min => min <= currentMinutes).pop();
    
    const lastExecution = new Date(current);
    
    if (lastMinute !== undefined) {
        // Last execution was in the same hour
        lastExecution.setMinutes(lastMinute);
        lastExecution.setSeconds(0);
        lastExecution.setMilliseconds(0);
    } else {
        // Last execution was in the previous hour at :45
        lastExecution.setHours(lastExecution.getHours() - 1);
        lastExecution.setMinutes(45);
        lastExecution.setSeconds(0);
        lastExecution.setMilliseconds(0);
    }
    
    return lastExecution;
}

/**
 * Gets the next scheduled execution time
 * @param {Date} currentTime - Current time
 * @returns {Date} Next scheduled execution time
 */
function getNextScheduledTime(currentTime) {
    const current = new Date(currentTime);
    const currentMinutes = current.getMinutes();
    
    // Find the next 15-minute mark
    const scheduleMinutes = [0, 15, 30, 45];
    let nextMinute = scheduleMinutes.find(min => min > currentMinutes);
    
    const nextExecution = new Date(current);
    
    if (nextMinute !== undefined) {
        // Next execution is in the same hour
        nextExecution.setMinutes(nextMinute);
        nextExecution.setSeconds(0);
        nextExecution.setMilliseconds(0);
    } else {
        // Next execution is in the next hour at :00
        nextExecution.setHours(nextExecution.getHours() + 1);
        nextExecution.setMinutes(0);
        nextExecution.setSeconds(0);
        nextExecution.setMilliseconds(0);
    }
    
    return nextExecution;
}


/**
 * Gets available log dates (directories)
 * @returns {Promise<Array>} Array of available date strings
 */
async function getAvailableLogDates() {
    const logFileName = 'LogDashboardService';
    
    try {
        const sageConnectDir = path.join(path_env.parsed.LOG_PATH, 'sageconnect');
        
        if (!fs.existsSync(sageConnectDir)) {
            return [];
        }
        
        const items = fs.readdirSync(sageConnectDir);
        const dates = items.filter(item => {
            const itemPath = path.join(sageConnectDir, item);
            return fs.statSync(itemPath).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(item);
        });
        
        return dates.sort().reverse(); // Most recent first
        
    } catch (error) {
        logGenerator(logFileName, 'error', `Error getting available log dates: ${error.message}`);
        return [];
    }
}

/**
 * Gets log statistics for dashboard summary
 * @returns {Promise<Object>} Log statistics
 */
async function getLogStatistics() {
    const logFileName = 'LogDashboardService';
    
    try {
        const today = getCurrentDateString();
        const logsData = await getAllLogs(today);
        
        let totalFiles = 0;
        let totalSize = 0;
        let totalLines = 0;
        let activeFiles = 0;
        
        Object.values(logsData).forEach(log => {
            totalFiles++;
            if (log.exists) {
                activeFiles++;
                totalSize += log.size;
                totalLines += log.lineCount;
            }
        });
        
        return {
            totalLogTypes: LOG_TYPES.length,
            activeFiles,
            totalSize,
            totalLines,
            date: today
        };
        
    } catch (error) {
        logGenerator(logFileName, 'error', `Error getting log statistics: ${error.message}`);
        throw error;
    }
}

module.exports = {
    LOG_TYPES,
    getAllLogs,
    readLogFile,
    getLastExecutionInfo,
    getAvailableLogDates,
    getLogStatistics,
    getLastScheduledTime,
    getNextScheduledTime
};