// tests/no-process-exit.test.js
// Static analysis test: ensures no process.exit() calls in always-on code paths.
// This is a structural integrity test that prevents future regressions.

const fs = require('fs');
const path = require('path');

const SRC_ROOT = path.join(__dirname, '..', 'src');

/**
 * Reads a JS file and returns all lines where process.exit appears (code only, not comments).
 * Returns array of { line: number, text: string }.
 */
function findProcessExitCalls(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const results = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip single-line comments
        const stripped = line.replace(/\/\/.*$/, '');
        if (/process\.exit\s*\(/.test(stripped)) {
            results.push({ line: i + 1, text: line.trim() });
        }
    }
    return results;
}

/**
 * Checks whether a file contains a require.main === module guard.
 */
function hasRequireMainGuard(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return /if\s*\(\s*require\.main\s*===\s*module\s*\)/.test(content);
}

/**
 * Checks if all process.exit calls in a file are safe (either after the require.main guard
 * or inside function bodies that are only called from the guard block).
 *
 * A process.exit call is considered "unguarded" only if it appears at the top level
 * (outside any function definition) before the require.main guard.
 * process.exit inside function bodies is OK because those functions are only invoked
 * from the guard block (CLI execution path).
 *
 * Returns { allGuarded: boolean, unguardedCalls: [] }.
 */
function checkExitCallsAfterGuard(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const guardMatch = content.match(/if\s*\(\s*require\.main\s*===\s*module\s*\)/);
    if (!guardMatch) {
        // No guard found -- all exit calls are unguarded
        const calls = findProcessExitCalls(filePath);
        return { allGuarded: calls.length === 0, unguardedCalls: calls };
    }

    const guardIndex = guardMatch.index;
    const beforeGuard = content.substring(0, guardIndex);
    const beforeLines = beforeGuard.split('\n');

    // Track brace depth to detect whether we're inside a function body.
    // At depth 0 we're at the module top level -- process.exit there runs on require.
    // At depth > 0 we're inside a function -- process.exit there only runs if called.
    let braceDepth = 0;
    const unguardedCalls = [];

    for (let i = 0; i < beforeLines.length; i++) {
        const line = beforeLines[i];
        const stripped = line.replace(/\/\/.*$/, '');  // strip line comments
        const strippedStrings = stripped.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '');  // strip strings

        // Count braces (simple heuristic -- works for standard JS formatting)
        for (const ch of strippedStrings) {
            if (ch === '{') braceDepth++;
            if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
        }

        if (/process\.exit\s*\(/.test(stripped) && braceDepth === 0) {
            unguardedCalls.push({ line: i + 1, text: line.trim() });
        }
    }

    return { allGuarded: unguardedCalls.length === 0, unguardedCalls };
}

// ---------------------------------------------------------------------------
// Test 1: No process.exit() in src/ files outside allowed locations
// ---------------------------------------------------------------------------
describe('process.exit compliance', () => {

    test('no process.exit in src/ files except config.js, index.js, and files with require.main guards', () => {
        // Allowed files: config.js (startup validation), index.js (autoTerminate only),
        // routes.js (autoTerminate guard verified in separate test),
        // files with require.main guards (CLI scripts)
        const ALLOWED_FILES = new Set(['config.js', 'index.js', 'routes.js', 'dashboard-routes.js']);

        function scanDir(dirPath, results = []) {
            if (!fs.existsSync(dirPath)) return results;
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    scanDir(fullPath, results);
                } else if (entry.name.endsWith('.js')) {
                    results.push(fullPath);
                }
            }
            return results;
        }

        const allJsFiles = scanDir(SRC_ROOT);
        const violations = [];

        for (const filePath of allJsFiles) {
            const relativePath = path.relative(SRC_ROOT, filePath);
            const fileName = path.basename(filePath);

            // Skip globally allowed files
            if (ALLOWED_FILES.has(fileName)) continue;

            const exitCalls = findProcessExitCalls(filePath);
            if (exitCalls.length === 0) continue;

            // If file has require.main guard, check that ALL exit calls are after the guard
            if (hasRequireMainGuard(filePath)) {
                const { allGuarded, unguardedCalls } = checkExitCallsAfterGuard(filePath);
                if (!allGuarded) {
                    violations.push({
                        file: relativePath,
                        calls: unguardedCalls,
                        reason: 'process.exit before require.main guard'
                    });
                }
                // If all guarded, this file is OK
                continue;
            }

            // No guard and has process.exit -- violation
            violations.push({
                file: relativePath,
                calls: exitCalls,
                reason: 'no require.main guard'
            });
        }

        if (violations.length > 0) {
            const details = violations.map(v =>
                `  ${v.file} (${v.reason}):\n` +
                v.calls.map(c => `    line ${c.line}: ${c.text}`).join('\n')
            ).join('\n');
            throw new Error(`process.exit found in always-on code paths:\n${details}`);
        }

        expect(violations).toEqual([]);
    });

    // ---------------------------------------------------------------------------
    // Test 2: config.js contains exactly 1 process.exit call
    // ---------------------------------------------------------------------------
    test('config.js contains exactly 1 process.exit call (startup validation)', () => {
        const configPath = path.join(SRC_ROOT, 'config.js');
        const exitCalls = findProcessExitCalls(configPath);
        expect(exitCalls.length).toBe(1);
    });

    // ---------------------------------------------------------------------------
    // Test 3: All 13 scripts in src/scripts/ have require.main === module guard
    // ---------------------------------------------------------------------------
    test('all scripts in src/scripts/ have require.main === module guard', () => {
        const scriptsDir = path.join(SRC_ROOT, 'scripts');
        const scriptFiles = fs.readdirSync(scriptsDir)
            .filter(f => f.endsWith('.js') && !fs.statSync(path.join(scriptsDir, f)).isDirectory());

        expect(scriptFiles.length).toBeGreaterThanOrEqual(13);

        const missing = [];
        for (const file of scriptFiles) {
            const filePath = path.join(scriptsDir, file);
            if (!hasRequireMainGuard(filePath)) {
                missing.push(file);
            }
        }

        if (missing.length > 0) {
            throw new Error(`Scripts missing require.main === module guard:\n  ${missing.join('\n  ')}`);
        }
        expect(missing).toEqual([]);
    });

    // ---------------------------------------------------------------------------
    // Test 4: PortalOC_StatusUpdater.js has require.main === module guard
    // ---------------------------------------------------------------------------
    test('PortalOC_StatusUpdater.js has require.main === module guard', () => {
        const filePath = path.join(SRC_ROOT, 'controller', 'PortalOC_StatusUpdater.js');
        expect(hasRequireMainGuard(filePath)).toBe(true);
    });

    // ---------------------------------------------------------------------------
    // Test 5: index.js process.exit calls are inside autoTerminate conditional blocks
    // ---------------------------------------------------------------------------
    test('index.js process.exit calls are inside autoTerminate conditional blocks', () => {
        const filePath = path.join(SRC_ROOT, 'index.js');
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        const exitCalls = findProcessExitCalls(filePath);
        expect(exitCalls.length).toBeGreaterThan(0); // Should have some exit calls

        // Each process.exit call should be preceded by an autoTerminate check
        for (const call of exitCalls) {
            // Look backwards from the exit call line to find the nearest autoTerminate guard
            let foundGuard = false;
            for (let i = call.line - 2; i >= 0; i--) {
                if (/autoTerminate/.test(lines[i])) {
                    foundGuard = true;
                    break;
                }
                // If we hit a function boundary, stop looking
                if (/^(async\s+)?function\s|^\}\s*$/.test(lines[i].trim())) {
                    break;
                }
            }
            expect(foundGuard).toBe(true);
        }
    });

    // ---------------------------------------------------------------------------
    // Additional: background.js has zero process.exit calls
    // ---------------------------------------------------------------------------
    test('background.js has zero process.exit calls', () => {
        const filePath = path.join(SRC_ROOT, 'background.js');
        const exitCalls = findProcessExitCalls(filePath);
        expect(exitCalls.length).toBe(0);
    });

    // ---------------------------------------------------------------------------
    // Additional: AutoShutdownService.js has zero process.exit calls
    // ---------------------------------------------------------------------------
    test('AutoShutdownService.js has zero process.exit calls', () => {
        const filePath = path.join(SRC_ROOT, 'services', 'AutoShutdownService.js');
        const exitCalls = findProcessExitCalls(filePath);
        expect(exitCalls.length).toBe(0);
    });

    // ---------------------------------------------------------------------------
    // Additional: routes.js process.exit is inside autoTerminate guard
    // ---------------------------------------------------------------------------
    test('dashboard-routes.js process.exit is guarded by autoTerminate check', () => {
        const filePath = path.join(SRC_ROOT, 'routes', 'dashboard-routes.js');
        const content = fs.readFileSync(filePath, 'utf8');
        const exitCalls = findProcessExitCalls(filePath);

        // Every process.exit call should be in a code path that's only reachable when autoTerminate=true
        // The shutdown route checks !config.app.autoTerminate and returns 403 if false
        for (const call of exitCalls) {
            const lines = content.split('\n');
            let foundGuard = false;
            for (let i = call.line - 2; i >= 0; i--) {
                if (/autoTerminate/.test(lines[i])) {
                    foundGuard = true;
                    break;
                }
            }
            expect(foundGuard).toBe(true);
        }
    });
});
