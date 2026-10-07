---
quick_id: 260730-gcz
slug: boton-de-ejecucion-manual-para-memo
status: complete
branch: feat/boton-ejecucion
code_commit: 58d5b41
date: 2026-07-30
---

# Quick Task 260730-gcz — Botón de ejecución manual para Memo — SUMMARY

## Resultado: COMPLETO ✅

Página web simplificada y dedicada exclusivamente a ejecutar el proceso manualmente, para el operador Memo (Capstone). Reutiliza los endpoints que ya existían (estado + disparo). Directiva de Santiago (2026-07-29): página sencilla y funcional, sin exponer lo técnico.

## Archivos (2 — cambio puramente aditivo)

- **`public/ejecucion.html`** (NUEVO): card con "última ejecución" / "próxima ejecución" (de `GET /api/schedule`) + botón grande **"▶ Ejecutar proceso ahora"** (`POST /api/schedule/background-cycle/trigger`) + área de mensaje de resultado. Reutiliza `js/shared.js` y el patrón de `triggerCycle()`. **Sin** logs, historial, force-release ni navegación al resto del portal.
- **`src/server.js`** (+1 línea): `app.get('/ejecucion.html', serveHtmlWithKey('ejecucion.html'));` después de la ruta de `logs.html`. Sirve la página con la meta key inyectada.

## Commit

- Código: **`58d5b41`** — `feat(ui): página de ejecución manual simplificada para Memo`. Sin trailer `Co-Authored-By` (HANDOFF §8).

## Verificación

- `node -c src/server.js`: **OK**.
- Rutas `serveHtmlWithKey`: **5** (antes 4) — schedule / payments / pos / logs / **ejecucion**.
- `npm test`: **6 suites falladas / 7 tests fallados de 426** — baseline CLAUDE.md §6 (`PaymentReconciliation`, `TransformTime`, `no-process-exit`, `enforcement-wiring`, `config`, `operation-manager`). **Cero fallas nuevas.**
- Greps del PLAN: la página tiene `btn-ejecutar` + `POST /trigger` + `GET /api/schedule` + `js/shared.js` + `</head>`; y NO contiene `force-release` / `logs.html` / `Historial` / `history`.
- No se tocaron `schedule.html` / `payments.html` / `pos.html` / `logs.html`, ni rutas de API, ni la lógica del cron.

## Nota de proceso

La edición de `src/server.js` fue frenada por `pre-edit-critical.sh` (archivo load-bearing). El usuario aprobó explícitamente (Opción A) y autorizó el bypass para ese único comando. Se verificaron los 5 puntos del hook: sin timers/listeners/child nuevos, sin cambio de firma de helper compartido, sin tocar los tiers de timeout (`axios < step < child < lock`), cambio aditivo trivial, aprobación del usuario obtenida.

## Pendiente (fuera de esta quick task)

- Prueba en local (`npm start` → `localhost:3030/ejecucion.html`).
- Merge a `master` + deploy en su momento (ventana segura).
- IT (Jorge/Alan): exponer la página vía **Bastion** para que Memo la acceda.
