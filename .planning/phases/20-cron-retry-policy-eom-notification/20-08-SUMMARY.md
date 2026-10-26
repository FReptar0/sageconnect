---
phase: 20-cron-retry-policy-eom-notification
plan: 08
subsystem: diagnostics
tags: [retry-policy, backoff, diagnostic-script, cron-where]
requires: [20-01, 20-02, 20-05]
provides: ["po-cron-diagnostic Section 4 synced with new cron WHERE", "po-cron-diagnostic Section 6 backoff state", "5-priority verdict"]
affects: [src/scripts/po-cron-diagnostic.js]
tech-stack:
  added: []
  patterns: ["RetryPolicy helpers as single source of truth (CONTEXT D-05)", "5-priority verdict (SPEC RETRY-07)", "dual-source verification (HANDOFF.md §7)"]
key-files:
  created: []
  modified:
    - src/scripts/po-cron-diagnostic.js
decisions:
  - "Section 4 updated in-place — no historical 4b retained (script is operational, not archivológico, per CONTEXT D-05)"
  - "Section 6 reuses computeBackoffWaitMinutes + buildScopeWhere + buildErrorStatsApply — no duplicated SQL/formula"
metrics:
  duration: ~7m
  completed: 2026-05-15
---

# Phase 20 Plan 08: po-cron-diagnostic Retry-Policy Sync Summary

Updated `src/scripts/po-cron-diagnostic.js` so the operator diagnostic stays in lock-step with the rewritten cron WHERE (20-05) and reports exponential-backoff state for any PO under inspection — Section 4 WHERE replica rebuilt from the same RetryPolicy helpers as the cron path, a new Section 6 surfaces `errorCount`/`lastErrorAt`/`backoffWaitMin`/`nextEligibleAt`, and the verdict is reordered to the 5-priority RETRY-07 scheme.

## What Changed

- **RetryPolicy import** added next to the existing utility imports: `buildScopeWhere`, `buildErrorStatsApply`, `computeBackoffWaitMinutes` — single source of truth with the cron path and the retry-month scripts (CONTEXT D-05).
- **verdict object** gained 4 new fields: `errorCount`, `lastErrorAt`, `backoffWaitMin`, `nextEligibleAt` (`reason` kept last for visual grouping).
- **Section 4 rewritten in-place** — the `cron WHERE replica` SQL now mirrors `PortalOC_Creator.js` post-20-05 exactly: `buildErrorStatsApply(...)` OUTER APPLY, `buildScopeWhere(config.retry, {dateField: ...})` scope filter on the `MAX(Fecha)` subquery, and the `NOT EXISTS ... status = 'POSTED'` dedupe. No historical 4b retained.
- **New Section 6 "Estado de backoff"** — queries `fesa.dbo.fesaOCFocaltec` for ERROR-row `COUNT(*)` + `MAX(lastUpdate)`, computes `backoffWaitMin` via `computeBackoffWaitMinutes` and `nextEligibleAt = lastErrorAt + backoffWaitMin*60000`, prints all 4 values, and populates the verdict fields. Query passes `'FESA'` explicitly (CLAUDE.md §6 #2).
- **Verdict reordered to 5 priorities** (SPEC RETRY-07): (1) POSTED → "ya está procesada"; (2) ERROR in backoff window → "esperando backoff hasta ${nextEligibleAt}"; (3) ERROR out of backoff window → "lista para reintentar en el próximo tick"; (4) zero fesa rows → "nunca intentada"; (5) `cronWouldMatch === false` → "fuera de RETRY_SCOPE". Existing fallback preserved. Comment renumbered `// 6. Verdict` → `// 7. Verdict`.
- **Summary `console.table`** now also shows `errorCount` and `nextEligibleAt`.

## Verification

- `node -c src/scripts/po-cron-diagnostic.js` → SYNTAX OK.
- Source assertions: RetryPolicy import = 1, helpers used = 4, `ESTADO DE BACKOFF` = 1, Read-only header = 1, mutations (`INSERT/UPDATE/DELETE`) = 0, `PORHSTAT` = 0 (no quick-260513-ket regression), `--apply` = 0, third-party names = 0, `runQuery(sql, 'FESA')` = 2, priority markers = 5.
- Smoke test: `node src/scripts/po-cron-diagnostic.js` (no args) prints `ERROR: debes proporcionar al menos un numero de PO` — CLI parsing intact.
- `npm test`: 7 failed / 461 passed — matches the documented pre-existing baseline (CLAUDE.md §6 #3: `PaymentReconciliation`, `TransformTime`, `no-process-exit`, `enforcement-wiring`, plus worker-init flakes). The diagnostic script has no test coverage; no new failure introduced.

## Deviations from Plan

None — plan executed exactly as written.

## Dual-source verification (HANDOFF.md §7)

The reordered verdict consults BOTH the portal POSTED status (`verdict.fesaStatus`, Section 5) AND the `fesa.*` control-table backoff state (`verdict.errorCount`/`verdict.nextEligibleAt`, Section 6) before declaring a PO state — no single-source misdirection.

## Self-Check: PASSED

- FOUND: src/scripts/po-cron-diagnostic.js (modified)
- FOUND: commit d958d4b
