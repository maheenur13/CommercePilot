# ADR 0004 — Documentation is enforced by tools, not memory

**Status:** accepted (Task 0)

## Context

During Task 0 the README drifted from the code twice: an old error shape and a hand-written endpoint table that no
longer matched the routes. The rule "update the docs" lived only in `CLAUDE.md`, which is advisory, so the agent
could, and did, finish a change without a docs pass. This project is built with an AI agent across four tasks, so
drift would compound.

## Decision

Combine deterministic checks with a once-per-task AI audit:

- **Generate what can be generated.** `pnpm docs:api` writes `docs/openapi.json` and `docs/API.md` from the same
  `buildOpenApiDocument()` that serves `/docs`. No hand-written endpoint table exists anywhere.
- **Block the agent, deterministically.** The `docs-sync-on-stop.sh` Stop hook blocks finishing when the uncommitted
  diff touches code but no doc. It also blocks when `src/` is newer than the generated spec. A fingerprint of the
  change set (stored in `.git/`) makes it fire once per change set, so a justified "no doc change" is accepted.
  `stop_hook_active` prevents loops.
- **A docs map** (`.claude/rules/docs.md`) maps each kind of change to the doc that owns it, so the agent knows
  _where_ to look, not just _that_ it should.
- **An AI audit only where judgment pays off.** The `docs-auditor` subagent verifies every concrete claim in the
  docs (routes, codes, env vars, commands, guarantees) once per task, inside `/finish-task`.
- **Gates.** `pnpm docs:check` (regenerate + `git diff --exit-code`) runs on `pre-push` and in CI.

## Alternatives rejected

- **`CLAUDE.md` rule only:** advisory, and it already failed.
- **An LLM Stop hook (`type: "agent"`) on every turn:** slow and costly on every reply, and non-deterministic.
  The audit gets the same judgment once per task.
- **Auto-rewriting docs from a hook:** produces confidently wrong prose. The agent should be made to _review_, not
  have docs regenerated blindly (only the mechanical API reference is regenerated).

## Consequences

The hook can only check that docs were _touched_, not that they're _right_. Correctness of prose relies on the
auditor and review, while the API reference is guaranteed by generation. `pre-push` now takes a few seconds longer
(one build).
