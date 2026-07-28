# Phase 20.2 — Deferred items (found during planning/execution, deliberately not fixed)

Out-of-scope discoveries logged per the executor scope boundary. Nothing here was changed by
plans 20.2-01 … 06. Each item names what would have to happen for it to be resolved.

---

## D-ITEM-03 — `PortalOC_Creator.js` joins the error-stats `OUTER APPLY` but never projects it

**Found during:** phase 20.2 planning (hazard H-4, surfaced by the planner and confirmed by the
plan-checker on 2026-07-27). Present in neither SPEC, CONTEXT nor PATTERNS.
**File:** `src/controller/PortalOC_Creator.js` — `OUTER APPLY … AS ef` joined at L177; SELECT list
L52-150; retry post-filter L211-240.

### The finding

The query joins the error-stats fragment and then never selects `ef.errorCount` or `ef.lastErrorAt`
into its projection. The JS post-filter reads `row.lastErrorAt` and `row.errorCount`, so on every
live row both are `undefined`.

`computeRetryEligibility` treats a falsy `lastErrorAt` as "never failed → eligible immediately"
(RETRY-C4, deliberately). Therefore **every PO has always been ruled eligible**: the per-row
deferral log has never been able to fire for POs, and `attempts=` would always read 0. The
`OUTER APPLY` executes on every tick and its result is discarded.

### Evidence

```
$ grep -c '\bef\b' src/controller/PortalOC_Creator.js
1
$ grep -n '\bef\b' src/controller/PortalOC_Creator.js
211:  // El OUTER APPLY ef trajo errorCount + lastErrorAt por fila; se difieren las filas
```

The single hit is a **comment** asserting the opposite of what the query does. For contrast, the
payment controller does project both columns:

```
$ grep -n 'ef\.' src/controller/PortalPaymentController.js
60:    ef.errorCount  AS errorCount,
61:    ef.lastErrorAt AS lastErrorAt,
```

**Why it went unnoticed through Phase 20 and 20.1 review:** the `PortalOC_Creator.cron-where` suite
passes because its mocked recordset supplies `lastErrorAt` directly — a row shape the real query
cannot produce. The test proves the helper's logic, not the wiring.

### Consequence

The PO half of RETRY-S4 is structurally correct but behaviourally inert. After this phase, the PO
cron is on a single clock and its eligibility rule is right — it simply never has an input to apply
it to. The payments half is unaffected (it projects both columns), so RETRY-S2 lands in full.

### Decision: DEFER — taken by the developer on 2026-07-27

Do **not** project the columns in this phase.

**Rationale.** `fesa.dbo.fesaOCFocaltec.lastUpdate` is typed `date`, not `datetime` — it carries no
time of day. Projecting `MAX(lastUpdate)` today would anchor every PO's `lastErrorAt` at 00:00 of
the error date. Against the 240-minute PO interval that produces a degenerate deferral: POs would
defer only between 00:00 and 04:00 local and be inert for the other twenty hours. That is worse
than no deferral at all, and impossible to explain to an operator looking at the log.

Deferring keeps the phase diff to the three defects the SPEC scopes.

### Resolution path — D-ITEM-03 and CR-04 must be resolved TOGETHER

CR-04 (`ALTER TABLE` to give `fesaOCFocaltec` a time-carrying timestamp column) is the natural
moment to land both changes. Projecting the columns is only useful once `lastUpdate` carries a time
of day; widening the column is only useful once the columns are projected. Landing either alone
delivers nothing:

| Landed alone | Result |
|---|---|
| Projection only (this phase) | Degenerate 00:00-anchored deferral, live only 4 h/day |
| `ALTER TABLE` only (CR-04) | Column widened, still never read — no behaviour change |
| Both | PO deferral works as specified |

**Also update at that time:** the comment at `src/controller/PortalOC_Creator.js:211`, which
currently describes a projection that does not exist, and the intentionally-optimistic fixture
comment in `tests/controller/PortalOC_Creator.cron-where.test.js` (which references this item by
name so a future reader meets the record where the gap lives).

---

*Phase: 20.2-retry-code-vs-real-schema*
*Last updated: 2026-07-28 (plan 20.2-03, Task 3)*
