require('dotenv').config();

/**
 * Timezone utility to handle date operations with proper timezone support
 * Uses TIMEZONE from environment variables, defaults to America/Mexico_City
 */

const TIMEZONE = process.env.TIMEZONE || 'America/Mexico_City';

/**
 * Creates a new Date object adjusted to the configured timezone
 * Note: This returns a Date object representing the current moment in the target timezone
 * @returns {Date} Current date in the configured timezone
 */
function getCurrentDate() {
    const now = new Date();
    
    try {
        // Get the full date-time in the target timezone
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: TIMEZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        
        const parts = formatter.formatToParts(now);
        const year = parts.find(part => part.type === 'year').value;
        const month = parts.find(part => part.type === 'month').value;
        const day = parts.find(part => part.type === 'day').value;
        const hour = parts.find(part => part.type === 'hour').value;
        const minute = parts.find(part => part.type === 'minute').value;
        const second = parts.find(part => part.type === 'second').value;
        
        // Create a Date object using the timezone-adjusted values
        // This represents what the time would be if interpreted as local time
        const targetDate = new Date(
            parseInt(year),
            parseInt(month) - 1, // Month is 0-indexed
            parseInt(day),
            parseInt(hour),
            parseInt(minute),
            parseInt(second),
            now.getMilliseconds()
        );
        
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
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: TIMEZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        
        // en-CA format is already YYYY-MM-DD
        return formatter.format(now);
    } catch (error) {
        console.warn(`Warning: Invalid timezone ${TIMEZONE}, falling back to local time`);
        return new Date().toISOString().slice(0, 10);
    }
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
    try {
        const now = new Date();
        
        // Get current date in target timezone
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: TIMEZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        
        const parts = formatter.formatToParts(now);
        const currentYear = parseInt(parts.find(part => part.type === 'year').value);
        const currentMonth = parseInt(parts.find(part => part.type === 'month').value);
        
        // Calculate one month ago
        let targetYear = currentYear;
        let targetMonth = currentMonth - 1;
        
        if (targetMonth <= 0) {
            targetMonth = 12;
            targetYear -= 1;
        }
        
        return `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    } catch (error) {
        console.warn(`Warning: Invalid timezone ${TIMEZONE}, falling back to local time`);
        const date = new Date();
        date.setMonth(date.getMonth() - 1);
        return date.toISOString().slice(0, 7);
    }
}

/**
 * Gets date one month ago in YYYYMMDD format using configured timezone
 * @returns {string} Date string in YYYYMMDD format (month ago)
 */
function getOneMonthAgoCompact() {
    try {
        const now = new Date();
        
        // Get current date in target timezone
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: TIMEZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        
        const parts = formatter.formatToParts(now);
        const currentYear = parseInt(parts.find(part => part.type === 'year').value);
        const currentMonth = parseInt(parts.find(part => part.type === 'month').value);
        const currentDay = parseInt(parts.find(part => part.type === 'day').value);
        
        // Calculate one month ago
        let targetYear = currentYear;
        let targetMonth = currentMonth - 1;
        let targetDay = currentDay;
        
        if (targetMonth <= 0) {
            targetMonth = 12;
            targetYear -= 1;
        }
        
        // Handle day overflow for months with different day counts
        const daysInTargetMonth = new Date(targetYear, targetMonth, 0).getDate();
        if (targetDay > daysInTargetMonth) {
            targetDay = daysInTargetMonth;
        }
        
        return `${targetYear}${String(targetMonth).padStart(2, '0')}${String(targetDay).padStart(2, '0')}`;
    } catch (error) {
        console.warn(`Warning: Invalid timezone ${TIMEZONE}, falling back to local time`);
        const today = new Date();
        const oneMonthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
        return oneMonthAgo.toISOString().slice(0, 10).replace(/-/g, '');
    }
}


/**
 * Gets ISO string for timestamps with timezone adjustment
 * @returns {string} ISO string timestamp in the configured timezone
 */
function getCurrentISOString() {
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: TIMEZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        
        const parts = formatter.formatToParts(now);
        const year = parts.find(part => part.type === 'year').value;
        const month = parts.find(part => part.type === 'month').value;
        const day = parts.find(part => part.type === 'day').value;
        const hour = parts.find(part => part.type === 'hour').value;
        const minute = parts.find(part => part.type === 'minute').value;
        const second = parts.find(part => part.type === 'second').value;
        
        // Create ISO-like string but with timezone-adjusted time
        return `${year}-${month}-${day}T${hour}:${minute}:${second}.${String(now.getMilliseconds()).padStart(3, '0')}Z`;
    } catch (error) {
        console.warn(`Warning: Invalid timezone ${TIMEZONE}, falling back to local time`);
        return getCurrentDate().toISOString();
    }
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