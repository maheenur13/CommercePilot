---
name: finish-task
description: Close out an assignment task (task-0..task-3) - verify quality gates, update README, squash to one commit, tag, and copy the raw transcript. Use when the user says "finish task", "close task N", "tag task N", or "wrap up this task".
---

# Finish task N

The brief requires exactly **one commit per task, tagged `task-N`**, raw transcripts, and an honest README.
Ask the user for N if it is not obvious from the branch name (`task-N`).

1. **Gates** — run and fix until green: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`.
2. **Clean start** — `docker compose down -v && docker compose up -d --build --wait`, then
   `curl -fsS localhost:3000/health` and one feature-specific request. Report the output.
   (`down -v` wipes the local dev DB — confirm with the user first.)
3. **Review** — run `/code-review` and `/security-review` on the branch diff; fix confirmed findings.
   Then run the `docs-auditor` subagent and fix every finding until it reports `DOCS OK`
   (it also runs `pnpm docs:check`, so the generated API docs are current).
4. **README** — update: what task N delivers, assumptions, exclusions, incomplete work, external services table,
   and the time log row (ask the user for actual start/end times; never invent them).
5. **Commit** — on `main`: `git merge --squash task-N`, then one Conventional Commit, e.g.
   `feat(task-N): <summary>`. Git hooks must pass; never skip them. Then `git tag -a task-N -m "Task N: <summary>"`.
6. **Transcript** — the current session's log is still growing, so it is copied after the session ends:
   `cp ~/.claude/projects/<project>/<session-id>.jsonl transcripts/task-N.jsonl` (raw, unedited, never summarised).
   `transcripts/` is gitignored: transcripts ship in the submission zip only (`scripts/package-submission.sh`),
   never in the public repo, because raw logs contain local environment details.
7. **Checklist** — print: one commit ✔ · tag ✔ · gates green ✔ · clean start ✔ · README updated ✔ · no secrets in diff ✔.
   Ask before `git push --follow-tags`.
