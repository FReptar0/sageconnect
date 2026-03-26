/**
 * CSV Writer Utility
 * Writes upload results to CSV files for audit and compliance.
 * Files are stored in logs/sageconnect/YYYY-MM-DD/ alongside log files.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getCurrentDateString } = require('./TimezoneHelper');

/**
 * Escapes a value for CSV (handles commas, quotes, newlines)
 * @param {*} value
 * @returns {string}
 */
function escapeCsv(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * Appends rows to a CSV file. Creates the file with headers if it doesn't exist.
 * @param {string} fileName - Base name (e.g., 'PaymentReconciliation-uploads')
 * @param {string[]} headers - Column headers
 * @param {Array<Array<*>>} rows - Array of row arrays (same order as headers)
 * @returns {string} Full path to the CSV file
 */
function appendCsv(fileName, headers, rows) {
    const dateStr = getCurrentDateString();
    const logDir = path.join(config.paths.logs, 'sageconnect', dateStr);

    // Ensure directory exists
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const filePath = path.join(logDir, `${fileName}.csv`);
    const fileExists = fs.existsSync(filePath);

    let content = '';

    // Write headers if new file
    if (!fileExists) {
        content += headers.map(escapeCsv).join(',') + '\n';
    }

    // Write rows
    for (const row of rows) {
        content += row.map(escapeCsv).join(',') + '\n';
    }

    fs.appendFileSync(filePath, content, 'utf8');
    return filePath;
}

module.exports = { appendCsv, escapeCsv };
