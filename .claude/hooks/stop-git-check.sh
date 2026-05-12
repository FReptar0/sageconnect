#!/usr/bin/env bash
# Stop hook — reminds Claude (and the user, by extension) when the working tree
# has uncommitted or unpushed changes at the end of a turn.
#
# Behavior:
#   - Reads the hook event JSON from stdin and bails out if `stop_hook_active`
#     is true (prevents infinite loops when another stop hook already fired).
#   - Exits 2 with a short reminder when there is unstaged work or commits
#     ahead of upstream; the message is shown to the user.
#   - Exits 0 silently otherwise.
#
# Disable by removing the Stop entry from .claude/settings.json (or
# overriding it in .claude/settings.local.json).

set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"
if printf '%s' "$INPUT" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
    exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    exit 0
fi

DIRTY="$(git status --porcelain 2>/dev/null)"

AHEAD=0
UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
if [ -n "$UPSTREAM" ]; then
    AHEAD="$(git rev-list --count "${UPSTREAM}..HEAD" 2>/dev/null || echo 0)"
fi

if [ -z "$DIRTY" ] && [ "$AHEAD" = "0" ]; then
    exit 0
fi

{
    echo "Reminder before stopping:"
    if [ -n "$DIRTY" ]; then
        echo "  • Uncommitted changes present (run \`git status\` to inspect)."
    fi
    if [ "$AHEAD" != "0" ]; then
        echo "  • $AHEAD local commit(s) ahead of $UPSTREAM — consider \`git push\` when ready."
    fi
    echo "Resolve or acknowledge before ending the session."
} >&2

exit 2
