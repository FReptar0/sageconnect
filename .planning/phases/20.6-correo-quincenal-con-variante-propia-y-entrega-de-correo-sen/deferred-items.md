# Fase 20.6 — hallazgos fuera de alcance

Cosas que se descubrieron mientras se ejecutaba la fase y que **no** se arreglaron aquí,
porque no las causó ningún cambio de la fase y arreglarlas habría ensanchado el diff justo
cuando la migración de servidores de octubre exige que sea revisable en aislamiento.

---

## D-20.6-01 — `tests/api/schedule-force-release.test.js` es intermitente bajo carga

**Descubierto:** 2026-09-09, durante el gate de suite completa del plan 20.6-02.

**Qué pasó.** La primera corrida completa tras cerrar el plan 20.6-02 mostró **siete** suites
en rojo en vez de seis. La séptima era `tests/api/schedule-force-release.test.js`, con un solo
caso caído: *«calls addHistory exactly once with ManualForceRelease shape»*.

**Por qué no es de este plan, demostrado y no razonado.**

1. Esa suite **no puede alcanzar** el archivo que el plan modificó. Requiere únicamente
   `src/utils/ResultEnvelope` y `src/routes/schedule-routes`; el único camino de
   `schedule-routes` hacia `EomNotification` pasa por `src/background`, y la suite lo tiene
   **mockeado completo** (`jest.mock('../../src/background', ...)`), así que el módulo
   modificado nunca se carga en ese worker.
2. Aislada pasa **20 de 20**.
3. Una segunda corrida completa, sin cambiar un byte del árbol, la da **verde**, y el `diff`
   de los nombres ordenados de suites en rojo contra la línea base sale **vacío**.

**Forma del defecto.** El caso que cae asegura un **conteo de llamadas** sobre un mock
(`addHistory` exactamente una vez). Es la firma típica de contaminación entre suites o de
reutilización de worker de Jest bajo carga, no de un fallo de producción.

**Precedente.** Es la segunda intermitencia de esta familia de fases. La primera la registró
el ejecutor de 20.5-04: `log-generator › writes log file content to disk`, también sensible a
la carga, también verde en aislamiento y en corridas posteriores. Ninguna de las dos está en
el conjunto de línea base de CLAUDE.md §6.

**Qué hacer con esto.** No tocar dentro de la 20.6. Merece su propia revisión junto con el
flake de `log-generator`: las dos apuntan a que la suite tiene estado compartido entre
archivos que sólo se manifiesta con el paralelismo por omisión de Jest.

**Aviso para quien mida la línea base después.** Si ves siete u ocho suites en rojo, revisa
primero si las extra son `schedule-force-release` o `log-generator` antes de buscar un
defecto propio. Corre la suite en aislamiento y repite la corrida completa.
