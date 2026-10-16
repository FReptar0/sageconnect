---
phase: 24-paginar-descarga-cfdi
reviewed: 2026-10-09T19:35:09Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/utils/GetTypesCFDI.js
  - tests/helpers/getTypesCfdiFakes.js
  - tests/utils/GetTypesCFDI.filtro.test.js
  - tests/utils/GetTypesCFDI.paginacion.test.js
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
status: issues_found
---

# Fase 24: Reporte de revisión de código

**Revisado:** 2026-10-09T19:35:09Z
**Profundidad:** standard
**Archivos revisados:** 4
**Estado:** issues_found

## Resumen

Se revisó el diff `dde4bd0...HEAD` de `src/utils/GetTypesCFDI.js`:

- las funciones nuevas: `fetchCfdiPages`, `requestCfdiPage`, `listingBudgetMs`, `parseTotal`, `valorLog`, `idLog`, `logPaginationSummary` y `filterNotInSage`;
- las reescritas: `getTypeI`, `getTypeE`, `getCfdisByProvider` y `getPendingToPayInvoices`;
- las 5 líneas nuevas de `getTypeP`;
- las tres piezas de prueba nuevas.

Se contrastó con la versión de `dde4bd0` y con los llamadores (`CFDI_Downloader.js`, `UuidResolver.js`, `PortalPaymentController.js`, `background.js` y los scripts de conciliación).

Lo verificado que está bien:

- **Ninguna factura se descarga sin verificar.** `a-descargar` sólo se asigna en el pase OC/NC, después de que las consultas de RFC y de CxP salieron bien (L685-717). Toda consulta fallida o excepción inesperada aparta la factura (`error-sql` o `[]`).
- **Paridad del filtro.** El `IN` con cada UUID recortado tal como vino del portal, más el cruce en mayúsculas, encuentra lo mismo que el `=` anterior con intercalación CI o CS. El dedupe por UUID normalizado impide que dos facturas de un lote compartan llave, así que una fila devuelta no puede marcar a otra factura.
- **SQL:**
  - Sin sitios nuevos de inyección: al SQL sólo llegan valores que pasaron `UUID_REGEX` o `RFC_REGEX`. Las regex no llevan bandera `g`, y en modo no-unicode `[A-Z]` con `i` no deja pasar `ſ` ni `ı` (comprobado).
  - `db` explícito en cada `runQuery`. Si falta la base del tenant, `databases[i]` vale `''` y no `undefined` (`config.js:83`), así que el default implícito de `runQuery` no se activa.
  - Ningún `SET` de sesión en `src/` puede truncar, en el pool compartido, las consultas de varias filas.
- **Always-on:**
  - Sin estado nuevo de módulo, y todos los bucles acotados (`maxPages`, `MAX_PAGE_ATTEMPTS`, bloques).
  - La única espera es el `sleep` del reintento: de un solo disparo y de 3 s como máximo.
- **Log:** todo valor externo pasa por `valorLog` o `idLog`, y ninguna línea lleva URL ni cabeceras.
- **Contrato:** la API exportada no cambia, y `getPendingToPayInvoices` conserva "todo o nada".
- **Pruebas:** deterministas (reloj falso y `runAllTimersAsync`), sin dormir en tiempo real.

Los hallazgos se comprobaron con un test temporal fuera del repo (en el scratchpad, ya borrado). Corrió con los mismos escenarios contra el código de la rama y contra el de `dde4bd0`.

No hay BLOCKER. Los dos WARNING son de robustez y de visibilidad cuando el portal falla; no afectan la operación normal medida.

## Warnings

### WR-01: Un listado que no se pudo leer ya no deja `[ERROR]`, y una respuesta sin `items` queda en `info` diciendo "No hay CFDI"

**Archivo:** `src/utils/GetTypesCFDI.js:540`, `:564-570`, `:408-413`, `:158`, `:300`

**Problema:** hay dos caminos en los que el listado no pudo leerse y que ya no llegan a `error`. Se comprobaron ejecutando las dos versiones.

1. **Respuesta 200 sin arreglo `items`.** Puede ser la página HTML de un balanceador o de mantenimiento, un `{"message": ...}` o un cambio de esquema.
   - L540 la convierte en `[]`. Como tampoco vino `total`, L569 corta con `pagina-vacia`.
   - L412 registra ese corte en `info`.
   - La condición de L158/L300 (`pagina-vacia && !(total > 0)`) imprime `[INFO] No hay CFDI de tipo I`.
   - Ese segundo término sólo se cumple cuando el portal no reportó `total` en la primera página: un listado vacío de verdad trae `total: 0` y corta como `completo` (L565-567). Es justo el caso anómalo.
   - Antes (`dde4bd0`): `[ERROR]: Error al obtener el tipo de comprobante "I" : TypeError: response.data.items is not iterable`.
   - Ahora: `[INFO] [PAGINACION] consulta=getTypeI tenant=T1 total=desconocido recibidas=0 paginas=1 ms=0 pagina_mas_lenta_ms=0 corte=pagina-vacia`, más `[INFO] No hay CFDI de tipo I` en consola.
2. **Falla de la primera página.** Por ejemplo, 401/403 por credenciales del tenant cambiadas o vencidas, 404 por un tenant mal configurado, o un 500 persistente. Sólo quedan líneas `warn`.
   - Antes: `[ERROR]: Error al obtener el tipo de comprobante "I" : Error: Request failed with status code 401`. En `getCfdisByProvider`, además, `[ERROR] getCfdisByProvider failed ...` y `console.error`.
   - Ahora: `[WARN] [PAGINACION-INTENTO] ... status=401 accion=abandonar` y `[WARN] [PAGINACION] ... recibidas=0 paginas=0 ... corte=pagina-fallida offset_fallido=0`.

**Escenario de falla:** las credenciales del tenant cambian en el portal y el `.env` no se actualiza.

- Desde ese ciclo, cada 15 min, no baja ninguna factura ni nota de crédito.
- `GetTypesCFDI.log` no tiene ni una línea `[ERROR]`. `public/logs.html:946-947` colorea por `[ERROR]`/`[WARN]`, y esa línea `warn` se confunde con cualquier corte parcial.
- Con la respuesta sin `items` es peor: el operador lee "No hay CFDI de tipo I".

Ninguna prueba cubre una primera página sin `items`, ni una vacía sin `total` (P-11b sólo cubre la falta de `total` cuando sí hay items).

**Corrección:**
```js
// fetchCfdiPages, antes de pages++ (L539): una respuesta sin arreglo items es una falla, no una página vacía
const data = res.response?.data;
if (!Array.isArray(data?.items)) {
    stopReason = 'pagina-fallida';
    failedOffset = offset;
    error = new Error('respuesta del portal sin arreglo items');
    break;
}
const pageItems = data.items;

// getTypeI (L158) y getTypeE (L300): "no hay" sólo con el 0 de 0 que reportó el portal
if (page.stopReason === 'completo') {
    console.log('[INFO] No hay CFDI de tipo I');
}

// logPaginationSummary (L408): no se recibió nada y el listado no terminó => error, no warn
let nivel;
if (recibidas === 0 && stopReason !== 'completo') {
    nivel = 'error';
} else if (total !== null) {
    nivel = recibidas < total ? 'warn' : 'info';
} else {
    nivel = ['pagina-fallida', 'presupuesto', 'tope-paginas', 'sin-avance'].includes(stopReason) ? 'warn' : 'info';
}
```

Notas sobre la corrección:

- El tercer cambio afina D-17: P-15 y F-03b pasarían a esperar `error`.
- En `getPendingToPayInvoices`, el primer cambio convierte en `[]` una página mal formada a mitad de lista, que hoy devuelve una lista parcial. Es justo lo que REQ-24-03 quiere evitar.
- Agregar pruebas con `{ data: '<html>' }` y con `{ data: { items: [] } }` (sin `total`).

### WR-02: El presupuesto por consulta no acota el paso uploadPayments: con el portal colgado, cada `getCfdisByProvider` tarda 94.5 s en vez de 30 s

**Archivo:**
- `src/utils/GetTypesCFDI.js:334-338` (presupuesto), `:24-27` (la cuenta del comentario) y `:446-456` (reintento);
- llamador: `src/controller/PortalPaymentController.js:234-235`;
- paso: `src/background.js:168`.

**Problema:** la cuenta de L24-26 (2 × (75 s + 30 s) = 210 s < 300 s) vale para el paso downloadCFDI, que hace exactamente dos listados. `getCfdisByProvider` recibe el mismo presupuesto de 75 s, pero **por llamada**:

- `uploadPayments` la llama en serie, una vez por cada factura pagada sin UUID (vía `UuidResolver.js:20`);
- el número de llamadas no tiene tope;
- esas facturas se repiten en cada ciclo hasta que se resuelven.

El presupuesto no acota el paso. Medido con reloj falso, con un portal que acepta la conexión y no responde (cada intento muere por el timeout de 30 s con `ECONNABORTED`, que es reintentable):

- `dde4bd0`: 1 petición, 30.0 s por llamada.
- Rama: 3 intentos, **94.5 s por llamada**:
  - intento 1: de 0 a 30 s;
  - espera 1.5 s;
  - intento 2: de 31.5 a 61.5 s;
  - espera 3 s, porque 64.5 < 75;
  - intento 3: de 64.5 a 94.5 s.

**Escenario de falla:** se cuelga el listado de CFDIs del portal (es el endpoint pesado) y hay 4 facturas pagadas sin UUID.

- 4 × 94.5 s = 378 s > 300 s, así que aparece `[TIMEOUT] step=uploadPayments`.
- El `catch` por tenant (`background.js:296`) se salta createPurchaseOrders, processOrderChanges y closePurchaseOrders en ese ciclo, y en cada ciclo mientras dure la falla.
- Antes de la fase hacían falta 10 facturas.
- Después del corte, la continuación fantasma sigue llamando al portal durante N × 94.5 s (antes, N × 30 s).

**Corrección:** dar a `getCfdisByProvider` un presupuesto que no reintente un intento colgado y sí los fallos rápidos (429, 503, ECONNRESET):
```js
// getCfdisByProvider corre una vez por factura pagada sin UUID dentro de uploadPayments: el
// presupuesto por llamada no acota el paso. Con presupuesto <= timeout de axios, un intento que
// se cuelga ya no se reintenta (cuesta 30 s, como antes de la fase) y los fallos rápidos sí.
{ consulta: 'getCfdisByProvider', maxPages: CYCLE_MAX_PAGES,
  budgetMs: Math.min(listingBudgetMs(), config.portal.httpTimeoutMs) }
```

Qué cambia con esta corrección:

- Con 30 s, tras el primer intento colgado, 30 s + 1.5 s ≥ 30 s, así que corta por `presupuesto`.
- Un 503 rápido se sigue reintentando dos veces en unos 5 s.
- Sigue cumpliendo REQ-24-06 ("como máximo 25 %").
- P-16 a P-18 usan `getCfdisByProvider` para probar el presupuesto: habría que pasarlos a `getTypeI` o ajustar sus números.

Si se decide no tocarlo, documentar en el comentario de L24-26 y en el SPEC que la cota de 210 s no cubre uploadPayments y que ahí el peor caso es N × ~95 s.

## Info

### IN-01: La corrida de sólo lectura en producción no prueba que haya corrido la consulta en bloque de notas de crédito (`POCRNHO`)

**Archivo:** `src/utils/GetTypesCFDI.js:686-687`, `:709-712`

**Problema:** `porBloques` sólo consulta lo que sigue pendiente después de CxP (L686).

- En la corrida del 09-oct, getTypeE dio `recibidas=87 ya_en_sage=87`. Si las 87 salieron en `APIBHO`, `POCRNHO` nunca se ejecutó.
- Se comprobó con un escenario equivalente: con todas las notas en CxP, sólo se consultan `fesaParam` y `APIBHO`.
- El 24-04-SUMMARY lo da por "casi seguro".

El riesgo es bajo y falla del lado seguro:

- si el SQL de NC fallara, toda nota que no esté en CxP quedaría `error-sql`, no se bajaría y dejaría una línea `error`;
- la consulta usa las mismas tablas y columnas que la consulta por factura anterior.

Pero la línea `[FILTRO-SAGE]` no dice qué tablas se consultaron, así que el primer ciclo de producción tampoco lo va a demostrar.

**Corrección:** agregar al resumen el número de consultas por tabla (p. ej. `sql_rfc=1 sql_cxp=1 sql_doc=0`). Eso además hace observable REQ-24-08 en producción. Otra opción: confirmar `POCRNHO` aparte con una consulta de sólo lectura.

### IN-02: La excepción inesperada del filtro se registra sin stack

**Archivo:** `src/utils/GetTypesCFDI.js:742-744`

**Problema:** el `catch` externo de `filterNotInSage` sólo atrapa errores de programación, porque cada consulta tiene su propio try/catch. De esos errores registra 64 caracteres del mensaje y nada del stack.

Escenario: un `TypeError` en el conteo o en las líneas por factura deja `error_inesperado="Cannot read properties of undefined (reading 'x')"`, sin archivo ni línea. El ciclo devuelve `[]` cada 15 min y el log no permite ubicar la causa.

**Corrección:** registrar el stack en una sola línea, p. ej. `error_inesperado=${JSON.stringify(String(err?.stack ?? err).replace(/\s+/g, ' ').slice(0, 1000))}`.

### IN-03: "30 s de una petición en vuelo" no es una cota dura: el timeout de axios es de inactividad

**Archivo:** `src/utils/GetTypesCFDI.js:24-26`; `node_modules/axios/lib/adapters/http.js:650` (axios 1.7.7)

**Problema:** en Node, axios aplica `timeout` con `req.setTimeout`. Ese timeout corta tras 30 s **sin actividad** en el socket, no tras 30 s de duración total.

Escenario: el portal entrega una página (≈1.6 MB por página de 200) lento pero sin pausas largas.

- La petición sigue en vuelo más de 30 s.
- El presupuesto no puede cortarla, porque sólo se revisa entre peticiones.
- La cota de 210 s del comentario se rebasa, y sólo el corte de 5 min del paso la acota.

Es una propiedad previa del cliente compartido, no de esta fase, pero la cuenta nueva descansa en ella.

**Corrección:** si se quiere una cota dura, pasar en cada petición `signal: AbortSignal.timeout(Math.max(1, Math.min(config.portal.httpTimeoutMs, deadline - Date.now())))` cuando haya `deadline`, y mapear la cancelación (`ERR_CANCELED`) a `presupuesto`. Si no, ajustar el comentario.

### IN-04: El modelo de la base no exige `Parametro = 'RFCReceptor'` ni los JOIN de encabezado

**Archivo:** `tests/helpers/getTypesCfdiFakes.js:227-248`

**Problema:** `createSageDb` modela `ERRENTRY = 0` y `OPTFIELD = 'FOLIOCFD'`. No revisa:

- el predicado `Parametro = 'RFCReceptor'` de la consulta de RFC;
- los JOIN con `APIBH`, `POINVH1` y `POCRNH1`.

Escenario: un cambio futuro quita `Parametro = 'RFCReceptor'`. Cualquier fila de `fesaParam` con ese `VALOR` contaría como RFC registrado, y las 46 pruebas seguirían en verde, incluida la paridad F-05/F-06. Es justo la lección de 23-04 que cita D-23.

**Corrección:**
- que el modelo responda `NREG: 0` (o lance) si la consulta de `fesaParam` no trae `Parametro = 'RFCReceptor'`;
- agregar una aserción sobre el texto de cada consulta en bloque, con el JOIN y su condición incluidos.

### IN-05: SQL interpolado previo en código no tocado (riesgo diferido ya documentado)

**Archivo:** `src/utils/GetTypesCFDI.js:107`, `:116` (getTypeP); `:215-262` (getTypeIToSend)

**Problema:** estas consultas siguen interpolando el RFC y el UUID del portal sin validar. Está fuera del alcance de la fase y ya está registrado como diferido (T-24-08/T-24-16 y "SQL sin validar que sigue en getTypeP y getTypeIToSend" en 24-CONTEXT.md). Se menciona sólo para que no se pierda.

**Corrección:** la fase diferida que reutilice `UUID_REGEX` y `RFC_REGEX` (y el filtro en bloque) en getTypeP.

---

_Revisado: 2026-10-09T19:35:09Z_
_Revisor: Claude (gsd-code-reviewer)_
_Profundidad: standard_
