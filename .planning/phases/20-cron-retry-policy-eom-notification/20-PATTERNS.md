# Phase 20: cron-retry-policy-eom-notification — Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 17 (10 NEW, 7 EDIT)
**Analogs found:** 17 / 17 (100% coverage — every file has a strong codebase analog)

---

## File Classification

| New/Modified File | Change Class | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|--------------|------|-----------|----------------|---------------|
| `src/utils/RetryPolicy.js` | NEW | utility (pure helper module) | transform | `src/utils/duration.js` | exact |
| `src/utils/EomNotification.js` | NEW | utility (pure helpers + fs) | transform + file-I/O | `src/utils/duration.js` + `src/utils/LogGenerator.js` (fs only) | role-match |
| `src/scripts/retry-month-pos.js` | NEW | script (CLI dry-run/apply) | CRUD-batch | `src/scripts/payment-uuid-repair.js` | exact |
| `src/scripts/retry-month-payments.js` | NEW | script (CLI dry-run/apply) | CRUD-batch | `src/scripts/payment-uuid-repair.js` | exact |
| `tests/utils/RetryPolicy.test.js` | NEW | test (pure-helper unit) | request-response (assert) | `tests/TimezoneHelper.test.js` | exact |
| `tests/utils/EomNotification.test.js` | NEW | test (helper + fs) | request-response (assert) | `tests/TimezoneHelper.test.js` + `tests/utils/log-generator.test.js` (fs spy) | role-match |
| `tests/controller/PortalOC_Creator.cron-where.test.js` | NEW | test (controller integration) | request-response (assert) | `tests/controller/Providers_Downloader.xml-error.test.js` | exact |
| `tests/controller/PortalPaymentController.cron-where.test.js` | NEW | test (controller integration) | request-response (assert) | `tests/controller/Providers_Downloader.xml-error.test.js` | exact |
| `tests/integration/eom-dispatch.test.js` | NEW | test (integration with mocked clock + fs + nodemailer) | event-driven | `tests/integration/timeout-logging.test.js` | role-match |
| `tests/fixtures/eom-email-sample.html` | NEW | fixture (snapshot) | static-asset | none (first fixture in `tests/fixtures/`) | no-analog |
| `src/controller/PortalOC_Creator.js` | EDIT-rewrite | controller (cron uploader) | CRUD-batch | self (lines 176-185 + 215-227) | self-modify |
| `src/controller/PortalPaymentController.js` | EDIT-rewrite | controller (cron uploader) | CRUD-batch | self (lines 60-100) | self-modify |
| `src/utils/EmailSender.js` | EDIT-extend | utility (mailer) | request-response | `src/utils/AdminEmailSender.js` | exact |
| `src/background.js` | EDIT-modify | orchestrator (forResponse) | event-driven | self (lines 40-77 step block pattern) | self-modify |
| `src/scripts/po-cron-diagnostic.js` | EDIT-modify | script (diagnostic) | request-response (read-only SELECT) | self (Section 4 lines 154-185) | self-modify |
| `src/config.js` | EDIT-extend | config loader | config | self (lines 168-208) | self-modify |
| `.env.example` | EDIT-extend | docs (env template) | config | self (lines 79-97) | self-modify |

---

## Pattern Assignments

### NEW — `src/utils/RetryPolicy.js` (utility, pure helpers)

**Analog:** `src/utils/duration.js`

**Why this analog:** `duration.js` is the canonical "small pure-helper module" template — multiple named exports, no module-scope state (no Map/Set/timer/listener — clean against CLAUDE.md §3 always-on regime), JSDoc with phase REQ refs in the file header comment, `module.exports = { fn1, fn2 }` shape. `RetryPolicy.js` is the same shape: 3 pure functions, all stateless, all driven by config object passed in.

**Imports + module-level pattern** (`src/utils/duration.js:1-3`):
```javascript
// REC-02 / D-04: formats lock-held duration for history summaries and admin email subjects.

/**
 * Format a millisecond duration as a human-readable string.
 * ...
```
*No `require()` — pure functions only. RetryPolicy.js can require `../config` for default backoff params if helper signature defaults to `config.retry.backoff` (planner discretion per CONTEXT D-Discretion).*

**Function signature + JSDoc pattern** (`src/utils/duration.js:18-32`):
```javascript
function formatDurationMin(durationMs) {
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
        return '0s';
    }
    const totalSeconds = Math.floor(durationMs / 1000);
    if (totalSeconds < 60) {
        return totalSeconds + 's';
    }
    ...
}
```

**Multi-export shape** (`src/utils/duration.js:67`):
```javascript
module.exports = { formatDurationMin, withStepTimeout };
```

**What to replicate:**
- File-header comment with phase REQ refs: `// RETRY-04 / D-01: helper for exponential backoff wait calculation, used by both cron path and diagnostic script.`
- 3 named exports: `computeBackoffWaitMinutes(errorCount, backoffConfig)`, `buildScopeWhere(scopeConfig)`, `buildErrorStatsApply({fesaTable, joinKey, dbAlias})`
- Defensive input validation (CONTEXT D-01: helper called from JS post-filter — return `0` for `errorCount === 0` to mean "no wait, eligible immediately")
- Return raw strings for SQL builders (no template tags). Variables come from range-guarded envs (CONTEXT §code_context "Established Patterns" — safe per CLAUDE.md §6 #1)
- JSDoc with `@param` / `@returns` on every export
- `module.exports = { computeBackoffWaitMinutes, buildScopeWhere, buildErrorStatsApply }`

**What to vary:**
- Add `nextEligibleAt(lastErrorAt, errorCount, config)` if planner picks Discretion option (CONTEXT D-Discretion #4); both shapes accepted.
- `buildErrorStatsApply` returns a multi-line SQL fragment string — match the existing template-literal indentation style used in `PortalOC_Creator.js:176-185` (4-space indent, lowercase keywords for body, uppercase for `OUTER APPLY`/`SELECT`/`FROM`/`WHERE`).

---

### NEW — `src/utils/EomNotification.js` (utility, helpers + fs)

**Analog:** `src/utils/duration.js` (pure-helper shape) + `src/utils/LogGenerator.js` (fs.writeFileSync / fs.mkdirSync atomic write pattern)

**Why this analog:** `duration.js` for the helper-module shape; `LogGenerator.js` for the `fs.existsSync` + `fs.mkdirSync(..., { recursive: true })` pattern needed before writing the sentinel.

**Sentinel-file fs pattern** (`src/utils/LogGenerator.js:42-49`):
```javascript
const logDir = path.join(config.paths.logs, 'sageconnect', dateISO);

try {
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const logger = buildLogger(path.join(logDir, `${fileName}.log`));
    loggerCache.set(cacheKey, logger);
    return logger;
```

**Clock-injection signature pattern** (`src/utils/duration.js:56-65`):
```javascript
function withStepTimeout(promiseOrFn, ms, label) {
    const promise = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
            () => reject(new Error(`Step timeout after ${formatDurationMin(ms)} — ${label}`)),
            ms
        );
    });
    return Promise.race([promise, timeoutPromise]);
}
```
*The `promiseOrFn` first-arg pattern is the model for `now` first-arg in `shouldDispatchEom(now, sentinelPath, eomConfig)` (CONTEXT D-16).*

**What to replicate:**
- File-header comment with phase REQ refs: `// EOM-01 / D-08-D-16: gate evaluation, sentinel I/O, and HTML body builder for the end-of-month operator email.`
- 4 named exports: `shouldDispatchEom(now, sentinelPath, eomConfig)`, `buildEomEmailHtml(rows, category)`, `writeSentinelAtomically(path, payload)`, `readSentinelPayload(path)`
- `now` first arg = clock injection (CONTEXT D-16 — production passes `new Date()`, tests pass `new Date('2026-05-31T18:05:00Z')`); zero `jest.useFakeTimers` needed
- Atomic write pattern (CONTEXT D-07): `fs.writeFileSync(\`${path}.tmp\`, JSON.stringify(payload, null, 2)); fs.renameSync(\`${path}.tmp\`, path)` — POSIX rename atomic on same FS
- `fs.mkdirSync(path.dirname(sentinelPath), { recursive: true })` before write (mirrors LogGenerator pattern)
- Sentinel payload schema: `{timestamp: ISO8601, success: boolean, error?: string, rowCount?: number}` (CONTEXT D-07)
- HTML builder uses inline `<table>` markup similar to `EmailSender.sendMail` body shape; no external template engine (codebase doesn't have one)
- Helper accepts `callerLogFile` arg for log routing per `AdminEmailSender.sendAdminAlert` pattern (CONTEXT D-14)

**What to vary:**
- `EomNotification.js` requires `fs` and `config` (unlike pure `duration.js`); add the requires at top
- `module.exports = { shouldDispatchEom, buildEomEmailHtml, writeSentinelAtomically, readSentinelPayload }`
- Empty-category email body (CONTEXT D-10): when `rows.length === 0`, return HTML containing literal `'Sin pendientes en esta categoría este mes'` (REQ EOM-03 spirit)

---

### NEW — `src/scripts/retry-month-pos.js` and `src/scripts/retry-month-payments.js` (scripts, dry-run-default CLI)

**Analog:** `src/scripts/payment-uuid-repair.js` — canonical example for Convention A (dry-run default, opt-in `--apply`) per HANDOFF.md §6 table

**Why this analog:** HANDOFF.md §6 explicitly names `payment-uuid-repair.js` as the canonical Convention A example; these new scripts are pre-cron sweep scripts that mutate FESA control table (INSERT ERROR/POSTED rows after attempting Focaltec POST), so they MUST default to `--dry-run` and require `--apply` for mutation.

**CLI parsing pattern** (`src/scripts/payment-uuid-repair.js:75-101`):
```javascript
function parseArgs() {
    const args = process.argv.slice(2);
    const mode = args[0]; // scan | repair | upload
    let apply = false;
    let batchSize = null;
    let pyFilter = null;
    let tenantIndex = 0;
    let months = 12;

    for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (a === '--apply') {
            apply = true;
        } else if (a.startsWith('--batch=')) {
            batchSize = parseInt(a.split('=')[1], 10);
        } else if (a === '--py' && args[i + 1]) {
            pyFilter = args[i + 1];
            i++;
        } else if (a.startsWith('--index=')) {
            tenantIndex = parseInt(a.split('=')[1], 10);
        } else if (a.startsWith('--months=')) {
            months = parseInt(a.split('=')[1], 10);
        }
    }

    return { mode, apply, batchSize, pyFilter, tenantIndex, months };
}
```

**Dry-run conditional pattern** (`src/scripts/payment-uuid-repair.js:837-849`):
```javascript
                if (apply) {
                    // ... actual write
                } else {
                    console.log(`    -> DRY-RUN: Would write UUID to APIBHO`);
                }
```

**`[DRY-RUN]` log prefix discipline** (`src/scripts/payment-uuid-repair.js:1154-1155`):
```javascript
        if (!apply) {
            console.log(`  [DRY-RUN] Payload for ${docNbr} (status: ${payStatus}):`);
```

**console.log → log file interceptor pattern** (`src/scripts/payment-uuid-repair.js:43-65`):
```javascript
// --- Console → Log File Interceptor ---
// Mirrors ALL console output to the winston log file so nothing is lost
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;
const _origTable = console.table;

console.log = (...args) => {
    _origLog.apply(console, args);
    logGenerator(LOG_FILE, 'info', args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
};
```

**ResultEnvelope shape with `mode` field** (HANDOFF.md §6 quoted: `data.mode = 'dry-run'`) — see existing `successResult` import + shape (`src/scripts/payment-uuid-repair.js:31`):
```javascript
const { successResult, errorResult } = require('../utils/ResultEnvelope');
```

**Apply summary discipline** (`src/scripts/payment-uuid-repair.js:887,902`):
```javascript
    console.log(`\n--- REPAIR ${apply ? 'APPLY' : 'DRY-RUN'} COMPLETE ---`);
    ...
    return successResult(
        ...,
        `Repair ${apply ? 'apply' : 'dry-run'}: ${repairedCount} repaired, ${noMatchCount} no match, ${errorCount} errors`,
```

**Secondary analog (analogous PO-related script with same upload contract):** `src/scripts/po-upload.js` — for the upload loop (lines 254-388) showing how to call `runQuery` against `'FESA'` for the POSTED check, validate Joi, POST to portal, INSERT POSTED/ERROR. Note: `po-upload.js` is **Convention B (legacy)** with `--dry-run` opt-in; the new `retry-month-*.js` scripts MUST use Convention A per HANDOFF.md §6 ("Use for new write scripts").

**What to replicate:**
- Header docblock listing all CLI args + Usage examples (mirror lines 1-26 of payment-uuid-repair.js)
- `parseArgs()` function with `apply = false` default, `if (a === '--apply') apply = true;`
- `LOG_FILE` const at top: `const LOG_FILE = 'RetryMonthPOs'` and `const LOG_FILE = 'RetryMonthPayments'` (CLAUDE.md §5 LogGenerator convention)
- console interceptor block (forwards all output to the winston log)
- Reuse `RetryPolicy.js` helpers: `buildScopeWhere(config.retry)`, `buildErrorStatsApply({fesaTable, joinKey, dbAlias})`, `computeBackoffWaitMinutes(errorCount, config.retry.backoff)` — single source of truth with cron path (CONTEXT D-05)
- `[DRY-RUN]` prefix on every per-row log line in dry-run path
- `successResult` envelope with `data.mode = apply ? 'apply' : 'dry-run'`
- Apply summary: `Retry-month-pos ${apply ? 'apply' : 'dry-run'}: ${eligibleCount} eligible, ${deferredCount} deferred (backoff), ${postedCount} posted-skip`

**What to vary:**
- POs script reuses `PortalOC_Creator.js` SQL build (extracted via `RetryPolicy.js` helpers); payments script reuses `PortalPaymentController.js` SQL build
- For payments: preserve the 60-min antiquity filter (REQ RETRY-02 boundaries — out of scope to change)
- Both scripts: pass `db` arg explicitly to every `runQuery` call. `'FESA'` for fesa.dbo.*; `databases[index]` for tenant DB (CLAUDE.md §6 #2)

---

### NEW — `tests/utils/RetryPolicy.test.js` (test, pure-helper unit)

**Analog:** `tests/TimezoneHelper.test.js` — canonical pure-helper unit test pattern with `jest.mock('../src/config', () => ({ ... }))` shim

**Why this analog:** `TimezoneHelper.test.js` is the cleanest example of testing a pure-helper module (no integration, no SQL, no nodemailer mocks); same shape needed for `RetryPolicy.test.js` (3 pure functions, no I/O).

**Config mock pattern** (`tests/TimezoneHelper.test.js:4-19`):
```javascript
// Mock config to prevent process.exit(1) from config validation
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
        importRoute: '', arg: '', company: '', rfc: '', regimen: '', timezone: 'America/Mexico_City',
        defaultAddress: { city: '', country: '', identifier: '', municipality: '', state: '', street: '', zip: '' },
        addressIdentifiersSkip: []
    }
}));
```
*Tests for `RetryPolicy.js` need to ALSO add `retry: { scope: 'current_month', lookbackDays: 30, backoff: { initialMin: 15, multiplier: 2, maxMin: 1440 } }` to the mock (matches new `config.retry.*` namespace from CONTEXT §code_context).*

**Required imports** (`tests/TimezoneHelper.test.js:21-29`):
```javascript
const {
    getCurrentDate,
    ...
} = require('../src/utils/TimezoneHelper');
```

**Describe + per-method test pattern** (`tests/TimezoneHelper.test.js:31-52`):
```javascript
describe('TimezoneHelper utility', () => {

    describe('TIMEZONE constant', () => {
        test('should return the configured timezone', () => {
            expect(TIMEZONE).toBe('America/Mexico_City');
        });
        ...
    });
```

**SPEC RETRY-04 acceptance criteria — test cases to write** (driven by SPEC):
- `computeBackoffWaitMinutes(0)` → `0`
- `computeBackoffWaitMinutes(1)` → `15`, `(2)` → `30`, `(3)` → `60`, `(4)` → `120`, `(5)` → `240`, `(6)` → `480`, `(7)` → `960`, `(8)` → `1440`
- `computeBackoffWaitMinutes(20)` → `1440` (capped at MAX)
- `buildScopeWhere({scope: 'current_month'})` → string contains `DATEFROMPARTS` and `DATEADD(month, 1`
- `buildScopeWhere({scope: 'last_n_days', lookbackDays: 30})` → string contains `DATEADD(day, -30`
- `buildErrorStatsApply({fesaTable: 'fesa.dbo.fesaOCFocaltec', joinKey: 'A.PONUMBER', dbAlias: 'COPDAT'})` → string contains `OUTER APPLY`, `COUNT(*)` aliased as `errorCount`, `MAX(lastUpdate)` aliased as `lastErrorAt`, `status = 'ERROR'`, `idDatabase = 'COPDAT'`

**What to replicate:**
- Top-level `jest.mock('../src/config', () => ({ ... }))` with full shim (NOT `'../../src/config'` — `tests/utils/` directory uses `../../src/...` relative path; verify with `tests/utils/log-generator.test.js:6` mock path `'../../src/config'`)
- One `describe()` per export (`computeBackoffWaitMinutes`, `buildScopeWhere`, `buildErrorStatsApply`)
- `expect(...).toBe(...)` for scalar returns; `expect(...).toMatch(/.../)` or `expect(...).toContain('...')` for SQL substring assertions (CONTEXT D-12 Layer 1)

**What to vary:**
- Test file directory: `tests/utils/` → relative path is `../../src/...` (NOT `../src/...`)
- No SMTP/nodemailer mocks needed
- No `jest.spyOn(fs, ...)` needed (no fs operations in `RetryPolicy.js`)

---

### NEW — `tests/utils/EomNotification.test.js` (test, helper + fs)

**Analog:** `tests/TimezoneHelper.test.js` (helper unit-test base) + `tests/utils/log-generator.test.js` (fs.spy + tmp dir pattern)

**Why this analog:** `EomNotification.js` has both pure helpers (`shouldDispatchEom`, `buildEomEmailHtml`) AND fs-side-effecting helpers (`writeSentinelAtomically`, `readSentinelPayload`). The fs side needs the same tmp-dir pattern that `log-generator.test.js` already uses for log file writes.

**Tmp directory pattern** (`tests/utils/log-generator.test.js:1-11`):
```javascript
const path = require('path');
const fs = require('fs');
const os = require('os');

jest.mock('../../src/config', () => {
    const nodePath = require('path');
    const nodeOs = require('os');
    return {
        paths: { logs: nodePath.join(nodeOs.tmpdir(), `sageconnect-test-logs-${process.pid}`) },
    };
});
```

**Cleanup hook** (`tests/utils/log-generator.test.js:36-44`):
```javascript
    afterEach(() => {
        if (LogGenerator && typeof LogGenerator._closeAll === 'function') {
            LogGenerator._closeAll();
        }
        createLoggerSpy.mockRestore();
        try {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        } catch (_e) { /* ignore */ }
    });
```

**Selective fs spy pattern (for renameSync failure test)** — see `tests/controller/Providers_Downloader.xml-error.test.js:86-97`:
```javascript
        writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(function (p, data, encoding) {
            if (typeof p === 'string' && p.startsWith(TEST_PATH_PREFIX)) {
                writeFileSyncCalls.push([p, data, encoding]);
                if (writeFileSyncShouldThrow) {
                    const err = writeFileSyncShouldThrow;
                    writeFileSyncShouldThrow = null;
                    throw err;
                }
                return undefined;
            }
            return realWriteFileSync.call(fs, p, data, encoding);
        });
```

**Test cases to write (SPEC EOM-01 / D-15 + D-16):**
- `shouldDispatchEom` truth table (8 input combos): last-day-of-month YES/NO × hour ≥ 18 YES/NO × sentinel exists YES/NO. Use `new Date('2026-05-31T18:05:00Z')` (positive case), `new Date('2026-05-31T17:55:00Z')` (hour < 18), `new Date('2026-05-30T18:05:00Z')` (not last day), etc. — clock-injection per CONTEXT D-16
- `writeSentinelAtomically` + `readSentinelPayload` round-trip (write → read → assert payload equality)
- `writeSentinelAtomically` rename-failure case (mocked `fs.renameSync` throwing → assert sentinel.tmp file behavior)
- `buildEomEmailHtml(fixedRows, 'pos')` → output matches snapshot fixture (D-15-d) — load `tests/fixtures/eom-email-sample.html` with `fs.readFileSync` and `expect(actual.trim()).toBe(expected.trim())`

**What to replicate:**
- jest.mock('../../src/config', ...) shim — same shape as RetryPolicy.test.js but ALSO add `eom: { notificationHour: 18, notificationEnabled: true }`
- Tmp dir pattern: `os.tmpdir() + sageconnect-test-eom-{pid}` for sentinel writes
- `afterEach` hook with `fs.rmSync(tmpRoot, { recursive: true, force: true })` cleanup
- Selective fs.spy for the rename-failure case (don't break Jest's own fs usage)

**What to vary:**
- Snapshot test loads fixture: `const expected = fs.readFileSync(path.join(__dirname, '../fixtures/eom-email-sample.html'), 'utf8');`

---

### NEW — `tests/controller/PortalOC_Creator.cron-where.test.js` and `tests/controller/PortalPaymentController.cron-where.test.js` (test, controller integration)

**Analog:** `tests/controller/Providers_Downloader.xml-error.test.js` — only existing controller integration test, with the full mock pattern for the controller surface

**Why this analog:** This is the pattern adopted in v2.3 for controller-level integration tests with mocked `runQuery`, `nodemailer`, `LogGenerator`. The new files mirror this exact shape, swapping `getProviders` mock for `runQuery` recordset mocks.

**Config mock for controller test** (`tests/controller/Providers_Downloader.xml-error.test.js:23-36`):
```javascript
jest.mock('../../src/config', () => ({
    portal: {
        url: 'http://test',
        tenants: [{ id: 'T1', key: 'k1', secret: 's1', database: 'DB1', externalId: 'ext1' }],
        httpTimeoutMs: 30000,
    },
    paths: { downloads: '/tmp/downloads', logs: '/tmp/logs' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', notices: [], cc: [], password: '' },
    license: { adminEmail: 'admin@test.com' },
    app: { company: 'TestCo', timezone: 'America/Mexico_City', rfc: 'RFC', regimen: 'R1', arg: 'A1' },
    security: { apiKey: 'test-key' },
    schedule: { cronExpression: '*/15 * * * *', operationDelayMs: 5000, lockTimeoutMs: 14 * 60 * 1000, childProcessTimeoutMs: 600000, stepTimeoutMs: 300000 },
}));
```
*MUST add `retry: { scope: 'current_month', lookbackDays: 30, backoff: { initialMin: 15, multiplier: 2, maxMin: 1440 } }` and `eom: { notificationHour: 18, notificationEnabled: true }` to the mock for the new tests.*
*MUST add `app.addressIdentifiersSkip: []` and `app.defaultAddress: {...}` because PortalOC_Creator imports them at top.*

**LogGenerator mock pattern** (`tests/controller/Providers_Downloader.xml-error.test.js:46-47`):
```javascript
const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));
```

**Per-test mock setup** (`tests/controller/Providers_Downloader.xml-error.test.js:78-83`):
```javascript
    beforeEach(() => {
        jest.clearAllMocks();
        ...
    });
```

**runQuery mock pattern (NEW for these tests, derived from `tests/SQLServerConnection.test.js:5-21`):**
```javascript
const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({
    runQuery: mockRunQuery,
}));
```
*Then per-test, set up canned recordsets:*
```javascript
mockRunQuery
    .mockResolvedValueOnce({ recordset: [/* tenant DB query result with errorCount + lastErrorAt from OUTER APPLY */] })
    .mockResolvedValueOnce({ recordset: [/* additional queries */] });
```

**Test case structure (CONTEXT D-12 Layer 2):** 3 cases per controller —
1. **POSTED skip**: fixture row has matching `POSTED` row in fesaOCFocaltec → recordset.length === 0 (filtered out by `NOT EXISTS` in WHERE)
2. **ERROR-in-backoff skip**: fixture row has 1 ERROR row with `lastUpdate` 5 minutes ago + `errorCount=1` → JS post-filter skips it (15 min backoff not yet elapsed); assert per-row `[BACKOFF-DEFER]` log call (CONTEXT D-13)
3. **ERROR-out-of-backoff include**: fixture row has 1 ERROR row with `lastUpdate` 20 minutes ago + `errorCount=1` → row included in upload loop; assert summary `[BACKOFF] tenant=... candidates=X deferred=Y processing=Z` log call

**What to replicate:**
- jest.mock for `'../../src/config'`, `'../../src/utils/SQLServerConnection'`, `'../../src/utils/LogGenerator'`, `'nodemailer'`, `'../../src/utils/PortalClient'` (the latter two for the upload portion if testing past the WHERE)
- Assertion shape: `expect(mockLogGenerator).toHaveBeenCalledWith('PortalOC_Creator', 'info', expect.stringMatching(/^\[BACKOFF-DEFER\] PO PO0083449 tenant=COPDAT attempts=1 nextEligibleAt=/))`
- Match the existing `expect(mockLogGenerator).toHaveBeenCalledWith(...)` style from line 122-127 of the analog

**What to vary:**
- For `PortalPaymentController.cron-where.test.js`: same 3 cases applied to payment WHERE; preserve assertion that 60-min antiquity filter is unchanged in the SQL (`expect(sqlPassedToRunQuery).toMatch(/>= 60/)`)

---

### NEW — `tests/integration/eom-dispatch.test.js` (test, integration with mocked clock + fs + nodemailer)

**Analog:** `tests/integration/timeout-logging.test.js` (existing integration test in `tests/integration/`)

**Why this analog:** Only existing integration test; same directory placement; uses similar shared-mock shape for `'../../src/config'` and `LogGenerator`. The EOM dispatch is event-driven (cron-tick guard fires the dispatch), so it pairs the integration-style file with the spied transport.

**Integration test shared mock** (`tests/integration/timeout-logging.test.js:14-37`):
```javascript
// Shared mock for src/config (S-9) — needed for PortalClient require below
jest.mock('../../src/config', () => ({
    schedule: {
        cronExpression: '*/15 * * * *',
        operationDelayMs: 0,
        lockTimeoutMs: 14 * 60 * 1000,
        childProcessTimeoutMs: 1000,
        stepTimeoutMs: 1000,
    },
    portal: {
        url: 'http://test',
        tenants: [{ id: 'T1' }],
        httpTimeoutMs: 30000,
    },
    app: { importRoute: 'fake', arg: 'arg', timezone: 'America/Mexico_City', company: 'TestCo', rfc: '', regimen: '' },
    mailing: { server: 'smtp', port: 587, ssl: false, from: 'noreply@test', password: '', notices: [], cc: [] },
    license: { adminEmail: 'admin@test.com' },
    database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
    paths: { logs: '/tmp/logs', downloads: '/tmp/dl', providers: '/tmp/p' },
    security: { apiKey: 'test-key' },
}));

const mockLogGenerator = jest.fn();
jest.mock('../../src/utils/LogGenerator', () => ({ logGenerator: mockLogGenerator }));
```

**Test cases (SPEC EOM-04 — 3 integration tests required):**
- **(a)** First tick of last day at 18:05 with no sentinel → email sent to MAILING_NOTICES, sentinel created with `success: true, rowCount: N`
- **(b)** Second tick same day same month → sentinel already present → no email re-sent (skip silent)
- **(c)** First tick with mocked SMTP failure → sentinel created with `success: false, error: ...`, AdminEmailSender.sendAdminAlert called with subject `[SageConnect] EOM email FAILED for {YYYY-MM} - {categoría}`, no re-send on subsequent ticks of same day/month

**Spied transport pattern** (similar to `tests/controller/Providers_Downloader.xml-error.test.js:41-44`):
```javascript
const mockNodemailerSendMail = jest.fn().mockResolvedValue({ accepted: ['ops@test.com'] });
jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({ sendMail: mockNodemailerSendMail })),
}));
```

**runQuery mock for EOM data fetch:**
```javascript
const mockRunQuery = jest.fn();
jest.mock('../../src/utils/SQLServerConnection', () => ({ runQuery: mockRunQuery }));
// In test: pre-load fixture rows for both POs and pagos categories
```

**What to replicate:**
- shared-mock placement at top of file (config + LogGenerator before any module require)
- nodemailer mock with `mockResolvedValue` (success case) / `mockRejectedValueOnce(new Error(...))` (failure case)
- AdminEmailSender path: don't mock the helper — let the real `sendAdminAlert` run with the mocked nodemailer; assert via `expect(mockNodemailerSendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: '[SageConnect] EOM email FAILED for ...' }))`
- Sentinel assertion via `fs.readFileSync` of the tmp sentinel path → JSON.parse → assert shape

**What to vary:**
- Add `eom: { notificationHour: 18, notificationEnabled: true }` and `retry` namespace to the config mock
- Use `os.tmpdir()` + `process.pid` for sentinel base path (same as log-generator.test.js)
- For test (b) — write sentinel manually before invoking the gate; assert no `mockNodemailerSendMail` call

---

### NEW — `tests/fixtures/eom-email-sample.html` (fixture, snapshot)

**Analog:** None (first fixture in `tests/fixtures/` directory — directory does not yet exist).

**What to do:**
- Create directory `tests/fixtures/`
- Write a deterministic HTML file matching the SPEC EOM-03 structure: `<h1>SageConnect: Pendientes fin de mes — {YYYY-MM}</h1>` + intro `<p>` + 1 table with columns `#`, `Tenant`, `Fecha autorización`, `Intentos`, `Último error` (truncated to 100 chars) + footer with `<a href="${BASE_URL}/pos.html">Ver POs</a>` and `<a href="${BASE_URL}/payments.html">Ver pagos</a>`
- Use a **fixed** YYYY-MM placeholder (e.g., `2026-05`) so the snapshot is deterministic
- Use 2 PO rows + 1 pago row in the fixture per CONTEXT specifics (D-Discretion gives planner freedom for exact styling)
- The test (`buildEomEmailHtml(fixedFixtureRows, 'pos')`) MUST produce byte-identical output to this fixture for the snapshot assertion to pass

**Pattern source:** SPEC EOM-03 Acceptance + CONTEXT specifics §1 lines 169-181

---

### EDIT-rewrite — `src/controller/PortalOC_Creator.js` (controller, cron uploader)

**Analog:** Self — the existing template-literal SQL block in `src/controller/PortalOC_Creator.js:174-188` is the structural pattern to extend.

**Existing WHERE block** (`src/controller/PortalOC_Creator.js:172-188`):
```javascript
left outer join Autorizaciones_electronicas.dbo.Autoriza_OC X
  on A.PONUMBER = X.PONumber
where
  X.Autorizada = 1
  and X.Empresa = '${databases[index]}'
  and (
    select max(Fecha)
      from Autorizaciones_electronicas.dbo.Autoriza_OC_detalle
     where Empresa = '${databases[index]}'
       and PONumber = A.PONUMBER
  ) = CAST(GETDATE() AS DATE)
  ${skipCondition}
order by A.PONUMBER, B.PORLREV;
`;
```

**Existing redundant POSTED loop check** (`src/controller/PortalOC_Creator.js:215-227`):
```javascript
    // 4.1) Comprobar si ya existe en fesaOCFocaltec
    const checkSql = `
      SELECT idFocaltec
      FROM fesa.dbo.fesaOCFocaltec
      WHERE ocSage    = '${po.external_id}'
        AND idDatabase= '${databases[index]}'
        AND idFocaltec IS NOT NULL
        AND status = 'POSTED'
    `;
    const { recordset: existing } = await runQuery(checkSql, 'FESA');
    if (existing.length > 0) {
      logGenerator(logFileName, 'warn', `[WARN] PO ${po.external_id} ya procesada (POSTED), se omite.`);
      continue;
    }
```

**Cross-DB fully-qualified ref pattern** (CONTEXT D-02 reference; visible in lines 217-219 above and `src/scripts/po-upload.js:259-266`): `fesa.dbo.fesaOCFocaltec` referenced from inside a query that runs against tenant DB context — already used; new OUTER APPLY uses same pattern.

**What to replicate (the rewrite shape):**
- Keep all SELECT columns and JOINs unchanged (lines 50-174)
- Add OUTER APPLY block AFTER the last `left outer join` (after line 174), BEFORE `where`:
  ```javascript
  ${buildErrorStatsApply({ fesaTable: 'fesa.dbo.fesaOCFocaltec', joinKey: 'A.PONUMBER', dbAlias: databases[index] })}
  ```
- Replace lines 179-184 (the `MAX(Fecha) = CAST(GETDATE() AS DATE)` subquery) with `buildScopeWhere(config.retry)` interpolation that produces sargable `Fecha >= DATEFROMPARTS(...) AND Fecha < DATEADD(month, 1, ...)` (REQ RETRY-01)
- Add POSTED `NOT EXISTS` to WHERE (after the scope filter, before `${skipCondition}`):
  ```sql
  AND NOT EXISTS (
    SELECT 1 FROM fesa.dbo.fesaOCFocaltec
    WHERE ocSage = A.PONUMBER
      AND idDatabase = '${databases[index]}'
      AND status = 'POSTED'
  )
  ```
- After `runQuery(...)` (line 192), insert JS post-filter loop using `computeBackoffWaitMinutes(row.errorCount, config.retry.backoff)` to filter out ERROR rows still inside backoff window — log per-row `[BACKOFF-DEFER] PO ${id} tenant=${db} attempts=${n} nextEligibleAt=${ts}` (CONTEXT D-13)
- Log summary `[BACKOFF] tenant=${db} candidates=${X} deferred=${Y} processing=${Z}` BEFORE the upload loop
- **Remove lines 215-227** entirely (the redundant in-loop POSTED check) — POSTED is now filtered in the WHERE (REQ RETRY-06)

**What to vary:**
- Per CLAUDE.md §6 #2 (`runQuery` default trap): the FESA queries inside the loop already pass `'FESA'` explicit — preserve this. The `runQuery(sql, databases[index])` on line 192 must NOT change (still tenant-DB)
- Per CLAUDE.md §6 #1 (template-literal SQL pattern is the established codebase pattern): do NOT migrate to parameterized queries; new interpolations come from range-guarded envs (safe per SPEC Constraints)
- Imports: add `const { buildScopeWhere, buildErrorStatsApply, computeBackoffWaitMinutes } = require('../utils/RetryPolicy');` near existing utility imports (after line 18)

---

### EDIT-rewrite — `src/controller/PortalPaymentController.js` (controller, cron uploader)

**Analog:** Self — existing WHERE in `src/controller/PortalPaymentController.js:60-100`. Pattern extension mirrors PortalOC_Creator.js exactly per CONTEXT D-04/D-05.

**Existing WHERE pattern** (`src/controller/PortalPaymentController.js:62-99`):
```sql
    FROM APBTA B
    JOIN BKACCT BK ON B.IDBANK    = BK.BANK
    JOIN APTCR   P  ON B.PAYMTYPE  = P.BTCHTYPE
        AND B.CNTBTCH   = P.CNTBTCH
    WHERE B.PAYMTYPE   = 'PY'
        AND B.BATCHSTAT  = 3
        AND P.ERRENTRY   = 0
        AND P.RMITTYPE   = 1
        AND P.AUDTDATE   >= ${currentDate}
        AND P.DOCNBR NOT IN (
    SELECT NoPagoSage
        FROM fesa.dbo.fesaPagosFocaltec
        WHERE idCia       = P.AUDTORG
            AND NoPagoSage  = P.DOCNBR
    )
    ...
    -- Filtro para solo procesar pagos con al menos 60 minutos de antigüedad
    AND DATEDIFF(MINUTE, ..., SYSDATETIME()) >= 60
```

**Join key for fesaPagosFocaltec** (verified at `src/controller/PortalPaymentController.js:71-76` and `:327-329`): the join key is `NoPagoSage = P.DOCNBR` (from existing pattern). For `buildErrorStatsApply` call: `joinKey: 'P.DOCNBR'`, `dbAlias: database[index]`. The fesaPagosFocaltec table uses `idCia` (not `idDatabase`) as the DB-discriminator column — see line 75 + line 330. **Planner must confirm:** does `buildErrorStatsApply` parameterize the column name? Likely needs `dbColumn: 'idCia'` for payments and `dbColumn: 'idDatabase'` for POs. (CONTEXT mentions ocSage/idDatabase for POs only; payments use NoPagoSage/idCia. Planner discretion to either add the param or have separate apply-builder.)

**What to replicate:**
- Replace line 70 (`AND P.AUDTDATE >= ${currentDate}`) with `AND ${buildScopeWhere(config.retry, { dateField: 'P.AUDTDATE' })}` — the helper accepts a field-name option (planner discretion per CONTEXT D-Discretion)
- Add OUTER APPLY block before the `WHERE` line (after line 65 `JOIN APTCR P ON ...`):
  ```javascript
  ${buildErrorStatsApply({ fesaTable: 'fesa.dbo.fesaPagosFocaltec', joinKey: 'P.DOCNBR', dbAlias: database[index], dbColumn: 'idCia' })}
  ```
- Keep lines 71-76 (existing `NOT IN` POSTED dedupe) — already correct per CONTEXT D-03 ("Pagos — mantener el patrón actual (ya correcto), solo ajustar para el nuevo scope")
- Keep lines 86-98 (60-min antiquity filter) verbatim — REQ RETRY-02 boundary explicitly excludes this from changes
- After `runQuery` (line 102), insert JS post-filter loop with `computeBackoffWaitMinutes` — same as PortalOC_Creator (CONTEXT D-13)
- Log per-row `[BACKOFF-DEFER]` and summary `[BACKOFF]` — identical format to PortalOC_Creator

**What to vary:**
- Variable name is `database[index]` (singular `database`) in PortalPaymentController vs `databases[index]` (plural) in PortalOC_Creator — note the inconsistency, do not "fix" it (out of scope)
- The `currentDate` JS variable on line 19 (`getCurrentDateCompact()`) becomes vestigial after the rewrite; remove it (and its usage on line 70)
- Imports: add `const { buildScopeWhere, buildErrorStatsApply, computeBackoffWaitMinutes } = require('../utils/RetryPolicy');` after line 8

---

### EDIT-extend — `src/utils/EmailSender.js` (utility, mailer)

**Analog:** `src/utils/AdminEmailSender.js` — direct template for `sendOperatorReport` shape (CONTEXT D-06 explicitly: "Mirrors `AdminEmailSender.sendAdminAlert(subject, html, callerLogFile)` shape exactly")

**Why this analog:** Symmetric shape across the two senders is the v2.3 quick-260502-i7l pattern (PATTERNS.md §S-6 third-use trigger context). After this extension: `EmailSender` exports `{sendMail, sendOperatorReport}`; `AdminEmailSender` exports `{sendAdminAlert, findLastOpenStep}` — identical shape principle.

**Full shape to mirror** (`src/utils/AdminEmailSender.js:34-59`):
```javascript
async function sendAdminAlert(subject, html, callerLogFile) {
    const logFile = callerLogFile || 'AdminEmailSender';
    try {
        const transportConfig = {
            host: config.mailing.server,
            port: config.mailing.port,
            secure: config.mailing.ssl,
        };
        if (config.mailing.password) {
            transportConfig.auth = {
                user: config.mailing.from,
                pass: config.mailing.password,
            };
        }
        const transport = nodemailer.createTransport(transportConfig);
        await transport.sendMail({
            from: config.mailing.from,
            to: config.license.adminEmail,
            subject,
            html,
        });
        logGenerator(logFile, 'info', '[ADMIN-EMAIL] Sent to ' + config.license.adminEmail + ': ' + subject);
    } catch (err) {
        logGenerator(logFile, 'warn', '[ADMIN-EMAIL] Failed to send admin alert: ' + err.message);
    }
}
```

**Existing transport-config pattern in EmailSender.js** (`src/utils/EmailSender.js:16-31`):
```javascript
    const host = config.mailing.server;
    const port = config.mailing.port;
    const secure = config.mailing.ssl;

    const transportConfig = {
        host,
        port,
        secure,
    };
    if (config.mailing.password) {
        transportConfig.auth = {
            user: config.mailing.from,
            pass: config.mailing.password
        };
    }
```

**What to replicate (in NEW `sendOperatorReport` function added to EmailSender.js):**
- Function signature: `async function sendOperatorReport({ subject, html, callerLogFile })` (object-arg, NOT positional — REQ EOM-06 / CONTEXT D-06 spec)
- `const logFile = callerLogFile || 'EmailSender';` — same fallback pattern
- Reuse the same `transportConfig` block (lines 16-31 of existing file). Do NOT duplicate — refactor into a private `buildTransportConfig()` helper if planner prefers, OR copy-paste verbatim (CONTEXT §code_context "EmailSender" notes Phase 20 leaves it at 2 callers → does NOT trigger the §S-6 third-use rule; copy-paste is acceptable)
- `to: config.mailing.notices.join(',')` — full list (REQ EOM-02 + CONTEXT D-06 explicitly: "lista completa, no `notices[position]`")
- `cc: config.mailing.cc` — array form fine (existing line 39 also uses array)
- Subject + html passed through verbatim
- Log success: `logGenerator(logFile, 'info', '[OPERATOR-EMAIL] Sent to ' + ... + ': ' + subject);` — `[OPERATOR-EMAIL]` is the analog of `[ADMIN-EMAIL]` (different prefix to distinguish channels in grep)
- Log failure: `logGenerator(logFile, 'warn', '[OPERATOR-EMAIL] Failed: ' + err.message);` — swallow per CONTEXT §code_context "SMTP error budget"
- **Do NOT throw** on SMTP failure (REQ EOM-06 + AdminEmailSender contract)

**What to vary:**
- `module.exports = { sendMail, sendOperatorReport };` — add the new export, keep existing `sendMail` untouched (REQ EOM-06)
- `from` reads from `config.mailing.from` (already used by sendMail at line 42)
- Body is full HTML from `buildEomEmailHtml(...)` — no extra wrapping

---

### EDIT-modify — `src/background.js` (orchestrator, forResponse)

**Analog:** Self — the existing `withStepTimeout`-wrapped step block at `src/background.js:40-77` is the structural pattern for the new EOM gate insertion.

**Existing step block pattern** (`src/background.js:40-77`):
```javascript
            {
                const __step = 'buildProviders';
                let __stepError = null;
                try {
                    if (emitter && operationId) {
                        emitter.startStep('background-cycle', __step, tenantIds[i]);
                        emitter.emitProgress(operationId, {
                            type: 'progress',
                            operation: 'background-cycle',
                            tenant: tenantIds[i],
                            step: __step,
                            message: `Iniciando buildProvidersXML para tenant ${i}`,
                            timestamp: new Date().toISOString(),
                        });
                    }
                    logGenerator(logFileName, 'info', `[START] Iniciando buildProvidersXML para el índice ${i}`);
                    // ROOT-03 (D-12): per-step timeout via Promise.race wrapping.
                    await withStepTimeout(buildProvidersXML(i), config.schedule.stepTimeoutMs, `step=${__step} tenant=${tenantIds[i]}`);
                    logGenerator(logFileName, 'info', `[COMPLETE] buildProvidersXML completado para el índice ${i}`);
                } catch (stepErr) {
                    __stepError = stepErr.message || String(stepErr);
                    if (/Step timeout/.test(__stepError)) {
                        logGenerator(logFileName, 'error',
                            `[TIMEOUT] step=${__step} tenant=${tenantIds[i]} url=n/a ` +
                            `durationMs=${config.schedule.stepTimeoutMs} err=${__stepError}`);
                    }
                    throw stepErr; // re-throw so the EXISTING tenant-level try/catch at background.js:145 still fires
                } finally {
                    if (emitter && operationId) {
                        emitter.endStep('background-cycle', __step, tenantIds[i], { error: __stepError });
                    }
                }
            }
```

**`forResponse` entry / pre-loop placement** (`src/background.js:28-40`):
```javascript
async function forResponse(options = {}) {
    const { operationId = null, emitter = null } = options;
    const logFileName = 'ForResponse';
    const date = getCurrentDate();
    const delay = config.schedule?.operationDelayMs ?? 5000;
    logGenerator(logFileName, 'info', `[START] Inicio del proceso forResponse a las ${date.toISOString()}`);

    const tenantIds = config.portal.tenants.map(t => t.id);
    for (let i = 0; i < tenantIds.length; i++) {
        try {
            logGenerator(logFileName, 'info', `[INFO] Procesando tenant con índice ${i}`);

            {
                const __step = 'buildProviders';
                ...
```

**What to replicate (the EOM gate insertion):**
- Insert the EOM gate AFTER line 35 (`logGenerator [START]`) and BEFORE line 36 (`for let i = ...`) — at the **top before the tenant loop** (CONTEXT D-11)
- Wrap the entire EOM dispatch in a `withStepTimeout` block matching the existing 7-step shape:
  ```javascript
  // EOM-01 (D-11): cron-tick guard for end-of-month operator email.
  // Runs BEFORE the tenant loop so a slow EOM query doesn't block the rest of the tick.
  if (config.eom.notificationEnabled) {  // EOM-05 short-circuit
      const __step = 'eomDispatch';
      try {
          await withStepTimeout(
              dispatchEomIfDue(date),
              config.schedule.stepTimeoutMs,
              `step=${__step}`
          );
      } catch (stepErr) {
          const __stepError = stepErr.message || String(stepErr);
          if (/Step timeout/.test(__stepError)) {
              logGenerator(logFileName, 'error',
                  `[TIMEOUT] step=${__step} tenant=global url=n/a ` +
                  `durationMs=${config.schedule.stepTimeoutMs} err=${__stepError}`);
          }
          // Do NOT throw — EOM failure must not block the cron tick
          logGenerator('EomNotification', 'error', `[EOM-DISPATCH] Failed: ${__stepError}`);
      }
  }
  ```
- The internal `dispatchEomIfDue(now)` function (defined alongside or imported from `EomNotification.js` orchestrator) does:
  1. Check `shouldDispatchEom(now, posSentinelPath, config.eom)` and `shouldDispatchEom(now, paymentsSentinelPath, config.eom)` (one per category — CONTEXT D-08)
  2. For each true gate: query control table for pending rows (using `buildScopeWhere({scope: 'current_month'})` HARDCODED per CONTEXT D-09), build HTML via `buildEomEmailHtml`, call `sendOperatorReport`, on failure call `sendAdminAlert` (REQ EOM-04 fallback), write sentinel via `writeSentinelAtomically` SIEMPRE (success or fail per REQ EOM-04)
  3. Log per CONTEXT D-14 — entries: `[EOM-GATE]`, `[EOM-DISPATCH]`, `[EOM-SENTINEL]`, `[EOM-SKIP]` to `logs/sageconnect/{date}/EomNotification.log` (via `logGenerator('EomNotification', ...)`)

**What to vary:**
- The EOM gate uses `tenant=global` in the [TIMEOUT] log line (no per-tenant context)
- EOM failure must NOT re-throw (vs the per-tenant step blocks which DO re-throw to the outer try/catch at line 145) — EOM is best-effort, the cron tick must continue
- Do NOT add EOM to the `stepProgress` array (it's a pre-loop gate, not a per-tenant step)
- Imports to add at top of file: `const { shouldDispatchEom, buildEomEmailHtml, writeSentinelAtomically, readSentinelPayload } = require('./utils/EomNotification');` and `const { sendOperatorReport } = require('./utils/EmailSender');` and `const { sendAdminAlert } = require('./utils/AdminEmailSender');`

---

### EDIT-modify — `src/scripts/po-cron-diagnostic.js` (script, diagnostic)

**Analog:** Self — the existing Section 4 cron WHERE replica at lines 154-185 IS the pattern; it must be updated in-place to match the new cron WHERE.

**Existing Section 4 (cron WHERE replica)** (`src/scripts/po-cron-diagnostic.js:154-185`):
```javascript
    // 4. Replica del WHERE del cron — devuelve cuantas filas levantaria
    console.log('\n4. EL WHERE DEL CRON LA LEVANTARIA HOY? (replica exacta)');
    const skipCondition = skipIdentifiers.length > 0
        ? `AND B.[LOCATION] NOT IN (${skipIdentifiers.map(id => `'${id}'`).join(',')})`
        : '';
    const r4 = await safeRun('cron WHERE replica', async () => {
        const sql = `
            SELECT COUNT(*) AS RowsCronWouldSee
            FROM ${database}.dbo.POPORH1 A
            LEFT OUTER JOIN ${database}.dbo.POPORL B
              ON A.PORHSEQ = B.PORHSEQ
            LEFT OUTER JOIN Autorizaciones_electronicas.dbo.Autoriza_OC X
              ON A.PONUMBER = X.PONumber
            WHERE A.PONUMBER = '${poNumber}'
              AND X.Autorizada = 1
              AND X.Empresa = '${database}'
              AND (
                SELECT MAX(Fecha)
                  FROM Autorizaciones_electronicas.dbo.Autoriza_OC_detalle
                 WHERE Empresa = '${database}'
                   AND PONumber = A.PONUMBER
              ) = CAST(GETDATE() AS DATE)
              ${skipCondition}
        `;
        const { recordset } = await runQuery(sql, database);
        console.table(recordset);
        return recordset;
    });
```

**Existing safeRun pattern** (`src/scripts/po-cron-diagnostic.js:38-46`):
```javascript
async function safeRun(label, fn) {
    try {
        return await fn();
    } catch (err) {
        console.log(`[!] ${label} -> ERROR: ${err.message}`);
        logGenerator(LOG_FILE, 'error', `${label}: ${err.message}`);
        return { __error: err.message };
    }
}
```

**Existing Section 6 verdict block** (`src/scripts/po-cron-diagnostic.js:216-234`):
```javascript
    // 6. Verdict
    if (!verdict.reason) {
        if (verdict.fesaStatus === 'POSTED') {
            verdict.reason = 'Ya esta POSTED en fesaOCFocaltec — el cron la salta correctamente';
        } else if (verdict.cronWouldMatch === false) {
            ...
```

**What to replicate:**
- **Section 4 in-place rewrite** (CONTEXT D-no-historical): replace lines 159-176 with the new WHERE shape using `buildScopeWhere(config.retry)`, `buildErrorStatsApply(...)`, and `NOT EXISTS POSTED`. Reuse imports: `const { buildScopeWhere, buildErrorStatsApply, computeBackoffWaitMinutes } = require('../utils/RetryPolicy');` (CONTEXT D-05 single-source-of-truth)
- **NEW Section 6 (backoff state)**: insert before the existing verdict block (which becomes Section 7 — verdict-priority reordering). Section 6 queries: `SELECT COUNT(*) AS errorCount, MAX(lastUpdate) AS lastErrorAt FROM fesa.dbo.fesaOCFocaltec WHERE ocSage = '${poNumber}' AND idDatabase = '${database}' AND status = 'ERROR'`. Then computes `backoffWaitMin = computeBackoffWaitMinutes(errorCount, config.retry.backoff)` and `nextEligibleAt = lastErrorAt ? new Date(lastErrorAt.getTime() + backoffWaitMin * 60000) : null`. Wrap in `safeRun('backoff state', async () => { ... })` per existing pattern
- Add to `verdict` object at line 73: `errorCount: null, lastErrorAt: null, backoffWaitMin: null, nextEligibleAt: null`
- **Verdict-priority reorder** (REQ RETRY-07 + CONTEXT specifics §1) — replace lines 217-233 with the 5-priority order:
  1. POSTED → "ya está procesada"
  2. ERROR + within backoff → "esperando backoff hasta ${nextEligibleAt}"
  3. ERROR + outside backoff → "lista para reintentar en el próximo tick"
  4. zero rows in fesa → "nunca intentada, debe entrar en el próximo tick"
  5. outside scope → "fuera de RETRY_SCOPE, ignorada"
- Update `console.table` summary at line 268 to include new fields: `errorCount`, `lastErrorAt`, `nextEligibleAt`

**What to vary:**
- This is a SELECT-only diagnostic — NO `--apply` flag needed (HANDOFF.md §6: "Diagnostic scripts that only SELECT are exempt"). Do NOT add the dry-run/apply mechanics.
- The script header comment at line 11 already says "Read-only. No INSERT, no UPDATE, no DELETE." — preserve verbatim.
- Section numbering: keep 1-5 as-is, insert NEW Section 6 (backoff state) BEFORE the existing verdict (which becomes the implicit final verdict block, no number reorder beyond inserting 6).
- Verify with the SPEC RETRY-07 acceptance grep: `grep -nE 'PORHSTAT' src/scripts/po-cron-diagnostic.js` returns 0 matches (heritage from quick-260513-ket — no regression).

---

### EDIT-extend — `src/config.js` (config loader)

**Analog:** Self — the 4 existing timeout-env range guards at `src/config.js:185-208` are the canonical pattern to replicate for the 7 new envs (CONTEXT §code_context "Established Patterns" + SPEC RETRY-03/RETRY-05).

**Existing range-guard pattern (4 examples)** (`src/config.js:185-208`):
```javascript
// REC-01 (D-01): defensive bound — values < 60000 ms (1 min) almost certainly indicate misconfiguration.
if (config.schedule.lockTimeoutMs < 60000) {
    console.error('[CONFIG ERROR] LOCK_TIMEOUT_MS must be >= 60000 (1 min). Got: ' + config.schedule.lockTimeoutMs);
    process.exit(1);
}

// ROOT-01 (D-03): axios timeout puede legitimamente ser sub-segundo en pruebas, pero < 1000ms es signal de misconfig.
if (config.portal.httpTimeoutMs < 1000) {
    console.error('[CONFIG ERROR] PORTAL_HTTP_TIMEOUT_MS must be >= 1000 (1 sec). Got: ' + config.portal.httpTimeoutMs);
    process.exit(1);
}

// ROOT-02 (D-07): mínimo 1 min para evitar misconfigs catastróficas (e.g., 10ms aborta antes de que el exe arranque).
if (config.schedule.childProcessTimeoutMs < 60000) {
    console.error('[CONFIG ERROR] CHILD_PROCESS_TIMEOUT_MS must be >= 60000 (1 min). Got: ' + config.schedule.childProcessTimeoutMs);
    process.exit(1);
}

// ROOT-03 (D-11): mínimo 30s para evitar timeouts triviales que disparen falso positivo en cada cycle.
if (config.schedule.stepTimeoutMs < 30000) {
    console.error('[CONFIG ERROR] STEP_TIMEOUT_MS must be >= 30000 (30 sec). Got: ' + config.schedule.stepTimeoutMs);
    process.exit(1);
}
```

**Existing config-block pattern** (`src/config.js:168-182`):
```javascript
    schedule: {
        cronExpression: process.env.CRON_SCHEDULE || '*/15 * * * *',
        operationDelayMs: parseInt(process.env.OPERATION_DELAY_MS, 10) || 5000,
        // REC-01 (D-01): auto-release timeout for OperationManager locks. Env override: LOCK_TIMEOUT_MS. Default 14 min (~93% of 15 min cron cadence).
        lockTimeoutMs: parseInt(process.env.LOCK_TIMEOUT_MS, 10) || 14 * 60 * 1000,
        // ROOT-02 (D-07): timeout para el child process ImportaFacturasFocaltec.exe.
        // Env override: CHILD_PROCESS_TIMEOUT_MS. Default 10 min (texto literal de REQ ROOT-02).
        // Effective ~10m 30s incluyendo el grace period — comfortably bajo los 14 min del lock auto-release.
        childProcessTimeoutMs: parseInt(process.env.CHILD_PROCESS_TIMEOUT_MS, 10) || 10 * 60 * 1000,
        ...
    },
```

**What to replicate:**
- Add 2 new top-level config namespaces in the config object (after `schedule`, before module.exports):
  ```javascript
  retry: {
      // RETRY-03 (D-RETRY-SCOPE): cron scope for which authorization dates the WHERE picks up.
      // Default 'current_month'. Valid: 'current_month' | 'last_n_days'.
      scope: process.env.RETRY_SCOPE || 'current_month',
      // RETRY-03: lookback window when scope=last_n_days. Default 30. Range [1, 365].
      lookbackDays: parseInt(process.env.RETRY_LOOKBACK_DAYS, 10) || 30,
      backoff: {
          // RETRY-05: initial backoff in minutes. Default 15. Range [1, 60].
          initialMin: parseInt(process.env.RETRY_BACKOFF_INITIAL_MIN, 10) || 15,
          // RETRY-05: backoff multiplier per attempt. Default 2. Range [1.0, 10.0]. parseFloat (acepta decimales).
          multiplier: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER) || 2,
          // RETRY-05: max backoff in minutes (caps the geometric growth). Default 1440 (24h). Range [60, 10080] (1h, 1w).
          maxMin: parseInt(process.env.RETRY_BACKOFF_MAX_MIN, 10) || 1440,
      },
  },
  eom: {
      // EOM-01: hour-of-day when EOM dispatch becomes eligible (last day only). Default 18 (6pm). Range [0, 23].
      notificationHour: parseInt(process.env.EOM_NOTIFICATION_HOUR, 10) || 18,
      // EOM-05: kill-switch. Default 'true'. Set to 'false' to disable EOM dispatch entirely.
      notificationEnabled: (process.env.EOM_NOTIFICATION_ENABLED || 'true').toLowerCase() === 'true',
  },
  ```
- Add 7 new range-guard blocks adjacent to the existing 4 (after line 208):
  ```javascript
  // RETRY-03: scope must be one of the valid values.
  if (!['current_month', 'last_n_days'].includes(config.retry.scope)) {
      console.error('[CONFIG ERROR] RETRY_SCOPE inválido. Got: ' + config.retry.scope + '. Valid: current_month | last_n_days');
      process.exit(1);
  }
  // RETRY-03: lookbackDays in [1, 365].
  if (!Number.isInteger(config.retry.lookbackDays) || config.retry.lookbackDays < 1 || config.retry.lookbackDays > 365) {
      console.error('[CONFIG ERROR] RETRY_LOOKBACK_DAYS must be integer in [1, 365]. Got: ' + config.retry.lookbackDays);
      process.exit(1);
  }
  // RETRY-05: initialMin in [1, 60].
  if (!Number.isInteger(config.retry.backoff.initialMin) || config.retry.backoff.initialMin < 1 || config.retry.backoff.initialMin > 60) {
      console.error('[CONFIG ERROR] RETRY_BACKOFF_INITIAL_MIN must be integer in [1, 60]. Got: ' + config.retry.backoff.initialMin);
      process.exit(1);
  }
  // RETRY-05: multiplier in [1.0, 10.0].
  if (typeof config.retry.backoff.multiplier !== 'number' || !Number.isFinite(config.retry.backoff.multiplier) || config.retry.backoff.multiplier < 1.0 || config.retry.backoff.multiplier > 10.0) {
      console.error('[CONFIG ERROR] RETRY_BACKOFF_MULTIPLIER must be number in [1.0, 10.0]. Got: ' + config.retry.backoff.multiplier);
      process.exit(1);
  }
  // RETRY-05: maxMin in [60, 10080].
  if (!Number.isInteger(config.retry.backoff.maxMin) || config.retry.backoff.maxMin < 60 || config.retry.backoff.maxMin > 10080) {
      console.error('[CONFIG ERROR] RETRY_BACKOFF_MAX_MIN must be integer in [60, 10080]. Got: ' + config.retry.backoff.maxMin);
      process.exit(1);
  }
  // EOM-01: hour in [0, 23].
  if (!Number.isInteger(config.eom.notificationHour) || config.eom.notificationHour < 0 || config.eom.notificationHour > 23) {
      console.error('[CONFIG ERROR] EOM_NOTIFICATION_HOUR must be integer in [0, 23]. Got: ' + config.eom.notificationHour);
      process.exit(1);
  }
  // EOM-05: enabled is boolean (parsed via toLowerCase === 'true' above).
  if (typeof config.eom.notificationEnabled !== 'boolean') {
      console.error('[CONFIG ERROR] EOM_NOTIFICATION_ENABLED must be "true" or "false". Got: ' + process.env.EOM_NOTIFICATION_ENABLED);
      process.exit(1);
  }
  ```

**What to vary:**
- 5 of 7 envs are integers — use `parseInt(..., 10) || default` pattern
- 1 is float — use `parseFloat(...) || default` (multiplier supports `2.5`, `1.5` etc per SPEC RETRY-05 range `[1.0, 10.0]`)
- 1 is boolean — use `(env || 'true').toLowerCase() === 'true'` pattern
- 1 is string-enum — use `process.env.RETRY_SCOPE || 'current_month'` (default) with includes-check guard
- Place all 7 range guards CONSECUTIVELY after the existing 4 (line 208), in the same order as the namespaces (retry first, then eom)

---

### EDIT-extend — `.env.example` (docs, env template)

**Analog:** Self — the existing "Timeouts (v2.3 Scheduler Lock Recovery)" section at `.env.example:79-97` is the template (CONTEXT §code_context line 158).

**Existing section pattern** (`.env.example:79-97`):
```
# ----- Timeouts (v2.3 Scheduler Lock Recovery) -----
# Defense-in-depth invariant: PORTAL_HTTP_TIMEOUT_MS (30s) < STEP_TIMEOUT_MS (5m) < CHILD_PROCESS_TIMEOUT_MS (10m) < LOCK_TIMEOUT_MS (14m)
# Todos opcionales — defaults sensatos en src/config.js si no se setean.
# Range guards fail-fast: si setea valor < min, process.exit(1) con [CONFIG ERROR] al startup.

# Auto-release de locks huérfanos en OperationManager (REC-01)
# Default 14 min ≈ 93% de la cadencia cron de 15 min. Min: 60000 (1 min).
# LOCK_TIMEOUT_MS=840000

# Kill cascade de ImportaFacturasFocaltec.exe (ROOT-02)
# Default 10 min. Min: 60000 (1 min). Dispara SIGTERM → 30s grace hardcoded → taskkill /F /T.
# Solo este timeout dispara email a LICENSE_ADMIN_EMAIL (D-15: evita inbox flood).
# CHILD_PROCESS_TIMEOUT_MS=600000

# Per-step Promise.race en forResponse (ROOT-03)
# Default 5 min. Min: 30000 (30 sec). Wraps 7 step blocks:
# buildProviders, downloadCFDI, checkPayments, uploadPayments,
# createPurchaseOrders, processOrderChanges, closePurchaseOrders.
# STEP_TIMEOUT_MS=300000
```

**What to replicate (new section, append at end of file after line 105):**
```
# ====== PHASE 20 — Retry policy + EOM notification ======
# All 7 vars are optional — defaults sensatos en src/config.js si no se setean.
# Range guards fail-fast: si setea valor inválido, process.exit(1) con [CONFIG ERROR] al startup.
# Customer-locked defaults (CONTEXT D-customer-confirmation): no cambiar sin reabrir conversación.

# Cron scope — qué autorizaciones (POs y pagos) entran al filtro del cron (RETRY-01..03)
# Default 'current_month' (mes calendario corriente). Valid: current_month | last_n_days.
# RETRY_SCOPE=current_month

# Lookback en días cuando RETRY_SCOPE=last_n_days. Default 30. Range [1, 365].
# Solo aplica si RETRY_SCOPE=last_n_days. Ignored cuando scope=current_month.
# RETRY_LOOKBACK_DAYS=30

# Backoff exponencial — espera entre reintentos para POs/pagos en estado ERROR (RETRY-04..05)
# Curva default: 15 → 30 → 60 → 120 → 240 → 480 → 960 → 1440 minutes (8 attempts to cap).
#
# Initial backoff (minutos para el primer reintento). Default 15. Range [1, 60].
# RETRY_BACKOFF_INITIAL_MIN=15
#
# Multiplier por intento (acepta float, e.g. 2.0 = doblar cada vez). Default 2. Range [1.0, 10.0].
# RETRY_BACKOFF_MULTIPLIER=2
#
# Cap en minutos (default 1440 = 24h). Range [60, 10080] = 1h..1w.
# RETRY_BACKOFF_MAX_MIN=1440

# EOM notification — email operador con pendientes último día del mes (EOM-01..05)
# Hour-of-day (0..23) cuando arranca la dispatch eligibility. Default 18 (6pm). Range [0, 23].
# EOM_NOTIFICATION_HOUR=18

# Kill-switch global. Default 'true'. Set 'false' para desactivar la dispatch entera (EOM-05).
# Útil para silenciar el feature sin redeploy.
# EOM_NOTIFICATION_ENABLED=true
```

**What to vary:**
- Use `# ====== PHASE 20 — ... ======` header style (matches `# ====== PORTAL (Focaltec) ======` at line 8)
- Each env block: 1-2 line description + commented-out `# VAR_NAME=default_value` line — match existing pattern exactly
- All 7 envs commented-out (operator opts in, defaults active otherwise)
- Customer-locked-defaults note at top of section (CONTEXT specifics §customer-confirmation lines 175-184) — do NOT change defaults without reopening customer convo
- HANDOFF.md §1 redaction: NO third-party names anywhere in the new section. Use neutral phrasing.

---

## Shared Patterns (cross-cutting)

### `runQuery(query, db)` explicit DB arg discipline (CLAUDE.md §6 #2)

**Source:** `src/utils/SQLServerConnection.js:51-56`
**Apply to:** All new code touching `runQuery` (`RetryPolicy.js` SQL fragments are inert — but the controllers, scripts, and diagnostic that interpolate them MUST pass `db` explicitly)

```javascript
async function runQuery(query, database = config.database.database) {
    const pool = await getPool();
    const request = pool.request();
    const fullQuery = `USE [${database}]; ${query}`;
    return request.query(fullQuery);
}
```

**Discipline:**
- Queries against `fesa.dbo.*` (POSTED check, ERROR count) → pass `'FESA'` as second arg explicit
- Queries against tenant DB schema (`Autoriza_OC*`, `APBTA`, `BKACCT`, `APTCR`, `POPORH1`, etc.) → pass `databases[index]` (or `database[index]` in payments) explicit
- Never rely on the default — PR #16 / PR #19 forensic baseline (CLAUDE.md §6 #2)

---

### Per-module `LOG_FILE` const at top (CLAUDE.md §5)

**Source:** `src/scripts/po-cron-diagnostic.js:30` and CLAUDE.md §5 explicitly
**Apply to:** `RetryPolicy.js`, `EomNotification.js`, `retry-month-pos.js`, `retry-month-payments.js`

```javascript
const LOG_FILE = 'PO_Cron_Diagnostic';
```

**Discipline:**
- `RetryPolicy.js` — pure helpers, no logging — but the consuming controllers/scripts log with their own LOG_FILE
- `EomNotification.js` — accepts `callerLogFile` arg defaulting to `'EomNotification'` (CONTEXT D-14)
- `retry-month-pos.js` — `const LOG_FILE = 'RetryMonthPOs';`
- `retry-month-payments.js` — `const LOG_FILE = 'RetryMonthPayments';`

---

### Template-literal SQL with interpolation (CLAUDE.md §6 #1)

**Source:** `src/controller/PortalOC_Creator.js:50-187` (entire SQL block)
**Apply to:** `RetryPolicy.js` SQL builders, controller WHEREs, diagnostic script Section 4 update

**Discipline:**
- Established codebase pattern — do NOT migrate to parameterized queries (SPEC Constraints + CLAUDE.md §6 #1: "Don't add new sites; when you touch existing ones, parameterize if possible — but Phase 20 explicitly does NOT add new mutated sites with parameters")
- Variables come from range-guarded envs (safe — see `src/config.js:185-208` pattern + new range guards from this phase) or per-tenant `databases[index]` (controlled list, not user input)
- New WHERE additions use the same template-literal style; new RetryPolicy.js SQL builders return template-literal-style strings

---

### Defense-in-depth `withStepTimeout` wrapping (CLAUDE.md §9)

**Source:** `src/utils/duration.js:56-65` (the wrapper) + `src/background.js:40-77` (the call site pattern)
**Apply to:** EOM dispatch in `background.js`

```javascript
await withStepTimeout(buildProvidersXML(i), config.schedule.stepTimeoutMs, `step=${__step} tenant=${tenantIds[i]}`);
```

**Discipline:**
- Wrap the EOM dispatch with `withStepTimeout(promise, config.schedule.stepTimeoutMs, 'step=eomDispatch')` (CONTEXT D-11)
- Sentinel string `'Step timeout'` is **load-bearing** — preserve in error messages (CLAUDE.md §3 + duration.js header comment)
- Defense-in-depth invariant unchanged: axios (30s) < step (5m) < child (10m) < lock (14m)

---

### `safeRun` resilience pattern for diagnostics

**Source:** `src/scripts/po-cron-diagnostic.js:38-46` (also `src/scripts/diagnose-sage-tables.js:31-39`)
**Apply to:** New Section 6 (backoff state) in `po-cron-diagnostic.js`

```javascript
async function safeRun(label, fn) {
    try {
        return await fn();
    } catch (err) {
        console.log(`[!] ${label} -> ERROR: ${err.message}`);
        logGenerator(LOG_FILE, 'error', `${label}: ${err.message}`);
        return { __error: err.message };
    }
}
```

**Discipline:**
- Wrap every new diagnostic SELECT in `safeRun('section-N label', async () => { ... })` so one failure doesn't abort the rest of the diagnostic

---

### `successResult` / `errorResult` envelope shape

**Source:** `src/utils/ResultEnvelope.js:47-63`
**Apply to:** `retry-month-pos.js`, `retry-month-payments.js` return values

```javascript
function successResult(data, summary, { tenant = null, startTime = null } = {}) {
    return createResult(true, { data, errors: [], summary, tenant }, startTime);
}
```

**Discipline:**
- Both new scripts return `successResult(...)` from their main function (HANDOFF.md §6: ResultEnvelope is the contract; `data.mode = 'dry-run'` or `'apply'`)
- Apply summary text matches the convention: `Retry-month-pos ${apply ? 'apply' : 'dry-run'}: ${eligibleCount} eligible, ${deferredCount} deferred (backoff), ${postedCount} posted-skip`

---

### Redaction discipline (HANDOFF.md §1)

**Source:** HANDOFF.md §1 explicit
**Apply to:** All new files — comments, log messages, commit messages, EOM email body

**Discipline:**
- No third-party / prior-integrator names anywhere
- Use neutral phrasing: "the integrator", "third party", "channel partner"
- Pre-commit hook `.claude/hooks/pre-commit-redaction.sh` catches violations — never rely on hook alone
- SPEC Acceptance Criteria explicitly: `grep -nE 'Tersoft' .planning/phases/20-* src/ tests/` returns 0 matches

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `tests/fixtures/eom-email-sample.html` | static fixture | snapshot asset | First fixture in `tests/fixtures/` — directory does not yet exist. Create with deterministic HTML matching SPEC EOM-03 structure. No code analog needed; structure derived from SPEC. |

---

## Metadata

**Analog search scope:**
- `src/utils/` (full directory — 14 files scanned)
- `src/scripts/` (full directory — 19 files scanned, focused on `po-upload.js`, `payment-uuid-repair.js`, `po-cron-diagnostic.js`, `diagnose-sage-tables.js`)
- `src/controller/` (focused on `PortalOC_Creator.js`, `PortalPaymentController.js`)
- `src/background.js` (full file — orchestrator surface)
- `src/config.js` (full file — config loader pattern)
- `tests/` (full tree — 32 test files scanned, focused on `EmailSender.test.js`, `TimezoneHelper.test.js`, `tests/utils/log-generator.test.js`, `tests/controller/Providers_Downloader.xml-error.test.js`, `tests/integration/timeout-logging.test.js`, `tests/SQLServerConnection.test.js`)
- `.env.example` (full file)
- HANDOFF.md (full file — for §1 redaction, §6 dry-run/apply convention table, §7 double-verification)
- CLAUDE.md (full file — for §3 always-on, §5 conventions, §6 pitfalls, §9 defense-in-depth)

**Files scanned:** ~80 files across `src/`, `tests/`, `.planning/`
**Pattern extraction date:** 2026-05-15
