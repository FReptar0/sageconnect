---
quick_id: 260512-7ea
slug: po-cron-diagnostic
status: complete
completed: 2026-05-12
files_modified:
  - src/scripts/po-cron-diagnostic.js              # NEW
  - .claude/hooks/pre-edit-gsd-guard.sh            # MODIFIED (recognize active quick tasks)
  - .planning/STATE.md                             # MODIFIED (record quick task)
requirements_delivered:
  - QUICK-01-explain-cron-skips-PO
---

# Quick Task 260512-7ea: PO Cron Diagnostic — Summary

## What shipped

`src/scripts/po-cron-diagnostic.js` — read-only Node.js script that, for each PO passed by CLI, explains caso-por-caso why the every-15-min cron is or is not picking up that PO.

For each PO, the script runs 5 sequential checks and emits an explicit verdict string:

1. `POPORH1` lookup (exists in Sage?)
2. `Autorizaciones_electronicas.dbo.Autoriza_OC` (authorized?)
3. `MAX(Fecha)` from `Autoriza_OC_detalle` vs. `CAST(GETDATE() AS DATE)` (the lethal cron filter)
4. Exact replica of the cron's `WHERE` in `src/controller/PortalOC_Creator.js:176-185` (returns row count the cron would see right now)
5. `fesa.dbo.fesaOCFocaltec` history (POSTED / ERROR / responseAPI / idFocaltec)

Verdict priority: PO missing > not authorized > already POSTED > cron filter (date) > skip-location > unknown > would-match (so timeout/lock is the suspect).

A final `console.table` resumen prints one row per PO so the operator pastes it back as plain text (no SQL access in prod — `project_no_sql_access.md` + HANDOFF.md § 6).

## Hook fix (side artifact)

`.claude/hooks/pre-edit-gsd-guard.sh` was extended to recognize active quick tasks in `.planning/quick/` (dir with `*PLAN.md` and no `*SUMMARY.md`). Previously the hook only honored `.planning/phases/` despite CLAUDE.md § 12 and the hook's own help text listing `/gsd-quick` as a valid path for single-file changes. Closes the inconsistency. Manually validated: shellcheck passes, simulated PreToolUse JSON with src/ path returns exit 0 when quick is active.

## Verification

- `node -c src/scripts/po-cron-diagnostic.js` → SYNTAX OK
- `grep -nE 'INSERT |UPDATE |DELETE FROM' src/scripts/po-cron-diagnostic.js` → NO MUTATIONS (read-only invariant holds)
- `bash -n .claude/hooks/pre-edit-gsd-guard.sh` → SYNTAX OK
- Simulated hook invocation with active quick task → exit 0 (no false block)
- Smoke run with no args: prints usage + `process.exitCode = 1` (cannot test against real SQL — operator runs in prod)

## What's NOT in scope

- **No fix** of the cron's `WHERE` (the `= CAST(GETDATE() AS DATE)` filter). That is a business-logic change — needs `/gsd-spec-phase` to decide the new rule (rolling window? state-based? on-demand catch-up?). Quick task is diagnosis only.
- **No backfill** of orphan POs into `fesaOCFocaltec`. Also requires phase — must not silently INSERT in prod without a spec.

## How to use in prod

```
node src/scripts/po-cron-diagnostic.js PO0083449
node src/scripts/po-cron-diagnostic.js PO0083449 PO0083450 PO0083451
node src/scripts/po-cron-diagnostic.js PO0083449 COPDAT 0
```

Operator pastes the resumen table back. If `cronWouldMatch=false` and `authIsToday=false` → confirmed: the date filter is the cause. Then we open a phase to fix it.

## Next step

Operator runs the script in prod against PO0083449 (and any others reported). Verdict either confirms the date-filter hypothesis or points elsewhere (POPORL skip-location, lock_timeout in the step). Then `/gsd-spec-phase` for the fix.
