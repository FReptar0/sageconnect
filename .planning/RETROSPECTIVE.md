# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Payment Reconciliation Fixes

**Shipped:** 2026-03-22
**Phases:** 2 | **Plans:** 4 | **Sessions:** 2

### What Was Built
- Auto-resolución de PROVIDERID faltante en script de conciliación (mismo ciclo, no esperar siguiente ejecución)
- Validación de `provider_id` mismatch con categoría PROVIDER MISMATCH y detalle por factura
- Guard de batch vacío previniendo requests innecesarios al API
- Detección de pagos faltantes en response batch con `respondedIds` Set
- Suite TDD: 24 tests cubriendo 6 requerimientos

### What Worked
- El patrón TDD (RED → GREEN en 2 planes) funcionó bien para ambas fases — los tests definieron el contrato antes de implementar
- Extraer funciones como `classifyPayments` y `uploadBatch` hizo posible testear sin mockear toda la cadena de dependencias
- La discusión de fase (`/gsd:discuss-phase`) capturó decisiones operativas (log levels, control table behavior, summary format) que evitaron ambiguedad durante implementación
- Ejecutar las 2 fases en el mismo día — velocidad alta gracias a scope bien definido

### What Was Inefficient
- ROADMAP.md no se actualizó con los checkmarks de Phase 2 plans durante ejecución — quedó desincronizado hasta milestone completion
- La investigación del API spec se hizo en fase de inicialización del proyecto pero no se referenció directamente en los RESEARCH.md de cada fase — se repitió algo de lectura

### Patterns Established
- Extract → TDD RED → TDD GREEN como patrón de 2-plan para cada fase funcional
- Funciones exportadas con dependencias inyectables para testabilidad
- Dual logging (console + logGenerator) como estándar para todos los eventos operativos
- `respondedIds` Set pattern para detectar gaps en respuestas de APIs batch

### Key Lessons
1. Definir el formato exacto de output (summary lines, log messages) durante discuss-phase ahorra tiempo en implementación — el executor no tiene que tomar decisiones de formato
2. El control table behavior (registrar o no) para edge cases es una decisión operativa que debe tomarse temprano — afecta si el pago se reenvía automáticamente o requiere intervención manual

### Cost Observations
- Model mix: ~70% opus (orchestration + execution), ~30% sonnet (verification + integration checks)
- Sessions: 2 (one for Phase 1, one for Phase 2 + completion)
- Notable: Each plan executed in 2-6 minutes — the TDD split kept individual plan scope small

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 2 | 2 | Established TDD RED/GREEN 2-plan pattern |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 24 | 6/6 reqs | 0 (all use existing deps) |

### Top Lessons (Verified Across Milestones)

1. Extract functions for testability before writing tests — mocking `main()` is brittle
2. Discuss operational behavior (log levels, retry strategy, summary format) during context gathering, not during implementation
