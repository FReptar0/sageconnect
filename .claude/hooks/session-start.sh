#!/usr/bin/env bash
# SessionStart hook for SageConnect.
#
# Two responsibilities:
#   1. Tell the runtime to fire-and-forget this hook (async=true) so a slow
#      `npm install` does not block session startup.
#   2. Install dependencies if `node_modules` is missing. Local dev machines
#      almost always have them already; this is mainly for Claude Code on the
#      web and other ephemeral environments that start from a fresh checkout.
#
# Output discipline: only the JSON below goes to stdout. All other output is
# redirected so it never corrupts the runtime's JSON parse.

set -uo pipefail

echo '{"async": true, "asyncTimeout": 300000}'

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0

if [ ! -d "node_modules" ]; then
    npm install --no-audit --no-fund --silent >/dev/null 2>&1 || true
fi

exit 0
