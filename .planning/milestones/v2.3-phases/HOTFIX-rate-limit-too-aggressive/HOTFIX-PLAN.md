---
type: hotfix
milestone: v2.3
discovered_during: production validation of Phase 17 polling (2026-04-27)
severity: high
subsystem: api-infra
tags: [rate-limit, polling, observability, dashboard]
status: in_progress

# Discovery
reported_by: production browser session (ZCL-RDS-02 / Capstone Copper)
diagnosed_via: |
  After deploying Phase 17 + EMFILE + SQL hotfixes, the operator opened the
  /schedule.html dashboard. All API requests started returning HTTP 429
  "Too many requests, please try again later" — including:
    - GET /api/operations/status  (5s polling added in Phase 17)
    - GET /api/license/status     (existing periodic check)
    - GET /api/schedule           (initial page load)
  The dashboard rendered with empty values everywhere because the initial
  fetches never completed. Network tab in Edge DevTools showed 5 consecutive
  429 responses within 100ms of page load, all originating from shared.js.

# Files
affected:
  - src/server.js (limit: 200 -> 2000)
---

# HOTFIX: Global API Rate Limit Too Aggressive for Phase 17 Polling

## Root Cause

`src/server.js:30-32` configures the global `/api` rate limiter at **200 requests / 15 minutes** (≈13 req/min):

```js
app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    ...
}));
```

This budget was calibrated **before Phase 17** was planned — when the dashboard only made point-in-time fetches and relied on SSE for live updates. SSE consumes a single long-lived connection, not repeated requests.

Phase 17 introduced **5-second polling** to `GET /api/operations/status` (Plan 17-04) so the "Operación en curso" card survives page reloads and shows live state without depending on SSE re-attachment. That polling alone consumes:

| Source | Cadence | Calls / min | Calls / 15 min |
|---|---|---|---|
| `/api/operations/status` (Phase 17) | 5s | 12 | 180 |
| `/api/license/status` | ~30s | 2 | 30 |
| Initial page load + dropdowns | once | — | ~10 |
| Manual nav (Pagos, OCs, Logs) | varies | — | 10–50 |
| **Total per single tab** | | **~17** | **~230–270** |

Single tab burns through the 200-request budget in ~12 minutes. Two tabs or any reload exhaust it instantly.

The Phase 17 plan never recalibrated the rate limit for the new traffic pattern. The hotfix corrects that omission.

## Fix

Bump the global `/api` limit from 200 to 2000 per 15-minute window:

```js
app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 2000,
    ...
}));
```

New budget: ~133 req/min average. Comfortably accommodates:
- Phase 17 5s polling (12/min)
- License polling (2/min)
- Multiple operator tabs (3-4× headroom)
- Manual navigation bursts

The `writeLimiter` (10 req/min for POST endpoints, defined separately at server.js:49) is **not touched** — write throttling is still appropriate to prevent accidental abuse of trigger/upload endpoints.

## Why 2000 (and not e.g. 500 or 5000)

- 500 would still be tight with multiple tabs (2 tabs × 270/15min ≈ 540, over)
- 5000 is overkill for a small-team internal admin app and reduces the limiter's value as a safety net
- 2000 = 10× current limit, gives ~3× headroom over realistic single-operator usage with multiple tabs, while keeping a meaningful ceiling against runaway clients

## Caller Impact

None. This is a purely numeric change to a permissive guardrail. No API contracts change, no caller code changes.

## Test Updates

`tests/api/security.test.js` already tests rate limit behavior using its own isolated limiter (`limit: 2`, `windowMs: 60s`) — it does not assert the production value, so this change does not affect any test.

No new tests added. The change is config-level; behavior of the limiter itself is already covered by the existing security test.

## Validation

1. `npm test -- tests/api/security.test.js` — confirms the security test still passes (verifies rate limit middleware behavior, not the production limit value).
2. Post-deploy on prod:
   - Open `/schedule.html` and let the polling run for 5+ minutes
   - Should see no 429 responses in DevTools Network tab
   - Card "Operación en curso" should populate when any cycle runs
   - Manual "Ejecutar Ahora" should not trigger 429 (still gated by `writeLimiter` at 10/min, which is unchanged)
3. Restart of service is required to reload the new config (in-memory limiter).

## Deployment

Standard flow:
1. Merge PR `hotfix/rate-limit-too-aggressive` into `master`.
2. GH Action `obfuscate-deploy.yml` publishes to `sageconnect-dist`.
3. On ZCL-RDS-02:
   ```powershell
   Stop-Service SageConnect
   cd E:\sageconnect-dist
   git fetch
   git reset --hard origin/master
   npm install --omit=dev
   Start-Service SageConnect
   ```
4. Open `/schedule.html` and verify the dashboard renders with all fields populated (cron expression, next execution, etc.).
