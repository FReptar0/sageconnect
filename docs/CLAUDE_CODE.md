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

### `session-start.sh`

Fired by the `SessionStart` event registered in `.claude/settings.json`. Two responsibilities:

1. Print `{"async": true, "asyncTimeout": 300000}` to stdout so the runtime does not block the session on a slow `npm install`.
2. If `node_modules/` is missing, run `npm install --no-audit --no-fund --silent`. Suppressed output prevents corrupting the JSON parse. Local machines almost always have `node_modules`, so this is effectively a no-op for them; it's there for Claude Code on the web and other ephemeral environments that start from a fresh checkout.

If you want to disable it (e.g., your shell can't run bash), remove the entry from `.claude/settings.json` or override it in `.claude/settings.local.json`.

### `stop-git-check.sh`

Fired by the `Stop` event when Claude finishes a turn. Reads the event JSON from stdin, bails immediately if `stop_hook_active` is true (avoiding infinite loops), then:

- Returns exit 0 silently if the working tree is clean and HEAD is in sync with upstream.
- Returns exit 2 with a short stderr reminder if there are uncommitted changes or commits ahead of upstream. The exit-2 path surfaces the reminder to the user.

This implements the maintainer's preference for keeping commit / push hygiene tight. If your workflow prefers to defer commits, edit `.claude/settings.json` (or `settings.local.json`) to drop the Stop entry — it's a reminder, not an invariant.

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
