# CommercePilot

E-commerce backend (products, customers, orders), a conversational shopping assistant (LLM tool calling)
and operator bulk import from a link. NestJS 12 (ESM) · TypeScript strict · Prisma 7 + Postgres 17 · Vitest.

## Commands

- `docker compose up --build` — full stack from clean (migrates + seeds on start). API `:3000/api/v1`, Swagger `/docs`.
- `docker compose up -d db` then `pnpm start:dev` — local dev (DB on host port 5432).
- `pnpm lint` · `pnpm format:check` · `pnpm typecheck` · `pnpm test` (unit + e2e; e2e needs the db container).
- `pnpm prisma migrate dev --name <change>` — schema change. Never `migrate reset` (denied).
- `pnpm docs:api` — regenerate `docs/API.md` + `docs/openapi.json` after any API change (`pnpm docs:check` verifies).

## Layout

`src/<feature>/` = module + controller (HTTP + DTO mapping) + service (rules) + `dto/` (input + `*-response.dto.ts`).
Shared: `src/common/` (auth, Prisma, `http/` envelope + money).
Tests live in `tests/{unit,e2e}` (not colocated). Seed data in `fixtures/`, loaded by `prisma/seed.ts`.

## Non-negotiable rules

1. Money is integer cents (`priceCents`), never floats. Prices always come from the DB, never from clients or the LLM.
2. Customer identity comes only from the auth guard (`@CurrentCustomer()`). Never accept a customerId from a body, query, or tool argument.
3. Validate every trust boundary: class-validator DTOs for HTTP; zod for env, LLM tool args, and imported rows.
4. Stock changes go through a conditional update inside a transaction (see `OrdersService.place`).
5. Reads of customer-owned data are scoped by `customerId`; return 404 (not 403) for others' resources.
6. No new dependency when stdlib/an installed one covers it. No abstraction with a single implementation.
7. New logic ships with a test; security-relevant logic ships with an adversarial test.
8. ESM: relative imports end in `.js`. Nest-injected classes must be value imports (not `import type`).
9. Responses: return response DTOs (never Prisma rows); the envelope is added globally. Errors carry a domain `code`.

## Definition of done (per task)

lint + format + typecheck + tests green · **docs updated per `.claude/rules/docs.md`** (a Stop hook enforces a docs pass;
`docs-auditor` reports `DOCS OK`) ·
`/finish-task` skill run (one squashed commit, tag `task-N`, transcript copied).

More: `.claude/rules/{testing,security,api,docs,submission}.md`, `docs/adr/`, generated `docs/API.md`.
