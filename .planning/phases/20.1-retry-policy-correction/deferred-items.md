# Phase 20.1 — Deferred items (found during execution, deliberately not fixed)

Out-of-scope discoveries logged per the executor scope boundary. Nothing here was changed by
plans 20.1-01 / 02 / 03. Each item names the requirement that would have to cover it.

---

## D-ITEM-01 — `po-cron-diagnostic.js` section 4 still replicates the OLD dedupe (POSTED only)

**Found during:** plan 20.1-03, Task 1
**File:** `src/scripts/po-cron-diagnostic.js` (section 4, "EL WHERE DEL CRON LA LEVANTARIA HOY?", `AND status = 'POSTED'`)

Section 4's whole purpose is to be an *exact replica* of the cron's WHERE so the operator can see,
clause by clause, why a PO is or is not lifted. Plan 20.1-02 changed the real cron
(`PortalOC_Creator.js`) to `status IN ('CLOSED', 'POSTED')` (RETRY-C7), and plan 20.1-03 changed the
`retry-month-pos.js` preview to match. The diagnostic's replica was **not** changed.

**Consequence:** for an OC whose `fesaOCFocaltec` row has transitioned `POSTED → CLOSED`, the
diagnostic will report `cronWouldMatch = true` (its replica still finds no POSTED row and lets the
OC through) while the actual cron now excludes it. The operator would read "Cron SÍ la levantaría"
for a PO the cron deliberately skips. Verdict priority 1 (`fesaStatus === 'POSTED'`) does not catch
it either, because the row's status is `CLOSED`.

**Why it was not fixed here:** SPEC RETRY-C7 scopes the dedupe change to exactly two places — the
production cron query in `PortalOC_Creator.js` and the operator month-sweep **preview** in
`retry-month-pos.js`. The diagnostic is a third site, named in neither the SPEC nor plan 20.1-03
(whose Task 1 explicitly leaves the section-6 SQL and the rest of the script's SQL unchanged). The
executor brief for 20.1-03 listed this occurrence as out of scope by name.

**Suggested disposition:** `/gsd-verify-work 20.1` should decide whether to (a) amend RETRY-C7 to
cover the diagnostic replica, or (b) open a follow-up quick task. Low risk either way — the change
is one line, read-only SQL, no mutation path — but it is a correctness gap in an operator tool that
exists precisely to be trusted over a guess.

**Verdict-priority note:** if the replica is updated, consider also adding a `CLOSED` branch to the
verdict priorities (today a CLOSED OC falls through to priority 4/5 wording that does not mention
closure at all).

---

## D-ITEM-02 — milestone `REQUIREMENTS.md` reconciliation (carried from 20.1-01)

**Found during:** plan 20.1-01, Task 2 (`requirements.mark-complete` reported `not_found`)

`.planning/REQUIREMENTS.md` tracks milestone-level v2.4 IDs (`RETRY-01..07`), not this phase's
`RETRY-C*` IDs. The mapping is not mechanical:

- `RETRY-03` (scope switching) — effectively satisfied by RETRY-C1.
- `RETRY-04` (geometric curve) — **superseded**, not delivered; the curve no longer exists.
- `RETRY-05` (backoff env vars) — **superseded**; those vars were deliberately removed.
- `RETRY-07` (diagnostic backoff section) — amended by RETRY-C5.

Left to `/gsd-verify-work 20.1` rather than edited unilaterally from a plan executor.

---

*Phase: 20.1-retry-policy-correction*
*Last updated: 2026-07-27 (end of plan 20.1-03)*
