#!/usr/bin/env bash
# PreToolUse hook for Edit / Write — enforces the GSD workflow.
#
# Blocks edits to src/** when no active GSD phase exists in .planning/phases/.
# An "active" phase is a directory `.planning/phases/<NN>-<slug>/` whose name
# does not include `-COMPLETE` and which contains at least one of
# SPEC.md / PLAN.md / DISCUSSION.md (i.e. not just a placeholder).
#
# Exempted paths (always allowed without a phase):
#   - tests/**, docs/**, .planning/**, .claude/**, .github/**
#   - root-level *.md, *.json (except package.json)
#
# Bypass for genuinely trivial work: SAGECONNECT_HOOKS_BYPASS=1.

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

# Only enforce on src/** edits. Tests / docs / planning / config are free.
case "$FILE_PATH" in
    */src/*) ;;
    *) exit 0 ;;
esac

if [ "${SAGECONNECT_HOOKS_BYPASS:-0}" = "1" ]; then
    echo "[pre-edit-gsd-guard] BYPASS active for $FILE_PATH." >&2
    exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PHASES_DIR="$PROJECT_DIR/.planning/phases"

# Detect an active phase: any subdirectory whose name does NOT contain
# COMPLETE/ARCHIVED/CANCELLED and that has at least one of the GSD artifacts.
ACTIVE_PHASE=""
if [ -d "$PHASES_DIR" ]; then
    while IFS= read -r dir; do
        base="$(basename "$dir")"
        case "$base" in
            *COMPLETE*|*ARCHIVED*|*CANCELLED*|*cancelled*|*archived*|*complete*) continue ;;
        esac
        if [ -f "$dir/SPEC.md" ] || [ -f "$dir/PLAN.md" ] || [ -f "$dir/DISCUSSION.md" ]; then
            ACTIVE_PHASE="$base"
            break
        fi
    done < <(find "$PHASES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
fi

if [ -n "$ACTIVE_PHASE" ]; then
    exit 0
fi

{
    echo "[pre-edit-gsd-guard] BLOCKED — about to edit src/ without an active GSD phase."
    echo "    File: $FILE_PATH"
    echo ""
    echo "This codebase requires a GSD phase artifact for non-trivial src/ changes."
    echo "Open one before proceeding:"
    echo "    /gsd-spec-phase     — spec a new phase (Recommended starting point)"
    echo "    /gsd-discuss-phase  — discuss gray areas if spec already exists"
    echo "    /gsd-plan-phase     — create PLAN.md once the spec is solid"
    echo "    /gsd-quick          — for small, single-file changes"
    echo ""
    echo "If this edit is genuinely trivial (typo, comment, dead-code removal), state that to the user, get an OK, and retry with:"
    echo "    SAGECONNECT_HOOKS_BYPASS=1"
    echo ""
    echo "Rationale: CLAUDE.md § 12 + HANDOFF.md. The 2026-04-27 always-on cascade is the worked example of skipping the plan."
} >&2

exit 2
