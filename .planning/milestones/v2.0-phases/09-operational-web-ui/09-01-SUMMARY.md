---
phase: 09-operational-web-ui
plan: 01
subsystem: ui
tags: [bootstrap, vanilla-js, sidebar, tenant-switcher, express-static]

# Dependency graph
requires:
  - phase: 08-scheduler-real-time
    provides: Schedule/operations API endpoints and SSE streaming
  - phase: 07-rest-api-security
    provides: Payment/PO REST endpoints, API key middleware, ResultEnvelope
provides:
  - "Shared JS module (sidebar, API helper, tenant state, toast, formatters)"
  - "GET /api/system/tenants endpoint returning tenant list"
  - "Clean URL routes for /schedule.html, /payments.html, /pos.html, /logs.html"
  - "Root redirect (/) to /schedule.html"
  - "Old dashboard migrated to /logs.html with sidebar integration"
affects: [09-02-PLAN, 09-03-PLAN, 09-04-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [sidebar-layout-pattern, shared-js-initPage, tenant-switcher-localStorage]

key-files:
  created:
    - public/js/shared.js
    - public/logs.html
  modified:
    - src/server.js
    - src/routes/system-routes.js

key-decisions:
  - "Tenant switcher uses localStorage key sageconnect_tenant with index-based selection"
  - "Root (/) redirects to /schedule.html as the new home page"
  - "Local formatDateTimeLocal function in logs.html avoids collision with shared.js formatDateTime"

patterns-established:
  - "Sidebar layout: d-flex wrapper with #sidebar div + flex-grow-1 content area"
  - "Page init: call initPage('/page.html') in DOMContentLoaded to load tenants and render sidebar"
  - "API helper: apiCall(method, path, body) with auto x-api-key header from localStorage"
  - "Toast notifications: showToast(message, type) using Bootstrap 5.3 Toast API"

requirements-completed: [UI-08]

# Metrics
duration: 33min
completed: 2026-03-24
---

# Phase 9 Plan 1: Shared Foundation Summary

**Shared JS module with sidebar, tenant switcher, API helper, and toast system; tenant list endpoint; old dashboard migrated to /logs.html**

## Performance

- **Duration:** 33 min
- **Started:** 2026-03-24T06:54:17Z
- **Completed:** 2026-03-24T07:27:49Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created public/js/shared.js (269 lines) providing renderSidebar, apiCall, showToast, formatDateTime, formatCurrency, initPage, getTenantIndex, setTenantIndex, confirmAction
- Added GET /api/system/tenants endpoint returning tenant list with database name as display label
- Registered clean URL routes for all 4 operational pages plus /js static mount and root redirect
- Migrated old dashboard to /logs.html with full sidebar integration while preserving all existing functionality

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared.js + GET /api/tenants + server route registration** - `3a8973f` (feat)
2. **Task 2: Create logs.html (migrate old dashboard)** - `7404137` (feat)

## Files Created/Modified
- `public/js/shared.js` - Shared JS module: sidebar renderer, API helper, tenant state, toast notifications, date/currency formatters, page initializer
- `public/logs.html` - Old dashboard migrated to sidebar layout with shared.js integration
- `src/server.js` - Added /js static mount, clean URL routes for 4 pages, root redirect to /schedule.html
- `src/routes/system-routes.js` - Added GET /tenants endpoint returning tenant list from config

## Decisions Made
- Tenant switcher uses localStorage with key `sageconnect_tenant` storing numeric index (not tenant ID) for simplicity and consistency with existing tenantIndex API parameter
- Root (/) redirects to /schedule.html since the schedule dashboard is the new home page per context decisions
- logs.html uses a local `formatDateTimeLocal` function (accepting Date object) alongside shared.js `formatDateTime` (accepting ISO string) to avoid breaking existing dashboard code that passes Date objects directly

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- shared.js is ready for all subsequent plans (09-02 schedule, 09-03 payments, 09-04 POs)
- All 4 page URLs resolve (schedule/payments/pos will 404 until their HTML files are created in subsequent plans)
- GET /api/system/tenants endpoint functional
- All 81 existing API tests continue to pass

## Self-Check: PASSED

All files found, all commits verified.

---
*Phase: 09-operational-web-ui*
*Completed: 2026-03-24*
