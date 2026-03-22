# Requirements: SageConnect Env Unification

**Defined:** 2026-03-22
**Core Value:** La integración Sage-Portal debe ser confiable, mantenible, y operable.

## v1.1 Requirements

### Config Loader

- [ ] **CONF-01**: Un módulo centralizado `src/config.js` carga un solo `.env` al arranque y exporta un objeto estructurado con secciones: `database`, `portal`, `mailing`, `paths`, `app`
- [ ] **CONF-02**: El config loader valida que todas las variables requeridas estén presentes al arranque; si falta alguna, imprime lista de variables faltantes y termina con `process.exit(1)`
- [ ] **CONF-03**: Las 25+ llamadas `dotenv.config()` dispersas en el codebase se reemplazan por `require` del config loader centralizado

### Unification

- [ ] **UNIF-01**: Los 5 archivos `.env` separados se consolidan en un solo `.env` con secciones por comentarios
- [ ] **UNIF-02**: Un solo `.env.example` en la raíz documenta todas las 27 variables con valores de ejemplo y comentarios por sección
- [ ] **UNIF-03**: Los archivos `.env.*.example` redundantes en raíz y `dist/` se eliminan

### Regression

- [ ] **REGR-01**: Toda la funcionalidad existente (pagos, órdenes de compra, CFDIs, email, logging) sigue funcionando sin cambios después de la migración

## v2 Requirements

### Consistencia (deferred from v1.0)

- **CONS-01**: Eliminar columna RFC residual de la query de conciliación y del reporte
- **CONS-02**: Agregar auto-resolución de UUIDs faltantes en el flujo de conciliación

### Multi-Environment

- **MENV-01**: Soporte para múltiples ambientes (sandbox/production) vía variable NODE_ENV

## Out of Scope

| Feature | Reason |
|---------|--------|
| Migración a YAML config | .env es el estándar Node.js; no agregar dependencias para formato diferente |
| Soporte multi-ambiente | Solo producción por ahora; la estructura permite agregar después |
| Eliminar archivos backup en /reports/ | Se mantienen como referencia histórica |
| Refactoring de lógica de negocio | Solo se cambia cómo se carga la configuración, no qué hace el código |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONF-01 | TBD | Pending |
| CONF-02 | TBD | Pending |
| CONF-03 | TBD | Pending |
| UNIF-01 | TBD | Pending |
| UNIF-02 | TBD | Pending |
| UNIF-03 | TBD | Pending |
| REGR-01 | TBD | Pending |

**Coverage:**
- v1.1 requirements: 7 total
- Mapped to phases: 0
- Unmapped: 7

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after initial definition*
