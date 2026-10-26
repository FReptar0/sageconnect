# Phase 24: Paginar la descarga de CFDIs - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-08
**Phase:** 24-paginar-descarga-cfdi
**Areas discussed:** Corte de la paginación, Presupuesto de tiempo, Filtro SQL en bloque, Registro, Pruebas, Verificación en vivo

Yahir delegó todas las decisiones técnicas ("sigue tomando las decisiones técnicas más óptimas"). Ninguna área cambia el producto ni toca producción, así que el agente eligió en cada una y dejó aquí las alternativas descartadas.

---

## Corte de la paginación

| Option | Description | Selected |
|--------|-------------|----------|
| Contar items crudos hasta `total` (como `getPendingToPayInvoices` hoy) | Simple; si el portal ignorara `offset`, llegaría a `total` con duplicados y cortaría en silencio | |
| Contar únicos + corte por página sin avance + página vacía | Detecta un portal que repite páginas; nunca corta en silencio | ✓ |
| Agregar regla de "página corta = última" | Ahorra una petición sólo cuando `total` falla; si el portal bajara su tope de página, truncaría | |

**User's choice:** delegado → únicos + `sin-avance` + página vacía, sin regla de página corta (D-04, D-05).
**Notes:** páginas en serie, no en paralelo (429 del portal, contabilidad del presupuesto).

---

## Presupuesto de tiempo

| Option | Description | Selected |
|--------|-------------|----------|
| Sin presupuesto (sólo reintentos acotados) | 4 páginas × 3 intentos × 30 s rebasan el paso de 5 min con el portal enfermo | |
| Presupuesto por consulta = 25 % de `stepTimeoutMs` | Peor caso 210 s de 300 s; sin variable nueva; `warn` propio | ✓ |
| Presupuesto compartido por paso | Exigiría tocar `CFDI_Downloader.js` o estado de módulo | |
| Cursor entre ciclos desde ya | Cubre lentitud persistente, pero agrega estado entre ciclos sin evidencia de que haga falta | |

**User's choice:** delegado → 25 % por consulta (D-10); el cursor queda diferido con su disparador anotado.

---

## Filtro SQL en bloque

| Option | Description | Selected |
|--------|-------------|----------|
| Literales validados por regex dentro de `runQuery` | Mismo patrón y misma guarda `USE [DB]`; lista blanca impide inyección | ✓ |
| Parámetros de mssql vía `getPool()` | Duplicaría el `USE [DB]` fuera de `runQuery` y complica los mocks | |
| Cambiar `runQuery` para aceptar parámetros | Utilidad compartida: pitfall §6.2, fuera de alcance (REQ-24-15) | |

| Option | Description | Selected |
|--------|-------------|----------|
| RFC: una consulta por RFC distinto, idéntica a la actual | R = 1-2; semántica probada | ✓ |
| RFC: un solo `IN` de RFCs | Ahorra 0-1 consultas; cambia la forma de la consulta | |

| Option | Description | Selected |
|--------|-------------|----------|
| `IN` con el UUID tal como viene del portal | Coincide con lo mismo que el `=` actual con cualquier intercalación | ✓ |
| `IN` con el UUID en mayúsculas (como el rescate) | Depende de que la intercalación no distinga mayúsculas | |

**User's choice:** delegado → D-12 a D-16.

---

## Registro

| Option | Description | Selected |
|--------|-------------|----------|
| Una línea por cada factura recibida (como hoy, ~860/ciclo con 772 pendientes) | Compatible con el diagnóstico actual; el volumen crece con los pendientes | |
| Resumen por consulta y por filtro + línea por factura sólo para a-descargar y anomalías, en `GetTypesCFDI.log` | Escala; el registro de auditoría es winston (CLAUDE.md §5) | ✓ |

**User's choice:** Yahir aclaró que los scripts del servidor se ajustan fácilmente y que la prioridad es que no vuelva a ocurrir → segunda opción (D-17 a D-21).

---

## Pruebas

| Option | Description | Selected |
|--------|-------------|----------|
| Mock de `runQuery` que devuelve respuestas fijas por orden de llamada | Frágil; no puede producir el estado real | |
| Mock que modela la base (dataset + lectura del SQL) | Lección de la fase 23-04; permite paridad y conteo reales | ✓ |

**User's choice:** delegado → D-22 a D-26, con prueba negativa obligatoria contra el código de `origin/master`.

---

## Verificación en vivo

| Option | Description | Selected |
|--------|-------------|----------|
| Script de diagnóstico nuevo en `src/scripts/` | Violaría REQ-24-15 (sólo `GetTypesCFDI.js` en `src/`) | |
| Script `.sh` de sólo lectura fuera del repo, en el servidor de test | Patrón probado del diagnóstico del 05-oct | ✓ |
| Postman desde la máquina de Yahir | Válido como respaldo | |

**User's choice:** delegado → D-27 a D-29; push, workflow y reinicio de test con OK de Yahir en el momento.

---

## Claude's Discretion

- Nombres de funciones internas; generalizar o sustituir `requestPendingToPayPage`.
- División en planes (sugerida: 24-01 paginación, 24-02 filtro y registro, 24-03 verificación).
- Texto exacto de `detalle=` y de los mensajes de error.

## Deferred Ideas

- Cursor entre ciclos; parametrizar SQL; páginas en paralelo; correo con límite de frecuencia; `pageSize` > 200; paginar `getTypeP`; robustez del downloader; retirar el rescate y ajustar el diagnóstico; botón de XML antiguos; scripts con `pageSize=0`.
