# Phase 21: Partial payment completion policy — Specification

**Created:** 2026-05-13
**Ambiguity score:** 0.18 (gate: ≤ 0.20)
**Requirements:** 3 locked (PARTIAL-01, PARTIAL-02, PARTIAL-03)
**Closes:** GH issue [#23](https://github.com/FReptar0/sageconnect/issues/23)

## Goal

Introducir el env var `PARTIAL_PAYMENT_POLICY` (valores `atomic | resume | idempotent`) que define cómo se trata un pago que falla en un cron tick previo cuando el próximo tick lo re-evalúa. El default es `atomic` (no reintento automático — surface al operador). `idempotent` reintenta el mismo POST con el mismo `external_id` confiando en el dedupe del portal. `resume` se acepta como valor válido pero se trata idénticamente a `idempotent` en esta fase — diferenciación per-CFDI se difiere a v2.5 cuando exista grain más fino en `fesa.dbo.fesaPagosFocaltec`.

## Background

**Current state (codebase scout 2026-05-13):**

- `PortalPaymentController.js:284-309` hace **una sola POST por pago** al endpoint `/api/1.0/extern/tenants/${tenantId}/payments` con el array `cfdis` embedido en el payload. **No hay boundary HTTP per-CFDI.** El portal recibe el pago como una unidad atómica desde nuestra perspectiva.
- En caso de éxito (`resp.status === 200`), se inserta una fila en `fesaPagosFocaltec` con `status='PAID'` o `status='PARTIAL'`. **CRÍTICO:** el `PARTIAL` actual NO significa "subida parcial al portal" — significa "este pago en Sage es por un monto parcial de la factura (`FULL_PAID=false`)". Es un atributo del lado de Sage, no del lado del portal.
- En caso de fallo HTTP (timeout, 4xx, 5xx, network error), el catch (`PortalPaymentController.js:292-309`) emite un log `[TIMEOUT]` o `Error POST payment`, y NO inserta fila en `fesaPagosFocaltec`. Esto significa que el pago queda en el estado pre-tick (visible al cron en el próximo tick si pasa el filtro de scope).
- **Comportamiento actual implícito (pre-Phase 21):** el cron reintenta automáticamente cada 15 min cualquier pago que falló, hasta éxito o hasta que pase el límite de tick. **Esto es efectivamente `idempotent` behavior implícito**, pero sin backoff ni control explícito.
- **El portal ya dedupea (evidencia empírica):** SageConnect ha estado en prod por meses con este mismo comportamiento de re-POST automático. No se han reportado pagos duplicados — la inferencia operacional es que el portal SÍ dedupea por `external_id` o tiene idempotencia interna. Esto valida `idempotent` como una opción segura sin necesidad de verificación via sandbox.
- **Per-CFDI state no existe:** ni en `fesaPagosFocaltec` (grain = un pago, columnas `idCia, NoPagoSage, status, idFocaltec`), ni en `Autorizaciones_electronicas.dbo.*`, ni en logs estructurados. Implementar `resume` con grain CFDI requiere schema change explícito.

**Why now:** GH #23 abierto 2026-05-13. Con el milestone scoping de v2.4 introduciendo backoff exponencial (Phase 20), el comportamiento implícito de "reintento cada 15 min sin freno" cambia — el cron WHERE incluirá filtro de backoff por filas ERROR. Eso significa que el comportamiento default post-Phase 20 sin Phase 21 sería: si un pago falla, marca ERROR (Phase 20 inserta fila), backoff exponencial aplica, eventualmente reintenta. Esto es esencialmente `idempotent + backoff`. Phase 21 expone esto como contrato explícito via env y permite al operador cambiar a `atomic` (no reintento) si quiere control manual.

**Decision: omit external sandbox dependency.** El usuario decidió omitir la fase de verificación del portal en sandbox porque no estamos cambiando la forma de enviar pagos (sigue siendo 1 POST por pago, mismo payload, mismo endpoint). La evidencia operacional de meses en prod ya implica que el portal dedupea correctamente. Esto reduce significativamente el scope y elimina el bloqueo externo que originalmente requería Phase 21 esperar para `/gsd-plan-phase`.

## Requirements

1. **PARTIAL_PAYMENT_POLICY env var (PARTIAL-01)**: Operador puede elegir entre tres valores que definen cómo el cron trata pagos con filas ERROR previas en `fesaPagosFocaltec`.
   - Current: No existe el env. Comportamiento implícito = `idempotent + reintento-cada-tick-sin-freno` (cambia post-Phase 20 a `idempotent + backoff`).
   - Target: `PARTIAL_PAYMENT_POLICY` en `.env`, default `atomic`, valores válidos `atomic | resume | idempotent`. Expuesto en `config.partialPayment.policy`. Range guard al boot exita con `[CONFIG ERROR] PARTIAL_PAYMENT_POLICY inválido — valores válidos: atomic, resume, idempotent` si se setea cualquier otra cosa.
     - `atomic`: el cron WHERE EXCLUYE pagos que tienen al menos una fila ERROR en `fesaPagosFocaltec`. Operador debe limpiar el ERROR manualmente (vía script o portal) para que el pago se reconsidere. No hay reintento automático.
     - `idempotent`: el cron WHERE INCLUYE pagos con filas ERROR cuando el backoff exponencial (Phase 20) lo permite. El re-POST usa el mismo `external_id`; se asume que el portal dedupea.
     - `resume`: comportamiento idéntico a `idempotent` en esta fase. Se acepta como valor válido en el enum para forward-compat con un futuro v2.5 que implemente per-CFDI tracking en el control table. Boot emite `[INFO] PARTIAL_PAYMENT_POLICY=resume aliased to idempotent until per-CFDI tracking exists (v2.5+)`.
   - Acceptance: 4 unit tests separados — uno por value (`atomic`, `idempotent`, `resume`) + uno para invalid value. Cada test verifica el WHERE generado: `atomic` → SQL excluye pagos con `EXISTS (... status='ERROR')`; `idempotent` y `resume` → SQL incluye + aplica backoff filter. Invalid value → process exits con `[CONFIG ERROR]`.

2. **Test fixtures para tres branches (PARTIAL-02)**: Cada política tiene una integration test que mockea `runQuery` y `portalClient.post` para verificar el comportamiento end-to-end del flow de pago.
   - Current: Existen tests del payment flow pero no parametrizados por policy.
   - Target: Tres tests con la misma fixture inicial (1 pago en Sage, fila ERROR previa en `fesaPagosFocaltec` con `lastUpdate` fuera del backoff window):
     - Con `PARTIAL_PAYMENT_POLICY=atomic`: el cron NO incluye este pago en el recordset → ningún `portalClient.post` se llama → ninguna nueva fila en fesa.
     - Con `PARTIAL_PAYMENT_POLICY=idempotent`: el cron SÍ incluye → `portalClient.post` se llama una vez → nueva fila POSTED (si mock retorna 200) o nueva fila ERROR (si mock retorna 500).
     - Con `PARTIAL_PAYMENT_POLICY=resume`: idéntico al idempotent. Test verifica que la diferencia se observa solo en el log de boot (`[INFO] PARTIAL_PAYMENT_POLICY=resume aliased ...`).
   - Acceptance: `npm test -- --testPathPattern=partial-payment-policy` ejecuta los 3 tests; todos pasan; cada uno verifica explícitamente el comportamiento del WHERE generado + las llamadas mock.

3. **.env.example documentation (PARTIAL-03)**: El env está documentado con sus valores válidos, su default, y una nota sobre el alias `resume → idempotent`.
   - Current: No existe línea en `.env.example`.
   - Target: Nueva sección en `.env.example` con bloque:
     ```
     # Retry policy when a previous payment upload attempt failed (rows status='ERROR' exist in fesaPagosFocaltec).
     # Valid values:
     #   - atomic:     cron skips payments with any ERROR row; operator must clear manually
     #   - idempotent: cron retries after backoff; trusts portal to dedupe by external_id (default)
     #   - resume:     reserved for v2.5+ per-CFDI tracking; currently aliased to idempotent
     # Default: atomic (conservative — never auto-retries failed payments)
     PARTIAL_PAYMENT_POLICY=atomic
     ```
   - Acceptance: `grep -nE 'PARTIAL_PAYMENT_POLICY' .env.example` retorna ≥ 1 match en sección con comentario completo de 4 líneas. Verificable también con un test snapshot del bloque.

## Boundaries

**In scope:**

- Nuevo env var `PARTIAL_PAYMENT_POLICY` en `src/config.js` con enum validation + range guard.
- Modificación del WHERE en `PortalPaymentController.js` para incluir/excluir según el policy value (interactúa con el WHERE de Phase 20 — Phase 21 agrega una condición adicional que se compone con el scope filter + backoff filter ya introducidos por Phase 20).
- 3 integration tests parametrizados por policy.
- Documentación en `.env.example`.
- Logging diferenciado en boot (informativo) para resume → idempotent alias.

**Out of scope:**

- **Sandbox verification del dedupe del portal** — usuario decidió omitir; evidencia operacional de meses en prod implica que el dedupe funciona. Si futuro debugging revela duplicados, se reabre como issue separado.
- **`SANDBOX-TRANSCRIPT.md` artifact** — omitido junto con la verificación.
- **Per-CFDI tracking** en `fesaPagosFocaltec` — requiere schema change (violando la constraint del milestone) y refactor del controller para per-CFDI POST. Diferido a v2.5+ cuando se justifique con evidencia operacional concreta.
- **Refactor a POST per-CFDI** — el current code (1 POST por pago) se mantiene intacto. `resume` como concepto literal (re-subir solo los CFDIs faltantes) no se implementa en esta fase.
- **Cambios al endpoint REST `/api/payments/*`** — la política aplica solo al cron uploader, no al API operacional.
- **Dashboard UI** para mostrar el policy activo o filtrar pagos por status — backlog v2.5 (parte del "dashboard histórico por tenant").
- **REST endpoint para forzar override del policy** por pago individual — no justificado; operador edita `.env` y restart si necesita cambiar.
- **Cron lookback / scope** — eso es Phase 20 (#22). Phase 21 opera DENTRO de un pago que el cron HA decidido procesar.
- **Backoff curve / state** — eso es Phase 20 (RETRY-04, RETRY-05). Phase 21 reusa la infraestructura existente; el WHERE de Phase 21 se compone con el de Phase 20.
- **Schema change** a cualquier tabla — constraint heredado del milestone v2.4.

## Constraints

- **Hard dependency on Phase 20:** Phase 21 NO puede plan-phase ni execute-phase antes de que Phase 20 haya locked `RETRY_SCOPE`, `RETRY_BACKOFF_*` envs, y haya introducido la composición del WHERE con scope + backoff. Phase 21 inyecta UNA condición adicional (el ERROR-exclusion filter para `atomic`) sobre un WHERE que ya espera tener esas piezas.
- **No schema change:** mismo que Phase 20 / v2.4 milestone — `fesaPagosFocaltec` no cambia grain. Sin per-CFDI state.
- **Always-on regime (CLAUDE.md §3):** la lectura del env se hace en boot (`config.partialPayment.policy`), no en cada tick. Sin nuevos timers, listeners, o module-scope caches introducidos.
- **CLAUDE.md §6 #2 (runQuery default trap):** queries a `fesaPagosFocaltec` pasan `'FESA'` explícito; queries a la DB del tenant pasan `database[index]` explícito (el code base ya tiene esto correcto en el controller actual).
- **CLAUDE.md §6 #1 (SQL pattern):** template-literal pattern se mantiene; no se introducen nuevos sites parametrizados.
- **HANDOFF.md §§ 1-2 (redaction):** sin nombres del integrator previo en cualquier texto commiteado.
- **Defense-in-depth invariant (CLAUDE.md §9):** la condición adicional del WHERE para `atomic` (un `NOT EXISTS` extra) no debe empujar la duración del step `uploadPayments` cerca del cap de 5 min. Si en prod el query es muy lento, optimizar con índice o EXISTS más selectivo — NO subir STEP_TIMEOUT_MS.
- **Backward compatibility:** un deploy de Phase 21 sin setear `PARTIAL_PAYMENT_POLICY` aplica el default `atomic` — lo que cambia el comportamiento implícito actual (reintento automático cada tick) a "no reintenta". Documentar esto prominentemente en el commit message y en `.planning/STATE.md` para que el operador esté al tanto.

## Acceptance Criteria

- [ ] `node -e "require('./src/config')"` con valores default → exit code 0; `config.partialPayment.policy === 'atomic'`.
- [ ] Con `PARTIAL_PAYMENT_POLICY=xyz` → exit code 1 con `[CONFIG ERROR] PARTIAL_PAYMENT_POLICY inválido`.
- [ ] Con `PARTIAL_PAYMENT_POLICY=resume` → boot emite el log `[INFO] PARTIAL_PAYMENT_POLICY=resume aliased to idempotent until per-CFDI tracking exists (v2.5+)`.
- [ ] Con `PARTIAL_PAYMENT_POLICY=atomic`: un pago con fila ERROR previa en `fesaPagosFocaltec` NO aparece en el recordset del cron — verificable con test integration que mockea `runQuery`.
- [ ] Con `PARTIAL_PAYMENT_POLICY=idempotent` o `=resume`: un pago con fila ERROR previa fuera del backoff window SÍ aparece en el recordset y se reintenta.
- [ ] `grep -nE 'PARTIAL_PAYMENT_POLICY' .env.example src/config.js src/controller/PortalPaymentController.js` retorna matches en los tres archivos.
- [ ] `grep -nE 'Tersoft' .planning/phases/21-* src/ tests/` retorna 0 matches en cualquier texto nuevo commiteado.
- [ ] `npm test -- --testPathPattern=partial-payment-policy` ejecuta los 3 tests y todos pasan.
- [ ] El operador en prod, después de un deploy típico (Phase 20 + Phase 21 mergedeas en un solo PR o en PRs secuenciales), ve que un pago previamente fallido se reintenta solo si setea `PARTIAL_PAYMENT_POLICY=idempotent` o `=resume` en `.env`; con el default `atomic` el pago queda en estado ERROR esperando intervención.
- [ ] Defense-in-depth invariant verificable runtime: cron tick que evalúa el WHERE con la condición adicional de policy completa en `< STEP_TIMEOUT_MS` (medible via los logs `[TIMEOUT] step=uploadPayments durationMs=...`).

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                                  |
|--------------------|-------|------|--------|------------------------------------------------------------------------|
| Goal Clarity       | 0.85  | 0.75 | ✓      | Tres valores definidos, default locked, alias resume→idempotent documentado. |
| Boundary Clarity   | 0.85  | 0.70 | ✓      | Out-of-scope explícito (9 items). Hard-dep en Phase 20 declarada.       |
| Constraint Clarity | 0.75  | 0.65 | ✓      | No schema, no transport change, no sandbox needed, backoff a nivel pago.|
| Acceptance Criteria| 0.80  | 0.70 | ✓      | 10 checkboxes pass/fail. Cada REQ tiene Current/Target/Acceptance.      |
| **Ambiguity**      | 0.18  | ≤0.20| ✓      | Gate apenas pasado — depende de Phase 20 estar lockeada antes del plan. |

## Interview Log

| Round | Perspective    | Question summary                                       | Decision locked                                                                       |
|-------|----------------|--------------------------------------------------------|---------------------------------------------------------------------------------------|
| 1     | Researcher     | ¿El controller actual hace POST per-CFDI o por pago?   | Por pago — 1 POST con array `cfdis` embedido. No hay boundary HTTP per-CFDI.          |
| 1     | Researcher     | ¿Qué default si no hay transcript del sandbox?         | `atomic` — conservador, sin reintento automático, surface al operador.                |
| 1     | Simplifier     | ¿Refactor a POST per-CFDI o políticas a nivel pago?    | Nivel pago (1 POST = unidad). Sin refactor del controller. `resume` aliased.           |
| 1     | Boundary Keeper| ¿Cuándo capturar transcript del sandbox?               | OMITIR — usuario decidió no requerir verificación porque transport no cambia.         |
| 1     | Failure Analyst| ¿Backoff a nivel pago o per CFDI?                      | Nivel pago — una fila ERROR por intento en `fesaPagosFocaltec`. Sin schema change.    |

---

*Phase: 21-partial-payment-completion-policy*
*Spec created: 2026-05-13*
*Next step: /gsd-discuss-phase 21 — implementation decisions (SQL composition con WHERE de Phase 20, ubicación exacta del NOT EXISTS check, test fixture detail, etc.). NOTA: discuss-phase puede correr en main tree mientras Phase 20 está en su propio worktree; pero /gsd-plan-phase 21 espera a /gsd-execute-phase 20 (o al menos al final de plan-phase 20) para que el WHERE compuesto sea consistente.*
