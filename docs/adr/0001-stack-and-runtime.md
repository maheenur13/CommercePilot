# ADR 0001 — Stack and runtime

**Status:** accepted (Task 0)

## Context

Four sequential tasks, ~3h each, reviewed by starting the system from a clean clone. The backend must later host
an LLM assistant with tool calling and an import pipeline, so module boundaries and validation matter early.

## Decision

- **NestJS 12 (ESM) + TypeScript strict.** Modules map 1:1 to the domains (products, orders, assistant, imports);
  DI makes the LLM client swappable for a scripted fake in tests.
- **Prisma 7 + Postgres 17.** Typed queries, reviewed SQL migrations, and real transactions with conditional
  updates for stock. Prisma 7 has no native engine binary, which keeps the Docker image simple.
- **Vitest + SWC.** Nest 12's default for ESM; SWC is required because esbuild does not emit decorator metadata.
- **`docker compose up --build`** is the single start command: migrations and an idempotent seed run on every start.
- **API-only + Swagger.** The brief asks for a backend; time goes to correctness and tests rather than a UI.

## Consequences

- Reviewers need only Docker. Local development additionally needs Node 22 + pnpm (pinned via `.nvmrc`/`packageManager`).
- Newest majors were checked for compatibility before pinning: TypeScript is held at 6.0 because
  `typescript-eslint` does not support TS 7 yet (peer range `<6.1`); Prisma is held at 7.10 stable (8 is RC).
