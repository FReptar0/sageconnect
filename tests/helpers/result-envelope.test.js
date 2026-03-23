const { expect, describe, test, beforeEach } = require('@jest/globals');

const { createResult, successResult, errorResult } = require('../../src/utils/ResultEnvelope');

describe('ResultEnvelope', () => {
    const NOW_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

    test('createResult(true, ...) returns success envelope with correct shape', () => {
        const startTime = Date.now() - 100;
        const result = createResult(true, {
            data: { invoices: 5 },
            summary: 'Imported 5 invoices',
            tenant: 'ACME',
        }, startTime);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ invoices: 5 });
        expect(result.errors).toEqual([]);
        expect(result.summary).toBe('Imported 5 invoices');
        expect(result.meta.tenant).toBe('ACME');
        expect(result.meta.duration).toBeGreaterThanOrEqual(100);
        expect(result.meta.timestamp).toMatch(NOW_REGEX);
    });

    test('createResult(false, ...) returns failure envelope with errors and null data', () => {
        const result = createResult(false, {
            data: null,
            errors: ['Connection timeout', 'Retry failed'],
            summary: 'Import failed',
        });

        expect(result.success).toBe(false);
        expect(result.data).toBeNull();
        expect(result.errors).toEqual(['Connection timeout', 'Retry failed']);
        expect(result.summary).toBe('Import failed');
    });

    test('errors is always an array (wraps single error in array)', () => {
        const result = createResult(false, {
            errors: 'Single error message',
        });

        expect(Array.isArray(result.errors)).toBe(true);
        expect(result.errors).toEqual(['Single error message']);
    });

    test('meta.duration is calculated from startTime parameter', () => {
        const startTime = Date.now() - 500;
        const result = createResult(true, {}, startTime);

        expect(result.meta.duration).toBeGreaterThanOrEqual(500);
        expect(result.meta.duration).toBeLessThan(2000); // sanity check
    });

    test('meta.timestamp is ISO string', () => {
        const result = createResult(true, {});

        expect(typeof result.meta.timestamp).toBe('string');
        // Verify it's a valid ISO date
        const parsed = new Date(result.meta.timestamp);
        expect(parsed.toISOString()).toBe(result.meta.timestamp);
    });

    test('successResult is shorthand that calls createResult(true, ...)', () => {
        const startTime = Date.now() - 50;
        const result = successResult({ count: 3 }, 'Processed 3 items', {
            tenant: 'T1',
            startTime,
        });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ count: 3 });
        expect(result.errors).toEqual([]);
        expect(result.summary).toBe('Processed 3 items');
        expect(result.meta.tenant).toBe('T1');
        expect(result.meta.duration).toBeGreaterThanOrEqual(50);
    });

    test('errorResult is shorthand that calls createResult(false, ...)', () => {
        const result = errorResult('Something broke', 'Operation failed', {
            tenant: 'T2',
        });

        expect(result.success).toBe(false);
        expect(result.data).toBeNull();
        expect(result.errors).toEqual(['Something broke']);
        expect(result.summary).toBe('Operation failed');
        expect(result.meta.tenant).toBe('T2');
    });

    test('missing optional fields default correctly', () => {
        const result = createResult(true);

        expect(result.data).toBeNull();
        expect(result.errors).toEqual([]);
        expect(result.summary).toBe('');
        expect(result.meta.duration).toBe(0);
        expect(result.meta.tenant).toBeNull();
    });
});
