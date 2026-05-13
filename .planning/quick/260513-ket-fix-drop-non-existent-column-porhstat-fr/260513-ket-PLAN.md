---
phase: 260513-ket
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/scripts/po-cron-diagnostic.js
autonomous: true
requirements:
  - GH-24
must_haves:
  truths:
    - "Running po-cron-diagnostic.js against an existing PO no longer prints `Invalid column name 'PORHSTAT'`."
    - "The POPORH1 lookup verdict line reports `existsInPOPORH1: true` (not `null`) for any PO row present in POPORH1."
    - "The script remains read-only: `grep -nE 'INSERT |UPDATE |DELETE FROM' src/scripts/po-cron-diagnostic.js` returns 0 matches (read-only invariant from quick-260512-7ea preserved per HANDOFF.md §6)."
  artifacts:
    - path: "src/scripts/po-cron-diagnostic.js"
      provides: "Repaired POPORH1 lookup with valid columns only"
      contains: "PONUMBER"
  key_links:
    - from: "src/scripts/po-cron-diagnostic.js (POPORH1 SELECT)"
      to: "COPDAT.dbo.POPORH1 schema"
      via: "runQuery(sql, database)"
      pattern: "FROM \\$\\{database\\}\\.dbo\\.POPORH1"
---

<objective>
Drop the non-existent `PORHSTAT` column from the POPORH1 lookup in `src/scripts/po-cron-diagnostic.js`, and remove the now-dead `poStatus` verdict field that depended on it (GitHub issue #24).

Purpose: First prod run on 2026-05-12 (PO0083449) returned `Invalid column name 'PORHSTAT'` from the POPORH1 lookup. The `safeRun()` wrapper caught the error so the other four checks ran fine, but `existsInPOPORH1` ended up `null` instead of `true`, which produces a misleading verdict for the operator. The script only needs `PONUMBER` to prove existence — `PORHSTAT` was a leftover from an earlier draft and was never referenced elsewhere.

Output: Three-line removal in one file (verdict initializer, SELECT column, verdict assignment). No new dependencies, no schema changes, no test changes (no tests reference `poStatus`/`PORHSTAT` per the issue's grep audit).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@HANDOFF.md
@.planning/STATE.md
@src/scripts/po-cron-diagnostic.js

<interfaces>
<!-- Three exact reference points the executor must mutate. Lines verified by Read 2026-05-13. -->

Line 63 (verdict initializer, inside the `verdict` object literal starting at line 58):
```javascript
        poStatus: null,
```
Action: delete this entire line (including trailing comma).

Lines 79-88 (SELECT inside the `safeRun('POPORH1 lookup', ...)` block):
```javascript
        const sql = `
            SELECT
                RTRIM(PONUMBER)  AS PONUMBER,
                PORHSEQ,
                [DATE]           AS PO_DATE,
                ONHOLD,
                PORHSTAT
            FROM ${database}.dbo.POPORH1
            WHERE PONUMBER = '${poNumber}'
        `;
```
Action: remove the trailing comma after `ONHOLD,` and delete the `PORHSTAT` line. Resulting SELECT column list ends `ONHOLD` with no trailing comma before `FROM`.

Lines 93-100 (verdict assignment block after the lookup):
```javascript
    if (r1 && !r1.__error) {
        verdict.existsInPOPORH1 = r1.length > 0;
        verdict.poStatus = r1[0] ? r1[0].PORHSTAT : null;
        if (!verdict.existsInPOPORH1) {
            verdict.reason = 'PO no existe en POPORH1 (numero invalido o DB equivocada)';
            return verdict;
        }
    }
```
Action: delete the `verdict.poStatus = r1[0] ? r1[0].PORHSTAT : null;` line. Leave the surrounding block (`existsInPOPORH1` assignment + reason short-circuit) intact.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Drop PORHSTAT column and poStatus verdict field</name>
  <files>src/scripts/po-cron-diagnostic.js</files>
  <action>
    Apply three precise removals to `src/scripts/po-cron-diagnostic.js` using the Edit tool (one or more edits — do not rewrite the file):

    1. **Verdict initializer (line 63):** delete the entire line `        poStatus: null,` from inside the `const verdict = { ... }` literal. The line above (`existsInPOPORH1: null,`) and the line below (`isAuthorized: null,`) remain unchanged.

    2. **SELECT column list (lines 84-85):** in the `safeRun('POPORH1 lookup', ...)` SQL template literal, change the column list from `ONHOLD,\n                PORHSTAT` to `ONHOLD`. Concretely: remove the trailing comma after `ONHOLD` and delete the `PORHSTAT` line entirely. The final SELECT must read `RTRIM(PONUMBER) AS PONUMBER, PORHSEQ, [DATE] AS PO_DATE, ONHOLD` followed by `FROM ${database}.dbo.POPORH1`.

    3. **Verdict assignment (line 95):** delete the line `        verdict.poStatus = r1[0] ? r1[0].PORHSTAT : null;`. The `verdict.existsInPOPORH1 = r1.length > 0;` line immediately above remains, and the `if (!verdict.existsInPOPORH1) { ... }` short-circuit immediately below remains.

    Do not touch any of the other `safeRun` blocks (`Autoriza_OC lookup`, `Cron WHERE replication`, `fesaOCFocaltec lookup`, etc.) — they are out of scope. Do not change `console.log` text, `verdict.reason` strings, or the function signature. No new imports, no new helpers.

    No tests need updating (no test references `poStatus` or `PORHSTAT` per the issue's grep audit).
  </action>
  <verify>
    <automated>
      node -c src/scripts/po-cron-diagnostic.js && \
      test "$(grep -c -v '^[[:space:]]*//' src/scripts/po-cron-diagnostic.js | tr -d ' ')" -gt 0 && \
      test "$(grep -nE 'PORHSTAT|poStatus' src/scripts/po-cron-diagnostic.js | wc -l | tr -d ' ')" = "0" && \
      test "$(grep -nE 'INSERT |UPDATE |DELETE FROM' src/scripts/po-cron-diagnostic.js | wc -l | tr -d ' ')" = "0" && \
      echo "VERIFY OK"
    </automated>
  </verify>
  <done>
    All four conditions hold simultaneously:
    1. `node -c src/scripts/po-cron-diagnostic.js` exits 0 (SYNTAX OK).
    2. `grep -nE 'PORHSTAT|poStatus' src/scripts/po-cron-diagnostic.js` returns 0 matches (both identifiers fully removed).
    3. `grep -nE 'INSERT |UPDATE |DELETE FROM' src/scripts/po-cron-diagnostic.js` returns 0 matches (read-only invariant preserved per HANDOFF.md §6).
    4. The SELECT column list in the `safeRun('POPORH1 lookup', ...)` block ends with `ONHOLD` followed by `FROM ${database}.dbo.POPORH1` on the next non-blank line.
  </done>
</task>

</tasks>

<verification>
After the task completes, the executor runs from repo root:

```bash
node -c src/scripts/po-cron-diagnostic.js
grep -nE 'PORHSTAT|poStatus' src/scripts/po-cron-diagnostic.js   # expect: no output
grep -nE 'INSERT |UPDATE |DELETE FROM' src/scripts/po-cron-diagnostic.js   # expect: no output
git diff --stat src/scripts/po-cron-diagnostic.js   # expect: ~3 lines removed, 1 line modified (ONHOLD trailing comma)
```

Operator-side validation (prod-loop, after this fix lands on `master` and CI obfuscates to dist per CLAUDE.md §10 / HANDOFF.md §6) is **out of scope for this quick task**. The fix is structurally complete when the four `<done>` conditions hold; the operator's next `node src/scripts/po-cron-diagnostic.js <PO>` invocation against COPDAT is the real validation rig and is the natural follow-up after deploy.

**Commit:** stage only `src/scripts/po-cron-diagnostic.js` (NEVER `git add -A` or `git add .` — there is an unrelated pre-existing modification to `package-lock.json` in the working tree that must NOT enter the commit per the constraints):

```bash
git add src/scripts/po-cron-diagnostic.js
git commit -m "fix(scripts): drop PORHSTAT from po-cron-diagnostic POPORH1 lookup (#24)"
```

This is a code commit (`fix:` prefix) — do **not** add the `Co-Authored-By` trailer per HANDOFF.md §8.
</verification>

<success_criteria>
- `src/scripts/po-cron-diagnostic.js` no longer references `PORHSTAT` or `poStatus` (3 lines removed, 1 line modified to drop a trailing comma).
- `node -c src/scripts/po-cron-diagnostic.js` returns SYNTAX OK.
- Read-only invariant preserved: `grep -nE 'INSERT |UPDATE |DELETE FROM'` returns 0 matches.
- A single atomic commit on the existing branch `fix/po-cron-diagnostic-porhstat`, message references `#24`, staged with explicit file path (not `git add -A`), no `Co-Authored-By` trailer.
- `package-lock.json` is **not** in the commit.
</success_criteria>

<output>
After completion, create `.planning/quick/260513-ket-fix-drop-non-existent-column-porhstat-fr/260513-ket-SUMMARY.md` recording:
- The three line removals and the column-list trailing-comma adjustment.
- Confirmation that the four `<done>` conditions hold (paste the verify command output).
- A note that operator-side prod validation (re-running `po-cron-diagnostic.js` against PO0083449 after deploy) is the natural follow-up and is tracked outside this quick task.
</output>
