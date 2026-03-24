# Phase 9: Operational Web UI - Research

**Researched:** 2026-03-24
**Domain:** Frontend -- Bootstrap 5.3 + vanilla JS operational dashboard consuming REST API + SSE
**Confidence:** HIGH

## Summary

Phase 9 is a purely frontend phase: build 4 HTML pages (schedule, payments, POs, logs) with a persistent sidebar, consuming the 15+ REST endpoints from Phase 7 and SSE streams from Phase 8. The existing codebase already has a working Bootstrap 5.3 dashboard (`public/index.html`, ~850 lines) that establishes all patterns: CDN-loaded Bootstrap/FontAwesome, vanilla JS with `fetch()`, Spanish labels, inline `<style>` and `<script>`, dark gradient background with white card pattern.

The key technical challenges are: (1) shared sidebar + tenant state across separate HTML pages without a build system, (2) expandable table rows for payment invoice drill-down using Bootstrap Collapse within `<table>` elements, (3) SSE-driven real-time timeline for the schedule dashboard using the `EventSource` API, and (4) confirmation dialogs before destructive API actions that require the `x-api-key` header.

**Primary recommendation:** Build 4 standalone HTML pages with a shared CSS/JS approach (inline or small shared files). Use Bootstrap 5.3 Collapse for table row expansion, native `EventSource` for SSE, `localStorage` for tenant persistence, and Bootstrap Toasts for action feedback. Add `cronstrue` (v3.14, CDN) for human-readable cron descriptions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Sidebar + separate pages: persistent left sidebar with nav links
- Pages: `/schedule.html` (home/landing), `/payments.html`, `/pos.html`, `/logs.html` (old dashboard)
- Schedule dashboard is the new home page (most frequent check) -- old dashboard moves to /logs.html
- Sidebar always visible (not collapsible), ~200px width
- Tenant switcher dropdown at the top of the sidebar -- affects all views globally
- Payment audit view: summary cards (5 categories) + filterable table + expandable rows for invoice drill-down + action buttons
- PO management view: same card + table pattern, search bar for diagnostic, action buttons
- Schedule dashboard: step-by-step vertical timeline (SSE), manual trigger, history table
- Tenant switcher persisted in localStorage
- Bootstrap 5.3 + vanilla JS, Spanish language, no SPA framework
- Action buttons should show confirmation dialog before destructive operations
- Spanish language throughout

### Claude's Discretion
- Exact Bootstrap component choices (cards, tables, badges, accordions)
- Color scheme for status badges and category cards
- Responsive breakpoints and mobile layout adjustments
- Loading states and spinners during API calls
- Toast notifications for action results (success/error)
- Shared JS module for API calls, tenant state, SSE connection

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-01 | Payment audit view with reconciliation report showing 5 categories | Reconciliation API returns `categories: { ready, no_providerid, no_uuid, not_in_portal, provider_mismatch }` as counts. Summary cards map 1:1. Use POST /api/payments/reconciliation with tenantIndex. |
| UI-02 | Payment status table with filtering (uploaded/pending/failed) | Reconciliation response includes category counts. Filtering is client-side on loaded data. Badge colors differentiate status. |
| UI-03 | Payment detail drill-down (invoices per payment) | Bootstrap 5.3 Collapse component on `<tr>` elements. Hidden detail row with `colspan` expands inline. No additional API call needed if reconciliation returns invoice data per payment. |
| UI-04 | PO status overview table (posted/error/pending) | POST /api/pos/lifecycle (mode: 'analyze') or GET /api/pos/diagnostic. Card + table pattern mirrors payments view. |
| UI-05 | PO diagnostic lookup from web (single PO search) | GET /api/pos/diagnostic?poNumber=X. Search input triggers API call, results displayed below. |
| UI-06 | Today's authorized POs list | POST /api/pos/upload-authorized (with dryRun concept) or dedicated GET. Display as card/table section on PO page. |
| UI-07 | Schedule dashboard with next runs, last results, manual trigger buttons | GET /api/schedule (cron, nextRun, lastRun), GET /api/schedule/history, POST /api/schedule/:taskId/trigger. SSE via GET /api/operations/:operationId/stream. |
| UI-08 | Tenant switcher dropdown in navbar/sidebar | config.portal.tenants array provides tenant list. Need a new lightweight endpoint or embed tenant names in schedule response. localStorage key for persistence. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bootstrap | 5.3.0-alpha3 | UI framework (CSS + JS) | Already used in existing dashboard via CDN |
| Font Awesome | 6.4.0 | Icons | Already used in existing dashboard via CDN |
| Vanilla JS | ES2020+ | All client logic | Project decision: no SPA framework |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| cronstrue | 3.14.0 | Human-readable cron descriptions | Schedule page -- display "Cada 15 minutos" from `*/15 * * * *` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| cronstrue (CDN) | Manual cron parsing | cronstrue is 8KB, supports Spanish locale, zero deps -- hand-rolling is error-prone |
| Shared JS file | Inline JS per page | Shared file reduces duplication for API helper, tenant state, toast utility -- but adds HTTP request |
| Bootstrap Collapse for row detail | Custom show/hide | Collapse handles animations, accessibility (aria-expanded), keyboard nav out of the box |

**CDN URLs (match existing dashboard):**
```html
<!-- Bootstrap 5.3 CSS -->
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha3/dist/css/bootstrap.min.css" rel="stylesheet"
    integrity="sha384-KK94CHFLLe+nY2dmCWGMq91rCGa5gtU4mk92HdvYe+M/SXH301p5ILy+dN9+nJOZ" crossorigin="anonymous">

<!-- Font Awesome 6.4 -->
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">

<!-- Bootstrap 5.3 JS Bundle -->
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha3/dist/js/bootstrap.bundle.min.js"
    integrity="sha384-ENjdO4Dr2bkBIFxQpeoTz1HIcje39Wm4jDKdf19U8gI4ddQ3GYNS7NTKfAdVQSZe"
    crossorigin="anonymous"></script>

<!-- cronstrue (schedule page only) -->
<script src="https://unpkg.com/cronstrue@3.14.0/dist/cronstrue.min.js"></script>
<script src="https://unpkg.com/cronstrue@3.14.0/locales/es.min.js"></script>
```

## Architecture Patterns

### Recommended Project Structure
```
public/
  index.html         # Redirector (-> /schedule.html) OR keep as-is with route change
  schedule.html      # NEW: Home page -- schedule dashboard (UI-07)
  payments.html      # NEW: Payment audit view (UI-01, UI-02, UI-03)
  pos.html           # NEW: PO management view (UI-04, UI-05, UI-06)
  logs.html          # NEW: Old dashboard moved here (copy of current index.html, adapted)
  js/
    shared.js        # NEW: API helper, tenant state, toast utility, sidebar renderer
  img/               # Existing
  404.html           # Existing
```

### Pattern 1: Static File Serving + Route Registration
**What:** The current server mounts static files at `/public` prefix and has an explicit `app.get('/')` for the root. New pages need either route registrations or a static mount change.
**When to use:** Always -- the server must serve the new HTML pages.
**Approach:**

```javascript
// Option A (recommended): Add explicit routes in server.js for clean URLs
app.get('/', (req, res) => res.redirect('/schedule.html'));
app.get('/schedule.html', (req, res) => res.sendFile(process.cwd() + '/public/schedule.html'));
app.get('/payments.html', (req, res) => res.sendFile(process.cwd() + '/public/payments.html'));
app.get('/pos.html', (req, res) => res.sendFile(process.cwd() + '/public/pos.html'));
app.get('/logs.html', (req, res) => res.sendFile(process.cwd() + '/public/logs.html'));

// Also serve shared JS
app.use('/js', express.static(process.cwd() + '/public/js'));
```

**Why:** Currently static files are at `/public/X` (e.g., `/public/index.html`). CONTEXT.md specifies clean URLs (`/schedule.html`). Adding explicit routes keeps backward compatibility while enabling the new URL scheme. The `/js` mount enables shared JavaScript.

### Pattern 2: Shared Sidebar (HTML Template in JS)
**What:** Sidebar HTML is generated by shared.js and injected into a `<div id="sidebar">` placeholder on each page.
**When to use:** Every page.
**Example:**

```javascript
// public/js/shared.js
function renderSidebar(activePage) {
    const pages = [
        { href: '/schedule.html', icon: 'fa-calendar-check', label: 'Programacion' },
        { href: '/payments.html', icon: 'fa-credit-card', label: 'Pagos' },
        { href: '/pos.html', icon: 'fa-file-invoice', label: 'Ordenes de Compra' },
        { href: '/logs.html', icon: 'fa-terminal', label: 'Logs' },
    ];

    const tenants = window.__TENANTS__ || []; // injected or fetched
    const currentTenant = localStorage.getItem('sageconnect_tenant') || '0';

    const sidebarHTML = `
        <div class="d-flex flex-column p-3 text-white bg-dark" style="width: 220px; min-height: 100vh;">
            <a href="/schedule.html" class="d-flex align-items-center mb-3 text-white text-decoration-none">
                <i class="fas fa-cogs me-2"></i>
                <span class="fs-5 fw-bold">SageConnect</span>
            </a>
            <div class="mb-3">
                <label class="form-label small text-muted">Tenant</label>
                <select id="tenantSwitcher" class="form-select form-select-sm bg-secondary text-white border-0">
                    ${tenants.map((t, i) => `<option value="${i}" ${i == currentTenant ? 'selected' : ''}>${t.name || 'Tenant ' + i}</option>`).join('')}
                </select>
            </div>
            <hr>
            <ul class="nav nav-pills flex-column mb-auto">
                ${pages.map(p => `
                    <li class="nav-item">
                        <a href="${p.href}" class="nav-link text-white ${activePage === p.href ? 'active' : ''}">
                            <i class="fas ${p.icon} me-2"></i>${p.label}
                        </a>
                    </li>
                `).join('')}
            </ul>
        </div>
    `;
    document.getElementById('sidebar').innerHTML = sidebarHTML;
}
```

### Pattern 3: API Helper with Tenant + API Key
**What:** Centralized fetch wrapper that automatically includes tenant index and API key header.
**When to use:** All API calls from any page.
**Example:**

```javascript
// public/js/shared.js
const API_KEY_STORAGE = 'sageconnect_api_key';
const TENANT_STORAGE = 'sageconnect_tenant';

function getTenantIndex() {
    return parseInt(localStorage.getItem(TENANT_STORAGE) || '0', 10);
}

async function apiCall(method, path, body = null) {
    const apiKey = localStorage.getItem(API_KEY_STORAGE) || '';
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Accept': 'application/json; charset=utf-8',
        },
    };
    if (apiKey) opts.headers['x-api-key'] = apiKey;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    return res.json();
}
```

### Pattern 4: Expandable Table Rows (Bootstrap Collapse)
**What:** Payment/PO tables where clicking a row expands a detail sub-row.
**When to use:** UI-03 (payment invoice drill-down), and PO detail views.
**Example:**

```html
<tbody>
    <!-- Main row -->
    <tr data-bs-toggle="collapse" data-bs-target="#detail-PY001" role="button" aria-expanded="false" style="cursor:pointer;">
        <td>PY001</td>
        <td>Proveedor X</td>
        <td><span class="badge bg-success">Listo</span></td>
        <td>$15,000.00</td>
    </tr>
    <!-- Detail row (hidden by default) -->
    <tr>
        <td colspan="4" class="p-0 border-0">
            <div class="collapse" id="detail-PY001">
                <div class="p-3 bg-light">
                    <table class="table table-sm mb-0">
                        <thead><tr><th>Factura</th><th>UUID</th><th>Monto</th></tr></thead>
                        <tbody>
                            <tr><td>F-001</td><td>abc-123</td><td>$10,000.00</td></tr>
                            <tr><td>F-002</td><td>def-456</td><td>$5,000.00</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </td>
    </tr>
</tbody>
```

### Pattern 5: SSE Timeline (EventSource + Step Progress)
**What:** Real-time vertical timeline showing cron cycle steps as they complete.
**When to use:** Schedule dashboard (UI-07) when a background cycle or manual trigger is active.
**Example:**

```javascript
function connectSSE(operationId) {
    const evtSource = new EventSource(`/api/operations/${operationId}/stream`);

    evtSource.addEventListener('progress', (e) => {
        const data = JSON.parse(e.data);
        // data = { type, operation, tenant, step, message, timestamp }
        updateTimeline(data);
    });

    evtSource.addEventListener('complete', (e) => {
        const data = JSON.parse(e.data);
        markTimelineComplete();
        evtSource.close();
    });

    evtSource.addEventListener('error', (e) => {
        // Check for explicit close vs reconnectable error
        if (evtSource.readyState === EventSource.CLOSED) {
            console.log('SSE connection closed by server');
        }
        // EventSource auto-reconnects unless explicitly closed
    });

    return evtSource;
}
```

**SSE Event Shape (from background.js):**
```json
{
    "type": "progress",
    "operation": "background-cycle",
    "tenant": "TENANT_ID_STRING",
    "step": "buildProviders|downloadCFDI|checkPayments|uploadPayments|createPurchaseOrders|processOrderChanges|closePurchaseOrders",
    "message": "Iniciando buildProvidersXML para tenant 0",
    "timestamp": "2026-03-24T05:00:00.000Z"
}
```

**Steps per tenant (7 total):** buildProviders, downloadCFDI, checkPayments, uploadPayments, createPurchaseOrders, processOrderChanges, closePurchaseOrders.

### Pattern 6: Toast Notifications for Action Results
**What:** Bootstrap Toast for showing success/error feedback after API actions.
**When to use:** After any action button click (upload, repair, trigger, etc.).
**Example:**

```javascript
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const id = 'toast-' + Date.now();
    const bgClass = type === 'success' ? 'bg-success' : 'bg-danger';
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle';

    container.insertAdjacentHTML('beforeend', `
        <div id="${id}" class="toast align-items-center text-white ${bgClass} border-0" role="alert">
            <div class="d-flex">
                <div class="toast-body">
                    <i class="fas ${icon} me-2"></i>${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    `);

    const toastEl = document.getElementById(id);
    const toast = new bootstrap.Toast(toastEl, { delay: 5000 });
    toast.show();
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}
```

### Anti-Patterns to Avoid
- **Inline `<script>` duplication across pages:** Put shared logic (API calls, tenant state, toast, sidebar) in `shared.js`. Only page-specific logic goes inline.
- **Polling for real-time updates:** Use SSE via `EventSource` -- never `setInterval` + `fetch` for operation progress.
- **Storing API key in HTML:** Store in `localStorage` and let the user input it once via a small settings prompt or hardcode in shared.js for internal use.
- **Building custom collapse animations:** Use Bootstrap's built-in Collapse component -- it handles accessibility and smooth transitions.
- **Fetching data on page load without loading state:** Always show a spinner/skeleton while API calls are in flight.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron expression description | Regex parser for cron | cronstrue (CDN, 8KB) | 30+ edge cases in cron syntax, Spanish locale built-in |
| Table row expand/collapse | Custom show/hide with CSS | Bootstrap 5.3 Collapse on `<tr>` | Handles animation, aria attributes, keyboard nav, event hooks |
| Toast notifications | Custom div show/hide | Bootstrap 5.3 Toast component | Auto-dismiss, stacking, accessible, 0 custom code |
| SSE connection management | Custom XHR long-polling | Native EventSource API | Built-in reconnection, event parsing, lightweight |
| Confirmation dialogs | Custom modal from scratch | `window.confirm()` or Bootstrap Modal | For destructive ops, simple confirm is sufficient; Modal if richer UI needed |
| Date/time formatting | Custom date formatter | `Intl.DateTimeFormat` (built-in) | Spanish locale support, timezone-aware, zero dependencies |
| Number formatting | Custom currency formatter | `Intl.NumberFormat` (built-in) | MXN currency, thousands separators, zero dependencies |

**Key insight:** This is a multi-page vanilla JS app with no build system. Every hand-rolled component adds unreviewable inline code. Use Bootstrap components and browser APIs wherever possible to keep each page maintainable.

## Common Pitfalls

### Pitfall 1: Static File Routing Mismatch
**What goes wrong:** New HTML files in `/public` are served at `/public/schedule.html` but CONTEXT.md expects `/schedule.html`.
**Why it happens:** `express.static` is mounted at `/public` prefix, not at root.
**How to avoid:** Add explicit `app.get('/schedule.html', ...)` routes for each page OR add a root-level static mount `app.use(express.static(...))`. The explicit route approach is safer as it doesn't expose all files.
**Warning signs:** Links in sidebar return 404; existing dashboard at `/public/index.html` stops working.

### Pitfall 2: API Key Not Available in Frontend
**What goes wrong:** Payment and PO endpoints require `x-api-key` header. If the frontend doesn't have the key, all API calls return 401.
**Why it happens:** The key is in `.env` server-side. No mechanism exists to pass it to the browser.
**How to avoid:** Either (a) store the API key in localStorage after a one-time prompt, (b) create a small unauthenticated endpoint that returns whether API key is required, or (c) hardcode it since this is an internal-only tool on a local network. Option (c) is simplest given the "no auth" decision.
**Warning signs:** All payment/PO views show "Unauthorized" errors.

### Pitfall 3: Tenant Switcher Has No Tenant Names
**What goes wrong:** config.portal.tenants has `id`, `key`, `secret`, `database`, `externalId` -- but no human-readable name.
**Why it happens:** Tenant config was designed for API consumption, not UI display.
**How to avoid:** Either (a) add a `TENANT_NAMES` env var, (b) display tenant database name as label (it's the most meaningful identifier), or (c) create a GET /api/tenants endpoint returning displayable info. Option (b) is simplest -- `config.portal.tenants[i].database` is a recognizable name like "FESA".
**Warning signs:** Dropdown shows "Tenant 0", "Tenant 1" with no user context.

### Pitfall 4: SSE Connection Stays Open After Navigation
**What goes wrong:** If user navigates away from schedule page while SSE is active, the EventSource stays open consuming server resources.
**Why it happens:** Multi-page apps don't have a SPA router to clean up. Browser closes connections on navigation, but only if page fully unloads.
**How to avoid:** Call `evtSource.close()` in a `beforeunload` event listener. Also, the server's SSE endpoint already handles `req.on('close')` for cleanup.
**Warning signs:** Multiple SSE connections accumulate on the server.

### Pitfall 5: Reconciliation Returns Counts, Not Arrays
**What goes wrong:** The UI-02 table expects payment records, but `POST /reconciliation` with `dryRun=true` returns only category COUNTS (e.g., `ready: 5`), not the full payment arrays.
**Why it happens:** Phase 7 decision: `runReconciliation returns category counts (not full arrays) for lightweight API responses`.
**How to avoid:** The reconciliation endpoint returns counts in the envelope `data.categories`. For the detailed table, need to either (a) modify the API to optionally return full arrays when a `detail=true` param is passed, or (b) use a different endpoint combination. This is a **critical integration gap** -- the planner must decide whether to extend the API or adjust UI expectations.
**Warning signs:** Payment table shows counts but no individual payment rows.

### Pitfall 6: Confirmation Before Destructive Ops But dryRun Default
**What goes wrong:** User clicks "Upload Payments", confirms dialog, but API defaults to `dryRun=true` so nothing happens.
**Why it happens:** All destructive endpoints default to dry-run by design (Phase 7 safety decision).
**How to avoid:** When the user explicitly confirms an action, pass `dryRun: false` in the request body. The confirmation dialog is the UI-level safety net; `dryRun: true` is the API-level safety net. Both exist, but the UI must explicitly override dryRun on confirmed actions.
**Warning signs:** User clicks "Upload" + confirms, but portal receives nothing.

### Pitfall 7: Bootstrap Collapse Inside Tables
**What goes wrong:** Collapse animation glitches or doesn't work inside `<table>` elements.
**Why it happens:** Bootstrap Collapse animates `height` property, which behaves differently on `<tr>` elements.
**How to avoid:** Put the `.collapse` div INSIDE a `<td colspan="N">` in the detail row, not on the `<tr>` itself. The `<tr>` should have `class="p-0 border-0"` styles on its `<td>` to prevent visual gaps.
**Warning signs:** Choppy animation, rows jumping, layout breaks.

## Code Examples

### Tenant List Endpoint (New, Lightweight)
The UI needs tenant names. Current config has no names. Recommended: create a small unauthenticated endpoint.

```javascript
// In system-routes.js or schedule-routes.js
router.get('/tenants', (_req, res) => {
    const tenants = config.portal.tenants.map((t, i) => ({
        index: i,
        name: t.database || `Tenant ${i}`,  // database name is most recognizable
        id: t.id,
    }));
    res.json(successResult({ tenants }, 'Tenant list'));
});
```

### Page Layout Template (Sidebar + Content)
```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SageConnect - Pagos</title>
    <!-- Same CDN links as existing dashboard -->
</head>
<body>
    <div class="d-flex">
        <!-- Sidebar placeholder (rendered by shared.js) -->
        <div id="sidebar"></div>

        <!-- Main content -->
        <div class="flex-grow-1" style="min-height: 100vh;">
            <!-- Page header -->
            <div class="p-3 border-bottom bg-white">
                <h4 class="mb-0"><i class="fas fa-credit-card me-2"></i>Pagos</h4>
            </div>

            <!-- Page content -->
            <div class="p-4" id="main-content">
                <!-- Loading state -->
                <div id="loading" class="text-center py-5">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Cargando...</span>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Toast container (fixed position) -->
    <div id="toast-container" class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 1100;"></div>

    <script src="/js/shared.js"></script>
    <script>
        // Page-specific code
        document.addEventListener('DOMContentLoaded', () => {
            initPage('/payments.html');
            loadPaymentsData();
        });
    </script>
</body>
</html>
```

### Summary Cards Pattern (Payment Categories)
```javascript
function renderCategoryCards(categories) {
    const cardDefs = [
        { key: 'ready', label: 'Listos', icon: 'fa-check-circle', bg: 'bg-success' },
        { key: 'no_providerid', label: 'Sin PROVIDERID', icon: 'fa-user-slash', bg: 'bg-warning' },
        { key: 'no_uuid', label: 'Sin UUID', icon: 'fa-fingerprint', bg: 'bg-danger' },
        { key: 'not_in_portal', label: 'No en Portal', icon: 'fa-cloud-slash', bg: 'bg-secondary' },
        { key: 'provider_mismatch', label: 'Proveedor No Coincide', icon: 'fa-exchange-alt', bg: 'bg-info' },
    ];

    return cardDefs.map(def => `
        <div class="col">
            <div class="card status-card h-100 text-center" role="button"
                 onclick="filterByCategory('${def.key}')" data-category="${def.key}">
                <div class="card-body">
                    <i class="fas ${def.icon} fa-2x ${def.bg.replace('bg-', 'text-')} mb-2"></i>
                    <div class="fs-2 fw-bold">${categories[def.key] || 0}</div>
                    <div class="text-muted small">${def.label}</div>
                </div>
            </div>
        </div>
    `).join('');
}
```

### Vertical Timeline (SSE-driven)
```javascript
function addTimelineStep(data) {
    const timeline = document.getElementById('timeline');
    const stepLabels = {
        'buildProviders': 'Construir Proveedores XML',
        'downloadCFDI': 'Descargar CFDIs',
        'checkPayments': 'Verificar Pagos',
        'uploadPayments': 'Subir Pagos',
        'createPurchaseOrders': 'Crear Ordenes de Compra',
        'processOrderChanges': 'Procesar Cambios de Ordenes',
        'closePurchaseOrders': 'Cerrar Ordenes de Compra',
    };

    const stepEl = document.createElement('div');
    stepEl.className = 'd-flex align-items-start mb-3';
    stepEl.innerHTML = `
        <div class="me-3">
            <i class="fas fa-spinner fa-spin text-primary"></i>
        </div>
        <div>
            <strong>${stepLabels[data.step] || data.step}</strong>
            <div class="text-muted small">Tenant: ${data.tenant} -- ${new Date(data.timestamp).toLocaleTimeString('es-MX')}</div>
        </div>
    `;
    stepEl.dataset.step = data.step;
    stepEl.dataset.tenant = data.tenant;
    timeline.appendChild(stepEl);

    // Mark previous step as complete
    const steps = timeline.querySelectorAll('[data-step]');
    if (steps.length > 1) {
        const prev = steps[steps.length - 2];
        prev.querySelector('i').className = 'fas fa-check-circle text-success';
    }
}
```

### Date/Time Formatting (Spanish Locale)
```javascript
// Use built-in Intl API -- no library needed
function formatDateTime(isoString) {
    if (!isoString) return 'No disponible';
    return new Intl.DateTimeFormat('es-MX', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'America/Mexico_City',
    }).format(new Date(isoString));
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
    }).format(amount);
}
```

### Cron Description (cronstrue)
```javascript
// Requires cronstrue + es locale loaded via CDN
function describeCron(expression) {
    try {
        return cronstrue.toString(expression, { locale: 'es' });
    } catch {
        return expression; // fallback to raw expression
    }
}
// describeCron('*/15 * * * *') => "Cada 15 minutos"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single monolithic index.html | Multi-page with shared JS | Phase 9 | Sidebar nav, modular pages |
| Dashboard polls `/api/dashboard` every 30s | SSE for real-time, on-demand fetch for data views | Phase 8/9 | No polling for progress; explicit refresh for tables |
| No API key in frontend | x-api-key for payment/PO endpoints | Phase 7 | Frontend must include header on write operations |
| Tenant hardcoded as index 0 | Tenant switcher with localStorage | Phase 9 | Multi-tenant UI support |

**Existing patterns preserved:**
- Bootstrap 5.3 via CDN (same SRI hashes)
- Dark gradient background (existing CSS)
- Card-based layout with rounded corners and shadows
- Spanish labels throughout
- Font Awesome icons for visual cues

## Open Questions

1. **Reconciliation Detail Data (CRITICAL)**
   - What we know: `POST /api/payments/reconciliation` returns category COUNTS only (not full arrays) per Phase 7 decision.
   - What's unclear: UI-02 and UI-03 need individual payment rows for the filterable table and invoice drill-down. Do we need to modify the API to support a `detail=true` parameter that returns full arrays?
   - Recommendation: Add an optional `includeDetails: true` body param to the reconciliation endpoint that returns full category arrays (not just counts). This is a small Phase 7 endpoint modification. Alternatively, accept counts-only and show a summary-only UI.

2. **API Key Delivery to Frontend**
   - What we know: `x-api-key` header required for payment/PO endpoints. Key is in `.env`.
   - What's unclear: How the frontend obtains the key.
   - Recommendation: Since this is an internal tool on a private network with explicit "no auth" decision, embed the API key as a constant in `shared.js` (sourced from config at build/deployment time) or prompt the user once and store in localStorage. The latter is slightly more secure.

3. **Tenant Display Names**
   - What we know: `config.portal.tenants` has `id`, `database`, `externalId` -- no display name.
   - What's unclear: What to show in the dropdown.
   - Recommendation: Use `database` field as the display name (e.g., "FESA") -- it's the most recognizable identifier for the operations team. Add a lightweight `/api/system/tenants` endpoint.

4. **Logs Page -- Reuse or Rewrite**
   - What we know: Current `index.html` is ~850 lines of working dashboard code.
   - What's unclear: Copy it entirely to `logs.html` with sidebar added? Or rewrite?
   - Recommendation: Copy `index.html` to `logs.html`, add the sidebar wrapper and `shared.js` import, remove the top navbar (replaced by sidebar). Minimal changes to working code.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7 + supertest 7.2 |
| Config file | package.json `"test": "jest"` |
| Quick run command | `npx jest --testPathPattern=tests/ --bail` |
| Full suite command | `npx jest` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | Payment audit view renders 5 category cards | manual-only | N/A -- browser UI, no headless test infra | N/A |
| UI-02 | Payment table filters by status | manual-only | N/A -- DOM manipulation in browser | N/A |
| UI-03 | Payment row expands to show invoices | manual-only | N/A -- Bootstrap Collapse behavior | N/A |
| UI-04 | PO status table displays posted/error/pending | manual-only | N/A -- browser UI | N/A |
| UI-05 | PO diagnostic search returns results | integration | `npx jest tests/api/po-routes.test.js -t "diagnostic" -x` | Existing (backend) |
| UI-06 | Authorized POs list displays | manual-only | N/A -- browser UI | N/A |
| UI-07 | Schedule dashboard shows next run, history, trigger | integration | `npx jest tests/api/schedule-routes.test.js -x` | Existing (backend) |
| UI-08 | Tenant switcher changes context | manual-only | N/A -- localStorage + DOM | N/A |
| SERVE | New HTML pages are served at correct URLs | integration | `npx jest tests/api/ui-routes.test.js -x` | Wave 0 |
| API-KEY | Frontend API calls include x-api-key | integration | Covered by existing payment/PO tests | Existing |

### Sampling Rate
- **Per task commit:** `npx jest --bail` (existing backend tests don't break)
- **Per wave merge:** `npx jest` (full suite)
- **Phase gate:** Full suite green + manual browser verification of all 4 pages

### Wave 0 Gaps
- [ ] `tests/api/ui-routes.test.js` -- verifies new HTML pages are served at correct URLs (GET /schedule.html, /payments.html, /pos.html, /logs.html return 200 with HTML content-type)
- [ ] Manual test checklist document for browser verification (sidebar renders, tenant switches, cards display, SSE connects)

**Note:** This phase is primarily frontend HTML/CSS/JS. Automated testing of DOM behavior requires a browser testing framework (Puppeteer, Playwright) which is NOT in the project stack and would add significant complexity. The pragmatic approach is: (1) automated tests for route serving, (2) manual browser verification for UI behavior.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `public/index.html` -- established Bootstrap 5.3 patterns, CDN URLs, CSS custom properties, JS fetch patterns
- Existing codebase: `src/routes/*-routes.js` -- all 20 endpoint signatures, request/response shapes
- Existing codebase: `src/background.js` -- SSE event shape (`type`, `operation`, `tenant`, `step`, `message`, `timestamp`)
- Existing codebase: `src/services/OperationManager.js` -- `emitProgress`, `getRunningOperations`, `getHistory` API
- Existing codebase: `src/services/CronScheduler.js` -- `getSchedulerStatus` returns `{ cronExpression, status, nextRun, lastRun }`
- [Bootstrap 5.3 Collapse docs](https://getbootstrap.com/docs/5.3/components/collapse/) -- HTML structure, data attributes, table row pattern
- [MDN EventSource API](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) -- constructor, events, readyState, close()
- [MDN Using Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) -- retry field, named events, auto-reconnection

### Secondary (MEDIUM confidence)
- [cronstrue GitHub](https://github.com/bradymholt/cRonstrue) -- v3.14.0, CDN via unpkg, Spanish locale support
- [Bootstrap 5.3 Toast docs](https://getbootstrap.com/docs/5.0/components/toasts/) -- initialization, auto-hide, positioning

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- using exact same libraries already in project, verified CDN URLs from existing code
- Architecture: HIGH -- patterns derived from existing codebase analysis (routes, middleware, static serving)
- Pitfalls: HIGH -- identified from actual code inspection (reconciliation returns counts, static mount at /public, tenant config lacks names)
- SSE integration: HIGH -- verified event shape from actual background.js code
- API integration: HIGH -- all endpoint signatures verified from route files

**Research date:** 2026-03-24
**Valid until:** 2026-04-24 (stable -- Bootstrap 5.3 and vanilla JS patterns don't change rapidly)
