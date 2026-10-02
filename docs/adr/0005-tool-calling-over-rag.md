# ADR 0005: The assistant grounds answers with tool calls, not RAG or catalog stuffing

**Status:** accepted (Task 1; Task 2 adds order tools to the same loop, see [ADR 0006](0006-order-confirmation-by-client-token.md))

## Context

The assistant must answer product questions **only** from the catalog: no invented products, prices or stock. It also
has to keep working as the catalog grows, and Task 2 will let it act (orders), not just read.

The options were:

1. Put the whole catalog in the prompt. Simple, but it stops scaling once the catalog outgrows the context window,
   costs tokens on every turn, and a stale snapshot shows stale prices and stock.
2. RAG over embeddings. This needs a vector store and an embedding provider, and retrieval is fuzzy for exact
   questions like "under $50, in stock".
3. Tool calling against the existing catalog service.

## Decision

- **Tool calling.** The model gets three read-only tools: `search_products` (text, category, price range, in-stock,
  ≤10 results), `get_product(id)` and `list_categories()`. They call `ProductsService`, the same code as the HTTP API,
  so filters are exact SQL and the data is always current.
- **Untrusted model output.** Tool arguments are parsed with strict, bounded zod schemas. Unknown keys such as
  `customerId` or `priceCents` are rejected and fed back to the model as `INVALID_ARGUMENTS`, and nothing runs.
  Tool names are looked up with `Object.hasOwn`, so `toString` is not a tool. At most 5 calls from one completion are
  run, and the loop is capped at 5 rounds. The final round sends `tool_choice: "none"` instead of an empty `tools`
  array, which OpenAI-style APIs reject, so the model has to answer. Each call is capped at `max_tokens: 1024`.
- **Product text is data.** Product descriptions go to the model only inside `tool` messages, and the system prompt
  says tool content is data, not instructions.
- **Server-side citations.** The response's `citedProducts` lists only products that tools returned this turn and
  that the reply names, with prices from the DB rows. A client that shows `citedProducts` never shows a price the
  model made up.
- **Ownership.** A conversation belongs to a customer or to nobody (anonymous). Its id is a random UUIDv4, not a cuid,
  because for an anonymous chat the id is the only credential. Lookups match the id and the owner (`null` included),
  so a mismatch is a 404. The foreign key cascades on customer delete.
- **History stores text only.** Only user and assistant messages are persisted and replayed (the last 20). Tool
  output isn't stored, so a follow-up re-queries and never repeats stale stock.
- **No SDK.** `LlmClient` is about 40 lines of native `fetch` against the OpenAI-compatible
  `/chat/completions` (OpenRouter), with a 30s timeout and a zod-validated response. It is a single class. Tests
  swap it through Nest's `overrideProvider` for a scripted fake, so `pnpm test` never calls a model.

## Consequences

- Grounding depends on the model choosing to call tools. The prompt requires it, the citations are server-verified,
  and live behaviour is checked by `pnpm test:eval` (opt-in, needs a key), not by CI.
- Ranking is ILIKE ordered by name, which is weak for vague questions ("something for running"). Full-text or
  trigram search can replace it inside `ProductsService.list` without changing the tools.
- Each turn costs 2+ model calls. The chat route is throttled to 20 requests/min.
