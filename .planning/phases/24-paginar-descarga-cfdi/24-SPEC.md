# Phase 24: Paginar la descarga de CFDIs (corregir el tope de 200) — Specification

**Created:** 2026-10-08
**Ambiguity score:** 0.09 (gate: ≤ 0.20)
**Requirements:** 15 locked
**Branch:** `feat/paginar-descarga-cfdi` (sale de `origin/master` `dde4bd0`; **nunca** de `master` local, que trae la fase 20 sin publicar)

## Goal

Las consultas de facturas y notas de crédito que alimentan la descarga (`getTypeI`, `getTypeE`) y el auto-fix de UUID (`getCfdisByProvider`) pasan de recibir **como máximo 200** comprobantes a recibir **todos los que el portal reporta en `total`**, con el filtro "ya está en Sage" hecho en bloque (de ~3 consultas SQL por factura a un número fijo por cada 200 UUID), con un tiempo de listado acotado para no reventar el presupuesto de 5 min del paso downloadCFDI, y con una línea de log por consulta que hace visible cualquier diferencia entre `total` y lo recibido.

## Background

**Causa raíz (verificada en producción el 05-oct-2026).** `src/utils/GetTypesCFDI.js` pide al portal `&offset=0&pageSize=0` en `getTypeP` (L25), `getTypeI` (L127), `getTypeE` (L313) y `getCfdisByProvider` (L406). El API pagina por diseño (`{items, total}`, schema `CfdisExternResponse` en `.planning/codebase/swagger-spec-raw.json`; `pageSize` es obligatorio y no existe "0 = todas"). Con `pageSize=0` el portal entrega **200** y reporta en `total` el número real. El código nunca lee `total` ni pide la página siguiente, y no deja rastro del corte.

**Por qué sólo muerde a las autorizadas tarde.** El portal ordena por fecha de emisión, de la más nueva a la más vieja. Una factura entra a PENDING_TO_PAY al autorizarse pero conserva el lugar de su fecha de emisión; si se autoriza con más de ~2 semanas de retraso cae debajo de la posición 200 y nunca baja. Prueba del 05-oct: `total=575`, recibidas 200; pidiendo por páginas de 200 llegaron las 575 y la factura buscada estaba en la posición 512. La hipótesis predijo exactamente cuáles 3 de 19 entraron. Volumen: 575 el 05-oct, **772 el 07-oct**. Complementos de pago: 200 de 244. Notas de crédito: 87 de 87.

**Por qué paginar sólo no alcanza (verificado en logs de producción del 16-17 de julio, 135 ciclos, con el tope vigente).** downloadCFDI: mediana 2m28s, **máximo 4m45s**; el 17-jul 00:50 hubo `[TIMEOUT] step=downloadCFDI ... Step timeout after 5m` **con una sola página**, y el `catch` por tenant (`src/background.js:296`) se saltó pagos y OCs de ese ciclo. Hoy `getTypeI` hace **3 consultas SQL en serie por factura** (RFC en `fesaParam`, CxP en `APIBH/APIBHO`, OC en `POINVH1/POINVHO`): con 772 son ~2,300 viajes a SQL por ciclo. El script de rescate usado en producción el 05 y el 07-oct (`filtrosSage`) filtra en bloque —2 consultas por cada 200 UUID más 1 por RFC distinto— con la misma semántica, y funcionó.

**Lo que existe y se reutiliza.** `requestPendingToPayPage` + `getPendingToPayInvoices` (GetTypesCFDI.js:440-559) ya paginan con reintento ante 429/502/503/504 y errores de red, y deduplican por UUID; hoy sólo los usan scripts (`payment-reconciliation.js`, `pending-payments-diagnostic.js`; el primero también lo carga `payment-routes.js`). Su contrato actual es "todo o nada": ante un error devuelven `[]`.

**Quién consume cada función.**
- `getTypeE` y `getTypeI` ← `CFDI_Downloader.downloadCFDI` (L71, L82) ← paso downloadCFDI de `background.js`. El downloader usa de cada item `id`, `metadata.provider_id`, `metadata.additional_info`, `metadata.additional_amount` y `cfdi.receptor.rfc`.
- `getCfdisByProvider` ← `UuidResolver.resolveUuidByFolio` (L20) ← `PortalPaymentController.js:235`, una llamada por cada factura pagada sin UUID. El `providerId` es el ID del proveedor **en el portal** (campo opcional `PROVIDERID` de `APVENO`). Con el tope, las facturas viejas que se pagan nunca se encuentran y el pago se omite cada ciclo.
- `getTypeP` ← `SagePaymentController.checkPayments` (L34).
- **Herramientas operativas que dependen del comportamiento actual** (fuera del repo, corren en el servidor): el diagnóstico de descarga busca el UUID en el log de consola y cuenta las líneas `conservado`; el rescate sustituye `getTypeE`/`getTypeI` en el objeto exportado del módulo antes de cargar el downloader, y calcula "lo que SageConnect ya ve" con su propia consulta `pageSize=0`.

**Origen de la decisión.** Reunión del 07-oct-2026 con el equipo del cliente: liberar la paginación ya, sin esperar la migración de servidores, y reportar con cuántas páginas quedó y cuánto tarda. Las decisiones técnicas D1-D12 se tomaron el 08-oct (handoff local `data-sageconnect/handoffs/2026-10-08-paginacion-descarga.md`); Yahir delegó en el agente las decisiones técnicas, con la condición de que funcionen, no tengan errores y sean lo más óptimas y escalables posible. D13 y D14 se añadieron al explorar el código para este SPEC (ver Interview Log).

## Requirements

1. **REQ-24-01 — Paginación completa en `getTypeI` y `getTypeE` (D1, D3)**: cada función pide páginas de 200 con `offset` creciente hasta completar el `total` reportado o recibir una página vacía.
   - Current: una sola petición con `offset=0&pageSize=0`; recibe ≤ 200 y descarta el resto sin rastro.
   - Target: con `total=450` se hacen exactamente 3 peticiones (`offset` 0/200/400, `pageSize=200`) y se procesan los 450 items. Una página vacía detiene la paginación aunque no se haya llegado a `total`. Un UUID repetido entre páginas cuenta una sola vez. Existe un tope de páginas como red de seguridad (always-on: todo bucle acotado); alcanzarlo registra `warn`.
   - Acceptance: test con mock de `portalClient.get` — total 450 → 3 llamadas con los offsets esperados y 450 items procesados; 2ª página vacía → 2 llamadas y se detiene; una página que repite un UUID de la anterior no duplica la factura; `total` enorme con páginas siempre llenas → se detiene en el tope y registra `warn`.

2. **REQ-24-02 — Una sola función de paginación, generalizada (D2)**: la paginación vive en una única función parametrizable por los filtros de la consulta (`cfdiType`, `stage`, `from`, `to`, `providerId`, `hideValidations`), derivada de `requestPendingToPayPage`/`getPendingToPayInvoices`. No se crea un segundo bucle de paginación.
   - Current: `getPendingToPayInvoices` pagina sólo `INVOICE` + `PENDING_TO_PAY`; las funciones del ciclo no paginan.
   - Target: `getTypeI`, `getTypeE`, `getCfdisByProvider` y `getPendingToPayInvoices` obtienen sus páginas de la misma función.
   - Acceptance: `grep -n 'pageSize=0' src/utils/GetTypesCFDI.js` sólo encuentra `getTypeP` y `getTypeIToSend`; en el diff, las cuatro funciones llaman a la misma función de paginación y ninguna tiene un bucle de paginación propio.

3. **REQ-24-03 — `getPendingToPayInvoices` conserva su contrato exacto (D14)**: los scripts y rutas que la usan ven el mismo resultado que hoy para las mismas respuestas del portal.
   - Current: devuelve todos los items deduplicados, o `[]` ante cualquier error; opciones `pageSize`, `maxPages` (default 1000), `from`, `to`.
   - Target: idéntico — misma consulta (sin `hideValidations`), mismas opciones y defaults, sin presupuesto de tiempo, y `[]` si una página falla tras los reintentos. El modo "devolver lo recibido" (REQ-24-05) aplica sólo a las funciones del ciclo: un script de conciliación que recibiera una lista parcial podría concluir que una factura no está en el portal.
   - Acceptance: test — la misma secuencia de respuestas mock (éxito completo; fallo persistente en la 2ª página) produce la misma salida que el código actual (`[]` en el caso de fallo) y la URL no lleva `hideValidations`; los tests que la mockean (`PaymentReconciliation.test.js`, `api/payment-routes.test.js`) no cambian de resultado.

4. **REQ-24-04 — Reintento por página (heredado)**: cada página se reintenta ante 429, 502, 503, 504 y errores de red (`ECONNRESET`, `ETIMEDOUT`, `ECONNABORTED`, `ENOTFOUND`, `EAI_AGAIN`), con espera creciente y un máximo de intentos; otros errores no se reintentan.
   - Current: existe en `requestPendingToPayPage` (3 intentos, espera 1.5 s × intento); las funciones del ciclo no reintentan.
   - Target: las funciones del ciclo heredan el mismo reintento.
   - Acceptance: test — un 429 seguido de éxito en la página 2 produce el resultado completo; un 400 no se reintenta.

5. **REQ-24-05 — Fallo parcial: devolver lo recibido (D7)**: en `getTypeI`, `getTypeE` y `getCfdisByProvider`, si una página falla tras los reintentos, la función procesa y devuelve lo ya recibido y registra `warn` con el `offset` que falló.
   - Current: cualquier error devuelve `[]` y el ciclo no descarga nada de ese tipo.
   - Target: lo recibido (las más recientes) sigue su curso; nunca peor que hoy. Si falla la primera página, el resultado es `[]` como hoy.
   - Acceptance: test — total 450, página 3 falla persistentemente → se filtran y devuelven los 400 recibidos y hay una línea `warn` con `offset=400`.

6. **REQ-24-06 — Tiempo de listado acotado (D13)**: cada consulta paginada de `getTypeI`, `getTypeE` y `getCfdisByProvider` deja de pedir páginas nuevas (y de reintentar) cuando su tiempo transcurrido supera un presupuesto derivado de `config.schedule.stepTimeoutMs`, sin variable nueva en el `.env`; en ese caso devuelve lo recibido y registra un `warn` que dice explícitamente que se agotó el presupuesto. No aplica a `getPendingToPayInvoices` (REQ-24-03).
   - Current: no aplica (una sola petición, ≤ 30 s por el timeout de axios).
   - Target: el presupuesto por consulta es como máximo **25 % de `stepTimeoutMs`** (75 s con el default de 5 min). Peor caso: `getTypeE` + `getTypeI` en el mismo paso no consumen más de 2 × (presupuesto + 30 s de una petición en vuelo) = 210 s de los 300 s del paso. Sin el presupuesto, 4 páginas × 3 intentos × 30 s rebasarían el paso. Es una válvula para cuando el portal está enfermo: en operación normal no debe dispararse. Si se disparara ciclo tras ciclo, las últimas páginas —justo las autorizadas tarde— nunca llegarían; por eso su `warn` es distinguible y se vigila después de desplegar. Se preserva la invariante `axios (30s) < paso (5m) < hijo (10m) < candado (14m)`.
   - Acceptance: test con reloj simulado — una vez superado el presupuesto no se emite ninguna petición nueva ni ningún reintento, el resultado contiene lo recibido y hay una línea `warn` de presupuesto agotado; `src/config.js` y `.env.example` sin cambios.

7. **REQ-24-07 — Filtro "ya está en Sage" en bloque, misma semántica (D4)**: para toda factura con UUID y RFC válidos (REQ-24-09), el filtro de `getTypeI` y `getTypeE` decide, para el mismo estado de la base, exactamente lo mismo que el filtro por factura actual.
   - Current: por cada factura, en serie: RFC receptor en `fesaParam` (`Parametro='RFCReceptor'`, db `'FESA'`); CxP en `APIBH/APIBHO` con `ERRENTRY = 0` y `OPTFIELD='FOLIOCFD'`; y luego OC en `POINVH1/POINVHO` (facturas) o NC en `POCRNH1/POCRNHO` (notas de crédito), ambos con `OPTFIELD='FOLIOCFD'`, contra `databases[index]`.
   - Target: se conserva una factura sólo si su RFC receptor está registrado **y** su UUID no aparece en CxP **ni** en OC (facturas) / NC (notas de crédito). Las consultas van en bloques de hasta 200 UUID con `IN`; el RFC se consulta una vez por RFC distinto. El `IN` incluye cada UUID recortado tal como lo entregó el portal, de modo que encuentra —con cualquier intercalación de la base— toda fila que encontraría el `=` actual; la comparación en JS es insensible a mayúsculas y espacios (`toUpperCase().trim()`).
   - Acceptance: test de paridad — un conjunto fijo de items y de filas mock (UUID en CxP, en OC, en NC, en dos tablas, en ninguna; RFC registrado y no registrado; UUID en minúsculas en el portal y en mayúsculas en Sage) produce la misma lista de salida que el filtro por factura actual; las cadenas SQL contienen cada UUID tal como vino del portal.

8. **REQ-24-08 — Consultas SQL acotadas**: el número de consultas SQL del filtro depende del número de bloques y de RFC distintos, no del número de facturas.
   - Current: 3 consultas por factura (~2,300 con 772 facturas).
   - Target: por llamada a `getTypeI`/`getTypeE`, como máximo `2 × ceil(U / 200) + R` consultas, con `U` = UUID válidos distintos y `R` = RFC válidos distintos (p. ej. 772 UUID y 2 RFC → ≤ 10).
   - Acceptance: test — 450 items con 2 RFC distintos → `runQuery` se llama **como máximo** 8 veces; cada llamada lleva `db` explícito (`'FESA'` para RFC, `databases[index]` para el resto — CLAUDE.md §6.2).

9. **REQ-24-09 — Sólo valores validados entran a SQL (D5, CLAUDE.md §6.1)**: un UUID entra a un `IN` sólo si, recortado, cumple `^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$` (insensible a mayúsculas), y un RFC sólo si, recortado, cumple `^[A-ZÑ&0-9]{12,13}$` (insensible a mayúsculas). Una factura sin UUID, sin RFC, o con alguno que no pasa, se omite, se registra y se cuenta como inválida, sin afectar a las demás.
   - Current: UUID y RFC se interpolan sin validar en cada consulta (sitios de inyección existentes). Además, un item sin `cfdi.receptor` (o, en `getTypeE`, sin `cfdi.timbre`) lanza fuera del `try` por factura (GetTypesCFDI.js:145 y :330) y hace que **toda** la consulta devuelva `[]`.
   - Target: ninguna cadena del portal llega a SQL sin pasar su regex; no se abre ningún sitio nuevo de inyección; un item malformado sólo se omite a sí mismo. Cambio deliberado: hoy un item sin UUID en `getTypeI` pasaría el filtro (se compara contra `'undefined'`) y se intentaría descargar; ahora se omite.
   - Acceptance: test — items con UUID `x' OR 1=1--` y RFC `ABC';DROP` no aparecen en ninguna cadena pasada a `runQuery`, no se devuelven y se cuentan como inválidos; un item sin `cfdi.receptor` y otro sin `cfdi.timbre` se omiten y las demás facturas del lote siguen su curso.

10. **REQ-24-10 — Error en un bloque SQL omite sólo ese bloque (D6)**: si la consulta de un bloque falla, las facturas de ese bloque se omiten en este ciclo (no se descargan sin verificar) y se registra `error`; los demás bloques siguen. Si falla la consulta de un RFC, se omiten las facturas de ese RFC.
    - Current: un error SQL omite esa factura y sigue con la siguiente.
    - Target: misma idea a nivel de bloque.
    - Acceptance: test — 450 items, falla la consulta CxP del bloque 2 → se devuelven sólo las conservadas de los bloques 1 y 3, y hay una línea `error` que nombra el bloque.

11. **REQ-24-11 — Registro: el corte visible y cada factura rastreable (D9)**: (a) cada consulta paginada escribe en `GetTypesCFDI.log` una línea resumen con tipo de consulta, tenant, `total` reportado, recibidas, páginas y ms, de nivel `warn` si recibidas < `total`; (b) cada filtro escribe una línea resumen con ya en Sage / sin RFCReceptor / inválidas / omitidas por error SQL / a descargar / ms; (c) cada factura distinta recibida produce exactamente una línea por factura con su resultado, y las líneas que existen hoy conservan su texto y su canal.
    - Current: no se registra `total` ni recibidas: el corte es invisible. Por factura, en consola: `[OK] UUID <uuid> conservado`, `... eliminado por ser ya timbrado`, `... eliminado por existir en Sage OC (...)` / `NC (...)`, y `... eliminado por falta de RFCReceptor en fesa` (ésta también en `GetTypesCFDI.log`). El diagnóstico de descarga que se corre en el servidor busca el UUID en el log de consola y cuenta las líneas `conservado`.
    - Target: se agregan las dos líneas resumen. Las líneas por factura se conservan con el mismo texto y la misma precedencia de motivo que hoy (RFC → CxP → OC/NC), y se agregan dos motivos nuevos: inválida y omitida por error SQL. El log de consola crece en proporción a lo recibido (~4× con 772 pendientes); se acepta porque es la evidencia que usa el diagnóstico.
    - Acceptance: test — con total 450 y recibidas 450 hay una línea `info` de consulta con `total=450 recibidas=450 paginas=3` y una de filtro con sus cinco contadores; con 400 de 450 la de consulta es `warn`; cada uno de los UUID recibidos aparece en exactamente una línea por factura; una factura que está en CxP y en OC dice `eliminado por ser ya timbrado` (misma precedencia que hoy).

12. **REQ-24-12 — `getCfdisByProvider` paginado y con filtro en el portal (D10)**: la consulta manda `providerId` (codificado para URL) al portal, pagina igual que REQ-24-01 y conserva el filtro local por `metadata.provider_id` como red de seguridad.
    - Current: pide ≤ 200 facturas de todos los proveedores y filtra en JS; las facturas fuera de las 200 nunca se encuentran.
    - Target: la URL incluye `providerId=<id>`; el resultado sólo contiene items con `metadata.provider_id === providerId` aunque el portal ignorara el parámetro. Si en la verificación en vivo el portal rechazara `providerId`, se quita el parámetro y queda sólo el filtro local: la paginación sigue dando el resultado correcto, sólo más lento.
    - Acceptance: test — la URL pedida contiene `providerId=`; con un mock que devuelve items de dos proveedores, sólo regresan los del pedido. Verificado en vivo contra el sandbox (consulta de sólo lectura): el portal acepta `providerId` (HTTP 200) y `total` corresponde sólo a ese proveedor.

13. **REQ-24-13 — `getTypeP`: sólo la línea de log (D11)**: `getTypeP` registra `total` reportado vs recibidas (`warn` si recibidas < `total`), sin paginar y sin cambiar lo que devuelve.
    - Current: no registra el corte (200 de 244 el 05-oct).
    - Target: misma consulta, misma salida, más una línea de log.
    - Acceptance: test — con `total=244` y 200 items la salida es la misma que hoy y hay una línea `warn` con `total=244 recibidas=200`; la URL sigue con `offset=0&pageSize=0`.

14. **REQ-24-14 — `hideValidations=true` sin perder campos (D8)**: las consultas paginadas de `getTypeI`, `getTypeE` y `getCfdisByProvider` mandan `hideValidations=true`, y cada item sigue trayendo `id`, `metadata.provider_id`, `metadata.additional_info`, `metadata.additional_amount`, `cfdi.receptor.rfc`, `cfdi.timbre.uuid` (y `cfdi.folio`/`cfdi.serie` para `getCfdisByProvider`).
    - Current: el nodo de validaciones viaja en cada item sin que nadie lo use.
    - Target: respuestas más ligeras con los mismos campos consumidos. Es una optimización, no parte de la corrección: si la verificación en vivo muestra que falta cualquiera de esos campos, se quita el parámetro.
    - Acceptance: test — la URL contiene `hideValidations=true`. Verificado en vivo contra el sandbox (consulta de sólo lectura): la única diferencia entre la respuesta con y sin `hideValidations=true` es la ausencia del nodo de validaciones.

15. **REQ-24-15 — Alcance de código y regresión**: la fase sólo modifica `src/utils/GetTypesCFDI.js` y agrega tests; la API exportada (nombres, firmas y forma de lo que devuelve) no cambia y sigue siendo un objeto de funciones sustituibles (el rescate reemplaza `getTypeE`/`getTypeI` antes de cargar el downloader).
    - Current: —
    - Target: `CFDI_Downloader.js`, `background.js`, `UuidResolver.js`, `SagePaymentController.js`, `PortalPaymentController.js`, `config.js`, `.env.example` y `getTypeIToSend` sin cambios. `npm test` reporta los mismos fallos que la línea base —7 tests en 6 suites al 07-oct; **se mide de nuevo en esta rama antes de tocar código**— y todos los tests nuevos pasan.
    - Acceptance: `git diff origin/master...HEAD --stat -- src/` muestra sólo `src/utils/GetTypesCFDI.js`; `npm test` antes y después con el mismo conjunto de fallos; ningún fallo nuevo.

## Boundaries

**In scope:**
- Paginación completa en `getTypeI`, `getTypeE` y `getCfdisByProvider`, con una sola función de paginación compartida también por `getPendingToPayInvoices` (cuyo contrato no cambia).
- Reintento por página, devolución parcial ante fallo y presupuesto de tiempo del listado.
- Filtro "ya está en Sage" en bloque con la misma semántica, con validación estricta de UUID y RFC antes de SQL.
- Líneas de log resumen por consulta y por filtro, una línea por factura con su resultado, y la línea de corte en `getTypeP`.
- `providerId` y filtro local en `getCfdisByProvider`; `hideValidations=true` en las consultas paginadas.
- Suite Jest nueva con mocks de `PortalClient.get` y `runQuery` que ejercite la lógica real.
- Verificación sin regresión en `zcl-rds-test` (una página: el sandbox tiene pocas facturas) y verificación en vivo de `providerId` y `hideValidations`.

**Out of scope:**
- Botón "Descargar XML pendientes o antiguos" — acordado en la reunión como segunda entrega; fase propia.
- Cambiar la ventana de fechas (`from` = día 1 del mes anterior) — lo antiguo va por el botón.
- Paginar `getTypeP` y optimizar `checkPayments` — es el paso más pesado (máx 4m17s) y necesita su propia optimización.
- Probar `pageSize` > 200 — el corte de 200 del portal está comprobado y la paginación funciona con cualquier tamaño de página; subirlo sería sólo una optimización.
- Robustez de `CFDI_Downloader.js` (addenda cruzada L113-130, `/files` sin try/catch por factura L107, addenda sin `catch`, re-descarga de XML que ya esperan en la carpeta y de facturas de proveedores sin banco) — bugs preexistentes que esta fase no empeora; tocarlos agranda el riesgo del despliegue.
- `background.js`, `getTypeIToSend` (código muerto) y los scripts con `pageSize=0` (`get-payment-cfdis.js`, `payment-uuid-repair.js`).
- Bugs de logs ajenos (`payment-reconciliation.js` que reemplaza `console.log` global; `WARN` repetido de `PortalOC_Closer`).
- Correo de alerta cuando recibidas < `total` — se dispararía cada 15 min y necesitaría throttling; el `warn` del log basta en esta fase.
- Adaptar los scripts operativos del servidor (diagnóstico y rescate) — viven fuera del repo; esta fase sólo garantiza no romperlos (REQ-24-11, REQ-24-15).
- Desplegar a producción — decisión de Yahir y del responsable técnico, con su propia puerta (ver Constraints).

## Constraints

- **Sin variable nueva en el `.env`** (D3): `pageSize=200` fijo; el presupuesto de tiempo se deriva de `config.schedule.stepTimeoutMs`.
- **Invariante de timeouts intacta:** `axios (30s) < paso (5m) < hijo (10m) < candado (14m)`; ninguno se modifica.
- **Always-on (CLAUDE.md §3):** nada de estado nuevo a nivel de módulo (caches, `Map`, timers); los únicos `setTimeout` son las esperas de reintento, que terminan solas y no se crean después de agotado el presupuesto.
- **SQL (CLAUDE.md §6.1 y §6.2):** cero sitios nuevos de inyección; los `IN` sólo con valores que pasaron su regex; `db` explícito en cada `runQuery`. No hay base local (HANDOFF.md §6): la lógica se prueba con mocks y las consultas reales se ejercitan en `zcl-rds-test`.
- **Datos del portal cambiando entre páginas:** si una factura cambia de estado entre dos peticiones, el `offset` puede repetir o saltar un item. La deduplicación por UUID cubre la repetición; un salto se corrige en el ciclo siguiente (15 min). Se acepta.
- **Orden de builds:** `master` está congelado hasta que producción tenga el build del botón (`0785a9a`); esta corrección sale después como build aparte.
- **Puerta de despliegue (no es código, pero condiciona liberar):**
  - Antes: correr la simulación del rescate para listar lo que el primer ciclo paginado descargará (pendientes fuera de las 200 y sin UUID en Sage) y revisarla con el cliente: están capturando facturas a mano, y las que no tengan el UUID en `FOLIOCFD` se volverían a bajar (si van sin OC, el importador las duplica en CxP). Anotar el SHA del dist antes del `reset` para poder revertir.
  - Después: dejar de correr el rescate diario —su noción de "lo que SageConnect ya ve" asume el tope de 200 y listaría facturas que SageConnect ya descarga—; revisar las líneas nuevas (total vs recibidas, páginas, ms, a descargar), la duración del paso downloadCFDI en `ForResponse.log` y que no haya `[TIMEOUT]` ni `warn` de presupuesto agotado.
- **Riesgos residuales aceptados (se miden con el log nuevo):** el primer ciclo paginado puede bajar un rezago grande y rozar el límite de 5 min hasta que el importador lo absorba (converge en pocos ciclos); y el número "a descargar" por ciclo incluye facturas de proveedores sin banco que el downloader baja y borra en cada ciclo (bug preexistente, fuera de alcance), que con la paginación pueden ser más. Si ese número pone en riesgo el paso, se abre la fase de robustez del downloader.
- **Redacción (HANDOFF.md §1 y §8):** sin nombre del integrador anterior ni nombres de personas del cliente en `.planning/`, `src/`, commits ni PRs; `Co-Authored-By` sólo en commits `docs:`/`chore:`/`spec:` de planeación, nunca en `feat:`/`fix:`/`test:`/`refactor:`.

## Acceptance Criteria

- [ ] `getTypeI` y `getTypeE` con `total=450` hacen 3 peticiones (`offset` 0/200/400, `pageSize=200`) y procesan los 450 items.
- [ ] Una página vacía detiene la paginación; un UUID repetido entre páginas cuenta una vez; el tope de páginas detiene un bucle anómalo y registra `warn`.
- [ ] `pageSize=0` sólo queda en `getTypeP` y `getTypeIToSend`; las cuatro funciones paginadas usan la misma función de paginación.
- [ ] `getPendingToPayInvoices` devuelve lo mismo que hoy para las mismas respuestas, incluido `[]` si falla una página, y su URL no lleva `hideValidations`.
- [ ] Un 429 seguido de éxito completa la consulta; un 400 no se reintenta.
- [ ] Con la página 3 fallando, `getTypeI` devuelve lo filtrado de las 400 recibidas y registra `warn` con `offset=400`.
- [ ] Superado el presupuesto de tiempo (≤ 25 % de `stepTimeoutMs`) no sale ninguna petición ni reintento nuevo, y hay un `warn` de presupuesto agotado.
- [ ] El test de paridad del filtro produce la misma salida que el filtro por factura actual, incluido el caso de mayúsculas/minúsculas, y el SQL lleva cada UUID tal como vino del portal.
- [ ] 450 items con 2 RFC → como máximo 8 llamadas a `runQuery`, cada una con `db` explícito.
- [ ] UUID y RFC malformados no aparecen en ninguna cadena SQL y se cuentan como inválidos; un item sin `cfdi.receptor` o sin `cfdi.timbre` no tumba la consulta.
- [ ] Un error SQL en un bloque omite sólo ese bloque y registra `error`.
- [ ] Cada consulta escribe una línea con `total`, recibidas, páginas y ms (`warn` si recibidas < `total`); cada filtro, una línea con sus cinco contadores; cada factura recibida, exactamente una línea con su resultado y el texto de hoy.
- [ ] `getCfdisByProvider` manda `providerId` y conserva el filtro local por `metadata.provider_id`.
- [ ] `getTypeP` devuelve lo mismo que hoy y registra `warn` con `total=244 recibidas=200` en el caso de prueba.
- [ ] Las consultas paginadas del ciclo mandan `hideValidations=true`.
- [ ] Verificado en vivo contra el sandbox (sólo lectura): `providerId` aceptado y filtra; con `hideValidations=true` sólo desaparece el nodo de validaciones.
- [ ] `git diff origin/master...HEAD --stat -- src/` muestra sólo `src/utils/GetTypesCFDI.js`; `config.js` y `.env.example` sin cambios.
- [ ] `npm test`: mismo conjunto de fallos que la línea base medida en esta rama y todos los tests nuevos en verde.
- [ ] En `zcl-rds-test`, un ciclo completo corre sin `[TIMEOUT]`, sin `error` del filtro (las consultas en bloque corren contra el esquema real de Sage) y sin `warn` de presupuesto agotado; aparecen las líneas nuevas y los XML descargados llevan la addenda completa.

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes |
|--------------------|-------|------|--------|-------|
| Goal Clarity       | 0.92  | 0.75 | ✓      | Causa raíz verificada en prod; objetivo medible (recibidas = `total`) |
| Boundary Clarity   | 0.92  | 0.70 | ✓      | Alcance limitado a un archivo; lista explícita de lo que no se toca y por qué |
| Constraint Clarity | 0.88  | 0.65 | ✓      | Presupuesto de 5 min medido en julio; octubre sin medir (se mide con el log nuevo); riesgos residuales nombrados |
| Acceptance Criteria| 0.90  | 0.70 | ✓      | 19 criterios pasa/falla; las varias páginas se prueban con mocks, no en el sandbox |
| **Ambiguity**      | 0.09  | ≤0.20| ✓      | |

Status: ✓ = met minimum, ⚠ = below minimum (planner treats as assumption)

## Interview Log

Las preguntas de "qué" y "por qué" se respondieron con la evidencia del diagnóstico (05-08 oct), la reunión del 07-oct y las decisiones D1-D12 del handoff. Yahir delegó las decisiones técnicas en el agente; ninguna pregunta de este SPEC cambia el producto ni toca producción, así que no se reabrió nada. Yahir confirmó el SPEC el 08-oct.

| Round | Perspective     | Question summary | Decision locked |
|-------|-----------------|------------------|-----------------|
| 1     | Researcher      | ¿Qué está roto y dónde? | `pageSize=0` en 4 sitios de `GetTypesCFDI.js`; el portal entrega 200 y reporta `total`; nadie lo lee (verificado en prod 05-oct) |
| 2     | Researcher      | ¿Qué existe ya para paginar y filtrar en bloque? | `getPendingToPayInvoices` (paginación + reintento + dedupe) y `filtrosSage` del rescate (probado en prod) → D2, D4 |
| 2     | Simplifier      | ¿Paginar con tope fijo de 2-3 páginas basta? | No: con 772, 3 páginas dejan fuera 172 y son justo las tardías → paginar hasta `total` (D1); el filtro en bloque es parte del mínimo, no opcional (timeout del 17-jul) |
| 3     | Boundary Keeper | ¿Qué no se toca? | Downloader, `background.js`, `getTypeIToSend`, scripts con `pageSize=0`, ventana de fechas, botón, `pageSize` > 200 (D10-D12) |
| 4     | Failure Analyst | ¿Qué pasa si falla una página o un bloque SQL? | Página: devolver lo recibido + `warn` (D7). Bloque: omitir ese bloque + `error` (D6) |
| 4     | Failure Analyst | ¿Puede la paginación pasarse del paso de 5 min? | Sí: 4 páginas × 3 intentos × 30 s rebasan el paso → **D13**: presupuesto por consulta ≤ 25 % de `stepTimeoutMs`, derivado de config, con `warn` propio para vigilar que no se dispare en operación normal |
| 4     | Failure Analyst | ¿El modo "devolver lo recibido" daña a los scripts? | Sí podría: la conciliación interpretaría una lista parcial como "no está en el portal" → **D14**: `getPendingToPayInvoices` conserva su contrato "todo o nada" |
| 5     | Failure Analyst | ¿Qué herramientas operativas dependen del comportamiento actual? | El diagnóstico cuenta las líneas `conservado` por UUID → se conservan las líneas por factura con su texto (REQ-24-11). El rescate sustituye `getTypeE`/`getTypeI` del módulo → la API exportada no cambia (REQ-24-15); tras desplegar se deja de correr |
| 5     | Failure Analyst | ¿El `IN` en bloque encuentra lo mismo que el `=` con cualquier intercalación? | Sí, si lleva el UUID tal como vino del portal; la comparación en JS es insensible a mayúsculas (REQ-24-07) |
| 5     | Failure Analyst | ¿Qué hace hoy un item malformado? | Sin `cfdi.receptor` lanza fuera del `try` y vacía toda la consulta; con la validación previa sólo se omite él (REQ-24-09) |
| 6     | Seed Closer     | ¿Cómo se sabe en prod cuántas páginas y cuánto tarda? | Líneas de log por consulta y por filtro (D9); se reporta al cliente con esos datos |

---

*Phase: 24-paginar-descarga-cfdi*
*Spec created: 2026-10-08*
*Next step: /gsd-discuss-phase 24 — decisiones de implementación (cómo construir lo especificado arriba)*
