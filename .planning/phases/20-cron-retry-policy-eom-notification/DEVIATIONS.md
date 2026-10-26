# Phase 20 — Desviaciones entre código construido y acuerdo cliente

**Status:** 🔴 **BLOQUEANTE PARA DEPLOY** — el código actual no refleja lo acordado en la reunión del 20 de mayo de 2026.
**Detectado:** 2026-06-02 (verificación de transcripción `reintentos.txt` vs código en `master`).
**Fuente del acuerdo:** [`MEETING-2026-05-20-NOTES.md`](./MEETING-2026-05-20-NOTES.md) en este directorio.

---

## Resumen ejecutivo

Phase 20 fue construida entre el 13-15 de mayo basada en una interpretación inicial de los criterios del cliente (correo del 15-mayo). La reunión del **20 de mayo** cerró formalmente esos criterios, y en **2 de las 4 preguntas la decisión final fue distinta** de lo que se construyó. El código NO se actualizó después de la reunión.

| # | Pregunta | Acordado en reunión | Lo construido | Estado |
|---|---|---|---|---|
| Q1 | Hasta cuándo reintentar | Opción A — hasta fin de mes | `RETRY_SCOPE=current_month` | ✅ MATCH |
| **Q2** | **Frecuencia** | **30 min FIJO (ajustable a 15/10)** | **15→30→60→...→1440 (geométrica ×2)** | 🔴 **NO MATCH** |
| **Q3** | **Alertas pre-cierre** | **POs inmediata + Pagos quincenal** | **Solo EOM último día del mes** | 🔴 **NO MATCH** |
| Q4 | Errores permanentes | Opción A — reintentar todo | Opción A | ✅ MATCH |

**Implicación:** desplegar Phase 20 como está generaría una conversación incómoda con el cliente — el sistema NO se comportaría como se acordó. **No desplegar antes de cerrar estas desviaciones.**

---

## Desviación 1 — Q2: Frecuencia de reintentos

### Lo acordado (reunión, líneas 79-117 de la transcripción)

> Yahir: *"lo mejor sería cada 30 minutos o una hora."*
>
> Guillermo: *"los reintentos serían cada 30 minutos, esperando que no se empalmen."*
>
> Yahir: *"lo mejor sería dejarlos cada media hora. Vemos cómo se comporta y lo podemos ir ajustando y lo podemos ir bajando. Hasta llegar a los 10 minutos."*

**Decisión:** **Frecuencia FIJA de 30 minutos** entre reintentos. Configurable para BAJAR (no subir) a 15 o 10 min si el sistema lo soporta sin saturar.

### Lo construido (`src/utils/RetryPolicy.js`)

`computeBackoffWaitMinutes(errorCount, backoffConfig)` aplica curva geométrica:

```
errorCount=1 → 15 min
errorCount=2 → 30 min
errorCount=3 → 60 min
errorCount=4 → 120 min
…
errorCount=8 → 1440 min (cap 24 h)
```

Defaults: `RETRY_BACKOFF_INITIAL_MIN=15`, `RETRY_BACKOFF_MULTIPLIER=2`, `RETRY_BACKOFF_MAX_MIN=1440`.

### Qué cambiar

**Concepto:** sustituir backoff geométrico por **frecuencia fija**.

**Archivos a modificar:**

| Archivo | Cambio |
|---|---|
| `src/utils/RetryPolicy.js` | Reemplazar `computeBackoffWaitMinutes` por algo como `getRetryIntervalMinutes(config)` que regresa SIEMPRE `config.retry.intervalMin` (default 30, range [10, 60]). No depende de `errorCount`. |
| `src/config.js` | Sustituir `RETRY_BACKOFF_INITIAL_MIN` + `RETRY_BACKOFF_MULTIPLIER` + `RETRY_BACKOFF_MAX_MIN` por **UN solo env**: `RETRY_INTERVAL_MIN` (default 30, range [10, 60]). Quitar las 3 vars antiguas + sus range guards. Renombrar el namespace de `config.retry.backoff` a algo como `config.retry.interval` (o aplanar). |
| `.env.example` | Borrar la sección de `RETRY_BACKOFF_*`, dejar `RETRY_INTERVAL_MIN=30` documentado. |
| `src/controller/PortalOC_Creator.js` | El JS post-filter ya no usa la curva geométrica. Verifica `(now - ef.lastErrorAt) >= retryIntervalMin * 60000`. Si pasó el intervalo → eligible; si no → diferir. |
| `src/controller/PortalPaymentController.js` | Mismo cambio que el controlador de POs. |
| `src/scripts/po-cron-diagnostic.js` | Sección 6 "Estado de backoff" se renombra a "Estado de reintento". Reporta `lastErrorAt`, `retryIntervalMin` (el valor de config), `nextEligibleAt = lastErrorAt + intervalMin`. Quitar `backoffWaitMin` (ya no aplica). |
| `tests/utils/RetryPolicy.test.js` | Reescribir tests — ya no hay curva canónica que validar. Verificar que el intervalo retornado coincide con config.retry.intervalMin, y que valores out-of-range se rechazan en boot. |
| `tests/controller/PortalOC_Creator.cron-where.test.js` y `PortalPaymentController.cron-where.test.js` | Ajustar fixtures: las 3 cases (POSTED skip, ERROR-en-intervalo skip, ERROR-fuera-de-intervalo include) ahora se evalúan contra `retryIntervalMin`, no contra una curva. |

**Notas de implementación:**

- **No es un "tope" de intentos** — los reintentos siguen indefinidamente hasta el cierre de mes (que es Q1=A). Solo cambia el tiempo ENTRE reintentos.
- El log `[BACKOFF-DEFER]` se renombra a `[RETRY-DEFER]` (`backoff` ya no aplica como concepto).
- El log `[BACKOFF]` summary se renombra a `[RETRY]`.

**Riesgo:** las pruebas en `RetryPolicy.test.js` que verifican la curva canónica (`15, 30, 60, 120, 240, 480, 960, 1440`) **deben borrarse** y reescribirse — esos tests fueron exitosos pero validaban el comportamiento incorrecto.

---

## Desviación 2 — Q3: Alertas antes del cierre de mes

### Lo acordado (reunión, líneas 116-140)

> Guillermo (POs): *"órdenes de compra pendientes... requerimos que sea más continuo porque los proveedores suben facturas todos los días... Ok, entonces que sea un alerta inmediata, ¿no?"*
>
> Yahir: *"Sí, en orden de compra sí estaría muy bien."*
>
> Guillermo (pagos): *"Y en pagos a lo mejor cada 15 días sí estaría perfecto."*

**Decisión:** **Modelo DIFERENCIADO:**

- **POs pendientes:** **alerta INMEDIATA** — cada vez que se detecta una PO que no pudo cargar, notificar enseguida (no esperar a cierre de mes ni a quincena).
- **Pagos pendientes:** correo **cada 15 días** con los pendientes acumulados en esa quincena.

### Lo construido (`src/background.js:373` `dispatchEomIfDue` + `src/utils/EomNotification.js`)

```javascript
for (const category of ['pos', 'payments']) {
  // mismo gate (shouldDispatchEom): último día del mes + hora >= 18 + sentinel missing + enabled=true
  // mismo dispatch: query → buildEomEmailHtml → sendOperatorReport
}
```

**Características del código actual:**

- UNA sola dispatch al fin de mes (último día calendario, default 18:00 hrs).
- Ambas categorías (`pos` + `payments`) usan el mismo `shouldDispatchEom`, mismo gate, mismo cadence.
- No hay mecanismo de alerta inmediata.
- No hay cadence quincenal.

### Qué cambiar

**Concepto:** rearquitectar la dispatch completa — son DOS mecanismos distintos (no un solo dispatch dividido en categorías).

**Archivos a modificar:**

| Archivo | Cambio |
|---|---|
| `src/utils/EomNotification.js` | Rehacer. Ya no es solo "EOM". Renombrar archivo a `src/utils/PendingNotifications.js` (o similar). Exponer 3 helpers: `shouldDispatchImmediatePoAlert(now, sentinelPath, config)`, `shouldDispatchPaymentReport(now, sentinelPath, config)`, y mantener el HTML builder (con dos modos: `inmediato` vs `consolidado`). |
| `src/background.js` `dispatchEomIfDue` | Renombrar / reescribir. Ya no es "EOM if due" — es algo como `dispatchPendingNotifications(now, cfg)` que llama a DOS flows distintos: (a) alerta POs inmediata, (b) consolidado pagos quincenal. |
| `src/config.js` | Sustituir `EOM_NOTIFICATION_HOUR` + `EOM_NOTIFICATION_ENABLED` por: <br>• `PO_ALERT_ENABLED` (default `true`)<br>• `PAYMENT_REPORT_ENABLED` (default `true`)<br>• `PAYMENT_REPORT_INTERVAL_DAYS` (default `15`, range [1, 31])<br>• `PAYMENT_REPORT_HOUR` (default `18`, range [0, 23])<br>Eliminar `config.eom` namespace; crear `config.notifications.{poAlert, paymentReport}`. |
| `.env.example` | Reescribir la sección Phase 20 con las nuevas envs. |
| **Alerta inmediata POs (NUEVO)** | Hay que decidir DÓNDE detectar el fallo y disparar la alerta. La opción más natural: en el catch de `PortalOC_Creator.js` (donde ya se inserta la fila ERROR a `fesa.dbo.fesaOCFocaltec`), después de la fila, llamar a `sendOperatorReport({ subject: '[SageConnect] PO falló: PO${id}', html: ..., callerLogFile: 'PortalOC_Creator' })`. Con un **sentinel anti-spam** (no duplicar el mismo PO si ya se mandó alerta esta semana). |
| **Cadence quincenal pagos (NUEVO)** | Sentinel quincenal en lugar de mensual. Ejemplo: `logs/payment-report-{YYYY-MM-QQ}.sent` donde QQ es `1` para días 1-15, `2` para días 16-fin-de-mes. O por fecha exacta (día 1 y día 16 a las 18:00). |
| `tests/integration/eom-dispatch.test.js` | Reescribir entero. Ahora son DOS suites: (a) alerta inmediata POs (verifica que un error de carga dispara correo enseguida + sentinel anti-spam), (b) consolidado pagos quincenal (verifica gate cada 15 días + sentinel quincenal). |
| `tests/utils/EomNotification.test.js` | Reescribir. Ya no hay un solo `shouldDispatchEom` — son dos predicates distintos. La snapshot del HTML quizá se mantiene si la estructura del cuerpo es similar. |
| `tests/fixtures/eom-email-sample.html` | Quizá necesite 2 fixtures: uno para alerta inmediata (1 PO), otro para consolidado pagos (lista). |

**Notas de implementación:**

- **Anti-spam crítico:** la alerta inmediata POs sin guardas podría generar 50 correos en una hora si un cron tick procesa un lote grande con errores múltiples. El sentinel anti-spam (por PO o agrupando por tick) NO es opcional.
- **Sentinel quincenal:** semánticamente más complejo que el mensual. Dos enfoques:
  - **(a) Periodo natural** (días 1-15 y 16-fin de mes): sentinel `logs/payment-report-{YYYY-MM}-{1|2}.sent`. Predicate: el día N del periodo a la hora X.
  - **(b) Rolling 15 días:** menos predecible para el operador; descartar.
- **El fallback de SMTP** (envío al admin si falla) sigue aplicando para ambos flows.
- **Kill-switch** ahora son dos: uno por flow (POs inmediata, pagos quincenal). Se puede silenciar uno sin afectar al otro.

---

## Cambios derivados (en cascada)

### Plan IDs y SPEC

Phase 20 tiene 13 REQs lockeados en `20-SPEC.md`. **REQ EOM-01..05 (todo el bloque EOM) y REQ RETRY-04, RETRY-05 (backoff) están con descripción incorrecta** frente a lo acordado. Hay que:

- Actualizar `20-SPEC.md` con los nuevos REQs O escribir un `20-SPEC-AMENDMENT-2026-06-02.md` que sobreescriba los REQs afectados.
- Actualizar `20-CONTEXT.md` § "Customer confirmation" — la actual dice "Customer confirmed the retry-criteria defaults via email" del 15-mayo, pero la **decisión vinculante es la reunión del 20-mayo**, no el correo. Hay que corregir la fecha y los detalles.
- Reevaluar `20-VERIFICATION.md` — todos los REQs marcados MET hay que re-verificar contra los nuevos criterios. Los que ya pasaron (Q1, Q4) siguen MET; Q2 y Q3 pasan a NOT MET.

### Tests

Casi todos los tests de Phase 20 cubren el comportamiento construido (que es el comportamiento incorrecto). Hay que **borrar y reescribir** los tests que validan:
- La curva geométrica de backoff (`RetryPolicy.test.js`).
- El gate de EOM mensual (`EomNotification.test.js`).
- El dispatch único de fin de mes (`eom-dispatch.test.js`).

Los tests que sí permanecen válidos:
- POSTED-dedupe en el WHERE (correcto, Q1+Q4).
- Range guards de las envs que se mantengan (`config.retry.scope`, `RETRY_LOOKBACK_DAYS`).
- Atomicidad del sentinel write (mismo helper, distintos casos de uso).
- Scope filter `current_month` (correcto, Q1).

### UAT (`20-UAT.md`)

Test 1 está pendiente. El UAT entero hay que rediseñar — varios tests verifican criterios del modelo viejo (EOM uniforme, backoff geométrico). Empezar UAT después de implementar las desviaciones, no antes.

### Documentación

- `MEETING-2026-05-20-NOTES.md` (este directorio) — acta formal de la reunión. Léelo primero.
- `DEVIATIONS.md` (este archivo) — lo que tienes que cambiar.
- `20-SPEC.md`, `20-CONTEXT.md`, `20-VERIFICATION.md` — actualizar para reflejar nuevos criterios.

---

## Caminos posibles para resolverlo

### Camino A (recomendado) — Phase 20.1 / gap-closure grande

1. Crear `.planning/phases/20.1-retry-policy-correction-2026-06-02/` (o usar la convención que prefieras).
2. SPEC nuevo SOLO con las correcciones de Q2 y Q3.
3. Discuss, plan, execute, verify — pipeline GSD normal.
4. Borrar tests obsoletos en el commit del gap-closure.
5. Re-verificar Phase 20 contra el acuerdo correcto.
6. Deploy.

**Ventaja:** trazabilidad limpia — el repo cuenta la historia honesta de "construimos, nos reunimos, ajustamos, desplegamos".
**Costo:** ~1-2 semanas de trabajo + reverificación.

### Camino B — Reset Phase 20 y rehacer

1. Revertir los commits de Phase 20 ejecución (df5ad2d en adelante, ~30 commits).
2. Reescribir SPEC desde cero con los criterios correctos.
3. Plan + execute + verify nuevamente.

**Ventaja:** Phase 20 queda "limpia".
**Costo:** mayor — más commits afectados, mayor riesgo de perder cosas que SÍ funcionan (Q1, Q4, scope filter, retry-month scripts, diagnostic update, etc.).
**Recomendación:** NO. Mucho del código actual es bueno; solo Q2 y Q3 requieren cambio.

### Camino C (NO RECOMENDADO) — Desplegar tal cual y "ajustar después"

Implicación: el cliente recibe un sistema que NO hace lo que pidió. Las cargas manuales bajan pero las alertas no llegan como acordaron, y la cadencia de reintentos no es la que se discutió. Conversación incómoda asegurada en la siguiente revisión.

---

## Lo que SÍ está bien y se queda

- **Q1 — scope mensual** (`buildScopeWhere` con `current_month`) ✅
- **Q4 — reintentar todo** ✅
- **OUTER APPLY** en el WHERE para traer errorCount + lastErrorAt ✅ (sigue siendo útil)
- **POSTED dedupe** en el WHERE (NOT EXISTS) ✅
- **Atomic write de sentinel** (write-then-rename) ✅ (el sentinel sigue existiendo, solo cambia su semántica)
- **`callerLogFile` pattern** en `EmailSender.sendOperatorReport` ✅
- **`retry-month-pos.js` y `retry-month-payments.js`** (scripts de barrido) ✅
- **Diagnostic script** — base correcta, solo cambian las etiquetas y la sección 6
- **Range guards de envs** — patrón correcto, solo cambian las envs específicas

---

## Heads-up no técnicos

### Antes del deploy (cualquiera que sea el camino)

- **Confirmar con Memo (cliente) la ventana** — compromiso explícito en la reunión del 20-mayo: *"si se necesita hacer alguna actualización... que se confirme con memo precisamente la actualización para que veamos que no se cruza el cierre."*
- **No desplegar en cierre de mes** (días 28-fin de mes y días 1-5 del siguiente).

### Botón manual de sync (compromiso pendiente desde la reunión)

Guillermo solicitó un botón en el bastión para forzar la sincronización manual. Fer lo dejó "casi listo" pero ya no está. Antes de la próxima reunión con Capstone hay que:
- Validar estado real de ese desarrollo (puede estar en alguna rama o tarea sin documentar).
- Coordinar con sistemas del cliente (Jorge / Alan) los accesos.

Esto es un trabajo SEPARADO de las desviaciones Q2/Q3 — no es parte de Phase 20, pero es un compromiso vivo con el cliente.

### Cuenta operacional

- 10+ POs cargadas manualmente entre 12-may y 2-jun (~3 por semana) — todas del patrón Miguel Ramírez (batch authorization → cron las pierde).
- La urgencia operacional es real, pero NO justifica desplegar el modelo incorrecto.
- Comunicar al líder + al cliente que el deploy se retrasa para alinearlo con lo acordado en la reunión.

---

*Documento generado el 2026-06-02 como resultado de la verificación detallada entre `reintentos.txt` (transcripción) y el código en `master` (44 commits ahead de origin/master). Próxima sesión: arrancar con `/clear` y este archivo + `MEETING-2026-05-20-NOTES.md` como input.*
