#!/usr/bin/env bash
# PreToolUse hook for Bash — fires on `git commit ...` calls and blocks the
# commit if the staged diff contains any forbidden term:
#   - prior employer / channel partner names (per HANDOFF.md § 1)
#   - kill-switch language (per HANDOFF.md § 2)
#   - real license server URLs / admin emails (per HANDOFF.md § 2)
#
# Bypass for emergencies: export SAGECONNECT_HOOKS_BYPASS=1 before the commit.
# Use sparingly and only after the user has explicitly confirmed.
#
# Exit codes:
#   0 — proceed (not a commit, or diff is clean, or bypass set)
#   2 — block with stderr message (sent to the user / Claude)
#   0 — on any unexpected error (do not break the session over a bug here)

set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"

# Extract the bash command from the hook input. If extraction fails, do not block.
COMMAND="$(printf '%s' "$INPUT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print((d.get('tool_input') or {}).get('command', ''))
except Exception:
    print('')
" 2>/dev/null || echo '')"

# Only act on git commit invocations.
case "$COMMAND" in
    *"git commit"*) ;;
    *) exit 0 ;;
esac

if [ "${SAGECONNECT_HOOKS_BYPASS:-0}" = "1" ]; then
    echo "[pre-commit-redaction] BYPASS active (SAGECONNECT_HOOKS_BYPASS=1) — skipping redaction grep." >&2
    exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    exit 0
fi

# Grep both the staged diff and the staged file paths.
#
# Meta-rule files are exempt from the diff scan because they document the rule
# itself (the forbidden term appears inside the explanation of why it's
# forbidden). Adding a new file here should be rare and reviewed manually.
# The PATH grep still runs against the full set — a filename containing the
# term would always be flagged.
EXEMPTED_PATHS=(
    ':(exclude)HANDOFF.md'
    ':(exclude).claude/hooks/pre-commit-redaction.sh'
    ':(exclude)docs/CLAUDE_CODE.md'
)
DIFF="$(git diff --cached -- "${EXEMPTED_PATHS[@]}" 2>/dev/null || true)"
PATHS="$(git diff --cached --name-only 2>/dev/null || true)"

# Patterns to flag. Case-insensitive. Anchored to whole words where reasonable.
# Add new patterns by appending a line here; keep the format `LABEL|REGEX`.
PATTERNS=(
    "prior integrator name (Tersoft)|[Tt][Ee][Rr][Ss][Oo][Ff][Tt]"
    "kill-switch language|kill[- ]switch|bloqueo[- ]remoto|remote[- ]kill"
    "real license server URL|sageconnect-license\.vercel\.app"
    "real admin email (tersoft.com)|admin@tersoft\.com|@tersoft\.com"
)

HITS=""
for entry in "${PATTERNS[@]}"; do
    LABEL="${entry%%|*}"
    REGEX="${entry#*|}"
    if printf '%s' "$DIFF" | grep -Eqi "$REGEX" \
       || printf '%s' "$PATHS" | grep -Eqi "$REGEX"; then
        # Capture the first 3 matching lines for context.
        EXAMPLES="$(printf '%s\n%s' "$DIFF" "$PATHS" | grep -Eni "$REGEX" | head -3)"
        HITS="${HITS}
[${LABEL}]
${EXAMPLES}
"
    fi
done

if [ -n "$HITS" ]; then
    {
        echo "[pre-commit-redaction] BLOCKED — staged changes contain forbidden terms."
        echo "See HANDOFF.md §§ 1-2 for the rationale."
        echo ""
        printf '%s\n' "$HITS"
        echo ""
        echo "Resolution: edit the offending file(s) to use generic substitutes ('integrator', 'license validation service', 'example.com'), re-stage, and retry."
        echo "Emergency bypass: SAGECONNECT_HOOKS_BYPASS=1 git commit ... — only with explicit user consent."
    } >&2
    exit 2
fi

exit 0
