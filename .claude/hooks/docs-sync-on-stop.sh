#!/usr/bin/env bash
# Stop hook: Claude may not finish a turn with code changes and no documentation pass.
#
#  1. Code changed but no doc file changed      -> block once with the docs-map checklist.
#  2. src/ changed after docs/openapi.json       -> block: regenerate with `pnpm docs:api`.
#
# "Once" means once per distinct change set: a fingerprint of the uncommitted code diff is stored inside
# .git/ (never tracked, never in the fingerprint itself), so a deliberate "no doc change needed" is accepted and new edits trigger it again.
# `stop_hook_active` guards against loops. Exit 2 = block; stderr is shown to Claude.
input=$(cat)
[[ "$input" == *'"stop_hook_active":true'* ]] && exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
git rev-parse --verify -q HEAD >/dev/null || exit 0

changed=$({ git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u)
code=$(grep -E '^(src/|prisma/|scripts/|Dockerfile$|docker-compose\.yml$|package\.json$|\.github/|\.claude/(hooks|settings\.json))' <<<"$changed")
[[ -z "$code" ]] && exit 0
docs=$(grep -E '^(README\.md|RUN\.md|CLAUDE\.md|docs/|\.claude/rules/|\.claude/skills/)' <<<"$changed")

# 2. Generated API docs are stale if any changed src file is newer than the spec.
if grep -q '^src/' <<<"$code" && [[ -n $(find src -name '*.ts' -newer docs/openapi.json -not -path 'src/generated/*' 2>/dev/null | head -1) ]]; then
  echo "Docs guard: src/ changed after docs/openapi.json was generated. Run \`pnpm docs:api\` and review docs/API.md." >&2
  exit 2
fi

# 1. Code changed with no doc touched: one docs pass per change set.
[[ -n "$docs" ]] && exit 0
state="$(git rev-parse --git-dir)/claude-docs-sync"
fingerprint=$( { git diff HEAD -- $code; git ls-files --others --exclude-standard -z | xargs -0 cat 2>/dev/null; } | shasum | cut -d' ' -f1)
[[ "$(cat "$state" 2>/dev/null)" == "$fingerprint" ]] && exit 0
echo "$fingerprint" > "$state"

cat >&2 <<EOF
Docs guard: code changed but no documentation was updated.
Changed code files:
$(sed 's/^/  - /' <<<"$code")

Before finishing, walk the docs map in .claude/rules/docs.md and update every affected file
(README.md, RUN.md, CLAUDE.md, .claude/rules/*, docs/adr/*, docs/API.md via \`pnpm docs:api\`).
If nothing user-facing changed, say so explicitly in your reply. This check will then pass.
EOF
exit 2
