# Phase 1: Reconciliation Classification - Research

**Researched:** 2026-03-12
**Domain:** Payment reconciliation classification logic (Node.js script, Sage 300 SQL, Portal API)
**Confidence:** HIGH

## Summary

This phase modifies a single file -- `src/scripts/payment-reconciliation.js` (468 lines) -- to add two capabilities to its classification loop (lines 187-283): (1) auto-resolution of missing PROVIDERIDs using the existing `ProviderIdResolver.js` service, and (2) validation that `metadata.provider_id` from portal CFDIs matches the Sage PROVIDERID before classifying a payment as READY TO UPLOAD. A new classification category `provider_mismatch` is introduced alongside the existing four (`ready`, `no_providerid`, `no_uuid`, `not_in_portal`).

All building blocks already exist in the codebase. `resolveProviderIdByExternalId()` from `ProviderIdResolver.js` handles the portal lookup + Sage DB write. The `portalUuidMap` already stores `metadata.provider_id` per UUID. The classification loop uses a `continue`-after-each-check pattern that the new validations must follow. The `PortalPaymentController.js` (lines 129-155) demonstrates the exact pattern for calling the resolver and handling its result -- this phase adapts that pattern for the reconciliation script's different flow (same-run reclassification instead of next-cycle processing).

**Primary recommendation:** Insert auto-resolution between the PROVIDERID-empty check and the invoice fetch, then add provider_id mismatch validation after the portal-presence check and before the "ready" classification. Reuse `resolveProviderIdByExternalId` as-is. Use the existing `portalUuidMap` for provider_id comparison without additional API calls.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Escribir el PROVIDERID resuelto en Sage DB usando `ProviderIdResolver.js` (patron consistente con `PortalPaymentController.js`)
- Auto-resolver en ambos modos (REPORT y --upload) -- la escritura en Sage es beneficiosa siempre
- Despues de auto-resolver exitosamente, el pago debe continuar por TODAS las validaciones restantes (UUID, presencia en portal, match de provider_id) -- no asumir READY automaticamente
- Persistir el PROVIDERID incluso si despues se detecta mismatch -- el ID resuelto es correcto segun el portal; el mismatch es un problema del CFDI
- Si la auto-resolucion falla, reportar con contexto: mostrar el externalId buscado y el motivo del fallo (sin match vs matches multiples)
- TODAS las facturas del pago deben tener `metadata.provider_id` coincidente con el PROVIDERID de Sage para ser READY -- si una falla, todo el pago va a PROVIDER MISMATCH
- CFDI sin `metadata.provider_id` (null o vacio) se trata como mismatch -- no se puede validar, por precaucion se bloquea
- Comparacion case-insensitive -- los ObjectIds son hex y pueden venir con diferente casing entre portal y Sage
- Pagos auto-resueltos que resultan en mismatch se clasifican como PROVIDER MISMATCH (no MISSING PROVIDERID)
- PROVIDER MISMATCH usa formato detallado: external_id, vendor, monto, moneda (como READY), mas lineas indentadas por factura con portal_provider_id vs sage_providerid
- Pagos auto-resueltos exitosamente aparecen en la seccion READY TO UPLOAD normal con marca [AUTO-FIX]
- SUMMARY incluye nueva linea "Provider mismatch: N" como categoria adicional
- SUMMARY incluye nueva linea "Auto-resolved: N" con conteo de pagos auto-resueltos
- Dual logging: auto-resoluciones como `info` y mismatches como `warn` tanto en consola como en log file (logGenerator)

### Claude's Discretion
- Orden exacto de las validaciones dentro del loop de clasificacion
- Formato especifico del mensaje de fallo de auto-resolucion
- Manejo de errores de red durante la auto-resolucion (reintentos, logging)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROV-01 | El script de conciliacion valida que `metadata.provider_id` del CFDI en portal coincida con `PROVIDERID` de Sage antes de clasificar un pago como READY TO UPLOAD | `portalUuidMap` already stores `metadata.provider_id` per UUID (line 72). Comparison is case-insensitive `.toLowerCase()`. New check inserted after portal-presence validation, before "ready" classification. |
| PROV-02 | Pagos con mismatch de `provider_id` se clasifican en nueva categoria PROVIDER MISMATCH con detalle del ID esperado vs encontrado | New `categories.provider_mismatch` array. Report section prints per-invoice detail lines showing `portal_provider_id` vs `sage_providerid`. |
| RSOL-01 | El script de conciliacion auto-resuelve PROVIDERID faltante usando `getProviderByExternalId` con el `provider_external_id` del pago (campo `IDVEND` de Sage) | `resolveProviderIdByExternalId(vendorId, providerExternalId, index, db)` from `ProviderIdResolver.js` already implements this. Returns `true` on success, `false` on failure. |
| RSOL-02 | Si la auto-resolucion encuentra match unico, el pago se reclasifica de MISSING PROVIDERID a READY TO UPLOAD en el mismo ciclo | After successful resolution, re-read the PROVIDERID (or use the known value from `getProviderByExternalId`) and continue through remaining validations instead of pushing to `no_providerid` and calling `continue`. |
</phase_requirements>

## Standard Stack

### Core (Already in project -- no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | v18 | Runtime | Specified in project CI |
| mssql | ^11.0.1 | SQL Server queries via `runQuery()` | Existing DB layer |
| axios | ^1.7.7 | HTTP client for portal API calls | Used by `GetProviders.js` |
| winston | ^3.17.0 | Logging via `logGenerator()` | Existing logging layer |
| dotenv | ^16.4.5 | Environment config | Existing credential loading |

### Supporting (Existing utilities -- reuse directly)
| Module | Location | Purpose | When to Use |
|--------|----------|---------|-------------|
| `ProviderIdResolver.js` | `src/services/` | Lookup provider by externalId + write PROVIDERID to APVENO | Auto-resolution of missing PROVIDERID |
| `GetProviders.js` | `src/utils/` | `getProviderByExternalId()` -- portal API call | Called internally by ProviderIdResolver |
| `LogGenerator.js` | `src/utils/` | `logGenerator(fileName, level, message)` | All logging |
| `TimezoneHelper.js` | `src/utils/` | `getCurrentDateCompact()` | Date formatting |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing `ProviderIdResolver.js` | Inline portal API call + DB write | Would duplicate existing logic; resolver already handles INSERT vs UPDATE, schema discovery, and error handling |
| Storing resolved ID in memory only | Writing to Sage DB immediately | User locked decision: always write to DB. Also enables future runs to find it. |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
```

## Architecture Patterns

### Current Classification Flow (payment-reconciliation.js lines 187-283)
```
For each payment (hdr) in deduped:
  1. Check PROVIDERID empty -> push to no_providerid, continue
  2. Fetch invoices from Sage
  3. Check missing UUIDs -> push to no_uuid, continue
  4. Check all UUIDs in portal -> push to not_in_portal, continue
  5. Push to ready
```

### Target Classification Flow (after Phase 1)
```
For each payment (hdr) in deduped:
  1. Check PROVIDERID empty:
     a. If empty -> attempt auto-resolution via resolveProviderIdByExternalId()
     b. If resolution succeeds -> update hdr.PROVIDERID, mark as auto-resolved, CONTINUE to step 2
     c. If resolution fails -> push to no_providerid with context, continue to next payment
  2. Fetch invoices from Sage
  3. Check missing UUIDs -> push to no_uuid, continue
  4. Check all UUIDs in portal -> push to not_in_portal, continue
  5. NEW: Check provider_id mismatch:
     a. For each invoice, get portal provider_id from portalUuidMap
     b. Compare case-insensitively with hdr.PROVIDERID
     c. If ANY invoice has null/empty provider_id OR mismatched -> push to provider_mismatch, continue
  6. Push to ready (with [AUTO-FIX] tag if auto-resolved)
```

### Pattern: Auto-Resolution with Same-Run Reclassification
**What:** Unlike `PortalPaymentController.js` which writes to DB and defers to next cycle, the reconciliation script resolves AND continues processing in the same run.
**When to use:** When the script runs on-demand (not in a loop) and the user expects to see the resolved payment classified correctly in the same report.
**Key difference from PortalPaymentController pattern:**
```javascript
// PortalPaymentController (line 130-152): resolve, then FILTER OUT, process next cycle
const withoutPid = payments.recordset.filter(r => !r.PROVIDERID || r.PROVIDERID.trim() === '');
for (const r of withoutPid) {
    await resolveProviderIdByExternalId(r.provider_external_id, providerExternalId, index, database[index]);
}
// Then filter them out -- next cycle picks them up

// payment-reconciliation.js (target): resolve, then CONTINUE VALIDATING in same run
if (!providerid) {
    const resolved = await resolveProviderIdByExternalId(hdr.provider_external_id, hdr.provider_external_id.trim(), index, database[index]);
    if (resolved) {
        // Get the provider ID that was written (from getProviderByExternalId result)
        // Update hdr.PROVIDERID or use known value
        // Fall through to continue validations (DO NOT continue/push to no_providerid)
    } else {
        categories.no_providerid.push({ hdr, reason: 'auto-resolution failed: ...' });
        continue;
    }
}
```

### Pattern: Provider ID Mismatch Detection
**What:** After confirming all invoices exist in portal, check that each invoice's `metadata.provider_id` matches the payment's Sage PROVIDERID.
**When to use:** For every payment that passes the portal-presence check.
**Example:**
```javascript
// portalUuidMap already has provider_id stored (line 67-74 of current script)
// portalUuidMap.set(uuid, { folio, serie, total, currency, provider_id: item.metadata?.provider_id })

const mismatchDetails = [];
const sageProviderId = providerid.toLowerCase(); // hdr.PROVIDERID trimmed and lowercased

for (const inv of invoices.recordset) {
    const uuid = inv.UUID.trim().toUpperCase();
    const portalItem = portalUuidMap.get(uuid);
    const portalProviderId = (portalItem?.provider_id || '').trim().toLowerCase();

    if (!portalProviderId || portalProviderId !== sageProviderId) {
        mismatchDetails.push({
            invoice: inv.invoice_external_id,
            uuid,
            portal_provider_id: portalItem?.provider_id || '(empty)',
            sage_providerid: providerid
        });
    }
}

if (mismatchDetails.length > 0) {
    categories.provider_mismatch.push({
        hdr,
        invoices: invoices.recordset,
        mismatchDetails,
        wasAutoResolved: !!autoResolvedSet.has(hdr.external_id)
    });
    continue;
}
```

### Anti-Patterns to Avoid
- **Re-querying Sage for PROVIDERID after resolution:** The resolver writes to DB but the value is known from the `getProviderByExternalId` call. Either (a) capture the resolved ID from the resolver's return or (b) call `getProviderByExternalId` directly (which the resolver calls internally) to get the `provider.id` value. Do NOT issue an extra SQL query to APVENO just to re-read the value.
- **Using `continue` after successful auto-resolution:** The whole point of same-run reclassification is that a resolved payment falls through to subsequent checks. A `continue` would skip the remaining validations.
- **Case-sensitive comparison of provider IDs:** The IDs are MongoDB ObjectIds (hex strings) that may come in different casing from portal vs Sage. Always normalize with `.toLowerCase()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Provider lookup by externalId | Custom axios call to providers API | `getProviderByExternalId(index, externalId)` from `GetProviders.js` | Handles pagination, exact matching, ambiguity detection, error logging |
| Writing PROVIDERID to APVENO | Custom SQL INSERT/UPDATE | `resolveProviderIdByExternalId(vendorId, externalId, index, db)` from `ProviderIdResolver.js` | Handles existing row check, INSERT vs UPDATE, schema discovery, audit fields |
| Log file writing | Direct `fs.appendFile` or `console.log` only | `logGenerator(logFileName, level, message)` | Maintains Winston log format, date-based directory structure |

**Key insight:** Every external integration needed for this phase already exists as a tested, production-used utility. The phase is purely about orchestration logic in the classification loop -- no new external calls or DB operations need to be invented.

## Common Pitfalls

### Pitfall 1: ProviderIdResolver returns boolean, not the resolved ID
**What goes wrong:** `resolveProviderIdByExternalId()` returns `true`/`false`, not the provider ID string. After successful resolution, you need the actual provider ID value for the mismatch check.
**Why it happens:** The resolver was designed for `PortalPaymentController` which defers to next cycle (doesn't need the ID immediately).
**How to avoid:** Two approaches:
  - (Recommended) Call `getProviderByExternalId(index, hdr.provider_external_id.trim())` BEFORE calling the full resolver, capture `provider.id`, then call the resolver for the DB write. This avoids modifying existing modules.
  - (Alternative) Modify `resolveProviderIdByExternalId` to return the provider ID string on success (but this changes the existing interface used by `PortalPaymentController`).
**Warning signs:** After auto-resolution, `hdr.PROVIDERID` is still empty because it was read from the original SQL query -- the DB was updated but the in-memory object was not.

### Pitfall 2: Forgetting to update in-memory PROVIDERID after resolution
**What goes wrong:** The SQL query already ran. `hdr.PROVIDERID` is empty in the JavaScript object. The resolver writes to DB but does not update the JS object. If you later check `hdr.PROVIDERID` for mismatch comparison, it's still empty.
**Why it happens:** The in-memory `deduped` array was populated from the original SQL query before resolution.
**How to avoid:** After successful resolution, explicitly set `hdr.PROVIDERID = resolvedId` (or a local variable) before continuing to subsequent validation steps. Alternatively, use a dedicated variable like `effectiveProviderId` that starts from `hdr.PROVIDERID` and gets updated on resolution.
**Warning signs:** Auto-resolved payments always end up in `provider_mismatch` because the comparison uses the empty original value.

### Pitfall 3: metadata.provider_id is the PDP internal ID, not the externalId
**What goes wrong:** Comparing `metadata.provider_id` against the wrong field.
**Why it happens:** Confusion between `provider_id` (PDP internal ObjectId like `"6046b54e8d2c344452f7346e"`) and `provider_external_id` (ERP ID like `"534-0039"`).
**How to avoid:** Per API spec and CONTEXT.md: `metadata.provider_id` is the PDP internal ID. PROVIDERID in Sage APVENO is also the PDP internal ID (written by `ProviderIdResolver.js` which gets `provider.id` from the portal). So the comparison is correct: `metadata.provider_id` === PROVIDERID. Both are PDP ObjectIds.
**Warning signs:** IDs look like MongoDB ObjectIds (`"6046b54e8d2c344452f7346e"`) -- this confirms they are PDP internal IDs and the comparison is correct.

### Pitfall 4: portalUuidMap key casing
**What goes wrong:** UUID lookup fails because of casing mismatch.
**Why it happens:** `portalUuidMap` keys are set as `.toUpperCase()` (line 67). Invoice UUIDs from Sage are also uppercased in the existing portal-presence check (line 266). But the lookup must be consistent.
**How to avoid:** Always use `.trim().toUpperCase()` when looking up in `portalUuidMap`, matching the existing pattern.
**Warning signs:** Invoices that ARE in portal show as "not in portal" -- indicates casing mismatch in map lookup.

### Pitfall 5: Report section ordering must match category processing
**What goes wrong:** SUMMARY counts don't add up, or report sections are missing.
**Why it happens:** Adding `provider_mismatch` category but forgetting to add its report section, or forgetting to include it in the SUMMARY total.
**How to avoid:** Checklist: (1) Add category to `categories` object, (2) Add report section after NOT IN PORTAL, (3) Add SUMMARY line, (4) Update `totalProcessed` calculation, (5) Add auto-resolved counter.
**Warning signs:** `TOTAL` in summary doesn't match sum of individual categories.

## Code Examples

### Example 1: Categories Object (updated)
```javascript
// Source: Current code line 180-185, extended
const categories = {
    ready: [],
    no_providerid: [],
    no_uuid: [],
    not_in_portal: [],
    provider_mismatch: []  // NEW
};
let autoResolvedCount = 0;  // NEW: track auto-resolved payments
```

### Example 2: Auto-Resolution Block (insert at current line 192, replacing current no_providerid push)
```javascript
// Current code checks: if (!providerid) { push to no_providerid; continue; }
// Replace with:
if (!providerid) {
    const vendorId = hdr.provider_external_id ? hdr.provider_external_id.trim() : '';
    if (!vendorId) {
        categories.no_providerid.push({
            hdr,
            rfc,
            reason: 'no PROVIDERID and no IDVEND to resolve'
        });
        continue;
    }

    // Attempt auto-resolution
    console.log(`  [INFO] Attempting auto-resolve PROVIDERID for vendor ${vendorId} (payment ${hdr.external_id})...`);
    const provider = await getProviderByExternalId(index, vendorId);

    if (provider && provider.id) {
        // Write to Sage DB
        const writeOk = await resolveProviderIdByExternalId(
            vendorId, vendorId, index, database[index]
        );
        if (writeOk) {
            providerid = provider.id;  // Use resolved ID for subsequent checks
            autoResolvedCount++;
            logGenerator(logFileName, 'info', `Auto-resolved PROVIDERID for ${hdr.external_id}: ${provider.id}`);
        } else {
            categories.no_providerid.push({
                hdr,
                rfc,
                reason: `auto-resolution DB write failed for externalId: ${vendorId}`
            });
            continue;
        }
    } else {
        // getProviderByExternalId already logs the specific reason (no match / multiple matches)
        categories.no_providerid.push({
            hdr,
            rfc,
            reason: `auto-resolution failed for externalId: ${vendorId}`
        });
        logGenerator(logFileName, 'warn', `Auto-resolution failed for ${hdr.external_id}, externalId: ${vendorId}`);
        continue;
    }
}
```

### Example 3: Provider Mismatch Check (insert after portal-presence check, before ready push)
```javascript
// After: if (!allInPortal) { ... continue; }
// Before: categories.ready.push(...)

// Check provider_id match for all invoices
const mismatchDetails = [];
const sageProviderId = providerid.toLowerCase();

for (const inv of invoices.recordset) {
    const uuid = inv.UUID.trim().toUpperCase();
    const portalItem = portalUuidMap.get(uuid);
    const portalProviderId = (portalItem?.provider_id || '').trim().toLowerCase();

    if (!portalProviderId || portalProviderId !== sageProviderId) {
        mismatchDetails.push({
            invoice_external_id: inv.invoice_external_id,
            portal_provider_id: portalItem?.provider_id || '(empty)',
            sage_providerid: providerid
        });
    }
}

if (mismatchDetails.length > 0) {
    categories.provider_mismatch.push({
        hdr,
        invoices: invoices.recordset,
        mismatchDetails
    });
    logGenerator(logFileName, 'warn',
        `Provider mismatch for ${hdr.external_id}: ${mismatchDetails.length} invoice(s) with mismatched provider_id`
    );
    continue;
}
```

### Example 4: Report Section for PROVIDER MISMATCH
```javascript
// After NOT IN PORTAL section
console.log(`\n--- PROVIDER MISMATCH (${categories.provider_mismatch.length}) ---`);
for (const entry of categories.provider_mismatch) {
    const { hdr, mismatchDetails } = entry;
    const amount = typeof hdr.total_amount === 'number'
        ? hdr.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })
        : hdr.total_amount;
    console.log(`  ${hdr.external_id}  | vendor: ${hdr.provider_external_id} | $${amount} ${hdr.bk_currency}`);
    for (const d of mismatchDetails) {
        console.log(`    - ${d.invoice_external_id}: portal=${d.portal_provider_id} vs sage=${d.sage_providerid}`);
    }
}
```

### Example 5: Updated SUMMARY
```javascript
const totalProcessed = categories.ready.length + categories.no_providerid.length
    + categories.no_uuid.length + categories.not_in_portal.length
    + categories.provider_mismatch.length;
console.log('\n=== SUMMARY ===');
console.log(`  Ready to upload:    ${categories.ready.length}`);
console.log(`  Missing PROVIDERID: ${categories.no_providerid.length}`);
console.log(`  Missing UUID:       ${categories.no_uuid.length}`);
console.log(`  Not in portal:      ${categories.not_in_portal.length}`);
console.log(`  Provider mismatch:  ${categories.provider_mismatch.length}`);
console.log(`  Auto-resolved:      ${autoResolvedCount}`);
console.log(`  TOTAL:              ${totalProcessed}`);
```

### Example 6: READY Section with [AUTO-FIX] Tag
```javascript
// Need to track which payments were auto-resolved
// Use a Set: const autoResolvedSet = new Set();
// After successful resolution: autoResolvedSet.add(hdr.external_id);

console.log(`\n--- READY TO UPLOAD (${categories.ready.length}) ---`);
for (const entry of categories.ready) {
    const { hdr, invoices } = entry;
    const invCount = invoices.length;
    const amount = typeof hdr.total_amount === 'number'
        ? hdr.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })
        : hdr.total_amount;
    const tag = autoResolvedSet.has(hdr.external_id) ? ' [AUTO-FIX]' : '';
    console.log(`  ${hdr.external_id}${tag}  | vendor: ${hdr.provider_external_id} | $${amount} ${hdr.bk_currency} | ${invCount} invoice${invCount > 1 ? 's' : ''} | all UUIDs matched`);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No PROVIDERID auto-resolution in reconciliation | Auto-resolve via ProviderIdResolver (exists in PortalPaymentController since codebase inception) | This phase | Payments that were stuck as MISSING PROVIDERID can now self-heal |
| No provider_id validation | Compare portal metadata.provider_id vs Sage PROVIDERID | This phase | Catches configuration mismatches BEFORE payment upload |
| 4 classification categories | 5 categories (+ PROVIDER MISMATCH) | This phase | More granular reporting for operators |

**No deprecated patterns relevant to this phase.**

## Open Questions

1. **Getting the resolved provider ID without modifying ProviderIdResolver**
   - What we know: `resolveProviderIdByExternalId()` returns boolean. We need the actual ID string for the mismatch check.
   - What's unclear: Whether to call `getProviderByExternalId` separately (extra API call) or modify the resolver to return the ID.
   - Recommendation: Call `getProviderByExternalId()` first to get the provider object, capture `provider.id`, then call `resolveProviderIdByExternalId()` for the DB write. This is one extra API call but avoids changing the existing interface. The alternative -- passing the known provider.id to a modified resolver -- is cleaner but changes an interface used by PortalPaymentController. Claude's discretion per CONTEXT.md.

2. **Network error handling during auto-resolution**
   - What we know: `getProviderByExternalId` already catches errors and returns `null`. `resolveProviderIdByExternalId` catches errors and returns `false`.
   - What's unclear: Whether to retry on transient network errors.
   - Recommendation: Follow existing pattern (single attempt, log error, classify as failed resolution). No retry logic exists anywhere in the codebase -- adding it here would be inconsistent. Claude's discretion per CONTEXT.md.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `jest.config.js` |
| Quick run command | `npx jest --testPathPattern=PaymentReconciliation -x` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RSOL-01 | Auto-resolve missing PROVIDERID using getProviderByExternalId | unit | `npx jest tests/PaymentReconciliation.test.js -t "auto-resolve" -x` | No -- Wave 0 |
| RSOL-02 | Successfully resolved payment reclassified to READY in same run | unit | `npx jest tests/PaymentReconciliation.test.js -t "reclassify" -x` | No -- Wave 0 |
| PROV-01 | Validate metadata.provider_id matches PROVIDERID before READY | unit | `npx jest tests/PaymentReconciliation.test.js -t "mismatch" -x` | No -- Wave 0 |
| PROV-02 | Mismatched payments classified as PROVIDER MISMATCH with detail | unit | `npx jest tests/PaymentReconciliation.test.js -t "mismatch" -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx jest tests/PaymentReconciliation.test.js -x`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/PaymentReconciliation.test.js` -- covers RSOL-01, RSOL-02, PROV-01, PROV-02
- [ ] Mocks for `resolveProviderIdByExternalId`, `getProviderByExternalId`, `runQuery`, `getPendingToPayInvoices`

### Testing Approach Notes
The main challenge is that `payment-reconciliation.js` is a script (not a module with exported functions). The classification logic is inside `main()` which is not exported. Two approaches:

1. **Extract classification logic into a testable function** (recommended): Move the classification loop into an exported function that takes `deduped`, `portalUuidMap`, `index`, `database[index]` and returns `categories` + `autoResolvedCount`. The script's `main()` calls this function. Tests import and test the extracted function with mocked dependencies.

2. **Test via script execution with mocked modules**: Use Jest module mocking to replace `runQuery`, `getProviderByExternalId`, etc., then require the script module. More brittle.

The planner should include extracting the classification logic as a testable function as part of the implementation plan.

## Sources

### Primary (HIGH confidence)
- `src/scripts/payment-reconciliation.js` -- Full source read, line-by-line analysis of classification loop (lines 187-283) and report generation (lines 288-336)
- `src/services/ProviderIdResolver.js` -- Full source read, confirmed `resolveProviderIdByExternalId` returns boolean, writes to APVENO
- `src/utils/GetProviders.js` -- Full source read, confirmed `getProviderByExternalId` returns provider object with `.id` field or `null`
- `src/controller/PortalPaymentController.js` -- Full source read, confirmed pattern for auto-resolution (lines 129-155) uses resolve-then-filter approach
- `.planning/codebase/API-SPEC.md` -- Portal API specification confirming `metadata.provider_id` is PDP internal ID, `ProviderResponse.id` is PDP internal ID

### Secondary (MEDIUM confidence)
- `.planning/codebase/CONVENTIONS.md` -- Coding patterns (camelCase, dual logging, error handling)
- `.planning/codebase/ARCHITECTURE.md` -- System architecture, data flow
- `.planning/codebase/TESTING.md` -- Test framework configuration and patterns
- `.planning/codebase/CONCERNS.md` -- Known issues (SQL injection pattern, connection pooling -- both out of scope)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new libraries; all modules are existing, read, and understood
- Architecture: HIGH -- Classification loop is straightforward sequential logic; all integration points identified with line numbers
- Pitfalls: HIGH -- Key pitfalls (boolean return, in-memory vs DB state, ID type confusion, casing) identified from direct code reading
- Testing: MEDIUM -- Test infrastructure exists (Jest) but the script lacks modularity; extraction of testable function is a recommendation, not a verified pattern

**Research date:** 2026-03-12
**Valid until:** Stable -- codebase is not fast-moving. Valid for 90+ days unless reconciliation script is modified.
