// tests/schema-guard.test.js
// RETRY-S1 / D-12 #3 — repo-wide static guard against impossible fesaPagosFocaltec columns.
//
// The 2026-07-27 production read of fesa.INFORMATION_SCHEMA.COLUMNS established that
// `fesa.dbo.fesaPagosFocaltec` has exactly FOUR columns: idCia, NoPagoSage, status, idFocaltec.
// It has no lastUpdate and no responseAPI. A statement selecting either aborts at runtime with
// 'Invalid column name', and every caller in this codebase swallows that error into an empty
// recordset — so the tick reports success, processes zero payments, and nothing in the logs
// looks wrong. That is the defect this phase exists to remove.
//
// Two emitter-level tests already pin the KNOWN emitters: tests/utils/RetryPolicy.test.js asserts
// the generated buildErrorStatsApply fragment, and tests/integration/eom-dispatch.test.js asserts
// the generated buildEomDataQuery string. This file is the net for the files nobody thought to
// check — the original defect lived in src/background.js, which hand-writes its own OUTER APPLY
// and is unreachable by following buildErrorStatsApply call sites. Ten other files under src/
// reference the table today and are clean; nothing structural stops the eleventh from repeating
// the mistake.

const fs = require('fs');
const path = require('path');

const SRC_ROOT = path.join(__dirname, '..', 'src');

const PAYMENTS_TABLE = 'fesa.dbo.fesaPagosFocaltec';
const IMPOSSIBLE_COLUMNS = ['lastUpdate', 'responseAPI'];

// How many lines on each side of a payments-table reference count as "the same statement".
// Measured on the current tree (after plan 20.2-05): in src/background.js the nearest legitimate
// lastUpdate — line 472, ORDER BY inside the POs branch, which queries fesaOCFocaltec and is
// entirely correct (D-11) — sits 37 lines from the nearest payments-table reference in code
// (line 509). A window of 12 therefore has ~25 lines of margin before it would false-positive.
const WINDOW = 12;

// No exemptions are needed today. Comment stripping already handles the only benign co-occurrence
// in the tree: src/utils/RetryPolicy.js mentions the payments table twice, both times in JSDoc
// prose, while its MAX(lastUpdate) line is real code for the OC branch. This hook exists so that
// a future legitimate case has an obvious home — widening IMPOSSIBLE_COLUMNS or shrinking WINDOW
// to accommodate one file would quietly disarm the guard everywhere else.
const ALLOWED_FILES = new Set([]);

/**
 * Blank out comments while preserving line numbering.
 *
 * Block comments are replaced character-for-character with spaces (newlines kept) so that a
 * violation's reported line number still matches the file. Line comments are then stripped per
 * line. This is what makes src/utils/RetryPolicy.js clean: after stripping, its only mentions of
 * the payments table — both inside JSDoc blocks — are gone entirely, so the file cannot violate
 * no matter what its code lines contain.
 */
function stripComments(content) {
    const withoutBlocks = content.replace(/\/\*[\s\S]*?\*\//g, (match) =>
        match.replace(/[^\n]/g, ' ')
    );
    return withoutBlocks
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''))
        .join('\n');
}

/**
 * Find impossible-column references near a payments-table reference.
 *
 * Statement-scoped rather than file-level on purpose: a file-level "contains both tokens" check
 * is permanently red on src/background.js, whose POs branch legitimately selects responseAPI and
 * orders by lastUpdate against fesaOCFocaltec (D-11). Scoping to a line window around each
 * payments-table reference distinguishes the two branches without an allow-list.
 *
 * Returns [{ line, text, token }] with 1-based line numbers, de-duplicated by line.
 */
function findViolations(content) {
    const lines = stripComments(content).split('\n');
    const byLine = new Map();

    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes(PAYMENTS_TABLE)) continue;

        const start = Math.max(0, i - WINDOW);
        const end = Math.min(lines.length - 1, i + WINDOW);

        for (let j = start; j <= end; j++) {
            for (const token of IMPOSSIBLE_COLUMNS) {
                if (lines[j].includes(token) && !byLine.has(j + 1)) {
                    byLine.set(j + 1, { line: j + 1, text: lines[j].trim(), token });
                }
            }
        }
    }

    return Array.from(byLine.values()).sort((a, b) => a.line - b.line);
}

/** Recursive .js collector — same shape as tests/no-process-exit.test.js:96-108. */
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

describe('schema guard — fesaPagosFocaltec has only four columns', () => {
    test('no statement under src/ selects lastUpdate or responseAPI from fesaPagosFocaltec', () => {
        const allJsFiles = scanDir(SRC_ROOT);
        const violations = [];

        for (const filePath of allJsFiles) {
            const relativePath = path.relative(SRC_ROOT, filePath);
            if (ALLOWED_FILES.has(path.basename(filePath))) continue;

            const found = findViolations(fs.readFileSync(filePath, 'utf8'));
            for (const v of found) {
                violations.push({ file: relativePath, ...v });
            }
        }

        if (violations.length > 0) {
            const details = violations.map((v) =>
                `  ${v.file} (${v.token}):\n    line ${v.line}: ${v.text}`
            ).join('\n');
            throw new Error(
                `Impossible column referenced near ${PAYMENTS_TABLE}.\n` +
                `That table has only idCia, NoPagoSage, status, idFocaltec — the statement will ` +
                `abort with 'Invalid column name' and the caller will swallow it into an empty ` +
                `recordset:\n${details}`
            );
        }

        expect(violations).toEqual([]);
    });

    test('the scanner is NOT vacuous — it detects the original background.js defect', () => {
        // Reproduces the shape plan 20.2-05 removed: a payments OUTER APPLY selecting responseAPI
        // and ordering by lastUpdate. Without this test a regex typo would make the sweep above
        // pass silently on every file — the same class of invisible failure this phase exists to
        // eliminate, arriving through the test that was supposed to catch it.
        const defectFixture = `
            OUTER APPLY (
                SELECT TOP 1 responseAPI FROM fesa.dbo.fesaPagosFocaltec
                WHERE NoPagoSage = P.DOCNBR AND status = 'ERROR'
                ORDER BY lastUpdate DESC
            ) AS lastError
        `;

        const violations = findViolations(defectFixture);
        const tokens = violations.map((v) => v.token);

        expect(violations.length).toBeGreaterThanOrEqual(2);
        expect(tokens).toContain('responseAPI');
        expect(tokens).toContain('lastUpdate');
    });

    test('scoped to the payments table — the same shape against fesaOCFocaltec is clean', () => {
        // D-11: fesaOCFocaltec genuinely HAS lastUpdate and responseAPI. The POs branch of
        // src/background.js selects both and is entirely correct; a guard that flagged it would
        // be turned off within a week.
        const ocFixture = `
            OUTER APPLY (
                SELECT TOP 1 responseAPI FROM fesa.dbo.fesaOCFocaltec
                WHERE ocSage = A.PONUMBER AND status = 'ERROR'
                ORDER BY lastUpdate DESC
            ) AS lastError
        `;

        expect(findViolations(ocFixture)).toEqual([]);
    });

    test('JSDoc prose about the table does not violate — the RetryPolicy.js shape', () => {
        // The table is named in documentation far more often than it is queried. Block-comment
        // stripping is what keeps src/utils/RetryPolicy.js clean, whose only mentions are JSDoc
        // while its MAX(lastUpdate) is real code for the OC branch.
        const jsdocFixture = `
/**
 * fesa.dbo.fesaPagosFocaltec has no timestamp column at all.
 */
const errorStatsSelect = 'SELECT COUNT(*) AS errorCount, MAX(lastUpdate) AS lastErrorAt';
        `;

        expect(findViolations(jsdocFixture)).toEqual([]);
    });

    test('the sweep actually visits the tree — a broken path cannot pass by scanning nothing', () => {
        // Without this, a typo in SRC_ROOT makes the guard vacuously green forever.
        expect(scanDir(SRC_ROOT).length).toBeGreaterThanOrEqual(30);
    });
});
