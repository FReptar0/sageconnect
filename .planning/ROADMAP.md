# Roadmap: SageConnect v2.1 License Validation

## Overview

SageConnect v2.1 adds a license validation kill switch that verifies each deployment against the external license server (sageconnect-license on Vercel). The build order follows the dependency chain: config foundation, then the core LicenseValidator service, then enforcement wiring across startup/cron/API, and finally the web UI indicators. When complete, Tersoft has remote control over every SageConnect deployment -- invalid license means zero operations.

## Milestones

- ✅ **v1.0 Payment Reconciliation Fixes** - Phases 1-2 (shipped 2026-03-22)
- ✅ **v1.1 Env Unification** - Phases 3-5 (shipped 2026-03-23)
- ✅ **v2.0 Always-On Service** - Phases 6-10 (shipped 2026-03-25)
- 🚧 **v2.1 License Validation** - Phases 11-14 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>Phases 1-10 (v1.0 through v2.0) -- SHIPPED</summary>

See .planning/MILESTONES.md for completed milestone details.

</details>

### v2.1 License Validation (In Progress)

**Milestone Goal:** Control remoto sobre deployments de SageConnect -- kill switch confiable que no puede ser bypasseado.

- [ ] **Phase 11: License Config** - Add LICENSE_API_URL and HMAC_SECRET to config.js with fail-fast validation
- [ ] **Phase 12: LicenseValidator Core** - HMAC-verified license validation service with three-state model and periodic re-validation
- [ ] **Phase 13: Enforcement** - Wire license checks into startup, cron, API middleware, and defense-in-depth DNS verification
- [ ] **Phase 14: License UI** - Red banner and expiry countdown in web UI when license is invalid or expiring

## Phase Details

### Phase 11: License Config
**Goal**: SageConnect fails fast on startup if LICENSE_API_URL or HMAC_SECRET are missing from the environment
**Depends on**: Nothing (first phase of v2.1)
**Requirements**: CFG-01, CFG-02
**Success Criteria** (what must be TRUE):
  1. Service exits with a clear error message if LICENSE_API_URL is missing from .env
  2. Service exits with a clear error message if HMAC_SECRET is missing from .env
  3. `config.license.apiUrl` and `config.license.hmacSecret` are accessible via the standard config pattern (`require('../config')`)
  4. `.env.example` documents both new variables with comments explaining their purpose
**Plans**: TBD

Plans:
- [ ] 11-01: TBD

### Phase 12: LicenseValidator Core
**Goal**: A single service module verifies license validity against the remote server with HMAC signature verification, timestamp freshness, and a three-state cached model
**Depends on**: Phase 11
**Requirements**: LIC-01, LIC-02, LIC-03, LIC-04, LIC-05
**Success Criteria** (what must be TRUE):
  1. LicenseValidator rejects responses with invalid or missing HMAC signatures (tampered or rogue server responses are never accepted)
  2. LicenseValidator rejects responses with timestamps older than 5 minutes (replayed captured responses are never accepted)
  3. On startup, validation retries 3 times with backoff before failing -- a single Vercel cold start timeout does not prevent the service from starting
  4. License state is re-checked every cron cycle (~15 min) and the cached state updates accordingly
  5. Three states are distinguished: VALID (operate), INVALID (block), ERROR (keep cached state) -- a Vercel outage does not falsely block a paying client
**Plans**: TBD

Plans:
- [ ] 12-01: TBD

### Phase 13: Enforcement
**Goal**: Every operational path in SageConnect is gated by license state -- invalid license means zero operations via API, cron, or manual trigger
**Depends on**: Phase 12
**Requirements**: ENF-01, ENF-02, ENF-03, ENF-04
**Success Criteria** (what must be TRUE):
  1. All payment, PO, and schedule API endpoints return 503 when license is INVALID (manual triggers via web UI are blocked)
  2. CronScheduler skips the background cycle and records "skipped: license invalid" when license is INVALID
  3. GET /api/system/license returns current license state (active, expiresAt, lastChecked) without requiring a valid license itself
  4. dns.resolve4() verifies the license server hostname resolves to an expected IP range, bypassing the OS hosts file (defense-in-depth against DNS redirect)
**Plans**: TBD

Plans:
- [ ] 13-01: TBD

### Phase 14: License UI
**Goal**: Operators see clear visual indicators when the license is invalid or approaching expiry, eliminating confusion about why operations are blocked
**Depends on**: Phase 13 (requires GET /api/system/license endpoint)
**Requirements**: UI-09, UI-10
**Success Criteria** (what must be TRUE):
  1. A red sticky banner reading "Licencia inactiva" appears on all web UI pages when license state is INVALID
  2. The banner appears/disappears in real time (within 60 seconds) as license state changes -- no page reload required
  3. An expiry countdown badge shows "Expira en X dias" in the sidebar when the license is approaching expiration (yellow at 30 days, red at 7 days)
**Plans**: TBD

Plans:
- [ ] 14-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 11 -> 12 -> 13 -> 14

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 11. License Config | v2.1 | 0/? | Not started | - |
| 12. LicenseValidator Core | v2.1 | 0/? | Not started | - |
| 13. Enforcement | v2.1 | 0/? | Not started | - |
| 14. License UI | v2.1 | 0/? | Not started | - |

---
*Roadmap created: 2026-03-25*
*Last updated: 2026-03-25*
