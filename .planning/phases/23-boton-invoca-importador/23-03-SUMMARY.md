---
phase: 23-boton-invoca-importador
plan: 03
status: partial
date: 2026-09-01
requirements_verified: [REQ-23-01, REQ-23-08]
requirements_blocked: [REQ-23-09]
key_files:
  modified:
    - "E:\\sageconnect-dist\\.env (servidor zcl-rds-test — DOWNLOADS_PATH y PROVIDERS_PATH)"
---

# Plan 23-03 — Verificacion en zcl-rds-test (PARCIAL)

**Estado: parcial.** REQ-23-01 y REQ-23-08 verificados con evidencia del servidor. REQ-23-09 (factura en Sage) **bloqueado por configuracion ajena a este repo**.

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

## REQ-23-05 — no observado, con causa identificada

El texto "Importando comprobantes a Sage..." no llego a verse. **No es un fallo de la UI:** el paso duro exactamente **2 segundos** (12:42:34 → 12:42:36) porque el `.exe` aborta enseguida, y la pagina consulta el estado cada **3.5 s**. Un paso mas corto que el intervalo del poll es invisible por construccion. Se podra observar cuando el importador procese archivos de verdad.

## REQ-23-09 — BLOQUEADO

La factura no llega a Sage. Dos causas, **ninguna en este repo**:

1. **`[CORREOAP] Para=` vacio** en `E:\Sage\Sage300\Macros\COPDAT.ini`. El `.exe` aborta al arrancar con `GetParam, Faltan especificar los parametros de la seccion [CORREOAP]`, antes de mirar ningun XML. Ocurre en **todas** las corridas; hay un XML sin procesar en `D:\XMLSFOCALTEC\` desde el **13-ene-2026**, asi que lleva roto mucho mas de un mes. Requiere a la autora del programa.
2. **Desajuste de carpetas — CORREGIDO hoy.** SageConnect escribia en `E:\sageconnect-dist\downloads` y el `.exe` lee `RutaFocaltec=D:\XMLSFOCALTEC\`. Se alinearon `DOWNLOADS_PATH` y `PROVIDERS_PATH` a `D:\XMLSFOCALTEC`, validado contra el `.env` de produccion, donde **ambas** variables apuntan a la misma carpeta del importador (`E:\XMLSFOCALTEC`).

## Hallazgo mayor: el `.exe` devuelve exit code 0 aunque falle

Los dos logs del **mismo segundo**, versiones opuestas de la realidad:

| Fuente | Que dice |
|---|---|
| `ChildProcess.log` (SageConnect) | `[CLOSE] Proceso de importacion finalizado correctamente con codigo 0` |
| `ImportaFactAPXML_Focaltec_20260901_124236.log` (el `.exe`) | `ERROR - GetParam, Faltan especificar los parametros...` |

**Ni el cron ni el boton pueden detectar una importacion fallida — tampoco en produccion.** La unica evidencia real vive en `C:\Logs\`, que nadie lee. Merece fase propia: leer esos logs, parsear stdout, o verificar contra Sage tras la importacion.

## Incidencias del despliegue (para no repetirlas)

- El primer clic no invoco nada porque **el `git checkout` de la rama del dist nunca se aplico**: el servidor seguia en el build de `f3ee5f5`, anterior a la fase. Verificar siempre `git log --oneline -1` en el servidor **antes** de probar.
- `servy-cli restart` fallo con el servicio a medias; `stop` + `start` por separado lo resolvio.
- En PowerShell, `curl` es alias de `Invoke-WebRequest` y no puede parsear las respuestas: usar `Invoke-RestMethod`. La ruta de salud es `/api/system/health`, no `/api/health`.

## Pendiente para cerrar la fase

1. `Para=` del `COPDAT.ini` de test — depende de la autora del importador.
2. Repetir el clic y verificar la factura en Sage.
3. Factura fresca para la demo: la ventana de descarga arranca el dia 1 del mes pasado, y **las 16 facturas de prueba locales son de julio o anteriores** (la mas reciente, 24-jul).
