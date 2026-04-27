---
type: hotfix
milestone: v2.3
discovered_during: production validation after rate-limit hotfix (PR #17, 2026-04-27)
severity: high
subsystem: api-infra / dashboard-auth
tags: [api-key, dashboard, auth, html-injection, ux]
status: in_progress

# Discovery
reported_by: production browser session — POST /api/schedule/background-cycle/trigger returned 401 Unauthorized
diagnosed_via: |
  After resolving the rate-limit issue, the dashboard rendered correctly but
  "Ejecutar Ahora" returned 401. DevTools Network tab showed the trigger POST
  was sent without an `x-api-key` header. Code inspection of `public/js/shared.js`
  revealed apiCall() reads the key from `localStorage.getItem('sageconnect_api_key')`
  — but no UI, prompt, or bootstrap code anywhere in the codebase ever writes
  to that key. The dashboard had no way to authenticate itself.

# Files
affected:
  - src/server.js (HTML serving routes inject meta tag)
  - public/js/shared.js (apiCall reads from meta tag with localStorage fallback)
  - tests/api/html-key-injection.test.js (new)
---

# HOTFIX: Inject API Key into Dashboard HTML Server-Side

## Root Cause

`SAGECONNECT_API_KEY` (configured in `.env` on each prod server) gates protected endpoints via the `requireApiKey` middleware (`src/middleware/api-key.js`). The dashboard JS reads this key from `localStorage` (`public/js/shared.js:65`):

```js
const apiKey = localStorage.getItem(API_KEY_STORAGE);
if (apiKey) {
    headers['x-api-key'] = apiKey;
}
```

But **nothing in the codebase writes to that localStorage entry**. There's no settings UI, no bootstrap prompt, no first-load handler. So when the operator opens the dashboard for the first time, every protected request goes out without the header → 401 Unauthorized.

The dashboard has been silently broken for any deployment with `SAGECONNECT_API_KEY` configured. The bug surfaced now because Phase 17 added a prominent "Ejecutar Ahora" button that operators want to use, exposing the latent issue.

## Fix Approach

Three options were considered:
- **A. Prompt operator on first load** — Modal asks for key, stores in localStorage. Rejected: requires per-browser config and exposes a key the operator should never need to handle.
- **B. Server-side injection** — Server renders the key into the HTML as `<meta name="x-app-key" content="...">` when serving each dashboard page. Dashboard JS reads from the meta tag. **Chosen.**
- **C. Skip auth for same-origin** — Dilutes the auth model, introduces CSRF surface. Rejected.

Option B is the right call because the operator never has to know the key exists. Same-origin dashboard requests get the key transparently, external clients still need the header.

## Implementation

### 1. `src/server.js` — replace static `sendFile` with key-injecting handler

```js
function serveHtmlWithKey(relativePath) {
    return (_req, res) => {
        const filePath = process.cwd() + '/public/' + relativePath;
        let html = fs.readFileSync(filePath, 'utf8');
        const key = config.security.apiKey || '';
        if (key && html.includes('</head>')) {
            const meta = `<meta name="x-app-key" content="${escapeAttr(key)}">`;
            html = html.replace('</head>', `    ${meta}\n</head>`);
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    };
}
```

Mounted on the four dashboard pages: `/schedule.html`, `/payments.html`, `/pos.html`, `/logs.html`.

### 2. `public/js/shared.js` — read meta tag first, fall back to localStorage

```js
function resolveApiKey() {
    const meta = document.querySelector('meta[name="x-app-key"]');
    const fromMeta = meta && meta.getAttribute('content');
    if (fromMeta) return fromMeta;
    return localStorage.getItem(API_KEY_STORAGE);
}

async function apiCall(method, path, body = null) {
    // ...
    const apiKey = resolveApiKey();
    if (apiKey) headers['x-api-key'] = apiKey;
    // ...
}
```

Backward-compatible: if anyone has set localStorage manually as a workaround, it still works.

## Caller Impact

- **`schedule.html`, `pos.html`, `payments.html`** — use `apiCall()`, automatically get the meta-injected key. No changes needed.
- **`index.html`, `logs.html`** — use raw `fetch()` (don't go through `apiCall()`). Out of scope for this hotfix; their endpoints are mostly read-only and not behind `requireApiKey`. If broken, separate hotfix.
- **External integrations** — unchanged. They send `x-api-key` directly as before.

## Security Notes

- The key is exposed in the HTML source viewable by anyone who can load the dashboard page. This is acceptable: the operator with dashboard access already has access to the `.env` file containing the same key.
- The key is HTML-attribute-escaped (`escapeAttr` handles `&`, `<`, `>`, `"`) to prevent injection if the configured value ever contained those characters.
- If `SAGECONNECT_API_KEY` is empty/unset, no meta tag is injected and the dashboard preserves prior behavior (no header sent).

## Test Coverage

`tests/api/html-key-injection.test.js`:
- `escapeAttr` correctly escapes `& < > "` and coerces non-strings
- `serveHtmlWithKey` injects the meta tag before `</head>` with the configured key value
- Original HTML structure is preserved (no truncation, no double-injection)
- Returns 500 when the requested file does not exist

5/5 pass.

## Validation

1. `npm test -- tests/api/html-key-injection.test.js` — passes (5/5)
2. Full suite: same 4 pre-existing failures as master (`PaymentReconciliation`, `TransformTime`, `no-process-exit`, `enforcement-wiring`) — none related to this change
3. Post-deploy on prod:
   - Open `/schedule.html`, View Source → confirm `<meta name="x-app-key" content="...">` is present in `<head>`
   - Press "Ejecutar Ahora" — should NOT return 401, should return 200 (or 409 if a cycle is already running)
   - DevTools Network tab → trigger request should show `x-api-key` header in Request Headers

## Deployment

Standard flow:
1. Merge PR `hotfix/inject-api-key-server-side` into `master`.
2. GH Action `obfuscate-deploy.yml` publishes to `sageconnect-dist`.
3. On ZCL-RDS-02:
   ```powershell
   Stop-Service SageConnect
   cd E:\sageconnect-dist
   git fetch && git reset --hard origin/master
   npm install --omit=dev
   Start-Service SageConnect
   ```
4. Open `/schedule.html` and verify "Ejecutar Ahora" works without 401.
