# Roadmap: SageConnect

## Milestones

- ✅ **v1.0 Payment Reconciliation Fixes** - Phases 1-2 (shipped 2026-03-22)
- 🚧 **v1.1 Env Unification** - Phases 3-5 (in progress)

## Phases

<details>
<summary>✅ v1.0 Payment Reconciliation Fixes (Phases 1-2) - SHIPPED 2026-03-22</summary>

- [x] **Phase 1: Reconciliation Classification** - Extract classifyPayments with PROVIDER MISMATCH + auto-resolve PROVIDERID (2/2 plans)
- [x] **Phase 2: Batch Upload Robustness** - Guard empty batches + detect missing payments in response (2/2 plans)

See: `.planning/milestones/v1.0-ROADMAP.md` for full details.

</details>

### 🚧 v1.1 Env Unification (In Progress)

**Milestone Goal:** Unificar los 5 archivos .env dispersos en un solo archivo con un config loader centralizado que valide variables requeridas al arranque y exponga configuracion estructurada.

- [x] **Phase 3: Config Loader Foundation** - Build centralized config loader with validation and consolidate .env files (completed 2026-03-23)
- [ ] **Phase 4: Codebase Migration** - Replace all scattered dotenv calls and clean up redundant env files
- [ ] **Phase 5: Regression Verification** - Verify all existing functionality works after migration

## Phase Details

### Phase 3: Config Loader Foundation
**Goal**: A single config loader exists that loads one unified .env file, validates all required variables, and exports structured configuration
**Depends on**: Phase 2 (v1.0 complete)
**Requirements**: CONF-01, CONF-02, UNIF-01
**Success Criteria** (what must be TRUE):
  1. Running `require('./config')` from any module returns a structured object with sections: `database`, `portal`, `mailing`, `paths`, `app`
  2. If any required variable is missing from `.env`, the process prints the list of missing variables and exits with code 1 before any business logic runs
  3. A single `.env` file in the project root contains all 27 variables previously spread across 5 separate `.env` files, organized by section comments
  4. The config loader works with the existing `dotenv` dependency -- no new packages installed
**Plans:** 2/2 plans complete

Plans:
- [x] 03-01-PLAN.md -- TDD: Build config loader with validation (CONF-01, CONF-02)
- [x] 03-02-PLAN.md -- Create unified .env, .env.example, and archive old files (UNIF-01)

### Phase 4: Codebase Migration
**Goal**: Every module in the codebase obtains configuration from the centralized config loader instead of loading dotenv independently
**Depends on**: Phase 3
**Requirements**: CONF-03, UNIF-02, UNIF-03
**Success Criteria** (what must be TRUE):
  1. Zero calls to `dotenv.config()` remain anywhere in the codebase -- every module uses `require` of the centralized config loader
  2. A single `.env.example` in the project root documents all 27 variables with example values and section comments
  3. No `.env.*.example` files exist in root or `dist/` directories -- all redundant example files are removed
  4. No module accesses `process.env` directly for configuration values that are covered by the config loader
**Plans:** 2 plans

Plans:
- [ ] 04-01-PLAN.md -- Rename DB_USER/DB_PASSWORD + migrate utils, services, entry points, routes (CONF-03, UNIF-02)
- [ ] 04-02-PLAN.md -- Migrate controllers, scripts, tests + delete redundant .env.*.example files (CONF-03, UNIF-03)

### Phase 5: Regression Verification
**Goal**: All existing functionality is confirmed working after the env unification migration
**Depends on**: Phase 4
**Requirements**: REGR-01
**Success Criteria** (what must be TRUE):
  1. Payment reconciliation script (`payment-reconciliation.js`) runs successfully with `--classify` and `--upload` flags, producing the same output categories as before migration
  2. All 24 existing tests pass without modification (tests validate business logic is unchanged)
  3. CFDI import, order processing, and email notification modules load configuration correctly and execute without errors
**Plans**: TBD

Plans:
- [ ] 05-01: TBD

## Progress

**Execution Order:** Phase 3 -> Phase 4 -> Phase 5

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Reconciliation Classification | v1.0 | 2/2 | Complete | 2026-03-22 |
| 2. Batch Upload Robustness | v1.0 | 2/2 | Complete | 2026-03-22 |
| 3. Config Loader Foundation | v1.1 | 2/2 | Complete | 2026-03-23 |
| 4. Codebase Migration | v1.1 | 0/2 | Not started | - |
| 5. Regression Verification | v1.1 | 0/TBD | Not started | - |
