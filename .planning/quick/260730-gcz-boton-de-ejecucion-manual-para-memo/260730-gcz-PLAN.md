---
plan_id: 260730-gcz
slug: boton-de-ejecucion-manual-para-memo
status: ready
branch: feat/boton-ejecucion
type: quick
---

# Quick Task 260730-gcz — Botón de ejecución manual para Memo

## Goal

Página web **simplificada y dedicada exclusivamente a ejecutar el proceso manualmente**, para el usuario operador Memo (Capstone). Reutiliza el endpoint de disparo y el de estado que **ya existen**. Directiva de Santiago (2026-07-29): *"una página sencilla… con que sea funcional"*, ocultando logs / historial / controles técnicos.

## Context (todo ya existe — esto solo lo reutiliza)

- El botón "Ejecutar Ahora" y su lógica `triggerCycle()` YA existen en `public/schedule.html` (~L522-557): hacen `POST /api/schedule/background-cycle/trigger`, deshabilitan el botón, muestran spinner, manejan 409 ("El ciclo ya está en ejecución"), re-habilitan.
- El estado (última/próxima ejecución) viene de `GET /api/schedule` → `task.lastRun` / `task.nextRun` (`schedule.html` ~L386, L440-441).
- Las páginas se sirven con `serveHtmlWithKey()`, que inyecta `<meta name="x-app-key">` antes de `</head>` (`src/server.js:122-146`).
- `public/js/shared.js` provee `apiCall()`, `formatDateTime()`, `showToast()`, `resolveApiKey()`.

## Tasks

### Task 1 — Crear `public/ejecucion.html`

- **files:** `public/ejecucion.html` (NUEVO)
- **action:** Página HTML minimalista y funcional (reusar el look de las otras páginas: mismo Bootstrap CSS local/CDN que usa `schedule.html`). Debe contener SOLO:
  - `<head>` con `</head>` presente (para que `serveHtmlWithKey` inyecte la meta key). `<title>` claro (ej. "SageConnect — Ejecutar proceso").
  - Un card central con: nombre del sistema, **"Última ejecución:"** y **"Próxima ejecución:"** (con spans id `last-run` / `next-run`), un **botón grande** `id="btn-ejecutar"` que diga **"▶ Ejecutar proceso ahora"**, y un área de mensaje `id="msg"` para el resultado.
  - `<script src="js/shared.js"></script>` + un `<script>` inline que:
    - Al cargar: `apiCall('GET','/api/schedule')` y poblar `last-run` / `next-run` con `formatDateTime(task.lastRun)` / `formatDateTime(task.nextRun)` (tomar `task` del shape que devuelve schedule.html; si la respuesta trae un array/objeto, replicar exactamente cómo lo lee `schedule.html`).
    - Al hacer clic en el botón: replicar el patrón de `triggerCycle()` de `schedule.html` — deshabilitar botón + spinner + texto "Iniciando…", `apiCall('POST','/api/schedule/background-cycle/trigger')`, y en la respuesta mostrar en `#msg`: éxito → "Proceso iniciado ✓"; 409 → "El ciclo ya está en ejecución"; error → mensaje de error. Re-habilitar el botón al terminar y refrescar el estado (última/próxima).
  - **NADA de:** logs, historial de ejecuciones, force-release, ni enlaces/navegación al resto del portal.
- **verify:** `grep -q 'btn-ejecutar' public/ejecucion.html`; `grep -q '/api/schedule/background-cycle/trigger' public/ejecucion.html`; `grep -q "apiCall('GET', '/api/schedule')" public/ejecucion.html` (o equivalente GET a /api/schedule); `grep -q 'js/shared.js' public/ejecucion.html`; `grep -q '</head>' public/ejecucion.html`; y confirmar AUSENCIA de técnico: `! grep -qiE 'force-release|logs.html|Historial|history' public/ejecucion.html`.
- **done:** la página existe, es autocontenida, reutiliza el patrón de `triggerCycle` y el endpoint de estado, sin elementos técnicos.

### Task 2 — Servir la página en `src/server.js`

- **files:** `src/server.js` (EDITAR — solo añadir 1 línea)
- **action:** Agregar `app.get('/ejecucion.html', serveHtmlWithKey('ejecucion.html'));` inmediatamente después de la línea `app.get('/logs.html', serveHtmlWithKey('logs.html'));` (~L146). No tocar ninguna otra línea.
- **verify:** `node -c src/server.js` (sin error); `grep -q "ejecucion.html', serveHtmlWithKey('ejecucion.html')" src/server.js`; confirmar que las 4 rutas existentes (schedule/payments/pos/logs) siguen intactas (`grep -c "serveHtmlWithKey('" src/server.js` == 5).
- **done:** `server.js` sirve `/ejecucion.html` con la key inyectada, sin alterar lo existente.

## Verification (global)

- `node -c src/server.js` OK.
- `npm test` se mantiene en el **baseline de CLAUDE.md §6** (mismas suites que ya fallan, **sin nuevas fallas**). Esta tarea no toca lógica de negocio ni tests.
- NO se modificaron `schedule.html`, `payments.html`, `pos.html`, `logs.html`, rutas de API ni la lógica del cron.
- Cambio puramente **aditivo**.

## Commit hygiene (HANDOFF §8)

- Un commit de código: `feat(ui): ...` — **SIN** trailer `Co-Authored-By` (es commit de código).
- No commitear artefactos docs (PLAN/SUMMARY/STATE) — de eso se encarga el orquestador.
- No tocar `ROADMAP.md` (las quick tasks van aparte).
