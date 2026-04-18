/**
 * Operations Routes Integration Tests
 *
 * Tests operations endpoints: GET /operations/status and
 * GET /operations/:operationId/stream (SSE) with event delivery and cleanup.
 *
 * Strategy: Build a dedicated test app that mocks all dependencies.
 * Uses a real EventEmitter for OperationManager to test SSE subscription.
 */

const { describe, test, expect, beforeAll, beforeEach, afterEach } = require('@jest/globals');
const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------
// Mock config.js BEFORE any other requires
// ---------------------------------------------------------------------------
jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://test-portal',
        tenants: [
            { id: 'T1', key: 'k1', secret: 's1', database: 'DB1', externalId: 'E1' },
        ],
    },
    security: { apiKey: 'test-api-key' },
    database: { user: 'u', password: 'p', server: 's', database: 'd' },
    paths: { logs: '/tmp', downloads: '/tmp', providers: '/tmp' },
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 5000 },
    app: {
        timezone: 'America/Mexico_City',
        importRoute: '/test',
        arg: 'ARG',
        company: 'Test',
        rfc: 'RFC',
        regimen: 'REG',
        defaultAddress: {
            city: 'C', country: 'MX', identifier: 'I',
            municipality: 'M', state: 'S', street: 'ST', zip: '00000',
        },
        addressIdentifiersSkip: [],
    },
    mailing: {},
}));

// ---------------------------------------------------------------------------
// Mock OperationManager as a real EventEmitter with mock methods
// ---------------------------------------------------------------------------
const mockOpManager = new EventEmitter();
mockOpManager.getRunningOperations = jest.fn().mockReturnValue({});
mockOpManager.acquireLock = jest.fn().mockReturnValue(true);
mockOpManager.releaseLock = jest.fn();
mockOpManager.isLocked = jest.fn().mockReturnValue(false);
mockOpManager.emitProgress = jest.fn();
mockOpManager.getHistory = jest.fn().mockReturnValue([]);
mockOpManager.addHistory = jest.fn();
mockOpManager._reset = jest.fn();
mockOpManager.setMaxListeners(20);

jest.mock('../../src/services/OperationManager', () => mockOpManager);

// ---------------------------------------------------------------------------
// Mock infrastructure modules
// ---------------------------------------------------------------------------
jest.mock('../../src/utils/LogGenerator', () => ({
    logGenerator: jest.fn(),
}));
jest.mock('../../src/utils/SQLServerConnection', () => ({
    runQuery: jest.fn().mockResolvedValue({ recordset: [] }),
}));
jest.mock('../../src/utils/TimezoneHelper', () => ({
    getCurrentDateCompact: jest.fn().mockReturnValue('20260323'),
    getCurrentDateString: jest.fn().mockReturnValue('2026-03-23'),
}));
// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------
const express = require('express');
const request = require('supertest');
const http = require('http');
const { errorResult } = require('../../src/utils/ResultEnvelope');

function createOperationsTestApp() {
    const app = express();
    app.use(express.json());

    // Mount operations routes
    const operationsRoutes = require('../../src/routes/operations-routes');
    app.use('/api/operations', operationsRoutes);

    // Error handler
    app.use((err, req, res, _next) => {
        res.status(500).json(errorResult([err.message], 'Internal server error'));
    });

    return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Operations Routes', () => {
    let app;

    beforeAll(() => {
        app = createOperationsTestApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockOpManager.removeAllListeners();
        mockOpManager.getRunningOperations.mockReturnValue({});
    });

    // -------------------------------------------------------------------
    // GET /api/operations/status
    // -------------------------------------------------------------------
    describe('GET /api/operations/status', () => {
        test('returns 200 with empty operations object', async () => {
            const res = await request(app)
                .get('/api/operations/status');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('operations');
            expect(res.body.data.operations).toEqual({});
        });

        test('returns running operations when present', async () => {
            mockOpManager.getRunningOperations.mockReturnValue({
                'background-cycle': { operationId: 'op-123', startedAt: '2026-03-24T00:00:00Z' },
            });

            const res = await request(app)
                .get('/api/operations/status');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.operations).toHaveProperty('background-cycle');
            expect(res.body.data.operations['background-cycle'].operationId).toBe('op-123');
        });
    });

    // -------------------------------------------------------------------
    // GET /api/operations/:operationId/stream (SSE)
    // -------------------------------------------------------------------
    describe('GET /api/operations/:operationId/stream', () => {
        let server;

        afterEach((done) => {
            if (server) {
                server.close(done);
                server = null;
            } else {
                done();
            }
        });

        test('returns Content-Type text/event-stream header', (done) => {
            server = app.listen(0, () => {
                const port = server.address().port;

                const req = http.get(`http://127.0.0.1:${port}/api/operations/test-op/stream`, (res) => {
                    expect(res.statusCode).toBe(200);
                    expect(res.headers['content-type']).toBe('text/event-stream');
                    expect(res.headers['cache-control']).toBe('no-cache');
                    expect(res.headers['connection']).toBe('keep-alive');
                    req.destroy();
                    done();
                });

                req.on('error', () => {
                    // Connection was destroyed intentionally
                });
            });
        });

        test('delivers events when OperationManager emits progress', (done) => {
            server = app.listen(0, () => {
                const port = server.address().port;
                let receivedData = '';

                const req = http.get(`http://127.0.0.1:${port}/api/operations/test-op-2/stream`, (res) => {
                    res.on('data', (chunk) => {
                        receivedData += chunk.toString();

                        // Check if we received the progress event (skip retry line)
                        if (receivedData.includes('"type":"progress"')) {
                            expect(receivedData).toContain('event: progress');
                            expect(receivedData).toContain('"step":"buildProviders"');
                            req.destroy();
                            done();
                        }
                    });

                    // Emit a progress event after a short delay to allow SSE connection setup
                    setTimeout(() => {
                        mockOpManager.emit('progress:test-op-2', {
                            type: 'progress',
                            operation: 'background-cycle',
                            tenant: 'T1',
                            step: 'buildProviders',
                            message: 'Building providers XML',
                            timestamp: new Date().toISOString(),
                        });
                    }, 50);
                });

                req.on('error', () => {
                    // Connection was destroyed intentionally
                });
            });
        });

        test('removes event listener on connection close', (done) => {
            server = app.listen(0, () => {
                const port = server.address().port;

                const req = http.get(`http://127.0.0.1:${port}/api/operations/test-op-3/stream`, (res) => {
                    // Give the SSE handler time to set up the listener
                    setTimeout(() => {
                        const listenersBefore = mockOpManager.listenerCount('progress:test-op-3');
                        expect(listenersBefore).toBe(1);

                        // Destroy the connection to trigger cleanup
                        req.destroy();

                        // Give the cleanup handler time to run
                        setTimeout(() => {
                            const listenersAfter = mockOpManager.listenerCount('progress:test-op-3');
                            expect(listenersAfter).toBe(0);
                            done();
                        }, 50);
                    }, 50);
                });

                req.on('error', () => {
                    // Connection was destroyed intentionally
                });
            });
        });
    });
});
