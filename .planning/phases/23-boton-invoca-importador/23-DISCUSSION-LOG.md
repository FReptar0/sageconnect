# Phase 23: El botón de ejecución invoca el importador de comprobantes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-31
**Phase:** 23-boton-invoca-importador
**Areas discussed:** Ubicación del bloque del importador, Forma del encadenamiento, Ruteo de logs y correo, Detección del paso en la UI, Estrategia de tests y enforcement, Convivencia con la fase 22, Verificación operativa
**Mode:** `--auto` — el usuario delegó explícitamente las decisiones técnicas: *"tú toma las decisiones técnicas, siempre buscando que no falle, y que sea lo más óptimo siempre escogiendo la mejor opción"*. Ninguna pregunta se elevó al usuario; cada elección se resolvió contra evidencia del código y se registra abajo.

---

## Ubicación del bloque del importador

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Extraer a un helper compartido | Un solo lugar para el bloque; cron y botón lo invocan. Elimina el riesgo de divergencia por construcción. | |
| Duplicar el bloque en `schedule-routes.js` | Copia adaptada de `CronScheduler.js:100-150`, con las mismas variables y el mismo cuerpo de correo. | ✓ |
| Mover el bloque a `background.js` junto a `startChildProcess` | Cohesión conceptual: el envoltorio vive con lo que envuelve. | |

**Elección:** Duplicar. **Decisión forzada por evidencia, no preferencia de estilo.**

**Notas:** La primera inclinación fue extraer — duplicar 30 líneas que incluyen un cuerpo HTML de correo y un regex load-bearing es normalmente la peor opción. La lectura del suite de tests lo invirtió: cuatro casos existentes hacen `fs.readFileSync('src/services/CronScheduler.js')` y afirman sobre el **texto del archivo** —`timeout-logging.test.js:84-92` y `:95-99`, `CronScheduler.timeout-listener.test.js:288` y `:297-303`—. Cualquier extracción vacía ese archivo del texto que los tests exigen y rompe los cuatro; el REQ-6 prohíbe tocar sus assertions. La duplicación además coincide con PATTERNS.md §S-6 (extraer en el 3.er uso) y tiene precedente literal: `sendAdminAlert` vivió inline en estos mismos dos archivos hasta que apareció el 3.er sitio. El contador queda en 2/3.

El riesgo de divergencia no se acepta a secas: se neutraliza con el test de paridad sobre el fuente (ver más abajo).

---

## Forma del encadenamiento en el handler del trigger

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| `.then()` intermedio en la cadena existente | Un solo `.then()` entre `forResponse` y el `addHistory` de éxito. El `.catch` y el `.finally` actuales absorben el fallo del importador sin cambios. | ✓ |
| Reescribir el handler como `async` con `try/catch/finally` | Se parece más al cron línea por línea. | |
| Cadena separada tras `releaseLock` | El importador correría fuera del candado. | |

**Elección:** `.then()` intermedio.

**Notas:** Es el cambio de menor superficie que cumple REQ-1 y REQ-4 a la vez. Si `forResponse` rechaza, el importador no corre — mismo comportamiento que el `try` del cron. Si el importador rechaza, cae en el `.catch` que ya existe y produce `addHistory({success:false, errors:[msg]})` sin una sola línea nueva de manejo de error. `releaseLock` sigue en el `.finally`, así que el candado se libera pase lo que pase. La tercera opción se descartó de inmediato: sacar el importador del candado es exactamente el solape que la fase entera existe para evitar.

---

## Ruteo de logs y correo del camino manual

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| `ScheduleRoutes.log`, mismo asunto de correo | El wrapper local ya inyecta el `LOG_FILE` correcto; el asunto no cambia. | ✓ |
| Forzar todo a `CronScheduler.log` | Un solo archivo para buscar timeouts del importador. | |
| Asunto de correo distinto para el disparo manual | Distinguir origen desde la bandeja. | |

**Elección:** `ScheduleRoutes.log` + asunto idéntico.

**Notas:** Es gratis y es lo correcto: `schedule-routes.js:74-76` ya tiene el wrapper que pasa `LOG_FILE='ScheduleRoutes'`, que es justo el contrato que documenta la cabecera de `AdminEmailSender.js` (el parámetro `callerLogFile` existe para preservar el ruteo por archivo tras la extracción). El origen queda distinguible por el archivo de log; cambiar el asunto rompería los filtros de correo del admin sin aportar nada que el log no diga ya.

---

## Detección del paso y estados del botón en la UI

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Tercer estado `'importing'` con texto literal estático | `applyButtonState(running, importing)`; se compara contra el literal `'startChildProcess'` y se pinta un string fijo. | ✓ |
| Interpolar el nombre del paso que devuelve el API | Sirve para los 7 pasos sin escribir un mapa. | |
| Contador "Paso 8 de 8" | Da sensación de progreso. | |

**Elección:** Tercer estado con texto literal estático.

**Notas:** La página lleva una decisión previa documentada en su propio comentario (T-LKI-01): *"Todo el innerHTML es STRING ESTÁTICO: nunca se interpola nada que venga de la respuesta del API"* — por eso `ejecucion.html` no necesita `escapeHtml()`. Interpolar el nombre del paso rompería esa invariante y le agregaría a la página una superficie que hoy no tiene. El contador "Paso N de M" se descartó porque `stepProgress` cuenta entradas por tenant, no pasos globales: con varios tenants el denominador sería engañoso. La detección replica la semántica de `findLastOpenStep` (última entrada con `finishedAt` falsy) y es defensiva ante cualquier shape inesperado.

---

## Estrategia de tests y enforcement de la paridad

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Tests de comportamiento + test de paridad sobre el fuente | Casos con mocks en `schedule-routes.test.js` **y** aserciones sobre el texto de `schedule-routes.js` en `timeout-logging.test.js`. | ✓ |
| Solo tests de comportamiento | Menos archivos tocados. | |
| Solo revisión de código para la paridad | Cero tests nuevos. | |

**Elección:** Ambos.

**Notas:** Los tests de comportamiento prueban que el botón hace lo correcto; no prueban que siga haciendo **lo mismo que el cron** dentro de seis meses. Ese es precisamente el riesgo que introduce la duplicación de la primera decisión, y el repo ya tiene el mecanismo para cerrarlo: aserciones sobre el código fuente. Agregar las de `schedule-routes.js` al mismo bloque `describe('ROOT-02: ...')` donde ya viven las del cron deja los dos lados del invariante uno junto al otro. Sin esto, la duplicación sería deuda; con esto, es una copia verificada.

Se incluye deliberadamente el caso negativo (un error que **no** sea `Child process timeout` no debe mandar correo), replicando la disciplina D-15 que el cron ya tiene en sus propios tests.

---

## Convivencia con la fase 22

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Construir sobre el código actual, dependencia cero | La 23 no presupone `runSteps`/`STEP_REGISTRY`. | ✓ |
| Ejecutar la fase 22 primero | Llegar a la 23 con el refactor ya hecho. | |
| Fusionar ambas fases | Un solo cambio grande. | |

**Elección:** Dependencia cero.

**Notas:** La fase 22 está planeada pero no ejecutada (0/4 planes), bajó de prioridad y su diseño cambió a botones independientes, así que necesita replanificarse de todos modos. Encadenar la 23 a ella pondría la demo del miércoles detrás de un refactor de `background.js` — el archivo orquestador always-on, el de mayor radio de impacto del repo. La 23 mantiene huella mínima en los dos archivos compartidos. Nota de compatibilidad verificada: si algún día se ejecuta la 22 con `forResponse = runSteps(ALL_STEP_KEYS)`, la cadena `.then()` elegida sigue siendo válida sin tocarla, porque solo depende de que `forResponse` devuelva una promesa.

---

## Verificación operativa previa al end-to-end

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Leer `IMPORT_CFDIS_ROUTE` del servidor antes del ensayo | Confirmar `.exe` vs `.bat` antes de probar. | ✓ |
| Asumir que apunta al `.exe` | El cron funciona en producción, luego la ruta es válida. | |

**Elección:** Leerlo.

**Notas:** El razonamiento "el cron funciona, luego apunta al `.exe`" es probablemente correcto, pero es exactamente el tipo de suposición que CLAUDE.md §3 prohíbe dar por buena. Si apuntara a un `.bat`, Node 22 rechaza el `spawn` sin `shell: true` con `EINVAL` — y el ensayo fallaría con un error que no se parece en nada a su causa. Son treinta segundos de lectura contra una sesión de depuración a ciegas. Además cierra formalmente el pendiente de la minuta sobre el `.bat`.

---

## Claude's Discretion

El usuario delegó las decisiones técnicas por completo. Quedan abiertas para el planner/executor, acotadas por las decisiones de arriba:

- Nombres de variables locales del bloque duplicado — se sugiere conservar `__scpError` por simetría con el cron.
- Si el bloque va inline en el `.then()` o en una función local nombrada del mismo archivo — ambas cumplen las restricciones.
- Redacción exacta del texto de importación en la UI.
- Reparto en planes y waves.

## Deferred Ideas

- Etiquetas legibles para los 7 pasos en la UI, no solo el del importador — mejor UX en una espera larga, pero el SPEC fija "el resto del tiempo conserva el texto actual".
- Extracción del bloque a un helper compartido cuando aparezca el 3.er sitio de uso (§S-6) — obligará a actualizar las 4 aserciones sobre el fuente; hacerlo deliberadamente.
- Desbordamiento del candado de 14 min — decisión de negocio pendiente de Santiago + Hortensia.
- Alinear `DOWNLOADS_PATH` con la ruta interna del `.exe` — bloqueado hasta confirmación de Hortensia.
- `getTypeIToSend` como código muerto en `GetTypesCFDI.js:195`.
- `downloadCFDI` no espera a que terminen las descargas (`CFDI_Downloader.js:120-146`) — ajeno al botón, pero es el primer sospechoso si el ensayo end-to-end falla de forma intermitente.
