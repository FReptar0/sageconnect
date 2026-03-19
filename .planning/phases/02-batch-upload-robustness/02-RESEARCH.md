# Phase 2: Batch Upload Robustness - Research

**Researched:** 2026-03-12
**Domain:** Batch upload edge-case handling in payment-reconciliation.js (Node.js, Portal batch API)
**Confidence:** HIGH

## Summary

This phase modifies the batch upload section of `src/scripts/payment-reconciliation.js` (lines ~462-586) to address two edge cases: (1) preventing empty batch API requests when `categories.ready` is empty with `--upload` flag, and (2) detecting missing results in the batch API response by comparing `external_id`s sent vs received. Both changes are localized to the upload section of `main()` -- the classification logic (Phase 1) and the `classifyPayments()` function are untouched.

The current upload section already has a working happy path: it slices `categories.ready` by `batchLimit`, builds payment payloads, sends a single batch POST to `POST /api/1.0/batch/tenants/{tenantId}/payments`, iterates results by `result.item?.external_id`, records successes/errors to a control table, and prints a summary. The API spec marks all fields in `BatchResponseExternalPaymentResponse` as required (including `item`), but the spec does NOT guarantee that `results.length === payments.length`. This means some payments could be silently dropped from results -- exactly the gap BTCH-01 addresses.

The implementation is straightforward: an empty-batch guard before the upload section, a Set-based tracker for responded `external_id`s in the results loop, and a post-loop scan of `toUpload` to detect and report missing entries. All patterns (dual logging, counter variables, summary formatting) are already established in the existing code and in Phase 1 conventions.

**Primary recommendation:** Add empty guard immediately after `shouldUpload` check at line 462, then add `Set`-based tracking of responded external_ids inside the results loop, and scan `toUpload` for unmatched entries after the loop. Update the summary format with `Sent` and `Missing` lines.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Despues de procesar el array `results`, iterar `toUpload` para encontrar `external_id`s sin resultado correspondiente
- Pagos sin resultado NO se registran en `fesaPagosFocaltec` -- quedan disponibles para reenvio en la siguiente ejecucion (el API retorna error de duplicado si ya se proceso)
- Log level: `warn` -- es anomalo pero no fatal, el pago sera reintentado
- Formato inline: `[WARN] {external_id} MISSING RESULT -- not in API response` -- mismo nivel de indentacion que las lineas [OK] y [ERROR] existentes
- Dual logging: tanto `console.warn` como `logGenerator(logFileName, 'warn', ...)` -- consistente con patron de Phase 1
- Contador propio `missingCount` separado de `errorCount` -- missing no es lo mismo que un error del API
- Guard antes de la seccion de upload (donde se verifica `shouldUpload`): si `categories.ready.length === 0`, imprimir mensaje info y retornar early
- Mensaje info (no warning): `No payments ready to upload.` -- el reporte ya muestra por que nada esta ready
- No se muestra seccion UPLOAD COMPLETE -- nada fue enviado, nada que resumir
- Dual logging: `console.log` + `logGenerator(logFileName, 'info', ...)` para el evento de empty batch
- En modo REPORT: no mostrar hint `Use --upload to send the N ready payments` cuando `categories.ready.length === 0` -- seria enganoso
- Nueva linea `Sent: N` como primera linea del summary (permite verificar Success + Errors + Missing = Sent)
- Nueva linea `Missing: N` solo cuando `missingCount > 0`
- Formato final del summary:
  ```
  === UPLOAD COMPLETE ===
    Sent:    5
    Success: 3
    Errors:  1
    Missing: 1
    Remaining: 15 (run again to process next batch)
  ```

### Claude's Discretion
- Implementacion exacta del Set/Map para tracking de external_ids respondidos
- Manejo del edge case donde `result.item` es null/undefined (como extraer el external_id)
- Orden de las validaciones dentro del upload section

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BTCH-01 | El script verifica que cada `external_id` enviado en el batch tenga un resultado correspondiente en `results`; pagos sin resultado se reportan como MISSING RESULT | Use a `Set` of responded external_ids built during the results loop. After the loop, iterate `toUpload` and check membership. The API spec does NOT guarantee results array length matches input. `result.item.external_id` is the matching key (spec marks `item` as required). |
| BTCH-02 | El script no envia request batch cuando `categories.ready.length === 0` con flag `--upload` | Insert guard after `shouldUpload` check (line 462). When `categories.ready.length === 0`, log info message and return early. Also suppress the `Use --upload...` hint in REPORT mode when ready count is 0. |
</phase_requirements>

## Standard Stack

### Core (Already in project -- no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | v18 | Runtime | Specified in project CI |
| axios | ^1.7.7 | HTTP client for batch POST | Already used for batch upload |
| winston | ^3.17.0 | Logging via `logGenerator()` | Existing logging layer |
| jest | ^29.7.0 | Unit testing | Existing test framework, 11 passing tests |

### Supporting (Existing utilities -- reuse directly)
| Module | Location | Purpose | When to Use |
|--------|----------|---------|-------------|
| `LogGenerator.js` | `src/utils/` | `logGenerator(fileName, level, message)` | All dual logging |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Set` for tracking responded IDs | `Map` with full result objects | Set is sufficient -- we only need membership check, not result data. Map would be over-engineering. |
| Post-loop scan of `toUpload` | Decrement counter during results loop | Counter approach would tell us HOW MANY are missing but not WHICH ones. The user decision requires reporting specific external_ids. |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
```

## Architecture Patterns

### Current Upload Flow (lines 462-586)
```
1. if (!shouldUpload) { print hint; return }       // line 462-467
2. const toUpload = categories.ready.slice(0, batchLimit)  // line 472
3. Build paymentPayloads from toUpload              // lines 476-508
4. POST batch to portal                              // lines 511-524
5. For each result:                                   // lines 529-571
   a. Find matching entry in toUpload by external_id
   b. If error_code === 0: insert control table, successCount++
   c. Else: log error, errorCount++
6. Print UPLOAD COMPLETE summary                      // lines 581-586
```

### Target Upload Flow (after Phase 2)
```
1. if (!shouldUpload) {
     if (categories.ready.length > 0) print hint    // BTCH-02: suppress hint when empty
     return
   }
2. if (categories.ready.length === 0) {              // BTCH-02: empty guard
     console.log "No payments ready to upload."
     logGenerator(logFileName, 'info', ...)
     return                                           // Skip upload entirely
   }
3. const toUpload = categories.ready.slice(0, batchLimit)
4. Build paymentPayloads from toUpload
5. POST batch to portal
6. const respondedIds = new Set()                     // BTCH-01: tracking
7. For each result:
   a. Extract external_id from result.item?.external_id
   b. respondedIds.add(external_id)                   // BTCH-01: track
   c. [existing success/error processing unchanged]
8. let missingCount = 0                               // BTCH-01: detect missing
   For each entry in toUpload:
     if (!respondedIds.has(entry.hdr.external_id)):
       console.warn "[WARN] {id} MISSING RESULT..."
       logGenerator(logFileName, 'warn', ...)
       missingCount++
9. Print UPLOAD COMPLETE summary with Sent + Missing  // Updated format
```

### Pattern: Set-Based Response Tracking
**What:** Use a `Set` to collect all `external_id`s that appeared in the API response, then scan `toUpload` for any that are missing.
**When to use:** After batch API call completes, before printing summary.
**Why Set:** O(1) lookup for each `toUpload` entry. Simple membership check is all that's needed.
**Example:**
```javascript
// Inside the results loop (after line 529)
const respondedIds = new Set();

for (const result of results) {
    const externalId = result.item?.external_id || 'unknown';
    respondedIds.add(externalId);
    // ... existing success/error logic ...
}

// After results loop, before summary
let missingCount = 0;
for (const entry of toUpload) {
    if (!respondedIds.has(entry.hdr.external_id)) {
        console.warn(`  [WARN] ${entry.hdr.external_id} MISSING RESULT -- not in API response`);
        logGenerator(logFileName, 'warn',
            `Batch upload missing result: ${entry.hdr.external_id} not in API response`
        );
        missingCount++;
    }
}
```

### Pattern: Empty Batch Guard
**What:** Check `categories.ready.length === 0` right after confirming `shouldUpload` is true, before any upload logic.
**When to use:** Between the `shouldUpload` check and the `toUpload` slicing.
**Example:**
```javascript
// Current line 462-467 handles REPORT mode
if (!shouldUpload) {
    if (categories.ready.length > 0) {
        console.log(`\nUse --upload to send the ${categories.ready.length} ready payments to the portal.`);
    }
    return;
}

// NEW: Empty batch guard (BTCH-02)
if (categories.ready.length === 0) {
    console.log('\nNo payments ready to upload.');
    logGenerator(logFileName, 'info', 'Upload skipped: no payments ready to upload');
    return;
}

// Existing upload logic continues from here...
```

### Pattern: Catch-Block Missing Handling
**What:** When the entire batch POST throws an exception (HTTP error, network timeout), ALL payments are effectively missing from results. The current code sets `errorCount = toUpload.length` in the catch block, which is a reasonable fallback.
**When to use:** In the `catch (err)` block at line 573.
**Design decision:** The catch block already treats all payments as errors. We should NOT add missing-result scanning here because no results were received at all. The existing `errorCount = toUpload.length` is the correct behavior for a full-batch failure. The `respondedIds` Set will be empty, so the missing scan should be skipped (or guarded).
**Example:**
```javascript
} catch (err) {
    // ... existing error handling ...
    errorCount = toUpload.length;
    // respondedIds stays empty -- skip missing scan
}

// After try/catch: Only scan for missing if we got partial results
if (respondedIds.size > 0 || (successCount + errorCount > 0 && successCount + errorCount < toUpload.length)) {
    // Missing scan...
}
// OR simpler: always scan -- if respondedIds is empty and errorCount === toUpload.length, no entries will trigger
// because the catch block already accounted for all of them as errors.
```

**Recommended approach:** Always run the missing scan. If the catch block fired, `respondedIds` is empty and every `toUpload` entry will be "missing" -- but we already set `errorCount = toUpload.length`. To avoid double-counting, only run the missing scan if `respondedIds.size > 0` (meaning we got at least partial results). If `respondedIds.size === 0`, it means either (a) the API returned 0 results (anomalous) or (b) catch block fired. Both cases are already handled.

### Anti-Patterns to Avoid
- **Adding missing results to `fesaPagosFocaltec`:** User locked decision -- missing results should NOT be recorded in the control table. They remain eligible for retry on the next run.
- **Using `missingCount` interchangeably with `errorCount`:** They are conceptually different. An error means the API explicitly returned a failure for that payment. A missing result means the API did not return anything for that payment. Keep separate counters.
- **Forgetting to handle `result.item` being null/undefined:** The API spec marks `item` as required, but defensive coding should handle `result.item?.external_id || 'unknown'`. Current code already uses this pattern (line 531).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Response tracking | Array.filter/indexOf for lookup | `Set` with `.has()` | O(1) vs O(n) lookup, cleaner semantics |
| Dual logging | Custom logger or console-only | `logGenerator(logFileName, level, message)` | Consistent with all other logging in the script |

**Key insight:** This phase is purely defensive programming -- adding guards and validation to an already-working upload path. No new external integrations, no new API calls, no new DB operations. The risk is low and the changes are surgical.

## Common Pitfalls

### Pitfall 1: Missing scan runs after catch block with empty respondedIds
**What goes wrong:** If the entire batch POST fails (catch block), `respondedIds` is empty. If the missing scan runs unconditionally, it would report ALL payments as MISSING RESULT, even though they were already counted as errors.
**Why it happens:** The `respondedIds` Set is initialized before the try block but only populated inside the try block.
**How to avoid:** Guard the missing scan with `if (respondedIds.size > 0)` -- only scan for missing results when we actually received partial results from the API.
**Warning signs:** Summary shows both `Errors: 5` (from catch block) and `Missing: 5` (from scan) for the same 5 payments.

### Pitfall 2: The `result.item?.external_id` fallback to 'unknown' taints the Set
**What goes wrong:** If a result has `item: null` or `item.external_id` undefined, `respondedIds.add('unknown')` is called. Then `'unknown'` is in the Set, which doesn't match any real external_id, so no harm. But the actual payment for that result is not tracked, so it would appear as MISSING RESULT.
**Why it happens:** API spec marks `item` as required, but real-world APIs can be surprising.
**How to avoid:** For the `respondedIds` Set, only add non-'unknown' values. Use the actual `result.item?.external_id` and only add if truthy:
```javascript
const externalId = result.item?.external_id;
if (externalId) respondedIds.add(externalId);
```
The existing success/error processing can continue using the `|| 'unknown'` fallback for logging purposes.
**Warning signs:** A payment appears as MISSING RESULT even though the API actually processed it (the result just had a null `item`).

### Pitfall 3: Forgetting to update the REPORT mode hint
**What goes wrong:** When `categories.ready.length === 0` and `shouldUpload` is false, the script still prints `Use --upload to send the 0 ready payments to the portal.` which is misleading.
**Why it happens:** The current hint at line 463-464 only checks `categories.ready.length > 0`, which is already correct. But the user decision explicitly calls this out, so verify the condition is correct.
**How to avoid:** Current code at line 462-466 already has `if (categories.ready.length > 0)` guarding the hint. Verify this is preserved and not accidentally changed.
**Warning signs:** Output says "Use --upload to send the 0 ready payments".

### Pitfall 4: Summary format misalignment
**What goes wrong:** The `Sent:`, `Success:`, `Errors:`, `Missing:` lines don't visually align, making operator verification harder.
**Why it happens:** Different string lengths for labels.
**How to avoid:** Use consistent padding. The CONTEXT.md specifies exact format:
```
  Sent:    5
  Success: 3
  Errors:  1
  Missing: 1
```
Note: `Sent:` has 4 extra spaces, `Success:` has 1, `Errors:` has 2, `Missing:` has 1. This is the user's locked format.
**Warning signs:** Operators can't visually verify `Sent = Success + Errors + Missing`.

### Pitfall 5: `toUpload.length` vs `paymentPayloads.length` discrepancy
**What goes wrong:** Using `paymentPayloads.length` for `Sent` count instead of `toUpload.length`. These should always be equal (one payload per entry), but using `toUpload.length` is more semantically correct as it represents the entries being tracked.
**Why it happens:** Both arrays have the same length since `paymentPayloads = toUpload.map(...)`.
**How to avoid:** Use `toUpload.length` for the `Sent` line since `toUpload` is the source of truth for tracking.

## Code Examples

### Example 1: Complete Empty Guard (BTCH-02)
```javascript
// Source: User decision from CONTEXT.md, adapted to current code structure

// REPORT mode (existing, with guard for empty hint)
if (!shouldUpload) {
    if (categories.ready.length > 0) {
        console.log(`\nUse --upload to send the ${categories.ready.length} ready payments to the portal.`);
    }
    return;
}

// UPLOAD mode: empty guard (NEW - BTCH-02)
if (categories.ready.length === 0) {
    console.log('\nNo payments ready to upload.');
    logGenerator(logFileName, 'info', 'Upload skipped: no payments ready to upload');
    return;
}

// ... existing upload logic continues unchanged ...
```

### Example 2: Response Tracking and Missing Detection (BTCH-01)
```javascript
// Source: User decision from CONTEXT.md + API-SPEC.md for result structure

const respondedIds = new Set();  // Track which external_ids got a response

// Inside try block, within the results loop:
for (const result of results) {
    const externalId = result.item?.external_id;
    if (externalId) {
        respondedIds.add(externalId);
    }
    const displayId = externalId || 'unknown';

    // ... existing success/error processing using displayId ...
}

// After results loop, still inside try block:
let missingCount = 0;
for (const entry of toUpload) {
    if (!respondedIds.has(entry.hdr.external_id)) {
        console.warn(`  [WARN] ${entry.hdr.external_id} MISSING RESULT -- not in API response`);
        logGenerator(logFileName, 'warn',
            `Batch upload missing result: ${entry.hdr.external_id} not in API response`
        );
        missingCount++;
    }
}
```

### Example 3: Updated Summary Format
```javascript
// Source: User decision from CONTEXT.md, exact format specified

console.log(`\n=== UPLOAD COMPLETE ===`);
console.log(`  Sent:    ${toUpload.length}`);
console.log(`  Success: ${successCount}`);
console.log(`  Errors:  ${errorCount}`);
if (missingCount > 0) {
    console.log(`  Missing: ${missingCount}`);
}
if (categories.ready.length > batchLimit) {
    console.log(`  Remaining: ${categories.ready.length - batchLimit} (run again to process next batch)`);
}
```

### Example 4: Variable Scoping for missingCount
```javascript
// missingCount must be declared at the same scope as successCount/errorCount
// so it's accessible in the summary section

let successCount = 0;
let errorCount = 0;
let missingCount = 0;           // NEW
const respondedIds = new Set();  // NEW

try {
    const resp = await axios.post(endpoint, { payments: paymentPayloads }, { ... });
    const results = resp.data?.results || [];

    for (const result of results) {
        const externalId = result.item?.external_id;
        if (externalId) respondedIds.add(externalId);
        // ... existing logic ...
    }

    // Missing scan (only when we got at least some results)
    if (respondedIds.size > 0) {
        for (const entry of toUpload) {
            if (!respondedIds.has(entry.hdr.external_id)) {
                // ... warn + log ...
                missingCount++;
            }
        }
    }
} catch (err) {
    // ... existing catch block ...
    errorCount = toUpload.length;
    // respondedIds stays empty, missingCount stays 0
}

// Summary uses all three counters
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No empty batch guard | Guard before upload when `categories.ready` is empty | This phase | Prevents unnecessary API calls and confusing empty summaries |
| Assume all payments get results | Track and report missing results | This phase | Catches silent API failures that would leave payments in limbo |
| Summary shows Success/Errors only | Summary shows Sent/Success/Errors/Missing | This phase | Operator can verify `Sent = Success + Errors + Missing` |

**No deprecated patterns relevant to this phase.**

## Open Questions

1. **Behavior when `result.item` is null/undefined**
   - What we know: API spec marks `item` as required in `BatchResponseExternalPaymentResponse`. Current code already uses `result.item?.external_id` with optional chaining (line 530-531).
   - What's unclear: Whether the real API ever returns results with null `item`. No production evidence either way.
   - Recommendation: Keep defensive coding with optional chaining. Only add to `respondedIds` when `result.item?.external_id` is truthy. This is Claude's discretion per CONTEXT.md. Log the anomalous result if `item` is null so the operator knows something unexpected happened.

2. **Missing scan placement: inside or after try/catch**
   - What we know: The missing scan should only run when partial results were received (not on full failure).
   - What's unclear: Whether to place the scan inside the try block (after the results loop) or after the try/catch.
   - Recommendation: Place inside the try block, guarded by `respondedIds.size > 0`. This way, on full failure (catch block), the scan is automatically skipped. Simpler and more correct than post-try-catch placement with additional guards.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `jest.config.js` |
| Quick run command | `npx jest tests/PaymentReconciliation.test.js -x` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BTCH-01 | After batch upload, missing external_ids reported as MISSING RESULT | unit | `npx jest tests/PaymentReconciliation.test.js -t "BTCH-01" -x` | No -- Wave 0 |
| BTCH-02 | No batch request when categories.ready is empty with --upload | unit | `npx jest tests/PaymentReconciliation.test.js -t "BTCH-02" -x` | No -- Wave 0 |

### Testing Approach
The upload logic lives inside `main()`, which is NOT currently exported. Unlike `classifyPayments()` (extracted in Phase 1 and testable via direct import), the upload section has side effects: it calls `axios.post`, writes to control table via `runQuery`, and prints to console.

**Two approaches for testability:**

1. **Extract upload logic into a testable function** (recommended, same pattern as Phase 1):
   - Extract the upload section (lines 472-586) into an exported function like `uploadBatch(toUpload, categories, batchLimit, options)` that takes the already-classified payments and performs the upload.
   - `main()` calls this function.
   - Tests import `uploadBatch` and mock `axios`, `runQuery`, `logGenerator`.

2. **Test at integration level via main()** (higher friction):
   - Mock ALL dependencies (axios, runQuery, getPendingToPayInvoices, etc.) and call `main()` directly.
   - Requires mocking the entire classification + upload flow, which is more brittle.

**Recommendation:** Approach 1 -- extract the upload logic into a testable function. This is consistent with Phase 1's approach (extracting `classifyPayments`) and keeps tests focused on upload behavior.

### Sampling Rate
- **Per task commit:** `npx jest tests/PaymentReconciliation.test.js -x`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New test describe blocks in `tests/PaymentReconciliation.test.js` for BTCH-01 and BTCH-02
- [ ] Mocks for `axios.post` response (success, partial failure, full failure, missing results)
- [ ] Test fixture helpers for batch response objects (similar to `makePaymentHdr`, `makeInvoice`)
- [ ] Possibly extracting upload logic into an exported function for direct testing

### Specific Test Cases Needed
| Test | Behavior | Fixture |
|------|----------|---------|
| BTCH-02: empty guard | `categories.ready.length === 0` with upload mode -> no API call, info message | Empty ready array |
| BTCH-02: report hint suppressed | `categories.ready.length === 0` without upload mode -> no hint shown | Empty ready array |
| BTCH-01: all results present | Every payment in `toUpload` has matching result -> `missingCount === 0` | 3 payments, 3 results |
| BTCH-01: one result missing | 3 sent, 2 results -> 1 reported as MISSING RESULT | 3 payments, 2 results |
| BTCH-01: multiple missing | 3 sent, 1 result -> 2 reported as MISSING RESULT | 3 payments, 1 result |
| BTCH-01: full failure (catch) | axios.post throws -> errorCount = toUpload.length, no missing scan | 3 payments, error |
| BTCH-01: result.item null | Result has no item.external_id -> payment reported as missing | 1 payment, 1 result with null item |
| Regression: happy path | All succeed -> successCount matches, no missing, no errors | Standard flow |

## Sources

### Primary (HIGH confidence)
- `src/scripts/payment-reconciliation.js` -- Full source read (598 lines), line-by-line analysis of upload section (lines 462-586), current `module.exports = { classifyPayments }`
- `.planning/codebase/API-SPEC.md` -- Batch payment response structure, `results` array fields, `item` marked as required
- `.planning/phases/02-batch-upload-robustness/02-CONTEXT.md` -- User decisions for exact behavior, format, and logging patterns
- `tests/PaymentReconciliation.test.js` -- 11 passing Phase 1 tests, established mock patterns, fixture helpers

### Secondary (MEDIUM confidence)
- `.planning/phases/01-reconciliation-classification/01-RESEARCH.md` -- Phase 1 research establishing patterns for testability (extract function approach), mock patterns
- `src/utils/LogGenerator.js` -- Confirmed `logGenerator(fileName, level, message)` interface, Winston-based dual logging
- `jest.config.js` -- Test configuration: babel-jest transform, testMatch `<rootDir>/tests/**/*.test.js`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new libraries; all are existing and already used in the upload section
- Architecture: HIGH -- Upload section is straightforward imperative code; all insertion points identified with exact line numbers
- Pitfalls: HIGH -- Key pitfalls (catch-block interaction, item null edge case, double-counting, format alignment) identified from direct code reading and API spec analysis
- Testing: MEDIUM -- Test infrastructure is solid (Jest, established mocks, passing Phase 1 tests), but upload logic testability depends on whether we extract a function or test via main(). Extraction approach is recommended but not yet validated.

**Research date:** 2026-03-12
**Valid until:** Stable -- codebase is not fast-moving. Valid for 90+ days unless upload section is modified.
