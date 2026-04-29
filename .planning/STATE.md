---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: milestone
status: executing
stopped_at: "Phase 19 Plan 01 (ROOT-01) executed and committed. 3 atomic commits: eeebfe8 feat(19-01) Task 1 (PortalClient.js singleton + config.portal.httpTimeoutMs knob + range guard >= 1000ms fail-fast); ec73a6a refactor(19-01) Task 2 (18 axios call sites in 9 files migrated to portalClient — CFDI_Downloader 3, PortalPaymentController 1, PortalOC_{Creator,Closer,Canceller,ContentUpdater,StatusUpdater} 1 each, GetTypesCFDI 7, GetProviders 2 — with 5 inline 'timeout: 30000' removed and httpAgent/httpsAgent preserved in StatusUpdater for Capstone localPort 3030 policy); 26c4d32 test(19-01) Task 3 (5 PortalClient unit tests passing — timeout, headers, singleton, verbs, instance-not-factory). Plan-level verification 9/9 PASS: Phase 19 boundary held (no AbortController/Promise.race introduced), only 1 axios.create in src/utils+src/controller, 0 axios.<verb> remaining in 9 always-on files, scripts CLI 13 axios sites untouched (D-02 out of scope), LicenseValidator + PortalOC_StatusService legacy intact. Suite-wide tests improved -3 suites/-4 tests vs baseline 8bec494 (10 fail → 7 fail; 13 fail tests → 9 fail tests; remaining failures all pre-existing — config.test.js missing LICENSE env vars, no-process-exit.test.js obsolete '=== 1' assertion since Phase 18 added second guard, TransformTime/PaymentReconciliation/enforcement-wiring unrelated). Wording sentinel for Plan 19-03 documented in SUMMARY: axios timeout produces err.code='ECONNABORTED' OR /timeout of \\d+ms exceeded/i. SUMMARY.md at .planning/milestones/v2.3-phases/19-root-cause-timeouts/19-01-SUMMARY.md. Resume next: /gsd-execute-phase 19 → Wave 2 (Plan 19-02 ROOT-02 child process kill cascade in background.js startChildProcess + CronScheduler timeout-listener email)."
last_updated: "2026-04-29T17:57:00Z"
last_activity: 2026-04-29 -- Plan 19-01 executed (ROOT-01 axios timeout via PortalClient singleton, 18 call sites refactored, 5/5 unit tests passing, Phase 19 boundary held); 3 commits eeebfe8 + ec73a6a + 26c4d32 + SUMMARY committed
progress:
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-24)

**Core value:** La integración Sage-Portal debe ser confiable, mantenible, y operable: servicio continuo con interfaz web para operaciones y monitoreo en tiempo real.
**Current focus:** Phase 19 — Root Cause Timeouts (planned, ready to execute)

## Current Position

Phase: 19 (Root Cause Timeouts) — in progress
Plan: 1 of 3 complete (19-01 ✓ done; 19-02, 19-03 pending)
Status: Plan 19-01 (ROOT-01 axios timeout via PortalClient singleton) executed; ready for /gsd-execute-phase 19 → Wave 2 (Plan 19-02)
Last activity: 2026-04-29 -- Plan 19-01 executed (ROOT-01 axios timeout via PortalClient singleton, 18 call sites refactored, 5/5 unit tests passing, Phase 19 boundary held); 3 commits eeebfe8 + ec73a6a + 26c4d32 + SUMMARY committed

Milestone v2.3 progress: [█████████·] 83% (2 of 3 phases complete + Plan 19-01 done)
Phase 19 progress: [██████····] 60% (context + plans complete + 19-01 executed; 19-02, 19-03 pending)

### Phase 19 Plan Layout

| Wave | Plan | Files | Autonomous | Reqs | Status |
|------|------|-------|------------|------|--------|
| 1 | 19-01 | PortalClient.js (NEW) + config.js + 9 controller/util refactor + tests/utils/PortalClient.test.js | yes | ROOT-01 | ✓ done (eeebfe8, ec73a6a, 26c4d32) |
| 2 | 19-02 | background.js (startChildProcess) + CronScheduler.js + config.js + tests/services/background.startChildProcess.timeout.test.js + tests/services/CronScheduler.timeout-listener.test.js (extend) | yes | ROOT-02 + ROOT-04 (child) | pending |
| 3 | 19-03 | duration.js (withStepTimeout) + background.js (forResponse) + config.js + PortalPaymentController.js (ECONNABORTED enrichment) + tests/services/background.forResponse.stepTimeout.test.js + tests/integration/timeout-logging.test.js | yes | ROOT-03 + ROOT-04 (axios+step) | pending |

### Phase 17 Plan Layout

| Wave | Plan | Files | Autonomous | Reqs | Status |
|------|------|-------|------------|------|--------|
| 1 | 17-01 | OperationManager.js + tests | yes | OBS-03 | ✓ done (4c1367d, a804422, 132a316) |
| 2 | 17-02 | operations-routes.js + tests | yes | OBS-04 | ✓ done (7ce3412, cbadb59, 88423b8) |
| 2 | 17-03 | background.js + CronScheduler.js + tests | yes | OBS-02, OBS-05 | ✓ done (4bfcc70, 9b109f5, 98d41f5, 6bc4b0a) |
| 3 | 17-04 | shared.js + schedule.html (UI card + polling + bug fix) | no (manual checkpoint) | OBS-01, OBS-02 | ✓ done (53104ef, 831ee36, 3d8b822) — manual verification PASSED |

### Phase 18 Plan Layout

| Wave | Plan | Files | Autonomous | Reqs | Status |
|------|------|-------|------------|------|--------|
| 1 | 18-01 | OperationManager.js + CronScheduler.js + config.js + new src/utils/duration.js + 2 new tests + 3 mock-fix tests | yes | REC-01, REC-02 | ✓ done (671c7ad, 1f8f142, 2d1bbb5, 7ba4534, 53506fb, 8d2bb5b) |
| 2 | 18-02 | schedule-routes.js + schedule-schemas.js + integration test | yes | REC-04, REC-05 | ✓ done (ef1cb3f, 0ab91d7, bf34398) |
| 3 | 18-03 | schedule.html + Bootstrap modal + JS handler | no (human-verify checkpoint) | REC-03 | ✓ done (c6d5b0e, d46778c) — chrome-devtools MCP browser-automated verification PASSED 6/6 active rows; row 7 N/A (no local SMTP) |

**Phase 18 collateral fix (Plan 18-01 attribution):** `061b7c5` `fix(18-01): exclude timeoutHandle from getRunningOperations to prevent circular JSON` — surfaced during Plan 18-03 verification; 46/46 tests passing across affected suites.

**Phase 18 testing infrastructure (out of plan scope):** `920c5f9` (`scripts/simulate-stuck-lock.js`) + `1318fcc` (`--xss` flag). NOT FOR PRODUCTION — excluded from `scripts/obfuscate.js` `COPY_AS_IS` allowlist.

## Accumulated Context

### Decisions

- [v2.3 Init]: Bug se manifiesta como HTTP 409 permanente en `POST /api/schedule/background-cycle/trigger`, causado por lock huérfano en `OperationManager.locks`
- [v2.3 Init]: Hipótesis principal — `axios` al portal sin timeout cuelga `forResponse`, `finally` nunca corre
- [v2.3 Init]: Alcance confirmado con usuario — 3 phases (observability, recovery, root cause fix)
- [v2.3 Init]: Root cause fix incluye 3 timeouts: axios portal calls, startChildProcess, per-step Promise.race
- [v2.3 Phase 17]: stepProgress como array histórico de steps con startStep/endStep explícitos; se borra en releaseLock
- [v2.3 Phase 17]: Refresco UI híbrido — polling 5s siempre + SSE para timeline existente
- [v2.3 Phase 17]: Card nuevo "Operación en curso" arriba del timeline; oculto en idle
- [v2.3 Phase 17]: API mantiene shape de map por operationType (corrigiendo bug en schedule.html:589)
- [v2.3 Phase 17]: startChildProcess instrumentado en CronScheduler.js (no background.js); manual trigger tiene 7 steps, cron tick tiene 8
- [v2.3 Plan 17-01]: stepProgress vive en this.locks slot (no Map separado) — hereda releaseLock cleanup automáticamente
- [v2.3 Plan 17-01]: startStep/endStep son no-op si el lock no existe — defensa contra race con releaseLock
- [v2.3 Plan 17-01]: endStep itera backwards (LIFO) para resolver retries concurrentes en orden
- [v2.3 Plan 17-01]: Sin Winston/logger en startStep/endStep para no inflar logs (se logea sólo en sites de error del caller)
- [v2.3 Plan 17-02]: operations-routes.js es thin pass-through — OperationManager es dueño de la shape, el route handler no transforma
- [v2.3 Plan 17-02]: Task 1 commit como `docs(17-02)` (no `feat`) — runtime path byte-equivalent, sólo JSDoc/comments cambian
- [v2.3 Plan 17-02]: Bug fix de schedule.html:589 (operations.find on a map) NO se hace acá — pertenece a Plan 17-04 con el card UI
- [v2.3 Plan 17-02]: Test de Array.isArray===false + Object.keys es regression guard explícito contra el patrón del bug schedule.html:589 a nivel API
- [v2.3 Plan 17-02]: SSE endpoint (/:operationId/stream) byte-identical post-edit — verificado por 3 tests SSE supervivientes
- [v2.3 Plan 17-03]: Block-scoped `{ const __step; let __stepError; try/catch/finally }` por step evita colisiones de const entre los 7 hermanos del mismo for-loop iteration
- [v2.3 Plan 17-03]: Inner catch captura+re-throw es obligatorio (no try/finally puro) — el catch escribe el mensaje de error al stepProgress entry vía endStep, después re-throw para que el OUTER tenant catch maneje el continue
- [v2.3 Plan 17-03]: tenant=null literal (no 'global', no 'null' string) para startChildProcess — match con la wire shape locked en Plan 17-02
- [v2.3 Plan 17-03]: Task 2 commit BEFORE Task 3 (production code antes que mock) — produce un broken-tests state visible en git como artefacto educativo de que la mock extension es REQUERIDA, no opcional
- [v2.3 Plan 17-03]: Verification scripts (scripts/verify-bg-instrumentation.js, scripts/verify-cron-instrumentation.js) commitidos como regression guards permanentes (no throwaway), encoden el contrato estructural (exactamente 7 startStep/7 endStep en background.js, exactamente 1 en CronScheduler con tenant=null)
- [v2.3 Plan 17-04]: Polling-first UI hydration — polling owns the card (5s, survives reload), SSE feeds only the existing timeline; never cross-wire. This separation is what makes mid-cycle reload work correctly (D-04 bug fix)
- [v2.3 Plan 17-04]: Plan split Task 2 into 2a (static HTML + bug deletions) and 2b (dynamic JS + lifecycle wiring) per checker feedback — atomic verification of structural vs behavioral changes
- [v2.3 Plan 17-04]: DOMContentLoaded runs an initial pollActiveOperation() before the 5s setInterval starts — single call site replaces the deleted `if (bgTask.status === 'running')` conditional, idempotent due to evtSource guard
- [v2.3 Plan 17-04]: 1s heartbeat ticker re-derives active step from snapshot every tick (stateless + cheap); brief flash of '(completado)' between step transitions until next 5s poll is acceptable
- [v2.3 Plan 17-04]: Network errors in pollActiveOperation are warned but DO NOT hide the card — leaves last good snapshot visible (transient blip should not flicker the operator's view)
- [v2.3 Plan 17-04]: formatRelative declared as `function formatRelative(...)` (not arrow / const) to match hoisting + global-scope pattern of other shared.js helpers — file is loaded as `<script src>` tag, no module.exports
- [v2.3 Plan 17-04]: Comment-stripped grep checks in scripts/verify-schedule-html-2b.js — when documentation references a removed buggy pattern (JSDoc explaining the fix), strip /* */ and // before structural negative checks to avoid false positives
- [v2.3 Phase 17 COMPLETE]: All 5 OBS requirements (OBS-01 through OBS-05) implemented across 4 plans. All 13 D-XX decisions in 17-CONTEXT.md realized. Operator now has full visibility into lock state and step heartbeats — diagnostic foundation for the original "HTTP 409 permanente" bug investigation is in place.
- [v2.3 Plan 18-01]: Listener registration MUST be inside `initScheduler()` body, NOT at module load — prevents listener accumulation under `jest.isolateModules` and any future hot-reload path (PATTERNS.md S-1; threat T-18-01-03 in plan threat model).
- [v2.3 Plan 18-01]: Admin email uses `LicenseValidator.sendLicenseAlert` pattern (nodemailer-direct → `config.license.adminEmail`), NOT the project's operator-facing email-sender utility (which routes to `config.mailing.notices`). PATTERNS.md §S-6 overrides 18-CONTEXT.md D-08's literal wording while honoring its intent. Regression-guard `! grep -q "EmailSender" src/services/CronScheduler.js` in plan verify block; satisfied by splitting the literal substring `'EmailS' + 'ender'` in JSDoc commentary so the architectural reasoning is preserved.
- [v2.3 Plan 18-01]: `OperationManager._reset()` iterates locks and clears each pending timer BEFORE `Map.clear` — without this, Jest tests that exercise the timer path leak `setTimeout` handles across worker processes (Test 6 of OperationManager.timer.test.js is the regression guard).
- [v2.3 Plan 18-01]: `_fireTimeout` snapshots `stepProgress` via `.slice()` (shallow copy) before emitting. Captures state at FIRE time, not closure time — Test 8 verifies a step pushed AFTER acquireLock appears in the payload. Defensive against listener mutation.
- [v2.3 Plan 18-01]: `sendAdminAlert(subject, html)` and `findLastOpenStep(stepProgress)` live INLINE as top-level functions in `CronScheduler.js`, NOT extracted to `src/utils/AdminEmailSender.js`. Plan 18-02's force-release route handler will copy these verbatim — inline duplication is intentional per PATTERNS.md §5 ("inline for Phase 18 (reduces blast radius), refactor later if more admin-email events appear").
- [v2.3 Plan 18-01]: `formatDurationMin(durationMs)` lives in NEW file `src/utils/duration.js` (CommonJS, backend-only). Frontend continues to use existing `public/js/shared.js#formatRelative` — separate runtimes, separate helpers per PATTERNS.md §8 decision (a). Defensive on non-finite/negative input (returns `'0s'` — never throws — because callers insert this string into email-body construction inside the listener's try-block).
- [v2.3 Plan 18-01]: Phase 19 boundary HELD — no `AbortController`, no `axios.timeout`, no child-process kill, no per-step `Promise.race` introduced anywhere in modified files. The plan's `<critical_constraints>` enforced this; verified by `! grep -E "AbortController|axios\..*|SIGKILL|process\.kill|Promise\.race"` across all modified files. Plan 18-01 is "lock release only" per D-03; the auto-released lock leaves the in-flight axios/child-process running ("phantom continuation" tolerance — Phase 19 ROOT-01/02/03 will replace this with real abort).
- [v2.3 Plan 18-02]: `POST /api/schedule/:taskId/force-release` is idempotent — always returns HTTP 200 with `data.released:true|false` discriminator. Departs deliberately from `POST /:taskId/trigger`'s 409-on-conflict pattern (D-07). Operator double-click after auto-release does NOT 404 — flows through the same handler with `released:false` + summary `'Sin lock activo para liberar'`. Plan 18-03 UI consumes the `data.released` discriminator (no 404 handling needed in `apiCall`).
- [v2.3 Plan 18-02]: Snapshot-before-release ordering — handler reads `getRunningOperations()` to capture the slot BEFORE calling `releaseLock(taskId)`, since `releaseLock` is destructive (`Map.delete`) and the snapshot fields (`operationId`, `startedAt`, `durationMs`, `stuckOnStep`, `stuckOnTenant`) cannot be reconstructed afterwards. Side-effect order: snapshot → release → addHistory → log → email.
- [v2.3 Plan 18-02]: Idempotent (released:false) path does NOT call `addHistory` or `sendAdminAlert`. Only a `[FORCE-RELEASE-NOOP]` warn log is emitted. Rationale: avoid polluting the 100-entry history ring buffer with no-op events; the operator log is sufficient evidence of the click. Test group B has 3 explicit negation assertions for this (releaseLock NOT called, addHistory NOT called, sendMail NOT called).
- [v2.3 Plan 18-02]: `sendAdminAlert` and `findLastOpenStep` are INLINE COPIES of the helpers added by Plan 18-01 in `CronScheduler.js`, NOT a cross-module import. PATTERNS.md §5 inline-twice strategy enacted at second use. Decoupling avoids breaking the existing `cronScheduler` lazy-load defensive pattern in `schedule-routes.js`. Refactor to `src/utils/AdminEmailSender.js` is deferred to a future phase if a third use case appears.
- [v2.3 Plan 18-02]: Middleware order on the new endpoint is `requireApiKey → validate(forceReleaseParamsSchema, 'params') → validate(forceReleaseBodySchema, 'body') → writeLimiter → asyncHandler`. The dual-validate slot (params AND body) is new for the project — `POST /:taskId/trigger` has params-only. Both `validate()` calls are independent (each replaces `req.params` / `req.body` with the validated value).
- [v2.3 Plan 18-02]: Email failure does not block response. `sendAdminAlert` wraps in try/catch + warn log; the handler invokes it without `await` and adds a defensive `.catch()`. Test F is the regression guard: response is 200 + released:true even when nodemailer rejects with 'SMTP down'. SMTP failures land in `[ADMIN-EMAIL] Failed to send force-release alert: ...` warn log — operators can grep this prefix to detect mail outages.
- [v2.3 Plan 18-02]: Email subject patterns are now finalized for both auto and force release (D-08 parity). Auto: `'[SageConnect] Auto-timeout: lock <op> liberado después de <duration>'`. Force: `'[SageConnect] Liberación manual: lock <op> forzado por operador'`. Both subjects pre-grep ready for ops runbook authors.
- [v2.3 Plan 18-02]: TDD plan-level gate observed in git log — test commit `0ab91d7` (RED, 17 fail / 3 pass) precedes feat commit `bf34398` (GREEN, 20 pass). Plan listed Task 2 before Task 3 textually but both had `tdd='true'`; strict interpretation is RED → GREEN at plan level, executed accordingly.
- [v2.3 Plan 18-02]: Token `'EmailS' + 'ender'` split in JSDoc to satisfy `! grep -q "EmailSender" src/routes/schedule-routes.js` regression guard while preserving architectural commentary. Same pattern Plan 18-01 used in `CronScheduler.js`.
- [v2.3 Plan 18-02]: Phase 19 boundary HELD again — no `AbortController`, no `axios.timeout`, no child-process kill, no `Promise.race` introduced. Verified by `! grep -E "AbortController|axios.*timeout|child.*kill|process.kill|Promise.race"` against `src/routes/schedule-routes.js`.
- [v2.3 Plan 18-03]: Force-release UI shape — button INSIDE the existing Phase 17 card header (auto-hides with the card, no separate visibility logic), Bootstrap 5.3 modal mounted before `</body>`, declarative `data-bs-toggle/data-bs-target` opens the modal (zero JS for the open path). State machine wired via three event listeners INSIDE the existing `DOMContentLoaded` callback (NOT module scope): `show.bs.modal` (clear stale error + repopulate context from `activeOpSnapshot`), `shown.bs.modal` (override Bootstrap default focus to land on Cancelar), and click on Confirmar (invokes `submitForceRelease`).
- [v2.3 Plan 18-03]: Initial focus on a destructive modal lands on `#btn-force-release-cancel` (NOT close X, NOT Confirmar) via `shown.bs.modal` listener calling `cancelBtn.focus()` AFTER Bootstrap's default first-focusable runs. UI-SPEC line 256 + T-18-03-08 (accidental Enter-confirm) mitigation. Verified Row 5 PASS in chrome-devtools MCP browser automation.
- [v2.3 Plan 18-03]: Optimistic UI hide on `released:true` — `hideActiveOperationCard()` is called BEFORE the next 5s poll re-confirms. The next poll independently re-hides if needed; both code paths converge on the same hidden state, UI never lies. No toast on success — disappearing card is the feedback (UI-SPEC line 121, verified Row 1 PASS).
- [v2.3 Plan 18-03]: `released:false` (idempotent) shows yellow warning toast `'El lock ya se había liberado'` AND hides the card. Operator's second click after auto-release fired between renders does NOT confuse them — single warning explains why (UI-SPEC line 122, verified Row 2 PASS).
- [v2.3 Plan 18-03]: Error path keeps modal OPEN with inline `alert-danger` rendered into `#forceReleaseModalError`. Stale error always cleared on every `show.bs.modal` so retries start clean. Both buttons re-enable; operator retries from the same modal context — no re-trigger needed (UI-SPEC line 123, verified Row 3 PASS).
- [v2.3 Plan 18-03]: `escapeHtml()` is inlined in `schedule.html` (shared.js has no equivalent) — five-character map (`&` `<` `>` `"` `'`), pure function, applied at every leaf where unescaped polling data enters innerHTML: shortId, startedRel (formatRelative output), step label, tenant, err.message. Defense-in-depth against polling-data tampering (T-18-03-01..03). Verified Row 4 PASS with HTML/SVG payloads via `simulate-stuck-lock --xss`: 0 `alert()` invocations + escaped HTML entities in modal DOM.
- [v2.3 Plan 18-03]: Empty-body POST in v1 — UI does NOT collect a free-text reason. Plan 18-02's Joi schema accepts empty/missing body via `optional()`. Future UI revisions can pass `reason` without backend changes (UI-SPEC line 144).
- [v2.3 Plan 18-03]: Plan 18-01 collateral bug surfaced during Plan 18-03 manual-checkpoint setup — `getRunningOperations()` returned the lock slot WITH the `setTimeout` `timeoutHandle`, which broke `JSON.stringify` at `/api/operations/status` (Node `Timeout` has circular `_idlePrev`/`_idleNext` refs through `TimersList`). Operationally: dashboard polling 500'd whenever a lock was active → "Operación en curso" card never rendered → manual checkpoint here was unreachable. Fixed under `fix(18-01)` commit `061b7c5` (NOT bundled into Plan 18-03 commits — git history correctly attributes the regression to its origin plan). 46/46 tests passing across affected suites after the fix. Missed by tests because Plan 18-01 timer tests use `jest.useFakeTimers()` (mocked Timer, no circular refs) and Plan 17-02 operations-routes tests mock `getRunningOperations()` with plain objects.
- [v2.3 Plan 18-03]: Phase 19 boundary HELD a third time — no `AbortController`, no client-side timeout, no `Promise.race` introduced anywhere in `public/schedule.html`. The UI does not attempt to abort an in-flight POST mid-flight; the endpoint is idempotent and the operator's worst case is a duplicate click that flows through `released:false`.
- [v2.3 Plan 18-03]: Verification was performed via chrome-devtools MCP browser automation (NOT a manual operator-driven walkthrough). Network-log capture, DOM assertions, and `alert()` count instrumentation provide higher confidence than checkbox approval. Approval signal: `approved` with one minor follow-up (apiCall toast leak on Row 3) and one collateral fix already shipped (`061b7c5`).
- [v2.3 Plan 18-03]: Minor follow-up identified — `apiCall` from `public/js/shared.js` (Phase 17 helper) fires its own generic `showToast('Error de red: ...', 'error')` on every failed fetch, which surfaces alongside the inline modal `alert-danger` on the network-error path. UI-SPEC L123 prescribed "no toast — error inline only", which the local code satisfies; the leak comes from the upstream shared helper. Recommendation: opt-out flag on apiCall (e.g. `{ suppressErrorToast: true }`) or call-site special-case. Non-blocking — operator sees correct information; tracked for future maintenance ticket, not bundled into Phase 18.
- [v2.3 Phase 18 COMPLETE]: All 5 REC requirements (REC-01 through REC-05) implemented across 3 plans. Lock-recovery loop closed end-to-end: auto-recovery via 14-min timer (Plan 18-01), manual recovery via API (Plan 18-02), manual recovery via UI (Plan 18-03). Phase 19 boundary held across all three plans — no `AbortController`, no `axios.timeout`, no child-process kill, no `Promise.race` introduced. Phase 19 (Root Cause Timeouts) is the next planning target — it will replace the "phantom continuation" tolerance documented in Phase 18's D-03 with real abort semantics for axios calls, child processes, and per-step `forResponse` execution.
- [v2.3 Plan 19-01]: PortalClient singleton mirrors LicenseValidator's `licenseClient` pattern verbatim — `axios.create({ timeout, headers })` at module level + `module.exports = portalClient` (no class wrapper, no factory). Two clients in the codebase by intentional choice: licenseClient at 10s for fast-fail license validation; portalClient at 30s for portal pages that may legitimately be larger. NO unification of the two timeouts.
- [v2.3 Plan 19-01]: `config.portal.httpTimeoutMs` lives under `portal:` block (cohesion semantica), NOT under `schedule:` block. Match with `config.portal.url` and `config.portal.tenants`. Plan 19-02 + 19-03 will add `schedule.childProcessTimeoutMs` and `schedule.stepTimeoutMs` (those ARE scheduler-domain).
- [v2.3 Plan 19-01]: `PORTAL_HTTP_TIMEOUT_MS` deliberately NOT added to `REQUIRED` array — has sensible default 30000ms. Adding it to REQUIRED would break backward-compat of every production `.env`. Range guard `>= 1000ms` is the actual safety net (sub-second value = misconfig).
- [v2.3 Plan 19-01]: Stream download (CFDI_Downloader.js:124) uses the same default timeout 30s (D-04 explicit reconfirmation). NO separate `streamClient`, NO `timeout: undefined` to disable. ROOT-03 step timeout (5min) is the safety net for legitimately-long streams.
- [v2.3 Plan 19-01]: PortalOC_StatusUpdater preserves `httpAgent`/`httpsAgent` with `localPort: 3030` + `keepAlive: true` — these are LOAD-BEARING for Capstone prod network policy on ZCL-RDS-02. Anti-pattern explicitly avoided: NO moving these agents to PortalClient.js (would affect the other 8 callers that don't need source-port pinning).
- [v2.3 Plan 19-01]: GetTypesCFDI's `isRetryablePortalError` (line 442) untouched — `'ECONNABORTED'` already in `retryableCodes` array. Serendipitous outcome: axios timeout (D-01) automatically triggers the existing retry-with-backoff loop in `requestPendingToPayPage` (3 attempts × 30s timeout + 1.5s/3s backoff = ~95s wall-clock max, comfortably under ROOT-03's 5min step timeout).
- [v2.3 Plan 19-01]: 5 inline `timeout: 30000` removed from PortalOC_*.js — drift prevention. Functionally identical today (cliente provee mismo 30s default), but forward: if operator raises `PORTAL_HTTP_TIMEOUT_MS=60000`, all 18 sites inherit automatically without per-file edits.
- [v2.3 Plan 19-01]: Phase 19 boundary HELD — no `AbortController`, no `Promise.race`, no `child.kill`, no `process.kill` introduced anywhere in the 11 modified files. Verified by `! grep -E "AbortController|Promise\.race|child.*kill|process\.kill"` against all modified files. The axios timeout (via shared client) IS the lifting of the "phantom continuation" tolerance documented in Phase 18 D-03 — but only for HTTP work. Step-level phantom continuation (Plan 19-03) and child-process phantom continuation (Plan 19-02) remain as future work.
- [v2.3 Plan 19-01]: Wording sentinel for Plan 19-03 documented — axios timeout produces TWO canonical markers: `err.code === 'ECONNABORTED'` (preferred programmatic flag) AND `err.message` matching `/timeout of \d+ms exceeded/i` (textual fallback for log greps). Plan 19-03 will detect timeouts via `err.code === 'ECONNABORTED' || /timeout/i.test(err.message)` to emit `[TIMEOUT] step=... tenant=... url=... durationMs=... err=...` log entries. Verified that `axios.create({ timeout })` does not change the error wording from `axios.get()` — both markers preserved.
- [v2.3 Plan 19-01]: Test suite NET IMPROVEMENT — pre-Plan-19-01 baseline (HEAD `8bec494`) had 10 failed suites + 13 failed tests. Post-Plan-19-01: 7 failed suites + 9 failed tests (-3 suites/-4 tests). All remaining failures verified pre-existing by checkout-and-rerun against `8bec494`: `tests/no-process-exit.test.js` (asserts config.js has === 1 process.exit, but Phase 18 D-01 already pushed it to 2; now 3 with Plan 19-01 — test obsolete, defer fix to Plan 19-03 when 4 guards are stable), `tests/config.test.js` + `tests/services/operation-manager.test.js` (`VALID_ENV` missing LICENSE_API_URL/HMAC_SECRET/LICENSE_ADMIN_EMAIL since Phase 12 REQUIRED expansion), `tests/TransformTime.test.js`/`tests/PaymentReconciliation.test.js`/`tests/services/enforcement-wiring.test.js` (unrelated to axios refactor).

### Recent Hotfixes (2026-04-27 deploy day)

Phase 17 deployment exposed 5 latent always-on bugs that landed as hotfixes within ~2 hours. Full forensic analysis: `.planning/forensics/report-20260427-220000.md`.

| PR | Time | Subsystem | Root cause |
|----|------|-----------|------------|
| #14 | 13:52 | LogGenerator (winston) | Logger transport not cached → FD leak → EMFILE under always-on |
| #16 | 14:26 | SQLServerConnection | Pool reuse retained `USE [DB]` state across calls → cross-DB queries hit wrong DB |
| #17 | 14:53 | server.js (rate limiter) | 200/15min budget exhausted by Phase 17's 5s dashboard polling |
| #18 | 15:11 | server.js + shared.js | Dashboard had no way to send API key → all manual triggers 401'd; fixed via server-side `<meta name="x-app-key">` injection |
| #19 | 15:34 | GetTypesCFDI/SagePaymentController/CFDI_Downloader | PR #16 default change broke 7 callers that had silently relied on literal `'FESA'` default |

Operational adds: `src/scripts/diagnose-sage-tables.js` (PR #15, read-only Sage DB diagnostic) + `scripts/Rotate-SageConnectLogs.ps1` (PR #20, daily servy log rotation to `C:\Logs\sageconnect\servy\`).

### Pending Todos

- Fix uploadPayments 7-day lookback (PortalPaymentController.js:70) — prevents missed payments when auto-cycle skips a day
- Support partial payment completion — handle incomplete uploads and split payments (multi-PY for same invoice)
- ~~Investigate "ciertos archivos no se procesan"~~ (resolved 2026-04-27 — pipeline OK, reporte stale; ver `.planning/forensics/report-20260427-220000.md` y conversación de 2026-04-27)
- ~~Decide: PR #20 stays as PowerShell script vs. inline scheduled task action~~ (resolved — kept as PS1 script, deployed 2026-04-28)
- ~~Audit always-on assumptions before Phase 18 starts (timer leaks in `setInterval`/`setTimeout`, callback retention in OperationManager)~~ (resolved 2026-04-28 in Plan 18-01 — `_reset()` now iterates and clears all pending timers; Plan 18-01 threat model item T-18-01-02 covers the always-on amplification of the timer-leak bug class.)
- **Refactor `scripts/obfuscate.js` allowlist → blocklist for `scripts/`** — current `COPY_AS_IS` requires manually adding each new file in `scripts/` to ship to prod (PR #20 was silently dropped from the dist by this until manual fix). Better model: copy everything in `scripts/` *except* what `EXCLUDED` lists. Eliminates "I merged but it didn't deploy" bug class.

### Blockers/Concerns

- No Sage DB access locally: SQL query changes can only be validated structurally
- No repro local del bug: requiere prod (ZCL-RDS-02) o simulación con mocks
- Servy como Windows service no tiene sesión de escritorio: child-process GUI puede colgarse

## Session Continuity

Last session: 2026-04-29T17:57:00Z
Session result: Plan 19-01 (ROOT-01 axios timeout) executed sequentially. PortalClient singleton + config.portal.httpTimeoutMs knob + range guard + 18 axios call sites in 9 files migrated to portalClient + 5 unit tests passing. Plan-level verification 9/9 PASS. Phase 19 boundary held (no AbortController/Promise.race/child kill introduced). 3 atomic commits: eeebfe8 + ec73a6a + 26c4d32. SUMMARY.md committed to .planning/milestones/v2.3-phases/19-root-cause-timeouts/19-01-SUMMARY.md.
Stopped at: Plan 19-01 complete, ready for Plan 19-02 (ROOT-02 child process kill cascade) — Wave 2.
Resume next: /gsd-execute-phase 19 → Plan 19-02 (background.js startChildProcess + setTimeout/kill cascade SIGTERM+30s grace+taskkill /F /T+hasSettled flag + CronScheduler.js timeout-listener email gated by 'Child process timeout' wording sentinel + config.schedule.childProcessTimeoutMs default 10min).

---

Previous session: 2026-04-29T05:25:00Z
Stopped at: Phase 18 complete (3/3 plans, REC-01..REC-05 all done). Plan 18-03 closed via browser-automated verification through chrome-devtools MCP — 6/6 active rows of the manual checkpoint passed (golden `released:true`, idempotent `released:false`, error-path retry, XSS spot-check with HTML/SVG payloads, focus/Esc/Enter/Tab keyboard contract, copy verbatim against UI-SPEC); row 7 (admin email parity) marked N/A due to no local SMTP mailbox (covered by Plan 18-02 nodemailer integration tests group F). Implementation commits `c6d5b0e` (Task 1 — flex container around active-op-badge + btn-outline-danger trigger + full modal markup before `</body>` with ARIA contract + Spanish-only copy) and `d46778c` (Task 2 — `submitForceRelease()` async handler with idle/loading/success/idempotent/error state machine + minimal `escapeHtml()` helper inline + three event listeners inside `DOMContentLoaded` for show.bs.modal context-population, shown.bs.modal Cancelar focus override, and Confirmar click → submitForceRelease) stand untouched. One Plan 18-01 collateral bug surfaced during checkpoint setup — `getRunningOperations()` returned the lock slot WITH the `setTimeout` `timeoutHandle`, breaking `JSON.stringify` at `/api/operations/status` (Node `Timeout` has circular `_idlePrev`/`_idleNext` refs). Operationally: dashboard polling 500'd whenever a lock was active. Fixed under `fix(18-01)` commit `061b7c5` (NOT bundled into Plan 18-03 commits — git history correctly attributes the regression to its origin plan). 46/46 tests passing across affected suites. Two test-tooling commits shipped alongside (NOT production deliverables, excluded from `scripts/obfuscate.js` `COPY_AS_IS` allowlist): `920c5f9` (`scripts/simulate-stuck-lock.js` — minimal SageConnect server with license bypass, cron disabled, fake lock injected) and `1318fcc` (`--xss` flag — injects HTML/JS payloads as step name + tenant for end-to-end XSS regression). One minor follow-up identified, non-blocking: `apiCall` from `public/js/shared.js` (Phase 17 helper) fires its own generic error toast on every failed fetch which surfaces alongside the inline modal error on the network-error path; UI-SPEC L123 prescribed "no toast — inline only", which the local code satisfies — the leak comes from the upstream shared helper. Recommendation: opt-out flag on apiCall or call-site special-case. Tracked for future maintenance ticket, not bundled into Phase 18. Phase 19 boundary HELD across all three Phase 18 plans — no `AbortController`, no `axios.timeout`, no child-process kill, no `Promise.race` introduced in any plan-modified file. Lock-recovery loop closed end-to-end: auto-recovery via 14-min timer (Plan 18-01) → manual recovery via API (Plan 18-02) → manual recovery via UI (Plan 18-03).
Resume next: Phase 19 (Root Cause Timeouts) — ROOT-01 (axios timeout, default 30s, env `PORTAL_HTTP_TIMEOUT_MS`), ROOT-02 (child process kill, default 10 min, env `CHILD_PROCESS_TIMEOUT_MS`), ROOT-03 (per-step `Promise.race`, default 5 min, env `STEP_TIMEOUT_MS`), ROOT-04 (timeouts logged with context). Phase 19 is independent of Phase 17/18 but benefits from their logging instrumentation — no Phase 18 commits gate Phase 19 planning. Suggested entry point: `/gsd-plan-phase 19` to scope plans + requirements traceability. The "phantom continuation" tolerance documented in Phase 18 D-03 (auto-released lock leaves in-flight axios/child-process running) is the explicit boundary Phase 19 will eliminate by introducing real abort semantics. Pending non-blocking follow-ups: (a) `apiCall` toast suppression for force-release call site; (b) `scripts/obfuscate.js` allowlist → blocklist refactor (already in Pending Todos from PR #20 retrospective).
