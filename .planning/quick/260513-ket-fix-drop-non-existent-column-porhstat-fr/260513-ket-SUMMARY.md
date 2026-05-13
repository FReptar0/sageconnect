---
quick_id: 260513-ket
slug: fix-drop-non-existent-column-porhstat-fr
status: complete
completed: 2026-05-13
files_modified:
  - src/scripts/po-cron-diagnostic.js
requirements_delivered:
  - GH-24-fix-PORHSTAT-column
---

# Quick 260513-ket — Drop PORHSTAT from po-cron-diagnostic (#24)

## What shipped

Three-line removal in `src/scripts/po-cron-diagnostic.js` plus one column-list trailing-comma adjustment. POPORH1 has no `PORHSTAT` column on this Sage 300 install; the leftover reference produced `Invalid column name 'PORHSTAT'` on the first prod run (PO0083449, 2026-05-12). `safeRun()` caught the error so the other four checks still ran, but `verdict.existsInPOPORH1` ended up `null` instead of `true`, producing a misleading verdict for the operator.

Concrete changes (diff `1 insertion, 4 deletions`):

1. **Verdict initializer** — removed `poStatus: null,` from the `const verdict = { ... }` literal (was at line 63).
2. **POPORH1 SELECT** — removed the `PORHSTAT` line from the column list and dropped the trailing comma after `ONHOLD`. Final SELECT column list now reads `RTRIM(PONUMBER) AS PONUMBER, PORHSEQ, [DATE] AS PO_DATE, ONHOLD` (was lines 84-85, now collapsed to a single `ONHOLD` line with no trailing comma).
3. **Verdict assignment** — removed `verdict.poStatus = r1[0] ? r1[0].PORHSTAT : null;` (was line 95). The surrounding block (`verdict.existsInPOPORH1 = r1.length > 0;` and the `if (!verdict.existsInPOPORH1)` short-circuit) is unchanged.

No other `safeRun` blocks touched. No `console.log` text, `verdict.reason` strings, or function signatures changed. No new imports, no new dependencies. No tests changed — no test file referenced `poStatus` or `PORHSTAT` per the issue's grep audit.

**Commit:** `14637bf fix(scripts): drop PORHSTAT from po-cron-diagnostic POPORH1 lookup (#24)` (no `Co-Authored-By` trailer per HANDOFF.md §8 — code commit).

## Verification

All four checks per the plan's `<verify>` block pass simultaneously:

```bash
$ node -c src/scripts/po-cron-diagnostic.js
$ echo $?
0                                # SYNTAX OK

$ grep -nE 'PORHSTAT|poStatus' src/scripts/po-cron-diagnostic.js
$ echo $?
1                                # 0 matches — both identifiers fully removed

$ grep -nE 'INSERT |UPDATE |DELETE FROM' src/scripts/po-cron-diagnostic.js
$ echo $?
1                                # 0 matches — read-only invariant preserved (HANDOFF.md §6)
```

(Redaction sanity check elided to keep HANDOFF.md §§ 1-2 compliance — the integrator-name and portal-name substring scan was run by the executor; no new third-party-name occurrences were introduced by this edit. The pre-existing table/column identifiers in the script are carried over from quick-260512-7ea and were not modified.)

`git diff --stat src/scripts/po-cron-diagnostic.js` matches plan expectations: 1 line modified (the trailing comma after `ONHOLD`) plus 3 lines removed = `1 insertion, 4 deletions` in the commit stats.

## What's NOT in scope

The **cron WHERE filter itself** — specifically the `MAX(Autoriza_OC_detalle.Fecha) = CAST(GETDATE() AS DATE)` clause in `src/controller/PortalOC_Creator.js` that is the suspected reason POs like PO0083449 get skipped on subsequent cron ticks — is **GitHub issue #21** and is a separate piece of work that needs a full GSD phase (`/gsd-spec-phase` → `/gsd-discuss-phase` → `/gsd-plan-phase` → `/gsd-execute-phase`). This quick task only fixes the diagnostic tool that surfaces that bug; it does not change the cron filter logic. Once this fix deploys, the operator can re-run `po-cron-diagnostic.js PO0083449` against COPDAT and get the correct existsInPOPORH1=true / lastAuthDateIsToday verdict line, which will provide concrete evidence to drive the #21 phase.

No `npm test` run is included here — the file is a CLI diagnostic with no Jest coverage, and the plan's `<verify>` block did not require a test pass. Pre-existing failing tests (`PaymentReconciliation`, `TransformTime`, `no-process-exit`, `enforcement-wiring`) per CLAUDE.md §6 are tolerated baseline noise and unrelated to this script.

## How to validate in prod

Per HANDOFF.md §6 (no local DB, prod-loop is the validation rig):

1. CI obfuscates this commit and force-pushes to `FReptar0/sageconnect-dist` on the next master push (or the existing branch's downstream merge).
2. Operator on `ZCL-RDS-02`:
   ```powershell
   cd E:\sageconnect-dist
   git fetch origin master
   git reset --hard origin/master
   npm ci --omit=dev
   # No service restart needed — this is a CLI script, not part of the running service.
   ```
3. Operator runs the diagnostic against the original failing PO:
   ```powershell
   node src/scripts/po-cron-diagnostic.js PO0083449
   ```
   **Expected output change:**
   - Section `1. EXISTE EN POPORH1?` no longer prints `[!] POPORH1 lookup -> ERROR: Invalid column name 'PORHSTAT'`.
   - The `console.table` for that section prints a single row with columns `PONUMBER, PORHSEQ, PO_DATE, ONHOLD` (no `PORHSTAT` column).
   - The `RESUMEN` table at the end shows `existsPOPORH1: true` for PO0083449 instead of `existsPOPORH1: null`.
4. Operator pastes the `console.table` output back. Confirming `existsInPOPORH1: true` validates the fix structurally; the surrounding verdict (`lastAuthDateIsToday`, `cronWouldMatch`) then becomes the concrete evidence for opening the #21 phase on the cron WHERE filter.

The fix is structurally complete when the four `<done>` conditions hold (already verified above); step (4) is the natural prod follow-up and is tracked outside this quick task.
