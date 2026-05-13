#!/usr/bin/env bash
# PreToolUse hook for Edit / Write — scans the new content for primitives that
# leak resources under the always-on regime and warns when no cleanup intent
# appears nearby:
#   - setInterval(  / setTimeout(
#   - new EventEmitter / .on(  / .addListener(
#   - new Map() / new Set() at module scope
#   - child_process.spawn / .fork / .exec
#   - axios.create / new ... pool
#   - winston.createLogger
#
# Heuristic: if the new content introduces one of these and does not contain
# the word "cleanup", "clear", "release", "close", "destroy", "removeListener",
# "off(", "abort", or "unref" within the same change, we exit 2 with the
# matching line and a reminder.
#
# This is intentionally noisy. Bypass with SAGECONNECT_HOOKS_BYPASS=1 after
# stating to the user why the primitive is safe (or commit a comment that
# documents the cleanup path — then the grep will be satisfied).

set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"

# Extract file path and content. We do two separate python3 -c calls because
# the heredoc-inside-command-substitution pattern eats stdout on some shells.
# The `import json,sys; d=json.load(sys.stdin); ...` one-liner is reliable.
FILE_PATH="$(printf '%s' "$INPUT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print((d.get('tool_input') or {}).get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null || echo '')"

CONTENT="$(printf '%s' "$INPUT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    ti = d.get('tool_input') or {}
    sys.stdout.write(ti.get('new_string') or ti.get('content') or '')
except Exception:
    pass
" 2>/dev/null || echo '')"

if [ -z "$FILE_PATH" ]; then
    exit 0
fi

# Only scan JS under src/. Bash glob `*` only matches a single path segment,
# so we use a substring test against `/src/` plus a `.js` suffix.
case "$FILE_PATH" in
    */src/*.js) ;;
    *) exit 0 ;;
esac

if [ "${SAGECONNECT_HOOKS_BYPASS:-0}" = "1" ]; then
    echo "[pre-write-always-on] BYPASS active for $FILE_PATH." >&2
    exit 0
fi

# Patterns flagged.
LEAK_REGEX='setInterval\(|setTimeout\(|new EventEmitter|\.addListener\(|child_process\.spawn|child_process\.fork|child_process\.exec|axios\.create|winston\.createLogger'

# Quick check: does the content introduce any leak primitive?
if ! printf '%s' "$CONTENT" | grep -Eq "$LEAK_REGEX"; then
    exit 0
fi

# Cleanup-intent regex — if any of these tokens is near, we trust the author.
CLEANUP_REGEX='cleanup|clearInterval|clearTimeout|removeListener|removeAllListeners|\.off\(|destroy|close\(\)|release\(\)|abort\(\)|unref\(\)|reset\(\)|disconnect\(\)'

if printf '%s' "$CONTENT" | grep -Eq "$CLEANUP_REGEX"; then
    # Looks intentional; let it through.
    exit 0
fi

# Surface the offending lines.
HITS="$(printf '%s' "$CONTENT" | grep -En "$LEAK_REGEX" | head -5)"

{
    echo "[pre-write-always-on] BLOCKED — $FILE_PATH"
    echo "Introduces a primitive that retains state across cron ticks, with no visible cleanup token in the change:"
    echo ""
    printf '%s\n' "$HITS"
    echo ""
    echo "Always-on regime: the process never exits between cron ticks (CLAUDE.md § 3)."
    echo "Resolution:"
    echo "  - Add the cleanup path (clearInterval / removeListener / .destroy / etc.) in the same change, OR"
    echo "  - Add a comment in the same diff explaining how the resource is bounded (e.g. 'cleared on lock:timeout listener'), OR"
    echo "  - If the primitive is intentionally module-scope and bounded (e.g. winston cache), bypass with SAGECONNECT_HOOKS_BYPASS=1 after stating the rationale to the user."
} >&2

exit 2
