---
phase: 18-auto-release-manual-override
plan: 03
subsystem: ui
tags: [bootstrap-5, modal, schedule-html, escapehtml, focus-management, optimistic-ui, xss-defense, force-release, lock-recovery]

# Dependency graph
requires:
  - phase: 17-observability-diagnostics
    plan: 04
    provides: "'Operación en curso' card + activeOpSnapshot global + pollActiveOperation 5s + STEP_LABELS dictionary + hideActiveOperationCard helper (UI surface the new button mounts onto)"
  - phase: 18-auto-release-manual-override
    plan: 02
    provides: "POST /api/schedule/:taskId/force-release endpoint (idempotent, always 200, data.released:true|false discriminator) — the call target of submitForceRelease()"
  - phase: 18-auto-release-manual-override
    plan: 01
    provides: "Auto-release timer + lock:timeout listener (the failure mode this UI provides a manual escape hatch for; also the reason the released:false branch matters — auto-release can fire between operator-render and operator-click)"
provides:
  - "Forzar liberación button inside the existing card header (REC-03)"
  - "Bootstrap 5.3 #forceReleaseModal with full state machine (idle → loading → success/idempotent/error) per 18-UI-SPEC.md"
  - "submitForceRelease() async handler in public/schedule.html: optimistic hideActiveOperationCard on released:true, warning toast on released:false, inline alert-danger on 4xx/5xx/network"
  - "escapeHtml() helper inlined in schedule.html (shared.js has none) — applied at every dynamic-value injection point inside the modal (shortId, startedRel, step label, tenant, err.message)"
  - "show.bs.modal listener that clears stale error slot AND populates the dynamic context line from activeOpSnapshot via findLastOpenStep equivalent"
  - "shown.bs.modal listener that overrides Bootstrap default focus to land on Cancelar (destructive-confirmation safeguard against accidental Enter-confirms)"
  - "End-to-end recovery loop closed: an operator looking at a stuck cycle now has a button + confirmation modal + visible feedback path, no SSH or service restart required"
affects:
  - "19 (Phase 19 ROOT-01/02/03 will replace the 'phantom continuation' tolerance — the UI behavior here remains correct because Phase 18's lock-state observability and force-release semantics are independent of the in-flight-work abort question)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Declarative Bootstrap modal opening via data-bs-toggle/data-bs-target — zero JS for the open path; JS only for the show.bs.modal context-population, shown.bs.modal focus override, and confirm-button click handler"
    - "Inline minimal escapeHtml() in client code where shared.js has no equivalent — five-character map (& < > \" '), pure function, applied at every leaf where unescaped data enters innerHTML"
    - "Initial-focus override on destructive modal — shown.bs.modal listener calls cancelBtn.focus() AFTER Bootstrap's default first-focusable behavior runs, so a stray Enter on a freshly-opened modal does NOT confirm the destructive action (T-18-03-08 mitigation)"
    - "Optimistic UI pattern: hideActiveOperationCard() called immediately on released:true response (BEFORE the next 5s poll re-confirms). Idempotent — the next poll independently re-hides if needed; UI never goes 'lying' because both code paths converge on the same hidden state"
    - "Inline error rendering inside the open modal (NOT a toast) on POST failure — operator can retry from the same modal context without re-clicking the trigger button. Stale error always cleared on every show.bs.modal so a previous failed attempt does not bleed into a fresh open"

key-files:
  created: []
  modified:
    - "public/schedule.html (770 → ~970 lines, +208 from baseline) — flex container around active-op-badge slot, btn-force-release trigger, full modal markup before </body>, submitForceRelease() + escapeHtml() functions, three event listeners inside DOMContentLoaded (show.bs.modal / shown.bs.modal / click on confirm)"

key-decisions:
  - "Modal opens via Bootstrap's declarative data-bs-toggle/data-bs-target — no JS click handler on the trigger button. Reduces surface area of code we own (UI-SPEC §'Component Inventory > 1' lines 168-169)."
  - "Initial focus lands on Cancelar (NOT close X, NOT Confirmar) via shown.bs.modal listener overriding Bootstrap's default. Pressing Enter on a freshly-opened modal cancels rather than confirming a destructive action (UI-SPEC line 256, T-18-03-08 mitigation, verified PASS in Row 5)."
  - "Optimistic hideActiveOperationCard() on released:true. The next 5s poll re-confirms idempotently. No toast on success — the disappearing card is the feedback (UI-SPEC line 121, verified PASS in Row 1)."
  - "released:false (idempotent) shows a yellow warning toast 'El lock ya se había liberado' AND hides the card. Operator's second click after auto-release fired between renders does NOT confuse them — the card disappears and a single warning explains why (UI-SPEC line 122, verified PASS in Row 2)."
  - "Error path keeps the modal OPEN. Inline alert-danger renders into #forceReleaseModalError (cleared on every show.bs.modal so retries start clean). Both buttons re-enable. Operator retries from the same modal context — no re-trigger needed (UI-SPEC line 123, verified PASS in Row 3)."
  - "escapeHtml is applied to EVERY dynamic value before string-concat into innerHTML: shortId, startedRel (formatRelative output), step label text, tenant, and err.message. Even though server-side data is structurally controlled (UUIDs, fixed step enum, tenant from config), defense-in-depth: a future server bug or compromised polling pipeline must not be able to inject markup into the modal (T-18-03-01..03 mitigation, verified PASS in Row 4 with HTML/SVG payloads from --xss flag)."
  - "Empty-body POST ({}) — UI does not collect a free-text reason in v1. The endpoint accepts both empty and missing body via Joi optional (Plan 18-02 schema); future UI revisions can pass reason without backend changes (UI-SPEC line 144)."
  - "Inline error rendering uses innerHTML (we WANT the alert-danger CSS class and the icon markup) but the only untrusted segment inside the constructed HTML is the escapeHtml(err.message) leaf — pattern matches Phase 17's renderActiveOperationCard."

patterns-established:
  - "Force-release UI shape (REC-03 final): button INSIDE card header (auto-hides with card, no separate visibility logic) + modal mounted before </body> + show.bs.modal repopulates context from current activeOpSnapshot on every open + shown.bs.modal seizes focus to Cancelar."
  - "submitForceRelease() async function shape: capture button refs → set loading state → apiCall → success branch (close modal + optimistic hide + maybe-toast) | error branch (inline alert-danger + escapeHtml) → finally restore idle. Error branch does NOT close modal (operator can retry from same context)."
  - "Browser-automated UI verification via chrome-devtools MCP — 6 of 7 rows from the human-verify checkpoint validated end-to-end without operator-driven manual steps. Verification artifact (network log + DOM assertions + chrome alert() count) provides higher confidence than a checkbox walkthrough."

requirements-completed:
  - REC-03

# Metrics
duration: ~25 min
completed: 2026-04-28
---

# Phase 18 Plan 03: Force-release UI button + modal Summary

**Surfaced REC-03 as a `Forzar liberación` button inside the Phase 17 'Operación en curso' card header that opens a Bootstrap 5.3 confirmation modal, calls `POST /api/schedule/background-cycle/force-release`, and gives the operator instant optimistic feedback (card hides) plus a XSS-hardened context line populated from `activeOpSnapshot` — closing the lock-recovery loop end-to-end without SSH access.**

## Performance

- **Duration:** ~25 min execution + manual checkpoint verification
- **Started:** 2026-04-28T15:37Z (commit `c6d5b0e`)
- **Completed:** 2026-04-28T15:39Z implementation; checkpoint resolved 2026-04-29T05:21Z (browser-automated verification via chrome-devtools MCP)
- **Tasks:** 3 (Tasks 1 + 2 implementation, Task 3 human-verify checkpoint)
- **Files modified:** 1 (`public/schedule.html`)

## Accomplishments

- **Trigger button** — `#btn-force-release` (`btn-sm btn-outline-danger` + `fa-unlock-alt` icon + Spanish `aria-label`) lives in a flex container alongside the existing `#active-op-badge` slot inside the card header. Auto-hides with the card (no separate visibility logic). Opens the modal declaratively via `data-bs-toggle="modal" data-bs-target="#forceReleaseModal"` — zero JS for the open path.
- **Modal markup** — `#forceReleaseModal` mounted immediately before `</body>` with `modal-dialog-centered` for vertical centering, full ARIA contract (`aria-labelledby="forceReleaseModalTitle"` + `aria-describedby="forceReleaseModalBody"`), Spanish-only copy verbatim from UI-SPEC, and four locked elements: title (with red `fa-unlock-alt`), body (question line + dynamic context line `#forceReleaseModalContext` + warning alert + inline error slot `#forceReleaseModalError`), and footer buttons (`Cancelar` `btn-secondary` + `Confirmar liberación` `btn-danger`).
- **State machine wiring** — three event listeners registered INSIDE the existing `DOMContentLoaded` callback (NOT at module scope): (1) `show.bs.modal` clears stale error slot and rebuilds the context line from current `activeOpSnapshot` via inline backwards-iteration to find the last open step; (2) `shown.bs.modal` calls `cancelBtn.focus()` overriding Bootstrap's default first-focusable behavior; (3) click on `#btn-force-release-confirm` invokes `submitForceRelease()`.
- **submitForceRelease async handler** — captures button refs, sets loading state (disable both buttons + swap label to `Liberando...` with spinner icon + clear error slot), calls `apiCall('POST', '/api/schedule/background-cycle/force-release', {})`, branches on `res.success` and `res.data.released`: success closes modal + `hideActiveOperationCard()` (optimistic), `released:false` adds warning toast `El lock ya se había liberado`, error renders inline `alert-danger` with `escapeHtml(err.message)` and re-enables buttons. Idle state restored in `finally`.
- **escapeHtml helper** — inline minimal implementation (5-character map: `&` `<` `>` `"` `'`) since `public/js/shared.js` has no equivalent. Applied at EVERY dynamic-value injection point: `shortId`, `startedRel` (the `formatRelative` output), step label text, tenant, and `err.message`. Defense-in-depth against polling-data tampering (T-18-03-01..03).
- **Phase 19 boundary held** — no `AbortController`, no client-side timeout, no `Promise.race`. The UI does not attempt to abort an in-flight POST mid-flight; the endpoint is idempotent and the operator's worst case is a duplicate click that flows through `released:false`.

## Task Commits

1. **Task 1: Add force-release button to card header + modal markup before `</body>`** — `c6d5b0e` (feat)
2. **Task 2: Add submitForceRelease() + show.bs.modal + shown.bs.modal + click handler inside DOMContentLoaded** — `d46778c` (feat)
3. **Task 3: Human-verify checkpoint** — RESOLVED via browser-automated verification through chrome-devtools MCP on 2026-04-29 (no commit; checkpoint approval is the artifact). Note: 6 of 7 verification rows passed; row 7 (admin email parity) was N/A due to no local SMTP mailbox available — covered by Plan 18-02's existing nodemailer integration tests.

**Plan metadata commit:** this plan's docs commit (current).

## Files Created/Modified

### Modified

- **`public/schedule.html`** (770 → ~970 lines, +208 from baseline) — three surgical edits:
  - Lines 167–186 area: replaced empty `<span id="active-op-badge"></span>` (single line) with a `<div class="d-flex align-items-center gap-2">` flex container that PRESERVES the badge slot AND hosts the new trigger button.
  - Pre-`</body>` area: inserted the full `#forceReleaseModal` markup block (~40 lines including title, body, warning alert, inline error slot, and footer).
  - Inline `<script>` block: added `function submitForceRelease() { ... }` and `function escapeHtml(s) { ... }` after the active-operation-card family of functions; extended the existing `DOMContentLoaded` callback body with the three event listeners and the click handler binding.

The Phase 17 surface (`pollActiveOperation`, `renderActiveOperationCard`, `hideActiveOperationCard`, `refreshActiveOperationHeartbeat`, `STEP_LABELS`, `activeOpSnapshot`, the 5s/1s intervals, the `beforeunload` cleanup, and the `triggerCycle`/`Ejecutar Ahora` flow) is **byte-identical to before this plan**. The plan is purely additive.

## Verification

Resolved via **browser-automated verification through chrome-devtools MCP** on 2026-04-29T05:21Z. The orchestrator drove the same 7-row matrix the plan specified, but with concrete network-log capture, DOM assertions, and `alert()` count instrumentation rather than a manual checkbox walkthrough.

| Row | Path | Status | Notes |
|-----|------|--------|-------|
| 1 | Golden (`released:true`) | PASS | Modal closed; card hidden via `hideActiveOperationCard`; no toast (UI-SPEC L121 honored); POST 200 with `previousLock: { operationId: 'sim-40104119', startedAt: '2026-04-29T05:21:44.121Z', durationMs: 37476, stuckOnStep: 'downloadCFDI', stuckOnTenant: 'capstone' }`. |
| 2 | Idempotent (`released:false`) | PASS | Yellow warning toast `El lock ya se había liberado` rendered (accent on `había` preserved). Modal closed. POST 200 with `data: { released: false, previousLock: null }`. |
| 3 | Error path (network drop + retry) | PASS WITH NIT | Modal stays open, both buttons re-enabled, inline `alert-danger` renders verbatim per UI-SPEC: `Error al liberar el lock: Failed to fetch. Intentá nuevamente o revisá los logs del servidor.`. Retry from same modal after network restore: clean success (network log shows `reqid=97 POST [ERR_INTERNET_DISCONNECTED]` then `reqid=108 POST [200]`). See "Minor follow-up" below for the apiCall toast leak. |
| 4 | XSS spot-check | PASS | Server-side payload via `simulate-stuck-lock --xss`: `step='<img src=x onerror="alert(1)">'`, `tenant='<svg/onload="alert(2)">'`. Modal `contextHTML` returned with HTML entities escaped: `Operación <code>sim-3996</code>, iniciada hace 22s. Step actual: <code>&lt;img src=x onerror="alert(1)"&gt;</code> (&lt;svg/onload="alert(2)"&gt;).`. **0 `alert()` invocations**, **0 `<img>`/`<svg>`/`<script>` elements** in modal DOM. `escapeHtml()` confirmed at every dynamic injection point. |
| 5 | Focus / Esc / Enter / Tab | PASS | Initial focus = `#btn-force-release-cancel`. Esc closes modal (no POST in network log). Enter on Cancelar closes (no POST). Focus trap order Close X → Cancelar → Confirmar (3 focusable, all `tabIndex=0`). |
| 6 | Copy spot-check | PASS | All strings verbatim against UI-SPEC: title `Forzar liberación de lock`, body line 1 `¿Liberar el lock <code>background-cycle</code> actualmente en curso?`, body line 2 `Operación sim-3996, iniciada hace 22s. Step actual: <code>Descargar CFDIs</code> (capstone).`, warning alert `Esta acción cancelará el ciclo en curso y disparará un email al administrador. El siguiente cron tick podrá ejecutar normalmente.`, footer (`Cancelar` `btn-secondary`, `Confirmar liberación` `btn-danger`), inline error template `Error al liberar el lock: {message}. Intentá nuevamente o revisá los logs del servidor.`. ARIA `aria-labelledby="forceReleaseModalTitle"` + `aria-describedby="forceReleaseModalBody"`. |
| 7 | Email parity | N/A | No local admin SMTP mailbox (Capstone internal SMTP unreachable). Plan 18-02 integration tests already cover `sendAdminAlert` subject + body shape with nodemailer mocks (group F). Subject pattern `[SageConnect] Liberación manual: lock background-cycle forzado por operador` is grep-ready in source for ops runbook authors. |

**Approval signal received:** `approved` with one minor follow-up nit (Row 3) and one collateral pre-existing bug already fixed in a separate commit (see "Bug uncovered during verification" below).

### Minor follow-up — apiCall toast leak on Row 3

**Observation (not blocking):** During the network-error path on Row 3, the inline `alert-danger` rendered correctly inside the open modal AS SPECIFIED by UI-SPEC L123. However, in addition to that inline error, `apiCall` from `public/js/shared.js` (Phase 17 helper, Plan 17-04) also fires its own generic `showToast('Error de red: Failed to fetch', 'error')` on every failed fetch — so the operator sees TWO messages with consistent content but redundant placement.

UI-SPEC L123 prescribed "no toast — error is shown inline inside the modal", which the local code satisfies; the leak comes from the upstream `apiCall` helper that is shared across the dashboard.

**Recommendation:** add an opt-out flag to `apiCall` (e.g. `apiCall(method, path, body, { suppressErrorToast: true })`) and pass it from `submitForceRelease`. Alternative: special-case the `force-release` endpoint inside `apiCall`. Tracked as a small follow-up rather than a blocking finding because:
- The operator sees the correct information (inline alert is verbatim per UI-SPEC).
- The redundant toast does NOT confuse the recovery flow — both messages say the same thing.
- The fix touches `shared.js` (a Phase 17 surface), so it belongs to a future maintenance ticket, not this plan's scope.

### Bug uncovered during verification — circular JSON in `getRunningOperations()`

While preparing the manual-checkpoint environment, the orchestrator discovered that **dashboard polling at `/api/operations/status` returned HTTP 500 with `Converting circular structure to JSON` whenever a real lock was active**. Without the dashboard polling, the "Operación en curso" card never rendered, and the manual checkpoint here was unreachable.

**Root cause:** Plan 18-01 added `timeoutHandle: setTimeout(...)` to each lock slot inside `OperationManager.acquireLock` so `releaseLock` could cancel the auto-release timer atomically (D-01). But the slot flowed unfiltered through `getRunningOperations()` into `JSON.stringify` at the `/api/operations/status` route handler, and Node's `Timeout` object has internal circular references (`_idlePrev` ↔ `_idleNext` through `TimersList`) that break JSON serialization.

**Why the existing tests missed it:**
- Plan 18-01 timer tests use `jest.useFakeTimers()`, so the slot's `timeoutHandle` is a Jest mock (not a real Timer with circular refs).
- Plan 17-02 operations-routes tests mock `getRunningOperations()` with plain objects and never exercise a real Timer crossing the JSON boundary.

**Fix:** committed as `061b7c5` `fix(18-01): exclude timeoutHandle from getRunningOperations to prevent circular JSON` — `getRunningOperations()` strips `timeoutHandle` from each slot via destructuring before returning the public shape. Two regression tests added in `tests/services/operation-manager.test.js`: (a) `getRunningOperations strips timeoutHandle from each slot`, (b) `getRunningOperations output is JSON-serializable`. One existing test in `tests/services/OperationManager.timer.test.js` updated to read `slot.timeoutHandle` via the private `operationManager.locks.get(...)` Map directly (since the public shape no longer exposes it).

**Verification:** 46/46 tests passing across the 4 affected suites after the fix (`OperationManager.timer.test.js` 9/9, `CronScheduler.timeout-listener.test.js` 9/9, `schedule-force-release.test.js` 20/20, `operations-routes.test.js` 8/8).

**Important:** this fix is committed under `fix(18-01)`, NOT this plan. It is a Plan 18-01 collateral bug surfaced during Plan 18-03 verification, and it correctly attributes the regression to the plan that introduced it. Plan 18-01's SUMMARY may want a forward-link to `061b7c5` in a future maintenance pass; the current Plan 18-01 SUMMARY does not need amendment for closure of Plan 18-03.

## Testing infrastructure (out of plan scope, mentioned for traceability)

Two helper scripts shipped alongside the verification work — they are NOT Phase 18 deliverables, but they enabled the browser-automated verification of this plan and any future Phase 18 / Phase 19 manual testing:

- **`920c5f9` `chore(scripts): add simulate-stuck-lock helper for Phase 18 manual testing`** — `scripts/simulate-stuck-lock.js` boots a minimal SageConnect server with license validation bypassed (require.cache shim), cron disabled (`CRON_SCHEDULE='0 0 1 1 *'`), and a fake lock injected. **NOT FOR PRODUCTION** — explicitly excluded from `scripts/obfuscate.js` `COPY_AS_IS` allowlist so it cannot ship to a client.
- **`1318fcc` `chore(scripts): add --xss flag to simulate-stuck-lock for Plan 18-03 XSS verification`** — adds `--xss` flag that injects HTML/JS payloads as the step name and tenant fields, used to drive Row 4 of the verification matrix (XSS spot-check) end-to-end with real attacker-controlled strings instead of DevTools console-injected ones.

Both are pure testing tooling and ride alongside Phase 18 work without polluting the production code path.

## Decisions Made

See key-decisions in frontmatter for the full list. Highlights:

- **Optimistic UI hide on success:** `hideActiveOperationCard()` runs immediately on `released:true` BEFORE the next 5s poll re-confirms. The next poll independently re-hides if needed; UI never goes "lying" because both code paths converge on the same hidden state. Verified Row 1 PASS.
- **Initial focus = Cancelar (NOT close X, NOT Confirmar):** `shown.bs.modal` listener calls `cancelBtn.focus()` AFTER Bootstrap's default first-focusable runs. This is the destructive-confirmation safeguard from UI-SPEC line 256 — pressing Enter on a freshly-opened modal does NOT confirm. Verified Row 5 PASS.
- **Error path keeps modal OPEN:** inline `alert-danger` renders into `#forceReleaseModalError`, both buttons re-enable, operator can retry from the same modal context. Stale error always cleared on every `show.bs.modal` so retries start clean. Verified Row 3 PASS.
- **escapeHtml at every leaf:** even though server-side data is structurally controlled (UUIDs, fixed step enum, tenant from config), defense-in-depth: `escapeHtml(shortId)`, `escapeHtml(startedRel)`, `escapeHtml(labelText)`, `escapeHtml(tenant)`, `escapeHtml(err.message)`. The pattern matches Phase 17 `renderActiveOperationCard`. Verified Row 4 PASS with HTML/SVG payloads from `simulate-stuck-lock --xss`.
- **Empty-body POST in v1:** UI does not collect a free-text reason. Plan 18-02's Joi schema accepts empty/missing body. Future UI revisions can pass `reason` without backend changes (UI-SPEC line 144).

## Deviations from Plan

### Auto-fixed Issues

None within Plan 18-03's runtime scope. The plan's two implementation tasks (Tasks 1 + 2) executed exactly as written across commits `c6d5b0e` and `d46778c`. No Rule-1/2/3 deviations were applied during implementation.

### Bug uncovered during verification (Plan 18-01 collateral, fixed separately)

One pre-existing bug from Plan 18-01 was discovered during Plan 18-03 manual-verification environment setup and fixed in a separate commit:

- **`061b7c5` `fix(18-01): exclude timeoutHandle from getRunningOperations to prevent circular JSON`** — see "Bug uncovered during verification" section above. Attributed to Plan 18-01 (where the `timeoutHandle` was introduced), not this plan. 46/46 tests passing across the 4 affected suites after the fix.

This fix is intentionally NOT bundled into Plan 18-03's commits. The git history correctly attributes the regression to its origin plan.

---

**Total deviations:** 0 within Plan 18-03 scope.
**Impact on plan:** None. Plan 18-03 implementation followed UI-SPEC.md verbatim. The collateral Plan 18-01 fix was a precondition for verification, not a deviation.

## Issues Encountered

- **Verification environment friction:** the manual-checkpoint plan assumed a runnable dashboard with real polling, but the upstream `getRunningOperations()` circular-JSON bug (Plan 18-01 collateral) silently broke `/api/operations/status` once a lock was active. Diagnosed and fixed in `061b7c5` before proceeding with the 7-row verification matrix.
- **No local SMTP mailbox:** Row 7 (admin email parity) marked N/A. Capstone internal SMTP is unreachable from the developer machine. Plan 18-02's nodemailer integration tests (group F) cover the subject + body shape via mocks; the subject pattern is grep-ready in source for ops runbook authors.
- **Minor `apiCall` toast leak (Row 3 NIT):** the shared `apiCall` helper in `public/js/shared.js` fires a generic error toast on every fetch failure, which surfaces alongside the inline modal error during the network-error path. The operator sees two consistent messages, not contradictory ones — non-blocking. Tracked as a future maintenance ticket (suppress flag on `apiCall` or call-site special-case).

## User Setup Required

None — Plan 18-03 is pure UI markup + JS in `public/schedule.html`. No new env vars, no new CDNs, no new external services. The page already serves `Bootstrap 5.3.0-alpha3` and `Font Awesome 6.4` (the only new icon `fa-unlock-alt` is already in FA 6.4).

## Next Phase Readiness

**Phase 18 is complete (3/3 plans, 5/5 requirements REC-01..REC-05).** The lock-recovery loop is closed end-to-end:

- Auto-recovery: 14-min `lockTimeoutMs` → `lock:timeout` event → `addHistory` + admin email + warn log (Plan 18-01).
- Manual recovery via API: `POST /api/schedule/:taskId/force-release` idempotent, audit logged, parity admin email (Plan 18-02).
- Manual recovery via UI: `Forzar liberación` button + Bootstrap confirmation modal + optimistic hide + XSS-hardened context line + inline error retry path (Plan 18-03, this plan).

**Phase 19 boundary held:** still no `AbortController`, no `axios.timeout`, no child-process kill, no `Promise.race` introduced in any modified file across Plans 18-01/02/03. Phase 19 (ROOT-01/02/03) remains untouched scope and is the next planning target — it will replace the "phantom continuation" tolerance documented in Phase 18's D-03 with real abort semantics for axios calls, child processes, and per-step `forResponse` execution.

**Operational note for runbook authors:** the two admin-email subject patterns are now stable for grep-based monitoring:

```
[SageConnect] Auto-timeout: lock <op> liberado después de <duration>     (Plan 18-01)
[SageConnect] Liberación manual: lock <op> forzado por operador          (Plan 18-02)
```

**Pending follow-ups (non-blocking):**
- `apiCall` generic error-toast suppression for force-release (Row 3 nit) — small `shared.js` change, future ticket.
- `scripts/obfuscate.js` allowlist → blocklist refactor (already in STATE.md pending todos from PR #20 retrospective) — would prevent the `simulate-stuck-lock.js` accidentally shipping pattern.

**No blockers for Phase 19 planning.**

## Self-Check: PASSED

- [x] All 5 referenced commits exist in git log: `c6d5b0e` (Task 1 markup), `d46778c` (Task 2 wiring), `061b7c5` (Plan 18-01 collateral fix), `920c5f9` (test helper), `1318fcc` (--xss flag).
- [x] `public/schedule.html` contains all required structural elements (button id, modal id, function names, listener registrations) — verified by Tasks 1 & 2 grep gates during implementation, re-confirmed by chrome-devtools DOM assertions during checkpoint.
- [x] All 7 verification rows resolved (6 PASS, 1 N/A — email parity covered by Plan 18-02 mocks).
- [x] Phase 19 boundary held — no `AbortController`, `axios.timeout`, `child.*kill|process.kill`, or `Promise.race` in any plan-modified file.
- [x] No regression on Phase 17 surface (`pollActiveOperation`, card render/hide, heartbeat ticker, `Ejecutar Ahora` flow, beforeunload cleanup) — Plan 18-03 is purely additive to `public/schedule.html`.
- [x] Plan 18-01 collateral fix `061b7c5` is committed under `fix(18-01)`, not bundled into this plan's commits — git history correctly attributes the regression.
- [x] All 46/46 tests pass across affected suites after `061b7c5`: OperationManager.timer (9/9), CronScheduler.timeout-listener (9/9), schedule-force-release (20/20), operations-routes (8/8).

## TDD Gate Compliance

Plan 18-03 is `type: execute` with `autonomous: false`, NOT `type: tdd`. Tasks 1 and 2 are `type="auto"` (no `tdd="true"` on either). Frontend modal flow + UI state machine were not tested via Jest in this plan — verification is the chrome-devtools MCP browser-automated walkthrough plus the XSS spot-check.

The XSS regression test is implicit in the `escapeHtml` invocation at every leaf and was confirmed end-to-end by Row 4 (server-side `--xss` payload → 0 `alert()` invocations + escaped HTML entities in modal DOM). Plan 18-02's nodemailer integration tests + Plan 18-01's timer tests + the new circular-JSON regression tests in `061b7c5` cover the backend surface this UI consumes.

No RED → GREEN gate sequence applies to this plan.

---
*Phase: 18-auto-release-manual-override*
*Completed: 2026-04-28*
