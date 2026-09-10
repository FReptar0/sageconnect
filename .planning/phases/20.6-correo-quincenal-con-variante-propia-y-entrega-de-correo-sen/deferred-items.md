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

---

## D-20.6-02 — una frase del JSDoc de `dispatchPaymentReportIfDue` quedó obsoleta

**Descubierto:** 2026-09-09, durante el plan 20.6-05, leyendo el despachador hermano para
replicar su forma.

**Qué dice hoy.** `src/background.js:510` — *«Sin respaldo al buzón de administración, a
diferencia de `dispatchEomIfDue`, cuyo catch sí lo usa»*. Desde el commit `6061649` el
cierre de mes ya **no** tiene un `catch`: el respaldo cuelga de la rama de no entrega. La
afirmación de fondo —que el reporte quincenal no escala y el cierre de mes sí (D-12 / D-15)—
**sigue siendo correcta**; lo único obsoleto es el mecanismo que la frase nombra.

**Por qué no se arregló aquí.** El alcance del plan 20.6-05 está acotado **por escrito** a
`dispatchEomIfDue` y sólo a ésa, en la aprobación `aprobar-ambos` transcrita en
`20.6-04-SUMMARY.md`. Tocar el hermano habría (a) salido del alcance aprobado para un archivo
crítico y (b) roto la propiedad que el plan 20.6-04 dejó como criterio: que su diff sobre este
archivo sea revisable en aislamiento, byte a byte contra `HEAD`.

**Impacto.** Ninguno en ejecución. Es prosa de JSDoc; ni una guarda ni un criterio de
aceptación la cuenta.

**Qué hacer con esto.** Una línea, en el primer plan que vuelva a abrir `src/background.js`
con autorización para el hermano. Cambiar «cuyo catch sí lo usa» por «cuya rama de no entrega
sí lo usa».

---

## D-20.6-03 — el encabezado de `payment-report-dispatch.test.js` prohíbe algo que ya pasó dos veces

**Descubierto:** 2026-09-10, durante la tarea 3 del plan 20.6-07, al auditar si algún guarda
estructural contaba ocurrencias sobre `tests/integration/eom-dispatch.test.js`.

**Qué dice hoy.** `tests/integration/payment-report-dispatch.test.js:7-8` — *«Archivo NUEVO en
vez de una extensión de `tests/integration/eom-dispatch.test.js`: ese archivo es el artefacto
que prueba Q3-05 y **su diff debe quedar vacío**»*.

**Por qué quedó obsoleto.** Era una restricción de la fase **20.5**, y correcta entonces: el
requisito Q3-05 se demostraba con el diff vacío de ese archivo. La fase 20.6 le añadió casos
**dos veces**, las dos con autorización explícita de su plan y las dos por APPEND puro
(`grep -c "^-"` del diff = 1): el plan `20.6-08` con los dos casos de WR-04, y el `20.6-07`
con los dos de WR-01. La suite pasó de 6 a 10 casos.

**Por qué no se arregló aquí.** No lo causó ningún cambio de este plan y está en un archivo
que el plan no toca. Arreglarlo habría ensanchado el diff sobre un artefacto ajeno.

**Impacto.** Ninguno en ejecución: es prosa de un comentario de cabecera, ninguna guarda la
lee. El riesgo es de lectura — quien la tome al pie de la letra creerá que los planes 07 y 08
violaron una restricción vigente, cuando la restricción caducó al cerrarse la fase 20.5.

**Qué hacer con esto.** Reescribir esas dos líneas en el retro de la fase 20.6, dejando dicho
que lo que la 20.5 protegía era el **fixture** `tests/fixtures/eom-email-sample.html` —cuyo
`git diff` sí sigue teniendo que salir vacío, y sale— y no el archivo de pruebas.

---

## D-20.6-04 — nueve ocurrencias del mismo defecto de planeación, y el modo sigue ensanchándose

**Descubierto:** acumulativo a lo largo de la fase; la novena, en el plan 20.6-07.

**Qué es.** Un criterio o una predicción del plan que **no puede cumplirse en un árbol limpio**,
por una razón que una medición previa habría revelado en segundos.

| # | Plan | Forma del defecto |
|---|---|---|
| 1-3 | 20.6-01 · 20.6-02 · 20.6-03 | `grep -c` contando **líneas** donde el plan quería **ocurrencias** |
| 4-5 | 20.6-04 · 20.6-05 | el mismo modo, ahora enganchando dobles correctos que el criterio no quería contar |
| 6 | 20.6-02 | un conteo que ya era insatisfacible **antes** de la fase, por prosa de JSDoc preexistente |
| 7 | 20.6-06 | no un `grep -c` sino un **ancla `$`** contra un formato que nadie verificó |
| 8 | 20.6-08 | no un criterio sino una **tabla predictiva** que contradecía al `<behavior>` del propio plan |
| 9 | 20.6-07 | **ninguna de las anteriores**: una **mutación de verificación** cuyo ROJO predicho es imposible, porque el mutante es semánticamente la identidad sobre las entradas reales |

**La regla a la que la fase convergió, en su forma final:**

> Toda predicción de un criterio —un número de `grep`, un conteo, o el **rojo de una
> mutación**— se pre-mide en árbol limpio antes de confiar en ella, en su modo de conteo,
> en su anclaje **y en su poder de discriminación**. Una predicción falsa manda al ejecutor
> a «arreglar» algo que estaba bien; una mutación que no discrimina afirma una cobertura
> que no existe.

**Qué hacer con esto.** Es material de RETROSPECTIVE, no de un plan. Nueve de nueve planes de
la fase lo repitieron: es defecto de **planeación**, no de ejecución, y el remedio va en la
plantilla de planes — que todo criterio derivado de una medición traiga transcrita la medición
en árbol limpio que lo respalda.
