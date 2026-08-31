# Roadmap: SageConnect

## Milestones

- ✅ **v1.0 Payment Reconciliation Fixes** — Phases 1-2 (shipped 2026-03-22)
- ✅ **v1.1 Env Unification** — Phases 3-5 (shipped 2026-03-23)
- ✅ **v2.0 Always-On Service** — Phases 6-10 (shipped 2026-03-25)
- ✅ **v2.1 License Validation** — Phases 11-14 (shipped 2026-03-25)
- ✅ **v2.2 OC Status UI** — Phases 15-16 (shipped 2026-04-09)
- ✅ **v2.3 Scheduler Lock Recovery** — Phases 17-19 (shipped 2026-04-29)
- 📋 **v2.4 (TBD)** — Planning next milestone via `/gsd-new-milestone`

## Phases

<details>
<summary>✅ v2.3 Scheduler Lock Recovery (Phases 17-19) — SHIPPED 2026-04-29</summary>

- [x] Phase 17: Observability & Diagnostics (4/4 plans) — completed 2026-04-27
- [x] Phase 18: Auto-release & Manual Override (3/3 plans) — completed 2026-04-28
- [x] Phase 19: Root Cause Timeouts (3/3 plans) — completed 2026-04-29

See [`milestones/v2.3-ROADMAP.md`](milestones/v2.3-ROADMAP.md) for full phase details, key decisions, and outcomes.

</details>

<details>
<summary>✅ v2.2 OC Status UI (Phases 15-16) — SHIPPED 2026-04-09</summary>

- [x] Phase 15: PUT /api/pos/status endpoint (1/1 plan)
- [x] Phase 16: pos.html "Cambiar Estado OC" UI (1/1 plan)

See `.planning/MILESTONES.md` for accomplishments.

</details>

<details>
<summary>✅ v2.1 License Validation (Phases 11-14) — SHIPPED 2026-03-25</summary>

- [x] Phase 11: LicenseValidator service (2/2 plans)
- [x] Phase 12: Enforcement (startup + cron + middleware) (2/2 plans)
- [x] Phase 13: Web UI surface (license banner + expiry badge) (1/1 plan)
- [x] Phase 14: Admin email + DNS bypass (1/1 plan)

See `.planning/MILESTONES.md` for accomplishments.

</details>

<details>
<summary>✅ v2.0 Always-On Service (Phases 6-10) — SHIPPED 2026-03-25</summary>

- [x] Phase 6: ResultEnvelope unified contract + scripts refactor (4/4 plans)
- [x] Phase 7: SQL pool singleton + USE [database] (2/2 plans)
- [x] Phase 8: REST API + node-cron scheduler + SSE progress (5/5 plans)
- [x] Phase 9: Web UI operativa (4 pages) (3/3 plans)
- [x] Phase 10: Servy Windows Service + legacy removal (2/2 plans)

See `.planning/MILESTONES.md` for accomplishments.

</details>

<details>
<summary>✅ v1.1 Env Unification (Phases 3-5) — SHIPPED 2026-03-23</summary>

- [x] Phase 3: Centralized config loader (2/2 plans)
- [x] Phase 4: Migrate 31 source modules to centralized require (2/2 plans)
- [x] Phase 5: Regression verification suite (2/2 plans)

See `.planning/MILESTONES.md` for accomplishments.

</details>

<details>
<summary>✅ v1.0 Payment Reconciliation Fixes (Phases 1-2) — SHIPPED 2026-03-22</summary>

- [x] Phase 1: Foundation extraction + TDD setup (2/2 plans)
- [x] Phase 2: PROVIDER MISMATCH + missing UUIDs + batch guard (2/2 plans)

See `.planning/MILESTONES.md` for accomplishments.

</details>

### 📋 Phase 22: Botones de ejecucion por tarea (portal de ejecucion manual)

**Milestone:** v2.4 (TBD) — rama `feat/boton-ejecucion`
**Goal:** El portal de ejecucion manual ejecuta la tarea "Compras" (`buildProvidersXML` → `createPurchaseOrders`) sin correr el ciclo completo de 7 pasos, reusando el lock `background-cycle` para no cruzarse con el cron de 15 min. Se conserva el boton "Ejecutar proceso ahora" (todo).
**Requirements:** [REQ-22-01, REQ-22-02, REQ-22-03, REQ-22-04, REQ-22-05, REQ-22-06]
**Plans:** 4 plans (4 waves)

Plans:
- [ ] 22-01-PLAN.md — Orquestacion selectiva en background.js (STEP_REGISTRY + runSteps + forResponse=runSteps(ALL_STEP_KEYS) + TASK_STEPS/runTask) [wave 1]
- [ ] 22-02-PLAN.md — Endpoint POST de tarea con lock FIJO 'background-cycle' + schema Joi (no cruce con el cron) [wave 2]
- [ ] 22-03-PLAN.md — Boton "Compras" en ejecucion.html + applyButtonState generalizado a N botones [wave 3]
- [ ] 22-04-PLAN.md — Verificacion: baseline tests §6 + invariantes always-on + checkpoint manual (cron/ciclo-todo intactos) [wave 4]

### 📋 Phase 23: El boton de ejecucion invoca el importador de comprobantes

**Milestone:** v2.4 (TBD) — rama `feat/boton-ejecucion`
**Goal:** El disparo manual (`POST /api/schedule/:taskId/trigger`) encadena `startChildProcess()` despues de `forResponse()` dentro del MISMO lock `background-cycle`, con paridad exacta con el cron (`CronScheduler.js:100-109`), para que el boton "Ejecutar proceso ahora" complete la cadena Portal → XML → `ImportaFacturasFocaltec.exe COPDAT` → Sage. Hoy el boton corre los 7 pasos pero nunca invoca el importador, asi que la factura se descarga y se queda en `downloads\`.
**Origen:** reunion 31-ago-2026 (Yahir + Hortensia + Santiago) — decision acordada: reusar la logica de llamada existente, incluyendo el parametro de base de datos.
**Requirements:** [REQ-23-01, REQ-23-02, REQ-23-03, REQ-23-04, REQ-23-05, REQ-23-06, REQ-23-07, REQ-23-08, REQ-23-09]
**Plans:** 3 plans (2 waves)

Plans:
- [ ] 23-01-PLAN.md — Encadenar startChildProcess al disparo manual + tests de comportamiento + asercion de paridad sobre el fuente [wave 1]
- [ ] 23-02-PLAN.md — Tercer estado del boton en ejecucion.html (Importando comprobantes a Sage) [wave 1]
- [ ] 23-03-PLAN.md — Verificacion en zcl-rds-test: IMPORT_CFDIS_ROUTE + prueba end-to-end con evidencia [wave 2]

### 📋 v2.4 (TBD)

Next milestone planning via `/gsd-new-milestone`. Pending non-blocking follow-ups from v2.3 closure:

- AbortController retrofit completo (sustituir Promise.race phantom continuation con real abort en wrapped promise)
- Otros 8 axios callsites enrichment con `[TIMEOUT]` log entries
- `apiCall` toast suppression para force-release call site
- Dashboard de operaciones con historial detallado por tenant
- Alertas proactivas (Slack/email) cuando un cycle excede N min
- `scripts/obfuscate.js` allowlist → blocklist refactor (PR #20 retrospective)

## Progress

| Phase                         | Milestone | Plans Complete | Status   | Completed  |
| ----------------------------- | --------- | -------------- | -------- | ---------- |
| 1. Foundation extraction      | v1.0      | 2/2            | Complete | 2026-03-22 |
| 2. PROVIDER MISMATCH + guards | v1.0      | 2/2            | Complete | 2026-03-22 |
| 3. Config loader              | v1.1      | 2/2            | Complete | 2026-03-23 |
| 4. Module migration           | v1.1      | 2/2            | Complete | 2026-03-23 |
| 5. Regression suite           | v1.1      | 2/2            | Complete | 2026-03-23 |
| 6. ResultEnvelope             | v2.0      | 4/4            | Complete | 2026-03-25 |
| 7. SQL pool singleton         | v2.0      | 2/2            | Complete | 2026-03-25 |
| 8. REST API + scheduler       | v2.0      | 5/5            | Complete | 2026-03-25 |
| 9. Web UI                     | v2.0      | 3/3            | Complete | 2026-03-25 |
| 10. Servy + legacy removal    | v2.0      | 2/2            | Complete | 2026-03-25 |
| 11. LicenseValidator          | v2.1      | 2/2            | Complete | 2026-03-25 |
| 12. Enforcement               | v2.1      | 2/2            | Complete | 2026-03-25 |
| 13. License UI                | v2.1      | 1/1            | Complete | 2026-03-25 |
| 14. Admin email + DNS bypass  | v2.1      | 1/1            | Complete | 2026-03-25 |
| 15. PUT /api/pos/status       | v2.2      | 1/1            | Complete | 2026-04-09 |
| 16. pos.html UI               | v2.2      | 1/1            | Complete | 2026-04-09 |
| 17. Observability             | v2.3      | 4/4            | Complete | 2026-04-27 |
| 18. Auto-release + override   | v2.3      | 3/3            | Complete | 2026-04-28 |
| 19. Root Cause Timeouts       | v2.3      | 3/3            | Complete | 2026-04-29 |
| 22. Botones ejecucion x tarea | v2.4      | 0/4            | Planned  | —          |
| 23. Boton invoca importador   | v2.4      | 0/3            | Planned  | —          |
