---
phase: 24-paginar-descarga-cfdi
fixed_at: 2026-10-12T21:55:15Z
review_path: .planning/phases/24-paginar-descarga-cfdi/24-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Fase 24: Reporte de correcciones de la revisión de código

**Corregido el:** 2026-10-12
**Revisión de origen:** `.planning/phases/24-paginar-descarga-cfdi/24-REVIEW.md` (`9289762`)
**Iteración:** 1
**Alcance:** los dos WARNING (no había BLOCKER). Las INFO se resolvieron como se indica abajo.

**Resumen:**
- Hallazgos en alcance: 2
- Corregidos: 2
- Omitidos: 0

En ambos casos las pruebas se escribieron primero:

1. Se corrieron contra el código previo, y fallaron exactamente las pruebas nuevas de cada corrección.
2. Se aplicó el cambio.
3. Se volvieron a correr las dos suites y `npm test` completo.

Se trabajó en línea, sin worktree, como las olas 1-4, con `SAGECONNECT_HOOKS_BYPASS=1`. Antes de cada commit se revisó la redacción a mano con el patrón de HANDOFF §1 y el arreglo `PATTERNS` del hook, con control positivo de cada patrón.

## Hallazgos corregidos

### WR-01: Un listado que no se pudo leer ya no deja `[ERROR]`, y una respuesta sin `items` queda en `info` diciendo "No hay CFDI"

**Archivos modificados:** `src/utils/GetTypesCFDI.js`, `tests/helpers/getTypesCfdiFakes.js`, `tests/utils/GetTypesCFDI.paginacion.test.js`, `tests/utils/GetTypesCFDI.filtro.test.js`
**Commit:** `29ed5cd`
**Corrección aplicada (D-32):**
- `requestCfdiPage`: una respuesta sin arreglo `items` es página fallida. Deja `[PAGINACION-INTENTO] … status=sin-items accion=abandonar` y no reintenta. En `getPendingToPayInvoices`, una página así a media lista devuelve `[]` (todo o nada).
- `logPaginationSummary`: nivel `error` cuando `recibidas=0` y el corte no es `completo`.
- `getTypeI`/`getTypeE`: "No hay CFDI" sólo con `corte=completo` (el 0 de 0 que reporta el portal).
- Pruebas:
  - P-15 y F-03(b) esperan `error`.
  - Nuevas: P-29 (primera página HTML), P-30 (página sin items a media lista en `getPendingToPayInvoices`), P-31 (primera página vacía sin total), F-19 y F-20 (con `getTypeI` y con `getTypeE`).
  - Opción `bodies` en `createPortal`.
- Antes del cambio fallaron exactamente esas 9.

### WR-02: El presupuesto por consulta no acota el paso uploadPayments: con el portal colgado, cada `getCfdisByProvider` tarda 94.5 s en vez de 30 s

**Archivos modificados:** `src/utils/GetTypesCFDI.js`, `tests/utils/GetTypesCFDI.paginacion.test.js`
**Commit:** `6581a97`
**Corrección aplicada (D-33):**
- `providerListingBudgetMs()` = min(25 % de `stepTimeoutMs`, `httpTimeoutMs`), leída en cada llamada y con guarda contra NaN. La usa sólo `getCfdisByProvider`; `getTypeI`/`getTypeE` siguen con 75 s.
- El comentario del presupuesto ahora dice dos cosas:
  - la cota de 210 s es del paso downloadCFDI;
  - los ~30 s del timeout de axios son de inactividad del socket, no una cota dura (IN-03).
- Pruebas:
  - P-16 a P-18 aíslan el 25 % con `httpTimeoutMs = 300000` y `afterEach` lo restaura.
  - P-26: intento colgado → 1 llamada, 30 s, sin espera de reintento, en `error`.
  - P-27: un 503 rápido se sigue reintentando. Es un ancla: pasa antes y después.
  - P-28: el tope sigue al timeout de axios, leído por llamada.
- Antes del cambio fallaron exactamente P-26 y P-28.

## Observaciones informativas (fuera del alcance de los WARNING)

| ID | Qué se hizo |
|---|---|
| IN-01 | **Atendida en documentación:** `96e0cbe` corrige el SUMMARY de 24-04, porque `POCRNHO` no quedó demostrado en el ejercicio con datos de producción. **Diferido:** el contador de consultas por tabla en `[FILTRO-SAGE]` (cambio de formato de D-18). **Pendiente operativo:** confirmar `POCRNHO` con una consulta de sólo lectura al repetir el ejercicio antes del despliegue. |
| IN-02 | Diferida: stack de la excepción inesperada del filtro en una sola línea. Es mejora de diagnóstico, no de comportamiento. |
| IN-03 | Corregida en el comentario del presupuesto (commit `6581a97`). No se agregó cota dura con `AbortSignal`: el comentario ya no promete una. |
| IN-04 | Diferida: que el modelo de la base exija `Parametro = 'RFCReceptor'` y los JOIN de encabezado. La paridad contra el esquema real ya la probó el ciclo en zcl-rds-test (24-04). |
| IN-05 | Diferida a la fase que reutilice `UUID_REGEX`/`RFC_REGEX` y el filtro en bloque en `getTypeP`/`getTypeIToSend`. Se registra en CONCERNS.md al cerrar la fase. |

## Verificación

**Las dos suites de la fase:** 56/56.

**`npm test`:** 489 pasan de 497. Fallan las mismas 6 suites / 7 pruebas de la línea base:
- `PaymentReconciliation`, `TransformTime`, `no-process-exit` y `enforcement-wiring`, con 7 pruebas;
- `config` y `operation-manager` no llegan a correr porque `config.js` hace `process.exit(1)` con el `.env` local.

En la primera corrida completa, `tests/api/payment-routes.test.js` falló una vez. Pasó sola y en la corrida siguiente, y simula `GetTypesCFDI` entero (línea 131), así que es intermitente y ajena a la fase.

**Alcance:** los mismos 4 archivos de la fase.

**Prueba negativa** (las dos suites contra otro `GetTypesCFDI.js`, restaurado después con `cmp`):

| Contra | Fallan | Pasan | Errores de programa |
|---|---|---|---|
| `5e57893` (previo a las correcciones) | 11: F-03, F-19 ×2, F-20 ×2, P-15, P-26, P-28 y P-29 a P-31 | 45 | 0 |
| `origin/master` | 46 | 10, las mismas anclas: P-01, P-19 a P-22, F-05 ×2, F-06 ×2 y F-17 | 0 |

La clasificación quedó en el encabezado de cada suite.

---

_Corregido: 2026-10-12_
_Corrigió: Claude (en línea, siguiendo `data-sageconnect/handoffs/2026-10-09-cierre-fase-24.md`)_
_Iteración: 1_
