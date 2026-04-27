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

    test('runQuery with explicit non-default database prepends USE [database]', async () => {
        mockRequest.query.mockResolvedValue({ recordset: [] });

        await SQLServerConnection.runQuery('SELECT 1', 'COPDAT');

        expect(mockRequest.query).toHaveBeenCalledWith('USE [COPDAT]; SELECT 1');
    });

    test('runQuery with default database ALSO prepends USE — guarantees clean context per call', async () => {
        // Pool connections in mssql/tedious retain their USE [DB] state across requests.
        // Skipping the prefix when database matches the config default would leak the
        // previous request's context. The fix: always prepend USE.
        mockRequest.query.mockResolvedValue({ recordset: [] });

        await SQLServerConnection.runQuery('SELECT 1');

        expect(mockRequest.query).toHaveBeenCalledWith('USE [FESA]; SELECT 1');
    });

    test('regression: pool context does not leak across calls (FESA -> COPDAT both prepend USE)', async () => {
        // This is the exact production failure mode. With the old code:
        //   1. runQuery(sql, 'FESA') prepended USE [FESA] -> connection sat in FESA
        //   2. runQuery(sql, 'COPDAT') skipped USE (matched config default) -> ran in FESA
        //      -> "Invalid object name 'dbo.APBTA'"
        // The fix: every call prepends USE, so connection state is irrelevant.
        mockRequest.query.mockResolvedValue({ recordset: [] });

        await SQLServerConnection.runQuery('SELECT a FROM fesa.dbo.x', 'FESA');
        await SQLServerConnection.runQuery('SELECT b FROM dbo.APBTA', 'COPDAT');

        expect(mockRequest.query).toHaveBeenNthCalledWith(1, 'USE [FESA]; SELECT a FROM fesa.dbo.x');
        expect(mockRequest.query).toHaveBeenNthCalledWith(2, 'USE [COPDAT]; SELECT b FROM dbo.APBTA');
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

    test('runQuery default param resolves to config.database.database (not literal "FESA")', async () => {
        mockRequest.query.mockResolvedValue({ recordset: [{ id: 1 }] });

        // Call with explicit FESA -- prepends USE [FESA]
        const result1 = await SQLServerConnection.runQuery('SELECT 1', 'FESA');
        expect(mockRequest.query).toHaveBeenCalledWith('USE [FESA]; SELECT 1');

        mockRequest.query.mockClear();

        // Call with no database -- defaults to config.database.database (FESA in mock)
        const result2 = await SQLServerConnection.runQuery('SELECT 2');
        expect(mockRequest.query).toHaveBeenCalledWith('USE [FESA]; SELECT 2');

        expect(result1).toEqual({ recordset: [{ id: 1 }] });
        expect(result2).toEqual({ recordset: [{ id: 1 }] });
    });
});
