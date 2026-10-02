#!/usr/bin/env bash
# Stop: don't let a turn end with type errors. Exit 2 feeds the errors back to Claude.
input=$(cat)
[[ "$input" == *'"stop_hook_active":true'* ]] && exit 0  # avoid an infinite fix loop
cd "$CLAUDE_PROJECT_DIR"
out=$(pnpm -s typecheck 2>&1) || { echo "Typecheck failed, fix before finishing:" >&2; echo "$out" | tail -20 >&2; exit 2; }
exit 0
