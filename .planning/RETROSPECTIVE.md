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

## Milestone: v1.1 — Env Unification

**Shipped:** 2026-03-23
**Phases:** 3 | **Plans:** 6 | **Sessions:** 1

### What Was Built
- Centralized config loader (`src/config.js`) with fail-fast validation and structured sections
- Unified 5 scattered `.env` files into single `.env` with documented `.env.example`
- Migrated 31 source modules from 25+ independent dotenv calls to centralized require
- Fixed OS env var collisions (USER→DB_USER, PATH→DOWNLOADS_PATH)
- Regression verification suite: 25 module-load tests + dotenv scan

### What Worked
- Skipping research for a well-understood refactoring pattern saved time — no new libraries or patterns to investigate
- Parallel execution in Wave 1 (Phase 3: config.js + unified .env ran simultaneously)
- The integration checker caught the PATH collision that all 3 phase verifiers missed — cross-concern bugs need cross-phase analysis
- discuss-phase captured the multi-tenant structure decision (array of objects vs parallel arrays) that would have caused rework if decided mid-implementation

### What Was Inefficient
- The plan checker's 15-file threshold forced a split of Phase 4 Plan 02 into two plans — the threshold is too aggressive for mechanical migrations where every file gets the same search-and-replace pattern
- Phase 5 success criteria in ROADMAP.md were aspirational ("run with --classify and --upload flags") but impossible without a live Sage DB — required a revision cycle to align criteria with reality

### Patterns Established
- OS env var collision check: always rename `USER`, `PATH`, `HOME`, `SHELL` and other OS-reserved names
- Config loader as single source of truth: `require('../config')` + structured sections
- Module-load tests as regression proxy when end-to-end execution requires external dependencies

### Key Lessons
1. dotenv does NOT override pre-existing OS env vars — any variable name that matches an OS variable (USER, PATH, HOME) will silently use the wrong value. Always prefix with domain (DB_USER, DOWNLOADS_PATH).
2. Integration checkers catch bugs that phase-level verifiers miss — they see cross-phase data flow that individual phase scopes cannot.
3. For mechanical migrations (same pattern across 30+ files), the file-count threshold should be relaxed — splitting into more plans adds overhead without reducing risk.

### Cost Observations
- Model mix: ~65% opus (orchestration + execution), ~35% sonnet (verification + integration)
- Sessions: 1 (entire milestone in a single session)
- Notable: 6 plans executed in ~20 minutes total — config refactoring is fast when scope is clear

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 2 | 2 | Established TDD RED/GREEN 2-plan pattern |
| v1.1 | 1 | 3 | Skipped research for known patterns; integration checker caught cross-phase bug |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 24 | 6/6 reqs | 0 (all use existing deps) |
| v1.1 | 108 | 7/7 reqs | 0 (dotenv already installed) |

### Top Lessons (Verified Across Milestones)

1. Extract functions for testability before writing tests — mocking `main()` is brittle
2. Discuss operational behavior during context gathering, not during implementation
3. dotenv does NOT override pre-existing OS env vars — always check for naming collisions (verified v1.1: USER and PATH both caused silent bugs)
