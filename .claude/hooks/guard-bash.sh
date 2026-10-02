#!/usr/bin/env bash
# PreToolUse(Bash): block commands that bypass quality gates, rewrite history, or touch secrets.
# Exit 2 = block and show the reason to Claude.
# Defence in depth, not a sandbox: a regex deny-list can't catch every shell variant. It pairs
# with the `permissions.deny` rules in settings.json and with .env being gitignored.
cmd=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).tool_input?.command??"")}catch{console.log("")}})')
block() { echo "Blocked by project policy: $1" >&2; exit 2; }
has() { printf '%s\n' "$cmd" | grep -Eq "$1"; }

has '(^|[;&|] *)git +(commit|push|merge)[^;&|]*--no-verify' && block "git hooks must not be skipped (--no-verify)."
has '(^|[;&|] *)git +push[^;&|]*(--force|-f( |$))' && block "force-push rewrites shared history; ask the user."
has '(^|[;&|] *)((pnpm|npx|yarn|bunx)( +exec)? +)?prisma +migrate +reset' && block "prisma migrate reset wipes the database; ask the user."
# Any reference to .env or .env.<name>; the committed .env.example template is stripped first.
printf '%s\n' "${cmd//.env.example/}" | grep -Eq '(^|[^A-Za-z0-9_.-])\.env(\.[A-Za-z0-9_-]+)?([^A-Za-z0-9_.-]|$)' &&
  block "do not read or print .env files (may contain secrets)."
exit 0
