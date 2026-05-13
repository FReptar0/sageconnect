# Phase 20: Cron retry policy + EOM notification — Specification

**Created:** 2026-05-13
**Ambiguity score:** 0.11 (gate: ≤ 0.20)
**Requirements:** 13 locked (RETRY-01..07, EOM-01..06)
**Closes:** GH issues [#21](https://github.com/FReptar0/sageconnect/issues/21), [#22](https://github.com/FReptar0/sageconnect/issues/22)

## Goal

Reemplazar el filtro `MAX(Autoriza_OC_detalle.Fecha) = CAST(GETDATE() AS DATE)` (POs) y el lookback fijo en el uploader de pagos por un scope mensual configurable + backoff exponencial derivado de filas existentes en `fesa.dbo.fesaOCFocaltec` / `fesa.dbo.fesaPagosFocaltec`, sin schema change, y emitir una notificación HTML de fin de mes al buzón operador (`MAILING_NOTICES`) con los POs y pagos pendientes.

## Background

**Current state (grounded by codebase scout 2026-05-13):**

- **PO cron uploader (`src/controller/PortalOC_Creator.js:176-185`):** WHERE actual filtra por `X.Autorizada=1 AND X.Empresa='${db}' AND (SELECT MAX(Fecha) FROM Autoriza_OC_detalle ...) = CAST(GETDATE() AS DATE)` más skip-locations. Esto excluye permanentemente cualquier PO cuya última autorización-detalle no sea hoy. Evidencia operacional: `PO0083449` autorizada 2026-04-24 / última detalle-fecha 2026-05-07 → ignorada por el cron desde el 2026-05-08, requirió `po-upload.js` manual el 2026-05-12 (verificado en prod con `po-cron-diagnostic.js` el mismo día).
- **PO dedupe (POSTED check):** existe a nivel aplicación (`PortalOC_Creator.js:215-227`) — un `SELECT idFocaltec FROM fesaOCFocaltec WHERE ocSage=X AND idDatabase=Y AND status='POSTED'` POR PO ya recogido, dentro del loop. Funciona pero hace un round-trip extra por PO en lugar de filtrar en el WHERE inicial.
- **Payment uploader (`src/controller/PortalPaymentController.js:60-148`):** WHERE usa `P.AUDTDATE >= ${currentDate}` (lookback fijo, variable JS) + filtro de "60 minutos desde creación" + `P.DOCNBR NOT IN (SELECT NoPagoSage FROM fesaPagosFocaltec ...)` para dedupe. Mismo problema clase que POs cuando `currentDate` cae después de una ventana de fallas.
- **Insert pattern (`PortalOC_Creator.js:248-329`):** cada intento de upload inserta una fila nueva en `fesaOCFocaltec` con `createdAt=GETDATE()`, `lastUpdate=GETDATE()`, `status` ∈ {`POSTED`, `ERROR`}. Una PO con 3 reintentos fallidos tiene 3 filas con `status='ERROR'`, todas con timestamps distintos. Esto es lo que habilita el backoff derivado sin schema change.
- **Diagnostic script (`src/scripts/po-cron-diagnostic.js`):** replica el WHERE del cron en Section 4 y emite verdict. Hoy emite `Cron filtra por MAX(Fecha)=hoy` como verdict principal — no refleja estado de backoff.
- **Email infrastructure:**
  - `src/utils/EmailSender.js` (operator-facing): `sendMail(data)` usa `config.mailing.notices[position]` + CC `config.mailing.cc`. Body actual es HTML simple (h1 + table con status + message). Único caller hoy → si Phase 20 lo extiende, queda en 2 callers (no 3) → técnicamente NO dispara la PATTERNS.md §S-6 third-use rule, pero la extensión es natural y reutiliza la transport config existente.
  - `src/utils/AdminEmailSender.js` (admin-facing, quick-260502-i7l): `sendAdminAlert(subject, html, callerLogFile)` routes a `config.license.adminEmail`. Reutilizable para el admin fallback alert del EOM.
- **Scheduler (`src/services/CronScheduler.js`):** `initScheduler()` registra un task node-cron + `lock:timeout` listener. El cron-tick guard para EOM se mete dentro de `forResponse()` (cada 15 min) — un task separado de node-cron agregaría componente always-on (CLAUDE.md §3).

**Why now:** Tres incidencias documentadas en 2026-05 (PO0083449 y otros operadores reportaron skips) + GH issues #21 #22 abiertas 2026-05-13. Sin esta fix la única recovery es manual (operador corre `po-upload.js`); no escala y no detecta huérfanos pre-cierre de mes.

## Requirements

1. **PO scope filter rewrite (RETRY-01)**: El cron levanta una PO cuya última autorización (`MAX(Autoriza_OC_detalle.Fecha)`) cae dentro del scope configurado.
   - Current: WHERE `(SELECT MAX(Fecha) FROM Autoriza_OC_detalle ...) = CAST(GETDATE() AS DATE)` excluye todo lo que no sea de hoy.
   - Target: WHERE sargable `Fecha >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) AND Fecha < DATEADD(month, 1, DATEFROMPARTS(...))` cuando `RETRY_SCOPE=current_month`, o `Fecha >= DATEADD(day, -${RETRY_LOOKBACK_DAYS}, CAST(GETDATE() AS DATE))` cuando `RETRY_SCOPE=last_n_days`.
   - Acceptance: Una PO con `MAX(Autoriza_OC_detalle.Fecha)` igual al día 1 del mes corriente aparece en el recordset del cron en `current_month` mode; aparece también en `last_n_days` mode si `RETRY_LOOKBACK_DAYS >= dias_transcurridos_desde_dia_1`. Verificable con `po-cron-diagnostic.js PO0083449` post-deploy: Section 4 (cron WHERE replica) devuelve `RowsCronWouldSee >= 1`.

2. **Payment scope filter rewrite (RETRY-02)**: El cron levanta un pago cuya última autorización cae dentro del scope configurado, con el mismo patrón que POs.
   - Current: `P.AUDTDATE >= ${currentDate}` con `currentDate` calculado en JS como lookback fijo no-configurable.
   - Target: Misma forma sargable que RETRY-01 aplicada al campo `AUDTDATE` (o el equivalente que represente la autorización del pago, a confirmar en discuss-phase). Sin tocar el filtro de "60 minutos desde creación" — ese es ortogonal.
   - Acceptance: Un pago autorizado el día 1 del mes corriente aparece en el recordset cuando `RETRY_SCOPE=current_month`, y se omite cuando se cambia el scope a `last_n_days` con `RETRY_LOOKBACK_DAYS=1`.

3. **Scope env vars + range guards (RETRY-03)**: Operador puede cambiar el scope via env sin redeploy de código (solo restart).
   - Current: No existe env var `RETRY_SCOPE` ni `RETRY_LOOKBACK_DAYS`. El lookback de pagos está hardcodeado en JS.
   - Target: `src/config.js` lee `RETRY_SCOPE` (default `current_month`, valores válidos `current_month | last_n_days`) y `RETRY_LOOKBACK_DAYS` (default `30`, rango `[1, 365]`). Ambos disponibles en `config.retry.scope` y `config.retry.lookbackDays`. Range guards exitan con `[CONFIG ERROR]` si valor inválido (mismo patrón que los 4 timeouts guards de v2.3).
   - Acceptance: `node -e "process.env.RETRY_SCOPE='invalid'; require('./src/config')"` exit code 1 con `[CONFIG ERROR] RETRY_SCOPE inválido`. `RETRY_LOOKBACK_DAYS=0` y `=400` también exitan con error. Defaults aplican cuando vars no definidas.

4. **Exponential backoff filter (RETRY-04)**: Cuando un intento previo falló, el cron espera un intervalo exponencial creciente antes de reintentar — derivado del control table existente.
   - Current: No hay backoff. Cada tick reintenta cualquier PO/pago que pase los filtros del WHERE (lo que en la práctica significa que un error transitorio se reintenta cada 15 min hasta éxito o hasta que pase el límite de tick).
   - Target: WHERE incluye una condición `NOT EXISTS (... status='ERROR' AND lastUpdate > DATEADD(MINUTE, -wait_minutes, GETDATE()))` donde `wait_minutes = min(RETRY_BACKOFF_MAX_MIN, RETRY_BACKOFF_INITIAL_MIN * (RETRY_BACKOFF_MULTIPLIER ^ (errorCount - 1)))`. `errorCount` se obtiene de un subquery `SELECT COUNT(*) FROM fesaOCFocaltec WHERE ocSage=X AND idDatabase=Y AND status='ERROR'`. El cálculo del threshold se hace en JS (forma `computeBackoffWaitMinutes(errorCount)`) y se inyecta como literal en la query — esto preserva el patrón template-literal del codebase y permite testear el helper en aislamiento.
   - Acceptance: Helper `computeBackoffWaitMinutes(n)` retorna 0 para n=0, 15 para n=1, 30 para n=2, 60 para n=3, 120 para n=4, ..., capped at 1440. Una PO con 1 fila ERROR creada hace 10 minutos NO aparece en el recordset (backoff aún no vencido); la misma PO 6 minutos después SÍ aparece. Verificable con un test que mockea `runQuery` para inyectar las filas ERROR.

5. **Backoff env vars + range guards (RETRY-05)**: Parámetros del backoff son configurables y validados al boot.
   - Current: No existen los envs.
   - Target: `RETRY_BACKOFF_INITIAL_MIN` (default `15`, rango `[1, 60]`), `RETRY_BACKOFF_MULTIPLIER` (default `2`, rango `[1.0, 10.0]`, acepta float), `RETRY_BACKOFF_MAX_MIN` (default `1440` = 24h, rango `[60, 10080]` = 1w). Range guards al boot exitan con `[CONFIG ERROR]` si inválidos. Expuestos en `config.retry.backoff.{initialMin, multiplier, maxMin}`.
   - Acceptance: Tres tests separados — uno por env var — verifican que valores out-of-range exitan con `[CONFIG ERROR]` referenciando el var name. Defaults aplican cuando vars no definidas. `computeBackoffWaitMinutes` lee de `config.retry.backoff.*`.

6. **POSTED dedupe en el WHERE (RETRY-06)**: El cron nunca selecciona una PO/pago que ya tenga una fila `POSTED` en fesa.*.
   - Current: Para POs, el dedupe existe pero a nivel aplicación dentro del loop (round-trip extra por cada PO recogida). Para pagos, sí está en el WHERE (`P.DOCNBR NOT IN (SELECT NoPagoSage ...)`).
   - Target: POs — agregar `AND NOT EXISTS (SELECT 1 FROM fesa.dbo.fesaOCFocaltec WHERE ocSage = A.PONUMBER AND idDatabase = '${database}' AND status = 'POSTED')` al WHERE del cron. Remover el check redundante dentro del loop. Pagos — mantener el patrón actual (ya correcto), solo ajustar para el nuevo scope.
   - Acceptance: Una PO con una fila `POSTED` en `fesaOCFocaltec` NO aparece en el recordset del cron. El log NO emite `[WARN] PO ${X} ya procesada (POSTED), se omite` (ese mensaje desaparece — el filtro está antes). Test integration: insertar fixture con 1 fila POSTED → recordset.length === 0 para esa PO.

7. **Diagnostic script verdict update (RETRY-07)**: `po-cron-diagnostic.js` reporta estado de backoff (attempts + próximo eligible) además del scope filter.
   - Current: Section 4 replica el WHERE viejo (`= CAST(GETDATE() AS DATE)`). Verdict-priority compara `fesaStatus === 'POSTED'` (existe el bug de trailing whitespace separado — está pendiente como issue #26 o follow-up).
   - Target: Section 4 actualiza in-place al nuevo WHERE (no se mantiene 4b histórico — el script es operacional, no archivológico). Nueva Section 6 calcula y muestra: `errorCount`, `lastErrorAt`, `backoffWaitMin`, `nextEligibleAt`. Verdict-priority orden actualizado: (1) POSTED → "ya está procesada"; (2) ERROR + dentro de backoff window → "esperando backoff hasta ${nextEligibleAt}"; (3) ERROR + fuera de backoff window → "lista para reintentar en el próximo tick"; (4) cero filas en fesa → "nunca intentada, debe entrar en el próximo tick"; (5) fuera del scope → "fuera de RETRY_SCOPE, ignorada".
   - Acceptance: Una corrida del script contra PO0083449 post-deploy emite verdict que incluye `errorCount`, `lastErrorAt`, y `nextEligibleAt` cuando hay filas ERROR. La sección 4 muestra exactamente el WHERE que el cron está usando — no el viejo.

8. **EOM trigger window (EOM-01)**: La notificación se dispara el último día calendario del mes a partir de `EOM_NOTIFICATION_HOUR`.
   - Current: No existe notificación EOM. Operador descubre huérfanos manualmente o no los descubre.
   - Target: Dentro de `forResponse()` (cron-tick guard) — al inicio del tick, evaluar `(today === lastDayOfMonth() && hour >= config.eom.notificationHour && config.eom.notificationEnabled && !sentinelExists())`. Si cumple, dispatch EOM email check + send + sentinel write antes de seguir con la lógica del tick normal.
   - Acceptance: Test unitario del helper de evaluación (`shouldDispatchEom(now, sentinelPath)`) retorna true cuando hoy es ultimoDia+hora>=18+sentinel ausente, false en cualquier otra combinación. Integration test simula clock al último día 18:05 sin sentinel → ve el dispatch.

9. **EOM recipients (EOM-02)**: Email a `MAILING_NOTICES` (todos los destinatarios, no solo position[0]) con CC `MAILING_CC`. NO a `LICENSE_ADMIN_EMAIL`.
   - Current: `EmailSender.sendMail` envía a `notices[position]` (un solo destinatario por posición) — no es el patrón que queremos para un reporte consolidado.
   - Target: Extender `EmailSender.js` con `sendOperatorReport({subject, html})` que envía a `config.mailing.notices.join(',')` (todos) con CC `config.mailing.cc`. Nuevo export, no reemplaza al `sendMail` existente.
   - Acceptance: Test unitario verifica que el `to` field del mailOptions contiene la lista completa de notices, no solo el primero. El admin email (`config.license.adminEmail`) NO aparece en `to` ni `cc` del email principal.

10. **EOM email content (EOM-03)**: Email HTML con dos tablas (POs / pagos pendientes) y links al dashboard.
    - Current: No existe.
    - Target: `<h1>SageConnect: Pendientes fin de mes — {YYYY-MM}</h1>` + intro + 2 tablas. Columnas por tabla: `#`, `Tenant`, `Fecha autorización`, `Intentos`, `Último error` (truncado a 100 chars). Si tabla vacía → mensaje "Sin pendientes en esta categoría este mes". Footer con `<a href="${BASE_URL}/pos.html">Ver POs</a>` y `<a href="${BASE_URL}/payments.html">Ver pagos</a>` (BASE_URL = configurable o derivado).
    - Acceptance: Snapshot test del HTML generado con un set fijo de datos: 2 POs pendientes + 1 pago pendiente → output coincide con fixture en `tests/fixtures/eom-email-sample.html`.

11. **EOM idempotency (EOM-04)**: El email se envía a lo sumo una vez por categoría por mes via sentinel file. **Cambio respecto a recomendación original:** el sentinel se crea pase lo que pase (incluso si el send falló).
    - Current: No existe sentinel ni dispatch.
    - Target: Sentinel path `logs/eom-{YYYY-MM}-{pos|payments}.sent` (dos sentinels separados — uno por categoría). Al cumplirse el gate de EOM-01: (a) si sentinel existe → skip silencioso; (b) si no existe → intentar send; (c) escribir sentinel SIEMPRE después del intento (success o fail) con contenido `{timestamp, success: true|false, error?: string}`; (d) si fail, disparar `AdminEmailSender.sendAdminAlert()` con subject "[SageConnect] EOM email FAILED for {YYYY-MM} - {categoría}" como fallback al admin.
    - Acceptance: Tres tests integration — (a) primer tick del último día → email enviado + sentinel creado con `success: true`; (b) segundo tick mismo día → no se reenvía (skip silencioso); (c) primer tick con SMTP mockeado fallando → sentinel creado con `success: false, error: ...` + admin email enviado + no se reenvía en ticks subsiguientes del mismo día/mes.

12. **EOM kill-switch (EOM-05)**: Operador puede desactivar completamente la notificación via env.
    - Current: No existe.
    - Target: `EOM_NOTIFICATION_ENABLED` (default `true`, valores `true | false`). Expuesto en `config.eom.notificationEnabled`. Checado al inicio del gate ANTES de cualquier query o file check — short-circuit absoluto si false.
    - Acceptance: Test con `config.eom.notificationEnabled = false` → ni se llama a `shouldDispatchEom`, ni se hace query, ni se escribe sentinel.

13. **EmailSender extension (EOM-06)**: Reusar `src/utils/EmailSender.js` agregando un nuevo export, no duplicar transport config.
    - Current: `sendMail({data})` existe. No hay `sendOperatorReport`.
    - Target: `module.exports = { sendMail, sendOperatorReport }`. `sendOperatorReport({subject, html, callerLogFile})` reutiliza la misma transport config (host/port/secure/auth) que `sendMail`. Internamente toma `to` desde `config.mailing.notices` (lista completa) y `cc` desde `config.mailing.cc`. `callerLogFile` igual que `AdminEmailSender` para preservar log routing.
    - Acceptance: `grep -n "^async function sendOperatorReport" src/utils/EmailSender.js` retorna 1 match. La función NO duplica `nodemailer.createTransport` con config nueva — reutiliza el patrón existente. Test verifica que un envío que falla loguea en `${callerLogFile}.log` (no en `EmailSender.log` fijo).

## Boundaries

**In scope:**

- Reescribir el WHERE de `PortalOC_Creator.js` para incluir scope + backoff + POSTED-dedupe (3 cambios en el mismo SQL string).
- Reescribir el WHERE de `PortalPaymentController.js` con el mismo patrón aplicado al campo de autorización del pago.
- Nuevo helper `computeBackoffWaitMinutes(errorCount, config)` en `src/utils/` (probablemente `RetryPolicy.js`).
- Nuevo helper `shouldDispatchEom(now, sentinelPath, config)` co-localizado o en `src/utils/EomNotification.js`.
- Extender `src/utils/EmailSender.js` con `sendOperatorReport()`.
- Cron-tick guard para EOM dentro de `forResponse()` (no es un task separado de node-cron).
- 7 nuevos env vars + range guards en `src/config.js`.
- Actualizar `.env.example` con los 7 envs documentados (defaults + valid ranges).
- Actualizar `src/scripts/po-cron-diagnostic.js`: Section 4 in-place + nueva Section 6 (backoff state) + verdict-priority reordenada.
- **NUEVO en este SPEC respecto al milestone scoping:** Dos scripts CLI dedicados — `src/scripts/retry-month-pos.js --dry-run` y `src/scripts/retry-month-payments.js --dry-run` — para barrer huérfanos pre-cambio antes de habilitar el WHERE nuevo en cron. Default `--dry-run`, `--apply` explicit para mutación. Reusan los helpers (`computeBackoffWaitMinutes`, scope filter SQL) para garantizar consistencia con el cron.
- Tests: unit del helper de backoff, integration que mockean `runQuery` para verificar los new WHERE (3 casos por controlador: POSTED→skip, ERROR-en-backoff→skip, ERROR-fuera-de-backoff→include), EOM gate test, snapshot del HTML del email.

**Out of scope:**

- Schema changes a `fesa.dbo.fesaOCFocaltec` o `fesa.dbo.fesaPagosFocaltec` — constraint explícito del user, todo se deriva.
- Nueva tabla de attempt history — derivable del control table existente.
- Dashboard UI mostrando "attempts" / "next eligible" en `/pos.html` o `/payments.html` — backlog v2.5.
- REST endpoint para forzar retry de PO/pago específico — operador usa scripts existentes.
- Slack / Teams / SMS notification — solo email, alineado con discipline del canal existente.
- Cambios al cron cadence (sigue 15 min, CLAUDE.md §9 invariant).
- Cambios al filtro de 60 minutos desde creación en pagos — ortogonal al scope/backoff.
- Migración de los template-literal SQL strings a queries parametrizadas — CLAUDE.md §6 #1 (patrón establecido del codebase, no se agregan sites nuevos sin necesidad).
- Trabajo de Phase 21 (partial payment policy) — phase separado, bloquea en sandbox confirmation del portal.
- Email a `LICENSE_ADMIN_EMAIL` para reportes EOM — confusión de canal (admin email es service-level alerts, no operator reports). Excepción: EOM-04 fallback alert sí va a admin como señal de salud del notification path.
- Backfill de huérfanos viejos (>1 mes) — fuera del scope mensual configurado. Si el operador necesita, corre el script con `RETRY_SCOPE=last_n_days RETRY_LOOKBACK_DAYS=60`.

## Constraints

- **No schema change:** restricción explícita del usuario (decisión locked en milestone scoping). Todo el estado de backoff/dedupe se deriva de filas existentes (`COUNT(*)`, `MAX(lastUpdate)`).
- **Always-on regime (CLAUDE.md §3):** cualquier nuevo `setInterval`, `setTimeout`, EventEmitter listener, módulo-scope `Map`/`Set`, o `child_process.spawn` documenta cómo se limpia. El cron-tick guard para EOM NO agrega timers (corre dentro del tick existente).
- **Defense-in-depth (CLAUDE.md §9):** `axios (30s) < step (5m) < child (10m) < lock (14m)`. Los nuevos subqueries del WHERE NO deben empujar la duración de la step de "PO upload" o "payment upload" cerca del límite step (5m). Si el WHERE es muy lento, se ajusta con un EXISTS más eficiente o un CTE — no se incrementa STEP_TIMEOUT_MS.
- **SQL pattern (CLAUDE.md §6 #1):** template-literals con interpolación de `${database}` y `${currentDate}` — patrón establecido, no se introducen nuevos sitios mutados a queries parametrizadas dentro de Phase 20. Las nuevas porciones del WHERE siguen el mismo estilo. Variables que vienen de envs validados (RETRY_BACKOFF_*, RETRY_LOOKBACK_DAYS) son seguras (range-guarded).
- **runQuery default trap (CLAUDE.md §6 #2):** las queries a `fesa.dbo.*` (POSTED check, ERROR count) pasan `'FESA'` como segundo arg explícito. Las queries a la DB del tenant (Autoriza_OC, POPORH1) pasan `databases[index]` explícito.
- **HANDOFF.md §6 (no local DB, prod-loop is the validation rig):** los scripts `retry-month-*.js` arrancan en `--dry-run` por default; `--apply` es opt-in explícito.
- **HANDOFF.md §7 (double verification):** después de un envío exitoso (o intento), el email body referencia el conteo desde fesa.* — no asume que portal ya está sincronizado.
- **HANDOFF.md §§ 1-2 (redaction):** textos commiteados no llevan nombres del integrator previo. Identificadores codebase (`fesaOCFocaltec`, `idFocaltec`, etc.) son nombres de tabla/columna existentes y están permitidos.
- **`logs/` directory:** verificar antes del plan que `logs/` está en `.gitignore` (sí lo está). Los sentinel files (`eom-*.sent`) sobreviven `git reset --hard` en prod porque viven fuera del repo tracked. Atomic write recomendado para evitar half-written sentinels post-crash (escribir a `eom-*.sent.tmp`, rename).
- **SMTP error budget:** un fallo de SMTP no debe bloquear el resto del cron tick. `sendOperatorReport()` y `sendAdminAlert()` swallow errors (warn-log) — mismo contrato que `AdminEmailSender.sendAdminAlert`.

## Acceptance Criteria

- [ ] `node -c src/controller/PortalOC_Creator.js` y `node -c src/controller/PortalPaymentController.js` — SYNTAX OK con los nuevos WHEREs.
- [ ] `npm test` post-cambio: el set de pre-existing failed suites (CLAUDE.md §6 #3) sigue idéntico; todos los tests nuevos del helper de backoff + del WHERE mockeado + del EOM gate pasan; suite total no introduce regresiones.
- [ ] `node -e "require('./src/config')"` con valores default → exit code 0. Con `RETRY_SCOPE=invalid` → exit 1 con `[CONFIG ERROR] RETRY_SCOPE inválido`. Con `RETRY_BACKOFF_INITIAL_MIN=0` → exit 1.
- [ ] `grep -nE 'INSERT |UPDATE |DELETE FROM' src/scripts/retry-month-pos.js src/scripts/retry-month-payments.js | grep -v "INSERT INTO fesa.dbo.fesa"` retorna solo las INSERTs intencionales (success/error rows). No hay UPDATE ni DELETE en los scripts.
- [ ] `grep -nE 'PORHSTAT' src/scripts/po-cron-diagnostic.js` retorna 0 matches (heredado de quick-260513-ket, no regresión).
- [ ] `grep -nE 'Tersoft' .planning/phases/20-* src/ tests/` retorna 0 matches en cualquier texto nuevo commiteado.
- [ ] El primer cron tick post-deploy en prod (operador hace `git fetch && git reset --hard origin/master && npm ci --omit=dev && servy-cli restart --name=SageConnect`) no exita con `[CONFIG ERROR]`; el log de la primera corrida muestra el nuevo formato de WHERE (verificable via `Get-Content E:\sageconnect-dist\logs\PortalOC_Creator.log -Tail 50`).
- [ ] Operador puede correr `node src/scripts/retry-month-pos.js --dry-run` y ver la lista de POs que el nuevo cron levantaría, sin que se ejecute ningún upload (`grep` del log emite `[DRY-RUN]` prefix).
- [ ] Operador puede correr `po-cron-diagnostic.js PO0083449` post-deploy y ver verdict con `errorCount`, `lastErrorAt`, `nextEligibleAt` reflejando el estado real.
- [ ] El último día del mes a las 18:05 (clock simulado en test, o real en prod cuando llegue), un email landea en `MAILING_NOTICES` con tablas POs + pagos pendientes (o "Sin pendientes" si no hay). El sentinel `logs/eom-{YYYY-MM}-pos.sent` y `logs/eom-{YYYY-MM}-payments.sent` aparecen creados con `success: true`.
- [ ] Si SMTP falla durante el send EOM, el sentinel se crea con `success: false`, y `LICENSE_ADMIN_EMAIL` recibe un fallback alert.
- [ ] `EOM_NOTIFICATION_ENABLED=false` en `.env` + restart → el log NO muestra evaluación del gate EOM en ningún tick del último día.
- [ ] Defense-in-depth invariant verificado runtime — un cron tick típico (incluyendo el cálculo de backoff y EOM gate) completa en `< STEP_TIMEOUT_MS` para todos los steps (medible via los logs `[TIMEOUT] step=... durationMs=...` introducidos en v2.3).

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                              |
|--------------------|-------|------|--------|--------------------------------------------------------------------|
| Goal Clarity       | 0.95  | 0.75 | ✓      | Cambios concretos identificados file:line. 13 REQs falsifiables. |
| Boundary Clarity   | 0.90  | 0.70 | ✓      | Out-of-scope explícito (10 items con razón). Backfill resuelto via scripts dedicados (no first-tick burst).|
| Constraint Clarity | 0.80  | 0.65 | ✓      | No schema change locked. Defense-in-depth tiers respetados. SMTP error budget definido.|
| Acceptance Criteria| 0.85  | 0.70 | ✓      | 13 checkboxes pass/fail. Cada REQ tiene Current/Target/Acceptance. |
| **Ambiguity**      | 0.11  | ≤0.20| ✓      | Gate pasado con margen. discuss-phase enfoca solo en HOW.          |

## Interview Log

| Round | Perspective    | Question summary                              | Decision locked                                        |
|-------|----------------|-----------------------------------------------|---------------------------------------------------------|
| 1     | Researcher     | ¿Qué existe hoy en los dos controllers cron?  | PO: WHERE con MAX(Fecha)=today + dedupe POSTED en loop (PortalOC_Creator.js:176-227). Payment: WHERE con AUDTDATE >= currentDate + dedupe NOT-IN en WHERE (PortalPaymentController.js:60-148). |
| 1     | Researcher     | ¿El patrón de INSERT en fesa.* habilita backoff sin schema? | Sí — cada intento inserta nueva fila (createdAt/lastUpdate/status). COUNT(*) WHERE status='ERROR' da attempt count derivable. |
| 1     | Boundary Keeper| ¿SQL "current calendar month" — sargable o no?| Sargable: `Fecha >= DATEFROMPARTS(...) AND Fecha < DATEADD(month, 1, ...)`. Inmune a year-boundary, indexable.|
| 1     | Boundary Keeper| ¿EOM cron-tick gate — task separado o inline en forResponse? | Inline en forResponse. No agrega componente al scheduler. Sentinel file gates re-send.|
| 1     | Failure Analyst| ¿Qué hace si el send EOM falla (SMTP down)?   | Sentinel se crea PASE LO QUE PASE + admin alert fallback al LICENSE_ADMIN_EMAIL si fail. No retry storm.|
| 1     | Failure Analyst| ¿Cómo manejar huérfanos pre-cambio en prod?   | Scripts dedicados `retry-month-{pos,payments}.js --dry-run` (no first-tick burst). HANDOFF.md §6 dry-run rule.|

---

*Phase: 20-cron-retry-policy-eom-notification*
*Spec created: 2026-05-13*
*Next step: /gsd-discuss-phase 20 — implementation decisions (subqueries vs JOINs, JS-vs-SQL backoff formula placement, test strategy, [RETRY-SKIP] log routing, etc.)*
