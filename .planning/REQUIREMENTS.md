# Requirements: SageConnect Env Unification

**Defined:** 2026-03-22
**Core Value:** La integracion Sage-Portal debe ser confiable, mantenible, y operable.

## v1.1 Requirements

### Config Loader

- [ ] **CONF-01**: Un modulo centralizado `src/config.js` carga un solo `.env` al arranque y exporta un objeto estructurado con secciones: `database`, `portal`, `mailing`, `paths`, `app`
- [ ] **CONF-02**: El config loader valida que todas las variables requeridas esten presentes al arranque; si falta alguna, imprime lista de variables faltantes y termina con `process.exit(1)`
- [ ] **CONF-03**: Las 25+ llamadas `dotenv.config()` dispersas en el codebase se reemplazan por `require` del config loader centralizado

### Unification

- [x] **UNIF-01**: Los 5 archivos `.env` separados se consolidan en un solo `.env` con secciones por comentarios
- [ ] **UNIF-02**: Un solo `.env.example` en la raiz documenta todas las 27 variables con valores de ejemplo y comentarios por seccion
- [ ] **UNIF-03**: Los archivos `.env.*.example` redundantes en raiz y `dist/` se eliminan

### Regression

- [ ] **REGR-01**: Toda la funcionalidad existente (pagos, ordenes de compra, CFDIs, email, logging) sigue funcionando sin cambios despues de la migracion

## v2 Requirements

### Consistencia (deferred from v1.0)

- **CONS-01**: Eliminar columna RFC residual de la query de conciliacion y del reporte
- **CONS-02**: Agregar auto-resolucion de UUIDs faltantes en el flujo de conciliacion

### Multi-Environment

- **MENV-01**: Soporte para multiples ambientes (sandbox/production) via variable NODE_ENV

## Out of Scope

| Feature | Reason |
|---------|--------|
| Migracion a YAML config | .env es el estandar Node.js; no agregar dependencias para formato diferente |
| Soporte multi-ambiente | Solo produccion por ahora; la estructura permite agregar despues |
| Eliminar archivos backup en /reports/ | Se mantienen como referencia historica |
| Refactoring de logica de negocio | Solo se cambia como se carga la configuracion, no que hace el codigo |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONF-01 | Phase 3 | Pending |
| CONF-02 | Phase 3 | Pending |
| CONF-03 | Phase 4 | Pending |
| UNIF-01 | Phase 3 | Complete |
| UNIF-02 | Phase 4 | Pending |
| UNIF-03 | Phase 4 | Pending |
| REGR-01 | Phase 5 | Pending |

**Coverage:**
- v1.1 requirements: 7 total
- Mapped to phases: 7
- Unmapped: 0

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after roadmap creation*
