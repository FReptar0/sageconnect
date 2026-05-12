---
description: Run the Jest suite (optionally scoped to a file path passed as args)
---

Run the project's Jest test suite.

- If `$ARGUMENTS` is non-empty, treat it as a path or pattern and run `npx jest $ARGUMENTS`.
- Otherwise run `npm test`.

When reporting results:
1. State the pass/fail counts.
2. If failures appear, distinguish **new failures** (introduced by current work) from the **pre-existing failing suites** documented in `.planning/codebase/TESTING.md` and `CLAUDE.md` §6 — typically `PaymentReconciliation`, `TransformTime`, `no-process-exit`, and `enforcement-wiring`. Pre-existing failures are baseline noise, not regressions.
3. For each new failure, show the file, the assertion that failed, and the first divergent expected/actual line. Keep it short — full output bloats context.

Do not silently ignore failures, and do not "fix" pre-existing failures unless the user explicitly asks.
