---
name: add-assistant-tool
description: Add a new tool the shopping assistant (LLM) can call - zod arg schema, handler, registry entry, and tests including adversarial ones. Use when asked to "add a tool", "let the assistant do X", or extend assistant capabilities.
---

# Add an assistant tool

All tools live in `src/assistant/tools.ts`: a `schemas` map (zod), a `descriptions` map, and a `switch` in `runTool`.
`TOOL_SPECS` (the JSON schemas sent to the model) is derived from `schemas`, so there is no second registry to update.

1. **Schema first.** Add a `z.strictObject` to `schemas`. Bound every field (string max length, integer ranges,
   enums). Never take `customerId`, prices or totals as arguments. Strict objects reject them anyway.
2. **Description.** Add one to `descriptions` that says when to use the tool and when not to.
3. **Handler.** Add a `case` in `runTool`. Call existing services (`ProductsService`, `OrdersService`) and never query
   Prisma directly. Return compact JSON (ids, names, cents) because it goes back into the model context. Return the
   products it touched in `products`, which makes them citable. Expected failures (not found) become
   `{ error: 'CODE' }` for the model. Rethrow anything unexpected.
4. **Auth.** The authenticated customer comes from the server (`AssistantService.chat`'s `customer`). Pass it into
   `runTool` when a tool needs it, and return `{ error: 'AUTH_REQUIRED' }` when it is `null`.
5. **State changes.** These must be two-step: prepare, then explicit user confirmation, then confirm with a
   server-issued id.
6. **Tests.**
   - A unit case in `tests/unit/assistant-tools.spec.ts` for argument rejection.
   - An e2e case in `tests/e2e/assistant.e2e.spec.ts` using `ScriptedLlm` with `callTool(...)` / `say(...)`. Cover the
     happy path and at least one adversarial case (foreign ids, injected instructions, out-of-range values).
   - Where real model behaviour matters, a scenario in `tests/evals/`.
