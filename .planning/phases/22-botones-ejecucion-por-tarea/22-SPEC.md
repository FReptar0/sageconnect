# Phase 22: Botones de ejecución por tarea — Specification

**Created:** 2026-08-03
**Ambiguity score:** 0.12 (gate: ≤ 0.20)
**Requirements:** 6 locked
**Branch:** feat/boton-ejecucion

## Goal

El portal de ejecución manual (`public/ejecucion.html`) permite ejecutar **una tarea específica** —empezando por **"Compras"** = actualización de proveedores (`buildProvidersXML`) seguida de creación de órdenes de compra (`createPurchaseOrders`)— en lugar de forzar el ciclo completo de 7 pasos, **reusando el lock `background-cycle`** para que nunca se cruce con el cron de 15 minutos.

## Background

Hoy `forResponse()` en `src/background.js` ejecuta los **7 pasos en secuencia fija**, cada uno como `fn(i)` por tenant envuelto en `withStepTimeout` + log + `stepProgress`:

1. `buildProvidersXML` (proveedores) → 2. `downloadCFDI` (facturas) → 3. `checkPayments` → 4. `uploadPayments` (pagos) → 5. `createPurchaseOrders` (compras) → 6. `processOrderChanges` → 7. `closePurchaseOrders`.

El endpoint `POST /api/schedule/background-cycle/trigger` (`schedule-routes.js:133`) dispara **todo** `forResponse()`. El botón actual de `ejecucion.html` usa ese endpoint. El lock `background-cycle` de `OperationManager` ya evita el solape cron-vs-manual (cron se salta con `[OVERLAP]`, disparo manual da 409, auto-release a 14 min).

**Origen del trabajo (juntas Capstone/Focaltec):** Santiago (2026-07-30 team, 2026-08-03 revisión — prioridad ALTA) pidió poder ejecutar solo una tarea, porque correr todo a mano puede cruzarse con el cron. El **punto crítico es "compras"**, con el orden **proveedores primero, luego OC** (una OC falla si el proveedor no está actualizado). Objetivo final: un botón por tarea. Para las primeras pruebas, el botón-todo actual sirve; "compras" es el objetivo inmediato.

**Lo que NO existe hoy:** una forma de correr un **subconjunto** de los pasos. `forResponse()` es todo-o-nada y el endpoint dispara el ciclo completo.

## Requirements

1. **Orquestación selectiva**: existe una forma de ejecutar un subconjunto ordenado de los 7 pasos con el MISMO envoltorio que hoy (per-tenant, `withStepTimeout`, logging, `stepProgress`, manejo de error por paso).
   - Current: `forResponse()` corre los 7 pasos hardcodeados; no hay forma de correr un subconjunto.
   - Target: un mecanismo (p.ej. `runSteps(stepKeys, options)`) corre solo los pasos indicados, en orden, preservando el envoltorio de cada paso.
   - Acceptance: invocar el mecanismo con `['buildProviders','createPurchaseOrders']` ejecuta **solo** esos dos, en ese orden; los otros 5 no se invocan (verificable por test con mocks o por logs `[START]/[COMPLETE]`).

2. **Botón "Compras" (proveedores → OC)**: la página expone un botón que ejecuta solo la tarea de compras.
   - Current: `ejecucion.html` solo tiene el botón "Ejecutar proceso ahora" (todo el ciclo).
   - Target: un botón "Compras" que dispara `buildProvidersXML` y luego `createPurchaseOrders` (en ese orden), sin ejecutar facturas ni pagos ni el ciclo de cierre de OC.
   - Acceptance: click en "Compras" produce en el log la secuencia proveedores→createPO y ningún otro paso; el resultado se muestra en la página.

3. **Reuso del lock `background-cycle` (no cruzarse con el cron)** — REQUISITO CRÍTICO NO NEGOCIABLE.
   - Current: solo el botón-todo adquiere el lock; no hay ejecución por-tarea.
   - Target: toda ejecución por-tarea adquiere el MISMO lock `background-cycle` antes de correr; si hay un ciclo en curso (cron o manual) devuelve **409**; si el cron dispara mientras una tarea corre, el cron se salta con `[OVERLAP]`.
   - Acceptance: (a) disparar "Compras" mientras el cron corre → HTTP 409; (b) el cron llega mientras "Compras" corre → `[OVERLAP]` en el log y el cron NO ejecuta; (c) el auto-release a 14 min sigue aplicando a la ejecución por-tarea.

4. **UI refleja el estado real (reuso del #1)**: todos los botones se deshabilitan mientras cualquier ciclo corre.
   - Current: el botón-todo ya se deshabilita ("Sincronizando...") vía poll a `/api/operations/status` cuando existe `operations['background-cycle']`.
   - Target: el mismo comportamiento aplica al botón "Compras" (y a cualquier botón por-tarea): deshabilitado + "Sincronizando..." mientras haya un ciclo (cron, manual-todo o por-tarea) en curso; re-habilitado al terminar; fail-safe si el poll falla.
   - Acceptance: mientras corre cualquier ejecución, el botón "Compras" queda deshabilitado; al terminar se re-habilita solo; si el poll falla el botón no se traba.

5. **No romper el cron ni el botón-todo existentes** — REQUISITO CRÍTICO NO NEGOCIABLE.
   - Current: el cron de 15 min corre `forResponse()` completo; el botón "Ejecutar proceso ahora" dispara el ciclo completo; `npm test` en baseline §6 (6 suites / 7 tests de 426).
   - Target: ambos siguen funcionando idénticamente; la orquestación selectiva se agrega SIN alterar el comportamiento del ciclo completo.
   - Acceptance: `npm test` sigue en el baseline §6 (sin fallas nuevas); el cron sigue ejecutando los 7 pasos; el botón-todo sigue disparando el ciclo completo.

6. **Disciplina always-on preservada (§3 CLAUDE.md)**: ningún recurso nuevo queda sin límite de vida.
   - Current: el código actual respeta axios(30s) < step(5m) < child(10m) < lock(14m) y limpia sus timers (`clearInterval` en `beforeunload`).
   - Target: cualquier `setInterval`/`setTimeout`/listener/Map nuevo declara su limpieza; los rangos de timeout no cambian; los pasos por-tarea siguen envueltos en `withStepTimeout`.
   - Acceptance: revisión de código confirma que no hay timer/listener nuevo sin su limpieza y que los rangos de timeout siguen intactos (range-guards de `config.js` sin cambio).

## Boundaries

**In scope:**
- Mecanismo de orquestación selectiva (correr un subconjunto ordenado de los 7 pasos) en `src/background.js`.
- Botón "Compras" en `public/ejecucion.html` = `buildProvidersXML` → `createPurchaseOrders`.
- Endpoint(s) para disparar una tarea, reusando el lock `background-cycle`.
- Deshabilitar los botones por-tarea durante cualquier ciclo (extensión del #1 ya existente).

**Out of scope:**
- Los otros 3 botones (pagos, facturas, solo-proveedores) — se pueden agregar con el mismo mecanismo después; el punto crítico definido por Santiago es "compras". (Ver Preguntas abiertas.)
- Locks separados por tarea (granularidad fina) — se usa el lock compartido `background-cycle` por seguridad always-on; correr una tarea manual en paralelo al cron es justo lo que Santiago quiere evitar.
- Modificar la lógica interna de los pasos (`buildProvidersXML`, `createPurchaseOrders`, etc.) — solo se re-orquesta el ORDEN de invocación, no se tocan las funciones.
- Reintentos (fases 20–20.3) — otra línea de trabajo, vive en `feat/reintentos`.
- Exposición vía Bastion / accesos de servidor — es infraestructura (Jorge/Alan), no código.

## Constraints

- **No romper el cron de 15 minutos** (requisito explícito del usuario) — mediante reuso del lock `background-cycle`.
- `src/background.js` es el orquestador **always-on load-bearing** (§3): máximo cuidado; preservar la cascada de timeouts axios<step<child<lock y la limpieza de recursos.
- CommonJS, indentación 4 espacios, `logGenerator(LOG_FILE, ...)`, tenant threading por índice `i` — convenciones del repo (`.planning/codebase/CONVENTIONS.md`).
- Cambio va por fase GSD completa (spec→discuss→plan→execute); el `pre-edit-gsd-guard` exige fase activa para editar `src/**`.

## Acceptance Criteria

- [ ] Existe orquestación selectiva que corre un subconjunto ordenado de pasos con el envoltorio `withStepTimeout`+log+`stepProgress`.
- [ ] El botón "Compras" ejecuta `buildProvidersXML` → `createPurchaseOrders` y NINGÚN otro paso.
- [ ] Disparar una tarea mientras el cron corre devuelve HTTP 409.
- [ ] El cron se salta con `[OVERLAP]` si una tarea por-botón está corriendo.
- [ ] El botón "Compras" se deshabilita durante cualquier ciclo y se re-habilita solo al terminar (fail-safe si el poll falla).
- [ ] El cron de 15 min sigue ejecutando los 7 pasos y el botón-todo sigue disparando el ciclo completo.
- [ ] `npm test` en baseline §6 (sin fallas nuevas).
- [ ] Ningún `setInterval`/`setTimeout`/listener nuevo sin su limpieza; rangos de timeout intactos.

## Preguntas abiertas (DECISIÓN DE NEGOCIO — SANTIAGO, no inventar)

Estas NO bloquean el spec (se asume el default indicado) pero deben confirmarse con Santiago antes de execute:

1. **¿Qué compone exactamente "Compras"?** Default asumido: `buildProvidersXML` + `createPurchaseOrders`. ¿Debe incluir también `processOrderChanges` (paso 6) y `closePurchaseOrders` (paso 7), es decir el ciclo completo de OC? — afecta Req. 2.
2. **¿Los 4 botones ya, o solo "Compras" primero?** Default asumido: solo "Compras" en esta fase (punto crítico); los demás después. Santiago aceptó el 30-jul que compras es el objetivo inmediato.
3. **¿Se conserva el botón "Ejecutar proceso ahora" (todo)?** Default asumido: sí, se conserva junto a los por-tarea.

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                        |
|--------------------|-------|------|--------|--------------------------------------------------------------|
| Goal Clarity       | 0.90  | 0.75 | ✓      | Objetivo concreto: botón Compras = proveedores→OC, sin cruzar cron |
| Boundary Clarity   | 0.85  | 0.70 | ✓      | In/out scope explícito; única duda = alcance exacto de "compras" (pregunta a Santiago) |
| Constraint Clarity | 0.92  | 0.65 | ✓      | Requisito lock/cron muy claro y verificable                  |
| Acceptance Criteria| 0.85  | 0.70 | ✓      | 8 criterios pass/fail                                         |
| **Ambiguity**      | 0.12  | ≤0.20| ✓      | Ambigüedad residual es de negocio (alcance de "compras"), marcada como pregunta a Santiago con default |

Status: ✓ = met minimum

## Interview Log

Modo auto: el usuario (jr) no responde preguntas técnicas/de negocio; los requisitos se derivan del contexto de las juntas (29-jul 1:1, 30-jul team, 03-ago revisión — transcripciones en `data/`) y del código verificado (`forResponse`, `OperationManager`, `schedule-routes.js`, `ejecucion.html`). Decisiones de negocio genuinas → sección "Preguntas abiertas" (no inventadas).

| Round | Perspective     | Question summary                              | Decision locked                                             |
|-------|-----------------|-----------------------------------------------|-------------------------------------------------------------|
| 1     | Researcher      | ¿Qué existe hoy y cuál es el delta?           | 7 pasos modulares en `forResponse`; falta orquestación selectiva |
| 2     | Simplifier      | ¿Mínimo viable?                               | Mecanismo `runSteps` + botón "Compras" (proveedores→OC); demás botones después |
| 3     | Boundary Keeper | ¿Qué NO se hace?                              | No tocar lógica de pasos; no reintentos; no locks por-tarea; no Bastion |
| 4     | Failure Analyst | ¿Qué invalidaría el resultado?                | Cruzarse con el cron (→ reuso lock obligatorio); romper el ciclo-todo o el baseline de tests |

---

*Phase: 22-botones-ejecucion-por-tarea*
*Spec created: 2026-08-03*
*Next step: /gsd-discuss-phase 22 — decisiones de implementación (cómo construir lo especificado arriba)*
