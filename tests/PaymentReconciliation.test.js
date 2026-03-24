// tests/PaymentReconciliation.test.js
// TDD RED phase: Failing tests for RSOL-01, RSOL-02, PROV-01, PROV-02
// These tests define the expected behavior for Plan 02 implementation.

// ---------------------------------------------------------------------------
// Mocks (must be defined BEFORE any require that triggers the module)
// ---------------------------------------------------------------------------

jest.mock('../src/utils/SQLServerConnection', () => ({
    runQuery: jest.fn()
}));

jest.mock('../src/utils/GetProviders', () => ({
    getProviderByExternalId: jest.fn(),
    getProviders: jest.fn()
}));

jest.mock('../src/services/ProviderIdResolver', () => ({
    resolveProviderIdByExternalId: jest.fn()
}));

jest.mock('../src/utils/LogGenerator', () => ({
    logGenerator: jest.fn()
}));

jest.mock('../src/utils/GetTypesCFDI', () => ({
    getPendingToPayInvoices: jest.fn()
}));

jest.mock('../src/utils/TimezoneHelper', () => ({
    getCurrentDateCompact: jest.fn().mockReturnValue('20260312')
}));

jest.mock('../src/config', () => ({
    portal: {
        url: 'http://localhost',
        tenants: [
            { id: 'tenant1', key: 'key1', secret: 'secret1', database: 'TESTDB', externalId: 'ext1' }
        ]
    },
    database: { user: '', password: '', server: '', database: '' },
    mailing: {},
    paths: { downloads: '', providers: '', logs: '' },
    app: {
        importRoute: '', arg: '', company: '', rfc: '', regimen: '', timezone: '',
        defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
        addressIdentifiersSkip: []
    }
}));

jest.mock('axios');

// ---------------------------------------------------------------------------
// Require modules after mocks
// ---------------------------------------------------------------------------

const { classifyPayments, uploadBatch } = require('../src/scripts/payment-reconciliation');
const { runQuery } = require('../src/utils/SQLServerConnection');
const { getProviderByExternalId } = require('../src/utils/GetProviders');
const { resolveProviderIdByExternalId } = require('../src/services/ProviderIdResolver');
const axios = require('axios');

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

/**
 * Creates a payment header object with sensible defaults.
 * @param {Object} overrides - Fields to override.
 * @returns {Object} Payment header row (as returned by Sage SQL query).
 */
function makePaymentHdr(overrides = {}) {
    return {
        LotePago: 100,
        AsientoPago: 1,
        bank_account_id: 'BANK-001',
        IDBANK: 'BNK',
        FechaAsentamiento: 20260301,
        external_id: 'PY-001',
        comments: 'Test payment',
        reference: 'REF-001',
        bk_currency: 'MXN',
        payment_date: 20260301,
        provider_external_id: 'VENDOR1',
        total_amount: 1000.00,
        operation_type: 'TRANSFER',
        TipoCambioPago: 1,
        RFC: 'XAXX010101000',
        PROVIDERID: 'abc123',
        ...overrides
    };
}

/**
 * Creates a portalUuidMap from an array of entries.
 * @param {Array<Object>} entries - Array of { uuid, provider_id, folio, serie, total, currency }.
 * @returns {Map} Portal UUID map matching the structure built in main().
 */
function makePortalUuidMap(entries) {
    const map = new Map();
    for (const entry of entries) {
        map.set(entry.uuid.toUpperCase(), {
            folio: entry.folio || 'F001',
            serie: entry.serie || 'A',
            total: entry.total || 1000,
            currency: entry.currency || 'MXN',
            provider_id: entry.provider_id
        });
    }
    return map;
}

/**
 * Sets up runQuery mock to return a recordset for the invoice fetch query.
 * @param {Array<Object>} invoices - Array of invoice row objects.
 */
function mockInvoiceQuery(invoices) {
    runQuery.mockResolvedValue({ recordset: invoices });
}

/**
 * Creates an invoice row object with sensible defaults.
 * @param {Object} overrides - Fields to override.
 * @returns {Object} Invoice row (as returned by Sage queryFacturasPagadas).
 */
function makeInvoice(overrides = {}) {
    return {
        LotePago: 100,
        AsientoPago: 1,
        invoice_external_id: 'INV-001',
        inv_batch: 200,
        inv_entry: 1,
        invoice_amount: 1000,
        invoice_currency: 'MXN',
        invoice_exchange_rate: 1,
        payment_amount: 1000,
        FULL_PAID: 1,
        UUID: 'UUID-AAA-111',
        exchange_rate: 1,
        ...overrides
    };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let consoleLogSpy;
let consoleWarnSpy;
let consoleErrorSpy;

beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
});

afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// RSOL-01: Auto-resolve missing PROVIDERID
// ---------------------------------------------------------------------------

describe('RSOL-01: Auto-resolve missing PROVIDERID', () => {
    test('should call getProviderByExternalId when PROVIDERID is empty', async () => {
        const hdr = makePaymentHdr({ PROVIDERID: '', provider_external_id: 'VENDOR1' });
        const invoice = makeInvoice({ UUID: 'UUID-AAA-111' });
        const portalUuidMap = makePortalUuidMap([
            { uuid: 'UUID-AAA-111', provider_id: 'abc123' }
        ]);

        getProviderByExternalId.mockResolvedValue({ id: 'abc123' });
        resolveProviderIdByExternalId.mockResolvedValue(true);
        mockInvoiceQuery([invoice]);

        await classifyPayments([hdr], portalUuidMap, 0, 'TESTDB');

        expect(getProviderByExternalId).toHaveBeenCalledWith(0, 'VENDOR1');
    });

    test('should push to no_providerid with context when auto-resolution fails (no match)', async () => {
        const hdr = makePaymentHdr({ PROVIDERID: '', provider_external_id: 'VENDOR1' });
        const portalUuidMap = makePortalUuidMap([]);

        getProviderByExternalId.mockResolvedValue(null);

        const result = await classifyPayments([hdr], portalUuidMap, 0, 'TESTDB');

        expect(result.data.categories.no_providerid).toHaveLength(1);
        expect(result.data.categories.no_providerid[0].reason).toMatch(/auto-resolution failed/i);
    });

    test('should push to no_providerid when provider_external_id is empty', async () => {
        const hdr = makePaymentHdr({
            PROVIDERID: '',
            provider_external_id: ''
        });
        const portalUuidMap = makePortalUuidMap([]);

        const result = await classifyPayments([hdr], portalUuidMap, 0, 'TESTDB');

        expect(result.data.categories.no_providerid).toHaveLength(1);
        expect(result.data.categories.no_providerid[0].reason).toMatch(/no IDVEND/i);
    });
});

// ---------------------------------------------------------------------------
// RSOL-02: Same-run reclassification after successful resolution
// ---------------------------------------------------------------------------

describe('RSOL-02: Same-run reclassification after successful resolution', () => {
    test('should classify auto-resolved payment as READY when all validations pass', async () => {
        const hdr = makePaymentHdr({ PROVIDERID: '', provider_external_id: 'VENDOR1' });
        const invoice = makeInvoice({ UUID: 'UUID-AAA-111' });
        const portalUuidMap = makePortalUuidMap([
            { uuid: 'UUID-AAA-111', provider_id: 'resolved123' }
        ]);

        getProviderByExternalId.mockResolvedValue({ id: 'resolved123' });
        resolveProviderIdByExternalId.mockResolvedValue(true);
        mockInvoiceQuery([invoice]);

        const result = await classifyPayments([hdr], portalUuidMap, 0, 'TESTDB');

        expect(result.data.categories.ready).toHaveLength(1);
        expect(result.data.autoResolvedCount).toBe(1);
    });

    test('should continue to mismatch check after auto-resolution', async () => {
        const hdr = makePaymentHdr({ PROVIDERID: '', provider_external_id: 'VENDOR1' });
        const invoice = makeInvoice({ UUID: 'UUID-AAA-111' });
        const portalUuidMap = makePortalUuidMap([
            { uuid: 'UUID-AAA-111', provider_id: 'different456' }
        ]);

        getProviderByExternalId.mockResolvedValue({ id: 'resolved123' });
        resolveProviderIdByExternalId.mockResolvedValue(true);
        mockInvoiceQuery([invoice]);

        const result = await classifyPayments([hdr], portalUuidMap, 0, 'TESTDB');

        expect(result.data.categories.provider_mismatch).toHaveLength(1);
        expect(result.data.categories.ready).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// PROV-01: Validate metadata.provider_id matches PROVIDERID
// ---------------------------------------------------------------------------

describe('PROV-01: Validate metadata.provider_id matches PROVIDERID', () => {
    test('should classify as READY when all invoice provider_ids match PROVIDERID', async () => {
        const hdr = makePaymentHdr({ PROVIDERID: 'abc123' });
        const invoice1 = makeInvoice({ UUID: 'UUID-AAA-111', invoice_external_id: 'INV-001' });
        const invoice2 = makeInvoice({ UUID: 'UUID-BBB-222', invoice_external_id: 'INV-002' });
        const portalUuidMap = makePortalUuidMap([
            { uuid: 'UUID-AAA-111', provider_id: 'abc123' },
            { uuid: 'UUID-BBB-222', provider_id: 'abc123' }
        ]);

        mockInvoiceQuery([invoice1, invoice2]);

        const result = await classifyPayments([hdr], portalUuidMap, 0, 'TESTDB');

        // This test may PASS with current code (regression baseline) because
        // the current code does not check provider_id at all -- it classifies
        // as READY if invoices are in portal.
        expect(result.data.categories.ready).toHaveLength(1);
    });

    test('should classify as PROVIDER MISMATCH when an invoice provider_id differs', async () => {
        const hdr = makePaymentHdr({ PROVIDERID: 'abc123' });
        const invoice = makeInvoice({ UUID: 'UUID-AAA-111', invoice_external_id: 'INV-001' });
        const portalUuidMap = makePortalUuidMap([
            { uuid: 'UUID-AAA-111', provider_id: 'xyz789' }
        ]);

        mockInvoiceQuery([invoice]);

        const result = await classifyPayments([hdr], portalUuidMap, 0, 'TESTDB');

        expect(result.data.categories.provider_mismatch).toHaveLength(1);
        expect(result.data.categories.provider_mismatch[0].mismatchDetails).toBeDefined();
        expect(result.data.categories.ready).toHaveLength(0);
    });

    test('should treat null/empty provider_id as mismatch', async () => {
        const hdr = makePaymentHdr({ PROVIDERID: 'abc123' });
        const invoice = makeInvoice({ UUID: 'UUID-AAA-111', invoice_external_id: 'INV-001' });
        const portalUuidMap = makePortalUuidMap([
            { uuid: 'UUID-AAA-111', provider_id: null }
        ]);

        mockInvoiceQuery([invoice]);

        const result = await classifyPayments([hdr], portalUuidMap, 0, 'TESTDB');

        expect(result.data.categories.provider_mismatch).toHaveLength(1);
        expect(result.data.categories.ready).toHaveLength(0);
    });

    test('should compare provider_ids case-insensitively', async () => {
        const hdr = makePaymentHdr({ PROVIDERID: 'ABC123' });
        const invoice = makeInvoice({ UUID: 'UUID-AAA-111', invoice_external_id: 'INV-001' });
        const portalUuidMap = makePortalUuidMap([
            { uuid: 'UUID-AAA-111', provider_id: 'abc123' }
        ]);

        mockInvoiceQuery([invoice]);

        const result = await classifyPayments([hdr], portalUuidMap, 0, 'TESTDB');

        // Should be READY, not mismatch (case-insensitive comparison)
        expect(result.data.categories.ready).toHaveLength(1);
        expect(result.data.categories.provider_mismatch).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// PROV-02: PROVIDER MISMATCH category with detail
// ---------------------------------------------------------------------------

describe('PROV-02: PROVIDER MISMATCH category with detail', () => {
    test('should include mismatchDetails with portal_provider_id and sage_providerid per invoice', async () => {
        const hdr = makePaymentHdr({ PROVIDERID: 'abc123' });
        const invoice = makeInvoice({ UUID: 'UUID-AAA-111', invoice_external_id: 'INV-001' });
        const portalUuidMap = makePortalUuidMap([
            { uuid: 'UUID-AAA-111', provider_id: 'xyz789' }
        ]);

        mockInvoiceQuery([invoice]);

        const result = await classifyPayments([hdr], portalUuidMap, 0, 'TESTDB');

        expect(result.data.categories.provider_mismatch).toHaveLength(1);
        const entry = result.data.categories.provider_mismatch[0];
        expect(entry.mismatchDetails).toBeDefined();
        expect(entry.mismatchDetails).toHaveLength(1);
        expect(entry.mismatchDetails[0]).toMatchObject({
            invoice_external_id: 'INV-001',
            portal_provider_id: 'xyz789',
            sage_providerid: 'abc123'
        });
    });

    test('should include all mismatched invoices, not just the first one', async () => {
        const hdr = makePaymentHdr({ PROVIDERID: 'abc123' });
        const invoice1 = makeInvoice({ UUID: 'UUID-AAA-111', invoice_external_id: 'INV-001' });
        const invoice2 = makeInvoice({ UUID: 'UUID-BBB-222', invoice_external_id: 'INV-002' });
        const invoice3 = makeInvoice({ UUID: 'UUID-CCC-333', invoice_external_id: 'INV-003' });
        const portalUuidMap = makePortalUuidMap([
            { uuid: 'UUID-AAA-111', provider_id: 'abc123' },   // matches
            { uuid: 'UUID-BBB-222', provider_id: 'wrong1' },   // mismatch
            { uuid: 'UUID-CCC-333', provider_id: 'wrong2' }    // mismatch
        ]);

        mockInvoiceQuery([invoice1, invoice2, invoice3]);

        const result = await classifyPayments([hdr], portalUuidMap, 0, 'TESTDB');

        expect(result.data.categories.provider_mismatch).toHaveLength(1);
        const entry = result.data.categories.provider_mismatch[0];
        expect(entry.mismatchDetails).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// Phase 2 fixture helpers
// ---------------------------------------------------------------------------

/**
 * Creates a default upload options object for uploadBatch().
 * @param {Object} overrides - Fields to override.
 * @returns {Object} Upload config object.
 */
function makeUploadOptions(overrides = {}) {
    return {
        shouldUpload: true,
        batchLimit: 20,
        index: 0,
        logFileName: 'PaymentReconciliation',
        tenantIds: ['tenant1'],
        apiKeys: ['key1'],
        apiSecrets: ['secret1'],
        database: ['TESTDB'],
        URL: 'http://localhost',
        ...overrides
    };
}

/**
 * Creates a categories object matching classifyPayments output.
 * @param {Array} readyEntries - Array of ready entry objects.
 * @returns {Object} Categories object.
 */
function makeCategories(readyEntries = []) {
    return {
        ready: readyEntries,
        no_providerid: [],
        no_uuid: [],
        not_in_portal: [],
        provider_mismatch: []
    };
}

/**
 * Creates a ready entry (classifyPayments output structure).
 * @param {Object} overrides - { hdr: {}, invoices: [], extra: {} }.
 * @returns {Object} Ready entry with hdr and invoices.
 */
function makeReadyEntry(overrides = {}) {
    return {
        hdr: makePaymentHdr(overrides.hdr || {}),
        invoices: overrides.invoices || [makeInvoice()],
        ...(overrides.extra || {})
    };
}

// ---------------------------------------------------------------------------
// BTCH-02: Empty batch guard
// ---------------------------------------------------------------------------

describe('BTCH-02: Empty batch guard', () => {
    test('should not call axios.post when categories.ready is empty and shouldUpload is true', async () => {
        const categories = makeCategories([]);
        const options = makeUploadOptions({ shouldUpload: true });

        await uploadBatch(categories, options);

        expect(axios.post).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringMatching(/No payments ready to upload/)
        );
    });

    test('should log info via logGenerator when empty batch is skipped', async () => {
        const { logGenerator } = require('../src/utils/LogGenerator');
        const categories = makeCategories([]);
        const options = makeUploadOptions({ shouldUpload: true });

        await uploadBatch(categories, options);

        expect(logGenerator).toHaveBeenCalledWith(
            'PaymentReconciliation',
            'info',
            expect.stringMatching(/no payments ready/i)
        );
    });

    test('should not show upload hint in report mode when categories.ready is empty', async () => {
        const categories = makeCategories([]);
        const options = makeUploadOptions({ shouldUpload: false });

        await uploadBatch(categories, options);

        const logCalls = consoleLogSpy.mock.calls.map(c => c[0]);
        const hintCalls = logCalls.filter(msg =>
            typeof msg === 'string' && msg.match(/Use --upload/)
        );
        expect(hintCalls).toHaveLength(0);
    });

    test('should show upload hint in report mode when categories.ready has entries', async () => {
        const categories = makeCategories([makeReadyEntry()]);
        const options = makeUploadOptions({ shouldUpload: false });

        await uploadBatch(categories, options);

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringMatching(/Use --upload to send the 1 ready payments/)
        );
    });
});

// ---------------------------------------------------------------------------
// BTCH-01: Missing result detection
// ---------------------------------------------------------------------------

describe('BTCH-01: Missing result detection', () => {
    test('should report no missing when all results present', async () => {
        const entries = [
            makeReadyEntry({ hdr: { external_id: 'PY-001' } }),
            makeReadyEntry({ hdr: { external_id: 'PY-002' } }),
            makeReadyEntry({ hdr: { external_id: 'PY-003' } })
        ];
        const categories = makeCategories(entries);
        const options = makeUploadOptions();

        axios.post.mockResolvedValue({
            data: {
                results: [
                    { error_code: 0, id: 'portal-1', item: { external_id: 'PY-001' } },
                    { error_code: 0, id: 'portal-2', item: { external_id: 'PY-002' } },
                    { error_code: 0, id: 'portal-3', item: { external_id: 'PY-003' } }
                ]
            }
        });
        runQuery.mockResolvedValue({ rowsAffected: [1] });

        await uploadBatch(categories, options);

        const warnCalls = consoleWarnSpy.mock.calls.map(c => c.join(' '));
        const missingWarns = warnCalls.filter(msg => msg.match(/MISSING RESULT/));
        expect(missingWarns).toHaveLength(0);
    });

    test('should detect and warn when one result is missing from API response', async () => {
        const entries = [
            makeReadyEntry({ hdr: { external_id: 'PY-001' } }),
            makeReadyEntry({ hdr: { external_id: 'PY-002' } }),
            makeReadyEntry({ hdr: { external_id: 'PY-003' } })
        ];
        const categories = makeCategories(entries);
        const options = makeUploadOptions();

        // API returns results for PY-001 and PY-003 only (PY-002 missing)
        axios.post.mockResolvedValue({
            data: {
                results: [
                    { error_code: 0, id: 'portal-1', item: { external_id: 'PY-001' } },
                    { error_code: 0, id: 'portal-3', item: { external_id: 'PY-003' } }
                ]
            }
        });
        runQuery.mockResolvedValue({ rowsAffected: [1] });

        await uploadBatch(categories, options);

        expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringMatching(/PY-002.*MISSING RESULT/)
        );
    });

    test('should log missing result via logGenerator', async () => {
        const { logGenerator } = require('../src/utils/LogGenerator');
        const entries = [
            makeReadyEntry({ hdr: { external_id: 'PY-001' } }),
            makeReadyEntry({ hdr: { external_id: 'PY-002' } })
        ];
        const categories = makeCategories(entries);
        const options = makeUploadOptions();

        // API returns result for PY-001 only
        axios.post.mockResolvedValue({
            data: {
                results: [
                    { error_code: 0, id: 'portal-1', item: { external_id: 'PY-001' } }
                ]
            }
        });
        runQuery.mockResolvedValue({ rowsAffected: [1] });

        await uploadBatch(categories, options);

        expect(logGenerator).toHaveBeenCalledWith(
            'PaymentReconciliation',
            'warn',
            expect.stringMatching(/PY-002.*not in API response/i)
        );
    });

    test('should detect multiple missing results', async () => {
        const entries = [
            makeReadyEntry({ hdr: { external_id: 'PY-001' } }),
            makeReadyEntry({ hdr: { external_id: 'PY-002' } }),
            makeReadyEntry({ hdr: { external_id: 'PY-003' } })
        ];
        const categories = makeCategories(entries);
        const options = makeUploadOptions();

        // API returns result for PY-001 only (PY-002 and PY-003 missing)
        axios.post.mockResolvedValue({
            data: {
                results: [
                    { error_code: 0, id: 'portal-1', item: { external_id: 'PY-001' } }
                ]
            }
        });
        runQuery.mockResolvedValue({ rowsAffected: [1] });

        await uploadBatch(categories, options);

        const warnCalls = consoleWarnSpy.mock.calls.map(c => c.join(' '));
        const missingWarns = warnCalls.filter(msg => msg.match(/MISSING RESULT/));
        expect(missingWarns).toHaveLength(2);
    });

    test('should not run missing scan when batch POST throws (full failure)', async () => {
        const entries = [
            makeReadyEntry({ hdr: { external_id: 'PY-001' } }),
            makeReadyEntry({ hdr: { external_id: 'PY-002' } })
        ];
        const categories = makeCategories(entries);
        const options = makeUploadOptions();

        axios.post.mockRejectedValue(new Error('Network error'));

        await uploadBatch(categories, options);

        const warnCalls = consoleWarnSpy.mock.calls.map(c => c.join(' '));
        const missingWarns = warnCalls.filter(msg => msg.match(/MISSING RESULT/));
        expect(missingWarns).toHaveLength(0);
    });

    test('should handle result.item being null/undefined', async () => {
        const entries = [
            makeReadyEntry({ hdr: { external_id: 'PY-001' } })
        ];
        const categories = makeCategories(entries);
        const options = makeUploadOptions();

        // API returns 1 result with item: null
        axios.post.mockResolvedValue({
            data: {
                results: [
                    { error_code: 0, id: 'portal-1', item: null }
                ]
            }
        });
        runQuery.mockResolvedValue({ rowsAffected: [1] });

        await uploadBatch(categories, options);

        // PY-001 should be reported as MISSING RESULT since item is null
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringMatching(/PY-001.*MISSING RESULT/)
        );
    });
});

// ---------------------------------------------------------------------------
// BTCH-01: Updated summary format
// ---------------------------------------------------------------------------

describe('BTCH-01: Updated summary format', () => {
    test('should show Sent line in upload summary', async () => {
        const entries = [
            makeReadyEntry({ hdr: { external_id: 'PY-001' } }),
            makeReadyEntry({ hdr: { external_id: 'PY-002' } })
        ];
        const categories = makeCategories(entries);
        const options = makeUploadOptions();

        axios.post.mockResolvedValue({
            data: {
                results: [
                    { error_code: 0, id: 'portal-1', item: { external_id: 'PY-001' } },
                    { error_code: 0, id: 'portal-2', item: { external_id: 'PY-002' } }
                ]
            }
        });
        runQuery.mockResolvedValue({ rowsAffected: [1] });

        await uploadBatch(categories, options);

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringMatching(/Sent:\s+2/)
        );
    });

    test('should show Missing line only when missingCount > 0', async () => {
        const entries = [
            makeReadyEntry({ hdr: { external_id: 'PY-001' } }),
            makeReadyEntry({ hdr: { external_id: 'PY-002' } })
        ];
        const categories = makeCategories(entries);
        const options = makeUploadOptions();

        // Only PY-001 returns, PY-002 is missing
        axios.post.mockResolvedValue({
            data: {
                results: [
                    { error_code: 0, id: 'portal-1', item: { external_id: 'PY-001' } }
                ]
            }
        });
        runQuery.mockResolvedValue({ rowsAffected: [1] });

        await uploadBatch(categories, options);

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringMatching(/Missing:\s+1/)
        );
    });

    test('should NOT show Missing line when missingCount is 0', async () => {
        const entries = [
            makeReadyEntry({ hdr: { external_id: 'PY-001' } }),
            makeReadyEntry({ hdr: { external_id: 'PY-002' } })
        ];
        const categories = makeCategories(entries);
        const options = makeUploadOptions();

        axios.post.mockResolvedValue({
            data: {
                results: [
                    { error_code: 0, id: 'portal-1', item: { external_id: 'PY-001' } },
                    { error_code: 0, id: 'portal-2', item: { external_id: 'PY-002' } }
                ]
            }
        });
        runQuery.mockResolvedValue({ rowsAffected: [1] });

        await uploadBatch(categories, options);

        const logCalls = consoleLogSpy.mock.calls.map(c => c[0]);
        const missingCalls = logCalls.filter(msg =>
            typeof msg === 'string' && msg.match(/Missing:/)
        );
        expect(missingCalls).toHaveLength(0);
    });
});
