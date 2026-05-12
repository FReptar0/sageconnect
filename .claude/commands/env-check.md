---
description: Validate that `.env` loads without errors and report key configured values
---

Verify the `.env` file loads cleanly through `src/config.js`.

1. Run:
   ```bash
   node -e "const c = require('./src/config'); console.log(JSON.stringify({db: c.database.server, portalUrl: c.portal.url, tenants: c.portal.tenants.length, cron: c.schedule.cronExpression, hasApiKey: !!c.security.apiKey, hasLicenseUrl: !!c.license.apiUrl}, null, 2))"
   ```
2. If the process exits 1 with `[CONFIG ERROR]`, list the missing variables (the error message names them) and point the user to `.env.example` for the canonical template.
3. If it succeeds but `hasApiKey` is `false`, surface the `[CONFIG WARN] SAGECONNECT_API_KEY not set` warning — dashboard API key protection is disabled in that state, which is fine for local dev but not for any shared environment.
4. Do not print the actual value of any secret. The check above intentionally only reports presence (`hasApiKey`, `hasLicenseUrl`) and non-sensitive values (server hostname, portal URL, tenant count, cron expression).

Report findings concisely; one paragraph plus a bulleted list of any gaps.
