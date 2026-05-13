# Working with Claude Code in this repo

This is the SageConnect-specific guide for using [Claude Code](https://docs.claude.com/en/docs/claude-code/). For the general harness documentation (installation, key bindings, MCP servers, agent SDK), go to the official docs. This file covers what is configured *here* and how to use it productively in this codebase.

## What's already set up

Three things ship in the repo today:

1. [`CLAUDE.md`](../CLAUDE.md) at the repo root — loaded into the model's context on every session start. Carries the always-on constraint, the 3 pitfalls that cost the most rework, the defense-in-depth invariant, and `file:line` references to the critical modules.
2. [`.claude/settings.json`](../.claude/settings.json) — committed team baseline: two hooks (SessionStart, Stop) and a conservative permissions allowlist for read-only commands.
3. [`.claude/commands/`](../.claude/commands/) — four slash commands tailored to this codebase: `/test`, `/env-check`, `/diagnose`, `/deploy-checklist`.

You shouldn't need to install anything beyond Claude Code itself.

## Memory: `CLAUDE.md`

The model reads `CLAUDE.md` on every turn — keep it terse. The current shape (sections 1–11) is intentional:

- **Don't duplicate** what `.planning/codebase/*.md` already says. Link to it.
- **Do encode** anything that prevents a re-occurring mistake. Pitfalls section is where those go.
- **File:line refs** are durable enough that they stay accurate for months. Generic paragraphs drift; line refs decay loudly.

Add a per-directory `CLAUDE.md` only if a subsystem has its own conventions dense enough to deserve it (none currently do — `src/services/` is the strongest candidate if always-on patterns proliferate further).

## Hooks (in `.claude/hooks/`)

Seven hooks ship with the repo. The first two are passive (informational); the other five are **active prevention** — they exit 2 (block) under specific conditions and surface a stderr message to the user. All five blockers honour `SAGECONNECT_HOOKS_BYPASS=1` for emergencies.

### `session-start.sh` — passive

Fired by `SessionStart`. Prints `{"async": true, "asyncTimeout": 300000}` to stdout so the runtime does not block the session, then runs `npm install --no-audit --no-fund --silent` if `node_modules/` is missing (covers Claude Code on the web and other ephemeral environments). No-op on local machines that already have deps.

### `stop-git-check.sh` — passive (exit-2 reminder)

Fired by `Stop`. Reads `stop_hook_active` from stdin and bails if true (avoids infinite loops). Otherwise: exit 0 silently if the tree is clean and HEAD is in sync with upstream; exit 2 with a stderr reminder if there are uncommitted changes or commits ahead of upstream. The reminder is non-blocking in spirit — the user can re-prompt to override — but surfaces commit/push hygiene every time.

### `pre-commit-redaction.sh` — active (PreToolUse Bash)

Intercepts any Bash command containing `git commit`. Reads the staged diff (`git diff --cached`) and grep-checks for forbidden terms documented in `HANDOFF.md` § 1–2:

- Prior integrator / channel partner names (case-insensitive match on "tersoft").
- Kill-switch language (`kill switch`, `bloqueo remoto`, `remote kill`).
- Real license server URLs (`sageconnect-license.vercel.app`).
- Real admin emails on the prior integrator's domain.

If any term hits, exits 2 with the offending lines and a resolution path. Pattern list lives at the top of the script — extend by appending a `LABEL|REGEX` line.

### `pre-bash-destructive.sh` — active (PreToolUse Bash)

Intercepts shared-state-affecting Bash commands. Blocks: `git push --force`, `git reset --hard`, `git rebase`, `git stash` (per HANDOFF.md § 4 cautionary tale), `git rm -r`, `rm -rf`, `rm .env*`, `taskkill /F`, `Stop-Process -Force`, `npm publish`. Each pattern carries its own rationale string in the block message.

### `pre-edit-gsd-guard.sh` — active (PreToolUse Edit/Write/MultiEdit)

Blocks edits to anything under `src/**` when no active GSD phase exists (`.planning/phases/<NN>-<slug>/` containing `SPEC.md` / `PLAN.md` / `DISCUSSION.md` and not marked `*COMPLETE*` / `*ARCHIVED*` / `*CANCELLED*`). Tests, docs, planning, config, and root-level files are exempt. Bypass `SAGECONNECT_HOOKS_BYPASS=1` for genuinely trivial edits (typo, comment, dead-code removal) after stating intent to the user.

### `pre-edit-critical.sh` — active (PreToolUse Edit/Write/MultiEdit)

Fires on Edit/Write to any of the 13 load-bearing files documented in `CLAUDE.md` § 8 — `config.js`, `server.js`, `background.js`, `index.js`, `OperationManager.js`, `CronScheduler.js`, `LicenseValidator.js`, `SQLServerConnection.js`, `PortalClient.js`, `LogGenerator.js`, `duration.js`, `AdminEmailSender.js`, `routes/routes.js`. The block message surfaces the defense-in-depth invariant and a 5-point pre-edit checklist (justified, cleanup paths, caller audit, invariant preserved, user approval). Bypass after the checklist is satisfied and the user has signed off.

### `pre-write-always-on.sh` — active (PreToolUse Edit/Write/MultiEdit)

Scans the new content of any Edit/Write under `src/**/*.js` for primitives that retain state across cron ticks: `setInterval(`, `setTimeout(`, `new EventEmitter`, `.addListener(`, `child_process.spawn/fork/exec`, `axios.create`, `winston.createLogger`. If found AND no "cleanup-intent" token appears in the same change (`clearInterval`, `clearTimeout`, `removeListener`, `.off(`, `destroy`, `close()`, `release()`, `abort()`, `unref()`, `disconnect()`, the literal word `cleanup`), exits 2 with the offending lines. Add a comment documenting the cleanup path to silence the hook (cheap and good documentation).

### Disabling or relaxing the hooks

Two routes:

- **Temporary**: `SAGECONNECT_HOOKS_BYPASS=1 <your command>`. Single-command scope — exported into the env of one tool invocation only, after stating the rationale to the user.
- **Permanent for a developer**: override the matcher in `.claude/settings.local.json` (gitignored). The committed `.claude/settings.json` is the team baseline; nobody else sees your local override.

Do **not** remove a hook from the committed `.claude/settings.json` unless the team agrees in PR review.

## Slash commands (in `.claude/commands/`)

| Command | When to use |
|---------|-------------|
| `/test` | After any non-trivial change. Wraps `npm test` (or `npx jest <path>` if you pass an argument). Differentiates new failures from the documented pre-existing baseline. |
| `/env-check` | When boot fails or after editing `.env`. Runs `require('./src/config')` and reports presence (not values) of API key + license URL. |
| `/diagnose` | When you need a quick map of `src/scripts/`. Lists what each diagnostic does without running any of them (they hit prod). |
| `/deploy-checklist` | When you're walking an operator through the Servy cutover. Prints commands, does not execute them. |

Adding a new slash command: create `.claude/commands/<name>.md` with a frontmatter `description` field and the prompt body. Available immediately on the next session. Keep them narrow — slash commands without daily use just add noise to the session.

## Permissions (`.claude/settings.json` `permissions.allow`)

The committed allowlist is conservative — only commands a dev runs constantly without thinking about them:

- `npm test:*`, `npm install:*`, `npm run dev:*`, `npm run background-only:*`, `npx jest:*`, `jest:*`.
- Read-only git: `git status`, `diff`, `log`, `branch`, `show`, `rev-parse`.
- Common Unix read: `ls`, `cat`, `grep`, `find`.

Notable absences (intentional):

- `git push`, `git commit -am`, `git reset --hard`, `git rebase` — destructive or shared-state operations stay prompted.
- `npm run obfuscate`, `node scripts/*` — manual obfuscation is wrong (CI handles it); diagnostic scripts hit prod. Both stay prompted so the operator has a beat to confirm.
- `node src/scripts/*` — same reason: production data, never auto-allow.

Your own preferences go in `.claude/settings.local.json` (gitignored, see `.gitignore`). For example, if you trust `gh pr view` or `git fetch`, add them there — don't push them up to the team baseline.

## Subagents

No custom subagents are configured in this repo. The built-in ones (`Explore`, `Plan`, `general-purpose`) cover the day-to-day need; Claude Code already knows how to use them.

Worth creating a custom subagent if a repeated review pattern emerges — e.g., an "always-on review" agent that audits a diff for unbounded timers, retained listeners, and module-scope caches. Follow the [Claude Code docs on subagents](https://docs.claude.com/en/docs/claude-code/sub-agents) if/when that need shows up.

## Practices observed (what works here)

These aren't rules — they're patterns the maintainer has seen pay off:

- **Run `/test` after each non-trivial change.** Jest is fast (~30 s) on this codebase. Letting failures accumulate makes them harder to attribute.
- **Read `.planning/codebase/ARCHITECTURE.md` § Always-On Patterns before touching `background.js` or any service in `src/services/`.** It's a 30-line read that saves real time.
- **Always pass `db` explicitly to `runQuery(query, db)` when the target is not the default Sage DB.** Implicit defaults broke 7 callers in PR #16/#19; don't be the 8th.
- **Use `logGenerator(LOG_FILE, level, message)` — never bare `console.log`** for anything that needs to survive a restart. winston files are the audit trail.
- **Treat `setTimeout`/`setInterval`/EventEmitter listeners with suspicion.** Write down the cleanup story before adding one.
- **When refactoring a helper used in many places, grep first.** The `runQuery` default-change incident is the canonical cautionary tale; the codebase has more shared helpers with similar coupling.

## Further reading

- Claude Code official docs — <https://docs.claude.com/en/docs/claude-code/>.
- Hooks reference — <https://docs.claude.com/en/docs/claude-code/hooks>.
- Slash commands — <https://docs.claude.com/en/docs/claude-code/slash-commands>.
- Memory model — <https://docs.claude.com/en/docs/claude-code/memory>.
- Permissions and `settings.json` schema — <https://docs.claude.com/en/docs/claude-code/settings>.
