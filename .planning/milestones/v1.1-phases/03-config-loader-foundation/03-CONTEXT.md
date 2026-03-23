# Phase 3: Config Loader Foundation - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Crear modulo centralizado `src/config.js` que carga un solo `.env` unificado, valida variables requeridas al arranque, y exporta un objeto estructurado con secciones: `database`, `portal`, `mailing`, `paths`, `app`. Tambien consolidar los 5 archivos `.env` separados en uno solo. La migracion de modulos para usar el config loader es Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Config object structure
- Objeto nested por dominio con keys en camelCase
- Multi-tenant portal: array de objetos tenant `config.portal.tenants = [{ id, key, secret, database, externalId }]` (no arrays paralelos)
- Mailing con transport selector: `config.mailing.transport` = 'smtp' o 'gmail', con vars especificas por transport
- Listas de email (notices, cc) pre-split en arrays
- Comma-separated ADDRESS_IDENTIFIERS_SKIP pre-split en array
- Estructura completa:
  ```
  config = {
    database: { user, password, server, database },
    portal: { url, tenants: [{ id, key, secret, database, externalId }] },
    mailing: { transport, from, password, server, port, ssl, notices[], cc[],
               clientId, clientSecret, refreshToken, redirectUri },
    paths: { downloads, providers, logs },
    app: { importRoute, arg, company, rfc, regimen, timezone, autoTerminate,
           defaultAddress: { city, country, identifier, municipality, state, street, zip },
           addressIdentifiersSkip[] }
  }
  ```

### Validation rules
- Variables requeridas: database (4), portal (6), paths (3), app (todas excepto autoTerminate)
- Mailing es OPCIONAL — no falla si faltan vars de mailing
- Empty string se trata como missing para vars requeridas
- Formato de error: lista plana con nombre de variable y seccion entre parentesis
  ```
  [CONFIG ERROR] Missing required environment variables:
    - USER (database)
    - TENANT_ID (portal)
  See .env.example for reference.
  Process exiting.
  ```
- Termina con `process.exit(1)` antes de que corra logica de negocio

### Migration compatibility
- Config loader llama `dotenv.config()` internamente — `process.env` se popula automaticamente
- Codigo viejo usando `process.env` sigue funcionando durante transicion
- Phase 4 reemplazara todas las refs a `process.env` con `config.X`
- Archivos .env viejos se mueven a `.env.legacy/` (no se eliminan)
- Nueva variable en .env: `MAIL_TRANSPORT=smtp` (o `gmail`)

### File organization
- Config loader en `src/config.js` — nivel raiz de src/, no en utils/
- `.env.example` documentado con secciones por comentarios (`# ====== DATABASE ======`)
- Inline comments explicando cada variable y formatos esperados (comma-separated, etc.)

### Claude's Discretion
- Orden de validacion interno
- Manejo de errores de parseo en valores (e.g., port no numerico)
- Naming exacto de las funciones internas del loader
- Si exponer funcion `getConfig()` o solo `module.exports`

</decisions>

<specifics>
## Specific Ideas

- El operador debe poder copiar las variables faltantes directamente del mensaje de error al .env
- El .env.example sirve como documentacion viva — debe ser autosuficiente sin necesidad de leer docs

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `dotenv` ya instalado en package.json — reutilizar directamente
- Patrones de split por comma ya implementados en 6+ archivos — centralizar en config.js

### Established Patterns
- Modulos cargan dotenv con `dotenv.config({ path: '.env.credentials.X' })` y extraen `.parsed`
- Algunos modulos usan `process.env` directamente (TimezoneHelper, index.js)
- EmailSender ya valida transport type internamente — esa logica migra al config loader
- Multi-tenant arrays indexados por posicion: `tenantIds[index]`, `apiKeys[index]`

### Integration Points
- `src/config.js` sera importado por todos los modulos que hoy cargan dotenv
- `process.env` se popula para backward compat — los modulos no migrados aun funcionan
- `.env` en raiz del proyecto (mismo lugar que el actual `.env` principal)

</code_context>

<deferred>
## Deferred Ideas

- Multi-environment switching (NODE_ENV=sandbox/production) — deferred to v2 (MENV-01)
- Gmail OAuth implementation en EmailSender — fuera de scope, solo se estructura el config

</deferred>

---

*Phase: 03-config-loader-foundation*
*Context gathered: 2026-03-22*
