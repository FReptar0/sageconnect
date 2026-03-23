const { expect, describe, test, beforeEach, afterEach } = require('@jest/globals');

// ---------------------------------------------------------------------------
// Mock mssql before requiring the module under test
// ---------------------------------------------------------------------------
const mockRequest = { query: jest.fn() };
const mockPool = {
    request: jest.fn(() => mockRequest),
    close: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    connect: jest.fn(),
};

// Make pool.connect() resolve to the pool itself (mimics mssql behavior)
mockPool.connect.mockResolvedValue(mockPool);

const mockConnectionPool = jest.fn(() => mockPool);

jest.mock('mssql', () => ({
    ConnectionPool: mockConnectionPool,
}));

// Mock config so we don't need .env
jest.mock('../src/config', () => ({
    database: {
        user: 'testUser',
        password: 'testPass',
        server: 'localhost',
        database: 'FESA',
    },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SQLServerConnection - Singleton Pool', () => {
    let SQLServerConnection;

    beforeEach(() => {
        // Clear module cache so each test suite gets fresh singleton state
        jest.resetModules();

        // Re-apply mocks after resetModules
        jest.mock('mssql', () => ({
            ConnectionPool: mockConnectionPool,
        }));
        jest.mock('../src/config', () => ({
            database: {
                user: 'testUser',
                password: 'testPass',
                server: 'localhost',
                database: 'FESA',
            },
        }));

        // Reset mock call history
        mockConnectionPool.mockClear();
        mockPool.connect.mockClear();
        mockPool.request.mockClear();
        mockPool.close.mockClear();
        mockPool.on.mockClear();
        mockRequest.query.mockClear();

        // Re-require with fresh singleton state
        SQLServerConnection = require('../src/utils/SQLServerConnection');
    });

    test('getPool() returns the same promise on repeated calls (singleton)', async () => {
        const promise1 = SQLServerConnection.getPool();
        const promise2 = SQLServerConnection.getPool();

        expect(promise1).toBe(promise2);

        // ConnectionPool constructor called only once
        expect(mockConnectionPool).toHaveBeenCalledTimes(1);
    });

    test('runQuery with non-default database prepends USE [database] to query', async () => {
        mockRequest.query.mockResolvedValue({ recordset: [] });

        await SQLServerConnection.runQuery('SELECT 1', 'COPDAT');

        expect(mockRequest.query).toHaveBeenCalledWith('USE [COPDAT]; SELECT 1');
    });

    test('runQuery with default database does NOT prepend USE prefix', async () => {
        mockRequest.query.mockResolvedValue({ recordset: [] });

        await SQLServerConnection.runQuery('SELECT 1');

        expect(mockRequest.query).toHaveBeenCalledWith('SELECT 1');
    });

    test('pool.on error listener is attached during pool creation', async () => {
        // getPool triggers pool creation
        await SQLServerConnection.getPool();

        expect(mockPool.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    test('closePool() sets poolPromise to null, allowing fresh pool on next call', async () => {
        // First pool creation
        await SQLServerConnection.getPool();
        expect(mockConnectionPool).toHaveBeenCalledTimes(1);

        // Close pool
        await SQLServerConnection.closePool();
        expect(mockPool.close).toHaveBeenCalledTimes(1);

        // Next getPool should create a new pool
        await SQLServerConnection.getPool();
        expect(mockConnectionPool).toHaveBeenCalledTimes(2);
    });

    test('runQuery signature accepts (query, database="FESA") -- backward compatible', async () => {
        mockRequest.query.mockResolvedValue({ recordset: [{ id: 1 }] });

        // Call with explicit default
        const result1 = await SQLServerConnection.runQuery('SELECT 1', 'FESA');
        expect(mockRequest.query).toHaveBeenCalledWith('SELECT 1');

        mockRequest.query.mockClear();

        // Call with no database (defaults to 'FESA')
        const result2 = await SQLServerConnection.runQuery('SELECT 2');
        expect(mockRequest.query).toHaveBeenCalledWith('SELECT 2');

        // Both should return results
        expect(result1).toEqual({ recordset: [{ id: 1 }] });
        expect(result2).toEqual({ recordset: [{ id: 1 }] });
    });
});
