# Docs map: which file owns which change

Docs are part of the change, not a follow-up. A task is not done until every row below that applies is updated.
The `docs-sync-on-stop` hook blocks finishing when code changed without a docs pass; CI fails on API-doc drift.

| If you changed…                                         | Update                                                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| An endpoint, DTO, response shape, error code, auth      | `pnpm docs:api` (regenerates `docs/API.md` + `docs/openapi.json`), README "Response contract" if codes/shape changed |
| Behaviour, guarantees, invariants (e.g. stock, pricing) | README task section "Correctness properties"; ADR if it's a design decision                                          |
| A design decision or trade-off                          | New `docs/adr/NNNN-*.md` (context, decision, consequences); link it from the README                                  |
| Env var, port, start command, credentials               | `RUN.md` (+ `.env.example` via the user, since Claude can't edit env files), `src/config/env.ts`                     |
| Scripts, tooling, hooks, CI                             | README "Engineering setup", `CLAUDE.md` commands                                                                     |
| Conventions Claude must follow                          | `CLAUDE.md` (keep it ≤ 60 lines) or the relevant `.claude/rules/*.md`                                                |
| Scope: assumptions, exclusions, unfinished work         | README "Assumptions" / "Exclusions" / "Incomplete work"                                                              |
| External service or dependency on one                   | README "External services" (provider, purpose, task)                                                                 |
| Task status or time spent                               | README task table and "Time log" (real times from the user, never invented)                                          |

Never hand-edit `docs/API.md` or `docs/openapi.json`; they are generated. `docs/plan.md` stays as originally approved.
