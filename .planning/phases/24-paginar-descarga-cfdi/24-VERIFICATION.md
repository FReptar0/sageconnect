---
phase: 24-paginar-descarga-cfdi
verified: 2026-10-16T19:05:33Z
status: passed
score: 10/10 must-haves verified
# Requisitos REQ-24-01 a REQ-24-15: 15/15 verificados.
# Criterios de aceptación del SPEC: 19/19 completos. El 19 quedó completo el 2026-10-16 con la verificación humana
# de la addenda en zcl-rds-test (build 9313354 de master f68ef2f); ver "Resultado de la verificación humana".
overrides_applied: 0
human_verified: 2026-10-16T20:10:00Z
human_verification:
  - test: "Descargar al menos un XML con el GetTypesCFDI.js de la fase (build 96cd3e6 o cualquier build cuyo GetTypesCFDI.js tenga la huella 0a4a4ee262e3) y abrirlo en la carpeta de descargas del servidor"
    expected: "El XML trae cfdi:Addenda > cfdi:AddendaEmisor con cfdi:DoctoDatosAdi y cfdi:Proveedor (provider_id e IdBase), y esos datos son de esa misma factura (el provider_id corresponde al emisor del XML y la OC/AFE, si aplica, es la suya); en GetTypesCFDI.log su UUID aparece una sola vez con resultado=a-descargar"
    why_human: "Ningún ciclo de la fase descargó un XML (a_descargar=0 en zcl-rds-test el 09 y el 12-oct) y los ejercicios en producción son de sólo lectura y no descargan. Es la única cláusula del criterio 19 del SPEC sin evidencia en vivo, y sólo se comprueba con una descarga real en un servidor"
---

# Fase 24: Paginar la descarga de CFDIs (corregir el tope de 200) — Informe de verificación

**Objetivo (ROADMAP):** `getTypeI`, `getTypeE` y `getCfdisByProvider` reciben **todas** las facturas que el portal reporta en `total` (hoy se cortan en 200 y las autorizadas tarde nunca bajan), con el filtro "ya está en Sage" en bloque para que el paso downloadCFDI siga dentro de su presupuesto de 5 min, y una línea de log que hace visible cualquier corte.
**Contrato:** `24-SPEC.md` (REQ-24-01 a REQ-24-15 y 19 criterios de aceptación) + `24-CONTEXT.md` (D-01 a D-33).
**Verificado:** 2026-10-16 19:05 UTC (13:05 hora local)
**Estado:** human_needed
**Re-verificación:** No; es la verificación inicial.

**Código verificado.** `src/utils/GetTypesCFDI.js` con blob `0951e393` (SHA-1 del contenido `0a4a4ee262e32e9a…`), igual en `6581a97` (último commit de código), `0defe4a` y `3eae944`. Durante la verificación HEAD avanzó de `0defe4a` a `3eae944` por dos commits que sólo tocan documentación (`79f2b2e` crea `24-SECURITY.md`; `3eae944` toca `.planning/codebase/CONCERNS.md`). `src/` y `tests/` no cambiaron: los cuatro blobs de la fase y el árbol `src/` (`0eb037302504`) son idénticos en los dos commits y en el árbol de trabajo.

## Resumen

El objetivo se cumple en el código, en las pruebas y en las corridas en vivo con datos reales. La lista ya no se corta en 200: en producción, en sólo lectura y con este mismo archivo, llegaron 518 de 518 facturas en 3 páginas (16-oct). Con la primera versión, el 09-oct llegaron 910 de 910 en 5 páginas, y en ese mismo ejercicio el filtro en bloque encontró 33 facturas para descargar. El filtro en bloque decide lo mismo que el filtro por factura y hace un número fijo de consultas. El presupuesto de tiempo acota el listado, y cada corte deja su línea en el log. La API exportada y los llamadores no cambiaron.

El estado no es `passed` por una sola razón: **el criterio 19 del SPEC no se cumple completo tal como está escrito.** Ningún ciclo de la fase descargó un XML, así que no hay evidencia en vivo de que "los XML descargados llevan la addenda completa". El código no da razones para dudar: la fase no modifica los items ni el downloader. Pero esa cláusula pide una prueba que no se hizo, y queda para verificación humana (ver abajo). No encontré ninguna verdad FALLIDA.

## Logro del objetivo

### Verdades observables

| # | Verdad | Estado | Evidencia |
|---|--------|--------|-----------|
| 1 | `getTypeI` y `getTypeE` reciben todo lo que el portal reporta en `total`: ya no se cortan en 200 | ✓ VERIFICADA | `fetchCfdiPages` (`GetTypesCFDI.js:511-622`): `pageSize=200` (`:18`, `:553`), `offset += pageItems.length` (`:591`) y cortes (`:593-606`). La llaman `getTypeI` (`:153-157`) y `getTypeE` (`:297-301`). Pruebas F-01 y F-02. En vivo, producción en sólo lectura: el 16-oct getTypeI 518/518 en 3 páginas y getTypeE 91/91; el 09-oct getTypeI 910/910 en 5 páginas |
| 2 | `getCfdisByProvider` encuentra todas las facturas del proveedor | ✓ VERIFICADA | `:329-351`: manda `providerId` (`:341`), pagina con la misma función y conserva el filtro local (`:345`). Pruebas P-02 a P-05. El parámetro se verificó en vivo el 08-oct: 108 de 108, ninguna ajena |
| 3 | La paginación es acotada y resiste fallas: reintento, devolución parcial, presupuesto, tope y sin estado de módulo | ✓ VERIFICADA | `requestCfdiPage` (`:444-494`), `listingBudgetMs` (`:367-369`), `providerListingBudgetMs` (`:378-381`), `CYCLE_MAX_PAGES = 50` (`:21`). Pruebas P-08, P-09, P-12 a P-18, P-26 a P-28, F-03 y F-04. F-16: ningún `Map`/`Set` de módulo, y el único `setTimeout` está en `sleep` (`:363`) |
| 4 | `getPendingToPayInvoices` conserva su contrato "todo o nada" | ✓ VERIFICADA | `:791-838`: `budgetMs: null` (`:808`), sin `hideValidations` (`:807`) y `[]` ante `pagina-fallida` (`:811-820`). Pruebas P-19 a P-23 y P-30. Las anclas P-19 a P-22 pasan también contra `origin/master` (lo reproduje) |
| 5 | El filtro en bloque decide lo mismo que el filtro por factura; sólo entran a SQL valores validados, con un número de consultas acotado y errores aislados por bloque | ✓ VERIFICADA | `filterNotInSage` (`:643-775`). Pruebas F-05 y F-06 (paridad contra el oráculo, con intercalación CI y CS) y F-07 a F-13, F-17 y F-18. En vivo, producción en sólo lectura: el 16-oct `fesaParam=2 APIBHO=4 errores=0` y POCRNHO probado; el 09-oct POINVHO quedó ejercitado (33 a descargar, `error_sql=0`) |
| 6 | El paso downloadCFDI sigue dentro de su presupuesto de 5 min | ✓ VERIFICADA | El presupuesto por listado es de 75 s (`:31`, `:367-369`); con dos listados el paso queda acotado en ~210 s de 300. F-08: consultas SQL ≤ 2·ceil(U/200)+R. Medido: en zcl-rds-test (12-oct) downloadCFDI fue de 17:12:00 a 17:12:01; en producción (sólo lectura) getTypeI tardó 1.785 s en 3 páginas el 16-oct, y listado más filtro de 910+87 tardaron 6.5 s el 09-oct |
| 7 | Cualquier corte queda visible en `GetTypesCFDI.log`, incluido el de `getTypeP` | ✓ VERIFICADA | `logPaginationSummary` (`:412-436`), línea de `getTypeP` (`:60-63`), registro del filtro (`:750-768`). Pruebas P-06, P-13 a P-16, P-23 a P-25, P-29 a P-31, F-01, F-03, F-14, F-19 y F-20. Las líneas se observaron en vivo en test y en producción |
| 8 | `hideValidations=true` sin perder los campos que se consumen | ✓ VERIFICADA | Lo mandan `:155`, `:299` y `:341`, no `:807`. Pruebas P-02, F-01 y F-02. En vivo (08-oct) sólo cambia `metadata.validations`, y nada en `src/` lee `validations` (grep: 0 coincidencias fuera del archivo) |
| 9 | Alcance: en `src/` sólo cambia `GetTypesCFDI.js`; API y llamadores intactos; sin regresión | ✓ VERIFICADA | `git diff origin/master...HEAD --stat -- src/` lista sólo ese archivo. `git diff --quiet` sale en 0 para `config.js`, `.env.example`, `package*.json` y los 5 llamadores. `getTypeIToSend` es idéntica byte a byte; `module.exports` también (P-01). Impacto en la suite: ver REQ-24-15 |
| 10 | Un ciclo completo en zcl-rds-test corre sin `[TIMEOUT]`, sin error del filtro y sin presupuesto agotado, con las líneas nuevas, **y los XML descargados llevan la addenda completa** (criterio 19 del SPEC) | ? PARCIAL (requiere humano) | Con la build final `96cd3e6` (12-oct) se cumplió todo **menos la addenda**: `a_descargar=0`, así que no se descargó ningún XML (el 09-oct con `ee03788` tampoco). Ver "Verificación humana requerida" |

**Puntaje:** 9/10 verdades verificadas y 1 pendiente de verificación humana. **Requisitos: 15/15.**

## Requisito por requisito

**REQ-24-01: Paginación completa en `getTypeI` y `getTypeE`.** ✓ VERIFICADO
- Código: páginas de `PAGE_SIZE = 200` (`:18`) con `offset` creciente (`:591`). Corta por página vacía (`:593-599`), por página sin ningún UUID nuevo (`:600-601`), por únicos ≥ `total` (`:602-603`) o por el tope de 50 páginas (`:604-605`), que registra `warn` (`:430-434`). El dedupe es por UUID normalizado y conserva la primera aparición (`:576-590`).
- Pruebas: F-01 (getTypeI: total=450, las 3 URLs exactas con offset 0, 200 y 400, `pageSize=200`, y los 450 procesados), F-02 (getTypeE), P-06 (página vacía: 2 llamadas), P-07 (UUID repetido: cuenta una vez), P-09 (tope: 50 llamadas y `warn`) y P-10 (sin regla de página corta).
- Nota: los casos de página vacía, duplicado y tope se prueban por `getCfdisByProvider`. `getTypeI` y `getTypeE` usan la misma función con el mismo `maxPages` (`:156`, `:300`), y F-16 asegura que es una sola función.
- En vivo: 518/518 en 3 páginas (16-oct) y 910/910 en 5 páginas (09-oct), producción, sólo lectura.

**REQ-24-02: Una sola función de paginación.** ✓ VERIFICADO
- `grep -n 'pageSize=0'` encuentra sólo `:51` (getTypeP) y `:193` (getTypeIToSend).
- `fetchCfdiPages` se llama en `:153`, `:297`, `:339` y `:805`. Ninguna de las cuatro funciones tiene bucle propio: F-16 lo comprueba sobre el fuente, sin comentarios.
- `requestPendingToPayPage` quedó sustituida por `requestCfdiPage` (`:444`).

**REQ-24-03: `getPendingToPayInvoices` conserva su contrato exacto.** ✓ VERIFICADO
- Mismas opciones y defaults (`pageSize` 200, `maxPages` 1000, `from`, `to`; `:793-796`), la misma URL y en el mismo orden (P-19 la compara literal), sin `hideValidations`, sin presupuesto (`:808`) y `[]` si falla una página (`:811-820`).
- Pruebas: P-19 a P-23 y P-30. Reproduje la prueba negativa fuera del repo: P-19, P-20, P-21 y P-22 pasan también contra el `GetTypesCFDI.js` de `origin/master`. Para esas secuencias de respuestas, la salida es la misma de hoy.
- Divergencias deliberadas y documentadas, sólo con respuestas anómalas:
  - una página 200 sin `items` a mitad de la lista devuelve `[]`, donde antes devolvía la lista parcial (D-32, P-30); va en el sentido de "todo o nada";
  - el dedupe normaliza mayúsculas y espacios (D-07), así que con UUID repetidos que difieren sólo en eso devuelve uno menos.
- `PaymentReconciliation.test.js` y `api/payment-routes.test.js` simulan el módulo entero (`jest.mock`, L26 y L131), así que por construcción no pueden cambiar de resultado.

**REQ-24-04: Reintento por página.** ✓ VERIFICADO
- `isRetryablePortalError` sin cambios (`:353-360`; 429, 502, 503, 504 y los 5 códigos de red); 3 intentos (`:22`) con espera de intento × 1500 ms (`:23`, `:476`). Los demás errores se abandonan (`:488-489`).
- Pruebas: P-12 (un 429 y un ECONNRESET se reintentan y la consulta se completa), P-13 (un 400 no se reintenta) y P-14 (esperas de 1500 y 3000 ms; al tercer intento se abandona).

**REQ-24-05: Fallo parcial: devolver lo recibido.** ✓ VERIFICADO
- `fetchCfdiPages` nunca lanza: devuelve lo recibido con `stopReason` y `failedOffset` (`:559-566`, `:621`). `getTypeI` y `getTypeE` filtran lo recibido (`:170`, `:311`).
- Pruebas: F-03(a) (getTypeI: falla la página 3, se filtran las 400 recibidas, `warn` con `corte=pagina-fallida offset_fallido=400`), P-14, y P-15/F-03(b) (si falla la primera página, `[]`).

**REQ-24-06: Tiempo de listado acotado.** ✓ VERIFICADO
- El presupuesto es `Math.floor(stepTimeoutMs × 0.25)` y se lee en cada llamada (`:31`, `:367-369`). Se revisa antes de cada página (`:547-550`), antes de cada intento (`:449`) y antes de cada espera (`:477-480`).
- Para `getCfdisByProvider` es min(25 %, `httpTimeoutMs`), con guarda contra NaN (`:378-381`, D-33): sigue siendo como máximo el 25 %.
- `config.js` y `.env.example` no cambian. Los dos valores tienen default y guarda de rango en `config.js:128`, `:181`, `:192` y `:205`.
- Pruebas (reloj falso, sin dormir): P-16, P-17 (la espera que rebasaría el límite no se crea), P-18 (leído por llamada), F-04 (getTypeI y getTypeE) y P-26 a P-28.
- El `warn` dice `corte=presupuesto`. Si no llegó nada, el nivel es `error` (D-32), un refinamiento más estricto que el SPEC.

**REQ-24-07: Filtro en bloque con la misma semántica.** ✓ VERIFICADO
- Precedencia RFC → CxP → OC/NC (`:689-746`). El `IN` lleva cada UUID recortado tal como vino del portal (`:661`, `:719`). Las filas se cruzan con `trim().toUpperCase()` (`:722-725`). Facturas contra `POINVHO` y notas de crédito contra `POCRNHO` (`:738-746`).
- Pruebas: F-05 y F-06 contra un oráculo congelado de la decisión por factura, con intercalación CI y CS. El dataset trae trampas: ERRENTRY≠0, OPTFIELD distinto, espacios finales, mayúsculas cruzadas y la tabla equivocada. Además F-07 (el literal va en minúsculas tal cual), F-17 (no se consulta lo ya decidido) y F-18 (UUID recortado). F-05 y F-06 pasan también contra `origin/master` (lo reproduje): el oráculo refleja el comportamiento anterior.

**REQ-24-08: Consultas SQL acotadas.** ✓ VERIFICADO
- Una consulta por RFC distinto (`:689-710`) y bloques de 200 (`:33`, `:716`) para CxP y para OC/NC. `db` explícito en cada `runQuery`: `'FESA'` (`:700`) y `databases[index]` (`:721`).
- Prueba F-08: 450 facturas con 2 RFC hacen exactamente 8 consultas (2 + 3 + 3), en serie (`maxInFlight=1`) y con la base correcta.
- En vivo (16-oct): `fesaParam=2 APIBHO=4`. Cuadra con el código: ceil(91/200) + ceil(518/200) = 4. POINVHO y POCRNHO quedaron en 0 porque todas las facturas salieron en CxP. Las cotas eran 7 para getTypeI y 3 para getTypeE.

**REQ-24-09: Sólo valores validados entran a SQL.** ✓ VERIFICADO
- Las regex son literalmente las del SPEC (`:37-38`), sin bandera `g`. Validación por item antes de cualquier SQL (`:650-675`). El lote por RFC sólo toma registros válidos (`:690-694`).
- Pruebas: F-09 (`x' OR 1=1--`, `ABC';DROP` y un salto de línea inyectado no aparecen en ninguna consulta, cuentan como inválidas y el log no lleva saltos crudos), F-10 (sin `cfdi.receptor` o sin `cfdi.timbre`, sólo se aparta esa factura) y F-18.

**REQ-24-10: Un error en un bloque SQL omite sólo ese bloque.** ✓ VERIFICADO
- Cada consulta tiene su `try/catch`. `errorDeBloque` marca `error-sql` y deja una línea `error` con tabla, bloque, tamaño y mensaje (`:678-685`). Un bloque de CxP con error no pasa a OC/NC (`:715`).
- Pruebas: F-11 (falla el bloque 2 de CxP, se devuelven las de los bloques 1 y 3, `tabla=APIBHO bloque=2 tamano=200`), F-12 (RFC) y F-13 (OC).

**REQ-24-11: Registro: el corte visible y lo importante rastreable.** ✓ VERIFICADO
- (a) Una línea `[PAGINACION]` por consulta con total, recibidas, páginas, ms, página más lenta y corte; `warn` o `error` según el caso (`:412-436`).
- (b) Una línea resumen `[FILTRO-SAGE]` con sus cinco contadores y ms (`:764-768`).
- (c) Una línea por factura sólo para `a-descargar`, `sin-rfc`, `invalida` y `error-sql`; las que ya están en Sage no tienen línea (`:750-761`). El filtro no tiene `console.log`.
- Pruebas: F-01, F-03, F-14 (50 líneas por factura, ninguna de las 400 ya registradas), F-15 y P-23.
- En vivo (09-oct, evidencia local `data-sageconnect/evidencia/2026-10-09-probar-paginacion-prod.txt`): 33 líneas por factura para `a_descargar=33`, y ninguna para las 877 ya en Sage.

**REQ-24-12: `getCfdisByProvider` paginada y con filtro en el portal.** ✓ VERIFICADO
- `providerId` codificado (`:525-528`), paginación compartida (`:339-343`) y filtro local por `metadata.provider_id` (`:345`). Con `providerId` vacío devuelve `[]` sin consultar el portal (`:330-333`, D-31).
- Pruebas: P-02, P-03 (un portal que ignora el parámetro sólo devuelve las del proveedor pedido), P-04 y P-05.
- En vivo: el parámetro se verificó el 08-oct en producción. **INFO:** la función nueva en sí no corrió en vivo, porque ningún ciclo observado resolvió UUID faltantes. Su paginación es la misma que sí corrió con getTypeI y getTypeE.

**REQ-24-13: `getTypeP`: sólo la línea de log.** ✓ VERIFICADO
- El diff contra `origin/master` sólo agrega líneas (`:46`, `:60-63`); la URL sigue con `offset=0&pageSize=0` (`:51`).
- Pruebas: P-24 (total=244 con 200 recibidos: misma salida, `warn` con `total=244 recibidas=200 corte=sin-paginar`) y P-25.
- En vivo (12-oct): `getTypeP total=2 recibidas=2 corte=completo`.

**REQ-24-14: `hideValidations=true` sin perder campos.** ✓ VERIFICADO
- `:155`, `:299` y `:341` lo mandan; `getPendingToPayInvoices` no (`:807`). Pruebas P-02, F-01 y F-02.
- En vivo (08-oct, producción, documentado en el SPEC y en D-27): sólo cambia `metadata.validations`, y los 8 campos consumidos llegan con el mismo valor. Los cinco que usa `CFDI_Downloader.js:74-89` están entre esos 8.

**REQ-24-15: Alcance de código y regresión.** ✓ VERIFICADO
- Alcance: fuera de `.planning/` la rama cambia sólo `src/utils/GetTypesCFDI.js` y 3 archivos de prueba nuevos. Los llamadores, `config.js`, `.env.example` y `package*.json` no cambian. `getTypeIToSend` es idéntica (comparé las 107 líneas) y `module.exports` también (P-01).
- Regresión: por instrucción **no corrí `npm test` completo** (deja un CSV en la raíz). El impacto queda acotado por estructura:
  - las dos suites de la fase pasan 56/56;
  - fuera de ellas, ninguna suite ejecuta las funciones cambiadas sin simularlas. `background.*.test.js` simula `CFDI_Downloader`, `SagePaymentController` y `PortalPaymentController`; `PaymentReconciliation` y `payment-routes` simulan el módulo; `EnhancedPaymentSync` está excluida en `jest.config.js`;
  - sólo `regression-verification.test.js` y `envelope-contract.test.js` **cargan** el módulo. La carga no cambió: no hay `require` nuevos ni lecturas nuevas de `config` a nivel de módulo, sólo constantes;
  - ninguna suite de análisis estático lee este archivo, salvo F-16, y no hay `process.exit`.
- Las corridas completas documentadas lo corroboran: 7 fallos de la línea base en `a4ad0c0` (24-03) y la misma línea base en 489/497 tras los fixes (24-REVIEW-FIX).

## Criterios de aceptación del SPEC

| # | Criterio (abreviado) | Estado | Evidencia |
|---|---|---|---|
| 1 | total=450: 3 peticiones (0/200/400, `pageSize=200`) y 450 procesados | ✓ | F-01, F-02 |
| 2 | Página vacía detiene; UUID repetido cuenta una vez; tope con `warn` | ✓ | P-06, P-07, P-09 (misma función: F-16) |
| 3 | `pageSize=0` sólo en getTypeP y getTypeIToSend; una sola paginación | ✓ | grep (`:51`, `:193`), F-16 |
| 4 | `getPendingToPayInvoices` igual que hoy, `[]` si falla una página, sin `hideValidations` | ✓ | P-19 a P-22 (también en verde contra `origin/master`), P-30 |
| 5 | 429 y luego éxito completa; 400 no se reintenta | ✓ | P-12, P-13 |
| 6 | Página 3 fallando: lo filtrado de las 400 y `warn` con `offset=400` | ✓ | F-03(a) |
| 7 | Superado el presupuesto: ninguna petición ni reintento nuevo, y `warn` | ✓ | P-16, P-17, P-18, F-04 |
| 8 | Paridad del filtro, incluido el caso de mayúsculas; el SQL lleva el UUID tal como vino | ✓ | F-05, F-06 (CI/CS), F-07 |
| 9 | 450 items con 2 RFC: ≤ 8 llamadas con `db` explícito | ✓ | F-08 (exactamente 8) |
| 10 | Malformados fuera del SQL y contados; sin receptor o sin timbre no tumban la consulta | ✓ | F-09, F-10 |
| 11 | Error SQL en un bloque: omite sólo ese bloque y registra `error` | ✓ | F-11, F-12, F-13 |
| 12 | Líneas de consulta, de filtro y por factura; ninguna de las ya en Sage; sin `console.log` por factura | ✓ | P-02, P-23, F-01, F-14, F-15 |
| 13 | `getCfdisByProvider` manda `providerId` y conserva el filtro local | ✓ | P-02, P-03, P-04 |
| 14 | `getTypeP` igual que hoy y `warn` con `total=244 recibidas=200` | ✓ | P-24 |
| 15 | `hideValidations=true` en las consultas paginadas del ciclo | ✓ | P-02, F-01, F-02 |
| 16 | Verificado en vivo `providerId` y `hideValidations` | ✓ (evidencia documentada) | 08-oct, producción, sólo lectura (SPEC y D-27); no lo puedo reproducir |
| 17 | `git diff --stat -- src/` sólo GetTypesCFDI.js; `config.js` y `.env.example` sin cambios | ✓ | Lo comprobé con `git diff` |
| 18 | `npm test` con los fallos de la línea base y los tests nuevos en verde | ✓ | Ver REQ-24-15 (impacto acotado por estructura; corridas documentadas) |
| 19 | zcl-rds-test: ciclo sin `[TIMEOUT]`, sin error del filtro (SQL contra el esquema real), sin presupuesto agotado, con las líneas nuevas **y la addenda completa en los XML descargados** | ? PARCIAL | Todo cumplido con `96cd3e6` (12-oct), **salvo la addenda**: no se descargó ningún XML. El SQL en bloque contra esquemas reales se completó con producción en sólo lectura (POINVHO el 09-oct con el mismo texto SQL; POCRNHO el 16-oct) |

## Artefactos requeridos

| Artefacto | Esperado | Estado | Detalle |
|---|---|---|---|
| `src/utils/GetTypesCFDI.js` | Paginación, filtro en bloque, presupuesto y registro | ✓ VERIFICADO | 846 líneas; existe, es sustantivo (ningún stub), está cableado (5 consumidores en `src/`) y los datos fluyen en vivo |
| `tests/helpers/getTypesCfdiFakes.js` | Modelo del portal y de la base (D-22, D-23) | ✓ VERIFICADO | Tope de 200, offset, fallas por intento, reloj falso, intercalación CI/CS, espacios finales, `db` exigido y detección de paralelismo |
| `tests/utils/GetTypesCFDI.paginacion.test.js` | Suite P-01 a P-31 | ✓ VERIFICADO | 31/31 en verde; aserciones sobre URLs exactas, número de llamadas, esperas y líneas de log literales |
| `tests/utils/GetTypesCFDI.filtro.test.js` | Suite F-01 a F-20 | ✓ VERIFICADO | 25/25 en verde (con las variantes de `describe.each`) |

`gsd-sdk query verify.artifacts`: los 4 planes salen `all_passed: true`.

## Verificación de enlaces clave

`gsd-sdk query verify.key-links` responde "Source file not found" porque el `from` de los planes trae nombres de función, no rutas: es una limitación de la herramienta. Los verifiqué a mano:

| Desde | Hacia | Vía | Estado | Detalle |
|---|---|---|---|---|
| `getTypeI` / `getTypeE` | `fetchCfdiPages` | consulta + `hideValidations` + presupuesto | ✓ CABLEADO | `:153-157`, `:297-301` |
| `getTypeI` / `getTypeE` | `filterNotInSage` | kind `'I'` (POINVHO) / `'E'` (POCRNHO) | ✓ CABLEADO | `:170`, `:311`; ramas `:738-746` |
| `getCfdisByProvider` | `fetchCfdiPages` | `providerId`, `hideValidations`, `providerListingBudgetMs()` | ✓ CABLEADO | `:339-343` (D-33 sustituyó `listingBudgetMs()`) |
| `getPendingToPayInvoices` | `fetchCfdiPages` | `budgetMs: null`; `[]` ante `pagina-fallida` | ✓ CABLEADO | `:805-820` |
| `requestCfdiPage` | `isRetryablePortalError` | 3 intentos, espera intento × 1500 ms, revisión del presupuesto | ✓ CABLEADO | `:475-486` |
| `getTypeP` | `logPaginationSummary` | `paginas=1`, `completo` o `sin-paginar` | ✓ CABLEADO | `:63` |
| `filterNotInSage` | `runQuery` | `'FESA'` / `databases[index]` | ✓ CABLEADO | `:700`, `:721` |
| `CFDI_Downloader.downloadCFDI` | `getTypeE` / `getTypeI` | desestructura al cargar; usa `id`, `metadata.*`, `cfdi.receptor.rfc` | ✓ CABLEADO | `CFDI_Downloader.js:1`, `:71-91` (sin cambios) |
| `UuidResolver.resolveUuidByFolio` | `getCfdisByProvider` | espera un arreglo; usa `cfdi.folio`, `serie`, `timbre.uuid` | ✓ CABLEADO | `UuidResolver.js:20-34` (sin cambios); el `providerId` llega recortado (`PortalPaymentController.js:233`) |
| `SagePaymentController.checkPayments` | `getTypeP` | sin cambios | ✓ CABLEADO | `SagePaymentController.js:34` |

## Traza de datos (Nivel 4)

| Artefacto | Dato | Fuente | ¿Datos reales? | Estado |
|---|---|---|---|---|
| `getTypeI` / `getTypeE` → `CFDI_Downloader` | `page.items` filtrados | `portalClient.get` (portal real) → `runQuery` (Sage/FESA reales) | Sí: producción, sólo lectura, 518 y 91 items (16-oct) y 910 + 87 (09-oct); test, 3 items | ✓ FLUYE |
| `filterNotInSage` | items a descargar (las mismas referencias, sin modificar) | `registros[].item` (`:653`, `:770`) | Sí: 33 a descargar el 09-oct | ✓ FLUYE |
| `getCfdisByProvider` → `UuidResolver` | items del proveedor | portal con `providerId` | Parámetro verificado en vivo; la función no corrió en vivo (INFO) | ✓ FLUYE (por pruebas y por la paginación compartida) |

## Comprobaciones de comportamiento (las corrí yo)

| Comportamiento | Comando | Resultado | Estado |
|---|---|---|---|
| Suites de la fase | `npx jest tests/utils/GetTypesCFDI.paginacion.test.js tests/utils/GetTypesCFDI.filtro.test.js` | 56/56 en 0.42 s; el árbol sigue limpio | ✓ PASA |
| Sintaxis | `node --check src/utils/GetTypesCFDI.js` | OK | ✓ PASA |
| `pageSize=0` sólo donde no se pagina | `grep -n 'pageSize=0'` | `:51`, `:193` | ✓ PASA |
| Alcance | `git diff origin/master...HEAD --stat -- src/` | 1 archivo | ✓ PASA |
| Archivos que no debían cambiar | `git diff --quiet origin/master...HEAD -- config.js .env.example package*.json` y los 5 llamadores | exit 0 | ✓ PASA |
| Huella del ejercicio del 16-oct = código verificado | `shasum -a 1 src/utils/GetTypesCFDI.js` | `0a4a4ee262e32e9a…` (empieza con `0a4a4ee262e3`) | ✓ PASA |
| Huella del ejercicio del 09-oct = primera versión | SHA-1 del archivo en `06e6d9e` | `554bd71dd002…`, la misma que trae la evidencia local del 09-oct | ✓ PASA |
| Prueba negativa (D-25), fuera del repo | copia de las suites + stubs en el scratchpad; `GetTypesCFDI.js` de `origin/master` | 46 ✕ / 10 ✓ (P-01, P-19 a P-22, F-05 ×2, F-06 ×2, F-17), 0 errores de programa | ✓ PASA (las pruebas pueden fallar; las anclas del contrato se cumplen con el código viejo) |
| Prueba negativa de los fixes | mismo arnés con `5e57893` | 11 ✕ (F-03, F-19 ×2, F-20 ×2, P-15, P-26, P-28, P-29 a P-31) / 45 ✓; P-27 pasa (ancla) | ✓ PASA |
| Control del arnés | mismo arnés con el código de HEAD | 56/56 | ✓ PASA |
| Redacción del diff de código y pruebas | patrón de HANDOFF.md §1 leído del archivo (sin escribirlo) | control positivo 6 en HANDOFF.md; 0 en el diff | ✓ PASA |
| Marcadores de deuda | `grep -E 'TBD\|FIXME\|XXX'` en los 4 archivos | 0 | ✓ PASA |

## Ejecución de probes

No aplica: no hay `scripts/*/tests/probe-*.sh` ni probes declarados en los planes ni en los SUMMARY.

## Evidencia humana registrada (no la puedo reproducir)

La verificó el operador fuera del repo. La registro como tal y anoto lo que sí pude contrastar.

1. **zcl-rds-test, build instalada.** `git reflog --date=iso -3` en el dist muestra:
   - `96cd3e6`, generada desde `0defe4a`, instalada el 2026-10-12 a las 17:09:43 -0600;
   - `ee03788`, desde `06e6d9e`, instalada el 2026-10-09 a las 12:25:53.

   *Contraste:* `0defe4a` se commiteó el 12-oct a las 15:56:21, antes de la instalación. Entre `6581a97` y `0defe4a` no hay cambios en `src/` ni en `tests/`.
2. **zcl-rds-test, ciclo con el botón el 12-oct a las 17:12, build `96cd3e6`:**
   - `[PAGINACION]`: getTypeE `total=0 recibidas=0 paginas=1 corte=completo`; getTypeI `total=3 recibidas=3 paginas=1 corte=completo`; getTypeP `total=2 recibidas=2 corte=completo`;
   - `[FILTRO-SAGE]` getTypeI `ya_en_sage=3 error_sql=0 a_descargar=0`;
   - downloadCFDI de 17:12:00 a 17:12:01;
   - todas las líneas en `[INFO]`.

   *Contraste:* son los formatos de D-17 y D-18 que produce el código (`:416-418`, `:766-768`). Que no haya ninguna línea `warn` ni `error` implica que no hubo `[TIMEOUT]`, ni error del filtro, ni presupuesto agotado.
3. **Producción ZCL-RDS-02, 16-oct a las 11:40, sólo lectura** (script que sólo permite SELECT y GET, con una copia idéntica del archivo, huella `0a4a4ee262e3`):
   - getTypeE `total=91 recibidas=91 paginas=1 corte=completo`, `ya_en_sage=91`;
   - getTypeI `total=518 recibidas=518 paginas=3 ms=1785 corte=completo`, `ya_en_sage=518 a_descargar=0 error_sql=0`;
   - SQL `fesaParam=2 APIBHO=4 POINVHO=0 POCRNHO=0 errores=0`;
   - POCRNHO probado con una nota de crédito inventada: la consulta corrió sin error y la nota quedó `a-descargar`, como se esperaba.

   *Contraste:*
   - la huella coincide con el SHA-1 del archivo verificado;
   - 518 en 3 páginas = 200 + 200 + 118;
   - `APIBHO=4` = 1 + 3 bloques;
   - POINVHO y POCRNHO quedan en 0 porque `porBloques` sólo consulta lo que no salió en CxP (`:715`);
   - el presupuesto de 75 s deja ~42× de margen sobre 1.785 s.
4. **Producción, 09-oct, primera versión** (huella `554bd71dd002`): getTypeI 910/910 en 5 páginas y 4.0 s, 877 ya en Sage, 33 a descargar, `error_sql=0`.

   *Contraste:* lo confirma la evidencia local (líneas resumen y 33 líneas por factura). Entre esa versión y la final no cambió el texto SQL ni el filtro (diff `06e6d9e..HEAD`), así que la corrida de POINVHO contra el esquema real vale para el código final.
5. **Alcance:** la fase no incluye la instalación en producción, que va aparte con su control de cambios.

## Cobertura de requisitos por plan

| Plan | Requisitos que declara |
|---|---|
| 24-01 | REQ-24-02, -03, -04, -05, -06, -11, -12, -13, -14, -15 |
| 24-02 | REQ-24-01, -02, -05, -06, -07, -08, -09, -10, -11, -14, -15 |
| 24-03 | REQ-24-01 a REQ-24-15 (compuerta) |
| 24-04 | REQ-24-06, -07, -08, -10, -11, -12, -14, -15 |

Los 15 requisitos están reclamados por al menos un plan. No existe `.planning/REQUIREMENTS.md` (los requisitos viven en `24-SPEC.md`), así que no hay requisitos huérfanos.

## Anti-patrones

| Archivo | Línea | Patrón | Severidad | Impacto |
|---|---|---|---|---|
| `GetTypesCFDI.js` | `:111`, `:120` (getTypeP); `:220-267` (getTypeIToSend) | SQL interpolado sin validar (preexistente) | ℹ️ Info | Fuera de alcance (D-21, REQ-24-15); riesgo aceptado AR-24-01/02 en `24-SECURITY.md` y registrado en `CONCERNS.md` (`3eae944`). La fase cerró los sitios de getTypeI/getTypeE |
| `GetTypesCFDI.js` | `:95-130` | `console.log` por UUID en getTypeP (preexistente) | ℹ️ Info | D-21 lo conserva a propósito: misma salida que antes |
| `GetTypesCFDI.js` | `:166`, `:308`, `:332`, `:773`, `:819` | `return []` | ℹ️ No son stubs | Rutas de vacío o error que exige el contrato (D-02, D-15, D-31, REQ-24-03); cada una deja su línea en el log |
| Los 4 archivos de la fase | — | `TBD` / `FIXME` / `XXX` | — | 0 coincidencias |

## Pase de disconfirmación

**Tres formas en que podría fallar aunque pasen las pruebas** (Inversion):

1. **El portal cambia entre páginas.** Si se inserta una factura arriba mientras se pagina, la cola de la lista se recorre y el corte por conteo (`:602`) puede dejar fuera la última en ese ciclo. El SPEC lo acepta (Constraints): el ciclo siguiente la toma, y el listado dura de 2 a 4 s. No requiere cambio.
2. **El presupuesto puede cortar siempre las mismas páginas.** Si el portal se pusiera muy lento (≥ ~15 s por página), cortaría las últimas páginas en cada ciclo, y ahí están justo las autorizadas tarde. Quedaría visible como `corte=presupuesto`; la medida siguiente (cursor entre ciclos) está diferida con criterio explícito. Hoy la página tarda ~1 s.
3. **La addenda cruzada del downloader.** Es un defecto preexistente y fuera de alcance (`CFDI_Downloader.js:106-130`): si un `/files` no trae `xml`, los índices de `urls` y `cfdiData` se desalinean, y una addenda puede ir a otra factura. La paginación no lo causa, pero un ciclo con muchas descargas lo expone más. Por eso la verificación humana pide comprobar que la addenda sea de **esa** factura.

**Confirmation Bias Counter:**

- **Requisito cumplido sólo en parte:** el criterio 19 (la addenda). En zcl-rds-test tampoco se demostraron POINVHO ni POCRNHO, que se cubrieron con producción en sólo lectura.
- **Pruebas que pasan sin probar del todo lo que dicen:**
  - la cláusula de REQ-24-03 sobre `PaymentReconciliation.test.js` y `payment-routes.test.js` se cumple por construcción, porque simulan el módulo entero; la evidencia real del contrato son P-19 a P-22 y P-30;
  - F-05 y F-06 no detectarían que alguien quitara `Parametro = 'RFCReceptor'` o los JOIN, porque el modelo de la base no los exige (IN-04 de la revisión, diferido). El SQL de hoy sí los lleva (`:700`, `:734`, `:740`, `:744`);
  - F-15 sólo revisa `console.log`; el `console.warn` de reintentos no lleva UUID.
- **Rutas de error sin prueba:**
  - el `catch` externo de `filterNotInSage` (`:771-774`, excepción inesperada → `[]` y `error`);
  - el nivel de la línea `[PAGINACION]` cuando falta `total` y falla una página a mitad de la lista (`:433`).

  Las dos son defensivas, pero no tienen cobertura.

## Desviaciones documentadas (no son brechas)

- **D-32 (WR-01, `29ed5cd`):**
  - una respuesta sin `items` cuenta como página fallida;
  - el nivel es `error` cuando no llegó nada y el corte no es `completo`;
  - "No hay CFDI" se dice sólo con `completo`.

  Sustituye la verdad del plan 24-02 que también lo permitía con `pagina-vacia` sin total; la regla nueva es más estricta.
- **D-33 (WR-02, `6581a97`):** el presupuesto de `getCfdisByProvider` es min(25 % de `stepTimeoutMs`, `httpTimeoutMs`), 30 s con los defaults. Sigue cumpliendo "como máximo 25 %".
- **D-07 y D-32 en `getPendingToPayInvoices`:** sólo con respuestas anómalas difiere de `origin/master` (ver REQ-24-03), y siempre hacia "todo o nada".
- **D-31:** con `providerId` vacío no se consulta el portal. Para el único llamador el resultado es el mismo que antes.

## Verificación humana requerida

### 1. Addenda en un XML descargado con el código de la fase

**Prueba:** que un ciclo descargue al menos un XML con el `GetTypesCFDI.js` de la fase (build `96cd3e6`, o cualquiera con la huella `0a4a4ee262e3`) y abrirlo en la carpeta de descargas. Hay dos lugares posibles:
- en zcl-rds-test, con una factura del sandbox en "Pendiente de pago", de un proveedor con banco y sin registrar en Sage;
- en el primer ciclo de producción, que está fuera de esta fase.

**Esperado:**
- el XML trae `cfdi:Addenda` → `cfdi:AddendaEmisor`, con `cfdi:DoctoDatosAdi` y `cfdi:Proveedor` (`provider_id` e `IdBase`);
- esos datos son de esa misma factura: el `provider_id` corresponde al emisor del XML, y la OC/AFE, si aplica, es la suya;
- en `GetTypesCFDI.log` su UUID aparece una sola vez, con `resultado=a-descargar`.

**Por qué humano:** hace falta una descarga real en un servidor. En la fase no se descargó ningún XML: `a_descargar=0` el 09 y el 12-oct en test, y los ejercicios en producción no descargan.

**Por qué el riesgo es bajo:**
- la fase devuelve los mismos objetos del portal sin modificarlos (`:770`);
- `CFDI_Downloader.js` no cambió;
- los cinco campos que usa (`:74-89`) llegaron idénticos con `hideValidations=true` en la comparación en vivo del 08-oct;
- nada en `src/` lee `metadata.validations`.

**Si se decide diferirla al primer ciclo de producción**, el riesgo se acepta con un override en el frontmatter de este archivo. Así, en la siguiente verificación el punto quedaría como `PASSED (override)`:

```yaml
overrides:
  - must_have: "Los XML descargados en zcl-rds-test llevan la addenda completa (criterio 19 del SPEC)"
    reason: "La fase no modifica los items ni CFDI_Downloader.js; hideValidations sólo recorta metadata.validations (verificado en vivo el 08-oct) y nada en src/ lo lee. Se comprueba abriendo un XML en el primer ciclo de producción, dentro de su control de cambios."
    accepted_by: "{nombre}"
    accepted_at: "{timestamp ISO}"
```

### Resultado de la verificación humana (2026-10-16): aprobada

Se comprobó en zcl-rds-test con el build `9313354`, generado del merge `f68ef2f` del PR #28. Es el mismo artefacto que se instalará en producción, y su `GetTypesCFDI.js` es el verificado arriba.

- **Ciclo con el botón, 16-oct 13:50.** Las tres consultas quedaron completas, todas en `[INFO]` y con `corte=completo`:
  - getTypeE: 0 de 0;
  - getTypeI: 7 de 7;
  - getTypeP: 3 de 3.
- **Filtro contra Sage:** `[FILTRO-SAGE] getTypeI recibidas=7 ya_en_sage=3 error_sql=0 a_descargar=4`. Cada UUID aparece una sola vez con `resultado=a-descargar`.
- **Bitácora:** 0 líneas `[ERROR]` o `[WARN]` en `GetTypesCFDI.log`, y no se creó `CFDI_Downloader.log` (no hubo error de descarga ni XML borrados por falta de banco). downloadCFDI corrió de 13:50:21 a 13:50:25.
- **XML descargados:** los 4 están en la carpeta de descargas, nombrados por su UUID (`41C179E1…`, `709A9E7A…`, `E955D4EF…`, `FF014CE9…`).
  - Cada uno trae `cfdi:Addenda` → `cfdi:AddendaEmisor`, con `cfdi:DoctoDatosAdi` (la OC) y `cfdi:Proveedor` (`provider_id`, `external_id` e `IdBase="COPDAT"`).
  - Se cotejó cada XML contra el portal del sandbox con un GET de solo lectura sobre la misma consulta de `getTypeI`. En los 4, el `provider_id`, el proveedor de Sage y la OC de la addenda son los del portal para ese UUID, y el RFC del emisor del XML es el del proveedor.
  - Son 2 proveedores distintos, 1 factura de uno y 3 del otro, y no hay addendas cruzadas.

Con esto el criterio 19 queda completo y el estado pasa a `passed`, sin override. En el registro no se copian nombres, RFC ni datos de contacto de los XML.

## Fuera del alcance de la fase (condiciones para producción; sólo para trazabilidad)

Vienen del SPEC (Constraints) y de 24-04 ("Para producción"); no cuentan para esta verificación.

**Antes del despliegue:**
- repetir el ejercicio de sólo lectura para tener al día la lista de lo que bajará el primer ciclo, y revisarla con el cliente;
- anotar el SHA del dist antes del `reset`.

**Después del despliegue:**
- `[PAGINACION]` con `recibidas` igual a `total`;
- sin `[TIMEOUT]` y sin `corte=presupuesto`;
- `error_sql=0` en getTypeE cuando haya una nota de crédito fuera de CxP;
- abrir un XML descargado (el punto humano de arriba);
- dejar el rescate diario y ajustar el diagnóstico a las líneas nuevas.

## Resumen de brechas

**Ninguna verdad FALLIDA ni bloqueante.** Las 15 exigencias del SPEC están implementadas, cableadas y probadas. Las pruebas se comprobaron por negativo: fallan contra el código anterior y las anclas del contrato se cumplen con él. El comportamiento central se observó en vivo con datos de producción y con el mismo archivo.

Queda **un punto para verificación humana**: la addenda de un XML descargado, la única cláusula del criterio 19 del SPEC sin evidencia en vivo. Por eso el estado es `human_needed` y no `passed`.

Como información, sin que bloquee:
- `getCfdisByProvider` no corrió en vivo con el código nuevo;
- el modelo de la base no exige `Parametro = 'RFCReceptor'` ni los JOIN (IN-04, diferido);
- el `catch` externo del filtro no tiene prueba.

---

_Verificado: 2026-10-16T19:05:33Z_
_Verificador: Claude (gsd-verifier)_
