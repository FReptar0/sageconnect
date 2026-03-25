---
phase: 14-license-ui
plan: 01
subsystem: ui
tags: [vanilla-js, bootstrap, license, polling, banner, badge]

# Dependency graph
requires:
  - phase: 13-enforcement
    provides: "GET /api/system/license endpoint returning state, expiresAt, active"
provides:
  - "Red sticky banner on all pages when license is INVALID"
  - "Yellow/red expiry countdown badge in sidebar when license expires within 30 days"
  - "60-second polling loop for real-time license state updates"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: ["DOM injection via insertAdjacentHTML for dynamic UI indicators", "Promise.allSettled for parallel fetch in initPage"]

key-files:
  created: []
  modified: ["public/js/shared.js"]

key-decisions:
  - "Used var instead of const/let inside new functions to match shared.js convention for function-scoped variables"
  - "Banner placed on document.body (outside sidebar) for full-width visibility; badge placed inside #sidebar after hr separator"
  - "Badge removed and re-created on each poll cycle to handle color transitions (yellow to red) cleanly"

patterns-established:
  - "License UI polling: checkLicenseStatus() called via setInterval(60000) from initPage()"
  - "Parallel fetch pattern: Promise.allSettled for independent API calls in page initialization"

requirements-completed: [UI-09, UI-10]

# Metrics
duration: 2min
completed: 2026-03-25
---

# Phase 14 Plan 01: License UI Summary

**Red sticky banner and expiry countdown badge in shared.js with 60-second polling against GET /api/system/license**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-25T22:58:34Z
- **Completed:** 2026-03-25T23:00:14Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Red sticky banner "Licencia inactiva. Contacte a su proveedor." injected at top of every page when license state is INVALID
- Yellow (30d) / red (7d) expiry countdown badge "Expira en X dias" in sidebar when license approaches expiration
- 60-second polling interval updates both indicators without page reload
- Restructured initPage() to fetch tenants and license status in parallel via Promise.allSettled()

## Task Commits

Each task was committed atomically:

1. **Task 1: Add license banner and expiry badge to shared.js** - `f82f8e3` (feat)

**Plan metadata:** `dfa4f83` (docs: complete plan)

## Files Created/Modified
- `public/js/shared.js` - Added checkLicenseStatus() function with banner injection, expiry badge, and 60s polling; restructured initPage() for parallel fetching

## Decisions Made
- Used `var` declarations inside new functions to stay consistent with existing shared.js style conventions
- Banner goes on `document.body` (full-width, above everything) while badge goes inside `#sidebar` (contextual placement near navigation)
- Badge is removed and re-created on each poll cycle rather than updated in place, ensuring clean color transitions as days decrease
- ERROR state does NOT show the banner (per CONTEXT.md decision) to prevent false alarms during Vercel outages

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 14 is the final phase of v2.1 License Validation milestone
- All four phases complete: Config (11) -> Core (12) -> Enforcement (13) -> UI (14)
- v2.1 milestone is ready for integration testing and deployment

## Self-Check: PASSED

- [x] public/js/shared.js exists
- [x] 14-01-SUMMARY.md exists
- [x] Commit f82f8e3 found in git log

---
*Phase: 14-license-ui*
*Completed: 2026-03-25*
