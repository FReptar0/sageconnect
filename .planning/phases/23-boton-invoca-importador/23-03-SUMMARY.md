---
phase: 23-boton-invoca-importador
plan: 03
status: complete
date: 2026-09-07
date_partial: 2026-09-01
requirements_verified: [REQ-23-01, REQ-23-05, REQ-23-08, REQ-23-09]
requirements_blocked: []
key_files:
  modified:
    - "E:\\sageconnect-dist\\.env (servidor zcl-rds-test — DOWNLOADS_PATH y PROVIDERS_PATH)"
---

# Plan 23-03 — Verificacion en zcl-rds-test (COMPLETO)

**Estado: completo.** La cadena Portal → XML → `ImportaFacturasFocaltec.exe COPDAT` → Sage quedo probada de punta a punta desde el boton manual.

El plan se ejecuto en dos tiempos. El **01-sep** se verificaron REQ-23-01 y REQ-23-08 con evidencia de archivo, y REQ-23-05/REQ-23-09 quedaron bloqueados por una configuracion de Sage ajena a este repo. Resuelta esa configuracion, el **07-sep** se cerraron los dos requisitos restantes.

## REQ-23-01 — VERIFICADO: el boton invoca al importador

Clic manual en `/ejecucion.html` a las 12:42 del 2026-09-01. `ChildProcess.log` del dia:

```
2026-09-01 03:01:12  [CLOSE] ... codigo 0                       <- cron
2026-09-01 12:42:34  [INFO] Iniciando proceso de importacion     <- CLIC MANUAL
2026-09-01 12:42:34  [INFO] Child process iniciado con PID: 3176
2026-09-01 12:42:36  [CLOSE] ... codigo 0
```

El importador escribio su propio log `C:\Logs\ImportaFactAPXML_Focaltec_20260901_124236.log`. **El cron solo corre a las 03:01**, asi que un log con marca 12:42:36 solo pudo generarlo el boton. Evidencia inequivoca.

**Reproducido una segunda vez a las 16:01**, con resultado identico: `16:01:43` arranque (PID 13636) → `16:01:44` `[CLOSE] ... codigo 0`, y `ImportaFactAPXML_Focaltec_20260901_160144.log` con el mismo error de `[CORREOAP]`. Dos reproducciones independientes separadas por 3.5 horas: no es un caso aislado.

## REQ-23-08 — VERIFICADO: no hay ningun `.bat`

`IMPORT_CFDIS_ROUTE` en zcl-rds-test apunta al `.exe` directo (visible en el propio `ChildProcess.log`), con `ARG: COPDAT`. **No hay wrapper `.bat`**, asi que la trampa de `EINVAL` en Node 22 no aplica. Cierra el pendiente de la reunion del 31-ago.

## REQ-23-05 — VERIFICADO: el tercer estado del boton se ve

**Confirmado por el operador el 2026-09-07.** El boton pasa por "Importando comprobantes a Sage..." durante la invocacion del importador.

Por que no se vio el 01-sep y ahora si: **no era un fallo de la UI**. El paso duraba exactamente 2 segundos (12:42:34 → 12:42:36) porque el `.exe` abortaba al arrancar, y la pagina consulta el estado cada 3.5 s — un paso mas corto que el intervalo del poll es invisible por construccion. Con el importador procesando archivos de verdad, el paso dura lo suficiente y el estado se pinta. La hipotesis registrada el 01-sep queda confirmada.

## REQ-23-09 — VERIFICADO: la factura llega a Sage

**Confirmado por el operador el 2026-09-07: la factura aparece en Cuentas por Pagar de Sage.** Es el unico criterio que cuenta para esta fase y cierra la cadena completa desde el boton.

Las dos causas que lo bloqueaban quedaron resueltas:

1. **`[CORREOAP] Para=` vacio** en `E:\Sage\Sage300\Macros\COPDAT.ini` — **RESUELTO**. El `.exe` abortaba al arrancar con `GetParam, Faltan especificar los parametros de la seccion [CORREOAP]`, antes de mirar ningun XML. Ocurria en **todas** las corridas; habia un XML sin procesar en `D:\XMLSFOCALTEC\` desde el **13-ene-2026**, asi que llevaba roto mas de siete meses. **No era un defecto de SageConnect:** ese archivo es configuracion de Sage 300 compartida por otros procesos, y el arreglo dependia de la autora del importador.
2. **Desajuste de carpetas — CORREGIDO el 01-sep.** SageConnect escribia en `E:\sageconnect-dist\downloads` y el `.exe` lee `RutaFocaltec=D:\XMLSFOCALTEC\`. Se alinearon `DOWNLOADS_PATH` y `PROVIDERS_PATH` a `D:\XMLSFOCALTEC`, validado contra el `.env` de produccion, donde **ambas** variables apuntan a la misma carpeta del importador (`E:\XMLSFOCALTEC`).

**Nota sobre el registro de evidencia:** el cierre de REQ-23-05 y REQ-23-09 es por confirmacion directa del operador, no por evidencia pegada en este documento. La captura del tercer estado, la hora del clic, el log del `.exe` de ese dia y el XML movido a `D:\XMLSFOCALTEC\PROCESADO\` no quedaron transcritos aqui. Si se quiere el expediente completo para la fase, es lo unico que falta anexar.

## Hallazgo mayor, ahora mas urgente: el `.exe` devuelve exit code 0 aunque falle

Los dos logs del **mismo segundo**, versiones opuestas de la realidad:

| Fuente | Que dice |
|---|---|
| `ChildProcess.log` (SageConnect) | `[CLOSE] Proceso de importacion finalizado correctamente con codigo 0` |
| `ImportaFactAPXML_Focaltec_20260901_124236.log` (el `.exe`) | `ERROR - GetParam, Faltan especificar los parametros...` |

**Ni el cron ni el boton pueden detectar una importacion fallida — tampoco en produccion.** La unica evidencia real vive en `C:\Logs\`, que nadie lee.

Este hallazgo **no se cierra con la fase**. Al contrario: mientras el importador abortaba siempre, el punto era teorico; ahora que procesa de verdad, un fallo silencioso es un escenario vivo — y el `Para=` roto desde enero, invisible durante siete meses, es la prueba de cuanto puede durar sin que nadie se entere. Merece fase propia: leer los logs de `C:\Logs\`, parsear stdout, o verificar contra Sage tras importar.

## Incidencias del despliegue (para no repetirlas)

- El primer clic no invoco nada porque **el `git checkout` de la rama del dist nunca se aplico**: el servidor seguia en el build de `f3ee5f5`, anterior a la fase. Verificar siempre `git log --oneline -1` en el servidor **antes** de probar.
- `servy-cli restart` fallo con el servicio a medias; `stop` + `start` por separado lo resolvio.
- En PowerShell, `curl` es alias de `Invoke-WebRequest` y no puede parsear las respuestas: usar `Invoke-RestMethod`. La ruta de salud es `/api/system/health`, no `/api/health`.
