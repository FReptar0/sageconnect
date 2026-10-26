---
phase: quick-260730-lki
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - public/ejecucion.html
autonomous: false
requirements: [QT-260730-LKI-01]
branch: feat/boton-ejecucion

must_haves:
  truths:
    - "Con un ciclo corriendo (disparado por el cron de 15 min o por otro operador), al abrir /ejecucion.html el boton aparece deshabilitado con 'Sincronizando...' en <=3.5s sin que el usuario haga nada"
    - "Al terminar el ciclo, el boton se re-habilita solo con el label 'Ejecutar proceso ahora' y los campos Ultima/Proxima ejecucion se refrescan"
    - "Si GET /api/operations/status falla (red caida, 401, 500), el boton NO queda trabado: vuelve al estado habilitado"
    - "Mientras el POST de disparo esta en vuelo, el poll no pisa el label 'Iniciando...' ni re-habilita el boton"
    - "El polling no dispara toasts repetidos ante fallos de red"
    - "El setInterval del polling se limpia en beforeunload"
  artifacts:
    - path: "public/ejecucion.html"
      provides: "Poll de estado real del ciclo + maquina de estados del boton"
      contains: "operations['background-cycle']"
  key_links:
    - from: "public/ejecucion.html"
      to: "GET /api/operations/status"
      via: "fetch dentro de pollCycleState(), setInterval 3500ms"
      pattern: "api/operations/status"
    - from: "pollCycleState()"
      to: "applyButtonState()"
      via: "acceso directo al mapa operations['background-cycle']"
      pattern: "operations\\['background-cycle'\\]"
---

<objective>
Hacer que el boton de `public/ejecucion.html` refleje el estado REAL del ciclo de sincronizacion, no solamente la duracion de su propio POST.

Purpose: hoy el operador (Memo) puede ver el boton habilitado mientras el cron de 15 minutos ya esta corriendo un ciclo. Hace click, recibe un 409 confuso ("El ciclo ya esta en ejecucion"), y no tiene forma de saber cuando puede volver a intentar. El poll a `/api/operations/status` convierte el boton en un indicador honesto del estado del servicio.

Output: `public/ejecucion.html` modificado. Un solo archivo. Cero cambios en `src/**`, cero tests nuevos, cero dependencias nuevas.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@HANDOFF.md
@.planning/STATE.md

Archivo a modificar (unico):
@public/ejecucion.html

Patron de referencia YA existente en el repo (leer si hace falta, NO modificar):
@public/schedule.html

Helpers globales disponibles (NO modificar):
@public/js/shared.js
</context>

<interfaces>
Contratos que el ejecutor necesita. Ya verificados contra el codigo fuente durante la planeacion.
NO explorar el codebase: todo lo necesario esta aqui.

**GET /api/operations/status** — definido en `src/routes/operations-routes.js:39`. Montado con `requireLicense` unicamente, SIN `requireApiKey` (ver `src/routes/routes.js:12`). Forma de la respuesta:

    {
      success: true,
      data: {
        operations: {                      // MAPA con clave operationType — NO es un array
          'background-cycle': {
            operationId:  string,
            startedAt:    string (ISO),
            stepProgress: Array de { step, tenant, startedAt, finishedAt, error }
          }
        }
      }
    }

Cuando no hay nada corriendo, `operations` es un objeto vacio `{}`.

**REGLA DURA (bug D-04 de la Fase 17, ya corregido en schedule.html — no reintroducirlo):**
`operations` es un MAPA, no un array. Usar acceso directo `operations['background-cycle']`.
NUNCA `operations.find(...)` — sobre un objeto plano siempre devuelve `undefined` y el bug es silencioso.

**Patron de referencia en `public/schedule.html`** (leer solo si se necesita mas detalle):
- `pollActiveOperation()` — L709-738: acceso directo al mapa, try/catch, sin re-lanzar.
- Handles de `setInterval` en variables de modulo — L278-279, asignados en L295-298.
- Cleanup con `clearInterval` en `beforeunload` — L917-930.

**Helpers globales de `public/js/shared.js`** (ya cargados por el `script src="js/shared.js"` que existe en la pagina):

    function resolveApiKey(): string | null   // lee meta[name=x-app-key] inyectado por el server, fallback localStorage
    function formatDateTime(iso: string): string
    async function apiCall(method, path, body = null): Promise<object>
    // OJO: apiCall, ante un rechazo de fetch, hace showToast('Error de red: ...') Y re-lanza (shared.js:92)

`public/ejecucion.html` se sirve via `src/server.js:147` con `serveHtmlWithKey('ejecucion.html')`, por lo que el `meta name="x-app-key"` esta presente en runtime.

**Markup actual del boton** (`public/ejecucion.html:72-74`) — el label "idle" debe reproducirse exactamente:

    <i class="fas fa-play me-2"></i>Ejecutar proceso ahora

**Label "Iniciando" actual** (`public/ejecucion.html:121`) — propiedad exclusiva de `ejecutar()`, el poll no lo toca:

    <i class="fas fa-spinner fa-spin me-2"></i>Iniciando...
</interfaces>

<decisions>
Decisiones ya tomadas. El ejecutor las implementa, no las re-discute.

- **D-01 — Intervalo de poll: 3500 ms.** Dentro del rango 3-4s pedido. Constante nombrada `POLL_INTERVAL_MS` al tope del script.

- **D-02 — El poll usa `fetch` directo, NO `apiCall()`.** Motivo: `apiCall()` dispara `showToast('Error de red: ...')` en cada rechazo de fetch (`public/js/shared.js:92`). Con un poll cada 3.5s, una laptop que pierde wifi generaria una cascada de toasts apilados en la cara del operador. Es la misma limitacion ya registrada en `.planning/STATE.md` como follow-up no-bloqueante "apiCall toast suppression". Como `shared.js` esta fuera de alcance (no se puede modificar), el poll usa `fetch` + `resolveApiKey()` (helper global, reutilizado sin tocarlo). `loadStatus()` y `ejecutar()` SIGUEN usando `apiCall()` — ahi el toast si es deseable porque hay una accion del usuario detras.

- **D-03 — Fail-safe = re-habilitar.** Cualquier fallo del poll (excepcion de red, `res.ok === false`, JSON invalido, shape inesperado) se trata como "no hay ciclo corriendo" y deja el boton habilitado. Nunca se deja el boton deshabilitado por falta de informacion. Un click de mas devuelve un 409 inofensivo; un boton trabado para siempre deja al operador sin salida.

- **D-04 — Bandera `triggerInFlight` para resolver la carrera.** `ejecutar()` la pone en `true` ANTES de deshabilitar el boton, y en `false` en su `finally`. `applyButtonState()` hace `return` inmediato cuando la bandera esta arriba: mientras el POST vuela, `ejecutar()` es duena unica del boton y el poll no puede pisar "Iniciando..." ni re-habilitar prematuramente.

- **D-05 — Estado optimista post-disparo.** Al soltar la bandera en el `finally`, si el POST fue exito (hay `operationId`) o fue 409 (ya corriendo), se marca el estado como "corriendo" de inmediato en vez de esperar al siguiente tick. Evita un parpadeo de hasta 3.5s en el que el boton se veria habilitado justo despues de disparar. El siguiente poll corrige el estado si hiciera falta.

- **D-06 — Escritura idempotente al DOM.** `applyButtonState()` guarda el estado actual en `btn.dataset.uiState` (`'running'` | `'idle'`) y solo escribe `innerHTML` cuando el estado deseado difiere. Sin esta guarda, reescribir el `innerHTML` cada 3.5s reinicia la animacion del spinner y produce un tironeo visible.

- **D-07 — Refresco de Ultima/Proxima solo en el flanco corriendo -> detenido.** Se mantiene `lastKnownRunning` (`true` | `false` | `null`). `loadStatus()` se llama solo cuando un poll EXITOSO observa la transicion `true -> false`. Un poll fallido pone `lastKnownRunning = null` (desconocido) para no fabricar un flanco falso ante un parpadeo de red.

- **D-08 — Texto sin acentos en el markup visible.** Esta pagina usa ASCII ("Ultima ejecucion", "Ejecucion manual del proceso", "Iniciando..."). El label nuevo es `Sincronizando...` con TRES PUNTOS ASCII. NO usar `Sincronizando…` (elipsis U+2026) ni acentos en texto visible nuevo. En los comentarios de codigo los acentos si estan permitidos (el archivo ya los tiene).

- **D-09 — Sin dependencias nuevas.** Cero CDNs nuevos, cero tags `script` adicionales, cero paquetes npm.
</decisions>

<tasks>

<task type="auto">
  <name>Task 1: Poll de estado real + maquina de estados del boton en ejecucion.html</name>
  <files>public/ejecucion.html</files>
  <action>
Modificar UNICAMENTE el bloque `script` inline de `public/ejecucion.html` (actualmente L85-148). No tocar el `head`, ni el `style`, ni el markup del `body`. Indentacion de 4 espacios (CLAUDE.md seccion 5).

**1. Estado de modulo** — declarar al inicio del script, antes de `loadStatus()`, con un comentario de bloque explicando el proposito de cada variable:

- `const POLL_INTERVAL_MS = 3500;` (D-01)
- `let pollHandle = null;` — id del `setInterval`, se limpia en `beforeunload`
- `let triggerInFlight = false;` — true desde el click hasta que el POST se resuelve (D-04)
- `let lastKnownRunning = null;` — ultimo estado observado por un poll exitoso; `null` = desconocido (D-07)

Documentar en el comentario POR QUE existe `pollHandle`: la disciplina always-on de CLAUDE.md seccion 3 exige que todo timer declare como se limpia. Aunque esta pagina corra en el cliente y no en el servicio, la convencion del repo se respeta (mismo patron que `activeOpPollHandle` en `public/schedule.html:278`).

**2. `applyButtonState(running)`** — funcion nueva, unica duena de escribir en el boton fuera de `ejecutar()`:

- Si `triggerInFlight` es `true` entonces `return` inmediato sin tocar nada (D-04).
- Calcular `desired = running ? 'running' : 'idle'`. Si `btn.dataset.uiState === desired` entonces `return` (D-06).
- Estado `running`: `btn.disabled = true` y el `innerHTML` es el icono spinner (clases `fas fa-spinner fa-spin me-2`) seguido del texto `Sincronizando...` (D-08, tres puntos ASCII).
- Estado `idle`: `btn.disabled = false` y el `innerHTML` es exactamente el markup de L73: icono `fas fa-play me-2` seguido de `Ejecutar proceso ahora`.
- Escribir `btn.dataset.uiState = desired` al final.
- Todo el `innerHTML` es STRING ESTATICO: nunca se interpola nada proveniente de la respuesta del API.

**3. `pollCycleState()`** — funcion `async` nueva, adaptacion del patron de `pollActiveOperation()` (`public/schedule.html:709-738`):

- Usa `fetch('/api/operations/status', { headers })` directo, NO `apiCall()` (D-02). Headers: `Accept: application/json`, mas `x-api-key` con el valor de `resolveApiKey()` solo si devuelve algo distinto de null (el endpoint no lo exige, solo pide licencia, pero enviarlo es consistente con el resto de la pagina y es inofensivo).
- Envolver TODO en `try/catch`. En el `catch`, y tambien en cualquier rama de shape invalido: `console.warn(...)`, `lastKnownRunning = null`, `applyButtonState(false)`, `return`. Ese es el fail-safe de D-03: sin toast, sin re-lanzar.
- Si `!res.ok` entonces tratar como fallo (misma rama de fail-safe).
- Parsear el JSON y validar `json && json.success && json.data && json.data.operations`. Shape invalido entonces fail-safe.
- Determinar el estado con acceso DIRECTO al mapa:
  `const running = Boolean(json.data.operations['background-cycle']);`
  Anadir un comentario inline citando el bug D-04 de la Fase 17: `operations` es un MAPA con clave `operationType`, NUNCA usar `.find()`.
- Deteccion de flanco (D-07): si `lastKnownRunning === true && running === false` entonces llamar `loadStatus()` para refrescar Ultima/Proxima ejecucion. Solo en esta rama de poll exitoso.
- Asignar `lastKnownRunning = running;` y llamar `applyButtonState(running);`.

**4. Modificar `ejecutar()`** (actualmente L116-142). Cambios minimos: el flujo del POST y el manejo del 409 se conservan intactos, incluidos los mensajes de `#msg`.

- Primera linea del cuerpo: `triggerInFlight = true;` (antes de `btn.disabled = true`).
- Declarar `let startedOk = false;` antes del `try`. Ponerlo en `true` en las DOS ramas que implican que hay un ciclo vivo: (a) exito con `res.data.operationId`, y (b) la rama de 409 / `res.errors` (D-05).
- Reemplazar el `finally` actual (hoy hace `btn.disabled = false` + restaurar innerHTML + `loadStatus()`). Pasa a hacer, en este orden:
  1. `triggerInFlight = false;`
  2. Si `startedOk`: `lastKnownRunning = true;` luego `btn.dataset.uiState = 'idle';` luego `applyButtonState(true);`
     El reseteo de `dataset.uiState` es NECESARIO: `ejecutar()` dejo el boton mostrando "Iniciando..." pero el dataset podria seguir marcando `'running'`, y la guarda de idempotencia de D-06 haria que `applyButtonState` no escribiera nada, dejando el label "Iniciando..." congelado.
  3. Si NO `startedOk`: `btn.dataset.uiState = null;` luego `applyButtonState(false);` (vuelve al estado habilitado).
  4. `loadStatus();`
  5. `pollCycleState();` — poll inmediato que reconcilia con la verdad del servidor sin esperar al siguiente tick.

**5. Modificar el `DOMContentLoaded`** (actualmente L144-147): tras `loadStatus()`, anadir `pollCycleState();` (llamada inicial: cubre el caso de abrir la pagina con un ciclo ya corriendo) y luego `pollHandle = setInterval(pollCycleState, POLL_INTERVAL_MS);`.

**6. Anadir el bloque de cleanup** al final del script, replicando `public/schedule.html:917-930`: un listener de `beforeunload` que, si `pollHandle` existe, hace `clearInterval(pollHandle)` y lo pone en `null`.

**Prohibiciones explicitas para esta task:**
- NO editar ningun archivo bajo `src/**`. Si parece necesario un cambio de backend, PARAR y reportarlo al usuario: es un no-go explicito.
- NO editar `public/js/shared.js`, `public/schedule.html`, ni ningun otro HTML.
- NO crear ni modificar tests.
- NO usar `operations.find(...)`.
- NO anadir dependencias, CDNs ni tags `script` nuevos.
- NO usar la elipsis Unicode ni acentos en texto visible nuevo.
  </action>
  <verify>
    <automated>node -e "const fs=require('fs'),vm=require('vm'),LT=String.fromCharCode(60),GT=String.fromCharCode(62);const h=fs.readFileSync('public/ejecucion.html','utf8');const m=[...h.matchAll(new RegExp(LT+'script'+GT+'([^]*?)'+LT+'/script'+GT,'g'))];if(!m.length)throw new Error('no inline script block found');new vm.Script(m.map(x=>x[1]).join('\n'));console.log('SYNTAX OK ('+m.length+' inline block)')"</automated>
    <automated>grep -c "operations\['background-cycle'\]" public/ejecucion.html</automated>
    <automated>test $(grep -c "operations\.find" public/ejecucion.html) -eq 0 && echo "OK: sin .find() sobre el mapa operations"</automated>
    <automated>grep -q "clearInterval(pollHandle)" public/ejecucion.html && grep -q "beforeunload" public/ejecucion.html && echo "OK: timer cleanup presente"</automated>
    <automated>grep -q "Sincronizando\.\.\." public/ejecucion.html && test $(grep -c "Sincronizando…" public/ejecucion.html) -eq 0 && echo "OK: label ASCII"</automated>
    <automated>git status --porcelain | grep -v "^?? " | grep -v "public/ejecucion.html" | grep -q . && echo "FALLO: hay otros archivos modificados" && exit 1 || echo "OK: solo public/ejecucion.html modificado"</automated>
    <automated>npm test 2>&1 | tail -25</automated>
  </verify>
  <done>
- `public/ejecucion.html` contiene `POLL_INTERVAL_MS`, `pollHandle`, `triggerInFlight`, `lastKnownRunning`, `applyButtonState()`, `pollCycleState()` y el listener de `beforeunload` con `clearInterval`.
- El chequeo de sintaxis imprime `SYNTAX OK (1 inline block)`.
- `grep` confirma acceso directo al mapa y CERO ocurrencias de `operations.find`.
- `git status` confirma que el UNICO archivo modificado bajo control de versiones es `public/ejecucion.html` (los untracked preexistentes de `git status` inicial se ignoran).
- `npm test` reporta el baseline de CLAUDE.md seccion 6: 6 suites / 7 tests fallando de 426 (`PaymentReconciliation`, `TransformTime`, `no-process-exit`, `enforcement-wiring`, `config`, `operation-manager`). CERO fallas nuevas. Si aparece una falla que no esta en esa lista, es un bug introducido: corregirlo antes de continuar.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Verificacion funcional por el usuario + commit</name>
  <files>public/ejecucion.html (sin cambios adicionales — solo verificacion y commit)</files>
  <action>
PAUSAR la ejecucion y presentar al usuario el bloque <how-to-verify> de abajo junto con el diff (`git diff public/ejecucion.html`).

NO hacer commit hasta recibir la senal de aprobacion. Al recibirla, ejecutar el commit siguiendo AL PIE DE LA LETRA el bloque <commit_protocol> de este plan: un solo archivo en el stage, mensaje `feat(ui): ...`, SIN trailer Co-Authored-By, sin push, sin merge, sin crear ramas.

Si el usuario reporta problemas en vez de aprobar, corregir en `public/ejecucion.html` y volver a presentar la verificacion. No hacer commit de un estado no aprobado.
  </action>
  <what-built>
`public/ejecucion.html` ahora hace polling a `GET /api/operations/status` cada 3.5s y refleja el estado real del ciclo:
- Ciclo corriendo (por cron o por disparo manual de cualquiera) -> boton deshabilitado, label "Sincronizando..." con spinner.
- Ciclo detenido -> boton habilitado, label "Ejecutar proceso ahora", y refresco de Ultima/Proxima ejecucion en el flanco de terminacion.
- Poll fallido -> fail-safe: boton habilitado (nunca se traba), sin toasts repetidos.
- El `setInterval` se limpia en `beforeunload`.

Sin cambios en `src/**`, sin dependencias nuevas, sin tests tocados.
  </what-built>
  <how-to-verify>
Levantar el servicio local y validar los cinco escenarios:

1. `npm start` y abrir `http://localhost:3030/ejecucion.html`.

2. **Estado en reposo:** el boton debe verse habilitado con "Ejecutar proceso ahora". Abrir DevTools -> Network y confirmar una peticion a `/api/operations/status` cada ~3.5s con status 200.

3. **Disparo manual:** click en el boton. Secuencia esperada:
   a. Label cambia a "Iniciando..." con spinner (deshabilitado).
   b. Al responder el POST, pasa a "Sincronizando..." (sigue deshabilitado) SIN volver momentaneamente a "Ejecutar proceso ahora".
   c. Al terminar el ciclo, vuelve solo a "Ejecutar proceso ahora" habilitado, y los campos Ultima/Proxima ejecucion se actualizan.
   d. El spinner NO debe parpadear ni reiniciarse cada 3.5s (guarda de idempotencia D-06).

4. **Deteccion de ciclo ajeno:** con un ciclo ya corriendo, RECARGAR la pagina (F5). El boton debe aparecer en "Sincronizando..." deshabilitado en <=3.5s, sin haber hecho click.

5. **Fail-safe:** en DevTools -> Network activar "Offline" (o parar el servicio) mientras la pagina esta abierta con el boton en "Sincronizando...". En pocos segundos el boton debe volver a habilitarse y NO debe aparecer una cascada de toasts "Error de red". Volver a "Online" y confirmar que el estado se reconcilia solo.

6. **Cleanup:** navegar fuera de la pagina o cerrarla; en la consola no deben quedar peticiones a `/api/operations/status`.

Revisar el diff con `git diff public/ejecucion.html` antes de aprobar.
  </how-to-verify>
  <resume-signal>Escribir "aprobado" para que el ejecutor haga el commit segun `<commit_protocol>`, o describir los problemas encontrados.</resume-signal>
  <verify>
    <automated>git show --stat HEAD | grep -q "public/ejecucion.html" && test $(git show --stat HEAD --format= --name-only | grep -c .) -eq 1 && echo "OK: commit atomico de 1 archivo"</automated>
    <automated>test $(git log -1 --format=%B | grep -c "Co-Authored-By") -eq 0 && echo "OK: sin trailer Co-Authored-By en el commit de codigo"</automated>
    <automated>git rev-parse --abbrev-ref HEAD | grep -qx "feat/boton-ejecucion" && echo "OK: rama correcta, sin push"</automated>
  </verify>
  <done>
- El usuario aprobo explicitamente los 6 escenarios de verificacion funcional.
- Existe UN commit `feat(ui): ...` en `feat/boton-ejecucion` que toca exactamente `public/ejecucion.html`.
- El mensaje del commit NO contiene `Co-Authored-By` (HANDOFF.md seccion 8).
- No se hizo push, ni merge, ni se crearon ramas.
  </done>
</task>

</tasks>

<commit_protocol>
El commit se hace SOLO despues de que el usuario apruebe la Task 2. Reglas obligatorias:

- **Rama:** `feat/boton-ejecucion` (la actual). NO crear ramas, NO hacer push, NO hacer merge. El merge y el deploy los decide el usuario.
- **Un solo commit atomico**, con un unico archivo en el stage: `git add public/ejecucion.html`.
- **SIN trailer `Co-Authored-By`.** HANDOFF.md seccion 8: el trailer va solo en commits de documentacion (`docs:`, `chore:`); NUNCA en commits de codigo (`feat:`, `fix:`, `test:`, `refactor:`). Este es un commit `feat:`, asi que NO lleva trailer. Esta regla es obligatoria y no admite excepcion.
- **Sin nombres de terceros** en el mensaje (HANDOFF.md seccion 1).
- **Cuerpo explica el POR QUE**, no el que (HANDOFF.md seccion 8). Debe mencionar explicitamente el nuevo `setInterval` y como se limpia.

Mensaje sugerido:

    feat(ui): reflejar estado real de sincronizacion en el boton de ejecucion

    El boton solo se deshabilitaba durante su propio POST, asi que el operador
    lo veia habilitado mientras el cron de 15 minutos ya estaba corriendo un
    ciclo: hacia click y recibia un 409 sin saber cuando reintentar.

    Ahora la pagina consulta GET /api/operations/status cada 3.5s y refleja el
    estado real: si existe operations['background-cycle'] el boton queda
    deshabilitado con "Sincronizando...", venga el ciclo del cron o de un
    disparo manual de cualquiera. Al detectar el flanco de terminacion refresca
    Ultima/Proxima ejecucion.

    Detalles:
    - Acceso directo al mapa operations[type]; nunca .find() (operations es un
      objeto, no un array).
    - Fail-safe: cualquier fallo del poll re-habilita el boton en vez de dejarlo
      trabado sin salida.
    - Bandera triggerInFlight para que el poll no pise el label "Iniciando..."
      mientras el POST esta en vuelo.
    - El poll usa fetch directo en vez de apiCall() para no encadenar toasts de
      "Error de red" cada 3.5s cuando se cae la conexion.
    - Nuevo setInterval guardado en pollHandle y liberado con clearInterval en
      beforeunload.

    Un solo archivo tocado (public/ejecucion.html). Sin cambios de backend, sin
    dependencias nuevas.

Verificacion post-commit:

    git show --stat HEAD          # debe listar 1 archivo: public/ejecucion.html
    git log -1 --format=%B | grep -c "Co-Authored-By"   # debe imprimir 0
</commit_protocol>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| servidor -> DOM del navegador | La respuesta de `/api/operations/status` entra al cliente y es evaluada por el JS de la pagina. |
| operador -> API | El click dispara un POST autenticado por licencia + API key inyectada server-side. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-LKI-01 | Tampering / XSS | `applyButtonState()` en `public/ejecucion.html` | mitigate | El `innerHTML` del boton se construye SOLO con strings literales estaticos. Ningun campo de la respuesta del API (`operationId`, `startedAt`, `stepProgress`) se renderiza ni se interpola. A diferencia de `schedule.html`, esta pagina no necesita `escapeHtml()` porque no muestra datos dinamicos. |
| T-LKI-02 | Denial of Service | poll cada 3.5s contra `/api/operations/status` | accept | El endpoint es de solo lectura y devuelve un mapa en memoria de `OperationManager` (sin I/O, sin DB). El rate limit global de `/api` es 2000/15min (`src/server.js:39`), es decir ~2.2 req/s; un solo cliente a 3.5s consume ~0.29 req/s. Margen amplio incluso con varias pestanas abiertas. `schedule.html` ya sostiene un poll de 5s contra el mismo endpoint. |
| T-LKI-03 | Information Disclosure | `x-api-key` enviado en el poll | accept | Es la misma clave que ya se inyecta server-side en la pagina y que `apiCall()` envia en `loadStatus()` y en el disparo. Same-origin, sin cambio en la superficie de exposicion. El endpoint ni siquiera la exige (solo `requireLicense`). |
| T-LKI-04 | Denial of Service (self-inflicted) | boton bloqueado permanentemente | mitigate | D-03: cualquier fallo del poll re-habilita el boton. El operador nunca queda sin poder disparar el ciclo por culpa de la UI. |
</threat_model>

<verification>
1. Sintaxis del JS inline: el comando de `node`/`vm.Script` de la Task 1 imprime `SYNTAX OK (1 inline block)`.
2. `npm test` en el baseline de CLAUDE.md seccion 6: 6 suites / 7 tests fallando de 426. Cero fallas nuevas. (No hay cobertura de tests para `public/**`; esto es unicamente una comprobacion de no-regresion.)
3. `git status --porcelain` no muestra ningun archivo modificado bajo control de versiones fuera de `public/ejecucion.html`.
4. `grep` confirma acceso directo al mapa `operations['background-cycle']` y cero ocurrencias de `operations.find`.
5. `grep` confirma `clearInterval(pollHandle)` dentro del listener de `beforeunload`.
6. Verificacion funcional del usuario en los 6 escenarios de la Task 2.
7. Post-commit: `git show --stat HEAD` lista exactamente un archivo y el mensaje NO contiene `Co-Authored-By`.
</verification>

<success_criteria>
- [ ] `public/ejecucion.html` hace poll a `GET /api/operations/status` cada 3500 ms.
- [ ] Con `operations['background-cycle']` presente, el boton queda deshabilitado con label `Sincronizando...` (ASCII).
- [ ] Con el mapa vacio, el boton se re-habilita con el markup original `fas fa-play me-2` + `Ejecutar proceso ahora`.
- [ ] Un fallo del poll (red, 401, 500, shape invalido) re-habilita el boton; nunca lo deja trabado.
- [ ] `triggerInFlight` impide que el poll pise el label `Iniciando...` durante el POST.
- [ ] El flanco corriendo -> detenido dispara `loadStatus()` y refresca Ultima/Proxima ejecucion.
- [ ] El poll no usa `apiCall()`, por lo que no encadena toasts ante fallos de red.
- [ ] `pollHandle` se limpia con `clearInterval` en `beforeunload`.
- [ ] Cero ocurrencias de `operations.find`.
- [ ] Solo se modifico `public/ejecucion.html`. Cero cambios en `src/**`, cero tests, cero dependencias.
- [ ] `npm test` en baseline (6 suites / 7 tests de 426).
- [ ] Commit atomico `feat(ui): ...` en `feat/boton-ejecucion`, SIN trailer `Co-Authored-By`, sin push ni merge.
</success_criteria>

<output>
Al completar, crear `.planning/quick/260730-lki-boton-ejecucion-refleja-estado-sincroniz/260730-lki-SUMMARY.md` y actualizar la tabla "Quick Tasks Completed" de `.planning/STATE.md` con el quick ID `260730-lki`, la fecha (2026-07-30), el hash del commit y la nota de que queda pendiente el merge a `master` (lo decide el usuario).

El commit de documentacion (`docs(quick-260730-lki): ...`) SI lleva el trailer `Co-Authored-By` — HANDOFF.md seccion 8 lo permite en commits de documentacion. Va separado del commit de codigo.
</output>
