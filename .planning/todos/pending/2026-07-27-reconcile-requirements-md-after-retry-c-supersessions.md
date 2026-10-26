---
created: 2026-07-27T21:05:00.000Z
title: Reconcile REQUIREMENTS.md after the RETRY-C* supersessions
area: docs
files:
  - .planning/REQUIREMENTS.md
  - .planning/phases/20.1-retry-policy-correction/20.1-SPEC.md
---

## Problem

`.planning/REQUIREMENTS.md` tracks milestone-level IDs `RETRY-01..07`. Phase 20.1's own
requirements are `RETRY-C1..C7`, which **do not exist in that file at all**. All three Phase 20.1
executors hit this independently — `gsd-sdk query requirements.mark-complete RETRY-C4 RETRY-C7`
returns `not_found` — and each correctly declined to edit milestone checkboxes unilaterally.
The Phase 20.1 verifier surfaced it again as **E-3**.

The reconciliation is **not mechanical**, which is why nobody has done it: some Phase 20 REQs
were *superseded* rather than *delivered*.

| Phase 20 REQ | What Phase 20.1 did to it |
|---|---|
| RETRY-03 | Amended — the default value flipped from `current_month` to `last_n_days`/30 |
| RETRY-04 | **Superseded** — fixed interval replaced the geometric backoff entirely |
| RETRY-05 | **Superseded** — `RETRY_INTERVAL_*` env vars replaced `RETRY_BACKOFF_*`, whose guards were deleted |
| RETRY-07 | Amended — the diagnostic relabel landed (backoff → retry-interval) |

Marking RETRY-04 and RETRY-05 as "complete" would be wrong: their described behavior was
deliberately removed, not shipped. Leaving them unchecked is also wrong: it implies outstanding
work that no longer exists.

## Solution

Decide and apply a convention for superseded requirements — for example a `~~struck~~` entry
with a "superseded by RETRY-C4 (Phase 20.1)" pointer, distinct from both `[x]` delivered and
`[ ]` outstanding. Then:

1. Apply it to RETRY-04 and RETRY-05.
2. Update RETRY-03 and RETRY-07's text so they describe what actually shipped.
3. Decide whether phase-level `RETRY-C*` IDs get first-class entries in REQUIREMENTS.md or stay
   scoped to `20.1-SPEC.md` (the current de-facto answer, which the SDK does not understand).

Worth resolving before the v2.4 milestone closes, otherwise `/gsd-complete-milestone` will
produce a traceability table that misrepresents what was built.
