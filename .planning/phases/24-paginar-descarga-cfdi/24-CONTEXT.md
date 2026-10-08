# Phase 24: Paginar la descarga de CFDIs (corregir el tope de 200) - Context

**Gathered:** 2026-10-08
**Status:** Ready for planning
**Branch:** `feat/paginar-descarga-cfdi` (sale de `origin/master` `dde4bd0`)

<domain>
## Phase Boundary

`src/utils/GetTypesCFDI.js` deja de cortar en 200 las consultas al portal: `getTypeI`, `getTypeE` y `getCfdisByProvider` paginan hasta el `total` que reporta el portal, con el filtro "ya está en Sage" en bloque (para que el paso downloadCFDI siga dentro de sus 5 min), un presupuesto de tiempo para el listado, y un registro que hace visible cualquier corte. Es el único archivo de `src/` que cambia; se agregan tests. No toca el downloader, `background.js`, la ventana de fechas ni el botón de XML antiguos.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**15 requirements are locked.** See `24-SPEC.md` for full requirements, boundaries, and acceptance criteria.

Downstream agents MUST read `24-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
- Paginación completa en `getTypeI`, `getTypeE` y `getCfdisByProvider`, con una sola función de paginación compartida también por `getPendingToPayInvoices` (cuyo contrato no cambia).
- Reintento por página, devolución parcial ante fallo y presupuesto de tiempo del listado.
- Filtro "ya está en Sage" en bloque con la misma semántica, con validación estricta de UUID y RFC antes de SQL.
- Líneas de log resumen por consulta y por filtro, una línea por factura a descargar o con anomalía, y la línea de corte en `getTypeP`.
- `providerId` y filtro local en `getCfdisByProvider`; `hideValidations=true` en las consultas paginadas.
- Suite Jest nueva con mocks de `PortalClient.get` y `runQuery` que ejercite la lógica real.
- Verificación sin regresión en `zcl-rds-test` (una página: el sandbox tiene pocas facturas) y verificación en vivo de `providerId` y `hideValidations`.

**Out of scope (from SPEC.md):**
- Botón "Descargar XML pendientes o antiguos" — segunda entrega; fase propia.
- Cambiar la ventana de fechas (`from` = día 1 del mes anterior).
- Paginar `getTypeP` y optimizar `checkPayments`.
- Probar `pageSize` > 200.
- Robustez de `CFDI_Downloader.js` (addenda cruzada, `/files` sin try/catch, addenda sin `catch`, re-descargas).
- `background.js`, `getTypeIToSend` y los scripts con `pageSize=0` (`get-payment-cfdis.js`, `payment-uuid-repair.js`).
- Bugs de logs ajenos (`payment-reconciliation.js` reemplaza `console.log` global; `WARN` repetido de `PortalOC_Closer`).
- Correo de alerta cuando recibidas < `total`.
- Adaptar los scripts operativos del servidor (diagnóstico y rescate) — se ajustan aparte.
- Reanudar la paginación entre ciclos (cursor) — sólo si el presupuesto corta en operación normal.
- Desplegar a producción.

</spec_lock>

<decisions>
## Implementation Decisions

Yahir delegó todas las decisiones técnicas ("que funcionen, no tengan errores, y que sea lo más óptimo y escalable"); ninguna de las de abajo cambia el producto ni toca producción, así que se tomaron sin preguntarle. Los REQ-24-xx son los del SPEC.

### Estructura del código (único archivo de `src/`: `src/utils/GetTypesCFDI.js`)
- **D-01:** Dos funciones internas nuevas, **no exportadas**: una de paginación (p. ej. `fetchCfdiPages(index, query, opts)`) y una de filtro (p. ej. `filterNotInSage(index, items, kind, label)`). La API exportada no cambia (REQ-24-15): los tests entran por las funciones públicas con `PortalClient.get` y `runQuery` mockeados.
- **D-02:** La función de paginación **nunca lanza** por un fallo de página: devuelve `{ items, total, pages, ms, slowestPageMs, stopReason, failedOffset }` y cada llamador decide. `getTypeI`/`getTypeE`/`getCfdisByProvider` procesan lo recibido (REQ-24-05; si falló la primera página, `items` viene vacío y se devuelve `[]` como hoy). `getPendingToPayInvoices` devuelve `[]` si `stopReason === 'pagina-fallida'` (contrato "todo o nada", REQ-24-03).
- **D-03:** La URL se arma con `encodeURIComponent` en cada valor. Parámetros: `documentTypes=CFDI`, `offset`, `pageSize=200`, y según el llamador `cfdiType`, `stage`, `from`, `to`, `providerId`, `hideValidations=true`. `getPendingToPayInvoices` conserva exactamente su conjunto actual (sin `hideValidations`).
- **D-04 — Condiciones de corte**, evaluadas después de cada página en este orden:
  1. página vacía → `pagina-vacia`;
  2. la página no trajo ningún UUID nuevo → `sin-avance`. Protege contra un portal que ignore `offset`: contar items crudos, como hace hoy `getPendingToPayInvoices`, llegaría a `total` con puros duplicados y cortaría en silencio;
  3. únicos ≥ `total` (con `total` > 0) → `completo`;
  4. páginas = tope → `tope-paginas`.

  Además, antes de pedir cada página se revisa el presupuesto (`presupuesto`, D-09), y si una petición falla tras los reintentos se corta con `pagina-fallida` y `offset_fallido`. `offset += pageItems.length` (posición en la lista del portal).
- **D-05 — Sin regla de "página corta".** No se asume que una página con menos de 200 sea la última: si el portal bajara su tope de página en silencio (p. ej. a 100), esa regla cortaría la lista; seguir hasta `total` o una página vacía es lo robusto. Cuando `total` es confiable no cuesta peticiones extra (se corta por conteo).
- **D-06:** Si `total` = 0 y la primera página viene vacía, el corte es `completo` (0 de 0). Si `total` no viene o es 0 pero hay items, se pagina hasta página vacía y el registro dice `total=desconocido`. El nivel de la línea de consulta lo decide recibidas vs `total`, no la etiqueta del corte.
- **D-07 — Dedupe** por UUID normalizado (`trim().toUpperCase()`); sin UUID, por `id` del portal. Se conserva la primera aparición y el orden del portal (más nuevas primero). Para respuestas sin duplicados, `getPendingToPayInvoices` devuelve exactamente lo de hoy.
- **D-08 — Topes y concurrencia.** Funciones del ciclo: `maxPages = 50` (10,000 comprobantes; el presupuesto corta mucho antes, el tope sólo impide un bucle infinito). `getPendingToPayInvoices` conserva su opción `maxPages` con default 1000. Las páginas se piden **en serie**: el portal limita con 429 (por eso existe el reintento), en paralelo el presupuesto se vuelve difícil de contabilizar, y con el filtro en bloque ~4 páginas en serie caben de sobra. Si el log mostrara lo contrario, la medida siguiente es el cursor entre ciclos (diferido), no el paralelismo.

### Reintento y presupuesto de tiempo (REQ-24-04, REQ-24-06)
- **D-09:** Se reutiliza `isRetryablePortalError` sin cambios, con la política actual de `requestPendingToPayPage`: 3 intentos, espera de `intento × 1500 ms`. `requestPendingToPayPage` se generaliza o se sustituye por la versión general (a criterio del planner).
- **D-10 — Presupuesto** = `Math.floor(config.schedule.stepTimeoutMs * LISTING_BUDGET_FRACTION)`, con la constante de módulo `LISTING_BUDGET_FRACTION = 0.25` y un comentario con la cuenta: 2 × (75 s + 30 s en vuelo) = 210 s < 300 s del paso.
  - Se lee **en cada llamada**, no al cargar el módulo.
  - Se revisa antes de cada página y antes de cada espera de reintento: si la espera terminaría después del límite, no se espera ni se reintenta, y se corta con `presupuesto`.
  - Una petición en vuelo no se aborta; la acota el timeout de axios (30 s).
  - Aplica a `getTypeI`, `getTypeE` y `getCfdisByProvider`; **no** a `getPendingToPayInvoices` (presupuesto nulo).
- **D-11 — Reloj:** `Date.now()`. Los tests usan `jest.useFakeTimers()` (en Jest 29 simula también `Date.now` y `setTimeout`) o `jest.spyOn(Date, 'now')`. **Ningún test duerme en tiempo real.**

### Filtro "ya está en Sage" en bloque (REQ-24-07 a REQ-24-10)
- **D-12 — Orden del filtro:**
  1. Validar cada item: UUID y RFC recortados contra las regex de REQ-24-09. Si es inválido, se omite con una línea `warn`.
  2. RFC: una consulta por cada RFC válido distinto, **idéntica a la actual** (`SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '<rfc>'`, db `'FESA'`). Se prefiere a un `IN` de RFCs porque R vale 1 o 2 y así se conserva la semántica probada.
  3. CxP, sólo para los UUID de items con RFC registrado, en bloques de 200: `SELECT DISTINCT O.[VALUE] AS U FROM APIBH H JOIN APIBHO O ON H.CNTBTCH = O.CNTBTCH AND H.CNTITEM = O.CNTITEM WHERE H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND O.[VALUE] IN (...)`, db `databases[index]`.
  4. OC (facturas, `POINVH1/POINVHO` por `INVHSEQ`) o NC (notas de crédito, `POCRNH1/POCRNHO` por `CRNHSEQ`), con `OPTFIELD = 'FOLIOCFD'`, sólo para los UUID que no salieron en CxP, en bloques de 200, db `databases[index]`.

  El motivo de omisión sigue la misma precedencia de hoy: RFC → CxP → OC/NC.
- **D-13 — Literales del `IN`:** cada UUID recortado **tal como lo entregó el portal**, sin cambiar mayúsculas. Así coincide con lo mismo que el `=` actual con cualquier intercalación de la base. Las filas devueltas se cruzan con los items en JS con `trim().toUpperCase()` en ambos lados. El rescate usó mayúsculas y encontró las facturas registradas en prod, lo que indica una intercalación que no distingue mayúsculas, pero el diseño no depende de eso.
- **D-14 — Literales validados dentro de `runQuery`, sin parámetros de mssql.**
  - `runQuery(query, database)` (`src/utils/SQLServerConnection.js:51`) no acepta parámetros. Parametrizar obligaría a saltarse `runQuery` (y duplicar el `USE [DB]` del pool singleton) o a cambiar una utilidad compartida, que es el pitfall de CLAUDE.md §6.2 y lo prohíbe REQ-24-15.
  - Las regex funcionan como lista blanca: sólo `[0-9A-F-]` para UUID y `[A-ZÑ&0-9]` para RFC. Ninguna comilla, espacio ni `;` llega al SQL.
- **D-15 — Errores del filtro:**
  - Cada consulta va en su propio try/catch.
  - Si falla un bloque CxP, sus UUID quedan como `error-sql` y no se consultan en OC/NC.
  - Si falla un bloque OC/NC, sus UUID quedan como `error-sql`.
  - Si falla la consulta de un RFC, todos los items de ese RFC quedan como `error-sql`.
  - Cada falla escribe una línea `error` con el número de bloque, su tamaño, la tabla y el mensaje.
  - Ante una excepción inesperada fuera de esas consultas, la función devuelve `[]` y registra `error`: no se descarga nada sin verificar, igual que el `catch` externo de hoy.
- **D-16:** Las consultas del filtro van en serie (~10 en el caso actual), sin paralelismo sobre el pool compartido.

### Registro (REQ-24-11, REQ-24-13) — todo en `GetTypesCFDI.log`, formato fijo y fácil de buscar con grep
- **D-17 — Línea de consulta:**
  `[PAGINACION] consulta=<getTypeI|getTypeE|getCfdisByProvider|getPendingToPayInvoices|getTypeP> tenant=<tenantId> total=<n|desconocido> recibidas=<únicos> paginas=<n> ms=<n> pagina_mas_lenta_ms=<n> corte=<completo|pagina-vacia|sin-avance|presupuesto|tope-paginas|pagina-fallida>[ offset_fallido=<n>][ proveedor=<id>]`
  Nivel `info` si recibidas ≥ `total`; `warn` si no. `getPendingToPayInvoices` también la emite.
- **D-18 — Línea de filtro:**
  `[FILTRO-SAGE] consulta=<getTypeI|getTypeE> tenant=<tenantId> recibidas=<n> ya_en_sage=<n> sin_rfc=<n> invalidas=<n> error_sql=<n> a_descargar=<n> ms=<n>`
  Nivel `info`; `warn` si `invalidas + error_sql > 0`.
- **D-19 — Línea por factura**, sólo para cuatro resultados:
  `[FILTRO-SAGE] consulta=<...> UUID=<uuid> id=<portalId> resultado=<a-descargar|sin-rfc|invalida|error-sql>[ detalle=<...>]`
  - Nivel: `info` para `a-descargar` y `sin-rfc`; `warn` para `invalida`; `error` para `error-sql`.
  - Las facturas que ya están en Sage no tienen línea propia; sólo suman en el contador.
  - Los valores crudos del portal que se registran (UUID o RFC inválidos) pasan por `JSON.stringify(String(v).slice(0, 64))`, para que no puedan meter saltos de línea ni caracteres de control en el log (log injection).
- **D-20:** Se eliminan los `console.log` por factura de `getTypeI`/`getTypeE`. Se conservan las líneas `[START]` existentes.
- **D-21 — `getTypeP`:** su lógica por item y sus `console.log` quedan intactos (REQ-24-13, misma salida). Sólo agrega su línea `[PAGINACION] ... paginas=1`: con `corte=completo` si recibidas = `total`, o en `warn` con `corte=sin-paginar` si no.

### Pruebas
- **D-22 — Archivos nuevos (actualizada al planear, 08-oct):** `tests/helpers/getTypesCfdiFakes.js` (modelo del portal y de la base, compartido) y una suite por ola: `tests/utils/GetTypesCFDI.paginacion.test.js` (24-01) y `tests/utils/GetTypesCFDI.filtro.test.js` (24-02). Las dos usan el patrón S-9 de `tests/utils/GetProviders.test.js` y el mismo mock que modela la base (D-23). Sustituyen al único `tests/utils/GetTypesCFDI.test.js` que se había previsto: así cada ola commitea y prueba en negativo (D-25) su propia suite sin reabrir la del otro plan. Cada suite mockea:
  - `../../src/config`: `portal.url`, `portal.tenants` con `id/key/secret/database`, y `schedule.stepTimeoutMs`;
  - `../../src/utils/PortalClient` (`get`);
  - `../../src/utils/LogGenerator` (`logGenerator`);
  - `../../src/utils/SQLServerConnection` (`runQuery`);
  - `../../src/utils/TimezoneHelper` (`getOneMonthAgoString`).

  Ningún test existente cambia.
- **D-23 — El mock de `runQuery` MODELA la base.** Es la lección de la fase 23-04: un mock que no puede producir el estado real esconde bugs.
  - Dataset falso: `{ rfcs, cxp, oc, nc }`.
  - Detecta la tabla por el texto del SQL (`fesaParam`, `APIBHO`, `POINVHO`, `POCRNHO`) y extrae los literales del `IN` o del `=`.
  - Emula una intercalación que no distingue mayúsculas y responde con el formato real (`{ recordset: [...] }`).
  - Registra cada `(sql, db)`, para las aserciones de conteo de consultas, `db` explícito y literales.
- **D-24 — Paridad (REQ-24-07).** El oráculo es una copia congelada, dentro del test, de la decisión por factura de hoy: se conserva si el RFC está registrado y la factura no está en CxP ni en OC/NC. Se evalúa contra el mismo dataset, y la salida nueva tiene que ser idéntica.
- **D-25 — Prueba negativa obligatoria** (práctica fijada en la fase 23). Antes de cerrar, se corre la suite nueva contra el `GetTypesCFDI.js` de `origin/master` y se confirma que fallan los casos de paginación, de conteo de SQL, de presupuesto y de validación. Un test que no puede fallar no prueba nada. El resultado se registra en el SUMMARY.
- **D-26 — Línea base.** Se corre `npm test` en esta rama **antes** de tocar `src/` y se registra el conjunto real de fallos (al 07-oct eran 7 tests en 6 suites). Al final se vuelve a correr y debe dar el mismo conjunto.

### Verificación en vivo y en `zcl-rds-test`
- **D-27 — Comprobación en vivo de `providerId` y `hideValidations`** (REQ-24-12, REQ-24-14): **hecha el 08-oct en producción, sólo lectura; las dos salieron OK** (detalle en `<specifics>`).
  - Herramienta: `data-sageconnect/casos/medir-carga-historica.sh` con `SOLO_PARAMETROS=1`, fuera del repo. No se agregó nada a `src/scripts/` (REQ-24-15).
  - Respeta las trampas del servidor: se guarda en el Escritorio y se niega a correr dentro del dist; se limpia con `sed -i 's/\r$//; 1s/^\xEF\xBB\xBF//'`; usa `node.exe < /dev/null`; nada de `node -e` en línea.
  - No hace falta repetirla en `zcl-rds-test`. Se vuelve a correr sólo si el portal cambia de versión o antes de un despliegue que dependa de esos parámetros.
- **D-28:** No aplicó: las dos comprobaciones salieron OK y la corrección usa ambos parámetros. Si una corrida futura del mismo script diera "NO USARLO", se quita ese parámetro (cambio de una línea); la corrección no depende de ninguno de los dos.
- **D-29 — Despliegue a `zcl-rds-test`:**
  1. `git push -u origin feat/paginar-descarga-cfdi`; no dispara la CI.
  2. `gh workflow run obfuscate-deploy.yml --ref feat/paginar-descarga-cfdi`, y confirmar que el log dice `(branch: feat/paginar-descarga-cfdi)`.
  3. En el servidor (Git Bash, `/e/sageconnect-dist`): `git fetch origin` y `git checkout -B feat/paginar-descarga-cfdi origin/feat/paginar-descarga-cfdi`.
  4. `servy-cli restart --name=SageConnect` y `Invoke-RestMethod http://localhost:3030/api/system/health`.

  En test los logs de aplicación están en `E:\sageconnect-dist\logs` (no en `C:\Logs`). **Push, workflow y reinicio son acciones externas: requieren OK de Yahir en el momento.** `master` sigue congelado: no se fusiona nada a `master` en esta fase.

### Commits
- **D-30:** Commits atómicos.
  - `feat(24): ...` y `test(24): ...` van **sin** `Co-Authored-By` (HANDOFF.md §8).
  - `docs(24): ...` de planeación van con él.
  - Sin trailer de Notion: Yahir pidió no usar Notion en esta fase.
  - Antes de cada commit, el grep de redacción de HANDOFF.md §1 (el comando está en ese archivo; no se copia aquí porque su patrón contiene el nombre que la regla prohíbe escribir en `.planning/`).
  - El ejecutor debe recibir estas reglas por escrito en su prompt.

### Decisiones agregadas al planear (08-oct)
- **D-31 — `getCfdisByProvider` con `providerId` vacío devuelve `[]` sin consultar el portal** (también con `null`, `undefined` o sólo espacios) y escribe una línea `warn`: `[PAGINACION-OMITIDA] consulta=getCfdisByProvider tenant=<tenantId> motivo=proveedor-vacio`.
  - Es un hueco que el SPEC no cubría. El único llamador en `src/`, `UuidResolver.resolveUuidByFolio` (`UuidResolver.js:20`), recibe el `providerId` que arma `PortalPaymentController.js:233` (`hdr.PROVIDERID ? hdr.PROVIDERID.trim() : ''`), así que puede llegar `''`.
  - Para ese llamador el resultado es el mismo que hoy: la petición actual filtra por `provider_id === ''` y no encuentra nada.
  - Evita que, ya paginada y sin el parámetro `providerId`, recorra toda la lista de pendientes (5 páginas hoy) por cada factura pagada sin UUID.

### Claude's Discretion
- Nombres exactos de funciones internas y variables; si `requestPendingToPayPage` se generaliza o se sustituye.
- **División en planes (sugerencia).** Todos tocan el mismo archivo, así que van en olas secuenciales:
  - 24-01: paginación compartida + `getPendingToPayInvoices` + línea de `getTypeP` + sus tests;
  - 24-02: filtro en bloque + `getTypeI`/`getTypeE`/`getCfdisByProvider` + registro + tests de paridad;
  - 24-03: verificación (línea base de `npm test` y prueba negativa, ciclo en `zcl-rds-test`), con puntos de control humanos. Las comprobaciones en vivo de los parámetros ya se hicieron (D-27).
- Texto exacto del campo `detalle=` y de los mensajes de error.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos y caso
- `.planning/phases/24-paginar-descarga-cfdi/24-SPEC.md` — Locked requirements — MUST read before planning.
- `data-sageconnect/handoffs/2026-10-08-paginacion-descarga.md` — caso completo, causa raíz verificada, decisiones de diseño D1-D12, detalle técnico (§5) y pruebas mínimas (§7). Archivo local, fuera de git.
- `data-sageconnect/evidencia/2026-07-17-forresponse.log` — duraciones reales de los 7 pasos (16-17 jul), base del presupuesto de 5 min.
- `data-sageconnect/handoffs/2026-10-08-paginacion-descarga.md` § "Medición real de OCTUBRE en producción" — tiempos del 07 y 08-oct (resumidos en `<specifics>`).
- `data-sageconnect/casos/panorama-rezago.sh` — script de sólo lectura que midió la línea base de octubre; se reutiliza para medir antes y después del despliegue.
- `data-sageconnect/casos/medir-carga-historica.sh` — script de sólo lectura: ciclos e importador por día con cobertura de logs, costo de paginar (ventana de hoy, de fin de mes y volumen) y la verificación de `hideValidations`/`providerId` (`SOLO_PARAMETROS=1`). Reportes en el servidor: `C:\Users\ydiaz\medir-carga-*.txt`.

### API del portal
- `.planning/codebase/swagger-spec-raw.json` — `GET /api/1.0/extern/tenants/{tenantId}/cfdis`: parámetros `pageSize` (obligatorio), `offset` (obligatorio), `from`, `to`, `providerId`, `hideValidations`, `cfdiType`, `stage`, `documentTypes`; respuesta `CfdisExternResponse` = `{ items: CfdiExternResponse[], total: int64 }`.

### Implementación probada en producción (referencia, no se copia tal cual)
- `data-sageconnect/casos/recuperar-facturas-fuera-de-tope.sh` L102-142 — `pendientesPaginadas` y `filtrosSage` (paginación y filtro en bloque que funcionaron en prod el 05 y el 07-oct).
- `data-sageconnect/casos/diagnostico-descarga-facturas.sh` — patrón del script `.sh` de sólo lectura para el servidor (D-27).

### Código que cambia o se consume
- `src/utils/GetTypesCFDI.js` — todo el archivo: `getTypeP` L15-115, `getTypeI` L117-192, `getTypeIToSend` L195-301 (no se toca), `getTypeE` L303-388, `getCfdisByProvider` L397-427, `isRetryablePortalError` L440, `requestPendingToPayPage` L453-487, `getPendingToPayInvoices` L489-559. Los accesos sin protección `item.cfdi.receptor.rfc` (L145) e `item.cfdi.timbre.uuid` (L330) quedan fuera del `try` por factura.
- `src/controller/CFDI_Downloader.js` L64-95 — campos que consume: `id`, `metadata.provider_id`, `metadata.additional_info`, `metadata.additional_amount`, `cfdi.receptor.rfc`.
- `src/services/UuidResolver.js` L18-40 — consumidor de `getCfdisByProvider` (usa `cfdi.folio`, `cfdi.serie`, `cfdi.timbre.uuid`).
- `src/controller/PortalPaymentController.js` L229-240 — una llamada al auto-fix por factura pagada sin UUID; `providerId` = campo opcional `PROVIDERID` de `APVENO` (ID del portal).
- `src/controller/SagePaymentController.js` L34 — consumidor de `getTypeP`.
- `src/utils/SQLServerConnection.js` L51-56 — `runQuery(query, database)`: sin parámetros, antepone `USE [database]`.
- `src/utils/PortalClient.js` — axios singleton con timeout de 30 s.
- `src/config.js` L172-208 — `schedule.stepTimeoutMs` (L181) y los guards de rango de los timeouts.

### Pruebas
- `tests/utils/GetProviders.test.js` — patrón S-9 (mock de config, `PortalClient`, `LogGenerator`, `TimezoneHelper`).
- `tests/PaymentReconciliation.test.js` L26 y `tests/api/payment-routes.test.js` L131 — mockean `GetTypesCFDI` entero; no deben cambiar de resultado.
- `jest.config.js` — `testMatch: tests/**/*.test.js`; `ResolveUuidByFolio.test.js` está excluido (es un script manual).

### Reglas del proyecto
- `CLAUDE.md` §3 (always-on), §5 (convenciones de log), §6 (pitfalls SQL y `runQuery`), §9 (invariante de timeouts).
- `HANDOFF.md` §1 (redacción), §6 (sin base local: SQL validado por estructura y con mocks), §8 (higiene de commits).
- `.planning/STATE.md` — decisiones de la fase 23-04: prueba negativa obligatoria y mocks que modelan el estado real.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `isRetryablePortalError(error)` — clasificación de errores reintentables (429/502/503/504 + errores de red); se reutiliza sin cambios.
- `requestPendingToPayPage` + `getPendingToPayInvoices` — base de la función de paginación general (reintento con espera creciente, corte por `total`/página vacía, dedupe).
- `portalClient.get` — singleton con timeout de 30 s; todas las peticiones pasan por ahí.
- `runQuery(query, db)` — pool singleton con `USE [db]`; `db` siempre explícito.
- `logGenerator(LOG_FILE, level, msg)` — winston por archivo y por día; sólo transporte a archivo (no escribe en consola).
- `config.schedule.stepTimeoutMs` — base del presupuesto de listado.

### Established Patterns
- `const config = require('../config')`; nunca `dotenv` directo.
- `logFileName = 'GetTypesCFDI'` en cada función (se mantiene el archivo de log).
- Funciones que reciben el índice del tenant `index` y leen `tenantIds/apiKeys/apiSecrets/databases[index]` (arreglos de módulo, ya existentes).
- Tests: `jest.mock` de módulos con factory + `require` dentro del test; aserciones sobre el texto fuente sólo cuando el comportamiento no se puede observar.

### Integration Points
- `CFDI_Downloader.downloadCFDI` desestructura `{ getTypeE, getTypeI }` al cargar el módulo; lo devuelto debe conservar la forma de los items del portal.
- `UuidResolver.resolveUuidByFolio` espera un arreglo (vacío si no encuentra).
- `hideValidations=true` sólo recorta `metadata.validations` (verificado en producción); ningún archivo de `src/` lee ese nodo.
- Los scripts `payment-reconciliation.js` y `pending-payments-diagnostic.js`, y `payment-routes.js` (que carga el primero), esperan de `getPendingToPayInvoices` un arreglo completo o `[]`.

</code_context>

<specifics>
## Specific Ideas

### Línea base medida en producción (08-oct-2026, sólo lectura)

Fuentes: `data-sageconnect/casos/panorama-rezago.sh` (11:25) y `data-sageconnect/casos/medir-carga-historica.sh` (11:55, 12:02 y 12:11). Cobertura de logs completa: 31 de 31 días de agosto, 30 de 30 de septiembre y 8 de 8 de octubre.

**Ciclos por mes** (`ForResponse.log`; límite por paso: 5 min):

| Mes | Ciclos | Ciclo prom / máx | downloadCFDI prom / máx | checkPayments prom / máx | `[TIMEOUT]` (en downloadCFDI) | Ciclos abortados |
|---|---|---|---|---|---|---|
| Agosto | 2,973 | 6m31s / 11m46s | 3m07s / 5m00s | 2m37s / 4m58s | 100 (91) | 104 |
| Septiembre | 2,878 | 4m23s / 10m26s | 1m47s / 4m54s | 1m50s / 4m39s | 20 (15) | 20 |
| Octubre (1-8) | 721 | 2m24s / 3m52s | 0m33s / 1m17s | 1m09s / 1m58s | 0 | 1 |

- Los peores días fueron del 18 al 21-ago, con 5, 12, 14 y 12 timeouts por día; la descarga tocó 4m58s-5m00s. Un ciclo abortado se salta los pagos y las OCs de ese ciclo.
- **No fue por más facturas.** El importador metió contra OC 38.2 facturas por día con log en agosto (1,184, más 119 a CxP), 44.2 en septiembre (1,325 + 119) y 43.8 en octubre (350 + 69). Lo que cambió fue el costo de cada consulta SQL: con el mismo trabajo por ciclo (≤ 200 facturas más las notas de crédito, 3 consultas por factura, ~860 consultas), downloadCFDI bajó de ~3 min a ~45 s el 19-sep y a ~33 s el 25-sep. La causa del cambio no está identificada.
- **Implicación para el diseño** (inferencia con estos datos): a la velocidad de agosto (~0.2 s por consulta), paginar conservando el filtro por factura serían ~2,700 consultas por ciclo, unos 10 min, y el paso de 5 min reventaría en casi todos los ciclos. El filtro en bloque (REQ-24-07, REQ-24-08) hace 11 consultas (1.0-2.8 s medidos) y, con la misma cuenta, habría evitado casi todos los 91 timeouts de downloadCFDI de agosto. No es una optimización opcional.
- checkPayments también llegó cerca del límite en agosto (4m58s el 26-ago): queda como candidato diferido (paginar `getTypeP` y hacer `checkPayments` en bloque). El ciclo más largo (11m46s) dejó ~2 min de margen contra el candado de 14 min.

**Portal** (12:02):

| Consulta | Reporta | Páginas de 200 | Tiempo | Por página (prom / máx) |
|---|---|---|---|---|
| Consulta actual (`pageSize=0`) | 200 de 822 | 1 | 1.3 s | — |
| A. Ventana de hoy: pendientes desde 01-sep | 822 | 5 | 4.2 s | 0.8 / 1.1 s |
| B. Ventana de fin de mes: pendientes desde 01-ago | 969 | 5 | 4.8 s | 0.9 / 1.0 s |
| B2. B con `hideValidations=true` | 969 | 5 | 4.1 s | 0.8 / 1.0 s |
| C. Todas, de cualquier estatus, desde 01-ago (la corrección **nunca** la hace) | 2,828 | 15 | 40.9 s | 2.7 / 5.0 s |

- Filtro en bloque: 11 consultas, 1.2 s (A) y 1.0 s (B).
- Sin registrar en Sage: 5 de 969, las mismas en A y en B, así que todas son recientes (sep-oct) y las toma el ciclo normal. A las 11:25, de las 596 fuera de las 200, 0 estaban sin registrar.
- Presupuesto de 75 s por consulta (D-10): las listas de pendientes tardan ~5 s, así que hay ~16× de margen. Aun con 2,800 pendientes al ritmo de las páginas más pesadas (2.7 s) cabría (~38 s).
- El daño sigue ocurriendo con cada autorización tardía nueva: en la última semana hubo 300 autorizaciones, 61 con más de 14 días de retraso, y **las 61 quedaron fuera de las 200**.

**Verificación en vivo de REQ-24-12 y REQ-24-14: HECHA** (12:02 y 12:11, en producción, sólo lectura; D-27):
- `providerId`: con el proveedor de más pendientes (108 de 822), el portal reporta y entrega 108, ninguna de otro proveedor. Filtra.
- `hideValidations=true`: se comparó la misma página de 50 factura por factura. La única diferencia es `metadata.validations` (el arreglo llega más corto), en las 50. Los 8 campos que usa SageConnect (`id`, `metadata.provider_id`, `metadata.additional_info`, `metadata.additional_amount`, `cfdi.receptor.rfc`, `cfdi.timbre.uuid`, `cfdi.folio`, `cfdi.serie`) llegan con el **mismo valor**, no sólo presentes. La respuesta pesa 60 % menos (1,013,140 → 409,259 bytes por cada 50 facturas): con ~900 facturas por ciclo son ~11 MB menos por ciclo (~1 GB al día) y menos memoria al parsear. Nada en `src/` lee `validations`.

**Criterio después del despliegue** (para la verificación y el reporte al cliente): `[PAGINACION]` reporta recibidas = `total`, y downloadCFDI no tiene `[TIMEOUT]` ni crece más de unos segundos sobre sus ~30 s de octubre. `medir-carga-historica.sh` y `panorama-rezago.sh` miden antes y después.

### Prioridades y peticiones
- Prioridad de Yahir: **que no vuelva a ocurrir**, y la solución más óptima y escalable. Los scripts operativos del servidor se ajustan aparte, sin condicionar el diseño.
- La reunión del 07-oct pidió reportar al cliente con cuántas páginas quedó y cuánto tarda: la línea `[PAGINACION]` da exactamente eso (`paginas`, `ms`, `pagina_mas_lenta_ms`).
- El volumen de log debe crecer con lo que se descarga y con las anomalías, no con el total de pendientes (772 el 07-oct).

</specifics>

<deferred>
## Deferred Ideas

- **Cursor entre ciclos** (reanudar desde la página donde se cortó): sólo si el `warn` de `corte=presupuesto` aparece en operación normal.
- **Parametrizar el SQL** del filtro cuando `runQuery` acepte parámetros (cambio de utilidad compartida, fase propia).
- **SQL sin validar que sigue en `getTypeP` y `getTypeIToSend`** (datos del portal interpolados): fase aparte que reutilice las regex de REQ-24-09; aceptado como riesgo residual documentado en los threat_model T-24-08/T-24-16.
- **Páginas en paralelo:** sólo con evidencia de que el listado en serie no cabe, y con manejo de 429.
- **Correo de alerta** con límite de frecuencia cuando recibidas < `total`.
- **Probar `pageSize` > 200** (optimización).
- **Paginar `getTypeP`** y hacer `checkPayments` en bloque.
- **Robustez de `CFDI_Downloader.js`:** addenda cruzada, `/files` sin try/catch, addenda sin `catch`, re-descarga de facturas de proveedores sin banco y de XML que ya esperan en la carpeta.
- **Operativo:** retirar el rescate diario y ajustar el diagnóstico de descarga a las líneas `[PAGINACION]`/`[FILTRO-SAGE]` (fuera del repo).
- **Botón "Descargar XML pendientes o antiguos"** (segunda entrega acordada).
- **Scripts con `pageSize=0`:** `get-payment-cfdis.js` y `payment-uuid-repair.js`.

</deferred>

---

*Phase: 24-paginar-descarga-cfdi*
*Context gathered: 2026-10-08*
