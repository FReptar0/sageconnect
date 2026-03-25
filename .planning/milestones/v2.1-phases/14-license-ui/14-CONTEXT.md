# Phase 14: License UI - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Add license status indicators to the web UI: red sticky "Licencia inactiva" banner on all pages when license is INVALID, and expiry countdown badge when license is expiring soon. Frontend-only changes to shared.js.

</domain>

<decisions>
## Implementation Decisions

### Inactive banner (UI-09)
- Red sticky banner at top of all pages: "Licencia inactiva. Contacte a su proveedor."
- Polls GET /api/system/license every 60 seconds
- Shows/hides based on license state (INVALID = show, VALID/ERROR = hide)
- Integrated into shared.js initPage() which runs on every page

### Expiry countdown (UI-10)
- Badge in sidebar showing "Expira en X dias" when license is expiring
- Yellow when 30 days or less, red when 7 days or less
- Uses expiresAt from license status endpoint
- Hidden when not expiring soon

### Claude's Discretion
- Exact CSS for banner (position sticky, z-index, colors)
- Badge placement in sidebar
- Polling implementation (setInterval vs recursive setTimeout)
- Whether to also show a banner during ERROR state with a different message

</decisions>

<code_context>
## Integration Points
- `public/js/shared.js`: initPage() already fetches /api/system/tenants — add /api/system/license fetch in parallel
- GET /api/system/license: Returns { state, expiresAt, lastChecked } (Phase 13, public)
- All 4 HTML pages include shared.js

</code_context>

<deferred>
## Deferred Ideas

None

</deferred>

---

*Phase: 14-license-ui*
*Context gathered: 2026-03-25*
