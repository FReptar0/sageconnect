/**
 * Integration tests for src/controller/PortalOC_Creator.js — Phase 20.1 fixed-interval retry.
 *
 * Covers CONTEXT D-08 Layer 2 (4 cases) — runQuery is mocked to return canned recordsets;
 * the assertions verify controller behavior across the four eligibility outcomes, evaluated
 * against the PO interval (config.retry.interval.po = 240 min):
 *   1  POSTED/CLOSED skip     — WHERE NOT EXISTS filtered the row at SQL level (empty recordset).
 *   2  ERROR inside interval  — 1 ERROR row 5 min ago; JS post-filter defers it (240 min not elapsed).
 *   3  ERROR past interval    — 1 ERROR row 250 min ago; JS post-filter keeps it; upload loop runs.
 *   4  First attempt          — no lastErrorAt; eligible immediately (RETRY-C4, highest blast radius).
 *
 * RetryPolicy.js is intentionally NOT mocked — the tests assert the real SQL shape
 * (OUTER APPLY, NOT EXISTS, sargable scope) that the helpers emit into the query string,
 * and the real eligibility math from computeRetryEligibility.
 *
 * RETRY-C7: the NOT EXISTS dedupe must exclude status IN ('CLOSED', 'POSTED') — a closed OC
 * has no POSTED row left (PortalOC_Closer UPDATEs it to CLOSED), so a POSTED-only dedupe
 * re-selects it and the portal answers 409.
 *
 * Phase 20.3 / RETRY-D3 (SQL shape only): test 1 also pins that the SELECT list projects
 * ef.errorCount with a camelCase alias and still does not project ef.lastErrorAt.
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');

jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://test',
        tenants: [{ id: 'T1', key: 'k1', secret: 's1', database: 'COPDAT', externalId: 'ext1' }],
        httpTimeoutMs: 30000,
    },
    paths: { downloads: '/tmp/downloads', logs: '/tmp/logs', providers: '/tmp/p' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', notices: [], cc: [], password: '' },
    license: { adminEmail: 'admin@test.com' },
    app: {
        company: 'TestCo', timezone: 'America/Mexico_City', rfc: 'RFC', regimen: 'R1', arg: 'A1',
        importRoute: '',
        defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
        addressIdentifiersSkip: [],
    },
    security: { apiKey: 'test-key' },
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 0, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
    // scope stays 'current_month' here so the DATEFROMPARTS SQL-shape assertions below keep
    // their meaning; the last_n_days default flip is proven in tests/utils/RetryPolicy.test.js.
    retry: { scope: 'current_month', lookbackDays: 30, interval: { payment: 30, po: 240 } },
    eom: { notificationHour: 18, notificationEnabled: true },
}));

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));

const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));

// Phase 20.3 / CONTEXT D-07b — MOCK REPAIR, not a behaviour change. Before 20.3-03 this factory
// returned `post` only. The wiring added there calls portalClient.get through the existence probe,
// so `get` being undefined would throw a TypeError, the helper would swallow it as
// {outcome:'unknown'}, fail-closed would suppress the POST, and test 3's assertion would fail for
// a reason that has nothing to do with what test 3 is about. Declaring `get` restores the four
// fixtures' pre-phase meaning. No fixture value, assertion or test name was changed.
const mockPortalGet = jest.fn();
const mockPortalPost = jest.fn();
jest.mock('../../src/utils/PortalClient', () => ({ get: mockPortalGet, post: mockPortalPost }));

jest.mock('../../src/utils/TimezoneHelper', () => ({ getCurrentDateString: () => '2026-05-15' }));
jest.mock('../../src/utils/OC_GroupOrdersByNumber', () => ({ groupOrdersByNumber: (rs) => rs }));
jest.mock('../../src/utils/parseExternPurchaseOrders', () => ({
    parseExternPurchaseOrders: (g) => g.map((r) => ({ external_id: r.EXTERNAL_ID, cfdi_payment_method: '', requisition_number: 0, _row: r })),
}));
jest.mock('../../src/models/PurchaseOrder', () => ({ validateExternPurchaseOrder: (po) => po }));

const { createPurchaseOrders } = require('../../src/controller/PortalOC_Creator');

// PO interval under test — mirrors the config mock above (config.retry.interval.po).
const PO_INTERVAL_MIN = 240;

// Single-clock fixtures (20.2 D-01 / hazard H-2).
// SERVER_SKEW_MIN is the measured DATEDIFF(mi, GETUTCDATE(), GETDATE()) on the deployed SQL
// host, 2026-07-27: tedious hands timestamps back 360 minutes behind the Node process clock.
// DB_NOW stands in for the `GETDATE() as [dbNow]` column the cron query now projects.
//
// Every lastErrorAt below derives from DB_NOW, never from Date.now(). No fixture in this repo
// set dbNow before this phase, so one that leaves it unset falls through to the process clock
// and keeps passing whatever the controller does — it would prove nothing.
const SERVER_SKEW_MIN = 360;
const DB_NOW = new Date(Date.now() - SERVER_SKEW_MIN * 60 * 1000);

describe('PortalOC_Creator cron WHERE + fixed-interval retry (Phase 20.1)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // clearAllMocks() clears call records but NOT queued mockResolvedValue(Once)
        // implementations. A test whose stubs the controller does not fully consume would
        // leak the remainder into the next test, which then silently asserts against the
        // wrong recordset. mockReset() drains the queue so each case is self-contained.
        mockRunQuery.mockReset();
        mockPortalPost.mockReset();
        mockPortalGet.mockReset();
    });

    test('POSTED/CLOSED rows filtered by WHERE — recordset empty, no portal POST', async () => {
        mockRunQuery.mockResolvedValueOnce({ recordset: [] });
        await createPurchaseOrders(0);

        const sqlPassed = mockRunQuery.mock.calls[0][0];
        expect(sqlPassed).toMatch(/NOT EXISTS/);
        expect(sqlPassed).toMatch(/OUTER APPLY/);
        expect(sqlPassed).toMatch(/DATEFROMPARTS|DATEADD\(month/);
        // RETRY-C7: the dedupe excludes BOTH lifecycle end-states, not POSTED alone.
        expect(sqlPassed).toMatch(/status IN \('CLOSED', ?'POSTED'\)/);
        expect(sqlPassed).not.toMatch(/AND status = 'POSTED'/);
        expect(mockRunQuery.mock.calls[0][1]).toBe('COPDAT');
        // D-12 #1 (20.2 D-01): the single clock, projected by the same statement as lastErrorAt.
        // Only this assertion catches removal of the column — the helper's fallback is silent.
        expect(sqlPassed).toMatch(/GETDATE\(\)\s+as\s+\[dbNow\]/);
        // SPEC acceptance guard: fesaOCFocaltec DOES have lastUpdate, so the OC branch must keep
        // emitting MAX(lastUpdate). Proves the payments fix (plan 20.2-01) did not regress it.
        expect(sqlPassed).toMatch(/MAX\(lastUpdate\) AS lastErrorAt/);
        // Phase 20.3 RETRY-D3: the SELECT list now projects errorCount — and ONLY errorCount.
        // lastErrorAt stays unprojected because the apply computes it as MAX over a column typed
        // `date`; projecting it today would anchor every OC's last failure at 00:00. Unblocking it
        // needs CR-04's ALTER TABLE (D-ITEM-03), which this phase deliberately does not reopen.
        // BOTH halves below are alias-prefixed, and that is load-bearing rather than stylistic:
        // buildErrorStatsApply (RetryPolicy.js:204-206) already emits the bare substrings
        // `errorCount` and `lastErrorAt` inside the OUTER APPLY, and the assertion directly above
        // already requires one of them to be PRESENT. Unprefixed, the positive half would be a
        // tautology that passed before this phase and the negative half would contradict L107.
        expect(sqlPassed).toMatch(/ef\.errorCount/);
        // Alias casing is the whole point (hazard H-4). The assertion above still passes against
        // `ef.errorCount as [ERRORCOUNT]`, which is the SILENT failure shape — the SQL succeeds,
        // row.errorCount stays undefined at PortalOC_Creator.js:241, the [RETRY-DEFER] line keeps
        // printing attempts=0, and the portal-existence gate added in Phase 20.3-03 never opens.
        // Case-sensitive on purpose: no `i` flag.
        expect(sqlPassed).toMatch(/ef\.errorCount\s+AS\s+errorCount/);
        // Standing guard so nobody reopens D-ITEM-03 / CR-04 by accident. Passes today; the point
        // is that it must keep passing until the column type is fixed.
        expect(sqlPassed).not.toMatch(/ef\.lastErrorAt/);

        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[RETRY\] tenant=COPDAT candidates=0 deferred=0 processing=0$/));
    });

    test('ERROR row inside the PO interval deferred — [RETRY-DEFER] log, no portal POST', async () => {
        // Derived from DB_NOW, not Date.now(): 5 minutes old on the SERVER clock, 365 on the
        // process clock. Under the pre-20.2 `new Date()` implementation this row read as
        // eligible and the deferred=1 assertion below would fail.
        const fiveMinAgo = new Date(DB_NOW.getTime() - 5 * 60 * 1000);
        // INTENTIONALLY OPTIMISTIC FIXTURE — see D-ITEM-03 in deferred-items.md.
        // This recordset supplies lastErrorAt, but the real PortalOC_Creator query does NOT
        // project ef.lastErrorAt (it joins the OUTER APPLY and discards the result), so a live
        // row can never carry it. Every PO is therefore ruled eligible in production and the
        // per-row deferral log has never been able to fire for POs. The fixture is retained
        // deliberately so the helper's deferral logic keeps its coverage for the day D-ITEM-03
        // and CR-04 are resolved together.
        mockRunQuery.mockResolvedValueOnce({
            recordset: [{
                EXTERNAL_ID: 'PO0083449',
                errorCount: 1,
                lastErrorAt: fiveMinAgo,
                dbNow: DB_NOW,
            }],
        });
        await createPurchaseOrders(0);

        const sqlPassed = mockRunQuery.mock.calls[0][0];
        expect(sqlPassed).toMatch(/OUTER APPLY/);
        expect(sqlPassed).toMatch(/NOT EXISTS/);

        expect(mockPortalPost).not.toHaveBeenCalled();
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[RETRY-DEFER\] PO PO0083449 tenant=COPDAT attempts=1 nextEligibleAt=/));
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[RETRY\] tenant=COPDAT candidates=1 deferred=1 processing=0$/));
    });

    test('ERROR row past the PO interval included — [RETRY] processing=1', async () => {
        // 250 min ago on the SERVER clock — must exceed the 240-min PO interval, otherwise this
        // row would defer. Derived from DB_NOW so the fix is proven not to over-defer.
        const pastIntervalAt = new Date(DB_NOW.getTime() - (PO_INTERVAL_MIN + 10) * 60 * 1000);
        mockRunQuery.mockResolvedValueOnce({
            recordset: [{
                EXTERNAL_ID: 'PO0083500',
                errorCount: 1,
                lastErrorAt: pastIntervalAt,
                dbNow: DB_NOW,
            }],
        });
        // Subsequent FESA INSERT calls (ERROR row after the forced POST failure).
        mockRunQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
        // Phase 20.3 / CONTEXT D-07b — MOCK REPAIR, not a behaviour change. This is the only one of
        // the four cases whose row reaches the upload loop with errorCount > 0, so it is the only
        // one that trips the existence gate. Stubbing an empty item list makes the probe answer
        // `absent`, the POST proceeds, and toHaveBeenCalledTimes(1) below keeps the exact meaning it
        // had before the phase: this row was eligible and the loop ran for it. The fixture's
        // errorCount stays 1 — flipping it to 0 would silently gut what the test is here to prove.
        mockPortalGet.mockResolvedValueOnce({ data: { items: [], total: 0 } });
        mockPortalPost.mockRejectedValueOnce(new Error('mock portal failure'));

        await createPurchaseOrders(0);

        expect(mockPortalPost).toHaveBeenCalledTimes(1);
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[RETRY\] tenant=COPDAT candidates=1 deferred=0 processing=1$/));

        const deferCalls = mockLogGenerator.mock.calls.filter((c) => /\[RETRY-DEFER\] PO PO0083500/.test(c[2] || ''));
        expect(deferCalls.length).toBe(0);
    });

    test('first-attempt row (no lastErrorAt) included immediately — [RETRY] processing=1', async () => {
        // RETRY-C4: a never-failed PO is not a retry. Deferring it would stall normal uploads.
        mockRunQuery.mockResolvedValueOnce({
            recordset: [{
                EXTERNAL_ID: 'PO0083600',
                errorCount: 0,
                lastErrorAt: null,
                dbNow: DB_NOW,
            }],
        });
        mockRunQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
        mockPortalPost.mockRejectedValueOnce(new Error('mock portal failure'));

        await createPurchaseOrders(0);

        expect(mockPortalPost).toHaveBeenCalledTimes(1);
        expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info',
            expect.stringMatching(/^\[RETRY\] tenant=COPDAT candidates=1 deferred=0 processing=1$/));

        const deferCalls = mockLogGenerator.mock.calls.filter((c) => /\[RETRY-DEFER\] PO PO0083600/.test(c[2] || ''));
        expect(deferCalls.length).toBe(0);
    });
});
