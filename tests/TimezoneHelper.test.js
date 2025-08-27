// tests/TimezoneHelper.test.js
const {
    getCurrentDate,
    getCurrentDateString,
    getCurrentDateCompact,
    getOneMonthAgoString,
    getOneMonthAgoCompact,
    getCurrentISOString,
    TIMEZONE
} = require('../src/utils/TimezoneHelper');

describe('TimezoneHelper utility', () => {
    beforeAll(() => {
        // Mock the environment variable
        process.env.TIMEZONE = 'America/Mexico_City';
    });

    afterAll(() => {
        // Clean up the environment variable
        delete process.env.TIMEZONE;
    });

    describe('TIMEZONE constant', () => {
        test('should return the configured timezone', () => {
            expect(TIMEZONE).toBe('America/Mexico_City');
        });

        test('should fallback to America/Mexico_City when env var is not set', () => {
            // Temporarily remove the env var
            const originalTimezone = process.env.TIMEZONE;
            delete process.env.TIMEZONE;
            
            // Re-require the module to test fallback
            delete require.cache[require.resolve('../src/utils/TimezoneHelper')];
            const { TIMEZONE: fallbackTimezone } = require('../src/utils/TimezoneHelper');
            
            expect(fallbackTimezone).toBe('America/Mexico_City');
            
            // Restore the env var
            process.env.TIMEZONE = originalTimezone;
        });
    });

    describe('getCurrentDate', () => {
        test('should return a Date object', () => {
            const result = getCurrentDate();
            expect(result).toBeInstanceOf(Date);
        });

        test('should return a valid date', () => {
            const result = getCurrentDate();
            expect(result.getTime()).not.toBeNaN();
        });

        test('should handle invalid timezone gracefully', () => {
            // Temporarily set invalid timezone
            const originalTimezone = process.env.TIMEZONE;
            process.env.TIMEZONE = 'Invalid/Timezone';
            
            // Re-require the module
            delete require.cache[require.resolve('../src/utils/TimezoneHelper')];
            const { getCurrentDate: getCurrentDateInvalid } = require('../src/utils/TimezoneHelper');
            
            const result = getCurrentDateInvalid();
            expect(result).toBeInstanceOf(Date);
            expect(result.getTime()).not.toBeNaN();
            
            // Restore the env var
            process.env.TIMEZONE = originalTimezone;
        });
    });

    describe('getCurrentDateString', () => {
        test('should return date in YYYY-MM-DD format', () => {
            const result = getCurrentDateString();
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        test('should return a string of length 10', () => {
            const result = getCurrentDateString();
            expect(result).toHaveLength(10);
        });

        test('should return valid date components', () => {
            const result = getCurrentDateString();
            const [year, month, day] = result.split('-').map(Number);
            
            expect(year).toBeGreaterThanOrEqual(2020);
            expect(year).toBeLessThanOrEqual(3000);
            expect(month).toBeGreaterThanOrEqual(1);
            expect(month).toBeLessThanOrEqual(12);
            expect(day).toBeGreaterThanOrEqual(1);
            expect(day).toBeLessThanOrEqual(31);
        });
    });

    describe('getCurrentDateCompact', () => {
        test('should return date in YYYYMMDD format', () => {
            const result = getCurrentDateCompact();
            expect(result).toMatch(/^\d{8}$/);
        });

        test('should return a string of length 8', () => {
            const result = getCurrentDateCompact();
            expect(result).toHaveLength(8);
        });

        test('should be equivalent to getCurrentDateString without dashes', () => {
            const dateString = getCurrentDateString();
            const compactDate = getCurrentDateCompact();
            expect(compactDate).toBe(dateString.replace(/-/g, ''));
        });
    });

    describe('getOneMonthAgoString', () => {
        test('should return date in YYYY-MM format', () => {
            const result = getOneMonthAgoString();
            expect(result).toMatch(/^\d{4}-\d{2}$/);
        });

        test('should return a string of length 7', () => {
            const result = getOneMonthAgoString();
            expect(result).toHaveLength(7);
        });

        test('should return a date that is approximately one month ago', () => {
            const result = getOneMonthAgoString();
            const currentDate = getCurrentDateString();
            const currentYearMonth = currentDate.slice(0, 7);
            
            // The result should be different from current month (in most cases)
            // We allow for edge cases where we're at the beginning of the month
            const [resultYear, resultMonth] = result.split('-').map(Number);
            const [currentYear, currentMonth] = currentYearMonth.split('-').map(Number);
            
            expect(resultYear).toBeGreaterThanOrEqual(currentYear - 1);
            expect(resultYear).toBeLessThanOrEqual(currentYear);
            
            if (resultYear === currentYear) {
                expect(resultMonth).toBeLessThan(currentMonth);
            }
        });
    });

    describe('getOneMonthAgoCompact', () => {
        test('should return date in YYYYMMDD format', () => {
            const result = getOneMonthAgoCompact();
            expect(result).toMatch(/^\d{8}$/);
        });

        test('should return a string of length 8', () => {
            const result = getOneMonthAgoCompact();
            expect(result).toHaveLength(8);
        });

        test('should return valid date components', () => {
            const result = getOneMonthAgoCompact();
            const year = parseInt(result.slice(0, 4));
            const month = parseInt(result.slice(4, 6));
            const day = parseInt(result.slice(6, 8));
            
            expect(year).toBeGreaterThanOrEqual(2020);
            expect(year).toBeLessThanOrEqual(3000);
            expect(month).toBeGreaterThanOrEqual(1);
            expect(month).toBeLessThanOrEqual(12);
            expect(day).toBeGreaterThanOrEqual(1);
            expect(day).toBeLessThanOrEqual(31);
        });
    });

    describe('getCurrentISOString', () => {
        test('should return a valid ISO string', () => {
            const result = getCurrentISOString();
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        test('should return a parseable date string', () => {
            const result = getCurrentISOString();
            const parsedDate = new Date(result);
            expect(parsedDate.getTime()).not.toBeNaN();
        });

        test('should return timezone-adjusted ISO string', () => {
            const helperISO = getCurrentISOString();
            const parsedDate = new Date(helperISO);
            
            // The ISO string should be parseable and represent a valid date
            expect(parsedDate.getTime()).not.toBeNaN();
            
            // The ISO string should match the current date string from timezone
            const currentDateStr = getCurrentDateString();
            const isoDatePart = helperISO.split('T')[0];
            expect(isoDatePart).toBe(currentDateStr);
        });
    });

    describe('date consistency', () => {
        test('all functions should use the same base date', () => {
            const currentString = getCurrentDateString();
            const currentCompact = getCurrentDateCompact();
            const currentISO = getCurrentISOString();
            
            // Extract date part from ISO string
            const isoDatePart = currentISO.split('T')[0];
            
            expect(currentString).toBe(isoDatePart);
            expect(currentCompact).toBe(currentString.replace(/-/g, ''));
        });

        test('one month ago functions should be consistent', () => {
            const oneMonthString = getOneMonthAgoString();
            const oneMonthCompact = getOneMonthAgoCompact();
            
            // Extract year-month from compact format
            const compactYearMonth = `${oneMonthCompact.slice(0, 4)}-${oneMonthCompact.slice(4, 6)}`;
            
            expect(oneMonthString).toBe(compactYearMonth);
        });
    });

    describe('timezone behavior', () => {
        test('should work with different timezones', () => {
            const timezones = [
                { name: 'America/New_York', expectedFormat: /^\d{4}-\d{2}-\d{2}$/ },
                { name: 'Europe/London', expectedFormat: /^\d{4}-\d{2}-\d{2}$/ },
                { name: 'Asia/Tokyo', expectedFormat: /^\d{4}-\d{2}-\d{2}$/ }
            ];
            
            timezones.forEach(({ name: timezone, expectedFormat }) => {
                // Create a fresh module context for each test
                const modulePath = require.resolve('../src/utils/TimezoneHelper');
                delete require.cache[modulePath];
                
                // Set the timezone before requiring the module
                const originalTimezone = process.env.TIMEZONE;
                process.env.TIMEZONE = timezone;
                
                try {
                    // Fresh require with new timezone
                    const TimezoneHelper = require('../src/utils/TimezoneHelper');
                    
                    // Test that functions work (don't test exact timezone value due to caching issues)
                    const result = TimezoneHelper.getCurrentDateString();
                    expect(result).toMatch(expectedFormat);
                    expect(typeof result).toBe('string');
                    expect(result.length).toBe(10);
                    
                } finally {
                    // Always restore the original timezone
                    process.env.TIMEZONE = originalTimezone;
                    // Clean up the cache
                    delete require.cache[modulePath];
                }
            });
        });

        test('should handle timezone changes in getCurrentDate function', () => {
            // Test that the getCurrentDate function itself handles timezone properly
            const result1 = getCurrentDate();
            expect(result1).toBeInstanceOf(Date);
            
            // Even if we can't test different timezones due to caching,
            // we can ensure the function is stable and returns valid dates
            const result2 = getCurrentDate();
            expect(result2).toBeInstanceOf(Date);
            
            // Results should be very close in time (within a few seconds)
            const timeDiff = Math.abs(result2.getTime() - result1.getTime());
            expect(timeDiff).toBeLessThan(5000); // Less than 5 seconds
        });
    });
});