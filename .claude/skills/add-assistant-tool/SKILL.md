---
name: add-assistant-tool
description: Add a new tool the shopping assistant (LLM) can call - zod arg schema, handler, registry entry, and tests including adversarial ones. Use when asked to "add a tool", "let the assistant do X", or extend assistant capabilities.
---

# Add an assistant tool

1. **Schema first** — define args with zod in `src/assistant/tools/`. Bound every field (string max length,
   integer ranges, enums). Never include `customerId`, prices, or totals as arguments.
2. **Handler** — `(args, ctx) => result` where `ctx` carries the authenticated customer (or `null`).
   Call existing services (`ProductsService`, `OrdersService`); do not query Prisma directly from tools.
   Return compact JSON (ids, names, cents) - it is fed back into the model context.
3. **Auth** — if the tool touches customer data, return a structured `{ error: 'AUTH_REQUIRED' }` when `ctx.customer` is null.
4. **State changes** — must be two-step (prepare -> explicit user confirmation -> confirm with server-issued id).
5. **Register** the tool in the tool registry with a precise description: when to use it and when not to.
6. **Tests** — unit test for arg validation; e2e with the scripted fake LLM covering the happy path and at least one
   adversarial case (foreign ids, injected instructions, out-of-range values).
