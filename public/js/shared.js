/**
 * SageConnect - Shared JavaScript Module
 *
 * Provides sidebar navigation, tenant state management, API helper,
 * toast notifications, and date/currency formatters for all operational pages.
 */

/* ========================================================================
 * Constants
 * ======================================================================== */

const TENANT_STORAGE = 'sageconnect_tenant';
const API_KEY_STORAGE = 'sageconnect_api_key';

/** Populated on init from GET /api/system/tenants */
window.__TENANTS__ = [];

/* ========================================================================
 * Tenant State Management
 * ======================================================================== */

/**
 * Returns the currently selected tenant index from localStorage.
 * Defaults to 0 if not set or invalid.
 * @returns {number}
 */
function getTenantIndex() {
    const stored = localStorage.getItem(TENANT_STORAGE);
    const idx = parseInt(stored, 10);
    return Number.isNaN(idx) ? 0 : idx;
}

/**
 * Saves tenant index to localStorage and refreshes the current page data.
 * If `window.onTenantChange` is defined it is called; otherwise the page reloads.
 * @param {number|string} idx
 */
function setTenantIndex(idx) {
    localStorage.setItem(TENANT_STORAGE, String(idx));
    if (typeof window.onTenantChange === 'function') {
        window.onTenantChange();
    } else {
        location.reload();
    }
}

/* ========================================================================
 * API Helper
 * ======================================================================== */

/**
 * Performs an API call with standard headers and optional API key.
 * @param {string} method - HTTP method (GET, POST, PUT, etc.)
 * @param {string} path   - URL path (e.g. '/api/payments/reconcile')
 * @param {object|null} body - Request body (will be JSON-stringified)
 * @returns {Promise<object>} Parsed JSON response
 */
async function apiCall(method, path, body = null) {
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json; charset=utf-8',
    };

    const apiKey = localStorage.getItem(API_KEY_STORAGE);
    if (apiKey) {
        headers['x-api-key'] = apiKey;
    }

    const opts = { method, headers };
    if (body) {
        opts.body = JSON.stringify(body);
    }

    try {
        const res = await fetch(path, opts);
        return await res.json();
    } catch (err) {
        showToast('Error de red: ' + err.message, 'error');
        throw err;
    }
}

/* ========================================================================
 * Sidebar Renderer
 * ======================================================================== */

/** Navigation items (Spanish labels) */
const NAV_ITEMS = [
    { href: '/schedule.html', icon: 'fa-calendar-check', label: 'Programacion' },
    { href: '/payments.html', icon: 'fa-credit-card',    label: 'Pagos' },
    { href: '/pos.html',      icon: 'fa-file-invoice',   label: 'Ordenes de Compra' },
    { href: '/logs.html',     icon: 'fa-terminal',       label: 'Logs' },
];

/**
 * Renders the sidebar navigation into `<div id="sidebar">`.
 * @param {string} activePage - The current page path (e.g. '/logs.html')
 */
function renderSidebar(activePage) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    // Build tenant options
    const tenantIdx = getTenantIndex();
    const tenantOptions = window.__TENANTS__
        .map(t => `<option value="${t.index}"${t.index === tenantIdx ? ' selected' : ''}>${t.name}</option>`)
        .join('');

    // Build nav links
    const navLinks = NAV_ITEMS.map(item => {
        const isActive = activePage === item.href ? ' active' : '';
        return `
            <li class="nav-item">
                <a class="nav-link text-white${isActive}" href="${item.href}"
                   style="${isActive ? 'background: rgba(255,255,255,0.15); border-radius: 6px;' : ''}">
                    <i class="fas ${item.icon} me-2"></i>${item.label}
                </a>
            </li>`;
    }).join('');

    sidebar.innerHTML = `
        <div class="d-flex flex-column bg-dark text-white p-3" style="width: 220px; min-height: 100vh;">
            <!-- Brand -->
            <a href="/schedule.html" class="text-white text-decoration-none mb-3">
                <h5 class="mb-0"><i class="fas fa-cogs me-2"></i>SageConnect</h5>
            </a>

            <!-- Tenant Switcher -->
            <select id="tenantSwitcher" class="form-select form-select-sm mb-3 bg-secondary text-white border-0">
                ${tenantOptions}
            </select>

            <hr class="text-secondary my-2">

            <!-- Navigation -->
            <ul class="nav nav-pills flex-column gap-1">
                ${navLinks}
            </ul>
        </div>
    `;

    // Event: tenant switcher change
    const switcher = document.getElementById('tenantSwitcher');
    if (switcher) {
        switcher.addEventListener('change', function () {
            setTenantIndex(this.value);
        });
    }
}

/* ========================================================================
 * Toast Notifications
 * ======================================================================== */

/**
 * Shows a Bootstrap 5.3 toast notification.
 * @param {string} message - Notification text
 * @param {'success'|'error'|'warning'} type - Toast type
 */
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container position-fixed top-0 end-0 p-3';
        container.style.zIndex = '1100';
        document.body.appendChild(container);
    }

    const styles = {
        success: { bg: 'bg-success text-white', icon: 'fa-check-circle' },
        error:   { bg: 'bg-danger text-white',  icon: 'fa-exclamation-triangle' },
        warning: { bg: 'bg-warning text-dark',  icon: 'fa-exclamation-circle' },
    };
    const s = styles[type] || styles.success;

    const id = 'toast-' + Date.now();
    const toastHTML = `
        <div id="${id}" class="toast align-items-center ${s.bg} border-0" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="d-flex">
                <div class="toast-body">
                    <i class="fas ${s.icon} me-2"></i>${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Cerrar"></button>
            </div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', toastHTML);

    const toastEl = document.getElementById(id);
    const bsToast = new bootstrap.Toast(toastEl, { delay: 5000 });
    bsToast.show();

    // Remove from DOM after hidden
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

/* ========================================================================
 * Date / Currency Formatters
 * ======================================================================== */

/**
 * Formats an ISO date string to a human-readable date+time in Mexico City tz.
 * @param {string} isoString
 * @returns {string}
 */
function formatDateTime(isoString) {
    if (!isoString) return 'No disponible';
    try {
        return new Intl.DateTimeFormat('es-MX', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'America/Mexico_City',
        }).format(new Date(isoString));
    } catch {
        return 'No disponible';
    }
}

/**
 * Formats a number as MXN currency.
 * @param {number} amount
 * @returns {string}
 */
function formatCurrency(amount) {
    if (amount == null || amount === '' || isNaN(amount)) return '$0.00';
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
    }).format(amount);
}

/* ========================================================================
 * Confirmation Dialog
 * ======================================================================== */

/**
 * Shows a native confirmation dialog.
 * @param {string} message
 * @returns {boolean}
 */
function confirmAction(message) {
    return window.confirm(message);
}

/* ========================================================================
 * Page Initializer
 * ======================================================================== */

/**
 * Initializes a page: fetches tenants, renders sidebar, sets up tenant switcher.
 * Must be called from DOMContentLoaded on every page.
 * @param {string} activePage - Current page path (e.g. '/logs.html')
 */
async function initPage(activePage) {
    try {
        const res = await fetch('/api/system/tenants', {
            headers: { 'Accept': 'application/json; charset=utf-8' },
        });
        const json = await res.json();
        if (json.success && json.data && json.data.tenants) {
            window.__TENANTS__ = json.data.tenants;
        }
    } catch (err) {
        console.warn('[shared.js] No se pudieron cargar los tenants:', err.message);
    }

    renderSidebar(activePage);
}
