#!/usr/bin/env bash
# PostToolUse(Edit|Write): format + lint-fix the file Claude just touched, so style never drifts.
set -euo pipefail
file=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).tool_input?.file_path??"")}catch{console.log("")}})')
[[ -z "$file" || ! -f "$file" ]] && exit 0
cd "$CLAUDE_PROJECT_DIR"
case "$file" in
  */src/generated/*|*/prisma/migrations/*) exit 0 ;;
  *.ts|*.mts|*.mjs) pnpm exec eslint --fix "$file" >&2 || true; pnpm exec prettier --write "$file" >/dev/null ;;
  *.json|*.md|*.yml|*.yaml) pnpm exec prettier --write "$file" >/dev/null 2>&1 || true ;;
esac
exit 0
