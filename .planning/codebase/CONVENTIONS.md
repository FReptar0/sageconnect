# Coding Conventions

**Analysis Date:** 2026-03-12

## Naming Patterns

**Files:**
- PascalCase for class/controller files: `PortalPaymentController.js`, `TimezoneHelper.js`, `PurchaseOrder.js`
- camelCase for utility/helper files: `parseExternPurchaseOrders.js`, `emailSender.js`
- camelCase for service files: `ProviderIdResolver.js`, `UuidResolver.js`
- All lowercase for special files: `index.js`, `server.js`, `background.js`

**Functions:**
- camelCase for all function names: `getCurrentDate()`, `uploadPayments()`, `resolveProviderIdByExternalId()`
- Verb-first pattern for action functions: `getCurrentDate()`, `validateSagePayment()`, `checkPortalPaymentStatus()`
- get/set/validate/check/resolve/update prefixes for clarity on operation type

**Variables:**
- camelCase for local variables and constants: `currentDate`, `sagePayment`, `vendorId`
- UPPER_SNAKE_CASE for environment-sourced constants: `TENANT_ID`, `API_KEY`, `DATABASE`
- UPPER_SNAKE_CASE for module-level configuration constants: `LOG_FILE`, `TIMEZONE`
- Descriptive names with context: `apiKeys`, `database`, `logFileName`, `testId`

**Types/Schemas:**
- PascalCase for Joi schema objects: `externPurchaseOrderSchema`, `lineItemSchema`, `addressSchema`
- snake_case for database column mappings in payloads: `external_id`, `bank_account_id`, `provider_external_id`
- camelCase for JavaScript object property names: `vendorId`, `providerExternalId`, `providerData`

## Code Style

**Formatting:**
- Uses Babel for transpilation (configured in `babel.config.js`)
- No explicit linter/formatter configured (no ESLint or Prettier config files)
- 4-space indentation observed in source files
- Lines break after 100-120 characters in most files

**Linting:**
- No automated linting enforced
- Manual code review appears to be the quality gate

## Import Organization

**Order:**
1. Core Node.js modules: `const fs = require('fs');`
2. Third-party packages: `const axios = require('axios');`, `const winston = require('winston');`
3. Local utilities: `const { runQuery } = require('../utils/SQLServerConnection');`
4. Local services: `const { resolveProviderIdByExternalId } = require('../services/ProviderIdResolver');`
5. Local models: `const { validateExternPurchaseOrder } = require('../models/PurchaseOrder');`

**Path Aliases:**
- No path aliases configured (uses relative paths like `../utils/`, `../services/`, `../models/`)
- Consistent relative path patterns from file location

## Error Handling

**Patterns:**
- Try-catch blocks wrapping async operations throughout `src/controller/` and `src/services/`
- Error logging via `logGenerator()` utility after catching exceptions
- Console output for critical errors alongside logging: `console.error()` paired with `logGenerator()`
- Functions typically return `false` or error objects on failure instead of throwing
- Graceful fallbacks: See `TimezoneHelper.js` which falls back to local time on invalid timezone
- SQL query errors logged with context about what operation failed

**Example pattern from `ProviderIdResolver.js`:**
```javascript
try {
    const provider = await getProviderByExternalId(index, providerExternalId);
    if (!provider || !provider.id) {
        console.warn(`  [WARN] No se encontró proveedor único en portal...`);
        logGenerator(LOG_FILE, 'warn', `No se encontró proveedor...`);
        return false;
    }
    // ... success path
    return true;
} catch (err) {
    console.error(`  [ERROR] resolveProviderIdByExternalId falló: ${err.message}`);
    logGenerator(LOG_FILE, 'error', `resolveProviderIdByExternalId falló: ${err.message}`);
    return false;
}
```

## Logging

**Framework:** Winston (version 3.17.0) with custom wrapper `logGenerator()`

**Patterns:**
- All logging through `logGenerator(fileName, logLevel, logMessage)` from `src/utils/LogGenerator.js`
- Log levels used: `info`, `warn`, `error`
- File-based logging organized by date: `logs/sageconnect/YYYY-MM-DD/[fileName].log`
- Each file that logs defines `const LOG_FILE = 'ModuleName'` at module level
- Contextual prefixes in messages: `[testId]`, `[AUTO-FIX]`, `[WARN]`, `[ERROR]`
- Both Winston logging AND console output for critical operations (dual logging)
- Timestamp format in logs: `YYYY-MM-DD HH:mm:ss [LEVEL]`

**Example usage:**
```javascript
const LOG_FILE = 'PortalPaymentController';
logGenerator(LOG_FILE, 'info', `Starting payment upload for ${tenantIds[index]}`);
```

## Comments

**When to Comment:**
- JSDoc comments for function definitions with parameters and return types
- Inline comments for complex SQL queries explaining business logic
- Section headers with dashes: `// --------------- SECTION NAME ---------------`
- Column mapping comments in SQL for non-obvious SAGE field mappings

**JSDoc/TSDoc:**
- Multi-line comments above function definitions documenting parameters with types
- Return type documentation included
- Example from `ProviderIdResolver.js`:
```javascript
/**
 * Busca el proveedor en Portal de Proveedores por external_id y escribe su ID en APVENO.
 * @param {string} vendorId - VENDORID de Sage (ej: "534-0039")
 * @param {string} providerExternalId - External ID del proveedor en ERP
 * @param {number} index - Índice del tenant
 * @param {string} db - Base de datos de Sage
 * @returns {Promise<boolean>} - true si se escribió el PROVIDERID
 */
```

## Function Design

**Size:** Functions range from 10-50 lines for utilities, up to 100+ lines for complex controllers handling full workflows

**Parameters:**
- Prefer explicit parameters over object destructuring for simple functions
- Use object parameters for functions with 3+ parameters
- Test IDs and logging context passed through call chains: `testId` parameter threaded through async operations

**Return Values:**
- Boolean for success/failure operations: `true` if successful, `false` on error
- Object for complex results: `{ success, message, data, step }` pattern in test classes
- Arrays for queries: Direct array return from database queries via `result.recordset`
- Null or empty values allowed for optional fields, but explicit checks required

## Module Design

**Exports:**
- CommonJS `module.exports` exclusively (no ES6 export syntax)
- Single function exports wrapped in object: `module.exports = { functionName };`
- Multiple exports grouped: `module.exports = { func1, func2, func3 };`
- Classes exported for instantiation: `module.exports = { EnhancedPaymentTester };`

**Barrel Files:**
- Not used; direct imports from specific files required
- Example: `const { logGenerator } = require('../utils/LogGenerator');` rather than index barrel

**Module Organization:**
- Configuration constants at top of file after require statements
- Constants in UPPER_SNAKE_CASE for module-level values
- Helper functions before main exported functions
- Exports at very end of file

## Code Patterns Observed

**Async/Await:**
- Consistent use of async/await for all asynchronous operations
- Async functions marked with `async` keyword
- Error handling via try-catch blocks
- Promise chaining in some legacy code (see `index.js`)

**Array Operations:**
- `.split(',')` for parsing comma-delimited environment variables
- `.map()` for transformations within payload building
- `.filter()` for selective processing
- `.find()` for single item lookup in arrays
- `.every()` for validation of all items in array

**String Handling:**
- Template literals for SQL query construction (STRING INTERPOLATION - SQL INJECTION RISK)
- `.trim()` for removing whitespace from database values
- `.toUpperCase()` / `.toLowerCase()` for case normalization
- `.split()` / `.join()` for string manipulation
- `.slice()` for substring operations
- `.padStart()` / `.padEnd()` for formatting numbers with leading zeros

**Object Construction:**
- Object literals for configuration and payloads
- Spread operator not observed; manual property assignment preferred
- Nullish coalescing: `value ?? defaultValue`
- Optional chaining: `error.response?.data`

---

*Convention analysis: 2026-03-12*
