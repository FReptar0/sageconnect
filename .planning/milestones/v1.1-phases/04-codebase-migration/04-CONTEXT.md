# Phase 4: Codebase Migration - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Reemplazar todas las llamadas `dotenv.config()` dispersas en el codebase con `require` del config loader centralizado (`src/config.js`). Eliminar archivos `.env.*.example` redundantes. Crear el `.env.example` unificado final. Corregir colision de variable USER con OS. No se modifica logica de negocio — solo como se accede a la configuracion.

</domain>

<decisions>
## Implementation Decisions

### USER env var collision fix
- Renombrar `USER` a `DB_USER` y `PASSWORD` a `DB_PASSWORD` en `.env` y `.env.example`
- Actualizar `src/config.js` para leer de `DB_USER`/`DB_PASSWORD` en lugar de `USER`/`PASSWORD`
- Actualizar la validacion de variables requeridas para usar los nuevos nombres
- Actualizar `tests/config.test.js` para reflejar los nuevos nombres

### Migration strategy
- Migracion all-at-once (no por capas) — reemplazar las 25+ llamadas `dotenv.config()` en un solo pass
- Import style: `const config = require('../config')` directo en cada modulo (no dependency injection)
- Node.js cachea el modulo — `config.js` solo se ejecuta una vez sin importar cuantos modulos lo requieran
- Patron de reemplazo:
  ```
  // Antes:
  const dotenv = require('dotenv');
  const creds = dotenv.config({ path: '.env.credentials.focaltec' });
  const url = creds.parsed.URL;

  // Despues:
  const config = require('../config');
  const url = config.portal.url;
  ```

### Cleanup scope
- Eliminar de raiz: `.env.credentials.database.example`, `.env.credentials.focaltec.example`, `.env.credentials.mailing.example`, `.env.path.example`
- Eliminar `dist/.env.example`
- El `.env.example` viejo de raiz ya fue reemplazado por el nuevo en Phase 3 — verificar que no haya duplicado
- No eliminar backups en `/reports/` (decision de milestone: keep as-is)

### Claude's Discretion
- Orden exacto de modulos dentro del pass de migracion
- Manejo de imports `dotenv` que quedan sin uso despues de la migracion (eliminar o dejar)
- Si actualizar tests existentes que mockean dotenv para usar el nuevo patron

</decisions>

<specifics>
## Specific Ideas

- Cada modulo que antes hacia `dotenv.config({ path: '.env.credentials.X' }).parsed` ahora hace `require('../config')` y accede por la seccion correcta
- Los modulos que usaban `process.env.TIMEZONE` directamente ahora usan `config.app.timezone`
- `background.js` cargaba dos .env files — ahora un solo `require`
- Los scripts en `src/scripts/` tienen paths relativos diferentes (../../config) — asegurar el path correcto

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config.js` (Phase 3): loader listo, solo necesita el rename de USER->DB_USER
- `tests/config.test.js` (Phase 3): 27 tests, necesitan actualizar los nombres de vars
- `.env` y `.env.example` (Phase 3): necesitan el rename

### Established Patterns
- Dos patrones de acceso actuales: `.parsed` (directo del return de dotenv) y `process.env`
- Multi-tenant arrays: `TENANT_ID.split(',')` en 6+ archivos — ahora `config.portal.tenants[index]`
- `logGenerator` usa `path_env.parsed.LOG_PATH` — ahora `config.paths.logs`

### Integration Points
- 30+ archivos JavaScript necesitan migracion (utils, controllers, scripts, services)
- `src/background.js` y `src/index.js` son entry points — migracion critica
- `tests/PaymentReconciliation.test.js` mockea dotenv — puede necesitar actualizacion
- `tests/EnhancedPaymentSync.test.js` y `tests/GetPaymentCFDI.test.js` tambien mockean dotenv

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-codebase-migration*
*Context gathered: 2026-03-23*
