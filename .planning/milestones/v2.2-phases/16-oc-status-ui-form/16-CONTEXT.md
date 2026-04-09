# Phase 16: OC Status UI Form - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a UI form to pos.html that lets operators change an OC's status by calling the `PUT /api/pos/status` endpoint (created in Phase 15). Includes OC input, status dropdown, confirmation dialog, and toast feedback. No new API work — this is purely frontend.

</domain>

<decisions>
## Implementation Decisions

### Form placement
- New action-card in existing "Acciones" section of pos.html
- Layout: keep existing 2-column row (Upload + Update) as-is, add new card on a second row below (full width, col-md-12 or col-12)
- Card title: "Cambiar Estado OC" with `fa-exchange-alt` icon

### Status selector
- Bootstrap `<select>` dropdown with 4 options
- Blank placeholder: "Seleccione estado..." (forces explicit choice, prevents accidental submissions)
- Labels in Spanish with English API value mapping:
  - Abierta → OPEN
  - Cerrada → CLOSED
  - Cancelada → CANCELLED
  - Generada → GENERATED
- `<option value="OPEN">Abierta</option>` pattern — value is English (sent to API), text is Spanish (shown to operator)

### Confirmation UX
- Use existing `confirmAction()` (browser `window.confirm`) — same pattern as Upload and Update actions
- Confirmation message includes both Spanish label and English API value: "Cambiar el estado de PO0075624 a Cancelada (CANCELLED)?"

### Toast feedback
- Success: custom Spanish message — "Estado de PO0075624 cambiado a Cancelada (CANCELLED)"
- Error: show `result.summary` or `result.errors?.join(', ')` — summary message only (per Phase 15 decision)
- Use existing `showToast(message, type)` function

### Response filtering (from Phase 15)
- API returns full ResultEnvelope including idFocaltec — UI ignores idFocaltec, only uses ocSage/status/apiStatus for the success message

### Claude's Discretion
- Exact card description text
- Whether to clear the form inputs after success
- Loading spinner during API call
- Input placeholder text

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `confirmAction(message)`: window.confirm wrapper — already used by uploadSpecificPO and updateSpecificPO
- `showToast(message, type)`: Bootstrap toast — success/error/warning variants
- `apiCall(method, path, body)`: handles API key headers, JSON parsing, returns response object
- `getTenantIndex()`: returns selected tenant from sidebar dropdown
- Tenant dropdown already in sidebar via `initPage()`

### Established Patterns
- Action cards: `<div class="col-md-6"><div class="card action-card h-100">` with card-title (icon + text), card-text (description), input-group + button
- API calls: `apiCall('PUT', '/api/pos/status', { poNumber, status, tenantIndex: getTenantIndex() })`
- Success handling: `if (result.success) { showToast(..., 'success') } else { showToast(result.summary || result.errors?.join(', '), 'error') }`
- Input validation: check empty, show warning toast, return early

### Integration Points
- New action-card added after existing 2-column row in "Acciones" section
- New JS function `changeOCStatus()` following same pattern as `uploadSpecificPO()` and `updateSpecificPO()`
- No new files — all changes in pos.html inline script

</code_context>

<specifics>
## Specific Ideas

- Follow the exact same code pattern as `updateSpecificPO()` — input validation, confirmAction, apiCall, showToast
- Spanish label mapping must be consistent between dropdown display, confirmation dialog, and success toast

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 16-oc-status-ui-form*
*Context gathered: 2026-04-08*
