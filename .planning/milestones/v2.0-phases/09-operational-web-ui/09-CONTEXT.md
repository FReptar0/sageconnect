# Phase 9: Operational Web UI - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the operational web interface: payment audit view, PO management view, schedule dashboard, and tenant switcher. All using Bootstrap 5.3 + vanilla JS, consuming the REST API endpoints from Phase 7 and SSE streams from Phase 8. No new backend endpoints or business logic in this phase — purely frontend.

</domain>

<decisions>
## Implementation Decisions

### Page structure & navigation
- Sidebar + separate pages: persistent left sidebar with nav links
- Pages: `/schedule.html` (home/landing), `/payments.html`, `/pos.html`, `/logs.html` (old dashboard)
- Schedule dashboard is the new home page (most frequent check) — old dashboard moves to /logs.html
- Sidebar always visible (not collapsible), ~200px width
- Tenant switcher dropdown at the top of the sidebar — affects all views globally

### Payment audit view (payments.html)
- Summary cards at top: 5 cards showing counts per category (Ready, Missing PROVIDERID, Missing UUID, Not in Portal, Provider Mismatch)
- Clicking a card filters the table below to that category
- Expandable rows: clicking a payment row expands inline sub-table showing invoices (drill-down stays in context)
- Action buttons included: "Upload Ready Payments", "Repair Missing UUIDs", etc. — operations team can act from the same screen
- Status filtering (uploaded/pending/failed) in addition to category cards

### PO management view (pos.html)
- Same pattern as payments: status-grouped cards (Posted/Error/Pending) at top + filterable table below — visual consistency
- Search bar at top for PO diagnostic lookup — type PO number, hit enter, diagnostic results appear below
- Action buttons: "Upload Authorized POs", "Update PO", consistent with payment view pattern
- Today's authorized POs list displayed as a section/card

### Schedule dashboard (schedule.html — home page)
- Step-by-step vertical timeline for live cron progress: shows each step per tenant with checkmarks as they complete (via SSE)
- "Run Now" manual trigger button — calls POST /api/schedule/:taskId/trigger, shows 409 message if already running
- Execution history as sortable table: timestamp, duration, status (success/error), error count
- Next run time displayed prominently
- Cron expression shown with human-readable description

### Tenant switcher
- Dropdown in the sidebar, always visible
- Changing tenant reloads the current view's data for the selected tenant
- Selected tenant persisted in localStorage across page navigations
- Tenant names from config displayed in dropdown (not just index numbers)

### Claude's Discretion
- Exact Bootstrap component choices (cards, tables, badges, accordions)
- Color scheme for status badges and category cards
- Responsive breakpoints and mobile layout adjustments
- Loading states and spinners during API calls
- Toast notifications for action results (success/error)
- Shared JS module for API calls, tenant state, SSE connection

</decisions>

<specifics>
## Specific Ideas

- The payment and PO views should feel like operational dashboards — information-dense, scannable, actionable. Not marketing pages.
- The step-by-step timeline on the schedule page should update in real-time via SSE — when the cron cycle is idle, it shows the last completed run's timeline.
- Action buttons should show a confirmation dialog before destructive operations (upload, repair) since dry-run defaults are on the API side but the UI should still prompt.
- Spanish language throughout — all labels, messages, status texts in Spanish consistent with the existing dashboard.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `public/index.html`: Existing Bootstrap 5.3 dashboard — reuse layout patterns, CSS includes, Bootstrap CDN links
- `src/server.js`: Static file serving from `/public` — new HTML files go here
- All Phase 7 API endpoints: 15 payment/PO endpoints ready to consume
- All Phase 8 endpoints: schedule status, history, trigger, operations status, SSE stream

### Established Patterns
- Bootstrap 5.3 via CDN (no build tooling)
- Vanilla JS with `fetch()` for API calls
- `text/event-stream` SSE via `EventSource` API
- Express static file serving: `app.use('/public', express.static(...))`

### Integration Points
- API base: all endpoints at `/api/payments/*`, `/api/pos/*`, `/api/schedule/*`, `/api/operations/*`
- API key: `x-api-key` header required on payment/PO endpoints
- Tenant: `tenantIndex` query/body parameter on all endpoints
- SSE: `GET /api/operations/:operationId/stream` for real-time progress

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-operational-web-ui*
*Context gathered: 2026-03-24*
