#!/usr/bin/env bash
# PreToolUse hook for Edit / Write — blocks (exit 2) when the target is one of
# the load-bearing files for the always-on regime. The block surfaces:
#   - the defense-in-depth invariant (axios < step < child < lock)
#   - the file's role
#   - a checklist of what to verify before applying the edit
#
# The user must explicitly confirm by re-running with SAGECONNECT_HOOKS_BYPASS=1.
# This is the friction-by-design model the maintainer chose during handoff.
#
# Exit codes:
#   0 — proceed (target is not critical, or bypass set)
#   2 — block with the checklist

set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"

FILE_PATH="$(printf '%s' "$INPUT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print((d.get('tool_input') or {}).get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null || echo '')"

if [ -z "$FILE_PATH" ]; then
    exit 0
fi

# Critical files — keep this list in sync with CLAUDE.md § 8.
CRITICAL_PATTERNS=(
    "src/config\.js$"
    "src/server\.js$"
    "src/background\.js$"
    "src/index\.js$"
    "src/services/OperationManager\.js$"
    "src/services/CronScheduler\.js$"
    "src/services/LicenseValidator\.js$"
    "src/utils/SQLServerConnection\.js$"
    "src/utils/PortalClient\.js$"
    "src/utils/LogGenerator\.js$"
    "src/utils/duration\.js$"
    "src/utils/AdminEmailSender\.js$"
    "src/routes/routes\.js$"
)

MATCH=""
for pat in "${CRITICAL_PATTERNS[@]}"; do
    if printf '%s' "$FILE_PATH" | grep -Eq "$pat"; then
        MATCH="$pat"
        break
    fi
done

if [ -z "$MATCH" ]; then
    exit 0
fi

if [ "${SAGECONNECT_HOOKS_BYPASS:-0}" = "1" ]; then
    echo "[pre-edit-critical] BYPASS active for $FILE_PATH." >&2
    exit 0
fi

{
    echo "[pre-edit-critical] BLOCKED — about to edit a load-bearing file:"
    echo "    $FILE_PATH"
    echo ""
    echo "Defense-in-depth invariant (do not break):"
    echo "    axios (30s)  <  step (5m)  <  child (10m)  <  lock (14m)"
    echo ""
    echo "Always-on regime: this process never exits between cron ticks."
    echo "Before applying the edit, confirm in writing to the user:"
    echo "  1. The change is justified (preferably under an active GSD phase)."
    echo "  2. Any new setInterval/setTimeout/listener has a documented cleanup path."
    echo "  3. Any change to a shared helper signature has been audited against all callers (grep)."
    echo "  4. Any change to a timeout tier preserves the invariant above."
    echo "  5. The user has explicitly approved the change."
    echo ""
    echo "Once confirmed, retry with: SAGECONNECT_HOOKS_BYPASS=1 (single-command scope)."
    echo "Full context: CLAUDE.md §§ 0, 3, 6, 8, 9; HANDOFF.md."
} >&2

exit 2
