# Submission rules (from the brief)

The assessors grade the repo, the zip and the transcripts together. These rules override convenience.

- **One commit per task**, tagged `task-0` … `task-3` (annotated). Work on branch `task-N`, then squash it onto `main`
  with the `/finish-task` skill. Never add a fifth commit. A fix to a finished task goes into that task's commit with
  `git commit --fixup=task-N` and `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash`. Then recreate every later tag
  with its old message and record the change in the README. Claude never force-pushes; the user does.
- **Starts from a clean clone or unzip, with data already present.** `docker compose up --build` must migrate, seed
  and serve with no manual step. A new env var needs a working default in `src/config/env.ts`; only the model key
  may be missing (the assistant then degrades and the rest works). Verify a clean start before tagging
  (`down -v` wipes data, so ask first). A submission that doesn't start can't be assessed.
- **Transcripts are raw tool output**: the unedited `~/.claude/projects/…/<session>.jsonl`, one per task, copied as
  `transcripts/task-N.jsonl` after the session ends. Never summarise, trim or rewrite them. A written account is
  not a substitute. If a later session changes a task's commit, ship its log too (`transcripts/task-N-<what>.jsonl`)
  and say so in the README. Check that the copy exists and is the same size as the source. `transcripts/` is gitignored and ships in the zip only.
- **External services**: every one goes in the README "External services" table with provider, purpose and the task
  that needs it, including build-time ones (images, registries) and optional runtime ones.
- **Keys**: never commit a key (gitleaks runs in CI). Claude never reads or prints `.env`. A non-model key (e.g.
  `ADMIN_API_KEY`) goes in `.env` at the zip root, which `scripts/package-submission.sh` writes. The
  OpenAI-compatible model key is never shipped; the reviewer supplies it.
- **Time is self-reported**: the README time log uses start/end times from the user, never estimates. An overrun is
  stated plainly with what took the extra time. Reporting an overrun scores higher than hiding it.
- **Honest scope**: keep README "Assumptions", "Exclusions" and "Incomplete work" current. Unfinished or unverified
  work goes in "Incomplete work", never left implied.
- **Delivery**: ask before `git push --follow-tags`. The user builds the zip with `bash scripts/package-submission.sh`
  (REPO_URL.txt, code/, README, RUN, transcripts/, fixtures/, tests/, `.env`).
