require('dotenv').config();

/**
 * Timezone utility to handle date operations with proper timezone support
 * Uses TIMEZONE from environment variables, defaults to America/Mexico_City
 */

const TIMEZONE = process.env.TIMEZONE || 'America/Mexico_City';

/**
 * Creates a new Date object adjusted to the configured timezone
 * @returns {Date} Current date in the configured timezone
 */
function getCurrentDate() {
    const now = new Date();
    
    // Use Intl.DateTimeFormat to get the date in the specified timezone
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: TIMEZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        
        const parts = formatter.formatToParts(now);
        const year = parts.find(part => part.type === 'year').value;
        const month = parts.find(part => part.type === 'month').value;
        const day = parts.find(part => part.type === 'day').value;
        
        // Create a new Date object in the target timezone
        // Note: This creates a Date object that represents the local date/time
        // in the target timezone, but the Date object itself is still in local time
        const targetDate = new Date(`${year}-${month}-${day}T00:00:00`);
        
        // Get the current time in the target timezone
        const timeFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: TIMEZONE,
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        const timeParts = timeFormatter.formatToParts(now);
        const hour = timeParts.find(part => part.type === 'hour').value;
        const minute = timeParts.find(part => part.type === 'minute').value;
        const second = timeParts.find(part => part.type === 'second').value;
        
        // Set the time components
        targetDate.setHours(parseInt(hour), parseInt(minute), parseInt(second), now.getMilliseconds());
        
        return targetDate;
    } catch (error) {
        console.warn(`Warning: Invalid timezone ${TIMEZONE}, falling back to local time`);
        return now;
    }
}

/**
 * Gets current date in YYYY-MM-DD format using configured timezone
 * @returns {string} Date string in YYYY-MM-DD format
 */
function getCurrentDateString() {
    return getCurrentDate().toISOString().slice(0, 10);
}

/**
 * Gets current date in YYYYMMDD format using configured timezone
 * @returns {string} Date string in YYYYMMDD format
 */
function getCurrentDateCompact() {
    return getCurrentDateString().replace(/-/g, '');
}

/**
 * Gets date one month ago in YYYY-MM format using configured timezone
 * @returns {string} Date string in YYYY-MM format (month ago)
 */
function getOneMonthAgoString() {
    const date = getCurrentDate();
    const oneMonthAgo = new Date(date.setMonth(date.getMonth() - 1));
    const year = oneMonthAgo.getFullYear();
    const month = String(oneMonthAgo.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

/**
 * Gets date one month ago in YYYYMMDD format using configured timezone
 * @returns {string} Date string in YYYYMMDD format (month ago)
 */
function getOneMonthAgoCompact() {
    const year = oneMonthAgo.getFullYear();
    const month = String(oneMonthAgo.getMonth() + 1).padStart(2, '0');
    const day = String(oneMonthAgo.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
    const oneMonthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
    return oneMonthAgo.toISOString().slice(0, 10).replace(/-/g, '');
}


/**
 * Gets ISO string for timestamps with timezone adjustment
 * @returns {string} ISO string timestamp
 */
function getCurrentISOString() {
    return getCurrentDate().toISOString();
}

module.exports = {
    getCurrentDate,
    getCurrentDateString,
    getCurrentDateCompact,
    getOneMonthAgoString,
    getOneMonthAgoCompact,
    getCurrentISOString,
    TIMEZONE
};