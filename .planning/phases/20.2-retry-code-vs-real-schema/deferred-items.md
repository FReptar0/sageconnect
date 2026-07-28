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

## D-ITEM-04 — `P.AUDTDATE` compared bare against `DATEFROMPARTS` in two of three payment sites

**Found during:** phase 20.2 code review (`20.2-REVIEW.md` CR-01 / CR-02), 2026-07-28.
**Files:** `src/background.js:488` (EOM payments branch) and `src/scripts/retry-month-payments.js:108`.

### The finding

`P.AUDTDATE` is a Sage `YYYYMMDD` **integer**, not a date. Comparing it bare against `DATEFROMPARTS(...)`
forces an `int → date` implicit conversion, which SQL Server does not perform — the statement fails with
an *Operand type clash* at runtime.

Both sites pass the column unwrapped to `buildScopeWhere`:

```js
// src/background.js:488  and  src/scripts/retry-month-payments.js:108
buildScopeWhere(..., { dateField: 'P.AUDTDATE' })
// emits: P.AUDTDATE >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) AND ...
```

The payment **cron** does it correctly, and has since the Phase 20 RETRY-02 gap closure:

```js
// src/controller/PortalPaymentController.js:76
buildScopeWhere(config.retry, { dateField: 'CONVERT(Date, CONVERT(VARCHAR(8), P.AUDTDATE))' })
```

So the defect was fixed in **one of three** sites. `tests/controller/PortalPaymentController.cron-where.test.js`
even pins the correct form with a paired positive/negative assertion — but only for the cron.

### Consequence

- **EOM report:** `dispatchEomIfDue` swallows the error, the email reports "sin pendientes", and the
  sentinel records `success: true`. Silent — the same failure shape RETRY-S1 exists to eliminate.
- **Operator sweep:** `retry-month-payments.js` throws, so `--apply` never reaches `uploadPayments`.

### Why phase 20.2 did not catch it

Out of SPEC scope. The SPEC scopes three defects (schema validity of the *error-stats* fragment, the
clock skew, and the regression baseline); the scope-WHERE `dateField` argument is a fourth, independent
bug in the same files. The tests added by plans 20.2-05 and 20.2-04 assert `/DATEFROMPARTS|DATEADD\(month/`,
which any fragment satisfies — they check that a scope filter exists, not that its operand types agree.

### Decision: DEFER — developer, 2026-07-28

Not fixed in 20.2. Fixing it means touching the EOM query and the operator sweep, both outside the SPEC,
and the phase was already carrying a code-review fix (CR-03). Recorded here rather than folded in
silently.

**Resolution path.** One line at each site, mirroring `PortalPaymentController.js:76` exactly. Add the
same paired assertion the cron suite uses (`toMatch` the wrapped form, `not.toMatch(/P\.AUDTDATE\s*>=\s*DATEFROMPARTS/)`)
to `tests/integration/eom-dispatch.test.js` and `tests/scripts/retry-month-payments.test.js` — without
the negative half, the guard does not hold.

**Bundle with D-ITEM-05**, which is masked by this one.

---

## D-ITEM-05 — `fechaAuth` rendered through `new Date()` on an integer date

**Found during:** phase 20.2 code review (`20.2-REVIEW.md` CR-04), 2026-07-28.
**File:** `src/utils/EomNotification.js:122`.

The EOM header derives its month label with `new Date(safeRows[0].fechaAuth)`. For the POs branch
`fechaAuth` is a real date and this is correct. For payments it is `P.AUDTDATE`, the `YYYYMMDD` integer,
which JavaScript reads as **milliseconds since epoch**:

```
new Date(20260512).toISOString()  →  1970-01-01T05:37:40.512Z
```

So the `<h1>` would read "— 1969-12" while the subject line, computed elsewhere, reads "— 2026-07".

**Currently masked by D-ITEM-04:** the payments query never returns rows, so the branch is unreachable
in production today. It becomes visible the moment D-ITEM-04 is fixed — which is exactly why the two
must be resolved together.

Both `tests/utils/EomNotification.test.js` and `tests/integration/eom-dispatch.test.js` use ISO-string
fixtures for `fechaAuth`, a row shape the payments query cannot produce. Same class of optimistic
fixture as D-ITEM-03, and unrecorded until now.

**Decision: DEFER**, bundled with D-ITEM-04.

---

## Open code-review findings not promoted to deferred items

`20.2-REVIEW.md` carries 11 warnings beyond the blockers above. Three worth naming here because they
are structural rather than cosmetic:

| ID | Finding | Why it matters |
|---|---|---|
| WR-02 | `buildErrorStatsApply` validates `timestampColumn` against a closed set but never checks it agrees with `fesaTable` — `{fesaPagosFocaltec, 'lastUpdate'}` is accepted and emits invalid SQL | The D-06/D-07 guard stops the *implicit default* trap but not a wrong *explicit* pairing |
| WR-03 | `tests/schema-guard.test.js` is lexical proximity: bracket-quoted `[fesa].[dbo].[fesaPagosFocaltec]`, a concatenated table name, or a violation 13+ lines away all slip past | Documented limitation, not a defect — but the guard should not be read as exhaustive |
| WR-06 | The payments EOM `Intentos` column counts `status NOT IN ('PAID','PARTIAL')`, which no writer produces, so it is structurally always 0 | Same argument D-10 used to remove the error column; this one survived |

---

*Phase: 20.2-retry-code-vs-real-schema*
*Last updated: 2026-07-28 (post code review — D-ITEM-04, D-ITEM-05 added)*
