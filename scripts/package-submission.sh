#!/usr/bin/env bash
# Builds submission.zip in the layout required by the brief:
# REPO_URL.txt, code/, README.md, RUN.md, transcripts/, fixtures/, tests/, and .env (non-model keys only).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT   # never leave the staged .env behind, even on failure
stage="$out/submission"
mkdir -p "$stage/code"

git remote get-url origin | sed -E 's#^git@[^:]+:#https://github.com/#; s#\.git$##' > "$stage/REPO_URL.txt"
git archive HEAD | tar -x -C "$stage/code"   # fallback copy of the source at HEAD (tracked files only)
cp -R README.md RUN.md transcripts fixtures tests "$stage/"

# Only the operator key belongs in the zip's .env; the model key is supplied by the reviewer.
admin_key=$(grep -E '^ADMIN_API_KEY=' .env 2>/dev/null | cut -d= -f2- || true)
printf 'ADMIN_API_KEY=%s\n' "${admin_key:-local-dev-admin-key-change-me}" > "$stage/.env"

rm -f submission.zip
(cd "$out" && zip -qr - submission) > submission.zip
echo "Wrote submission.zip"
