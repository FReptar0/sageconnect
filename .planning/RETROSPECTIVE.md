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

## Milestone: v2.3 — Scheduler Lock Recovery

**Shipped:** 2026-04-29
**Phases:** 3 | **Plans:** 10 | **Sessions:** ~5

### What Was Built

- Lock observability stack — `OperationManager.stepProgress` + `startStep`/`endStep` API + GET /api/operations/status enriched + "Operación en curso" Bootstrap card with 5s polling + 1s heartbeat ticker
- Auto-release timer encapsulado en `acquireLock` (default 14 min) + `lock:timeout` EventEmitter event + listener (audit history + admin email + warn log)
- Manual force-release: `POST /api/schedule/:taskId/force-release` idempotent endpoint + Bootstrap modal con state machine + escapeHtml XSS defense + Cancelar focus override
- Root-cause timeouts: PortalClient singleton (axios 30s, 18 sites en 9 files) + startChildProcess kill cascade (SIGTERM → 30s grace → taskkill /F /T) + per-step Promise.race via withStepTimeout helper (5 min, 7 forResponse blocks)
- Defense-in-depth invariant: axios (30s) < step (5m) < child (10m) < lock (14m)
- Unified `[TIMEOUT]` log routing per source + email dispatch ONLY para child-process timeouts
- 17/17 STRIDE threats closed con file:line evidence

### What Worked

- **Three-phase strategy (observability → recovery → prevention) with clear boundary lifting** — Phase 18 D-03 documentó "phantom continuation" tolerada explícitamente; Phase 19 lo levantó capa por capa. Cada plan verificó "Phase 19 boundary HELD" hasta que llegó el momento de levantarlo en su layer específico (axios primero, child segundo, step último). Sin ambigüedad sobre qué se permite cuándo.
- **Wording sentinels LOAD-BEARING como contrato cross-plan** — `'Child process timeout'` (Plan 19-02) y `'Step timeout'` (Plan 19-03) regex detection gates email dispatch + log routing. La D-15 exclusión mutua (step ≠ child) fue verificada en tests con assertions negativas (step timeout NO matches /Child process timeout/, vice versa). Reduce coupling sin requerir refactor del callsite.
- **Inline-twice strategy (PATTERNS.md §S-6) antes de extraer** — `sendAdminAlert` y `findLastOpenStep` duplicados en CronScheduler + schedule-routes después de Phase 18, mantuvieron blast radius mínimo. Phase 19 NO añadió 3rd use, así que extracción a `src/utils/AdminEmailSender.js` quedó deferred. Refactor jus-in-time.
- **Browser-automated UI verification via chrome-devtools MCP** (Plan 18-03) — 6/6 active rows verificados (golden, idempotent, error retry, XSS spot-check con HTML/SVG payloads, focus/Esc/Enter/Tab keyboard contract, copy verbatim against UI-SPEC). Más confianza que checkbox aprobación operador-driven; encontró el row 7 (admin email parity) N/A por no SMTP local pero cubierto por nodemailer integration tests.
- **Snapshot-before-release ordering en force-release endpoint** — `releaseLock` es destructivo (Map.delete), así que el handler captura `previousLock {operationId, startedAt, durationMs, stuckOnStep, stuckOnTenant}` ANTES de liberar. Side-effect order: snapshot → release → addHistory → log → email. Caught por code review, no por tests.
- **`hasSettled` + `cancelGraceTimer()` separation in kill cascade** — Rule 1 auto-fix durante Task 4 test development: el wrapper original cancelaba `graceTimer` prematuramente, defeating taskkill. Separación a helper invoked SOLO from close/error listeners (semantically: child terminated, no taskkill needed). Test-driven discovery.
- **Defense-in-depth invariant verificado runtime** — axios (30s) < step (5m) < child (10m) < lock (14m). Cada layer tiene su propio safety net; un cuelgue se corta en el layer más cercano sin esperar al outermost. Debugging operacional siempre encuentra el layer culpable.

### What Was Inefficient

- **Hotfix cascade durante Phase 17 deployment day (2026-04-27)** — 5 latent always-on bugs landed as hotfixes in 2 hours después del deploy de Phase 17 (PRs #14-#19). Causa: el deployment de Phase 17 fue el primer evento always-on real con polling agresivo, y disparó bugs latentes en winston FD caching, SQL pool USE [DB] state, rate-limit budget, dashboard API key injection, y FESA default regression. Lección: deploy de UI con polling 5s debería estar precedido por audit always-on assumptions (haber sido sistemático en lugar de retrospectivo).
- **Discusión D-15 (email solo para child) tomó múltiples vueltas en discuss-phase** — El alert-fatigue tradeoff entre "todos los timeouts dispatch email" vs "solo child" no estaba claro hasta que enumeramos los escenarios transient (axios falla 5-10x por ciclo en network blip = inbox flood). Lección: al definir email/notification policy, simulate the alert volume before selecting a default, no decidirlo en abstracto.
- **Plan 19-02 Rule 1 auto-fix mid-task** — `settle` wrapper cancelando graceTimer prematuramente (defeat taskkill) caught en test development, no en plan review. Plan-level verification debería incluir un kill-cascade simulation test ANTES de implementación, no después. Ahorra una iteración y un atomic commit dedicated to the fix (`012b6ad`).
- **2 pending payment-upload todos arrastrados sin scope assignment** — Predaten v2.3 (2026-04-16), nunca asignados a milestone, surface en pre-close audit. Lección: pending todos sin milestone assignment deberían tener una review periódica (semanal? por milestone start?) para decidir scope vs defer vs cancel.
- **Phase 19 SDK init returned `phase_dir: null`** — Milestone-nested layout (`.planning/milestones/v2.3-phases/`) no auto-detectado por SDK, requirió pasos manuales en agent prompts. Funciona pero es fricción. Lección: cuando el orchestrator tooling no cubre un layout, documentar en CONTEXT.md desde el inicio para que downstream agents no tengan que averiguarlo.

### Patterns Established

- **Wording sentinels LOAD-BEARING + mutual exclusion** — Cuando 2+ regex detectores comparten un substring común, añade explicit negation tests para garantizar exclusión. Ejemplo: `Step timeout` regex NO debe match `Child process timeout` y vice versa. Usado en Plan 19-03 D-15.
- **Snapshot-before-destructive-mutation ordering** — Cuando un handler combina mutation (releaseLock) + side-effects (history, log, email) que dependen del state pre-mutation, el order es: snapshot → mutate → side-effects-with-snapshot. Usado en Plan 18-02.
- **Idempotent endpoint pattern (always 200 + discriminator)** — `POST /:taskId/force-release` siempre 200 con `data.released:true|false`. Operator double-click después de auto-release NO devuelve 404, fluye por mismo handler con `released:false`. UI consume el discriminator. Usado en Plan 18-02 vs el `409 on conflict` pattern de `POST /:taskId/trigger`.
- **`hasSettled` flag + closure-scoped timer cleanup** — Cuando un Promise tiene múltiples paths de settlement (close/error/timeout), un closure-scoped flag previene double-settle race. Cleanup helpers (cancelGraceTimer) deben ser invocados SOLO desde paths que NO deben triggerear el timer secundario. Usado en Plan 19-02 kill cascade.
- **Range guards fail-fast >= MIN_MS** — Config knobs con env override deben validar rangos sensatos. Sub-second timeout = misconfig (typo en .env, ej. 1000 en lugar de 10000). 4 range guards en config.js post-Phase-19: lockTimeoutMs (>= 60000) + httpTimeoutMs (>= 1000) + childProcessTimeoutMs (>= 60000) + stepTimeoutMs (>= 30000).
- **PortalClient singleton mirror de LicenseValidator** — axios.create({ timeout, headers }) + module.exports. NO factory, NO class wrapper. Two clients en codebase (licenseClient 10s, portalClient 30s) por intentional choice — distintas latencies operacionales.
- **STRIDE threat model per phase + 17/17 audit** — Cada plan documenta T-XX-YY threats con mitigation file:line evidence. Auditor verifica que TODOS están closed antes de milestone close. Phase 19 closed 17/17.

### Key Lessons

1. **Boundary lifting debe ser explícito en plans** — Phase 18 D-03 documentó qué SE TOLERA (phantom continuation) sabiendo que Phase 19 lo iba a levantar. Cada plan de Phase 19 verificó "Phase 19 boundary HELD" hasta que tocó su layer específico. Sin esa documentación explícita, los plans habrían empezado a introducir abort semantics ad-hoc, mezclando concerns.
2. **Email/notification policies deben simular volume antes de decidir defaults** — D-15 "ONLY child timeouts dispatch email" se resolvió correctamente porque enumeramos los escenarios transient (5-10 axios timeouts por ciclo en network blip = inbox flood). Decisión en abstracto = wrong default; decisión con simulación = right default.
3. **Browser-automated UI verification > checkbox aprobación operador-driven** — chrome-devtools MCP detectó cosas que un walkthrough manual habría perdido: focus management (Cancelar override), XSS spot-check con HTML/SVG payloads, keyboard contract (Esc/Enter/Tab). Plus el bonus de capturar Plan 18-01 collateral bug (`061b7c5` circular JSON ref) que mocked tests no veían.
4. **Hotfix cascade en deploy day = retrospective audit owed** — 5 latent always-on bugs en 2 horas indica que las assumptions always-on no se auditaron antes del deploy de Phase 17. Forensic report (`.planning/forensics/report-20260427-220000.md`) capturó la enumeración. Lección forward: deploy de UI/scheduler con polling agresivo debería estar precedido por explicit always-on assumption audit.
5. **`hasSettled` + cleanup helper separation = test-driven discovery** — El bug en `settle` wrapper que cancelaba `graceTimer` prematuramente se encontró en Task 4 test development, no en plan review. Test escrito FIRST (jest fake timers + EventEmitter mock + simulación cascade SIGTERM → grace → taskkill) reveló que el wrapper destruía la cascade. Lección: kill-cascade simulation tests son plan-review prerequisite, no Task 4 deliverable.
6. **Inline-twice antes de extraer es la decisión correcta para helpers de 2 callers** — `sendAdminAlert` + `findLastOpenStep` duplicated inline en CronScheduler + schedule-routes funcionó perfecto en Phase 18-19 (2 callers, sin drift). Refactor jus-in-time hasta el 3rd use es mejor que extracción especulativa.

### Cost Observations

- Model mix: ~75% opus (orchestration + execution), ~25% sonnet (verification + security audit)
- Sessions: ~5 (Phase 17 = 2 sessions, Phase 18 = 1 session w/ verification, Phase 19 = 2 sessions w/ verification + secure)
- Notable: Phase 19's 3 plans completed in single execution session via `/gsd-execute-phase` waves (1 → 2 → 3 sequential, depends_on chain). Browser-automated chrome-devtools MCP verification de Plan 18-03 added confidence but also session length.
- Hotfix cascade (5 PRs en 2 horas durante Phase 17 deploy day) consumió tiempo significativo no contabilizado en plan estimates — documentar como milestone overhead, no plan-level.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 2 | 2 | Established TDD RED/GREEN 2-plan pattern |
| v1.1 | 1 | 3 | Skipped research for known patterns; integration checker caught cross-phase bug |
| v2.3 | ~5 | 3 | Three-phase boundary lifting (observability → recovery → prevention); browser-automated UI verification via chrome-devtools MCP; STRIDE threat model 17/17 closed |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 24 | 6/6 reqs | 0 (all use existing deps) |
| v1.1 | 108 | 7/7 reqs | 0 (dotenv already installed) |
| v2.3 | 200+ (48 new Phase 19) | 14/14 reqs + 17/17 STRIDE threats closed | 0 (axios, child_process, EventEmitter — all stdlib/existing) |

### Top Lessons (Verified Across Milestones)

1. Extract functions for testability before writing tests — mocking `main()` is brittle
2. Discuss operational behavior during context gathering, not during implementation
3. dotenv does NOT override pre-existing OS env vars — always check for naming collisions (verified v1.1: USER and PATH both caused silent bugs)
4. Boundary lifting must be documented explicitly in plans — Phase 18 D-03 + Phase 19 verification chain showed that ambiguity about "what's allowed when" leads to ad-hoc abort semantics mixed across concerns (verified v2.3)
5. Email/notification policies must simulate volume before deciding defaults — D-15 "ONLY child timeouts dispatch email" was correct because we enumerated transient scenarios (5-10 axios timeouts per cycle in network blip = inbox flood) (verified v2.3)
6. Browser-automated UI verification > operator-driven walkthrough — chrome-devtools MCP detects focus management, XSS spot-checks, and keyboard contract issues that mocked tests miss (verified v2.3 Plan 18-03)
7. Inline-twice strategy works for helpers with 2 callers — `sendAdminAlert` duplicated in CronScheduler + schedule-routes maintained zero drift through Phase 18-19; refactor just-in-time at 3rd use (verified v2.3 PATTERNS.md §S-6)
