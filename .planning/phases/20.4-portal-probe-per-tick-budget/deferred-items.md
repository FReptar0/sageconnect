# Phase 20.4 — Deferred items (found during execution, deliberately not fixed)

Out-of-scope discoveries logged per the executor scope boundary. Nothing here was changed by
plan 20.4-01. Each item names what would have to cover it.

---

## D-ITEM-01 — `npm test` leaks a growing CSV into an untracked `sageconnect/` directory at the repo root

**Found during:** plan 20.4-01, Task 2 (after the first full `npm test` run)
**Artifact:** `sageconnect/<fecha>/PaymentReconciliation-uploads.csv` — untracked, never in git history
**Writer:** `src/utils/CsvWriter.js`, reached from the `PaymentReconciliation` suite

Running `npm test` creates `sageconnect/2026-03-12/PaymentReconciliation-uploads.csv` relative to the
process CWD (the repo root). The path is date-derived from the fixture, not from today, so the
directory name is a fixture artifact rather than a real date.

Two properties make it worth recording rather than ignoring:

1. **It appends across runs.** Three `npm test` invocations during this plan produced three timestamp
   clusters inside the same file (19:06:01, 19:06:13, 19:06:31) and the file reached 4 KB. Nothing
   truncates or bounds it, so it grows for the life of the working copy. That is the same unbounded
   -retained-state shape CLAUDE.md §3 forbids in the service, appearing here in the test footprint.
2. **It is not covered by `.gitignore`.** `git check-ignore` returns nothing for it, so the next
   person who runs `git add -A` after `npm test` commits generated output into the repo.

**Content is harmless** — pure synthetic fixture rows (`PY-001`, `portal-1`, `1000 MXN`), no customer
data, no credentials. It was deleted during this plan so the working tree was left exactly as found.

**Why not fixed here:** plan 20.4-01's `files_modified` is exactly `src/config.js`, `.env.example`
and `tests/config.probe-budget.test.js`. The fix touches either `.gitignore` or the `CsvWriter` call
path in a baseline-failing suite (`PaymentReconciliation` is one of the CLAUDE.md §6 six), and this
diff has to stay reviewable in isolation for the October migration.

**What would cover it:** a one-line `.gitignore` entry is the cheap half; the honest half is making
the suite write to a temp dir and clean up after itself, the way
`tests/config.probe-budget.test.js` now does with its `beforeAll` / `afterAll` `mkdtempSync` +
`rmSync` pair. Candidate for the same follow-up that eventually addresses the two Jest worker-crash
suites.

**Nota de la ola 3 (20.4-03):** al intentar borrar el artefacto, el hook `pre-bash-destructive.sh`
bloqueó el `rm -rf` y **no se hizo bypass** — esa decisión es del usuario. El directorio ya estaba en
el árbol al empezar la ola, así que no quedó nada por restaurar.

---

## D-ITEM-02 — `.planning/ROADMAP.md`: la viñeta del 20.4-02 está truncada y trae ~19 líneas duplicadas inyectadas

**Found during:** plan 20.4-03 (al diffear el ROADMAP antes y después de `roadmap.update-plan-progress`)
**Artifact:** `.planning/ROADMAP.md`, líneas 195-215
**Introducido por:** `62b79c3` — el commit de `/gsd-plan-phase 20.4`, 2026-09-03

### Qué está mal

La viñeta del plan de la ola 2 se corta a media frase y arrastra texto ajeno:

- **L195** termina en `` …incluye el re-anclaje de las 8 aserciones `### Phase 20.4: Bound the portal existence probe per tick (INSERTED) ``
- **L196-214** son una **copia literal, línea por línea, de L174-192** — la propia sección «Phase 20.4» que está justo arriba.
- **L215** es la cola huérfana de la viñeta: `` -ancladas de la suite 20.3 en el mismo cambio [RETRY-E1, RETRY-E3, RETRY-E4] ``

El texto original era `` las 8 aserciones `$`-ancladas de la suite 20.3 en el mismo cambio `` — «las ocho
aserciones ancladas con `$`», que es exactamente de lo que habla el `20.4-02-SUMMARY.md`.

### Quién NO lo causó (verificado, no supuesto)

`roadmap.update-plan-progress` **está limpio**. Comprobado con `git show` sobre cinco revisiones:

| Diff | Líneas cambiadas |
|---|---|
| `62b79c3 → ccaef42` (ola 1) | 2: la casilla del 20.4-01 y la fila de la tabla de Progress |
| `ccaef42 → 85f9d25` (ola 2) | 2: la casilla del 20.4-02 y la fila de la tabla |
| ola 3 (esta) | 2: la casilla del 20.4-03 y la fila de la tabla |

El daño aparece **idéntico ya en `62b79c3`**, antes de que ningún verbo de estado tocara el archivo.
`grep -c 'Phase 20.4: Bound'` da **3** en las cinco revisiones, sin variación.

### Causa probable

Sustitución de comandos con acentos graves al escribir el documento **por shell** en lugar de con la
herramienta de edición: el backtick de `` `$` `` abre una sustitución que consume texto hasta el
siguiente backtick —unas 20 líneas más abajo— y reemite parte del documento en su lugar. Es
precisamente el motivo por el que este repo exige escribir archivos con la herramienta de edición y
no por Bash.

### Receta de reparación (mecánica y demostrablemente sin pérdida)

1. Borrar **L196-214**. Es seguro: `grep -vxF` de ese span contra L174-192 devuelve **vacío en ambos
   sentidos**, o sea que es un duplicado exacto y no hay una sola línea de contenido único ahí.
2. Reunir la viñeta: quitar de L195 el fragmento inyectado
   `` `### Phase 20.4: Bound the portal existence probe per tick (INSERTED) `` y pegarle la cola de
   L215, dejando `` …incluye el re-anclaje de las 8 aserciones `$`-ancladas de la suite 20.3 en el
   mismo cambio [RETRY-E1, RETRY-E3, RETRY-E4] ``.
3. Borrar L215 ya vacía.

### Por qué no se arregló aquí

`files_modified` del plan 20.4-03 es exactamente `tests/controller/PortalOC_Creator.probe-budget.test.js`.
La reparación toca ~20 líneas de prosa de planeación de otra ola en un archivo que este plan sólo
tenía que actualizar mecánicamente. CLAUDE.md §0.1 pide confirmar antes de una acción no trivial.
**Es decisión del usuario**, y la receta de arriba la deja lista para ejecutar en un minuto.
