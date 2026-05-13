# Phase 20: cron-retry-policy-eom-notification - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the `MAX(Autoriza_OC_detalle.Fecha) = CAST(GETDATE() AS DATE)` filter in `PortalOC_Creator.js` and the fixed `AUDTDATE >= ${currentDate}` lookback in `PortalPaymentController.js` with a configurable monthly scope (`current_month` default, env-overridable to rolling N-day) plus exponential-backoff retry derived from existing `fesa.dbo.fesaOCFocaltec` / `fesa.dbo.fesaPagosFocaltec` rows — no schema change. Add an end-of-month operator email to `MAILING_NOTICES` (CC `MAILING_CC`) with HTML tables of pending POs + pagos, gated by `EOM_NOTIFICATION_ENABLED` kill-switch and per-month sentinel files. All cron-tick work runs inline in existing `forResponse()` (no new node-cron task).

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**13 requirements are locked.** See `20-SPEC.md` for full requirements, boundaries, and acceptance criteria.

Downstream agents MUST read `20-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
- Reescribir el WHERE de `PortalOC_Creator.js` para incluir scope + backoff + POSTED-dedupe (3 cambios en el mismo SQL string).
- Reescribir el WHERE de `PortalPaymentController.js` con el mismo patrón aplicado al campo de autorización del pago.
- Nuevo helper `computeBackoffWaitMinutes(errorCount, config)` en `src/utils/RetryPolicy.js` (file location locked here in CONTEXT — see D-04).
- Nuevo helper `shouldDispatchEom(now, sentinelPath, config)` en `src/utils/EomNotification.js` (file location locked here in CONTEXT — see D-04).
- Extender `src/utils/EmailSender.js` con `sendOperatorReport({subject, html, callerLogFile})`.
- Cron-tick guard para EOM dentro de `forResponse()` (no es un task separado de node-cron).
- 7 nuevos env vars + range guards en `src/config.js`.
- Actualizar `.env.example` con los 7 envs documentados (defaults + valid ranges).
- Actualizar `src/scripts/po-cron-diagnostic.js`: Section 4 in-place + nueva Section 6 (backoff state) + verdict-priority reordenada.
- Dos scripts CLI dedicados — `src/scripts/retry-month-pos.js --dry-run` y `src/scripts/retry-month-payments.js --dry-run` — para barrer huérfanos pre-cambio. Default `--dry-run`, `--apply` explicit para mutación. Reusan los helpers de `RetryPolicy.js` para garantizar consistencia con el cron.
- Tests: unit del helper de backoff + EOM gate, integration que mockean `runQuery` para verificar los new WHERE (3 casos por controlador), snapshot del HTML del email.

**Out of scope (from SPEC.md):**
- Schema changes a `fesa.dbo.fesaOCFocaltec` o `fesa.dbo.fesaPagosFocaltec` — todo se deriva.
- Nueva tabla de attempt history — derivable del control table existente.
- Dashboard UI mostrando "attempts" / "next eligible" en `/pos.html` o `/payments.html` — backlog v2.5.
- REST endpoint para forzar retry de PO/pago específico — operador usa scripts existentes.
- Slack / Teams / SMS notification — solo email, alineado con discipline del canal existente.
- Cambios al cron cadence (sigue 15 min, CLAUDE.md §9 invariant).
- Cambios al filtro de 60 minutos desde creación en pagos — ortogonal al scope/backoff.
- Migración de los template-literal SQL strings a queries parametrizadas — CLAUDE.md §6 #1 (patrón establecido del codebase).
- Trabajo de Phase 21 (partial payment policy) — phase separado.
- Email a `LICENSE_ADMIN_EMAIL` para reportes EOM. Excepción: EOM-04 fallback alert sí va a admin como señal de salud del notification path.
- Backfill de huérfanos viejos (>1 mes) — fuera del scope mensual configurado. Si el operador necesita, corre el script con `RETRY_SCOPE=last_n_days RETRY_LOOKBACK_DAYS=60`.

</spec_lock>

<decisions>
## Implementation Decisions

### Backoff filter shape (covers RETRY-04, RETRY-06, RETRY-07)
- **D-01:** Backoff math runs in JS post-filter, not in the SQL WHERE. The cron query pre-fetches all rows in scope (with `errorCount` + `lastErrorAt` pulled in the same SELECT via `OUTER APPLY`), then JS filters using `computeBackoffWaitMinutes(errorCount, config)`. Single source of truth for the formula (the diagnostic script and the cron path both call the same helper). Pulls a few extra rows in error state but bounded by 1 month of authorizations.
- **D-02:** Per-row `errorCount` + `lastErrorAt` come from `OUTER APPLY (SELECT COUNT(*) AS errorCount, MAX(lastUpdate) AS lastErrorAt FROM fesa.dbo.fesaOCFocaltec WHERE ocSage = A.PONUMBER AND idDatabase = '${db}' AND status = 'ERROR') AS ef` added to the existing `PortalOC_Creator.js` query. Same OUTER APPLY pattern in `PortalPaymentController.js` against `fesaPagosFocaltec` (joining on the payment's NoPagoSage equivalent — confirm field name in plan-phase). Single round-trip per controller. Cross-DB fully-qualified ref already used in current code (`PortalOC_Creator.js:215-222`).
- **D-03:** POSTED dedupe stays in the WHERE (`AND NOT EXISTS (SELECT 1 FROM fesa.dbo.fesaOCFocaltec WHERE ocSage = A.PONUMBER AND idDatabase = '${db}' AND status = 'POSTED')`) per RETRY-06. Per-row POSTED rows are not pulled into the JS post-filter; only ERROR rows go through OUTER APPLY for backoff calc. The redundant POSTED check inside the loop (`PortalOC_Creator.js:215-227`) is removed.

### Helper organization
- **D-04:** Two new files in `src/utils/`. **`RetryPolicy.js`** exports `computeBackoffWaitMinutes(errorCount, backoffConfig)`, `buildScopeWhere(scopeConfig)`, and `buildErrorStatsApply({fesaTable, joinKey, dbAlias})`. **`EomNotification.js`** exports `shouldDispatchEom(now, sentinelPath, eomConfig)`, `buildEomEmailHtml(rows, category)`, `writeSentinelAtomically(path, payload)`, and `readSentinelPayload(path)`. Matches one-file-per-helper pattern (`AdminEmailSender.js`, `PortalClient.js`, `LogGenerator.js`, `duration.js`). Two unrelated concerns; separate files keep blast radius small.
- **D-05:** OUTER APPLY SQL fragment is built by `buildErrorStatsApply({fesaTable, joinKey, dbAlias})` in `RetryPolicy.js` — controllers call it as `${buildErrorStatsApply({fesaTable: 'fesa.dbo.fesaOCFocaltec', joinKey: 'A.PONUMBER', dbAlias: databases[index]})}` inside their template-literal queries. Single source of truth for the OUTER APPLY shape across `PortalOC_Creator.js`, `PortalPaymentController.js`, and `po-cron-diagnostic.js` Section 6.
- **D-06:** `EmailSender.sendOperatorReport({subject, html, callerLogFile})`. Internally reads `to = config.mailing.notices.join(',')` (full list, not `notices[position]`) and `cc = config.mailing.cc`. Mirrors `AdminEmailSender.sendAdminAlert(subject, html, callerLogFile)` shape exactly — `callerLogFile` preserves `[OPERATOR-EMAIL]` log routing per quick-260502-i7l pattern. SMTP failure swallowed (warn log). Existing `sendMail({data})` export untouched.
- **D-07:** Sentinel file write uses write-then-rename for atomicity. `writeSentinelAtomically(path, payload)` does `fs.writeFileSync(`${path}.tmp`, JSON.stringify(payload, null, 2)); fs.renameSync(`${path}.tmp`, path)`. POSIX rename is atomic on the same filesystem; survives crash mid-write. Sentinel content schema: `{timestamp: ISO8601, success: boolean, error?: string, rowCount?: number}`.

### EOM dispatch + scope (covers EOM-01, EOM-02, EOM-03, EOM-04, EOM-05)
- **D-08:** Two emails per dispatch tick — one per category (POs / pagos), all tenants combined. Subjects: `[SageConnect] Pendientes fin de mes — POs — {YYYY-MM}` and `[SageConnect] Pendientes fin de mes — Pagos — {YYYY-MM}`. Each email's table includes a `Tenant` column showing the tenant ID per row. Aggregation across tenants happens in JS after iterating tenant DBs (one query per tenant per category, results concatenated before formatting). Two sentinels: `logs/eom-{YYYY-MM}-pos.sent` and `logs/eom-{YYYY-MM}-payments.sent`.
- **D-09:** EOM data query always uses **full current calendar month** scope, regardless of `config.retry.scope`. The EOM check exists precisely to surface rows that cron is intentionally skipping (e.g., when operator narrows `RETRY_SCOPE=last_n_days`). The EOM data query calls `buildScopeWhere({scope: 'current_month'})` hardcoded — the scope helper accepts override config, the EOM dispatch path does not honor `config.retry.scope`.
- **D-10:** Empty categories still send the email. If a category has zero pending rows on the last day after `EOM_NOTIFICATION_HOUR`, the email is sent with `Sin pendientes en esta categoría este mes` body (per EOM-03). Sentinel set as `success: true, rowCount: 0`. Confirms to operator that the EOM check ran. Silence is ambiguous; an explicit "all clear" is the operational discipline.
- **D-11:** EOM gate hooks into `forResponse()` at the **top, before the tenant loop**. Order: (1) `shouldDispatchEom()` evaluation → (2) if gate passes, dispatch both category emails (each iterates tenants for its data query, aggregates, sends, writes sentinel) → (3) proceed to normal tenant loop (the 7 existing steps). Wrap the EOM dispatch with `withStepTimeout(promise, config.schedule.stepTimeoutMs, 'step=eomDispatch')` so a slow EOM query doesn't kill the rest of the tick — same defense-in-depth pattern as the 7 existing steps (CLAUDE.md §9).

### Test strategy + log routing
- **D-12:** Two-layer coverage for the new WHEREs. **(Layer 1)** Unit tests for pure builders in `tests/utils/RetryPolicy.test.js` — assert exact SQL substrings (`DATEFROMPARTS`, `OUTER APPLY`, `NOT EXISTS`, `status = 'POSTED'`) for each input config combo. **(Layer 2)** Integration tests in `tests/controller/PortalOC_Creator.cron-where.test.js` and `tests/controller/PortalPaymentController.cron-where.test.js` — `jest.mock` `runQuery` to return canned recordsets; assert controller behavior across 3 cases per controller (POSTED skip, ERROR-in-backoff skip, ERROR-out-of-backoff include). Same `jest.mock('../src/config', ...)` pattern as existing `tests/EmailSender.test.js`.
- **D-13:** Backoff-defer logging is **per-row + summary**. After OUTER APPLY fetch + JS filter, controller emits per-row `[BACKOFF-DEFER] PO ${id} tenant=${db} attempts=${n} nextEligibleAt=${ts}` for each deferred row, plus a single rolled-up `[BACKOFF] tenant=${db} candidates=${X} deferred=${Y} processing=${Z}` at the start of the loop. Same logFile as the controller (`PortalOC_Creator` / `PortalPaymentController`). Operators grep `[BACKOFF-DEFER]` for a specific row; `[BACKOFF]` for per-tick metric. Mirrors the `[TIMEOUT] step=...` pattern from v2.3.
- **D-14:** EOM events log to a **new file**: `logs/sageconnect/{date}/EomNotification.log` via `logGenerator('EomNotification', ...)`. Entries: `[EOM-GATE] day=last hour=${h} sentinel=missing | present`, `[EOM-DISPATCH] category=pos rows=${n} sent=true | false err=...`, `[EOM-SENTINEL] path=... payload=...`, `[EOM-SKIP] reason=enabled-false | sentinel-present`. New file but matches per-feature log convention (PortalOC_Creator.log, ForResponse.log, etc.). Helper signature in `EomNotification.js` accepts a `callerLogFile` arg defaulting to `'EomNotification'` so a future caller (e.g., a force-resend admin endpoint) could route entries to its own log file — same callerLogFile pattern as `sendAdminAlert`.
- **D-15:** EOM dispatch path test coverage = **unit + integration + snapshot HTML**. (a) Unit: `shouldDispatchEom(now, sentinelPath, eomConfig)` truth table across 8 input combos (last day Y/N × hour ≥ 18 Y/N × sentinel Y/N). (b) Unit: `writeSentinelAtomically` + `readSentinelPayload` round-trip; rename-failure case with mocked `fs.renameSync` throwing. (c) Integration: full EOM gate flow with mocked clock (via D-16 injection), mocked `runQuery` returning fixture rows, spied `EmailSender.sendOperatorReport`, spied `AdminEmailSender.sendAdminAlert` for the SMTP-failure fallback path. (d) Snapshot: `buildEomEmailHtml(fixedFixtureRows, 'pos')` output matches `tests/fixtures/eom-email-sample.html`. Aligns with SPEC EOM-04 (3 integration tests required) and EOM-03 (snapshot required).
- **D-16:** Clock injection — `shouldDispatchEom(now, sentinelPath, eomConfig)` takes `now` as first arg. Production caller passes `new Date()`; tests pass `new Date('2026-05-31T18:05:00Z')`, `new Date('2026-05-31T17:55:00Z')`, `new Date('2026-05-30T18:05:00Z')`, etc. No `jest.useFakeTimers` needed. Same dependency-injection pattern as `withStepTimeout(promise, ms, context)`. Avoids polluting test setup with global timer mocks.

### Claude's Discretion
- Naming of internal-only fields in the OUTER APPLY result (`errorCount`, `lastErrorAt` are descriptive; if SQL Server objects to either as keyword the planner may pick alternative names).
- Exact subject line wording for the EOM emails — anything matching the SPEC EOM-03 spirit (`SageConnect: Pendientes fin de mes — {YYYY-MM}`) is fine; the format chosen in D-08 is a recommendation, planner can refine.
- HTML email styling beyond the structure locked in EOM-03 (e.g., inline CSS, table border style, color of links). The fixture in `tests/fixtures/eom-email-sample.html` becomes the canonical reference once created.
- Whether `RetryPolicy.js` exports `nextEligibleAt(lastErrorAt, errorCount, config)` as a separate helper or if callers compose `lastErrorAt + computeBackoffWaitMinutes(errorCount, config) * 60000` inline — both fine; the diagnostic script already needs the composed timestamp.

### Folded Todos
- **`2026-04-16-fix-uploadpayments-lookback-to-prevent-missed-payments.md`** — Already absorbed into REQ RETRY-02 by milestone scoping (STATE.md confirms `resolves_phase: 20`). Phase 20's WHERE rewrite for `PortalPaymentController.js` is the resolution. The todo file stays in `pending/` until phase ships; planner should add it to the cleanup checklist.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 20 specs (locked)
- `.planning/phases/20-cron-retry-policy-eom-notification/20-SPEC.md` — Locked requirements (13 REQs), boundaries, constraints, acceptance criteria, ambiguity report. **MUST read before planning.**
- `.planning/REQUIREMENTS.md` — v2.4 milestone requirements with traceability table.
- `.planning/ROADMAP.md` § Phase 20 — Goal statement and success criteria.

### Project rules (load-bearing)
- `CLAUDE.md` § 0 — Production-safety policy (ask-before-act discipline).
- `CLAUDE.md` § 3 — Always-on patterns; new env-var ranges follow timeout-guard pattern at `src/config.js:186-208`.
- `CLAUDE.md` § 6 #1 — SQL injection pattern density; do not introduce new mutated sites with parameterized queries; new template-literal interpolation OK with range-guarded envs.
- `CLAUDE.md` § 6 #2 — `runQuery` default trap; pass `'FESA'` and `databases[index]` explicitly. New code touches both DBs (FESA control table + tenant DB).
- `CLAUDE.md` § 6 #3 — Pre-existing failing tests baseline; verify new tests don't change the failed-suite set.
- `CLAUDE.md` § 9 — Defense-in-depth invariant; EOM dispatch step wrapped with `withStepTimeout` to respect step (5m) tier.
- `HANDOFF.md` § 1 — Redaction (no third-party names in commits, comments, log messages).
- `HANDOFF.md` § 6 — Dry-run default for the `retry-month-*.js` scripts; `--apply` opt-in.
- `HANDOFF.md` § 7 — Double verification (Focaltec portal + control table) — applies to the diagnostic script's verdict logic.

### Code surfaces touched
- `src/controller/PortalOC_Creator.js` lines 176-185 (WHERE) + 215-227 (loop POSTED check to remove).
- `src/controller/PortalPaymentController.js` lines 60-148 (WHERE + 60-min filter).
- `src/services/CronScheduler.js` lines 50-180 (`initScheduler`, cron tick callback).
- `src/background.js` lines 28-325 (`forResponse`, where EOM gate hooks in).
- `src/utils/EmailSender.js` (extend with `sendOperatorReport`).
- `src/utils/AdminEmailSender.js` (template for `callerLogFile` pattern; reuse for SMTP-failure fallback).
- `src/utils/duration.js` (`withStepTimeout` wrapper for the new EOM dispatch step).
- `src/utils/SQLServerConnection.js` (`runQuery(query, db)` — explicit `db` arg discipline).
- `src/config.js` lines 180-208 (env-var range-guard pattern to follow for the 7 new envs).
- `src/scripts/po-cron-diagnostic.js` Section 4 + new Section 6.

### Codebase intel
- `.planning/codebase/ARCHITECTURE.md` § "Always-On Patterns" — Why every new state-retaining primitive needs explicit lifetime bounds.
- `.planning/codebase/CONCERNS.md` § Tech Debt — full list of SQL-injection sites to avoid widening.
- `.planning/codebase/CONVENTIONS.md` — Logging conventions (`logGenerator(LOG_FILE, level, message)`); per-module `LOG_FILE` const at top.
- `.planning/codebase/TESTING.md` — Pre-existing failure baseline.
- `.planning/PROJECT.md` § Recently Shipped — v2.3 always-on hardening that this phase builds on.

### Forensic context
- `.planning/forensics/report-20260427-220000.md` — 5 always-on bugs in 1h56m post-deploy; the canonical example of what skipping plan-phase costs. Keeps the bar honest.

### Folded todo
- `.planning/todos/pending/2026-04-16-fix-uploadpayments-lookback-to-prevent-missed-payments.md` — Resolved by REQ RETRY-02; planner adds the `git rm` of the file to the phase cleanup checklist (or to `.planning/STATE.md` Deferred Items table when phase ships).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/utils/AdminEmailSender.js`** — Template for the new `sendOperatorReport` extension in `EmailSender.js`. The `callerLogFile` parameter pattern preserves per-feature log routing; copy the same try/catch + `logGenerator(callerLogFile, 'warn', ...)` swallow on SMTP failure.
- **`src/utils/duration.js` `withStepTimeout(promise, ms, context)`** — Wrap the EOM dispatch step in this to honor the defense-in-depth tier (CLAUDE.md §9). Sentinel string `'Step timeout'` is load-bearing for log routing detection.
- **`src/utils/PortalClient.js`** — Singleton axios client with 30s timeout. The EOM email path doesn't hit Portal API; the Focaltec status check happens implicitly via `fesa.*` rows. No new portal calls.
- **`src/services/CronScheduler.js` lines 100-150**: Existing `[TIMEOUT] step=startChildProcess ... action=admin-email-dispatched` pattern is the model for the new `[EOM-DISPATCH]` log lines.
- **`src/scripts/po-cron-diagnostic.js`** — Already needs the WHERE replica (Section 4) and now needs `computeBackoffWaitMinutes` (new Section 6). Extracting the helpers to `RetryPolicy.js` (D-04) makes the diagnostic-script update a clean composition rather than a copy-paste.

### Established Patterns
- **Per-module `LOG_FILE` const** — `const LOG_FILE = 'EomNotification'` at top of `EomNotification.js`; same convention as every existing `src/utils/*.js`.
- **Singleton helpers** — `RetryPolicy.js` and `EomNotification.js` are stateless modules (pure functions only, no module-scope `Map`/`Set`/timer). Clean against CLAUDE.md §3.
- **Range-guard at boot** — Pattern at `src/config.js:186-208` for the 4 timeout envs is the template for the 7 new envs (`RETRY_SCOPE`, `RETRY_LOOKBACK_DAYS`, `RETRY_BACKOFF_INITIAL_MIN`, `RETRY_BACKOFF_MULTIPLIER`, `RETRY_BACKOFF_MAX_MIN`, `EOM_NOTIFICATION_HOUR`, `EOM_NOTIFICATION_ENABLED`). `[CONFIG ERROR]` exit 1 on out-of-range. Each guard placed adjacent to the env's `parseInt`/`parseFloat` line.
- **`runQuery(query, db)` explicit DB arg** — Every new `runQuery` site in this phase passes `db` explicitly. Queries against `fesa.dbo.*` pass `'FESA'`; queries against tenant DBs (Sage 300 schema with `Autoriza_OC*`, `APBTA`, `BKACCT`, `APTCR`) pass `databases[index]`.
- **Template-literal SQL with interpolation of `${database}`** — Established codebase pattern (CLAUDE.md §6 #1). New WHERE additions use the same form. Variables come from range-guarded envs (safe) or per-tenant `databases[index]` (controlled list, not user input).
- **`sendOperatorReport({subject, html, callerLogFile})` mirrors `sendAdminAlert(subject, html, callerLogFile)`** — the v2.3 quick-260502-i7l pattern (PATTERNS.md §S-6 third-use trigger). `EmailSender` will have 2 exports (`sendMail`, `sendOperatorReport`); `AdminEmailSender` already has 2 (`sendAdminAlert`, `findLastOpenStep`). Symmetric shape across the two senders.
- **Cron-tick guard pattern** — EOM gate is a step at the start of `forResponse()`, evaluated unconditionally on each tick; the gate itself is cheap (date check + sentinel `fs.existsSync`). This is the cron-aligned analog of the cron-tick license re-validation at `CronScheduler.js:75-79`.

### Integration Points
- **`forResponse()` start (`src/background.js:28-40`)** — EOM gate evaluation is inserted here, before the `for (let i = 0; i < tenantIds.length; i++)` loop. Gate is itself wrapped in `withStepTimeout` to respect defense-in-depth.
- **`PortalOC_Creator.js` SQL build site (lines 1-188)** — The full SQL string assembly. New WHERE additions: scope filter (RETRY-01), backoff OUTER APPLY (RETRY-04 supporting data), POSTED NOT EXISTS (RETRY-06).
- **`PortalPaymentController.js` SQL build site (lines 23-100)** — Same 3 changes applied to the payment WHERE. Authorization-date field for payments needs verification in plan-phase (likely `P.AUDTDATE` or a derived field).
- **`src/config.js:180-208`** — 7 new env-var blocks (parseInt/parseFloat + range guard) added adjacent to the existing timeout guards. New config namespaces: `config.retry.{scope, lookbackDays}`, `config.retry.backoff.{initialMin, multiplier, maxMin}`, `config.eom.{notificationHour, notificationEnabled}`.
- **`.env.example`** — New section "## Phase 20 — Retry policy + EOM notification" listing all 7 envs with defaults + valid ranges + brief descriptions.
- **`logs/` directory** — Already in `.gitignore`. Sentinels (`logs/eom-{YYYY-MM}-{pos|payments}.sent`) survive `git reset --hard` because they're outside the repo tracked tree. Plan-phase verifies this in pre-flight checks.
- **`tests/fixtures/eom-email-sample.html`** — New fixture file for the EOM HTML snapshot test (D-15-d). Created in plan-phase; checked into the repo.
- **`tests/controller/`** — Existing dir for controller tests; new files `PortalOC_Creator.cron-where.test.js` and `PortalPaymentController.cron-where.test.js` land here.
- **`tests/utils/`** — Existing dir for util tests; new files `RetryPolicy.test.js` and `EomNotification.test.js` land here.

</code_context>

<specifics>
## Specific Ideas

- The diagnostic script `po-cron-diagnostic.js` Section 6 verdict-priority order locked in SPEC: (1) POSTED → "ya está procesada"; (2) ERROR + dentro de backoff window → "esperando backoff hasta ${nextEligibleAt}"; (3) ERROR + fuera de backoff window → "lista para reintentar en el próximo tick"; (4) cero filas en fesa → "nunca intentada, debe entrar en el próximo tick"; (5) fuera del scope → "fuera de RETRY_SCOPE, ignorada".
- The `[BACKOFF-DEFER]` per-row log line format is exact: `[BACKOFF-DEFER] PO ${id} tenant=${db} attempts=${n} nextEligibleAt=${ts}` — the per-row messages should match the diagnostic script's verdict text closely so operators can correlate cron logs with diagnostic output without translation.
- The EOM email subject is per-category — operators filter by subject (e.g., a Gmail filter for `subject:"Pendientes fin de mes — POs"`) — keep this format stable; do NOT include the tenant or counts in the subject line (those go in the body).
- `BASE_URL` for the dashboard footer links is read from `config.app.baseUrl` (or new env `DASHBOARD_BASE_URL` if not present today — planner verifies in plan-phase). Default to `http://localhost:3030` for dev; ops sets the prod URL via env.
- Empty-category email body still includes the standard footer links so operator can confirm the dashboards are live, even when there's nothing to inspect.

</specifics>

<deferred>
## Deferred Ideas

None — all four discussed areas stayed within phase scope. The SPEC's "Out of scope" list already captures the deferral candidates (no schema change, no Slack, no dashboard UI for retry visibility, no REST endpoint to force retry, no backfill script for >1-month orphans).

### Reviewed Todos (not folded)
None — only one todo matched and it was folded (D-folded-todo above).

</deferred>

---

*Phase: 20-cron-retry-policy-eom-notification*
*Context gathered: 2026-05-13*
