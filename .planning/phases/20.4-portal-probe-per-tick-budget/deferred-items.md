# Phase 20.4 — Deferred items (found during execution, deliberately not fixed)

Out-of-scope discoveries logged per the executor scope boundary. Nothing here was changed by
plan 20.4-01. Each item names what would have to cover it.

---

## D-ITEM-01 — `npm test` leaks a growing CSV into an untracked `sageconnect/` directory at the repo root

**Found during:** plan 20.4-01, Task 2 (after the first full `npm test` run)
**Artifact:** `sageconnect/<fecha>/PaymentReconciliation-uploads.csv` — untracked, never in git history
**Writer:** `src/utils/CsvWriter.js`, reached from the `PaymentReconciliation` suite

Running `npm test` creates `sageconnect/2026-03-12/PaymentReconciliation-uploads.csv` relative to the
process CWD (the repo root). The path is date-derived from the fixture, not from today, so the
directory name is a fixture artifact rather than a real date.

Two properties make it worth recording rather than ignoring:

1. **It appends across runs.** Three `npm test` invocations during this plan produced three timestamp
   clusters inside the same file (19:06:01, 19:06:13, 19:06:31) and the file reached 4 KB. Nothing
   truncates or bounds it, so it grows for the life of the working copy. That is the same unbounded
   -retained-state shape CLAUDE.md §3 forbids in the service, appearing here in the test footprint.
2. **It is not covered by `.gitignore`.** `git check-ignore` returns nothing for it, so the next
   person who runs `git add -A` after `npm test` commits generated output into the repo.

**Content is harmless** — pure synthetic fixture rows (`PY-001`, `portal-1`, `1000 MXN`), no customer
data, no credentials. It was deleted during this plan so the working tree was left exactly as found.

**Why not fixed here:** plan 20.4-01's `files_modified` is exactly `src/config.js`, `.env.example`
and `tests/config.probe-budget.test.js`. The fix touches either `.gitignore` or the `CsvWriter` call
path in a baseline-failing suite (`PaymentReconciliation` is one of the CLAUDE.md §6 six), and this
diff has to stay reviewable in isolation for the October migration.

**What would cover it:** a one-line `.gitignore` entry is the cheap half; the honest half is making
the suite write to a temp dir and clean up after itself, the way
`tests/config.probe-budget.test.js` now does with its `beforeAll` / `afterAll` `mkdtempSync` +
`rmSync` pair. Candidate for the same follow-up that eventually addresses the two Jest worker-crash
suites.
