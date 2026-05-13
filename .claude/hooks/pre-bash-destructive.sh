#!/usr/bin/env bash
# PreToolUse hook for Bash — blocks (exit 2) destructive or
# shared-state-affecting commands unless SAGECONNECT_HOOKS_BYPASS=1 is set.
#
# Covered:
#   - git push --force / --force-with-lease
#   - git reset --hard
#   - git rebase (any form — implies history rewrite)
#   - git stash (per HANDOFF.md § 4 cautionary tale, lost .planning files in 2026-05-02)
#   - git rm -r (uses --cached as the dangerous one)
#   - rm -rf
#   - taskkill /F (and PowerShell Stop-Process -Force)
#   - npm publish / npm unpublish
#   - rm of .env files
#
# The goal is friction, not prohibition: every block lists the exact command,
# the rationale, and how to bypass with consent.

set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"

COMMAND="$(printf '%s' "$INPUT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print((d.get('tool_input') or {}).get('command', ''))
except Exception:
    print('')
" 2>/dev/null || echo '')"

if [ -z "$COMMAND" ]; then
    exit 0
fi

if [ "${SAGECONNECT_HOOKS_BYPASS:-0}" = "1" ]; then
    echo "[pre-bash-destructive] BYPASS active for: $COMMAND" >&2
    exit 0
fi

# Patterns: `LABEL|REGEX|RATIONALE`
PATTERNS=(
    "git push --force|git[[:space:]]+push.*--force|Force-push rewrites remote history. Source repo (master): never. Dist repo: CI does it; never from a dev machine. Confirm with user."
    "git reset --hard|git[[:space:]]+reset[[:space:]]+--hard|Discards local work. Confirm the SHA target with the user."
    "git rebase|git[[:space:]]+rebase|Rewrites local history; can lose work if interrupted. Confirm intent."
    "git stash|git[[:space:]]+stash|HANDOFF.md § 4: stash + cached-rm dropped .planning/ files in 2026-05-02 incident. Avoid stash patterns."
    "git rm -r|git[[:space:]]+rm[[:space:]]+-r|HANDOFF.md § 4: removing tracked trees needs explicit user OK, especially for .planning/."
    "rm -rf|rm[[:space:]]+-rf|Recursive force-delete. Confirm the path."
    "rm .env|rm[[:space:]]+\\.env|Deleting an .env file. Confirm — this is a credential file."
    "taskkill /F|taskkill[[:space:]]+/[Ff]|Force-kill a Windows process. Confirm the PID and intent."
    "Stop-Process -Force|Stop-Process[[:space:]]+.*-Force|PowerShell force-kill. Same as taskkill /F."
    "npm publish|npm[[:space:]]+publish|This package is not meant to be published to npm registry."
)

for entry in "${PATTERNS[@]}"; do
    LABEL="${entry%%|*}"
    REST="${entry#*|}"
    REGEX="${REST%%|*}"
    RATIONALE="${REST#*|}"
    if printf '%s' "$COMMAND" | grep -Eq "$REGEX"; then
        {
            echo "[pre-bash-destructive] BLOCKED — $LABEL"
            echo "    Command: $COMMAND"
            echo "    Rationale: $RATIONALE"
            echo ""
            echo "Resolution: state the intent to the user, get explicit confirmation, then retry with:"
            echo "    SAGECONNECT_HOOKS_BYPASS=1 <your command>"
        } >&2
        exit 2
    fi
done

exit 0
