# Requirements: SageConnect v2.1

**Defined:** 2026-03-25
**Core Value:** Control remoto sobre deployments de SageConnect -- kill switch confiable que no puede ser bypasseado.

## v2.1 Requirements

### Core Validation

- [ ] **LIC-01**: LicenseValidator service verifies HMAC signature of license server response using shared HMAC_SECRET
- [ ] **LIC-02**: Timestamp freshness check rejects responses older than 5 minutes (anti-replay)
- [ ] **LIC-03**: Startup validation calls license API with retry+backoff (3 attempts), process.exit if all fail
- [ ] **LIC-04**: Periodic re-validation every cron cycle (~15 min) updates cached license state
- [ ] **LIC-05**: Three-state model: VALID (operate normally), INVALID (block everything), ERROR (use cached state)

### Enforcement

- [ ] **ENF-01**: Express middleware returns 503 on all payment/PO/schedule endpoints when license is INVALID
- [ ] **ENF-02**: CronScheduler skips background cycle when license state is INVALID
- [ ] **ENF-03**: GET /api/system/license returns current license state (active, expiresAt, lastChecked)
- [ ] **ENF-04**: dns.resolve4() verifies license server resolves to expected IP range (defense-in-depth)

### Configuration

- [x] **CFG-01**: LICENSE_API_URL added to config.js with fail-fast validation (required)
- [x] **CFG-02**: HMAC_SECRET added to config.js with fail-fast validation (required)

### Web UI

- [ ] **UI-09**: Red sticky banner "Licencia inactiva" on all pages when license is INVALID
- [ ] **UI-10**: Expiry countdown badge "Expira en X dias" when license is expiring soon

## v2.2 Requirements

### Enhanced Security

- **SEC-01**: Ed25519 asymmetric signatures (eliminates shared secret vulnerability)
- **SEC-02**: TLS certificate pinning for license server
- **SEC-03**: Client telemetry (license server detects when client stops checking in)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Persistent license cache to disk | Would defeat kill switch -- client could run indefinitely offline |
| Grace period for revocations | Business decision: no payment = immediate block |
| Offline validation mode | SageConnect is always-online; license server must be reachable |
| License file/token approach | Requires secure storage; server-based validation is simpler |
| Multi-key support per client | One key per deployment is sufficient for v2.1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CFG-01 | Phase 11 | Complete |
| CFG-02 | Phase 11 | Complete |
| LIC-01 | Phase 12 | Pending |
| LIC-02 | Phase 12 | Pending |
| LIC-03 | Phase 12 | Pending |
| LIC-04 | Phase 12 | Pending |
| LIC-05 | Phase 12 | Pending |
| ENF-01 | Phase 13 | Pending |
| ENF-02 | Phase 13 | Pending |
| ENF-03 | Phase 13 | Pending |
| ENF-04 | Phase 13 | Pending |
| UI-09 | Phase 14 | Pending |
| UI-10 | Phase 14 | Pending |

**Coverage:**
- v2.1 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0

---
*Requirements defined: 2026-03-25*
*Last updated: 2026-03-25 after roadmap creation*
