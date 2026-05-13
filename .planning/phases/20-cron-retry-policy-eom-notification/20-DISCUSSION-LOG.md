# Phase 20: cron-retry-policy-eom-notification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 20-cron-retry-policy-eom-notification
**Areas discussed:** Backoff filter shape, Helper organization, EOM dispatch + scope, Test strategy + log routing

---

## Backoff filter shape

### Q1: Where does the backoff math execute in the production cron path?

| Option | Description | Selected |
|--------|-------------|----------|
| JS post-filter | Pre-fetch all rows in scope (with errorCount + lastErrorAt via OUTER APPLY), then filter in JS using computeBackoffWaitMinutes. Single source of truth for the formula; trivial to log [BACKOFF-DEFER] per row; pulls a few extra rows but bounded by 1 month of authorizations. | ✓ |
| SQL CASE in WHERE | Express the formula entirely in SQL (NOT EXISTS with CASE WHEN errorCount=1 THEN 15 WHEN errorCount=2 THEN 30 ...). One query, no extra rows, but the formula now lives in two places (JS for diagnostic, SQL for cron) — divergence risk. No natural way to emit per-row deferred logs. | |
| Per-row literal injection | Pre-pass query fetches errorCount per candidate, then build the main WHERE with NOT EXISTS clauses parameterized per-row by JS. Combines the round-trip cost with complex SQL string building — picks up no advantage over option 1. | |

**User's choice:** JS post-filter (Recommended)
**Notes:** This locks `computeBackoffWaitMinutes` as the single formula source — used by both the cron path and the diagnostic script. Couples cleanly with the [BACKOFF-DEFER] log decision in D-13.

### Q2: How should the cron query surface per-row errorCount + lastErrorAt to JS?

| Option | Description | Selected |
|--------|-------------|----------|
| OUTER APPLY in main query | Add OUTER APPLY (SELECT COUNT(*) AS errorCount, MAX(lastUpdate) AS lastErrorAt FROM fesa.dbo.fesaOCFocaltec WHERE ocSage=A.PONUMBER AND idDatabase='${db}' AND status='ERROR') AS ef. Single round-trip. Cross-DB fully-qualified ref already in use (PortalOC_Creator.js:215-222). Same OUTER APPLY pattern in PortalPaymentController.js. | ✓ |
| Separate post-fetch query | Main query fetches candidates only. Then a second GROUP BY query to fetch errorCount/lastErrorAt for the IN-list. One extra round-trip per controller per tick — simpler SQL, two queries. | |
| Per-row scalar subqueries in SELECT | Add (SELECT COUNT(*)...) AS errorCount and (SELECT MAX(...)) AS lastErrorAt directly in SELECT list. Same round-trip as OUTER APPLY but the optimizer plans them as correlated subqueries — OUTER APPLY is the clearer intent. | |

**User's choice:** OUTER APPLY in main query (Recommended)
**Notes:** Confirms the cross-DB reference pattern (`fesa.dbo.fesaOCFocaltec`) is fine inside a query rooted in the tenant DB. Same shape replicates for the payment controller against `fesaPagosFocaltec`.

### Q3: What output format for retry-month-pos.js / retry-month-payments.js --dry-run?

| Option | Description | Selected |
|--------|-------------|----------|
| Human table to stdout + log file | Console: aligned table (PO/payment ID, tenant, fecha autorización, errorCount, nextEligibleAt, verdict). Also writes logs/retry-month-{pos|payments}-{YYYY-MM-DD}.log via logGenerator. Operator scans visually; the log line is the audit trail. Matches the existing diagnostic-script pattern. | ✓ |
| JSON to stdout | Single JSON array on stdout. Pipe-friendly (jq filtering). Loses at-a-glance readability and gives no log file by default. | |
| CSV file | Write CSV to logs/retry-month-pos-{YYYY-MM-DD}.csv and print 'Wrote N rows to ...'. Good for Excel review by operations. But dry-run is usually inspect-then-apply — needing to open Excel between steps slows the loop. | |

**User's choice:** Human table to stdout + log file (Recommended)
**Notes:** Aligns with existing diagnostic-script UX. Operator runs the script, scans the table, decides whether to `--apply`.

### Q4: What does --apply mode actually do in retry-month-*.js?

| Option | Description | Selected |
|--------|-------------|----------|
| Call existing controller fn | --apply iterates the dry-run candidate list and calls createPurchaseOrders / uploadPayments per tenant. Guarantees identical behavior — script becomes a 'force a cron tick now scoped to these orphans' operation. Reuses the new WHERE+OUTER APPLY code path; no parallel impl to drift. | ✓ |
| Call portal API directly per row | Script bypasses the controller, builds payload + POSTs directly. Faster for one-off retries but duplicates payload-building logic and skips the ERROR/POSTED row insertion in fesa.* — control table would diverge. | |
| Print recommended commands | --apply prints the list of operator commands to run (e.g., node src/scripts/po-upload.js PO0083449 ...) and exits. Most conservative but doesn't actually apply anything. | |

**User's choice:** Call existing controller fn (Recommended)
**Notes:** Keeps the production code path as the single source of truth. Scripts are thin wrappers that filter to a subset of rows.

---

## Helper organization

### Q1: Where should computeBackoffWaitMinutes (RETRY-04) and shouldDispatchEom (EOM-01) live?

| Option | Description | Selected |
|--------|-------------|----------|
| Two new files | src/utils/RetryPolicy.js (backoff helper) + src/utils/EomNotification.js (EOM helper). Matches one-file-per-helper pattern (AdminEmailSender, PortalClient, LogGenerator). Two unrelated concerns — separate files keep blast radius small. | ✓ |
| Combined CronGates.js | Single file with both backoff and EOM helpers grouped. Trade-off: file becomes the dumping ground for any future cron gate logic (Phase 21 partial-payment policy probably wants a similar gate — file grows). | |
| Inline in controllers + background | computeBackoffWaitMinutes inline in PortalOC_Creator.js + PortalPaymentController.js. shouldDispatchEom inline in background.js. Avoids new files; loses diagnostic-script reuse path. | |

**User's choice:** Two new files (Recommended)
**Notes:** Each file becomes the canonical home for its concern. Diagnostic script's Section 6 update becomes a clean import.

### Q2: Where does the OUTER APPLY join SQL fragment (errorCount + lastErrorAt) live?

| Option | Description | Selected |
|--------|-------------|----------|
| Builder in RetryPolicy.js | RetryPolicy.js exports buildErrorStatsApply({fesaTable, joinKey, dbAlias}) returning the SQL fragment string ready to interpolate. Controllers call it as `${buildErrorStatsApply(...)}` inside their template-literal queries. One source of truth for the OUTER APPLY shape. | ✓ |
| Hardcoded per-controller | Each controller writes its own OUTER APPLY clause inline. Two near-identical SQL fragments. Simpler to read but if the shape needs adjustment it must be edited in two places + the diagnostic script if it uses the same shape. | |
| Shared SQL constants file | src/utils/sql-fragments.js exports literal strings. Same as option 1 but as constants, not a builder. Loses parameterization — fesa table and join key vary between controllers. | |

**User's choice:** Builder in RetryPolicy.js (Recommended)
**Notes:** Builder accepts `{fesaTable, joinKey, dbAlias}` so the same function emits the correct fragment for both controllers and the diagnostic script.

### Q3: EmailSender.js extension shape for sendOperatorReport (EOM-06)?

| Option | Description | Selected |
|--------|-------------|----------|
| {subject, html, callerLogFile} | Internally reads to=config.mailing.notices.join(',') and cc=config.mailing.cc. Mirrors AdminEmailSender.sendAdminAlert(subject, html, callerLogFile) exactly. callerLogFile preserves [OPERATOR-EMAIL] log routing per quick-260502-i7l pattern. SMTP failure swallowed. | ✓ |
| {to, cc, subject, html} — caller-supplied recipients | Caller passes to and cc explicitly. More flexible but the only caller (EOM dispatch) always wants the same routing. Adds risk of caller passing wrong list. | |
| {subject, html} — minimal, no callerLogFile | Smallest possible signature. Loses [OPERATOR-EMAIL] log routing convention; failures land in fixed EmailSender.log instead of caller's log file. | |

**User's choice:** {subject, html, callerLogFile} (Recommended)
**Notes:** Symmetric with sendAdminAlert. Preserves the v2.3 quick-260502-i7l pattern of routing log entries to the caller's log file.

### Q4: Sentinel file write strategy for logs/eom-{YYYY-MM}-{pos|payments}.sent (EOM-04)?

| Option | Description | Selected |
|--------|-------------|----------|
| Write-then-rename | fs.writeFileSync(`${path}.tmp`, JSON.stringify(payload)); fs.renameSync(`${path}.tmp`, path). POSIX rename is atomic on the same filesystem; survives crash mid-write. | ✓ |
| fs.writeFileSync with flag:'wx' | Single call with exclusive create flag (fails if file exists). Doesn't actually solve the half-written-file problem; only prevents accidental overwrite. Doesn't survive a crash mid-write. | |
| writeFileSync with no atomicity guard | Plain fs.writeFileSync. Simplest. The only failure window is process crash between write start and fsync, which on Windows is short. But the recovery path (corrupt sentinel → emails won't re-send) is worse than the prevention cost. | |

**User's choice:** Write-then-rename (Recommended)
**Notes:** Sentinel content schema: `{timestamp: ISO8601, success: boolean, error?: string, rowCount?: number}`. The rowCount field surfaces "Sin pendientes" cases (rowCount: 0, success: true) for retrospective audit.

---

## EOM dispatch + scope

### Q1: On the last day at 18:00, what does the EOM email volume look like?

| Option | Description | Selected |
|--------|-------------|----------|
| 2 emails per tick — one per category, all tenants combined | Subjects: '[SageConnect] Pendientes fin de mes — POs — {YYYY-MM}' and '[...] Pagos — {YYYY-MM}'. Each email has one table with a Tenant column. Aggregation across tenants happens in JS after iterating. | ✓ |
| 2×N emails per tick — per tenant per category | If 5 tenants, 10 emails per dispatch. Each email is shorter and tenant-scoped, but inbox volume scales with tenant count. Sentinel naming becomes per-tenant per-category. | |
| 1 email — both categories grouped, all tenants | Single email with two tables (POs / pagos), each with Tenant column. Smallest email count. Sentinel naming becomes per-month (just one). | |

**User's choice:** 2 emails per tick — one per category, all tenants combined (Recommended)
**Notes:** Two sentinels: `logs/eom-{YYYY-MM}-pos.sent` and `logs/eom-{YYYY-MM}-payments.sent`. Each category dispatches independently; if pos sends and payments fails, sentinels reflect the per-category outcome.

### Q2: When RETRY_SCOPE=last_n_days, what data does the EOM email show?

| Option | Description | Selected |
|--------|-------------|----------|
| Always full calendar month | EOM email always queries full current calendar month regardless of cron's RETRY_SCOPE. The EOM check exists precisely to surface rows that cron is intentionally skipping — surfacing them is the WHOLE POINT. | ✓ |
| Mirror cron's RETRY_SCOPE | EOM email uses the same WHERE the cron uses. Trade-off: if RETRY_SCOPE=last_n_days with LOOKBACK=7, the EOM email at month end only shows the last week — older rows that need attention are silently absent. | |
| Both: two sections per email | Email body has two sections: 'Pendientes en RETRY_SCOPE' and 'Pendientes adicionales este mes'. More info, more clutter. | |

**User's choice:** Always full calendar month (Recommended)
**Notes:** EOM dispatch path calls `buildScopeWhere({scope: 'current_month'})` hardcoded — independent of `config.retry.scope`. Decouples EOM data from cron operational config.

### Q3: If a category has zero pending rows on the last day, does the email still send?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — send 'Sin pendientes' | Send the email with the 'Sin pendientes en esta categoría este mes' message (per EOM-03). Sentinel set as success. Confirms to the operator that the EOM check ran. | ✓ |
| No — skip send, write sentinel | Skip the SMTP call when row list is empty. Sentinel still written so we don't recheck this month. Trades visibility for inbox tidiness. Operator must trust silence = success. | |
| No email, no sentinel — keep checking next tick | Skip both. Each subsequent tick on the last day re-evaluates. Picks up rows that arrive after 18:00 on the last day. But: re-runs the query every 15 min, no clear stop condition. | |

**User's choice:** Yes — send 'Sin pendientes' (Recommended)
**Notes:** Operational discipline: silence is ambiguous, an explicit "all clear" is better. Sentinel records `rowCount: 0, success: true` for the empty case.

### Q4: Where does the EOM gate evaluation hook into forResponse() / CronScheduler?

| Option | Description | Selected |
|--------|-------------|----------|
| Top of forResponse, before tenant loop | shouldDispatchEom() called once per cron tick BEFORE the for(i=0; i<tenantIds.length) loop. If gate passes, dispatch both category emails (each does its own multi-tenant query), write both sentinels, then proceed to normal tenant loop. EOM never duplicates per-tenant. | ✓ |
| Inside CronScheduler.js task callback, before forResponse() | EOM gate runs in the cron task callback BEFORE forResponse() is invoked. Cleaner separation but: forResponse is also called from manual triggers; those wouldn't get EOM checks (probably OK). | |
| End of forResponse, after tenant loop | EOM gate runs AFTER all 7×N tenant steps complete. Simpler logic flow. Trade-off: if any earlier step throws, EOM never runs even though the gate condition is met. | |

**User's choice:** Top of forResponse, before tenant loop (Recommended)
**Notes:** Wrapped with `withStepTimeout(promise, config.schedule.stepTimeoutMs, 'step=eomDispatch')` to honor defense-in-depth tier (CLAUDE.md §9). EOM dispatch is now a step like the other 7.

---

## Test strategy + log routing

### Q1: How do we verify the new WHERE behavior in PortalOC_Creator.js / PortalPaymentController.js?

| Option | Description | Selected |
|--------|-------------|----------|
| Pure WHERE-builder helpers + integration with mocked runQuery | buildScopeWhere(scopeConfig) and buildErrorStatsApply(...) in RetryPolicy.js are pure functions — unit-test the SQL strings directly. Plus integration tests in tests/controller/ that mock runQuery and assert behavior. Two-layer coverage: SQL shape + behavior. | ✓ |
| Integration only — mock runQuery, assert behavior | Skip the pure-helper unit tests. Just mock runQuery and assert which rows get processed. Less code, but a SQL shape regression is only caught at runtime. | |
| Snapshot test golden SQL files | Generate the SQL string and snapshot it. Captures regressions but adds a maintenance loop on every legitimate WHERE change — most snapshot updates are noise. | |

**User's choice:** Pure WHERE-builder helpers + integration with mocked runQuery (Recommended)
**Notes:** Layer 1: tests/utils/RetryPolicy.test.js asserts SQL substrings. Layer 2: tests/controller/PortalOC_Creator.cron-where.test.js + tests/controller/PortalPaymentController.cron-where.test.js mock runQuery for 3 cases each (POSTED skip, ERROR-in-backoff skip, ERROR-out-of-backoff include).

### Q2: When the cron WHERE skips a row due to backoff, what gets logged?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-row + summary line | Per-row '[BACKOFF-DEFER] PO ${id} tenant=${db} attempts=${n} nextEligibleAt=${ts}' for each deferred row, plus a single rolled-up '[BACKOFF] tenant=${db} candidates=${X} deferred=${Y} processing=${Z}' summary at the start of the loop. | ✓ |
| Summary line only | Just the '[BACKOFF] tenant=${db} candidates=X deferred=Y processing=Z' summary. Smaller log volume; if operator needs per-PO detail they run po-cron-diagnostic.js. Trade-off: forensics can't reconstruct deferred-set history without re-running the diagnostic. | |
| Silent (no log) | JS filter drops deferred rows quietly. Smallest log footprint. But: silent deferral risks the Phase 17 forensic pattern (a behavior change you can't see in logs is one you can't troubleshoot). | |

**User's choice:** Per-row + summary line (Recommended)
**Notes:** Operators grep [BACKOFF-DEFER] for a specific row; [BACKOFF] for per-tick metric. Same logFile as the controller (PortalOC_Creator / PortalPaymentController).

### Q3: How are the EOM-related events logged?

| Option | Description | Selected |
|--------|-------------|----------|
| EomNotification log file | All EOM events go to logs/sageconnect/{date}/EomNotification.log via logGenerator('EomNotification', ...). Entries: '[EOM-GATE]', '[EOM-DISPATCH]', '[EOM-SENTINEL]', '[EOM-SKIP]'. New file but matches per-feature log convention. | ✓ |
| Reuse ForResponse.log | EOM entries land in the same ForResponse.log as the cron tick. Less file proliferation. Trade-off: EOM events get interleaved with 7×N step entries per tick — grep noise. | |
| Reuse CronScheduler.log | Same as option 2 but in CronScheduler.log. Mixes EOM with operational concerns of a different layer. | |

**User's choice:** EomNotification log file (Recommended)
**Notes:** Helper accepts callerLogFile arg defaulting to 'EomNotification' so a future caller could route to its own file (same pattern as sendAdminAlert).

### Q4: What's the test coverage target for the EOM dispatch path?

| Option | Description | Selected |
|--------|-------------|----------|
| Unit + integration + snapshot HTML | (a) Unit: shouldDispatchEom truth table 8 combos. (b) Unit: writeSentinelAtomically + readSentinelPayload round-trip. (c) Integration: full EOM gate flow with mocked clock + runQuery + spied EmailSender + spied AdminEmailSender for SMTP failure. (d) Snapshot: buildEomEmailHtml fixed input → tests/fixtures/eom-email-sample.html. | ✓ |
| Unit only — helpers in isolation | Test the helpers in isolation. Skip integration. Cheaper but misses cross-component bugs. | |
| Manual prod-only verification | Skip automated tests. Verify on the last day of the month in prod. Fastest to ship; defers risk to operator. CLAUDE.md §0 effectively forbids this for any path that touches operator email. | |

**User's choice:** Unit + integration + snapshot HTML (Recommended)
**Notes:** Aligns with SPEC EOM-04 (3 integration tests required) and EOM-03 (snapshot required). Total: ~8-10 new test cases for the EOM path.

### Q5: How do tests handle the clock for EOM gate?

| Option | Description | Selected |
|--------|-------------|----------|
| Inject 'now' as helper arg | shouldDispatchEom(now, sentinelPath, eomConfig) takes 'now' as first arg — production caller passes new Date(); tests pass new Date('2026-05-31T18:05:00Z'), etc. Pure-function shape, no jest.useFakeTimers needed. | ✓ |
| jest.useFakeTimers + Date mocking | Test setup uses fake timers. Production code stays naive about time injection. Trade-off: shouldDispatchEom must be tested via the caller, and other tests in the suite must remember to reset fake timers. | |
| Mock TimezoneHelper.getCurrentDate() | shouldDispatchEom internally calls require('./TimezoneHelper').getCurrentDate(). Tests jest.mock the helper. Codebase has TimezoneHelper precedent already used for cron timezone logic. But: harder to test multiple time scenarios in one test. | |

**User's choice:** Inject 'now' as helper arg (Recommended)
**Notes:** Same dependency-injection pattern as withStepTimeout(promise, ms, context). Makes the helper trivially unit-testable.

---

## Claude's Discretion

- Naming of internal-only fields in the OUTER APPLY result (`errorCount`, `lastErrorAt` are descriptive; if SQL Server objects to either as keyword the planner picks alternatives).
- Exact subject line wording for the EOM emails — anything matching the SPEC EOM-03 spirit is fine.
- HTML email styling beyond the structure locked in EOM-03.
- Whether `RetryPolicy.js` exports `nextEligibleAt(lastErrorAt, errorCount, config)` as a separate helper or callers compose it inline — both fine.

## Deferred Ideas

None — all four discussed areas stayed within phase scope. The SPEC.md "Out of scope" list already captured the deferral candidates (no schema change, no Slack, no dashboard UI for retry visibility, no REST endpoint to force retry, no backfill script for >1-month orphans).
